import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import { ACCOUNT_CODES } from '../ledger/chart-of-accounts';
import type { JwtPayload } from '../auth/jwt.strategy';

const DAY = 24 * 60 * 60 * 1000;
function round(n: number, dp = 2) { const f = Math.pow(10, dp); return Math.round(n * f) / f; }
function pct(num: number, den: number) { return den > 0 ? round((num / den) * 100, 2) : 0; }

// Profitability / portfolio KPIs computed from the GL + loan data. Treasury
// (cost of funds / NIM) is intentionally out of scope in this build.
@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
  ) {}

  async overview(actor: JwtPayload) {
    this.authz.assertPermission(actor as any, Permission.LEDGER_VIEW);
    const now = Date.now();
    const loanScope = this.authz.scopeWhere(actor as any, { status: 'DISBURSED' } as any);

    // ── Portfolio + PAR aging (from live schedules of disbursed loans) ────────
    const scheds = await this.prisma.repaymentSchedule.findMany({
      where: { loan: loanScope as any },
      select: {
        loanId: true, dueDate: true, isPaid: true,
        principalAmount: true, paidPrincipal: true,
        totalAmount: true, paidInterest: true, paidPenalty: true,
      },
    });

    const perLoan = new Map<string, { outstanding: number; maxOverdueDays: number }>();
    let dueToDate = 0;
    let paidToDate = 0;
    for (const s of scheds) {
      const remainingPrincipal = Math.max(0, Number(s.principalAmount) - Number(s.paidPrincipal));
      const rec = perLoan.get(s.loanId) || { outstanding: 0, maxOverdueDays: 0 };
      rec.outstanding += remainingPrincipal;
      if (!s.isPaid && new Date(s.dueDate).getTime() < now) {
        const overdue = Math.floor((now - new Date(s.dueDate).getTime()) / DAY);
        if (overdue > rec.maxOverdueDays) rec.maxOverdueDays = overdue;
      }
      perLoan.set(s.loanId, rec);

      // Collection efficiency: due vs paid on installments due by now.
      if (new Date(s.dueDate).getTime() <= now) {
        dueToDate += Number(s.totalAmount);
        paidToDate += Number(s.paidPrincipal) + Number(s.paidInterest) + Number(s.paidPenalty);
      }
    }

    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    let gross = 0;
    let par30 = 0;
    let par90 = 0;
    for (const { outstanding, maxOverdueDays } of perLoan.values()) {
      gross += outstanding;
      if (maxOverdueDays <= 0) buckets.current += outstanding;
      else if (maxOverdueDays <= 30) buckets.d1_30 += outstanding;
      else if (maxOverdueDays <= 60) buckets.d31_60 += outstanding;
      else if (maxOverdueDays <= 90) buckets.d61_90 += outstanding;
      else buckets.d90plus += outstanding;
      if (maxOverdueDays > 30) par30 += outstanding;
      if (maxOverdueDays > 90) par90 += outstanding;
    }

    // ── GL income / expense ───────────────────────────────────────────────────
    const [accounts, grouped] = await Promise.all([
      this.prisma.ledgerAccount.findMany({
        where: this.authz.scopeWhere(actor as any, {}),
        select: { id: true, code: true },
      }),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: { entry: this.authz.scopeWhere(actor as any, {}) as any },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const codeById = new Map(accounts.map((a) => [a.id, a.code]));
    const netByCode = new Map<string, { debit: number; credit: number }>();
    for (const g of grouped) {
      const code = codeById.get(g.accountId);
      if (!code) continue;
      netByCode.set(code, { debit: Number(g._sum.debit || 0), credit: Number(g._sum.credit || 0) });
    }
    const incomeOf = (code: string) => { const v = netByCode.get(code); return v ? round(v.credit - v.debit, 2) : 0; };
    const expenseOf = (code: string) => { const v = netByCode.get(code); return v ? round(v.debit - v.credit, 2) : 0; };

    const interest = incomeOf(ACCOUNT_CODES.INTEREST_INCOME);
    const penalty = incomeOf(ACCOUNT_CODES.PENALTY_INCOME);
    const fee = incomeOf(ACCOUNT_CODES.FEE_INCOME);
    const provisionExpense = expenseOf(ACCOUNT_CODES.PROVISION_EXPENSE);
    const writeOffExpense = expenseOf(ACCOUNT_CODES.WRITE_OFF_EXPENSE);
    const totalIncome = round(interest + penalty + fee, 2);
    const totalExpense = round(provisionExpense + writeOffExpense, 2);

    // ── Aggregate counts & totals ────────────────────────────────────────────
    const scope = this.authz.scopeWhere(actor as any, {});
    const [disbursedAgg, collectedAgg, activeLoans, borrowers, latestProvision, onTimeAgg, lateAgg] = await Promise.all([
      this.prisma.loan.aggregate({ _sum: { principal: true }, where: { ...(scope as any), status: { in: ['DISBURSED', 'CLOSED', 'DEFAULTED', 'WRITTEN_OFF'] } } }),
      this.prisma.repayment.aggregate({ _sum: { amount: true }, where: { ...(scope as any), reversedAt: null } }),
      this.prisma.loan.count({ where: { ...(scope as any), status: 'DISBURSED' } }),
      this.prisma.borrower.count({ where: scope as any }),
      this.prisma.provisionRun.findFirst({ where: scope as any, orderBy: { runDate: 'desc' }, select: { totalProvision: true, runDate: true } }),
      this.prisma.repaymentSchedule.count({ where: { loan: scope as any, isPaid: true, penaltyAmount: 0 } }),
      this.prisma.repaymentSchedule.count({ where: { loan: scope as any, isPaid: true, penaltyAmount: { gt: 0 } } }),
    ]);

    const totalDisbursed = Number(disbursedAgg._sum.principal || 0);
    const totalCollected = Number(collectedAgg._sum.amount || 0);
    const allowance = Number(latestProvision?.totalProvision || 0);
    const paidInstallments = onTimeAgg + lateAgg;

    return {
      asOf: new Date(now).toISOString(),
      portfolio: {
        grossOutstanding: round(gross, 2),
        activeLoans,
        borrowers,
        totalDisbursed: round(totalDisbursed, 2),
        totalCollected: round(totalCollected, 2),
      },
      par: {
        buckets: {
          current: round(buckets.current, 2),
          d1_30: round(buckets.d1_30, 2),
          d31_60: round(buckets.d31_60, 2),
          d61_90: round(buckets.d61_90, 2),
          d90plus: round(buckets.d90plus, 2),
        },
        par30Pct: pct(par30, gross),
        par90Pct: pct(par90, gross),
      },
      income: { interest, penalty, fee, total: totalIncome },
      expense: { provision: provisionExpense, writeOff: writeOffExpense, total: totalExpense },
      netOperatingIncome: round(totalIncome - totalExpense, 2),
      ratios: {
        interestYieldPct: pct(interest, gross), // interest earned to date vs gross portfolio
        provisionCoveragePct: pct(allowance, gross),
        collectionRatePct: pct(paidToDate, dueToDate),
        onTimeRepaymentPct: pct(onTimeAgg, paidInstallments),
        writeOffRatePct: pct(expenseOf(ACCOUNT_CODES.WRITE_OFF_EXPENSE), totalDisbursed),
      },
      notes: [
        'Net interest margin and cost-to-income require the Treasury module (cost of funds / OPEX), which is not enabled in this build.',
        'Interest yield is cumulative interest income to date over the current gross portfolio, not annualised.',
      ],
    };
  }
}
