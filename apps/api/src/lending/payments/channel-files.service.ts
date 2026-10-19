import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  engineCall,
  fromLocalDate,
  requestHash,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { ServicingService } from '../servicing/servicing.service';
import { blindIndex } from '../../common/field-crypto';
import { SuspenseService } from './suspense.service';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import type {
  PayrollFileBody,
  SettlementFileBody,
} from './payment-channels.schemas';

type Json = Prisma.InputJsonValue;

/** Suspense knows fewer channels than files do. */
const SUSPENSE_CHANNEL = {
  MOBILE: 'MOBILE',
  QR: 'MOBILE',
  WALLET: 'MOBILE',
  AGENT: 'AGENT',
  PAYROLL: 'PAYROLL',
} as const;

type FileChannel = keyof typeof SUSPENSE_CHANNEL;

export interface SuspenseState {
  reference: string;
  status: string;
  remaining: string;
  matched: string;
  refunded: string;
}

interface LineResult {
  id: string;
  line: lending.ChannelLine;
  outcome: lending.ChannelLineOutcome;
  reason: string;
  loanAccountId: string | null;
  financialEventId: string | null;
  unidentifiedPaymentId: string | null;
  duplicateOfLineId: string | null;
  conflicting: boolean;
  nationalIdHash: string | null;
}

/**
 * Settlement files from mobile, QR, wallet and agent channels (UC-18) and
 * employer payroll remittances (UC-19).
 *
 * A file is imported once per content hash, and each line once per channel
 * transaction id: a repeated file returns the original import, a repeated
 * line is recorded as a duplicate and applies nothing. Lines that identify a
 * live loan post the ordinary repayment; every other line goes to the
 * unidentified-payments suspense account with the reason — money a channel
 * reports is never dropped. The whole file is one transaction, so it is
 * imported completely or not at all.
 */
@Injectable()
export class ChannelFilesService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
    private readonly suspense: SuspenseService,
    private readonly settings: TenantSettingsService,
  ) {}

  importSettlement(actor: LendingActor, body: SettlementFileBody) {
    return this.importFile(actor, {
      kind: 'SETTLEMENT',
      channel: body.channel,
      fileName: body.fileName,
      content: body.content,
      employer: null,
      period: null,
      parse: (text, maxLines) => lending.parseSettlementFile(text, maxLines),
    });
  }

  importPayroll(actor: LendingActor, body: PayrollFileBody) {
    const meta = {
      employer: body.employer.trim(),
      period: body.period,
      currency: body.currency,
      valueDate: body.valueDate,
    };
    return this.importFile(actor, {
      kind: 'PAYROLL',
      channel: 'PAYROLL',
      fileName: body.fileName,
      content: body.content,
      employer: meta.employer,
      period: meta.period,
      meta,
      parse: (text, maxLines) => lending.parsePayrollFile(text, meta, maxLines),
    });
  }

  private async importFile(
    actor: LendingActor,
    f: {
      kind: 'SETTLEMENT' | 'PAYROLL';
      channel: FileChannel;
      fileName: string;
      content: string;
      employer: string | null;
      period: string | null;
      meta?: Record<string, string>;
      parse: (text: string, maxLines: number) => lending.ParsedChannelFile;
    },
  ) {
    const tenantId = requireTenant(actor);
    const text = lending.normalizeFileText(f.content);
    const fileHash = requestHash({
      kind: f.kind,
      channel: f.channel,
      meta: f.meta ?? null,
      text,
    });
    return this.lp.tenantTx(
      tenantId,
      async (tx) => {
        await this.policy.enforce(
          actor,
          'payment.channel_file.import',
          tenantResource(tenantId),
          tx,
        );
        const already = await tx.channelFile.findFirst({
          where: { tenantId, kind: f.kind, fileHash },
        });
        if (already)
          return {
            replayed: true,
            ...(await this.fileView(tx, tenantId, already.id)),
          };

        // The lender's limits (lending settings): lines per file, and how far
        // back a line may be dated — the suspense account's own limit.
        const { payments } = await this.settings.get(tenantId, tx);
        const parsed = engineCall(() => f.parse(text, payments.maxFileLines));
        const businessDate = await this.businessDate.get(tenantId, tx);
        const errors = [...parsed.errors];
        for (const l of parsed.lines) {
          try {
            BusinessDateService.checkValueDate(
              l.valueDate,
              businessDate,
              payments.maxBackdateDays,
            );
          } catch (e) {
            errors.push({ lineNo: l.lineNo, message: (e as Error).message });
          }
        }
        if (errors.length)
          throw new BadRequestException({
            message: `The file has ${errors.length} error(s); nothing was imported. Correct them and send the whole file again.`,
            code: 'FILE_INVALID',
            issues: errors
              .sort((a, b) => a.lineNo - b.lineNo)
              .slice(0, 200)
              .map((e) => ({ path: `line ${e.lineNo}`, message: e.message })),
          });

        const results: LineResult[] = [];
        const idByLineNo = new Map<number, string>();
        for (const line of parsed.lines) {
          const id = randomUUID();
          idByLineNo.set(line.lineNo, id);
          results.push(
            await this.processLine(
              tx,
              actor,
              f,
              fileHash,
              id,
              line,
              idByLineNo,
            ),
          );
        }
        const count = (o: string) =>
          results.filter((r) => r.outcome === o).length;
        const file = await tx.channelFile.create({
          data: {
            tenantId,
            kind: f.kind,
            channel: f.channel,
            fileName: f.fileName.slice(0, 200),
            fileHash,
            employer: f.employer,
            period: f.period,
            lineCount: results.length,
            postedCount: count('POSTED'),
            suspenseCount: count('SUSPENSE'),
            duplicateCount: count('DUPLICATE'),
            totals: parsed.totals as Json,
            businessDate: fromLocalDate(businessDate),
            importedBy: actor.id,
          },
        });
        await tx.channelFileLine.createMany({
          data: results.map((r) => ({
            id: r.id,
            tenantId,
            fileId: file.id,
            lineNo: r.line.lineNo,
            channel: f.channel,
            channelTxnId: r.line.channelTxnId,
            dedupeKey:
              r.outcome === 'DUPLICATE'
                ? null
                : `${f.channel}:${r.line.channelTxnId}`,
            reference: r.line.reference,
            loanRef: r.line.loanRef,
            employeeRef: r.line.employeeRef,
            nationalIdHash: r.nationalIdHash,
            nationalIdHint: r.line.nationalId
              ? r.line.nationalId.slice(-3)
              : null,
            payerName: r.line.payerName,
            amount: r.line.amount,
            currency: r.line.currency,
            valueDate: fromLocalDate(r.line.valueDate),
            outcome: r.outcome,
            reason: r.reason.slice(0, 500),
            loanAccountId: r.loanAccountId,
            financialEventId: r.financialEventId,
            unidentifiedPaymentId: r.unidentifiedPaymentId,
            duplicateOfLineId: r.duplicateOfLineId,
            conflicting: r.conflicting,
          })),
        });
        await this.servicing.outbox(
          tx,
          tenantId,
          'lending.channel_file.imported',
          {
            fileId: file.id,
            kind: f.kind,
            channel: f.channel,
            lines: results.length,
            posted: file.postedCount,
            suspense: file.suspenseCount,
            duplicates: file.duplicateCount,
          },
        );
        await this.audit.write(
          {
            actor,
            action: 'payment.channel_file.import',
            resourceType: 'ChannelFile',
            resourceId: file.id,
            outcome: 'SUCCESS',
            details: {
              kind: f.kind,
              channel: f.channel,
              fileName: f.fileName,
              lines: results.length,
              posted: file.postedCount,
              suspense: file.suspenseCount,
              duplicates: file.duplicateCount,
              totals: parsed.totals,
            },
            businessDate: fromLocalDate(businessDate),
          },
          tx,
        );
        return {
          replayed: false,
          ...(await this.fileView(tx, tenantId, file.id)),
        };
      },
      { timeoutMs: 600_000 },
    );
  }

  private async processLine(
    tx: Tx,
    actor: LendingActor,
    f: { kind: string; channel: FileChannel; fileName: string },
    fileHash: string,
    id: string,
    line: lending.ChannelLine,
    idByLineNo: Map<number, string>,
  ): Promise<LineResult> {
    const tenantId = requireTenant(actor);
    const nationalIdHash = line.nationalId
      ? blindIndex(line.nationalId, 'id')
      : null;
    const base: LineResult = {
      id,
      line,
      outcome: 'DUPLICATE',
      reason: '',
      loanAccountId: null,
      financialEventId: null,
      unidentifiedPaymentId: null,
      duplicateOfLineId: null,
      conflicting: false,
      nationalIdHash,
    };
    // A repeat inside this file.
    if (line.duplicateOf !== null)
      return {
        ...base,
        reason: `Repeats line ${line.duplicateOf} of this file.`,
        duplicateOfLineId: idByLineNo.get(line.duplicateOf) ?? null,
      };
    // A repeat of a line imported before.
    const earlier = await tx.channelFileLine.findFirst({
      where: { tenantId, dedupeKey: `${f.channel}:${line.channelTxnId}` },
    });
    if (earlier) {
      const same = lending.sameLine(
        {
          amount: D(earlier.amount).toString(),
          currency: earlier.currency,
          valueDate: toLocalDate(earlier.valueDate)!,
          loanRef: earlier.loanRef,
          nationalId: earlier.nationalIdHash,
        },
        { ...line, nationalId: nationalIdHash },
      );
      return {
        ...base,
        reason: same
          ? `Already imported (line ${earlier.lineNo} of an earlier file).`
          : `Transaction id already imported (line ${earlier.lineNo} of an earlier file) for a different payment; nothing applied.`,
        duplicateOfLineId: earlier.id,
        conflicting: !same,
      };
    }

    const target = await this.findLoan(tx, tenantId, line, nationalIdHash);
    const external = `${f.channel} ${line.channelTxnId}`.slice(0, 120);
    const hash = requestHash({
      op: 'channel-line',
      fileHash,
      lineNo: line.lineNo,
    });
    if (target.loanId) {
      // A refused repayment must leave no trace before the line goes to suspense.
      await tx.$executeRaw`SAVEPOINT channel_line`;
      try {
        const event = await this.servicing.repayInTx(
          tx,
          actor,
          target.loanId,
          {
            amount: line.amount,
            valueDate: line.valueDate,
            externalReference: external,
            payer:
              f.kind === 'PAYROLL'
                ? {
                    name: (line.payerName ?? 'Employer').slice(0, 120),
                    relationship: 'EMPLOYER',
                    reference: line.employeeRef ?? undefined,
                  }
                : undefined,
          },
          `sys:channel:${id}`,
          hash,
          {
            components: {
              channel: {
                type: f.kind,
                channel: f.channel,
                channelTxnId: line.channelTxnId,
                file: f.fileName,
                lineNo: line.lineNo,
              },
            },
          },
        );
        await tx.$executeRaw`RELEASE SAVEPOINT channel_line`;
        return {
          ...base,
          outcome: 'POSTED',
          loanAccountId: target.loanId,
          financialEventId: event.id,
        };
      } catch (e) {
        if (
          !(e instanceof HttpException) &&
          (e as Error).name !== 'EngineError'
        )
          throw e;
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT channel_line`;
        target.reason = `Loan ${line.loanRef ?? target.loanId} refused the payment: ${(e as Error).message}`;
      }
    }
    const held = await this.suspense.receiveInTx(
      tx,
      actor,
      {
        amount: line.amount,
        currency: line.currency,
        valueDate: line.valueDate,
        channel: SUSPENSE_CHANNEL[f.channel],
        externalReference: external,
        payerName: line.payerName ?? undefined,
        narrative:
          `${f.kind === 'PAYROLL' ? 'Payroll' : 'Settlement'} file ${f.fileName} line ${line.lineNo}: ${target.reason}`.slice(
            0,
            500,
          ),
      },
      `sys:channel-suspense:${id}`,
      hash,
    );
    return {
      ...base,
      outcome: 'SUSPENSE',
      reason: target.reason,
      unidentifiedPaymentId: held.id,
    };
  }

  /**
   * The loan a line pays: by loan reference, or — on a payroll line without
   * one — the borrower's only live loan in the file currency, found by the
   * national id's blind index.
   */
  private async findLoan(
    tx: Tx,
    tenantId: string,
    line: lending.ChannelLine,
    nationalIdHash: string | null,
  ): Promise<{ loanId: string | null; reason: string }> {
    if (line.loanRef) {
      const loan = await tx.loanAccount.findFirst({
        where: { tenantId, reference: line.loanRef },
        select: { id: true, status: true, currency: true },
      });
      if (!loan)
        return {
          loanId: null,
          reason: `No loan with reference ${line.loanRef}.`,
        };
      if (loan.status !== 'ACTIVE')
        return {
          loanId: null,
          reason: `Loan ${line.loanRef} is ${loan.status.toLowerCase()}.`,
        };
      if (loan.currency !== line.currency)
        return {
          loanId: null,
          reason: `Loan ${line.loanRef} is in ${loan.currency}, the payment in ${line.currency}.`,
        };
      return { loanId: loan.id, reason: '' };
    }
    if (nationalIdHash) {
      const borrowers = await tx.borrower.findMany({
        where: { tenantId, idNumberHash: nationalIdHash },
        select: { id: true },
      });
      const loans = borrowers.length
        ? await tx.loanAccount.findMany({
            where: {
              tenantId,
              borrowerId: { in: borrowers.map((b) => b.id) },
              status: 'ACTIVE',
              currency: line.currency,
            },
            select: { id: true },
          })
        : [];
      if (loans.length === 1) return { loanId: loans[0].id, reason: '' };
      return {
        loanId: null,
        reason: loans.length
          ? `The borrower has ${loans.length} live ${line.currency} loans; the line names none of them.`
          : `No live ${line.currency} loan for national id ending ${line.nationalId!.slice(-3)}.`,
      };
    }
    return { loanId: null, reason: 'The line names no loan.' };
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  async list(actor: LendingActor, q: { kind?: string; channel?: string }) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment.channel.read',
        tenantResource(tenantId),
        tx,
      );
      const rows = await tx.channelFile.findMany({
        where: {
          tenantId,
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.channel ? { channel: q.channel } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return rows.map((r) => ({
        ...r,
        businessDate: toLocalDate(r.businessDate),
      }));
    });
  }

  async get(actor: LendingActor, fileId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment.channel.read',
        tenantResource(tenantId),
        tx,
      );
      return this.fileView(tx, tenantId, fileId);
    });
  }

  private async fileView(tx: Tx, tenantId: string, fileId: string) {
    const file = await tx.channelFile.findFirst({
      where: { id: fileId, tenantId },
    });
    if (!file) throw new NotFoundException('Channel file not found');
    const lines = await tx.channelFileLine.findMany({
      where: { tenantId: file.tenantId, fileId },
      orderBy: { lineNo: 'asc' },
    });
    const state = await this.lineState(tx, file.tenantId, lines);
    const loans = await tx.loanAccount.findMany({
      where: {
        tenantId: file.tenantId,
        id: {
          in: lines.flatMap((l) => (l.loanAccountId ? [l.loanAccountId] : [])),
        },
      },
      select: { id: true, reference: true },
    });
    const ref = new Map(loans.map((l) => [l.id, l.reference]));
    return {
      file: { ...file, businessDate: toLocalDate(file.businessDate) },
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        channelTxnId: l.channelTxnId,
        reference: l.reference,
        loanRef: l.loanRef,
        employeeRef: l.employeeRef,
        nationalIdHint: l.nationalIdHint,
        payerName: l.payerName,
        amount: D(l.amount).toString(),
        currency: l.currency,
        valueDate: toLocalDate(l.valueDate),
        outcome: l.outcome,
        reason: l.reason,
        loanAccountId: l.loanAccountId,
        loanReference: l.loanAccountId
          ? (ref.get(l.loanAccountId) ?? null)
          : null,
        financialEventId: l.financialEventId,
        unidentifiedPaymentId: l.unidentifiedPaymentId,
        duplicateOfLineId: l.duplicateOfLineId,
        conflicting: l.conflicting,
        reversed: state.reversed.has(l.financialEventId ?? ''),
        suspense: l.unidentifiedPaymentId
          ? (state.suspense.get(l.unidentifiedPaymentId) ?? null)
          : null,
      })),
    };
  }

  /** What has become of each line since import: reversals and suspense matching. */
  private async lineState(
    tx: Tx,
    tenantId: string,
    lines: {
      financialEventId: string | null;
      unidentifiedPaymentId: string | null;
    }[],
  ) {
    const eventIds = lines.flatMap((l) =>
      l.financialEventId ? [l.financialEventId] : [],
    );
    const paymentIds = lines.flatMap((l) =>
      l.unidentifiedPaymentId ? [l.unidentifiedPaymentId] : [],
    );
    const [events, payments] = await Promise.all([
      eventIds.length
        ? tx.financialEvent.findMany({
            where: { tenantId, id: { in: eventIds }, status: 'REVERSED' },
            select: { id: true },
          })
        : [],
      tx.unidentifiedPayment.findMany({
        where: { tenantId, id: { in: paymentIds } },
        include: { matches: true },
      }),
    ]);
    const sum = (
      ms: { kind: string; amount: Prisma.Decimal }[],
      kind: string,
    ) =>
      ms
        .filter((m) => m.kind === kind)
        .reduce((s, m) => s.plus(D(m.amount)), D(0))
        .toString();
    return {
      reversed: new Set(events.map((e) => e.id)),
      suspense: new Map<string, SuspenseState>(
        payments.map((p): [string, SuspenseState] => [
          p.id,
          {
            reference: p.reference,
            status: p.status,
            remaining: D(p.remaining).toString(),
            matched: sum(p.matches, 'MATCH'),
            refunded: sum(p.matches, 'REFUND'),
          },
        ]),
      ),
    };
  }

  /**
   * Daily reconciliation per channel (UC-18, UC-19): for the lines valued on
   * `date` (default: the business date), what the files reported against what
   * was posted to loans, matched or refunded out of suspense, still held, or
   * reversed. The breaks are what someone still has to act on.
   */
  async reconciliation(
    actor: LendingActor,
    q: { date?: string; channel?: string },
  ) {
    const tenantId = requireTenant(actor);
    if (q.date && !/^\d{4}-\d{2}-\d{2}$/.test(q.date))
      throw new BadRequestException('date must be YYYY-MM-DD.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment.channel.read',
        tenantResource(tenantId),
        tx,
      );
      const date = q.date ?? (await this.businessDate.get(tenantId, tx));
      engineCall(() => lending.parseDate(date, 'date'));
      const lines = await tx.channelFileLine.findMany({
        where: {
          tenantId,
          valueDate: fromLocalDate(date),
          ...(q.channel ? { channel: q.channel } : {}),
        },
        orderBy: [{ channel: 'asc' }, { createdAt: 'asc' }, { lineNo: 'asc' }],
      });
      const files = await tx.channelFile.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(lines.map((l) => l.fileId))] },
        },
        select: {
          id: true,
          fileName: true,
          channel: true,
          kind: true,
          employer: true,
          period: true,
          createdAt: true,
        },
      });
      const state = await this.lineState(tx, tenantId, lines);
      const channels = [...new Set(lines.map((l) => l.channel))].sort();
      return {
        date,
        channels: channels.map((channel) => {
          const mine = lines.filter((l) => l.channel === channel);
          const r = lending.reconcileChannel(
            mine.map((l) => this.reconLine(l, state)),
          );
          return {
            channel,
            files: files.filter((x) => x.channel === channel),
            ...r,
          };
        }),
      };
    });
  }

  private reconLine(
    l: {
      id: string;
      fileId: string;
      lineNo: number;
      channelTxnId: string;
      currency: string;
      amount: Prisma.Decimal;
      outcome: string;
      financialEventId: string | null;
      unidentifiedPaymentId: string | null;
      conflicting: boolean;
    },
    state: Awaited<ReturnType<ChannelFilesService['lineState']>>,
  ): lending.ReconciliationLine {
    const s = l.unidentifiedPaymentId
      ? state.suspense.get(l.unidentifiedPaymentId)
      : undefined;
    return {
      lineId: l.id,
      fileId: l.fileId,
      lineNo: l.lineNo,
      channelTxnId: l.channelTxnId,
      currency: l.currency,
      amount: D(l.amount).toString(),
      outcome: l.outcome as lending.ChannelLineOutcome,
      reversed: state.reversed.has(l.financialEventId ?? ''),
      suspense: s
        ? { remaining: s.remaining, matched: s.matched, refunded: s.refunded }
        : undefined,
      conflicting: l.conflicting,
    };
  }

  /** Per employer and period (UC-19): what was remitted and where it went. */
  async payrollSummary(
    actor: LendingActor,
    q: { employer?: string; period?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment.channel.read',
        tenantResource(tenantId),
        tx,
      );
      const files = await tx.channelFile.findMany({
        where: {
          tenantId,
          kind: 'PAYROLL',
          ...(q.employer ? { employer: q.employer } : {}),
          ...(q.period ? { period: q.period } : {}),
        },
        orderBy: [{ period: 'desc' }, { employer: 'asc' }],
        take: 500,
      });
      const lines = files.length
        ? await tx.channelFileLine.findMany({
            where: { tenantId, fileId: { in: files.map((x) => x.id) } },
          })
        : [];
      const state = await this.lineState(tx, tenantId, lines);
      const groups = new Map<string, typeof files>();
      for (const file of files) {
        const k = `${file.employer}\u0000${file.period}`;
        groups.set(k, [...(groups.get(k) ?? []), file]);
      }
      return [...groups.values()].map((fs) => {
        const ids = new Set(fs.map((x) => x.id));
        const mine = lines.filter((l) => ids.has(l.fileId));
        const r = lending.reconcileChannel(
          mine.map((l) => this.reconLine(l, state)),
        );
        return {
          employer: fs[0].employer,
          period: fs[0].period,
          files: fs.map((x) => ({
            id: x.id,
            fileName: x.fileName,
            createdAt: x.createdAt,
          })),
          employees: new Set(mine.map((l) => l.employeeRef)).size,
          ...r,
        };
      });
    });
  }
}
