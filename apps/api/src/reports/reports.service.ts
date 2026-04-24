import { BadRequestException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import { canonicalRole } from '../authz/role-permissions';
import { ReportQueryDto } from './dto/report-query.dto';
import * as XLSX from 'xlsx';

type Pagination = { page: number; limit: number; total: number };

function n(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function csvSafe(value: unknown): string {
  const s = String(value ?? '');
  if (s.length > 0 && ['=', '+', '-', '@', '\t', '\r'].includes(s[0])) {
    return `'${s.replace(/"/g, '""')}`;
  }
  return s.replace(/"/g, '""');
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
  ) {}

  private normalize(actor: JwtPayload, query: ReportQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 200) : 20;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (to) to.setHours(23, 59, 59, 999);

    if (query.currency && query.currency.toUpperCase() !== 'USD') {
      return { emptyCurrency: true, page, limit, from, to };
    }

    if (!this.authz.isPlatform(actor) && query.tenantId && query.tenantId !== actor.tenantId) {
      throw new BadRequestException('Invalid tenant scope');
    }

    return { page, limit, from, to, emptyCurrency: false };
  }

  private baseLoanWhere(actor: JwtPayload, query: ReportQueryDto, from?: Date, to?: Date) {
    const where: any = this.authz.scopeWhere(actor, {});
    const actorRole = canonicalRole(actor.role);
    if (this.authz.isPlatform(actor) && query.tenantId) where.tenantId = query.tenantId;
    if (query.branchId) where.branchId = query.branchId;
    if (actor.branchId) where.branchId = actor.branchId;
    if (query.loanOfficerId) where.createdByUserId = query.loanOfficerId;
    if (actorRole === 'LOAN_OFFICER') where.createdByUserId = actor.sub;
    if (query.productId) where.productId = query.productId;
    if (query.status) where.status = query.status as any;
    if (query.borrowerId) where.borrowerId = query.borrowerId;
    if (query.search) {
      where.OR = [
        { id: { contains: query.search, mode: 'insensitive' } },
        { borrower: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { borrower: { lastName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    if (from || to) where.startDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    return where;
  }

  private baseRepaymentWhere(actor: JwtPayload, query: ReportQueryDto, from?: Date, to?: Date) {
    const where: any = this.authz.scopeWhere(actor, {});
    const actorRole = canonicalRole(actor.role);
    if (this.authz.isPlatform(actor) && query.tenantId) where.tenantId = query.tenantId;
    if (query.borrowerId) where.loan = { ...(where.loan || {}), borrowerId: query.borrowerId };
    if (query.loanOfficerId) where.loan = { ...(where.loan || {}), createdByUserId: query.loanOfficerId };
    if (actorRole === 'LOAN_OFFICER') where.loan = { ...(where.loan || {}), createdByUserId: actor.sub };
    if (query.branchId) where.loan = { ...(where.loan || {}), branchId: query.branchId };
    if (actor.branchId) where.loan = { ...(where.loan || {}), branchId: actor.branchId };
    if (query.search) {
      where.OR = [
        { id: { contains: query.search, mode: 'insensitive' } },
        { loanId: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    return where;
  }

  private riskGrade(daysPastDue: number, explicit?: string | null): string {
    if (explicit) return explicit;
    if (daysPastDue <= 0) return 'Low';
    if (daysPastDue <= 30) return 'Medium';
    if (daysPastDue <= 90) return 'High';
    return 'Critical';
  }

  private loanOutstandingAndDPD(loan: any) {
    const now = new Date();
    let outstanding = 0;
    let oldestDue: Date | null = null;
    for (const s of loan.schedules || []) {
      const duePrincipal = Math.max(0, n(s.principalAmount) - n(s.paidPrincipal));
      const dueInterest = Math.max(0, n(s.interestAmount) - n(s.paidInterest));
      const duePenalty = Math.max(0, n(s.penaltyAmount) - n(s.paidPenalty));
      const due = duePrincipal + dueInterest + duePenalty;
      outstanding += due;
      if (!s.isPaid && new Date(s.dueDate) < now) {
        if (!oldestDue || new Date(s.dueDate) < oldestDue) oldestDue = new Date(s.dueDate);
      }
    }
    const daysPastDue = oldestDue ? Math.floor((now.getTime() - oldestDue.getTime()) / 86400000) : 0;
    return { outstanding, daysPastDue };
  }

  async overview(actor: JwtPayload, query: ReportQueryDto) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const nrm = this.normalize(actor, query);
    if (nrm.emptyCurrency) {
      return {
        filters: query,
        kpis: {},
        charts: {},
        rows: [],
        pagination: { page: nrm.page, limit: nrm.limit, total: 0 },
      };
    }

    const loanWhere = this.baseLoanWhere(actor, query, nrm.from, nrm.to);
    const repaymentWhere = this.baseRepaymentWhere(actor, query, nrm.from, nrm.to);

    const [loans, borrowersCount, monthlyCollection, repayments] = await Promise.all([
      this.prisma.loan.findMany({
        where: loanWhere,
        include: { schedules: true, borrower: true, product: true, branch: true },
      }),
      this.prisma.borrower.count({ where: this.authz.scopeWhere(actor, {}) }),
      this.prisma.repayment.aggregate({
        where: repaymentWhere,
        _sum: { amount: true },
      }),
      this.prisma.repayment.findMany({ where: repaymentWhere, orderBy: { date: 'asc' }, take: 1000 }),
    ]);

    let outstanding = 0;
    let par30 = 0;
    let npl = 0;
    const disbByMonth: Record<string, number> = {};
    const collByMonth: Record<string, number> = {};
    const riskBreakdown: Record<string, number> = {};
    const overdueRows: any[] = [];

    for (const loan of loans) {
      const { outstanding: out, daysPastDue } = this.loanOutstandingAndDPD(loan);
      outstanding += out;
      if (daysPastDue >= 30) par30 += out;
      if (daysPastDue >= 90 || loan.status === 'DEFAULTED') npl += out;
      const risk = this.riskGrade(daysPastDue, loan.creditRatingApplied);
      riskBreakdown[risk] = (riskBreakdown[risk] || 0) + out;
      const mk = monthKey(new Date(loan.startDate));
      disbByMonth[mk] = (disbByMonth[mk] || 0) + n(loan.principal);
      if (daysPastDue > 0) {
        overdueRows.push({
          loanId: loan.id,
          borrower: `${loan.borrower?.firstName || ''} ${loan.borrower?.lastName || ''}`.trim(),
          branch: loan.branch?.name || 'Unassigned',
          outstandingBalance: out,
          daysPastDue,
          status: loan.status,
        });
      }
    }
    for (const r of repayments) {
      const mk = monthKey(new Date(r.date));
      collByMonth[mk] = (collByMonth[mk] || 0) + n(r.amount);
    }

    const allMonths = Array.from(new Set([...Object.keys(disbByMonth), ...Object.keys(collByMonth)])).sort();
    const disbursementTrend = allMonths.map((m) => ({ month: m, amount: disbByMonth[m] || 0 }));
    const collectionTrend = allMonths.map((m) => ({ month: m, amount: collByMonth[m] || 0 }));
    const riskTrend = Object.entries(riskBreakdown).map(([name, value]) => ({ name, value }));

    const result = {
      filters: query,
      kpis: {
        totalPortfolioOutstanding: outstanding,
        totalBorrowers: borrowersCount,
        activeLoans: loans.filter((l) => l.status === 'DISBURSED').length,
        monthlyCollection: n(monthlyCollection._sum.amount),
        par30Amount: par30,
        par30Pct: pct(par30, outstanding),
        nplAmount: npl,
        nplRatio: pct(npl, outstanding),
      },
      charts: {
        disbursementTrend,
        collectionTrend,
        riskBreakdown: riskTrend,
      },
      rows: overdueRows
        .sort((a, b) => b.daysPastDue - a.daysPastDue)
        .slice((nrm.page - 1) * nrm.limit, nrm.page * nrm.limit),
      pagination: {
        page: nrm.page,
        limit: nrm.limit,
        total: overdueRows.length,
      } as Pagination,
    };

    return result;
  }

  async loanPortfolio(actor: JwtPayload, query: ReportQueryDto) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const nrm = this.normalize(actor, query);
    if (nrm.emptyCurrency) return { filters: query, kpis: {}, charts: {}, rows: [], pagination: { page: nrm.page, limit: nrm.limit, total: 0 } };
    const where = this.baseLoanWhere(actor, query, nrm.from, nrm.to);
    const sortOrder = (query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const sortBy = query.sortBy || 'startDate';

    const loans = await this.prisma.loan.findMany({
      where,
      include: {
        borrower: true,
        product: true,
        branch: true,
        schedules: true,
        tenant: true,
      },
      orderBy: { [sortBy]: sortOrder as any },
    });

    const rows = loans.map((loan) => {
      const { outstanding, daysPastDue } = this.loanOutstandingAndDPD(loan);
      const risk = this.riskGrade(daysPastDue, loan.creditRatingApplied);
      return {
        loanId: loan.id,
        borrowerName: `${loan.borrower?.firstName || ''} ${loan.borrower?.lastName || ''}`.trim(),
        branch: loan.branch?.name || 'Unassigned',
        loanOfficer: loan.createdByUserId || 'N/A',
        product: loan.product?.name || 'N/A',
        principal: n(loan.principal),
        outstandingBalance: outstanding,
        interestRate: n(loan.annualInterestRate),
        term: loan.termMonths,
        disbursementDate: loan.startDate,
        maturityDate: loan.schedules?.length ? loan.schedules[loan.schedules.length - 1].dueDate : null,
        status: loan.status,
        daysPastDue,
        riskGrade: risk,
        currency: 'USD',
        tenantId: loan.tenantId,
      };
    }).filter((r) => !query.riskGrade || r.riskGrade.toLowerCase() === query.riskGrade.toLowerCase());

    const totalOutstanding = rows.reduce((acc, r) => acc + r.outstandingBalance, 0);
    const disbursedAmount = rows.reduce((acc, r) => acc + r.principal, 0);
    const avgRate = rows.length ? rows.reduce((acc, r) => acc + r.interestRate, 0) / rows.length : 0;
    const par1 = rows.filter((r) => r.daysPastDue >= 1).reduce((a, r) => a + r.outstandingBalance, 0);
    const par7 = rows.filter((r) => r.daysPastDue >= 7).reduce((a, r) => a + r.outstandingBalance, 0);
    const par30 = rows.filter((r) => r.daysPastDue >= 30).reduce((a, r) => a + r.outstandingBalance, 0);
    const nplAmount = rows.filter((r) => r.daysPastDue >= 90 || r.status === 'DEFAULTED').reduce((a, r) => a + r.outstandingBalance, 0);

    const byStatus = Object.values(rows.reduce((m: Record<string, number>, r) => {
      m[r.status] = (m[r.status] || 0) + r.outstandingBalance;
      return m;
    }, {})).length;

    const byStatusChart = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.status] = (m[r.status] || 0) + r.outstandingBalance;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const byProductChart = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.product] = (m[r.product] || 0) + r.outstandingBalance;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const byBranchChart = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.branch] = (m[r.branch] || 0) + r.outstandingBalance;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const disbTrend = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      const mk = monthKey(new Date(r.disbursementDate));
      m[mk] = (m[mk] || 0) + r.principal;
      return m;
    }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));

    const parTrend = [
      { bucket: 'PAR1', value: par1 },
      { bucket: 'PAR7', value: par7 },
      { bucket: 'PAR30', value: par30 },
    ];

    const total = rows.length;
    const paged = rows.slice((nrm.page - 1) * nrm.limit, nrm.page * nrm.limit);

    return {
      filters: query,
      kpis: {
        totalOutstandingPrincipal: totalOutstanding,
        totalActiveLoans: rows.filter((r) => ['PENDING', 'APPROVED', 'DISBURSED'].includes(r.status)).length,
        totalDisbursedAmount: disbursedAmount,
        averageInterestRate: avgRate,
        par1,
        par7,
        par30,
        nplAmount,
        portfolioAtRiskPercentage: pct(par30, totalOutstanding),
      },
      charts: {
        outstandingByStatus: byStatusChart,
        disbursementTrend: disbTrend,
        parTrend,
        distributionByProduct: byProductChart,
        distributionByBranch: byBranchChart,
        _meta: { byStatus },
      },
      rows: paged,
      pagination: { page: nrm.page, limit: nrm.limit, total },
    };
  }

  async collections(actor: JwtPayload, query: ReportQueryDto) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const nrm = this.normalize(actor, query);
    if (nrm.emptyCurrency) return { filters: query, kpis: {}, charts: {}, rows: [], pagination: { page: nrm.page, limit: nrm.limit, total: 0 } };
    const where = this.baseRepaymentWhere(actor, query, nrm.from, nrm.to);

    const repayments = await this.prisma.repayment.findMany({
      where,
      include: { loan: { include: { borrower: true, branch: true, schedules: true } } },
      orderBy: { date: 'desc' },
    });

    const rows = repayments.map((r) => {
      const due = r.loan?.schedules?.find?.((s: any) => !s.isPaid)?.dueDate || r.date;
      const daysLate = Math.max(0, Math.floor((new Date(r.date).getTime() - new Date(due).getTime()) / 86400000));
      return {
        repaymentId: r.id,
        loanId: r.loanId,
        borrower: `${r.loan?.borrower?.firstName || ''} ${r.loan?.borrower?.lastName || ''}`.trim(),
        branch: r.loan?.branch?.name || 'Unassigned',
        collector: r.loan?.createdByUserId || 'N/A',
        paymentDate: r.date,
        dueDate: due,
        amountPaid: n(r.amount),
        principalPaid: n(r.principalPaid),
        interestPaid: n(r.interestPaid),
        penaltyPaid: n(r.penaltyPaid),
        paymentMethod: 'CASH',
        status: daysLate > 0 ? 'LATE' : 'ON_TIME',
        daysLate,
        currency: 'USD',
      };
    }).filter((r) => !query.status || r.status === query.status);

    const totalCollected = rows.reduce((a, r) => a + r.amountPaid, 0);
    const principalCollected = rows.reduce((a, r) => a + r.principalPaid, 0);
    const interestCollected = rows.reduce((a, r) => a + r.interestPaid, 0);
    const penaltyCollected = rows.reduce((a, r) => a + r.penaltyPaid, 0);
    const overdueCollected = rows.filter((r) => r.daysLate > 0).reduce((a, r) => a + r.amountPaid, 0);
    const missedRepayments = rows.filter((r) => r.status === 'LATE').length;

    const trend = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      const k = monthKey(new Date(r.paymentDate));
      m[k] = (m[k] || 0) + r.amountPaid;
      return m;
    }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));

    const statusBreakdown = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.status] = (m[r.status] || 0) + r.amountPaid;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const byBranch = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.branch] = (m[r.branch] || 0) + r.amountPaid;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const byOfficer = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.collector] = (m[r.collector] || 0) + r.amountPaid;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const total = rows.length;
    const paged = rows.slice((nrm.page - 1) * nrm.limit, nrm.page * nrm.limit);

    return {
      filters: query,
      kpis: {
        totalCollected,
        principalCollected,
        interestCollected,
        penaltyCollected,
        numberOfRepayments: rows.length,
        collectionRate: pct(totalCollected, totalCollected + missedRepayments),
        overdueCollected,
        missedRepayments,
      },
      charts: {
        collectionTrend: trend,
        principalVsInterest: [
          { name: 'Principal', value: principalCollected },
          { name: 'Interest', value: interestCollected },
          { name: 'Penalty', value: penaltyCollected },
        ],
        repaymentStatusBreakdown: statusBreakdown,
        paymentMethodDistribution: [{ name: 'CASH', value: totalCollected }],
        branchPerformance: byBranch,
        loanOfficerPerformance: byOfficer,
      },
      rows: paged,
      pagination: { page: nrm.page, limit: nrm.limit, total },
    };
  }

  async borrowers(actor: JwtPayload, query: ReportQueryDto) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const nrm = this.normalize(actor, query);
    if (nrm.emptyCurrency) return { filters: query, kpis: {}, charts: {}, rows: [], pagination: { page: nrm.page, limit: nrm.limit, total: 0 } };

    const where: any = this.authz.scopeWhere(actor, {});
    if (this.authz.isPlatform(actor) && query.tenantId) where.tenantId = query.tenantId;
    if (query.branchId) where.branchId = query.branchId;
    if (actor.branchId) where.branchId = actor.branchId;
    if (canonicalRole(actor.role) === 'LOAN_OFFICER') {
      where.loans = {
        some: {
          createdByUserId: actor.sub,
        },
      };
    }
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (nrm.from || nrm.to) where.createdAt = { ...(nrm.from ? { gte: nrm.from } : {}), ...(nrm.to ? { lte: nrm.to } : {}) };

    const borrowers = await this.prisma.borrower.findMany({
      where,
      include: { loans: { include: { schedules: true } }, branch: true },
      orderBy: { createdAt: 'desc' },
    });

    const rows = borrowers.map((b) => {
      const activeLoans = b.loans.filter((l) => ['PENDING', 'APPROVED', 'DISBURSED'].includes(l.status));
      const activeLoanCount = activeLoans.length;
      const outstanding = activeLoans.reduce((acc, l) => {
        const due = (l.schedules || []).reduce((a, s) => a + Math.max(0, n(s.totalAmount) - (n(s.paidPrincipal) + n(s.paidInterest) + n(s.paidPenalty))), 0);
        return acc + due;
      }, 0);
      const maxDpd = Math.max(0, ...activeLoans.map((l) => this.loanOutstandingAndDPD(l).daysPastDue));
      const risk = this.riskGrade(maxDpd, undefined);
      return {
        borrowerId: b.id,
        name: `${b.firstName} ${b.lastName}`.trim(),
        phone: b.phone || '',
        idNumber: b.idNumber || '',
        branch: b.branch?.name || 'Unassigned',
        occupation: 'N/A',
        registrationDate: b.createdAt,
        kycStatus: b.idNumber ? 'COMPLETE' : 'INCOMPLETE',
        activeLoanCount,
        outstandingBalance: outstanding,
        riskGrade: risk,
        status: activeLoanCount > 0 ? 'ACTIVE' : 'INACTIVE',
        currency: 'USD',
      };
    }).filter((r) => !query.riskGrade || r.riskGrade.toLowerCase() === query.riskGrade.toLowerCase());

    const totalBorrowers = rows.length;
    const activeBorrowers = rows.filter((r) => r.status === 'ACTIVE').length;
    const newBorrowersThisMonth = rows.filter((r) => {
      const d = new Date(r.registrationDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const withActiveLoans = rows.filter((r) => r.activeLoanCount > 0).length;
    const avgLoanSize = withActiveLoans ? rows.reduce((a, r) => a + r.outstandingBalance, 0) / withActiveLoans : 0;
    const highRiskBorrowers = rows.filter((r) => ['High', 'Critical'].includes(r.riskGrade)).length;
    const incompleteKyc = rows.filter((r) => r.kycStatus !== 'COMPLETE').length;

    const growth = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      const k = monthKey(new Date(r.registrationDate));
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value }));

    const byBranch = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.branch] = (m[r.branch] || 0) + 1;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const byOcc = [{ name: 'N/A', value: rows.length }];
    const byRisk = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.riskGrade] = (m[r.riskGrade] || 0) + 1;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));
    const byKyc = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.kycStatus] = (m[r.kycStatus] || 0) + 1;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const total = rows.length;
    const paged = rows.slice((nrm.page - 1) * nrm.limit, nrm.page * nrm.limit);

    return {
      filters: query,
      kpis: {
        totalBorrowers,
        activeBorrowers,
        newBorrowersThisMonth,
        borrowersWithActiveLoans: withActiveLoans,
        averageLoanSize: avgLoanSize,
        highRiskBorrowers,
        incompleteKycCount: incompleteKyc,
      },
      charts: {
        borrowerGrowth: growth,
        distributionByBranch: byBranch,
        distributionByOccupation: byOcc,
        riskGradeBreakdown: byRisk,
        kycCompletionStatus: byKyc,
      },
      rows: paged,
      pagination: { page: nrm.page, limit: nrm.limit, total },
    };
  }

  async risk(actor: JwtPayload, query: ReportQueryDto) {
    this.authz.assertPermission(actor, Permission.AUDIT_VIEW);
    const nrm = this.normalize(actor, query);
    if (nrm.emptyCurrency) return { filters: query, kpis: {}, charts: {}, rows: [], pagination: { page: nrm.page, limit: nrm.limit, total: 0 } };
    const where = this.baseLoanWhere(actor, query, nrm.from, nrm.to);
    const loans = await this.prisma.loan.findMany({
      where,
      include: { borrower: true, branch: true, product: true, schedules: true },
      orderBy: { startDate: 'desc' },
    });

    const rows = loans.map((loan) => {
      const { outstanding, daysPastDue } = this.loanOutstandingAndDPD(loan);
      const overdueAmount = daysPastDue > 0 ? outstanding : 0;
      const agingBucket = daysPastDue <= 0 ? 'Current'
        : daysPastDue <= 7 ? '1-7 days'
          : daysPastDue <= 30 ? '8-30 days'
            : daysPastDue <= 60 ? '31-60 days'
              : daysPastDue <= 90 ? '61-90 days'
                : '90+ days';
      return {
        loanId: loan.id,
        borrower: `${loan.borrower.firstName} ${loan.borrower.lastName}`.trim(),
        branch: loan.branch?.name || 'Unassigned',
        outstandingBalance: outstanding,
        daysPastDue,
        agingBucket,
        riskGrade: this.riskGrade(daysPastDue, loan.creditRatingApplied),
        overdueAmount,
        lastRepaymentDate: null,
        assignedOfficer: loan.createdByUserId || 'N/A',
        recommendedAction: daysPastDue >= 90 ? 'Immediate legal recovery'
          : daysPastDue >= 30 ? 'Escalated collection'
            : daysPastDue > 0 ? 'Reminder follow-up'
              : 'Monitor',
        product: loan.product?.name || 'N/A',
        status: loan.status,
      };
    }).filter((r) => !query.riskGrade || r.riskGrade.toLowerCase() === query.riskGrade.toLowerCase());

    const totalExposure = rows.reduce((a, r) => a + r.outstandingBalance, 0);
    const par1 = rows.filter((r) => r.daysPastDue >= 1).reduce((a, r) => a + r.outstandingBalance, 0);
    const par7 = rows.filter((r) => r.daysPastDue >= 7).reduce((a, r) => a + r.outstandingBalance, 0);
    const par30 = rows.filter((r) => r.daysPastDue >= 30).reduce((a, r) => a + r.outstandingBalance, 0);
    const npl = rows.filter((r) => r.daysPastDue >= 90 || r.status === 'DEFAULTED').reduce((a, r) => a + r.outstandingBalance, 0);
    const overdueAmount = rows.filter((r) => r.daysPastDue > 0).reduce((a, r) => a + r.outstandingBalance, 0);
    const highRiskExposure = rows.filter((r) => ['High', 'Critical'].includes(r.riskGrade)).reduce((a, r) => a + r.outstandingBalance, 0);

    const agingBuckets = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.agingBucket] = (m[r.agingBucket] || 0) + r.outstandingBalance;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const overdueByBranch = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.branch] = (m[r.branch] || 0) + r.overdueAmount;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const exposureByProduct = Object.entries(rows.reduce((m: Record<string, number>, r) => {
      m[r.product] = (m[r.product] || 0) + r.outstandingBalance;
      return m;
    }, {})).map(([name, value]) => ({ name, value }));

    const topHighRisk = [...rows]
      .sort((a, b) => b.daysPastDue - a.daysPastDue || b.overdueAmount - a.overdueAmount)
      .slice(0, 10)
      .map((r) => ({ loanId: r.loanId, borrower: r.borrower, daysPastDue: r.daysPastDue, overdueAmount: r.overdueAmount }));

    const funnel = [
      { stage: 'Pending', value: rows.filter((r) => r.status === 'PENDING').length },
      { stage: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length },
      { stage: 'Disbursed', value: rows.filter((r) => r.status === 'DISBURSED').length },
      { stage: 'Defaulted', value: rows.filter((r) => r.status === 'DEFAULTED').length },
      { stage: 'Closed', value: rows.filter((r) => r.status === 'CLOSED').length },
    ];

    const total = rows.length;
    const paged = rows.slice((nrm.page - 1) * nrm.limit, nrm.page * nrm.limit);

    return {
      filters: query,
      kpis: {
        par1,
        par7,
        par30,
        nplRatio: pct(npl, totalExposure),
        writeOffAmount: 0,
        overdueAmount,
        totalExposure,
        highRiskExposure,
      },
      charts: {
        parTrend: [{ bucket: 'PAR1', value: par1 }, { bucket: 'PAR7', value: par7 }, { bucket: 'PAR30', value: par30 }],
        agingBucketDistribution: agingBuckets,
        overdueByBranch,
        riskExposureByProduct: exposureByProduct,
        topHighRiskLoans: topHighRisk,
        loanStatusFunnel: funnel,
      },
      rows: paged,
      pagination: { page: nrm.page, limit: nrm.limit, total },
    };
  }

  async exportRows(report: 'loan-portfolio' | 'collections' | 'borrowers' | 'risk', actor: JwtPayload, query: ReportQueryDto) {
    const data = report === 'loan-portfolio'
      ? await this.loanPortfolio(actor, { ...query, page: 1, limit: 100000 })
      : report === 'collections'
        ? await this.collections(actor, { ...query, page: 1, limit: 100000 })
        : report === 'borrowers'
          ? await this.borrowers(actor, { ...query, page: 1, limit: 100000 })
          : await this.risk(actor, { ...query, page: 1, limit: 100000 });

    return data.rows;
  }

  toCsv(rows: Record<string, unknown>[]): Buffer {
    if (!rows.length) return Buffer.from('');
    const keys = Object.keys(rows[0]);
    const header = keys.join(',');
    const body = rows.map((row) => keys.map((k) => `"${csvSafe(row[k])}"`).join(',')).join('\n');
    return Buffer.from(`${header}\n${body}`, 'utf8');
  }

  toXlsx(rows: Record<string, unknown>[]): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}
