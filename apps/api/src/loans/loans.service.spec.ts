import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LoanStatus } from '@microloan/db';
import { LoansService } from './loans.service';
import { AuthzService } from '../authz/authz.service';

describe('LoansService maker-checker', () => {
  const prisma: any = {
    loan: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const audit: any = {
    logSecurityEvent: jest.fn(),
    logAction: jest.fn(),
  };
  const bot: any = { sendDisbursementAlert: jest.fn() };
  const ledger: any = { postEntry: jest.fn(), ensureChartOfAccounts: jest.fn() };
  const authz = new AuthzService(audit);
  const service = new LoansService(prisma, audit, authz, ledger, bot);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creator cannot approve own loan', async () => {
    prisma.loan.findFirst.mockResolvedValue({
      id: 'l1',
      tenantId: 't1',
      branchId: 'b1',
      status: LoanStatus.PENDING,
      createdByUserId: 'u1',
      reviewedByUserId: null,
      approvedBy: null,
    });

    await expect(
      service.changeStatus(
        {
          sub: 'u1',
          role: 'APPROVER',
          tenantId: 't1',
          branchId: 'b1',
          permissions: [],
        } as any,
        'l1',
        { status: LoanStatus.APPROVED } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approver cannot disburse own approved loan', async () => {
    prisma.loan.findFirst.mockResolvedValue({
      id: 'l1',
      tenantId: 't1',
      branchId: 'b1',
      status: LoanStatus.APPROVED,
      createdByUserId: 'maker',
      reviewedByUserId: 'reviewer',
      approvedBy: 'u1',
    });

    await expect(
      service.changeStatus(
        {
          sub: 'u1',
          role: 'ACCOUNTANT',
          tenantId: 't1',
          branchId: 'b1',
          permissions: [],
        } as any,
        'l1',
        { status: LoanStatus.DISBURSED } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('payoff quote waives future interest but keeps accrued interest + penalties', async () => {
    const past = new Date(Date.now() - 5 * 86400000);
    const future = new Date(Date.now() + 30 * 86400000);
    prisma.loan.findFirst.mockResolvedValue({
      id: 'l1',
      tenantId: 't1',
      branchId: null,
      currency: 'USD',
      schedules: [
        // due (accrued): principal 100, interest 10, penalty 5 — all unpaid
        { isPaid: false, dueDate: past, principalAmount: 100, paidPrincipal: 0, interestAmount: 10, paidInterest: 0, penaltyAmount: 5, paidPenalty: 0 },
        // future: principal 100, interest 10 — interest should be waived
        { isPaid: false, dueDate: future, principalAmount: 100, paidPrincipal: 0, interestAmount: 10, paidInterest: 0, penaltyAmount: 0, paidPenalty: 0 },
      ],
    });

    const q = await service.payoffQuote(
      { sub: 'u1', role: 'ACCOUNTANT', tenantId: 't1', branchId: null, permissions: [] } as any,
      'l1',
    );

    expect(q.outstandingPrincipal).toBe(200);
    expect(q.accruedInterestDue).toBe(10);
    expect(q.futureInterestWaived).toBe(10);
    expect(q.outstandingPenalty).toBe(5);
    expect(q.payoffAmount).toBe(215); // 200 principal + 10 accrued interest + 5 penalty
  });
});

