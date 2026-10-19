import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { publicExplanation } from '../policy/decision';
import { tenantResource } from '../policy/resources';
import { PostingService, PostingLine } from './posting.service';
import { LendingOperationsService } from './operations.service';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { MONTH_NAMES, periodLabel } from './period-lock';

type Json = Prisma.InputJsonValue;

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';
export interface CloseCheck {
  code: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Where in the workspace the item is fixed. */
  link?: string;
}

/** Money approvals that, left pending, would cross into the next month. */
const MONEY_TASKS = [
  'DISBURSEMENT',
  'WRITE_OFF',
  'SET_OFF',
  'ADVANCE_REFUND',
  'DOWN_PAYMENT_REFUND',
  'SUSPENSE_REFUND',
  'COLLATERAL_RELEASE',
];

/** The per-loan grades are kept for the regulatory return, not shown on the close screen. */
function withoutLoanGrades(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const { loanGrades, ...rest } = snapshot as Record<string, unknown>;
  const grades = loanGrades as { asOf?: string; loans?: unknown[] } | undefined;
  return grades
    ? {
        ...rest,
        loanGrades: { asOf: grades.asOf, count: grades.loans?.length ?? 0 },
      }
    : rest;
}

export function monthBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = lending.addDays(lending.addMonths(start, 1), -1);
  return { start, end };
}

/** The actor end of day prepares a month-end close as; a person approves it. */
export function periodCloseActor(tenantId: string): LendingActor {
  return {
    id: 'system:period-close',
    type: 'SERVICE',
    tenantId,
    assurance: 'SERVICE_KEY',
    channel: 'SYSTEM',
    scopes: ['accounting.read', 'accounting.period.close', 'loan.read'],
  };
}

/**
 * Month-end and year-end close of the lending ledger (OPS-6), the way core
 * banking systems run them: a frequency stage of end of day.
 *
 * - A month is prepared once end of day has processed its last day: checks
 *   (books balance, sub-ledgers reconcile, every day processed, the month
 *   before closed) and a snapshot of the books and the portfolio are stored.
 * - A second person approves; the month is then locked. Nothing is posted
 *   into a locked month — the posting service refuses it and a database
 *   trigger refuses it again.
 * - A month can be reopened only under maker-checker, latest month first,
 *   and never once its year is closed.
 * - Year end carries every income and expense account into retained earnings
 *   with a balanced journal dated the last day of the year, per currency.
 */
@Injectable()
export class PeriodCloseService {
  private readonly logger = new Logger(PeriodCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly posting: PostingService,
    private readonly ops: LendingOperationsService,
    private readonly settings: TenantSettingsService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  private async firstActivity(tx: Tx, tenantId: string) {
    const first = await tx.lendingJournalEntry.findFirst({
      where: { tenantId },
      orderBy: { entryDate: 'asc' },
      select: { entryDate: true },
    });
    return first ? toLocalDate(first.entryDate)! : null;
  }

  private async can(
    actor: LendingActor,
    action: string,
    makerIds: string[] = [],
  ) {
    const tenantId = requireTenant(actor);
    const d = publicExplanation(
      await this.policy.decide(
        actor,
        action,
        tenantResource(tenantId, 'TENANT', tenantId, makerIds),
      ),
    );
    return {
      allowed: d.allowed,
      reason: d.blockedBy.map((b) => b.message).join(' '),
    };
  }

  /** The year at a glance: each month's state, the year's state, and what the viewer may do. */
  async overview(actor: LendingActor, year?: number) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'accounting.read',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const businessDate = await this.businessDate.get(tenantId, tx);
      const y = year ?? Number(businessDate.slice(0, 4));
      const [rows, first, bd] = await Promise.all([
        tx.accountingPeriod.findMany({ where: { tenantId, year: y } }),
        this.firstActivity(tx, tenantId),
        tx.tenantBusinessDate.findUnique({ where: { tenantId } }),
      ]);
      const byMonth = new Map(rows.map((r) => [r.month, r]));
      const months = Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        const { start, end } = monthBounds(y, month);
        const row = byMonth.get(month);
        let status: string = row?.status ?? 'OPEN';
        if (!row) {
          if (lending.compareDates(start, businessDate) > 0) status = 'FUTURE';
          else if (!first || lending.compareDates(end, first) < 0)
            status = 'NO_ACTIVITY';
          else if (lending.compareDates(end, businessDate) > 0)
            status = 'CURRENT';
        }
        const checks = (row?.checks ?? []) as unknown as CloseCheck[];
        return {
          month,
          label: MONTH_NAMES[i],
          start,
          end,
          status,
          preparedBy: row?.preparedBy ?? null,
          preparedAt: row?.preparedAt ?? null,
          approvedBy: row?.approvedBy ?? null,
          closedAt: row?.closedAt ?? null,
          reopenCount: row?.reopenCount ?? 0,
          warnings: checks.filter((c) => c.status === 'WARN').length,
        };
      });
      const yearRow = byMonth.get(0);
      const lastClosed = await tx.accountingPeriod.findFirst({
        where: { tenantId, month: { gt: 0 }, status: 'CLOSED' },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      return {
        businessDate,
        lastEndOfDay: bd?.lastBatchDate ? toLocalDate(bd.lastBatchDate) : null,
        lastEndOfDayFailures: bd?.lastBatchFailures ?? 0,
        firstActivity: first,
        year: y,
        months,
        yearClose: {
          status: yearRow?.status ?? 'OPEN',
          preparedBy: yearRow?.preparedBy ?? null,
          approvedBy: yearRow?.approvedBy ?? null,
          closedAt: yearRow?.closedAt ?? null,
          closingEventIds: yearRow?.closingEventIds ?? [],
        },
        lastClosed: lastClosed
          ? {
              year: lastClosed.year,
              month: lastClosed.month,
              label: periodLabel(lastClosed.year, lastClosed.month),
            }
          : null,
        permissions: {
          prepare: await this.can(actor, 'accounting.period.close'),
          approve: await this.can(actor, 'accounting.period.approve'),
        },
      };
    });
  }

  /** One month: the close checks (live until it is locked), the snapshot and the history. */
  async month(actor: LendingActor, year: number, month: number) {
    const tenantId = requireTenant(actor);
    this.validMonth(year, month);
    await this.policy.enforce(
      actor,
      'accounting.read',
      tenantResource(tenantId),
    );
    const live = await this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.accountingPeriod.findFirst({
        where: { tenantId, year, month },
        include: { log: { orderBy: { createdAt: 'asc' } } },
      });
      const { start, end } = monthBounds(year, month);
      const locked =
        row?.status === 'CLOSED' || row?.status === 'REOPEN_PENDING';
      const snapshot =
        locked || row?.status === 'PENDING'
          ? row.snapshot
          : await this.snapshot(tx, tenantId, start, end);
      return { row, start, end, locked, snapshot };
    });
    const checks = live.locked
      ? ((live.row!.checks ?? []) as unknown as CloseCheck[])
      : await this.checks(actor, year, month);
    const makerIds = [live.row?.reopenRequestedBy, live.row?.preparedBy].filter(
      (x): x is string => !!x,
    );
    return {
      year,
      month,
      label: periodLabel(year, month),
      start: live.start,
      end: live.end,
      status: live.row?.status ?? 'OPEN',
      preparedBy: live.row?.preparedBy ?? null,
      preparedAt: live.row?.preparedAt ?? null,
      approvedBy: live.row?.approvedBy ?? null,
      closedAt: live.row?.closedAt ?? null,
      reopenReason: live.row?.reopenReason ?? '',
      reopenRequestedBy: live.row?.reopenRequestedBy ?? null,
      checks,
      ready: checks.every((c) => c.status !== 'FAIL'),
      snapshot: withoutLoanGrades(live.snapshot),
      snapshotIsPreview: !live.row || live.row.status === 'OPEN',
      log: live.row?.log ?? [],
      permissions: {
        prepare: await this.can(actor, 'accounting.period.close'),
        approve: await this.can(actor, 'accounting.period.approve', makerIds),
      },
    };
  }

  private validMonth(year: number, month: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2200)
      throw new BadRequestException('Give a year between 2000 and 2200.');
    if (!Number.isInteger(month) || month < 1 || month > 12)
      throw new BadRequestException('Give a month from 1 to 12.');
  }

  // ── Checks and snapshot ───────────────────────────────────────────────────

  /** What has to be true before a month can be locked. FAIL blocks; WARN is shown to the approver. */
  async checks(
    actor: LendingActor,
    year: number,
    month: number,
  ): Promise<CloseCheck[]> {
    const tenantId = requireTenant(actor);
    const { start, end } = monthBounds(year, month);
    const out: CloseCheck[] = [];
    const add = (c: CloseCheck) => out.push(c);
    const facts = await this.lp.tenantTx(tenantId, async (tx) => {
      const [
        businessDate,
        bd,
        first,
        prevRow,
        active,
        entries,
        tasks,
        suspense,
      ] = await Promise.all([
        this.businessDate.get(tenantId, tx),
        tx.tenantBusinessDate.findUnique({ where: { tenantId } }),
        this.firstActivity(tx, tenantId),
        tx.accountingPeriod.findFirst({
          where: {
            tenantId,
            ...(month === 1
              ? { year: year - 1, month: 12 }
              : { year, month: month - 1 }),
          },
        }),
        tx.loanAccount.count({ where: { tenantId, status: 'ACTIVE' } }),
        tx.lendingJournalEntry.groupBy({
          by: ['currency'],
          where: { tenantId, entryDate: { lte: fromLocalDate(end) } },
          _count: { _all: true },
        }),
        tx.approvalTask.count({
          where: {
            tenantId,
            action: { in: MONEY_TASKS },
            status: { in: ['PENDING', 'APPROVED'] },
          },
        }),
        tx.unidentifiedPayment.count({
          where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_MATCHED'] } },
        }),
      ]);
      const balances: { currency: string; debit: string; credit: string }[] =
        [];
      for (const { currency } of entries) {
        const s = await tx.lendingJournalLine.aggregate({
          where: {
            tenantId,
            entry: { currency, entryDate: { lte: fromLocalDate(end) } },
          },
          _sum: { debit: true, credit: true },
        });
        balances.push({
          currency,
          debit: D(s._sum.debit ?? 0).toString(),
          credit: D(s._sum.credit ?? 0).toString(),
        });
      }
      return {
        businessDate,
        bd,
        first,
        prevRow,
        active,
        balances,
        tasks,
        suspense,
      };
    });

    add(
      lending.compareDates(facts.businessDate, end) >= 0
        ? {
            code: 'BUSINESS_DATE',
            label: 'Business date has reached month end',
            status: 'PASS',
            detail: `Business date ${facts.businessDate}.`,
          }
        : {
            code: 'BUSINESS_DATE',
            label: 'Business date has reached month end',
            status: 'FAIL',
            detail: `The business date is ${facts.businessDate}; the month ends ${end}.`,
            link: '/lending/operations',
          },
    );
    const lastRun = facts.bd?.lastBatchDate
      ? toLocalDate(facts.bd.lastBatchDate)!
      : null;
    const eodDone =
      facts.active === 0 ||
      (lastRun !== null && lending.compareDates(lastRun, end) >= 0);
    add(
      !eodDone
        ? {
            code: 'END_OF_DAY',
            label: 'End of day processed every day of the month',
            status: 'FAIL',
            detail: lastRun
              ? `End of day last ran for ${lastRun}.`
              : 'End of day has not run for the whole book yet.',
            link: '/lending/operations',
          }
        : facts.bd &&
            facts.bd.lastBatchFailures > 0 &&
            lastRun === facts.businessDate
          ? {
              code: 'END_OF_DAY',
              label: 'End of day processed every day of the month',
              status: 'FAIL',
              detail: `${facts.bd.lastBatchFailures} account(s) failed in the last end of day; rerun it.`,
              link: '/lending/operations',
            }
          : {
              code: 'END_OF_DAY',
              label: 'End of day processed every day of the month',
              status: 'PASS',
              detail:
                facts.active === 0
                  ? 'No active loans.'
                  : `Last run ${lastRun}, no failures.`,
            },
    );
    const prevNeeded =
      facts.first !== null && lending.compareDates(facts.first, start) < 0;
    add(
      !prevNeeded || facts.prevRow?.status === 'CLOSED'
        ? {
            code: 'PREVIOUS_MONTH',
            label: 'Previous month is closed',
            status: 'PASS',
            detail: prevNeeded
              ? 'Closed.'
              : 'This is the first month with activity.',
          }
        : {
            code: 'PREVIOUS_MONTH',
            label: 'Previous month is closed',
            status: 'FAIL',
            detail:
              'Months are closed in order; close the previous month first.',
          },
    );
    const unbalanced = facts.balances.filter(
      (b) => !D(b.debit).eq(D(b.credit)),
    );
    add(
      unbalanced.length
        ? {
            code: 'BOOKS_BALANCE',
            label: 'Debits equal credits',
            status: 'FAIL',
            detail: unbalanced
              .map((b) => `${b.currency}: ${b.debit} ≠ ${b.credit}`)
              .join('; '),
            link: '/lending/accounting',
          }
        : {
            code: 'BOOKS_BALANCE',
            label: 'Debits equal credits',
            status: 'PASS',
            detail: facts.balances.length
              ? facts.balances
                  .map((b) => `${b.currency} ${b.debit}`)
                  .join(' · ')
              : 'No postings yet.',
          },
    );
    try {
      const rec = await this.ops.reconciliation(actor);
      add(
        rec.breaks.length
          ? {
              code: 'RECONCILIATION',
              label: 'Sub-ledgers reconcile to the ledger',
              status: 'FAIL',
              detail: `${rec.breaks.length} break(s) — see Accounting › Reconciliation.`,
              link: '/lending/accounting',
            }
          : {
              code: 'RECONCILIATION',
              label: 'Sub-ledgers reconcile to the ledger',
              status: 'PASS',
              detail: 'No breaks.',
            },
      );
    } catch (e) {
      add({
        code: 'RECONCILIATION',
        label: 'Sub-ledgers reconcile to the ledger',
        status: 'FAIL',
        detail: (e as Error).message,
      });
    }
    add(
      facts.tasks
        ? {
            code: 'PENDING_APPROVALS',
            label: 'No money approvals left waiting',
            status: 'WARN',
            detail: `${facts.tasks} disbursement, write-off, refund or set-off approval(s) are still open; they will post in a later month.`,
          }
        : {
            code: 'PENDING_APPROVALS',
            label: 'No money approvals left waiting',
            status: 'PASS',
            detail: 'None open.',
          },
    );
    add(
      facts.suspense
        ? {
            code: 'SUSPENSE',
            label: 'Unidentified payments cleared',
            status: 'WARN',
            detail: `${facts.suspense} unidentified payment(s) still in suspense.`,
            link: '/lending/suspense',
          }
        : {
            code: 'SUSPENSE',
            label: 'Unidentified payments cleared',
            status: 'PASS',
            detail: 'Suspense is empty.',
          },
    );
    return out;
  }

  /** The books and the portfolio at month end, kept with the close. */
  async snapshot(tx: Tx, tenantId: string, start: string, end: string) {
    const accounts = await tx.ledgerAccount.findMany({
      where: { tenantId },
      select: { code: true, name: true, type: true },
    });
    const meta = new Map(accounts.map((a) => [a.code, a]));
    const currencies = await tx.lendingJournalEntry.groupBy({
      by: ['currency'],
      where: { tenantId, entryDate: { lte: fromLocalDate(end) } },
    });
    const trialBalance: {
      currency: string;
      accountCode: string;
      name: string;
      type: string;
      debit: string;
      credit: string;
    }[] = [];
    const month: Record<string, Record<string, string>> = {};
    for (const { currency } of currencies) {
      const tb = await tx.lendingJournalLine.groupBy({
        by: ['accountCode'],
        where: {
          tenantId,
          entry: { currency, entryDate: { lte: fromLocalDate(end) } },
        },
        _sum: { debit: true, credit: true },
        orderBy: { accountCode: 'asc' },
      });
      for (const l of tb) {
        const net = D(l._sum.debit ?? 0).minus(D(l._sum.credit ?? 0));
        if (net.isZero()) continue;
        trialBalance.push({
          currency,
          accountCode: l.accountCode,
          name: meta.get(l.accountCode)?.name ?? l.accountCode,
          type: meta.get(l.accountCode)?.type ?? '',
          debit: net.gt(0) ? net.toString() : '0',
          credit: net.lt(0) ? net.negated().toString() : '0',
        });
      }
      const inMonth = await tx.lendingJournalLine.groupBy({
        by: ['accountCode'],
        where: {
          tenantId,
          entry: {
            currency,
            entryDate: { gte: fromLocalDate(start), lte: fromLocalDate(end) },
          },
        },
        _sum: { debit: true, credit: true },
      });
      let income = D(0);
      let expense = D(0);
      for (const l of inMonth) {
        const t = meta.get(l.accountCode)?.type;
        if (t === 'INCOME')
          income = income
            .plus(D(l._sum.credit ?? 0))
            .minus(D(l._sum.debit ?? 0));
        if (t === 'EXPENSE')
          expense = expense
            .plus(D(l._sum.debit ?? 0))
            .minus(D(l._sum.credit ?? 0));
      }
      const events = await tx.financialEvent.groupBy({
        by: ['type'],
        where: {
          tenantId,
          currency,
          status: 'POSTED',
          businessDate: { gte: fromLocalDate(start), lte: fromLocalDate(end) },
        },
        _sum: { amount: true },
      });
      const ev = (t: string[]) =>
        events
          .filter((e) => t.includes(e.type))
          .reduce((s, e) => s.plus(D(e._sum.amount ?? 0)), D(0))
          .toString();
      month[currency] = {
        disbursed: ev(['DISBURSEMENT']),
        collected: ev(['REPAYMENT', 'SETTLEMENT', 'RECOVERY']),
        writtenOff: ev(['WRITE_OFF']),
        income: income.toString(),
        expense: expense.toString(),
        netIncome: income.minus(expense).toString(),
      };
    }
    const loans = await tx.loanAccount.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: {
        currency: true,
        principalOutstanding: true,
        interestReceivable: true,
        allowance: true,
        daysPastDue: true,
        delinquencyBucket: true,
      },
    });
    const portfolio: Record<string, Record<string, unknown>> = {};
    for (const l of loans) {
      const p = (portfolio[l.currency] ??= {
        activeLoans: 0,
        principalOutstanding: '0',
        interestReceivable: '0',
        allowance: '0',
        par1: '0',
        par30: '0',
        par90: '0',
        buckets: {} as Record<string, number>,
      });
      const add = (k: string, v: unknown) =>
        (p[k] = D(p[k] as string)
          .plus(D(v as string))
          .toString());
      p.activeLoans = (p.activeLoans as number) + 1;
      add('principalOutstanding', l.principalOutstanding);
      add('interestReceivable', l.interestReceivable);
      add('allowance', l.allowance);
      if (l.daysPastDue >= 1) add('par1', l.principalOutstanding);
      if (l.daysPastDue >= 30) add('par30', l.principalOutstanding);
      if (l.daysPastDue >= 90) add('par90', l.principalOutstanding);
      const b = p.buckets as Record<string, number>;
      b[l.delinquencyBucket] = (b[l.delinquencyBucket] ?? 0) + 1;
    }
    for (const p of Object.values(portfolio)) {
      const po = D(p.principalOutstanding as string);
      for (const k of ['par1', 'par30', 'par90'])
        p[`${k}Ratio`] = po.gt(0)
          ? D(p[k] as string)
              .div(po)
              .toDecimalPlaces(4)
              .toString()
          : '0';
    }
    // Each live loan's grading as it stood at the close, for the regulatory
    // return (OPS-7): balances are re-read from the ledger as of the month
    // end, but days past due and class cannot be, so they are kept here.
    const graded = await tx.loanAccount.findMany({
      where: { tenantId, status: { in: ['ACTIVE', 'WRITTEN_OFF'] } },
      select: {
        id: true,
        daysPastDue: true,
        classification: true,
        impairmentStage: true,
        isRestructured: true,
        nonAccrual: true,
      },
      orderBy: { id: 'asc' },
    });
    return {
      takenAt: new Date().toISOString(),
      period: { start, end },
      trialBalance,
      month,
      portfolio,
      loanGrades: {
        asOf: await this.businessDate.get(tenantId, tx),
        loans: graded.map((l) => ({
          id: l.id,
          dpd: l.daysPastDue,
          classification: l.classification,
          stage: l.impairmentStage,
          restructured: l.isRestructured,
          nonAccrual: l.nonAccrual,
        })),
      },
    };
  }

  // ── Month close ───────────────────────────────────────────────────────────

  private async log(
    tx: Tx,
    tenantId: string,
    periodId: string,
    action: string,
    actorId: string,
    comment = '',
  ) {
    await tx.periodCloseLog.create({
      data: {
        tenantId,
        periodId,
        action,
        actorId,
        comment: comment.slice(0, 500),
      },
    });
  }

  async prepareMonth(
    actor: LendingActor,
    year: number,
    month: number,
    body: { comment?: string } = {},
  ) {
    const tenantId = requireTenant(actor);
    this.validMonth(year, month);
    await this.policy.enforce(
      actor,
      'accounting.period.close',
      tenantResource(tenantId),
    );
    const checks = await this.checks(actor, year, month);
    if (checks.some((c) => c.status === 'FAIL'))
      throw new BadRequestException({
        message: `${periodLabel(year, month)} cannot be closed yet.`,
        code: 'CLOSE_CHECKS_FAILED',
        checks,
      });
    const { start, end } = monthBounds(year, month);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const existing = await tx.accountingPeriod.findFirst({
        where: { tenantId, year, month },
      });
      if (existing && existing.status !== 'OPEN')
        throw new ConflictException(
          existing.status === 'PENDING'
            ? `${periodLabel(year, month)} is already waiting for approval.`
            : `${periodLabel(year, month)} is closed.`,
        );
      const snapshot = await this.snapshot(tx, tenantId, start, end);
      const data = {
        status: 'PENDING',
        checks: checks as unknown as Json,
        snapshot: snapshot as unknown as Json,
        preparedBy: actor.id,
        preparedAt: new Date(),
        approvedBy: null,
        closedAt: null,
      };
      const row = existing
        ? await tx.accountingPeriod.update({ where: { id: existing.id }, data })
        : await tx.accountingPeriod.create({
            data: {
              tenantId,
              year,
              month,
              startDate: fromLocalDate(start),
              endDate: fromLocalDate(end),
              ...data,
            },
          });
      await this.log(tx, tenantId, row.id, 'PREPARED', actor.id, body.comment);
      await tx.outboxMessage.create({
        data: {
          tenantId,
          topic: 'lending.period.ready_for_approval',
          payload: { year, month, preparedBy: actor.id } as Json,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'accounting.period.close',
          resourceType: 'AccountingPeriod',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: {
            year,
            month,
            warnings: checks
              .filter((c) => c.status === 'WARN')
              .map((c) => c.code),
          },
        },
        tx,
      );
      return { id: row.id, year, month, status: row.status, checks };
    });
  }

  async decideMonth(
    actor: LendingActor,
    year: number,
    month: number,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    this.validMonth(year, month);
    const row = await this.lp.tenantTx(tenantId, (tx) =>
      tx.accountingPeriod.findFirst({ where: { tenantId, year, month } }),
    );
    if (!row || row.status !== 'PENDING')
      throw new ConflictException(
        `${periodLabel(year, month)} is not waiting for approval.`,
      );
    await this.policy.enforce(
      actor,
      'accounting.period.approve',
      tenantResource(
        tenantId,
        'TENANT',
        tenantId,
        row.preparedBy ? [row.preparedBy] : [],
      ),
    );
    // The books may have moved since it was prepared: recheck before locking.
    const checks = body.approve ? await this.checks(actor, year, month) : null;
    if (checks?.some((c) => c.status === 'FAIL'))
      throw new BadRequestException({
        message: `${periodLabel(year, month)} no longer passes its close checks.`,
        code: 'CLOSE_CHECKS_FAILED',
        checks,
      });
    return this.lp.tenantTx(tenantId, async (tx) => {
      const res = await tx.accountingPeriod.updateMany({
        where: { id: row.id, tenantId, status: 'PENDING' },
        data: body.approve
          ? {
              status: 'CLOSED',
              approvedBy: actor.id,
              closedAt: new Date(),
              checks: checks as unknown as Json,
            }
          : { status: 'OPEN' },
      });
      if (res.count !== 1)
        throw new ConflictException('The period changed; reload it.');
      await this.log(
        tx,
        tenantId,
        row.id,
        body.approve ? 'APPROVED' : 'REJECTED',
        actor.id,
        body.comment,
      );
      await this.audit.write(
        {
          actor,
          action: 'accounting.period.approve',
          resourceType: 'AccountingPeriod',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { year, month, approve: body.approve },
        },
        tx,
      );
      return {
        id: row.id,
        year,
        month,
        status: body.approve ? 'CLOSED' : 'OPEN',
      };
    });
  }

  async requestReopen(
    actor: LendingActor,
    year: number,
    month: number,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    this.validMonth(year, month);
    await this.policy.enforce(
      actor,
      'accounting.period.close',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.accountingPeriod.findFirst({
        where: { tenantId, year, month },
      });
      if (!row || row.status !== 'CLOSED')
        throw new ConflictException(
          `${periodLabel(year, month)} is not closed.`,
        );
      const yearRow = await tx.accountingPeriod.findFirst({
        where: { tenantId, year, month: 0 },
      });
      if (yearRow && yearRow.status !== 'OPEN')
        throw new ConflictException(
          `${year} is closed; its months cannot be reopened.`,
        );
      const later = await tx.accountingPeriod.count({
        where: {
          tenantId,
          month: { gt: 0 },
          status: { not: 'OPEN' },
          OR: [{ year: { gt: year } }, { year, month: { gt: month } }],
        },
      });
      if (later)
        throw new ConflictException('Reopen the latest closed month first.');
      await tx.accountingPeriod.update({
        where: { id: row.id },
        data: {
          status: 'REOPEN_PENDING',
          reopenReason: body.reason.slice(0, 500),
          reopenRequestedBy: actor.id,
        },
      });
      await this.log(
        tx,
        tenantId,
        row.id,
        'REOPEN_REQUESTED',
        actor.id,
        body.reason,
      );
      await this.audit.write(
        {
          actor,
          action: 'accounting.period.close',
          resourceType: 'AccountingPeriod',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { year, month, reopen: true, reason: body.reason },
        },
        tx,
      );
      return { id: row.id, year, month, status: 'REOPEN_PENDING' };
    });
  }

  async decideReopen(
    actor: LendingActor,
    year: number,
    month: number,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    this.validMonth(year, month);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.accountingPeriod.findFirst({
        where: { tenantId, year, month },
      });
      if (!row || row.status !== 'REOPEN_PENDING')
        throw new ConflictException(
          `${periodLabel(year, month)} has no reopening waiting.`,
        );
      await this.policy.enforce(
        actor,
        'accounting.period.approve',
        tenantResource(
          tenantId,
          'TENANT',
          tenantId,
          row.reopenRequestedBy ? [row.reopenRequestedBy] : [],
        ),
        tx,
      );
      await tx.accountingPeriod.update({
        where: { id: row.id },
        data: body.approve
          ? {
              status: 'OPEN',
              approvedBy: null,
              closedAt: null,
              reopenCount: { increment: 1 },
            }
          : { status: 'CLOSED', reopenReason: '', reopenRequestedBy: null },
      });
      await this.log(
        tx,
        tenantId,
        row.id,
        body.approve ? 'REOPENED' : 'REOPEN_REJECTED',
        actor.id,
        body.comment,
      );
      await this.audit.write(
        {
          actor,
          action: 'accounting.period.approve',
          resourceType: 'AccountingPeriod',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { year, month, reopen: body.approve },
        },
        tx,
      );
      return {
        id: row.id,
        year,
        month,
        status: body.approve ? 'OPEN' : 'CLOSED',
      };
    });
  }

  /**
   * End of day calls this after processing the last day of a month: the
   * close is prepared automatically and waits for a person to lock it. A
   * month that does not pass its checks is left for finance to look at.
   */
  async autoPrepare(tenantId: string, day: string) {
    if (lending.addDays(day, 1).slice(8, 10) !== '01') return null;
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7));
    try {
      return await this.prepareMonth(periodCloseActor(tenantId), year, month, {
        comment: 'Prepared automatically by end of day',
      });
    } catch (e) {
      this.logger.warn(
        `Month-end ${tenantId} ${year}-${month} not prepared: ${(e as Error).message}`,
      );
      return null;
    }
  }

  // ── Year end ──────────────────────────────────────────────────────────────

  /** Income and expense of the year per currency, and the journal that closes them. */
  private async yearClosing(tx: Tx, tenantId: string, year: number) {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const accounts = await tx.ledgerAccount.findMany({
      where: { tenantId, type: { in: ['INCOME', 'EXPENSE'] } },
      select: { code: true, name: true, type: true },
    });
    const meta = new Map(accounts.map((a) => [a.code, a]));
    // Where the year's result is carried (lending settings, default 3100).
    const retainedEarnings = (await this.settings.get(tenantId, tx)).accounting
      .retainedEarnings;
    const currencies = await tx.lendingJournalEntry.groupBy({
      by: ['currency'],
      where: {
        tenantId,
        entryDate: { gte: fromLocalDate(start), lte: fromLocalDate(end) },
      },
    });
    const out: {
      currency: string;
      income: string;
      expense: string;
      netIncome: string;
      accounts: {
        accountCode: string;
        name: string;
        type: string;
        balance: string;
      }[];
      lines: PostingLine[];
    }[] = [];
    for (const { currency } of currencies) {
      const sums = await tx.lendingJournalLine.groupBy({
        by: ['accountCode'],
        where: {
          tenantId,
          accountCode: { in: [...meta.keys()] },
          entry: {
            currency,
            entryDate: { gte: fromLocalDate(start), lte: fromLocalDate(end) },
          },
        },
        _sum: { debit: true, credit: true },
        orderBy: { accountCode: 'asc' },
      });
      const lines: PostingLine[] = [];
      const rows: {
        accountCode: string;
        name: string;
        type: string;
        balance: string;
      }[] = [];
      let income = D(0);
      let expense = D(0);
      for (const s of sums) {
        const m = meta.get(s.accountCode)!;
        // Credit balance positive for income, debit balance positive for expense.
        const credit = D(s._sum.credit ?? 0).minus(D(s._sum.debit ?? 0));
        if (credit.isZero()) continue;
        if (m.type === 'INCOME') income = income.plus(credit);
        else expense = expense.minus(credit);
        rows.push({
          accountCode: s.accountCode,
          name: m.name,
          type: m.type,
          balance: (m.type === 'INCOME' ? credit : credit.negated()).toString(),
        });
        // Bring the account to zero.
        lines.push(
          credit.gt(0)
            ? { accountCode: s.accountCode, debit: credit.toString() }
            : {
                accountCode: s.accountCode,
                credit: credit.negated().toString(),
              },
        );
      }
      const net = income.minus(expense);
      if (!net.isZero())
        lines.push(
          net.gt(0)
            ? { accountCode: retainedEarnings, credit: net.toString() }
            : {
                accountCode: retainedEarnings,
                debit: net.negated().toString(),
              },
        );
      out.push({
        currency,
        income: income.toString(),
        expense: expense.toString(),
        netIncome: net.toString(),
        accounts: rows,
        lines,
      });
    }
    return out;
  }

  private async yearChecks(
    tx: Tx,
    tenantId: string,
    year: number,
  ): Promise<CloseCheck[]> {
    const [businessDate, first, rows, prevYear] = await Promise.all([
      this.businessDate.get(tenantId, tx),
      this.firstActivity(tx, tenantId),
      tx.accountingPeriod.findMany({
        where: { tenantId, year, month: { gt: 0 } },
      }),
      tx.accountingPeriod.findFirst({
        where: { tenantId, year: year - 1, month: 0 },
      }),
    ]);
    const out: CloseCheck[] = [];
    const end = `${year}-12-31`;
    out.push(
      lending.compareDates(businessDate, end) >= 0
        ? {
            code: 'BUSINESS_DATE',
            label: 'The year has ended',
            status: 'PASS',
            detail: `Business date ${businessDate}.`,
          }
        : {
            code: 'BUSINESS_DATE',
            label: 'The year has ended',
            status: 'FAIL',
            detail: `The year ends ${end}; the business date is ${businessDate}.`,
          },
    );
    const closed = new Set(
      rows.filter((r) => r.status === 'CLOSED').map((r) => r.month),
    );
    const firstMonth =
      first && Number(first.slice(0, 4)) === year
        ? Number(first.slice(5, 7))
        : 1;
    const required =
      first && Number(first.slice(0, 4)) <= year
        ? Array.from({ length: 13 - firstMonth }, (_, i) => firstMonth + i)
        : [];
    const missing = required.filter((m) => !closed.has(m));
    out.push(
      missing.length
        ? {
            code: 'MONTHS_CLOSED',
            label: 'Every month of the year is closed',
            status: 'FAIL',
            detail: `Still open: ${missing.map((m) => MONTH_NAMES[m - 1]).join(', ')}.`,
          }
        : {
            code: 'MONTHS_CLOSED',
            label: 'Every month of the year is closed',
            status: 'PASS',
            detail: required.length
              ? `${required.length} month(s) closed.`
              : 'No activity in the year.',
          },
    );
    const prevNeeded = first !== null && Number(first.slice(0, 4)) < year;
    out.push(
      !prevNeeded || prevYear?.status === 'CLOSED'
        ? {
            code: 'PREVIOUS_YEAR',
            label: 'Previous year is closed',
            status: 'PASS',
            detail: prevNeeded ? 'Closed.' : 'First year with activity.',
          }
        : {
            code: 'PREVIOUS_YEAR',
            label: 'Previous year is closed',
            status: 'FAIL',
            detail: `Close ${year - 1} first.`,
          },
    );
    return out;
  }

  async yearView(actor: LendingActor, year: number) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'accounting.read',
      tenantResource(tenantId),
    );
    const v = await this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.accountingPeriod.findFirst({
        where: { tenantId, year, month: 0 },
        include: { log: { orderBy: { createdAt: 'asc' } } },
      });
      const closing =
        row?.status === 'CLOSED'
          ? (row.snapshot as unknown)
          : await this.yearClosing(tx, tenantId, year);
      return {
        row,
        closing,
        // Where the result is carried — shown before anyone approves the close.
        retainedEarnings: (await this.settings.get(tenantId, tx)).accounting
          .retainedEarnings,
        checks:
          row?.status === 'CLOSED'
            ? (row.checks as unknown as CloseCheck[])
            : await this.yearChecks(tx, tenantId, year),
      };
    });
    return {
      year,
      label: periodLabel(year, 0),
      status: v.row?.status ?? 'OPEN',
      preparedBy: v.row?.preparedBy ?? null,
      approvedBy: v.row?.approvedBy ?? null,
      closedAt: v.row?.closedAt ?? null,
      closingEventIds: v.row?.closingEventIds ?? [],
      checks: v.checks,
      ready: v.checks.every((c) => c.status !== 'FAIL'),
      closing: v.closing,
      retainedEarningsAccount: v.retainedEarnings,
      log: v.row?.log ?? [],
      permissions: {
        prepare: await this.can(actor, 'accounting.period.close'),
        approve: await this.can(
          actor,
          'accounting.period.approve',
          v.row?.preparedBy ? [v.row.preparedBy] : [],
        ),
      },
    };
  }

  async prepareYear(
    actor: LendingActor,
    year: number,
    body: { comment?: string } = {},
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'accounting.period.close',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const checks = await this.yearChecks(tx, tenantId, year);
      if (checks.some((c) => c.status === 'FAIL'))
        throw new BadRequestException({
          message: `${year} cannot be closed yet.`,
          code: 'CLOSE_CHECKS_FAILED',
          checks,
        });
      const existing = await tx.accountingPeriod.findFirst({
        where: { tenantId, year, month: 0 },
      });
      if (existing && existing.status !== 'OPEN')
        throw new ConflictException(
          existing.status === 'PENDING'
            ? `${year} is already waiting for approval.`
            : `${year} is closed.`,
        );
      const closing = await this.yearClosing(tx, tenantId, year);
      const data = {
        status: 'PENDING',
        checks: checks as unknown as Json,
        snapshot: closing as unknown as Json,
        preparedBy: actor.id,
        preparedAt: new Date(),
      };
      const row = existing
        ? await tx.accountingPeriod.update({ where: { id: existing.id }, data })
        : await tx.accountingPeriod.create({
            data: {
              tenantId,
              year,
              month: 0,
              startDate: fromLocalDate(`${year}-01-01`),
              endDate: fromLocalDate(`${year}-12-31`),
              ...data,
            },
          });
      await this.log(tx, tenantId, row.id, 'PREPARED', actor.id, body.comment);
      await this.audit.write(
        {
          actor,
          action: 'accounting.period.close',
          resourceType: 'AccountingPeriod',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { year, yearEnd: true },
        },
        tx,
      );
      return { id: row.id, year, status: 'PENDING', closing };
    });
  }

  /** Approving the year posts the closing journal into retained earnings, per currency. */
  async decideYear(
    actor: LendingActor,
    year: number,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.accountingPeriod.findFirst({
        where: { tenantId, year, month: 0 },
      });
      if (!row || row.status !== 'PENDING')
        throw new ConflictException(`${year} is not waiting for approval.`);
      await this.policy.enforce(
        actor,
        'accounting.period.approve',
        tenantResource(
          tenantId,
          'TENANT',
          tenantId,
          row.preparedBy ? [row.preparedBy] : [],
        ),
        tx,
      );
      if (!body.approve) {
        await tx.accountingPeriod.update({
          where: { id: row.id },
          data: { status: 'OPEN' },
        });
        await this.log(
          tx,
          tenantId,
          row.id,
          'REJECTED',
          actor.id,
          body.comment,
        );
        return { id: row.id, year, status: 'OPEN' };
      }
      const checks = await this.yearChecks(tx, tenantId, year);
      if (checks.some((c) => c.status === 'FAIL'))
        throw new BadRequestException({
          message: `${year} no longer passes its close checks.`,
          code: 'CLOSE_CHECKS_FAILED',
          checks,
        });
      const closing = await this.yearClosing(tx, tenantId, year);
      const end = `${year}-12-31`;
      const eventIds: string[] = [];
      for (const c of closing) {
        if (c.lines.length < 2) continue;
        const event = await tx.financialEvent.create({
          data: {
            tenantId,
            loanAccountId: null,
            type: 'YEAR_END_CLOSE',
            businessDate: fromLocalDate(end),
            valueDate: fromLocalDate(end),
            amount: D(c.income).plus(D(c.expense)).toString(),
            currency: c.currency,
            components: {
              year,
              income: c.income,
              expense: c.expense,
              netIncome: c.netIncome,
            } as Json,
            idempotencyKey: `sys:year-end:${year}:${c.currency}`,
            requestHash: `year-end:${year}:${c.currency}`,
            productVersionId: null,
            agreementVersion: null,
            engineVersion: lending.LENDING_ENGINE_VERSION,
            actorId: actor.id,
            actorType: actor.type,
            narrative: `Year-end close ${year}: income and expense to retained earnings`,
          },
        });
        await this.posting.post(tx, {
          tenantId,
          financialEventId: event.id,
          loanAccountId: null,
          entryDate: fromLocalDate(end),
          currency: c.currency,
          description: `Year-end close ${year}`,
          lines: c.lines,
          allowClosedPeriod: true,
        });
        eventIds.push(event.id);
      }
      await tx.accountingPeriod.update({
        where: { id: row.id },
        data: {
          status: 'CLOSED',
          approvedBy: actor.id,
          closedAt: new Date(),
          checks: checks as unknown as Json,
          snapshot: closing as unknown as Json,
          closingEventIds: eventIds,
        },
      });
      await this.log(tx, tenantId, row.id, 'APPROVED', actor.id, body.comment);
      await this.audit.write(
        {
          actor,
          action: 'accounting.period.approve',
          resourceType: 'AccountingPeriod',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { year, yearEnd: true, events: eventIds },
        },
        tx,
      );
      return {
        id: row.id,
        year,
        status: 'CLOSED',
        closingEventIds: eventIds,
        closing,
      };
    });
  }
}
