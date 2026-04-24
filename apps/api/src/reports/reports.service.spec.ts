import { ReportsService } from './reports.service';
import type { JwtPayload } from '../auth/jwt.strategy';

describe('ReportsService', () => {
  const actor: JwtPayload = {
    sub: 'u1',
    email: 'admin@test.com',
    role: 'TENANT_ADMIN',
    tenantId: 'tenant-1',
    branchId: null,
    permissions: [],
  };

  function buildService(overrides?: {
    loanFindMany?: jest.Mock;
    borrowerCount?: jest.Mock;
    repaymentAggregate?: jest.Mock;
    repaymentFindMany?: jest.Mock;
  }) {
    const prisma = {
      loan: {
        findMany: overrides?.loanFindMany || jest.fn().mockResolvedValue([]),
      },
      borrower: {
        count: overrides?.borrowerCount || jest.fn().mockResolvedValue(0),
      },
      repayment: {
        aggregate: overrides?.repaymentAggregate || jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        findMany: overrides?.repaymentFindMany || jest.fn().mockResolvedValue([]),
      },
    };

    const authz = {
      assertPermission: jest.fn(),
      isPlatform: jest.fn().mockReturnValue(false),
      scopeWhere: jest.fn((_: JwtPayload, where: Record<string, unknown>) => ({ ...where, tenantId: 'tenant-1' })),
    };

    const service = new ReportsService(prisma as any, authz as any);
    return { service, prisma, authz };
  }

  it('calculates PAR and NPL KPIs for loan portfolio', async () => {
    const loanFindMany = jest.fn().mockResolvedValue([
      {
        id: 'l1',
        tenantId: 'tenant-1',
        borrower: { firstName: 'A', lastName: 'One' },
        product: { name: 'Daily' },
        branch: { name: 'Main' },
        createdByUserId: 'u2',
        principal: 1000,
        annualInterestRate: 3,
        termMonths: 6,
        startDate: new Date('2026-01-01'),
        status: 'DISBURSED',
        creditRatingApplied: null,
        schedules: [
          {
            dueDate: new Date(Date.now() - 35 * 86400000),
            principalAmount: 600,
            interestAmount: 50,
            penaltyAmount: 0,
            paidPrincipal: 0,
            paidInterest: 0,
            paidPenalty: 0,
            isPaid: false,
          },
        ],
      },
      {
        id: 'l2',
        tenantId: 'tenant-1',
        borrower: { firstName: 'B', lastName: 'Two' },
        product: { name: 'Weekly' },
        branch: { name: 'Main' },
        createdByUserId: 'u2',
        principal: 500,
        annualInterestRate: 2,
        termMonths: 3,
        startDate: new Date('2026-01-01'),
        status: 'DISBURSED',
        creditRatingApplied: null,
        schedules: [
          {
            dueDate: new Date(Date.now() + 20 * 86400000),
            principalAmount: 300,
            interestAmount: 20,
            penaltyAmount: 0,
            paidPrincipal: 100,
            paidInterest: 20,
            paidPenalty: 0,
            isPaid: false,
          },
        ],
      },
    ]);

    const { service } = buildService({ loanFindMany });
    const result = await service.loanPortfolio(actor, { page: 1, limit: 20 });

    expect(result.kpis.totalOutstandingPrincipal).toBe(850);
    expect(result.kpis.par30).toBe(650);
    expect(result.kpis.nplAmount).toBe(0);
    expect(result.kpis.portfolioAtRiskPercentage).toBeCloseTo((650 / 850) * 100, 5);
  });

  it('scopes loan portfolio query to actor-owned loans for LOAN_OFFICER', async () => {
    const loanFindMany = jest.fn().mockResolvedValue([]);
    const { service, prisma } = buildService({ loanFindMany });

    await service.loanPortfolio(
      {
        ...actor,
        sub: 'officer-1',
        role: 'LOAN_OFFICER',
      },
      { page: 1, limit: 20 },
    );

    expect(prisma.loan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdByUserId: 'officer-1' }),
      }),
    );
  });

  it('exports all filtered rows for selected report', async () => {
    const loanFindMany = jest.fn().mockResolvedValue([
      {
        id: 'l1',
        tenantId: 'tenant-1',
        borrower: { firstName: 'A', lastName: 'One' },
        product: { name: 'Daily' },
        branch: { name: 'Main' },
        createdByUserId: 'u2',
        principal: 1000,
        annualInterestRate: 3,
        termMonths: 6,
        startDate: new Date('2026-01-01'),
        status: 'DISBURSED',
        creditRatingApplied: 'High',
        schedules: [],
        tenant: { id: 'tenant-1' },
      },
    ]);

    const { service } = buildService({ loanFindMany });
    const rows = await service.exportRows('loan-portfolio', actor, { riskGrade: 'High' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('loanId', 'l1');
  });
});
