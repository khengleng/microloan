// otplib (pulled in transitively via the bot/auth graph) is ESM-only under jest.
jest.mock('otplib', () => ({ verify: jest.fn(), generateSecret: jest.fn() }));
jest.mock('../bot/bot.service', () => ({ BotService: class {} }));

import { BadRequestException } from '@nestjs/common';
import { LoanStatus } from '@microloan/db';
import { LoansService } from './loans.service';

function serviceFor(status: LoanStatus) {
  const prisma = {
    loan: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'loan-1',
        tenantId: 't1',
        branchId: null,
        borrowerId: 'b1',
        status,
        createdByUserId: 'maker',
        approvedBy: 'approver',
        reviewedByUserId: null,
      }),
    },
  };
  const authz = {
    scopeWhere: (_a: unknown, w: unknown) => w,
    assertBranchAccess: jest.fn(),
    assertPermission: jest.fn(),
    assertMakerChecker: jest.fn(),
    actorId: () => 'checker',
  };
  const svc = new LoansService(
    prisma as any,
    {} as any,
    authz as any,
    {} as any,
    {} as any,
  );
  // Credit-bureau gate is out of scope here.
  (svc as any).assertCreditCheckForApproval = jest.fn();
  return svc;
}

const actor = { sub: 'checker', tenantId: 't1' } as any;

describe('LoansService.changeStatus — source-state rules', () => {
  it.each([
    LoanStatus.DISBURSED,
    LoanStatus.WRITTEN_OFF,
    LoanStatus.DEFAULTED,
    LoanStatus.REJECTED,
  ])(
    'refuses to re-approve a %s loan (would allow a second disbursement)',
    async (from) => {
      await expect(
        serviceFor(from).changeStatus(actor, 'loan-1', {
          status: 'APPROVED',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([LoanStatus.DISBURSED, LoanStatus.WRITTEN_OFF, LoanStatus.DEFAULTED])(
    'refuses to reject a %s loan',
    async (from) => {
      await expect(
        serviceFor(from).changeStatus(actor, 'loan-1', {
          status: 'REJECTED',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('still lets a PENDING loan past the source-state check for approval', async () => {
    const svc = serviceFor(LoanStatus.PENDING);
    // Stops at the first collaborator this spec does not stub — after the
    // source-state rule, which is what is under test.
    await expect(
      svc.changeStatus(actor, 'loan-1', { status: 'APPROVED' } as any),
    ).rejects.not.toThrow(/Cannot move a/);
  });
});
