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
  const authz = new AuthzService(audit);
  const service = new LoansService(prisma, audit, authz, bot);

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
});

