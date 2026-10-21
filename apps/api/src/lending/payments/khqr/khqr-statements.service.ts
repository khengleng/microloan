import {
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../../common/lending-prisma';
import { AuditEventService } from '../../common/audit-event.service';
import { BusinessDateService } from '../../common/business-date.service';
import {
  D,
  LendingActor,
  engineCall,
  fromLocalDate,
  newReference,
  requestHash,
  requireTenant,
  toLocalDate,
} from '../../common/util';
import { PolicyService } from '../../policy/policy.service';
import { tenantResource } from '../../policy/resources';
import { ServicingService } from '../../servicing/servicing.service';
import { loadLoanState, outstanding } from '../../servicing/loan-state';
import { blindIndex } from '../../../common/field-crypto';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import { SuspenseService } from '../suspense.service';
import { ChannelFilesService } from '../channel-files.service';
import { KhqrReceiptsService } from './khqr-receipts.service';
import { readXlsxRows } from './xlsx-rows';
import type { StatementBody } from './khqr.schemas';

type Json = Prisma.InputJsonValue;
type ReceiptRow = Prisma.KhqrReceiptGetPayload<object>;
type Line = lending.StatementLine;

/** What a statement line will do, decided before anything is written. */
type Decision =
  | {
      kind: 'DUPLICATE';
      reason: string;
      duplicateOfLineId: string | null;
      conflicting: boolean;
    }
  | {
      kind: 'RECEIPT';
      receipt: ReceiptRow;
      loanReference: string;
      rule: 'BANK_REFERENCE' | 'CLAIM_AMOUNT';
      reason: string;
    }
  | {
      kind: 'LOAN';
      loanId: string;
      loanReference: string;
      rule: 'LOAN_REFERENCE' | 'INSTALMENT_AMOUNT';
      reason: string;
    }
  | { kind: 'SUSPENSE'; reason: string; suggestions: string[] };

interface LineResult {
  id: string;
  line: Line;
  outcome: 'POSTED' | 'SUSPENSE' | 'DUPLICATE';
  reason: string;
  loanAccountId: string | null;
  loanRef: string | null;
  financialEventId: string | null;
  unidentifiedPaymentId: string | null;
  duplicateOfLineId: string | null;
  conflicting: boolean;
}

/**
 * Bank and Bakong merchant statements (D-160…D-165, UC-18 for KHQR): the
 * lender's export of what reached its account, imported as a file. Each
 * credit line is matched — the bank reference of a recorded receipt first,
 * then the matching rules of `lending.matchStatementLine` — and either posted
 * as a repayment with channel KHQR (exact matches, when the lender's
 * `payments.khqr.statementAutoPost` is on), or held in unidentified-payments
 * suspense with the reason and the likely loans. A matched line held because
 * auto-posting is off waits as a receipt for a second person to verify.
 *
 * Imported once per file content and once per bank reference: a repeated
 * file returns the first import; a reference already on an earlier statement
 * or already posted from a receipt is a duplicate and applies nothing. The
 * file is one transaction: imported completely or not at all.
 */
@Injectable()
export class KhqrStatementsService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
    private readonly suspense: SuspenseService,
    private readonly settings: TenantSettingsService,
    private readonly files: ChannelFilesService,
    private readonly receipts: KhqrReceiptsService,
  ) {}

  /** The column mappings this lender can import with. */
  async mappings(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'payment.channel.read',
      tenantResource(tenantId),
    );
    const s = await this.settings.get(tenantId);
    return {
      autoPost: s.payments.khqr.statementAutoPost,
      claimMatchWindowDays: s.payments.khqr.claimMatchWindowDays,
      mappings: lending.statementMappingsOf(s),
    };
  }

  async importStatement(actor: LendingActor, body: StatementBody) {
    const tenantId = requireTenant(actor);
    const fileHash = requestHash({
      kind: 'KHQR_STATEMENT',
      mapping: body.mapping,
      currency: body.currency ?? null,
      content: body.content
        ? lending.normalizeFileText(body.content)
        : (body.contentBase64 ?? ''),
    });
    const result = await this.lp.tenantTx(
      tenantId,
      async (tx) => {
        await this.policy.enforce(
          actor,
          'payment.channel_file.import',
          tenantResource(tenantId),
          tx,
        );
        const already = await tx.channelFile.findFirst({
          where: { tenantId, kind: 'KHQR_STATEMENT', fileHash },
        });
        if (already && !body.dryRun)
          return { replayed: true, fileId: already.id };
        const settings = await this.settings.get(tenantId, tx);
        const parsed = this.parse(body, settings);
        const businessDate = await this.businessDate.get(tenantId, tx);
        const errors = [...parsed.errors];
        for (const l of parsed.lines) {
          try {
            BusinessDateService.checkValueDate(
              l.valueDate,
              businessDate,
              settings.payments.maxBackdateDays,
            );
          } catch (e) {
            errors.push({ lineNo: l.lineNo, message: (e as Error).message });
          }
        }
        if (errors.length)
          throw new BadRequestException({
            message: `The statement has ${errors.length} error(s); nothing was imported. Correct them and send the whole file again.`,
            code: 'FILE_INVALID',
            issues: errors
              .sort((a, b) => a.lineNo - b.lineNo)
              .slice(0, 200)
              .map((e) => ({ path: `line ${e.lineNo}`, message: e.message })),
          });
        const ctx = {
          tenantId,
          businessDate,
          autoPost: settings.payments.khqr.statementAutoPost,
          windowDays: settings.payments.khqr.claimMatchWindowDays,
          ignoredTitles: settings.aml.screening.ignoredTitles ?? [],
        };

        // A dry run decides every line and writes nothing.
        if (body.dryRun) {
          const preview: unknown[] = [];
          for (const line of parsed.lines) {
            const d = await this.decide(tx, ctx, line, new Map());
            preview.push(this.previewOf(line, d, ctx.autoPost));
          }
          return {
            dryRun: true as const,
            mapping: parsed.mapping,
            columns: parsed.columns,
            skipped: parsed.skipped,
            totals: parsed.totals,
            autoPost: ctx.autoPost,
            lines: preview,
          };
        }

        const results: LineResult[] = [];
        const idByLineNo = new Map<number, string>();
        for (const line of parsed.lines) {
          const id = randomUUID();
          idByLineNo.set(line.lineNo, id);
          const d = await this.decide(tx, ctx, line, idByLineNo);
          results.push(
            await this.apply(tx, actor, ctx, body.fileName, fileHash, id, line, d),
          );
        }
        const count = (o: string) =>
          results.filter((r) => r.outcome === o).length;
        const file = await tx.channelFile.create({
          data: {
            tenantId,
            kind: 'KHQR_STATEMENT',
            channel: 'KHQR',
            fileName: body.fileName.slice(0, 200),
            fileHash,
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
            channel: 'KHQR',
            channelTxnId: r.line.bankRef,
            dedupeKey:
              r.outcome === 'DUPLICATE' ? null : `KHQR:${r.line.bankRefKey}`,
            reference: r.line.remark.slice(0, 500),
            loanRef: r.loanRef,
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
        const summary = {
          fileId: file.id,
          lines: results.length,
          posted: file.postedCount,
          suspense: file.suspenseCount,
          duplicates: file.duplicateCount,
          skipped: parsed.skipped.length,
          mapping: parsed.mapping,
        };
        await this.servicing.outbox(
          tx,
          tenantId,
          'lending.channel_file.imported',
          { ...summary, kind: 'KHQR_STATEMENT', channel: 'KHQR' },
        );
        await this.audit.write(
          {
            actor,
            action: 'payment.channel_file.import',
            resourceType: 'ChannelFile',
            resourceId: file.id,
            outcome: 'SUCCESS',
            details: {
              ...summary,
              kind: 'KHQR_STATEMENT',
              fileName: body.fileName,
              totals: parsed.totals,
              autoPost: ctx.autoPost,
            },
            businessDate: fromLocalDate(businessDate),
          },
          tx,
        );
        return { replayed: false, fileId: file.id, skipped: parsed.skipped };
      },
      { timeoutMs: 600_000 },
    );
    if ('dryRun' in result) return result;
    return {
      replayed: result.replayed,
      skipped: 'skipped' in result ? result.skipped : [],
      ...(await this.files.get(actor, result.fileId)),
    };
  }

  // ── Parsing ──────────────────────────────────────────────────────────────

  private parse(
    body: StatementBody,
    settings: lending.TenantLendingSettings,
  ): lending.ParsedStatement {
    const mapping = lending
      .statementMappingsOf(settings)
      .find((m) => m.code === body.mapping);
    if (!mapping)
      throw new BadRequestException(
        `Unknown statement mapping ${body.mapping}.`,
      );
    const opts = {
      currency: body.currency ?? null,
      maxLines: settings.payments.maxFileLines,
    };
    if (body.content)
      return engineCall(() =>
        lending.parseStatementCsv(body.content!, mapping, opts),
      );
    let rows: { lineNo: number; cells: string[] }[];
    try {
      rows = readXlsxRows(Buffer.from(body.contentBase64!, 'base64'), {
        maxPartBytes: 40 * 1024 * 1024,
        // Room for the header, notes and skipped (money-out) rows.
        maxRows: settings.payments.maxFileLines * 2 + 20,
      });
    } catch (e) {
      throw new BadRequestException(
        `The spreadsheet could not be read: ${(e as Error).message} Save it as .xlsx or CSV and try again.`,
      );
    }
    return engineCall(() => lending.parseStatementRows(rows, mapping, opts));
  }

  // ── Deciding a line ──────────────────────────────────────────────────────

  private async decide(
    tx: Tx,
    ctx: {
      tenantId: string;
      businessDate: string;
      windowDays: number;
      ignoredTitles: readonly string[];
    },
    line: Line,
    idByLineNo: Map<number, string>,
  ): Promise<Decision> {
    const { tenantId } = ctx;
    if (line.duplicateOf !== null)
      return {
        kind: 'DUPLICATE',
        reason: `Repeats line ${line.duplicateOf} of this file.`,
        duplicateOfLineId: idByLineNo.get(line.duplicateOf) ?? null,
        conflicting: false,
      };
    const earlier = await tx.channelFileLine.findFirst({
      where: { tenantId, dedupeKey: `KHQR:${line.bankRefKey}` },
    });
    if (earlier) {
      const same =
        D(earlier.amount).eq(D(line.amount)) &&
        earlier.currency === line.currency;
      return {
        kind: 'DUPLICATE',
        reason: same
          ? `Already imported (line ${earlier.lineNo} of an earlier statement).`
          : `Reference already imported (line ${earlier.lineNo} of an earlier statement) for a different amount; nothing applied.`,
        duplicateOfLineId: earlier.id,
        conflicting: !same,
      };
    }
    const receipt = await tx.khqrReceipt.findFirst({
      where: {
        tenantId,
        bankRefKey: line.bankRefKey,
        status: { not: 'REJECTED' },
      },
    });
    if (receipt) {
      const loanRef = await this.loanRef(tx, tenantId, receipt.loanAccountId);
      const check = lending.lineConfirmsReceipt(line, {
        amount: D(receipt.amount).toString(),
        currency: receipt.currency,
      });
      if (receipt.status === 'POSTED')
        return {
          kind: 'DUPLICATE',
          reason: `Already applied to loan ${loanRef} from receipt ${receipt.reference}.`,
          duplicateOfLineId: null,
          conflicting: !check.ok,
        };
      if (!check.ok)
        return {
          kind: 'SUSPENSE',
          reason: `${check.reason} Held for a person to decide (receipt ${receipt.reference}).`,
          suggestions: [loanRef],
        };
      return {
        kind: 'RECEIPT',
        receipt,
        loanReference: loanRef,
        rule: 'BANK_REFERENCE',
        reason: `Confirms receipt ${receipt.reference} (same bank reference) on loan ${loanRef}.`,
      };
    }

    // The matching rules (D-161).
    const candidates = await this.candidates(tx, ctx, line);
    const m = lending.matchStatementLine(line, candidates, ctx.windowDays);
    if (m.kind === 'NONE')
      return {
        kind: 'SUSPENSE',
        reason: m.suggestions.length
          ? `${m.reason} Possible loans: ${m.suggestions.join(', ')}.`
          : m.reason,
        suggestions: m.suggestions,
      };
    if (m.kind === 'RECEIPT') {
      const r = await tx.khqrReceipt.findFirstOrThrow({
        where: { tenantId, id: m.receiptId },
      });
      return {
        kind: 'RECEIPT',
        receipt: r,
        loanReference: await this.loanRef(tx, tenantId, r.loanAccountId),
        rule: 'CLAIM_AMOUNT',
        reason: m.reason,
      };
    }
    return {
      kind: 'LOAN',
      loanId: m.loanId,
      loanReference: await this.loanRef(tx, tenantId, m.loanId),
      rule: m.rule,
      reason: m.reason,
    };
  }

  private async candidates(
    tx: Tx,
    ctx: { tenantId: string; businessDate: string; ignoredTitles: readonly string[] },
    line: Line,
  ): Promise<lending.MatchCandidates> {
    const { tenantId } = ctx;
    const refs = lending.loanRefCandidates(line.remark);
    const loansInRemark = (
      refs.length
        ? await tx.loanAccount.findMany({
            where: { tenantId, reference: { in: refs } },
            select: { id: true, reference: true, status: true, currency: true },
          })
        : []
    ).map(({ id, ...l }) => ({ loanId: id, ...l }));

    // The payer: by phone (blind index of each spelling), else by name.
    const phones = [
      ...lending.phoneVariants(line.payerAccount),
      ...lending.phoneVariants(line.payerName),
    ];
    const byPhone = phones.length
      ? await tx.borrower.findMany({
          where: {
            tenantId,
            phoneHash: {
              in: phones.map((p) => blindIndex(p, 'phone') as string),
            },
          },
          select: { id: true },
        })
      : [];
    let byName: { id: string }[] = [];
    if (line.payerName) {
      const tokens = lending.normalizeNameTokens(
        line.payerName,
        ctx.ignoredTitles,
      );
      if (tokens.length >= 2 && tokens.length <= 4) {
        const pairs: { firstName: object; lastName: object }[] = [];
        for (const a of tokens)
          for (const b of tokens)
            if (a !== b)
              pairs.push({
                firstName: { equals: a, mode: 'insensitive' },
                lastName: { equals: b, mode: 'insensitive' },
              });
        const rows = await tx.borrower.findMany({
          where: { tenantId, OR: pairs as Prisma.BorrowerWhereInput[] },
          select: { id: true, firstName: true, lastName: true },
          take: 20,
        });
        byName = rows.filter((b) =>
          lending.sameName(
            `${b.firstName} ${b.lastName}`,
            line.payerName,
            ctx.ignoredTitles,
          ),
        );
      }
    }
    const payerIds = new Set([...byPhone, ...byName].map((b) => b.id));
    const payers: lending.MatchCandidates['payers'] = [];
    for (const [list, by] of [
      [byPhone, 'PHONE'],
      [byName, 'NAME'],
    ] as const)
      for (const b of list) {
        const loans = await tx.loanAccount.findMany({
          where: {
            tenantId,
            borrowerId: b.id,
            status: 'ACTIVE',
            currency: line.currency,
          },
          select: {
            id: true,
            reference: true,
            currency: true,
            instalments: {
              where: { status: 'DUE' },
              orderBy: { dueDate: 'asc' },
            },
          },
        });
        payers.push({
          borrowerId: b.id,
          by,
          loans: loans.map((l) => ({
            loanId: l.id,
            reference: l.reference,
            currency: l.currency,
            amountsDue: this.amountsDue(l.instalments, ctx.businessDate),
          })),
        });
      }

    // Pending receipts of the same amount and currency, not yet backed by a statement.
    const pending = await tx.khqrReceipt.findMany({
      where: {
        tenantId,
        status: 'PENDING',
        currency: line.currency,
        amount: line.amount,
        unidentifiedPaymentId: null,
      },
      take: 50,
    });
    const pendingReceipts: lending.MatchCandidates['pendingReceipts'] = [];
    for (const r of pending)
      pendingReceipts.push({
        receiptId: r.id,
        loanId: r.loanAccountId,
        loanReference: await this.loanRef(tx, tenantId, r.loanAccountId),
        amount: D(r.amount).toString(),
        currency: r.currency,
        valueDate: toLocalDate(r.valueDate)!,
        payerIsBorrower: payerIds.has(r.borrowerId),
      });
    return { loansInRemark, pendingReceipts, payers };
  }

  /** What a payment of an exact amount could be for: the next instalment, all that is overdue, or both. */
  private amountsDue(
    lines: Parameters<typeof outstanding>[0][],
    businessDate: string,
  ): string[] {
    const owed = (l: Parameters<typeof outstanding>[0]) =>
      Object.values(outstanding(l)).reduce((s, v) => s.plus(v), D(0));
    const open = lines.filter((l) => owed(l).gt(0));
    const overdue = open.filter(
      (l) => toLocalDate((l as { dueDate: Date }).dueDate)! <= businessDate,
    );
    const next = open.find(
      (l) => toLocalDate((l as { dueDate: Date }).dueDate)! > businessDate,
    );
    const overdueTotal = overdue.reduce((s, l) => s.plus(owed(l)), D(0));
    const out = new Set<string>();
    if (overdue[0]) out.add(owed(overdue[0]).toString());
    if (overdueTotal.gt(0)) out.add(overdueTotal.toString());
    if (next) {
      out.add(owed(next).toString());
      if (overdueTotal.gt(0)) out.add(overdueTotal.plus(owed(next)).toString());
    }
    return [...out];
  }

  // ── Applying a decision ──────────────────────────────────────────────────

  private async apply(
    tx: Tx,
    actor: LendingActor,
    ctx: { tenantId: string; autoPost: boolean; businessDate: string },
    fileName: string,
    fileHash: string,
    id: string,
    line: Line,
    d: Decision,
  ): Promise<LineResult> {
    const base: LineResult = {
      id,
      line,
      outcome: 'DUPLICATE',
      reason: '',
      loanAccountId: null,
      loanRef: null,
      financialEventId: null,
      unidentifiedPaymentId: null,
      duplicateOfLineId: null,
      conflicting: false,
    };
    if (d.kind === 'DUPLICATE')
      return {
        ...base,
        reason: d.reason,
        duplicateOfLineId: d.duplicateOfLineId,
        conflicting: d.conflicting,
      };
    const hash = requestHash({ op: 'khqr-line', fileHash, lineNo: line.lineNo });
    const key = `sys:khqr-line:${id}`;
    const components = {
      khqr: {
        source: 'STATEMENT',
        bankRef: line.bankRef,
        file: fileName,
        lineNo: line.lineNo,
        statementLineId: id,
      },
    };
    let reason = d.reason;
    if (ctx.autoPost && (d.kind === 'RECEIPT' || d.kind === 'LOAN')) {
      // A refused repayment must leave no trace before the line goes to suspense.
      await tx.$executeRaw`SAVEPOINT khqr_line`;
      try {
        const event =
          d.kind === 'RECEIPT'
            ? await this.receipts.postInTx(tx, actor, d.receipt, {
                idempotencyKey: key,
                hash,
                statementLineId: id,
                decidedBy: 'system:bank-statement',
                note: `Confirmed by bank statement ${fileName} line ${line.lineNo}.`,
              })
            : await this.servicing.repayInTx(
                tx,
                actor,
                d.loanId,
                {
                  amount: line.amount,
                  valueDate: await this.postingDate(tx, ctx, d.loanId, line),
                  externalReference: `KHQR ${line.bankRef}`.slice(0, 120),
                  channel: 'KHQR',
                },
                key,
                hash,
                {
                  components: {
                    khqr: { ...components.khqr, paidOn: line.valueDate },
                    rule: d.rule,
                  },
                },
              );
        await tx.$executeRaw`RELEASE SAVEPOINT khqr_line`;
        return {
          ...base,
          outcome: 'POSTED',
          reason,
          loanAccountId:
            d.kind === 'RECEIPT' ? d.receipt.loanAccountId : d.loanId,
          loanRef: d.loanReference,
          financialEventId: event.id,
        };
      } catch (e) {
        if (
          !(e instanceof HttpException) &&
          (e as Error).name !== 'EngineError'
        )
          throw e;
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT khqr_line`;
        reason = `Loan ${d.loanReference} refused the payment: ${(e as Error).message}`;
      }
    }
    // Held in suspense: unmatched, refused, or matched and waiting for a
    // second person because auto-posting is off.
    const held = await this.suspense.receiveInTx(
      tx,
      actor,
      {
        amount: line.amount,
        currency: line.currency,
        valueDate: line.valueDate,
        channel: 'KHQR',
        externalReference: `KHQR ${line.bankRef}`.slice(0, 120),
        payerName: line.payerName ?? undefined,
        narrative:
          `Bank statement ${fileName} line ${line.lineNo}${line.remark ? ` ("${line.remark}")` : ''}: ${reason}`.slice(
            0,
            500,
          ),
      },
      `sys:khqr-suspense:${id}`,
      hash,
    );
    const waiting = !ctx.autoPost && (d.kind === 'RECEIPT' || d.kind === 'LOAN');
    if (waiting && d.kind === 'RECEIPT') {
      await tx.khqrReceipt.updateMany({
        where: { id: d.receipt.id, tenantId: ctx.tenantId, status: 'PENDING' },
        data: { statementLineId: id, unidentifiedPaymentId: held.id },
      });
      reason = `${reason} Waiting for verification (auto-posting is off).`;
    }
    if (waiting && d.kind === 'LOAN') {
      const loan = await tx.loanAccount.findFirstOrThrow({
        where: { tenantId: ctx.tenantId, id: d.loanId },
        select: { id: true, borrowerId: true, branchId: true, currency: true },
      });
      const r = await tx.khqrReceipt.create({
        data: {
          tenantId: ctx.tenantId,
          reference: newReference('QRR'),
          loanAccountId: loan.id,
          borrowerId: loan.borrowerId,
          branchId: loan.branchId,
          source: 'STATEMENT',
          amount: line.amount,
          currency: line.currency,
          paidAt: fromLocalDate(line.valueDate),
          valueDate: fromLocalDate(line.valueDate),
          bankRef: line.bankRef,
          bankRefKey: line.bankRefKey,
          payerName: line.payerName,
          payerAccount: line.payerAccount,
          remark: line.remark,
          statementLineId: id,
          unidentifiedPaymentId: held.id,
          makerType: 'STAFF',
          makerId: actor.id,
        },
      });
      reason = `${reason} Waiting for verification as receipt ${r.reference} (auto-posting is off).`;
    }
    return {
      ...base,
      outcome: 'SUSPENSE',
      reason,
      loanRef:
        waiting && (d.kind === 'RECEIPT' || d.kind === 'LOAN')
          ? d.loanReference
          : null,
      unidentifiedPaymentId: held.id,
    };
  }

  /** The line's date, within the back-dating the loan's product allows (D-162). */
  private async postingDate(
    tx: Tx,
    ctx: { tenantId: string; businessDate: string },
    loanId: string,
    line: Line,
  ) {
    const state = await loadLoanState(tx, ctx.tenantId, loanId, { lock: false });
    return lending.khqrPostingDate(
      line.valueDate,
      ctx.businessDate,
      state.config.repayment.maxBackdateDays,
    );
  }

  private previewOf(line: Line, d: Decision, autoPost: boolean) {
    const loanReference =
      d.kind === 'RECEIPT' || d.kind === 'LOAN' ? d.loanReference : null;
    return {
      lineNo: line.lineNo,
      valueDate: line.valueDate,
      amount: line.amount,
      currency: line.currency,
      bankRef: line.bankRef,
      payerName: line.payerName,
      payerAccount: line.payerAccount,
      remark: line.remark,
      proposed:
        d.kind === 'DUPLICATE'
          ? 'DUPLICATE'
          : d.kind === 'SUSPENSE'
            ? 'SUSPENSE'
            : autoPost
              ? 'POST'
              : 'HOLD_FOR_VERIFICATION',
      rule: d.kind === 'RECEIPT' || d.kind === 'LOAN' ? d.rule : null,
      loanReference,
      reason: d.reason,
    };
  }

  private async loanRef(tx: Tx, tenantId: string, id: string) {
    const l = await tx.loanAccount.findFirst({
      where: { tenantId, id },
      select: { reference: true },
    });
    return l?.reference ?? '';
  }
}
