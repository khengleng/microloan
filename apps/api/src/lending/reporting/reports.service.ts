import { Injectable } from '@nestjs/common';
import type { Prisma } from '@microloan/db';
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
import { tenantResource } from '../policy/resources';
import { rateTo, reportingRates } from './overview.service';

type Dec = ReturnType<typeof D>;

/** Money in from the customer (reversed events are excluded by status). */
export const RECEIPT_EVENTS = [
  'REPAYMENT',
  'PREPAYMENT',
  'SETTLEMENT',
  'RECOVERY',
];
/** Days-past-due bands of the arrears ageing, as the original Performance page showed them. */
export const AGEING_BANDS = [
  { code: 'CURRENT', min: 0, max: 0 },
  { code: 'D1_30', min: 1, max: 30 },
  { code: 'D31_60', min: 31, max: 60 },
  { code: 'D61_90', min: 61, max: 90 },
  { code: 'D90_PLUS', min: 91, max: null },
] as const;

const LOAN_STATUSES = ['BOOKED', 'ACTIVE', 'CLOSED', 'WRITTEN_OFF'];
const PAGE_MAX = 200;
const ALLOCATION_COMPONENTS = [
  'PRINCIPAL',
  'INTEREST',
  'FEE',
  'TAX',
  'PENALTY',
];

const money = (d: Dec) => d.toFixed(2);
const pct = (num: Dec, den: Dec) =>
  den.gt(0) ? num.div(den).times(100).toDecimalPlaces(2).toString() : null;

export interface PortfolioQuery {
  status?: string;
  currency?: string;
  branchId?: string;
  productId?: string;
  band?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export interface ReceiptsQuery {
  from?: string;
  to?: string;
  currency?: string;
  page?: number;
  limit?: number;
}

/**
 * Reports on the lending book (D-153), replacing the original module's
 * Reports, Performance and Excel exports: the loan portfolio, money received
 * and the portfolio's performance. Every figure comes from LoanAccount, the
 * schedule instalments, financial events and the lending journal; every
 * report is confined to the loans the caller may read (`loan.read` scope),
 * dated by the tenant's business date, and converted to the tenant's base
 * currency with its FX table (a currency without a rate is listed, never
 * added at face value). The CSV exports need `loan_data.export` and are
 * audited.
 */
@Injectable()
export class LendingReportsService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly businessDate: BusinessDateService,
    private readonly audit: AuditEventService,
  ) {}

  private async loanScope(
    actor: LendingActor,
  ): Promise<Prisma.LoanAccountWhereInput | null> {
    const s = await this.policy.scopeFilter(actor, 'loan.read');
    return s ? (s as Prisma.LoanAccountWhereInput) : null;
  }

  private async context(tx: Tx, tenantId: string) {
    const businessDate = await this.businessDate.get(tenantId, tx);
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { baseCurrency: true },
    });
    const reportingCurrency = String(tenant?.baseCurrency ?? 'USD');
    const rates = await reportingRates(tx, tenantId, businessDate);
    return { businessDate, reportingCurrency, rates };
  }

  // ── Loan portfolio ───────────────────────────────────────────────────────

  async portfolio(actor: LendingActor, q: PortfolioQuery) {
    const tenantId = requireTenant(actor);
    const scope = await this.loanScope(actor);
    const { page, limit } = paging(q);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const ctx = await this.context(tx, tenantId);
      const filters = await this.filterOptions(tx, tenantId, scope);
      if (!scope)
        return {
          businessDate: ctx.businessDate,
          reportingCurrency: ctx.reportingCurrency,
          filters,
          summary: [],
          totals: null,
          unconverted: [],
          data: [],
          total: 0,
          page,
          limit,
        };
      const where = portfolioWhere(tenantId, scope, q);
      const [rows, total, groups] = await Promise.all([
        tx.loanAccount.findMany({
          where,
          orderBy: [{ daysPastDue: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.loanAccount.count({ where }),
        tx.loanAccount.groupBy({
          by: ['currency', 'daysPastDue'],
          where,
          _count: { _all: true },
          _sum: {
            principalOutstanding: true,
            interestReceivable: true,
            allowance: true,
          },
        }),
      ]);
      const names = await this.names(tx, tenantId, rows);
      const per = new Map<
        string,
        {
          loans: number;
          principal: Dec;
          interest: Dec;
          overdue: Dec;
          par30: Dec;
          allowance: Dec;
        }
      >();
      for (const g of groups) {
        const r = per.get(g.currency) ?? {
          loans: 0,
          principal: D(0),
          interest: D(0),
          overdue: D(0),
          par30: D(0),
          allowance: D(0),
        };
        const p = D(g._sum.principalOutstanding);
        r.loans += g._count._all;
        r.principal = r.principal.plus(p);
        r.interest = r.interest.plus(D(g._sum.interestReceivable));
        r.allowance = r.allowance.plus(D(g._sum.allowance));
        if (g.daysPastDue > 0) r.overdue = r.overdue.plus(p);
        if (g.daysPastDue > 30) r.par30 = r.par30.plus(p);
        per.set(g.currency, r);
      }
      const unconverted = new Set<string>();
      const totals = { loans: 0, principal: D(0), overdue: D(0), par30: D(0) };
      const summary = [...per.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([currency, r]) => {
          const rate = rateTo(ctx.rates, currency, ctx.reportingCurrency);
          totals.loans += r.loans;
          if (rate) {
            totals.principal = totals.principal.plus(r.principal.times(rate));
            totals.overdue = totals.overdue.plus(r.overdue.times(rate));
            totals.par30 = totals.par30.plus(r.par30.times(rate));
          } else unconverted.add(currency);
          return {
            currency,
            loans: r.loans,
            principalOutstanding: money(r.principal),
            interestReceivable: money(r.interest),
            overdueOutstanding: money(r.overdue),
            par30Pct: pct(r.par30, r.principal),
            allowance: money(r.allowance),
          };
        });
      return {
        businessDate: ctx.businessDate,
        reportingCurrency: ctx.reportingCurrency,
        filters,
        summary,
        totals: {
          loans: totals.loans,
          principalOutstanding: money(totals.principal),
          overdueOutstanding: money(totals.overdue),
          par30Pct: pct(totals.par30, totals.principal),
        },
        unconverted: [...unconverted].sort(),
        data: rows.map((l) => ({
          id: l.id,
          reference: l.reference,
          borrowerId: l.borrowerId,
          borrowerName: names.borrowers.get(l.borrowerId) ?? l.borrowerId,
          branch: names.branches.get(l.branchId) ?? l.branchId,
          product: names.products.get(l.productId) ?? l.familyCode,
          familyCode: l.familyCode,
          currency: l.currency,
          status: l.status,
          bookedPrincipal: money(D(l.bookedPrincipal)),
          principalOutstanding: money(D(l.principalOutstanding)),
          interestReceivable: money(D(l.interestReceivable)),
          chargesReceivable: money(
            D(l.feesReceivable).plus(D(l.penaltyReceivable)),
          ),
          daysPastDue: l.daysPastDue,
          band: bandOf(l.daysPastDue),
          classification: l.classification,
          disbursementDate: toLocalDate(l.disbursementDate),
          maturityDate: toLocalDate(l.maturityDate),
        })),
        total,
        page,
        limit,
      };
    });
  }

  // ── Money received ───────────────────────────────────────────────────────

  async receipts(actor: LendingActor, q: ReceiptsQuery) {
    const tenantId = requireTenant(actor);
    const scope = await this.loanScope(actor);
    const { page, limit } = paging(q);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const ctx = await this.context(tx, tenantId);
      const range = dateRange(q, ctx.businessDate);
      if (!scope)
        return {
          businessDate: ctx.businessDate,
          reportingCurrency: ctx.reportingCurrency,
          ...range,
          summary: [],
          totals: null,
          unconverted: [],
          data: [],
          total: 0,
          page,
          limit,
        };
      const where = receiptsWhere(tenantId, scope, range, q.currency);
      const [events, total, groups] = await Promise.all([
        tx.financialEvent.findMany({
          where,
          orderBy: [{ valueDate: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          include: {
            loanAccount: {
              select: { reference: true, borrowerId: true, branchId: true },
            },
          },
        }),
        tx.financialEvent.count({ where }),
        tx.financialEvent.groupBy({
          by: ['currency', 'type'],
          where,
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);
      const split = await this.allocationSplit(
        tx,
        tenantId,
        events.map((e) => e.id),
      );
      const borrowers = await this.borrowerNames(
        tx,
        tenantId,
        events
          .map((e) => e.loanAccount?.borrowerId)
          .filter(Boolean) as string[],
      );
      const per = new Map<
        string,
        { count: number; amount: Dec; byType: Record<string, string> }
      >();
      for (const g of groups) {
        const r = per.get(g.currency) ?? { count: 0, amount: D(0), byType: {} };
        r.count += g._count._all;
        r.amount = r.amount.plus(D(g._sum.amount));
        r.byType[g.type] = money(D(g._sum.amount));
        per.set(g.currency, r);
      }
      const unconverted = new Set<string>();
      let totalAmount = D(0);
      let totalCount = 0;
      const summary = [...per.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([currency, r]) => {
          const rate = rateTo(ctx.rates, currency, ctx.reportingCurrency);
          totalCount += r.count;
          if (rate) totalAmount = totalAmount.plus(r.amount.times(rate));
          else unconverted.add(currency);
          return {
            currency,
            count: r.count,
            amount: money(r.amount),
            byType: r.byType,
          };
        });
      return {
        businessDate: ctx.businessDate,
        reportingCurrency: ctx.reportingCurrency,
        ...range,
        summary,
        totals: { count: totalCount, amount: money(totalAmount) },
        unconverted: [...unconverted].sort(),
        data: events.map((e) => {
          const s = split.get(e.id) ?? {};
          const allocated = Object.values(s).reduce((t, v) => t.plus(v), D(0));
          return {
            id: e.id,
            valueDate: toLocalDate(e.valueDate),
            type: e.type,
            loanAccountId: e.loanAccountId,
            reference: e.loanAccount?.reference ?? null,
            borrowerName: e.loanAccount
              ? (borrowers.get(e.loanAccount.borrowerId) ?? null)
              : null,
            currency: e.currency,
            amount: money(D(e.amount)),
            principal: money(s.PRINCIPAL ?? D(0)),
            interest: money(s.INTEREST ?? D(0)),
            charges: money(
              (s.FEE ?? D(0)).plus(s.TAX ?? D(0)).plus(s.PENALTY ?? D(0)),
            ),
            unallocated: money(D(e.amount).minus(allocated)),
            externalReference: e.externalReference,
          };
        }),
        total,
        page,
        limit,
      };
    });
  }

  // ── Performance ──────────────────────────────────────────────────────────

  async performance(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    const scope = await this.loanScope(actor);
    const ledger = await this.policy.scopeFilter(actor, 'accounting.read');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const ctx = await this.context(tx, tenantId);
      const base = {
        businessDate: ctx.businessDate,
        reportingCurrency: ctx.reportingCurrency,
      };
      if (!scope)
        return {
          ...base,
          byCurrency: [],
          totals: null,
          unconverted: [],
          income: null,
        };
      const loanWhere = {
        tenantId,
        ...scope,
      } satisfies Prisma.LoanAccountWhereInput;
      const active = { ...loanWhere, status: 'ACTIVE' };
      const cut = fromLocalDate(ctx.businessDate);
      const [book, borrowers, events, dueLines] = await Promise.all([
        tx.loanAccount.groupBy({
          by: ['currency', 'daysPastDue'],
          where: active,
          _count: { _all: true },
          _sum: { principalOutstanding: true, allowance: true },
        }),
        tx.loanAccount.groupBy({ by: ['borrowerId'], where: active }),
        tx.financialEvent.groupBy({
          by: ['currency', 'type'],
          where: {
            tenantId,
            status: 'POSTED',
            type: { in: [...RECEIPT_EVENTS, 'DISBURSEMENT', 'WRITE_OFF'] },
            valueDate: { lte: cut },
            loanAccount: loanWhere,
          },
          _sum: { amount: true },
        }),
        tx.scheduleInstalment.findMany({
          where: {
            tenantId,
            status: { in: ['DUE', 'PAID'] },
            projected: false,
            dueDate: { lte: cut },
            loanAccount: loanWhere,
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
      ]);

      type Row = {
        activeLoans: number;
        principal: Dec;
        allowance: Dec;
        bands: Record<string, Dec>;
        par30: Dec;
        par90: Dec;
        disbursed: Dec;
        collected: Dec;
        writtenOff: Dec;
        dueToDate: Dec;
        paidToDate: Dec;
      };
      const per = new Map<string, Row>();
      const row = (c: string) => {
        let r = per.get(c);
        if (!r) {
          r = {
            activeLoans: 0,
            principal: D(0),
            allowance: D(0),
            bands: Object.fromEntries(AGEING_BANDS.map((b) => [b.code, D(0)])),
            par30: D(0),
            par90: D(0),
            disbursed: D(0),
            collected: D(0),
            writtenOff: D(0),
            dueToDate: D(0),
            paidToDate: D(0),
          };
          per.set(c, r);
        }
        return r;
      };
      for (const g of book) {
        const r = row(g.currency);
        const p = D(g._sum.principalOutstanding);
        r.activeLoans += g._count._all;
        r.principal = r.principal.plus(p);
        r.allowance = r.allowance.plus(D(g._sum.allowance));
        const band = bandOf(g.daysPastDue);
        r.bands[band] = r.bands[band].plus(p);
        if (g.daysPastDue > 30) r.par30 = r.par30.plus(p);
        if (g.daysPastDue > 90) r.par90 = r.par90.plus(p);
      }
      for (const e of events) {
        const r = row(e.currency);
        const a = D(e._sum.amount);
        if (e.type === 'DISBURSEMENT') r.disbursed = r.disbursed.plus(a);
        else if (e.type === 'WRITE_OFF') r.writtenOff = r.writtenOff.plus(a);
        else r.collected = r.collected.plus(a);
      }
      for (const l of dueLines) {
        const r = row(l.loanAccount.currency);
        r.dueToDate = r.dueToDate
          .plus(D(l.principalDue))
          .plus(D(l.interestDue))
          .plus(D(l.feeDue))
          .plus(D(l.taxDue))
          .plus(D(l.penaltyDue));
        r.paidToDate = r.paidToDate
          .plus(D(l.principalPaid))
          .plus(D(l.interestPaid))
          .plus(D(l.feePaid))
          .plus(D(l.taxPaid))
          .plus(D(l.penaltyPaid));
      }

      const unconverted = new Set<string>();
      const tot = {
        activeLoans: 0,
        principal: D(0),
        allowance: D(0),
        bands: Object.fromEntries(AGEING_BANDS.map((b) => [b.code, D(0)])),
        par30: D(0),
        par90: D(0),
        disbursed: D(0),
        collected: D(0),
        writtenOff: D(0),
        dueToDate: D(0),
        paidToDate: D(0),
      } as Row;
      const byCurrency = [...per.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([currency, r]) => {
          const rate = rateTo(ctx.rates, currency, ctx.reportingCurrency);
          tot.activeLoans += r.activeLoans;
          if (rate) {
            for (const k of [
              'principal',
              'allowance',
              'par30',
              'par90',
              'disbursed',
              'collected',
              'writtenOff',
              'dueToDate',
              'paidToDate',
            ] as const)
              tot[k] = tot[k].plus(r[k].times(rate));
            for (const b of AGEING_BANDS)
              tot.bands[b.code] = tot.bands[b.code].plus(
                r.bands[b.code].times(rate),
              );
          } else unconverted.add(currency);
          return { currency, ...figures(r) };
        });
      const income = ledger
        ? await this.income(tx, tenantId, ctx.businessDate)
        : null;
      return {
        ...base,
        borrowers: borrowers.length,
        byCurrency,
        totals: figures(tot),
        unconverted: [...unconverted].sort(),
        income,
      };
    });
  }

  /**
   * Income and expense of the lending journal for the year to the business
   * date, by ledger account and currency (accounts as the products and
   * settings map them). Organisation-wide: shown only to readers of the
   * lending accounts (`accounting.read`).
   */
  private async income(tx: Tx, tenantId: string, businessDate: string) {
    const from = `${businessDate.slice(0, 4)}-01-01`;
    const byCurrency = await tx.lendingJournalEntry.groupBy({
      by: ['currency'],
      where: {
        tenantId,
        entryDate: {
          gte: fromLocalDate(from),
          lte: fromLocalDate(businessDate),
        },
      },
    });
    const accounts = await tx.ledgerAccount.findMany({
      where: { tenantId, type: { in: ['INCOME', 'EXPENSE'] } },
      select: { id: true, code: true, name: true, type: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    // Lines are summed in each entry's own currency, never across currencies.
    const perCurrency: {
      currency: string;
      accounts: { code: string; name: string; type: string; amount: string }[];
      totalIncome: string;
      totalExpense: string;
      net: string;
    }[] = [];
    for (const { currency } of byCurrency.sort((a, b) =>
      a.currency.localeCompare(b.currency),
    )) {
      const sums = await tx.lendingJournalLine.groupBy({
        by: ['accountId'],
        where: {
          tenantId,
          accountId: { in: [...byId.keys()] },
          entry: {
            currency,
            entryDate: {
              gte: fromLocalDate(from),
              lte: fromLocalDate(businessDate),
            },
          },
        },
        _sum: { debit: true, credit: true },
      });
      const rows = sums
        .map((s) => {
          const a = byId.get(s.accountId)!;
          const net =
            a.type === 'INCOME'
              ? D(s._sum.credit).minus(D(s._sum.debit))
              : D(s._sum.debit).minus(D(s._sum.credit));
          return { code: a.code, name: a.name, type: a.type, amount: net };
        })
        .filter((r) => !r.amount.isZero())
        .sort((a, b) => a.code.localeCompare(b.code));
      const totalIncome = rows
        .filter((r) => r.type === 'INCOME')
        .reduce((t, r) => t.plus(r.amount), D(0));
      const totalExpense = rows
        .filter((r) => r.type === 'EXPENSE')
        .reduce((t, r) => t.plus(r.amount), D(0));
      perCurrency.push({
        currency,
        accounts: rows.map((r) => ({ ...r, amount: money(r.amount) })),
        totalIncome: money(totalIncome),
        totalExpense: money(totalExpense),
        net: money(totalIncome.minus(totalExpense)),
      });
    }
    return { from, to: businessDate, byCurrency: perCurrency };
  }

  // ── CSV exports ──────────────────────────────────────────────────────────

  async portfolioCsv(actor: LendingActor, q: PortfolioQuery) {
    await this.mayExport(actor);
    const rows: string[][] = [];
    for (let page = 1; ; page++) {
      const r = await this.portfolio(actor, { ...q, page, limit: PAGE_MAX });
      for (const l of r.data)
        rows.push([
          l.reference,
          l.borrowerName,
          l.branch,
          l.product,
          l.status,
          l.currency,
          l.bookedPrincipal,
          l.principalOutstanding,
          l.interestReceivable,
          l.chargesReceivable,
          String(l.daysPastDue),
          l.band,
          l.classification ?? '',
          l.disbursementDate ?? '',
          l.maturityDate ?? '',
        ]);
      if (page * PAGE_MAX >= r.total) break;
    }
    await this.exported(actor, 'lending-portfolio', rows.length);
    return csv(
      [
        'reference',
        'borrower',
        'branch',
        'product',
        'status',
        'currency',
        'booked_principal',
        'principal_outstanding',
        'interest_receivable',
        'charges_receivable',
        'days_past_due',
        'ageing_band',
        'classification',
        'disbursement_date',
        'maturity_date',
      ],
      rows,
    );
  }

  async receiptsCsv(actor: LendingActor, q: ReceiptsQuery) {
    await this.mayExport(actor);
    const rows: string[][] = [];
    for (let page = 1; ; page++) {
      const r = await this.receipts(actor, { ...q, page, limit: PAGE_MAX });
      for (const e of r.data)
        rows.push([
          e.valueDate ?? '',
          e.reference ?? '',
          e.borrowerName ?? '',
          e.type,
          e.currency,
          e.amount,
          e.principal,
          e.interest,
          e.charges,
          e.unallocated,
          e.externalReference ?? '',
        ]);
      if (page * PAGE_MAX >= r.total) break;
    }
    await this.exported(actor, 'lending-receipts', rows.length);
    return csv(
      [
        'value_date',
        'reference',
        'borrower',
        'type',
        'currency',
        'amount',
        'principal',
        'interest',
        'charges',
        'unallocated',
        'external_reference',
      ],
      rows,
    );
  }

  private async mayExport(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_data.export',
      tenantResource(tenantId),
    );
  }

  private async exported(actor: LendingActor, report: string, rows: number) {
    const tenantId = requireTenant(actor);
    await this.audit.write({
      actor,
      action: 'loan_data.export',
      resourceType: 'Tenant',
      resourceId: tenantId,
      outcome: 'SUCCESS',
      details: { report, rows },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async filterOptions(
    tx: Tx,
    tenantId: string,
    scope: Prisma.LoanAccountWhereInput | null,
  ) {
    if (!scope) return { branches: [], products: [], currencies: [] };
    const where = { tenantId, ...scope };
    const [branches, products, currencies] = await Promise.all([
      tx.loanAccount.groupBy({ by: ['branchId'], where }),
      tx.loanAccount.groupBy({ by: ['productId'], where }),
      tx.loanAccount.groupBy({ by: ['currency'], where }),
    ]);
    const [b, p] = await Promise.all([
      tx.branch.findMany({
        where: { tenantId, id: { in: branches.map((x) => x.branchId) } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      tx.lendingProduct.findMany({
        where: { tenantId, id: { in: products.map((x) => x.productId) } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      branches: b,
      products: p,
      currencies: currencies.map((c) => c.currency).sort(),
    };
  }

  private async names(
    tx: Tx,
    tenantId: string,
    rows: { borrowerId: string; branchId: string; productId: string }[],
  ) {
    const [borrowers, branches, products] = await Promise.all([
      this.borrowerNames(
        tx,
        tenantId,
        rows.map((r) => r.borrowerId),
      ),
      tx.branch.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.branchId))] },
        },
        select: { id: true, name: true },
      }),
      tx.lendingProduct.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.productId))] },
        },
        select: { id: true, name: true },
      }),
    ]);
    return {
      borrowers,
      branches: new Map(branches.map((b) => [b.id, b.name])),
      products: new Map(products.map((p) => [p.id, p.name])),
    };
  }

  private async borrowerNames(tx: Tx, tenantId: string, ids: string[]) {
    const rows = await tx.borrower.findMany({
      where: { tenantId, id: { in: [...new Set(ids)] } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      rows.map((b) => [b.id, `${b.firstName} ${b.lastName}`.trim()]),
    );
  }

  private async allocationSplit(tx: Tx, tenantId: string, eventIds: string[]) {
    const out = new Map<string, Record<string, Dec>>();
    if (!eventIds.length) return out;
    const rows = await tx.paymentAllocation.groupBy({
      by: ['financialEventId', 'component'],
      where: {
        tenantId,
        financialEventId: { in: eventIds },
        component: { in: ALLOCATION_COMPONENTS },
      },
      _sum: { amount: true },
    });
    for (const r of rows) {
      const m = out.get(r.financialEventId) ?? {};
      m[r.component] = (m[r.component] ?? D(0)).plus(D(r._sum.amount));
      out.set(r.financialEventId, m);
    }
    return out;
  }
}

function paging(q: { page?: number; limit?: number }) {
  return {
    page: Math.max(1, Math.floor(Number(q.page) || 1)),
    limit: Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(q.limit) || 25))),
  };
}

export function bandOf(dpd: number): string {
  for (const b of AGEING_BANDS)
    if (dpd >= b.min && (b.max === null || dpd <= b.max)) return b.code;
  return 'CURRENT';
}

function portfolioWhere(
  tenantId: string,
  scope: Prisma.LoanAccountWhereInput,
  q: PortfolioQuery,
): Prisma.LoanAccountWhereInput {
  const and: Prisma.LoanAccountWhereInput[] = [{ tenantId }, scope];
  const status = typeof q.status === 'string' ? q.status : '';
  and.push(
    LOAN_STATUSES.includes(status)
      ? { status }
      : { status: { in: ['BOOKED', 'ACTIVE'] } },
  );
  if (typeof q.currency === 'string' && /^[A-Z]{3}$/.test(q.currency))
    and.push({ currency: q.currency });
  if (typeof q.branchId === 'string' && q.branchId)
    and.push({ branchId: q.branchId });
  if (typeof q.productId === 'string' && q.productId)
    and.push({ productId: q.productId });
  const band = AGEING_BANDS.find((b) => b.code === q.band);
  if (band)
    and.push({
      daysPastDue:
        band.max === null
          ? { gte: band.min }
          : { gte: band.min, lte: band.max },
    });
  const text = typeof q.q === 'string' ? q.q.trim().slice(0, 80) : '';
  if (text) and.push({ reference: { contains: text, mode: 'insensitive' } });
  return { AND: and };
}

function receiptsWhere(
  tenantId: string,
  scope: Prisma.LoanAccountWhereInput,
  range: { from: string; to: string },
  currency?: string,
): Prisma.FinancialEventWhereInput {
  return {
    tenantId,
    status: 'POSTED',
    type: { in: RECEIPT_EVENTS },
    valueDate: { gte: fromLocalDate(range.from), lte: fromLocalDate(range.to) },
    loanAccount: { tenantId, ...scope },
    ...(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)
      ? { currency }
      : {}),
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The report's dates: given ones when valid, else the business month to date. */
export function dateRange(
  q: { from?: string; to?: string },
  businessDate: string,
) {
  const to =
    typeof q.to === 'string' && ISO_DAY.test(q.to) ? q.to : businessDate;
  const from =
    typeof q.from === 'string' && ISO_DAY.test(q.from)
      ? q.from
      : `${to.slice(0, 7)}-01`;
  return from <= to ? { from, to } : { from: to, to: from };
}

function figures(r: {
  activeLoans: number;
  principal: Dec;
  allowance: Dec;
  bands: Record<string, Dec>;
  par30: Dec;
  par90: Dec;
  disbursed: Dec;
  collected: Dec;
  writtenOff: Dec;
  dueToDate: Dec;
  paidToDate: Dec;
}) {
  return {
    activeLoans: r.activeLoans,
    principalOutstanding: money(r.principal),
    allowance: money(r.allowance),
    ageing: AGEING_BANDS.map((b) => ({
      band: b.code,
      amount: money(r.bands[b.code]),
    })),
    par30Pct: pct(r.par30, r.principal),
    par90Pct: pct(r.par90, r.principal),
    allowanceCoveragePct: pct(r.allowance, r.principal),
    disbursed: money(r.disbursed),
    collected: money(r.collected),
    writtenOff: money(r.writtenOff),
    writeOffRatePct: pct(r.writtenOff, r.disbursed),
    collectionRatePct: pct(r.paidToDate, r.dueToDate),
  };
}

function csv(header: string[], rows: string[][]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return (
    [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') +
    '\n'
  );
}
