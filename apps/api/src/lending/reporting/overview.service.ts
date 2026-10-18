import { Injectable } from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  fromLocalDate,
  requireTenant,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';

type Dec = ReturnType<typeof D>;

/** Money in, counted as collections on the dashboard. Reversed events are excluded by status. */
const COLLECTION_EVENTS = ['REPAYMENT', 'PREPAYMENT', 'SETTLEMENT'];
/** Months of history in the collections-versus-disbursements trend. */
const TREND_MONTHS = 6;
/** The forward window for "due in the next days". */
const DUE_WINDOW_DAYS = 7;

export interface CurrencyFigures {
  currency: string;
  activeLoans: number;
  overdueLoans: number;
  principalOutstanding: string;
  overdueOutstanding: string;
  dueNextDays: string;
  collectedThisMonth: string;
  collectedLastMonth: string;
  disbursedThisMonth: string;
  /** Rate used to express this currency in the reporting currency; null when none is configured. */
  rateToReporting: string | null;
}

/**
 * The lending book at a glance, for the home dashboard: what is out, what is
 * late, what falls due next, and the money that moved this month and last.
 * Confined to the loans the caller may read (`loan.read` scope), dated by
 * the tenant's business date, and totalled in the tenant's base currency
 * with the tenant's FX table. A currency with no configured rate is left out
 * of the totals and named in `unconverted`, never added at face value.
 */
@Injectable()
export class LendingOverviewService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly businessDate: BusinessDateService,
  ) {}

  async summary(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const businessDate = await this.businessDate.get(tenantId, tx);
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { baseCurrency: true },
      });
      const reportingCurrency = String(tenant?.baseCurrency ?? 'USD');
      if (!scope)
        return this.empty(businessDate, reportingCurrency);
      const loanWhere = {
        tenantId,
        ...(scope as Prisma.LoanAccountWhereInput),
      } satisfies Prisma.LoanAccountWhereInput;

      const monthStart = `${businessDate.slice(0, 7)}-01`;
      const lastMonthStart = lending.addMonths(monthStart, -1);
      const trendStart = lending.addMonths(monthStart, -(TREND_MONTHS - 1));
      const windowEnd = lending.addDays(businessDate, DUE_WINDOW_DAYS);

      const active = { ...loanWhere, status: 'ACTIVE' };
      const [book, overdue, borrowers, dueLines, events] = await Promise.all([
        tx.loanAccount.groupBy({
          by: ['currency'],
          where: active,
          _count: { _all: true },
          _sum: { principalOutstanding: true },
        }),
        tx.loanAccount.groupBy({
          by: ['currency'],
          where: { ...active, daysPastDue: { gt: 0 } },
          _count: { _all: true },
          _sum: { principalOutstanding: true },
        }),
        tx.loanAccount.groupBy({ by: ['borrowerId'], where: active }),
        tx.scheduleInstalment.findMany({
          where: {
            tenantId,
            status: 'DUE',
            dueDate: {
              gt: fromLocalDate(businessDate),
              lte: fromLocalDate(windowEnd),
            },
            loanAccount: active,
          },
          select: {
            principalDue: true,
            interestDue: true,
            feeDue: true,
            taxDue: true,
            penaltyDue: true,
            principalPaid: true,
            interestPaid: true,
            feePaid: true,
            taxPaid: true,
            penaltyPaid: true,
            loanAccount: { select: { currency: true } },
          },
        }),
        tx.financialEvent.groupBy({
          by: ['type', 'currency', 'valueDate'],
          where: {
            tenantId,
            status: 'POSTED',
            type: { in: [...COLLECTION_EVENTS, 'DISBURSEMENT'] },
            valueDate: {
              gte: fromLocalDate(trendStart),
              lte: fromLocalDate(businessDate),
            },
            loanAccount: loanWhere,
          },
          _sum: { amount: true },
        }),
      ]);

      const rates = await this.rates(tx, tenantId, businessDate);
      const toReporting = (currency: string): Dec | null =>
        currency === reportingCurrency
          ? D(1)
          : (rates.get(`${currency}->${reportingCurrency}`) ??
            (rates.get(`${reportingCurrency}->${currency}`)
              ? D(1).div(rates.get(`${reportingCurrency}->${currency}`)!)
              : null));

      const per = new Map<
        string,
        {
          activeLoans: number;
          overdueLoans: number;
          principal: Dec;
          overdue: Dec;
          due: Dec;
          collectedThis: Dec;
          collectedLast: Dec;
          disbursedThis: Dec;
        }
      >();
      const row = (c: string) => {
        let r = per.get(c);
        if (!r) {
          r = {
            activeLoans: 0,
            overdueLoans: 0,
            principal: D(0),
            overdue: D(0),
            due: D(0),
            collectedThis: D(0),
            collectedLast: D(0),
            disbursedThis: D(0),
          };
          per.set(c, r);
        }
        return r;
      };
      for (const g of book) {
        const r = row(g.currency);
        r.activeLoans = g._count._all;
        r.principal = D(g._sum.principalOutstanding);
      }
      for (const g of overdue) {
        const r = row(g.currency);
        r.overdueLoans = g._count._all;
        r.overdue = D(g._sum.principalOutstanding);
      }
      for (const l of dueLines) {
        const owed = D(l.principalDue)
          .plus(D(l.interestDue))
          .plus(D(l.feeDue))
          .plus(D(l.taxDue))
          .plus(D(l.penaltyDue))
          .minus(D(l.principalPaid))
          .minus(D(l.interestPaid))
          .minus(D(l.feePaid))
          .minus(D(l.taxPaid))
          .minus(D(l.penaltyPaid));
        if (owed.gt(0)) {
          const r = row(l.loanAccount.currency);
          r.due = r.due.plus(owed);
        }
      }

      const months: string[] = [];
      for (let i = 0; i < TREND_MONTHS; i++)
        months.push(lending.addMonths(trendStart, i).slice(0, 7));
      const trend = new Map(
        months.map((m) => [m, { collections: D(0), disbursements: D(0) }]),
      );
      const unconverted = new Set<string>();
      const thisMonth = monthStart.slice(0, 7);
      const lastMonth = lastMonthStart.slice(0, 7);
      for (const e of events) {
        const month = e.valueDate.toISOString().slice(0, 7);
        const amount = D(e._sum.amount);
        const collection = COLLECTION_EVENTS.includes(e.type);
        const r = row(e.currency);
        if (collection && month === thisMonth)
          r.collectedThis = r.collectedThis.plus(amount);
        if (collection && month === lastMonth)
          r.collectedLast = r.collectedLast.plus(amount);
        if (!collection && month === thisMonth)
          r.disbursedThis = r.disbursedThis.plus(amount);
        const rate = toReporting(e.currency);
        const t = trend.get(month);
        if (!t) continue;
        if (!rate) {
          unconverted.add(e.currency);
          continue;
        }
        if (collection) t.collections = t.collections.plus(amount.times(rate));
        else t.disbursements = t.disbursements.plus(amount.times(rate));
      }

      const totals = {
        activeLoans: 0,
        overdueLoans: 0,
        principalOutstanding: D(0),
        overdueOutstanding: D(0),
        dueNextDays: D(0),
        collectedThisMonth: D(0),
        collectedLastMonth: D(0),
        disbursedThisMonth: D(0),
      };
      const byCurrency: CurrencyFigures[] = [];
      for (const [currency, r] of [...per.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        const rate = toReporting(currency);
        totals.activeLoans += r.activeLoans;
        totals.overdueLoans += r.overdueLoans;
        if (rate) {
          totals.principalOutstanding = totals.principalOutstanding.plus(
            r.principal.times(rate),
          );
          totals.overdueOutstanding = totals.overdueOutstanding.plus(
            r.overdue.times(rate),
          );
          totals.dueNextDays = totals.dueNextDays.plus(r.due.times(rate));
          totals.collectedThisMonth = totals.collectedThisMonth.plus(
            r.collectedThis.times(rate),
          );
          totals.collectedLastMonth = totals.collectedLastMonth.plus(
            r.collectedLast.times(rate),
          );
          totals.disbursedThisMonth = totals.disbursedThisMonth.plus(
            r.disbursedThis.times(rate),
          );
        } else unconverted.add(currency);
        byCurrency.push({
          currency,
          activeLoans: r.activeLoans,
          overdueLoans: r.overdueLoans,
          principalOutstanding: money(r.principal),
          overdueOutstanding: money(r.overdue),
          dueNextDays: money(r.due),
          collectedThisMonth: money(r.collectedThis),
          collectedLastMonth: money(r.collectedLast),
          disbursedThisMonth: money(r.disbursedThis),
          rateToReporting: rate ? rate.toString() : null,
        });
      }

      return {
        businessDate,
        reportingCurrency,
        dueWindowDays: DUE_WINDOW_DAYS,
        month: thisMonth,
        totals: {
          activeLoans: totals.activeLoans,
          overdueLoans: totals.overdueLoans,
          borrowers: borrowers.length,
          principalOutstanding: money(totals.principalOutstanding),
          overdueOutstanding: money(totals.overdueOutstanding),
          dueNextDays: money(totals.dueNextDays),
          collectedThisMonth: money(totals.collectedThisMonth),
          collectedLastMonth: money(totals.collectedLastMonth),
          disbursedThisMonth: money(totals.disbursedThisMonth),
        },
        byCurrency,
        unconverted: [...unconverted].sort(),
        trend: months.map((m) => ({
          month: m,
          collections: money(trend.get(m)!.collections),
          disbursements: money(trend.get(m)!.disbursements),
        })),
      };
    });
  }

  /** Latest rate per pair effective on or before the business date. */
  private async rates(tx: Tx, tenantId: string, businessDate: string) {
    const rows = await tx.exchangeRate.findMany({
      where: {
        tenantId,
        effectiveDate: { lt: fromLocalDate(lending.addDays(businessDate, 1)) },
      },
      orderBy: { effectiveDate: 'desc' },
      take: 500,
    });
    const map = new Map<string, Dec>();
    for (const r of rows) {
      const k = `${r.fromCurrency}->${r.toCurrency}`;
      if (!map.has(k) && D(r.rate).gt(0)) map.set(k, D(r.rate));
    }
    return map;
  }

  private empty(businessDate: string, reportingCurrency: string) {
    const zero = '0.00';
    return {
      businessDate,
      reportingCurrency,
      dueWindowDays: DUE_WINDOW_DAYS,
      month: businessDate.slice(0, 7),
      totals: {
        activeLoans: 0,
        overdueLoans: 0,
        borrowers: 0,
        principalOutstanding: zero,
        overdueOutstanding: zero,
        dueNextDays: zero,
        collectedThisMonth: zero,
        collectedLastMonth: zero,
        disbursedThisMonth: zero,
      },
      byCurrency: [] as CurrencyFigures[],
      unconverted: [] as string[],
      trend: [] as { month: string; collections: string; disbursements: string }[],
    };
  }
}

function money(d: Dec): string {
  return d.toFixed(2);
}
