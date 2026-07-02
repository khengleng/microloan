import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostRepaymentDto } from './dto/post-repayment.dto';
import { LoanStatus, JournalSource } from '@microloan/db';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import { LedgerService } from '../ledger/ledger.service';
import { ACCOUNT_CODES } from '../ledger/chart-of-accounts';

@Injectable()
export class RepaymentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private authz: AuthzService,
    private ledger: LedgerService,
  ) { }

  async postRepayment(actor: JwtPayload, dto: PostRepaymentDto) {
    this.authz.assertPermission(actor, Permission.LOAN_REPAYMENT_POST);

    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor, { id: dto.loanId }),
      include: {
        schedules: {
          where: { isPaid: false },
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });

    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);
    if (loan.status !== LoanStatus.DISBURSED) {
      throw new BadRequestException(
        'Can only post repayments for disbursed loans',
      );
    }

    // P0 #2: idempotency — scoped to the loan's own tenant (keys are unique per
    // tenant); a repeated key returns the original instead of double-posting.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.repayment.findFirst({
        where: { tenantId: loan.tenantId, idempotencyKey: dto.idempotencyKey },
      });
      if (existing) return existing;
    }

    if (dto.amount <= 0) {
      throw new BadRequestException(
        'Repayment amount must be strictly greater than 0',
      );
    }

    const totalDue = loan.schedules.reduce((acc, schedule) => {
      const dueInt = Math.max(0, Number(schedule.interestAmount) - Number(schedule.paidInterest));
      const duePrin = Math.max(0, Number(schedule.principalAmount) - Number(schedule.paidPrincipal));
      const duePen = Math.max(0, Number(schedule.penaltyAmount) - Number(schedule.paidPenalty));
      return acc + dueInt + duePrin + duePen;
    }, 0);

    if (dto.amount > totalDue + 0.01) {
      throw new BadRequestException(
        `Repayment amount cannot exceed the remaining balance of $${totalDue.toFixed(2)}`
      );
    }

    // Allocate payment: interest → principal → penalty, across schedules.
    let remainingAmount = dto.amount;
    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;
    let totalPenaltyPaid = 0;
    const scheduleUpdates: { id: string; paidInterest: number; paidPrincipal: number; paidPenalty: number; isPaid: boolean }[] = [];

    for (const schedule of loan.schedules) {
      if (remainingAmount <= 0) break;

      const alreadyPaidInterest = Number(schedule.paidInterest);
      const alreadyPaidPrincipal = Number(schedule.paidPrincipal);
      const alreadyPaidPenalty = Number(schedule.paidPenalty);

      const dueInterest = Math.max(0, Number(schedule.interestAmount) - alreadyPaidInterest);
      const duePrincipal = Math.max(0, Number(schedule.principalAmount) - alreadyPaidPrincipal);
      const duePenalty = Math.max(0, Number(schedule.penaltyAmount) - alreadyPaidPenalty);

      let interestToPay = 0;
      let principalToPay = 0;
      let penaltyToPay = 0;

      if (dueInterest > 0) {
        interestToPay = Math.min(remainingAmount, dueInterest);
        remainingAmount -= interestToPay;
        totalInterestPaid += interestToPay;
      }
      if (remainingAmount > 0 && duePrincipal > 0) {
        principalToPay = Math.min(remainingAmount, duePrincipal);
        remainingAmount -= principalToPay;
        totalPrincipalPaid += principalToPay;
      }
      if (remainingAmount > 0 && duePenalty > 0) {
        penaltyToPay = Math.min(remainingAmount, duePenalty);
        remainingAmount -= penaltyToPay;
        totalPenaltyPaid += penaltyToPay;
      }

      if (interestToPay > 0 || principalToPay > 0 || penaltyToPay > 0) {
        const newPaidInterest = alreadyPaidInterest + interestToPay;
        const newPaidPrincipal = alreadyPaidPrincipal + principalToPay;
        const newPaidPenalty = alreadyPaidPenalty + penaltyToPay;
        // isPaid now accounts for penalty, so penalised installments can close.
        const isPaid =
          newPaidInterest + newPaidPrincipal + newPaidPenalty >= Number(schedule.totalAmount) - 0.001;

        scheduleUpdates.push({
          id: schedule.id,
          paidInterest: newPaidInterest,
          paidPrincipal: newPaidPrincipal,
          paidPenalty: newPaidPenalty,
          isPaid,
        });
      }
    }

    // Amount actually applied to the loan (guards GL balance against any
    // sub-cent rounding between the tendered amount and the allocation).
    const appliedAmount = Math.round((totalInterestPaid + totalPrincipalPaid + totalPenaltyPaid) * 100) / 100;

    // Process repayment, schedule updates, and the GL posting atomically.
    let repayment;
    try {
      repayment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.repayment.create({
        data: {
          tenantId: loan.tenantId,
          loanId: dto.loanId,
          amount: dto.amount,
          currency: loan.currency,
          interestPaid: totalInterestPaid,
          principalPaid: totalPrincipalPaid,
          penaltyPaid: totalPenaltyPaid,
          date: new Date(dto.date),
          idempotencyKey: dto.idempotencyKey,
        },
      });

      for (const u of scheduleUpdates) {
        await tx.repaymentSchedule.update({
          where: { id: u.id },
          data: { paidInterest: u.paidInterest, paidPrincipal: u.paidPrincipal, paidPenalty: u.paidPenalty, isPaid: u.isPaid },
        });
      }

      // Feature #3: GL posting — Dr Cash; Cr Loans Receivable (principal),
      // Interest Income (interest), Penalty Income (penalty). Skip if nothing applied.
      if (appliedAmount > 0) {
        const lines = [{ accountCode: ACCOUNT_CODES.CASH, debit: appliedAmount }];
        if (totalPrincipalPaid > 0) {
          lines.push({ accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, credit: totalPrincipalPaid } as any);
        }
        if (totalInterestPaid > 0) {
          lines.push({ accountCode: ACCOUNT_CODES.INTEREST_INCOME, credit: totalInterestPaid } as any);
        }
        if (totalPenaltyPaid > 0) {
          lines.push({ accountCode: ACCOUNT_CODES.PENALTY_INCOME, credit: totalPenaltyPaid } as any);
        }
        await this.ledger.postEntry(
          {
            tenantId: loan.tenantId,
            source: JournalSource.REPAYMENT,
            description: `Repayment on loan ${dto.loanId}`,
            currency: loan.currency,
            loanId: dto.loanId,
            referenceId: created.id,
            createdByUserId: this.authz.actorId(actor),
            lines,
          },
          tx,
        );
      }

      return created;
      });
    } catch (e: any) {
      // Concurrent same-key post lost the race — return the winner instead of 500.
      if (dto.idempotencyKey && e?.code === 'P2002') {
        const existing = await this.prisma.repayment.findFirst({
          where: { tenantId: loan.tenantId, idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return existing;
      }
      throw e;
    }

    await this.audit.logAction(
      loan.tenantId,
      this.authz.actorId(actor),
      'CREATE',
      'Repayment',
      repayment.id,
      {
        ...dto,
        allocatedInterest: totalInterestPaid,
        allocatedPrincipal: totalPrincipalPaid,
      },
    );

    // Check if all installments are paid, auto-close loan
    const unpaidCount = await this.prisma.repaymentSchedule.count({
      where: { loanId: dto.loanId, isPaid: false },
    });

    if (unpaidCount === 0 && (scheduleUpdates.length > 0 || loan.schedules.length === 0)) {
      await this.prisma.loan.update({
        where: { id: dto.loanId },
        data: { status: LoanStatus.CLOSED },
      });
      await this.audit.logAction(loan.tenantId, this.authz.actorId(actor), 'UPDATE', 'Loan', loan.id, {
        action: 'Auto-closed due to full repayment',
      });
    }

    return repayment;
  }

  /**
   * P1 #13: reverse a posted repayment. Marks it reversed, recomputes the loan's
   * schedule paid amounts by replaying the remaining (non-reversed) repayments —
   * deterministic, so no per-schedule breakdown needs to have been stored — and
   * posts a GL contra-entry (Dr Loans Receivable + Interest Income / Cr Cash).
   */
  async reverseRepayment(actor: JwtPayload, repaymentId: string, reason: string) {
    this.authz.assertPermission(actor, Permission.LOAN_REPAYMENT_POST);
    const repayment = await this.prisma.repayment.findFirst({
      where: this.authz.scopeWhere(actor, { id: repaymentId }),
      include: { loan: true },
    });
    if (!repayment) throw new NotFoundException('Repayment not found');
    this.authz.assertBranchAccess(actor, repayment.loan.branchId);
    if (repayment.reversedAt) throw new BadRequestException('Repayment is already reversed.');
    if (!reason || !reason.trim()) throw new BadRequestException('A reversal reason is required.');

    const loanId = repayment.loanId;
    const [schedules, remaining] = await Promise.all([
      this.prisma.repaymentSchedule.findMany({ where: { loanId }, orderBy: { installmentNumber: 'asc' } }),
      this.prisma.repayment.findMany({
        where: { loanId, reversedAt: null, id: { not: repaymentId } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    // Rebuild schedule state from scratch by replaying the remaining repayments
    // with the same interest → principal → penalty allocation used when posting.
    const recomputed = schedules.map((s) => ({
      id: s.id,
      principalAmount: Number(s.principalAmount),
      interestAmount: Number(s.interestAmount),
      penaltyAmount: Number(s.penaltyAmount),
      totalAmount: Number(s.totalAmount),
      paidInterest: 0,
      paidPrincipal: 0,
      paidPenalty: 0,
      isPaid: false,
    }));
    for (const r of remaining) {
      let left = Number(r.amount);
      for (const s of recomputed) {
        if (left <= 0) break;
        const dueInterest = Math.max(0, s.interestAmount - s.paidInterest);
        if (dueInterest > 0) {
          const pay = Math.min(left, dueInterest);
          s.paidInterest += pay;
          left -= pay;
        }
        const duePrincipal = Math.max(0, s.principalAmount - s.paidPrincipal);
        if (left > 0 && duePrincipal > 0) {
          const pay = Math.min(left, duePrincipal);
          s.paidPrincipal += pay;
          left -= pay;
        }
        const duePenalty = Math.max(0, s.penaltyAmount - s.paidPenalty);
        if (left > 0 && duePenalty > 0) {
          const pay = Math.min(left, duePenalty);
          s.paidPenalty += pay;
          left -= pay;
        }
        s.isPaid = s.paidInterest + s.paidPrincipal + s.paidPenalty >= s.totalAmount - 0.001;
      }
    }

    const principalReversed = Number(repayment.principalPaid);
    const interestReversed = Number(repayment.interestPaid);
    const penaltyReversed = Number(repayment.penaltyPaid);
    const cashReversed = Math.round((principalReversed + interestReversed + penaltyReversed) * 100) / 100;
    const allPaid = recomputed.every((s) => s.isPaid);
    const willReopen = !allPaid && repayment.loan.status === LoanStatus.CLOSED;
    const actorId = this.authz.actorId(actor);

    await this.prisma.$transaction(async (tx) => {
      // Bug #7: atomic guard — only one concurrent reversal wins.
      const claim = await tx.repayment.updateMany({
        where: { id: repaymentId, reversedAt: null },
        data: { reversedAt: new Date(), reversedByUserId: actorId, reversalReason: reason.trim() },
      });
      if (claim.count !== 1) {
        throw new BadRequestException('Repayment is already reversed.');
      }

      for (const s of recomputed) {
        await tx.repaymentSchedule.update({
          where: { id: s.id },
          data: {
            paidInterest: Math.round(s.paidInterest * 100) / 100,
            paidPrincipal: Math.round(s.paidPrincipal * 100) / 100,
            paidPenalty: Math.round(s.paidPenalty * 100) / 100,
            isPaid: s.isPaid,
          },
        });
      }

      // GL contra-entry: reverse the original repayment postings.
      if (cashReversed > 0) {
        const lines: any[] = [{ accountCode: ACCOUNT_CODES.CASH, credit: cashReversed }];
        if (principalReversed > 0) lines.push({ accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, debit: principalReversed });
        if (interestReversed > 0) lines.push({ accountCode: ACCOUNT_CODES.INTEREST_INCOME, debit: interestReversed });
        if (penaltyReversed > 0) lines.push({ accountCode: ACCOUNT_CODES.PENALTY_INCOME, debit: penaltyReversed });
        await this.ledger.postEntry(
          {
            tenantId: repayment.tenantId,
            source: JournalSource.MANUAL,
            description: `Reversal of repayment ${repaymentId}`,
            currency: repayment.currency,
            loanId,
            referenceId: repaymentId,
            createdByUserId: actorId,
            lines,
          },
          tx,
        );
      }

      // Reopen a loan that was auto-closed but is no longer fully paid.
      if (willReopen) {
        await tx.loan.update({ where: { id: loanId }, data: { status: LoanStatus.DISBURSED } });
      }
    });

    await this.audit.logSecurityEvent({
      actorUserId: actorId,
      actorRole: actor.role,
      actorTenantId: repayment.tenantId,
      targetType: 'Repayment',
      targetId: repaymentId,
      action: 'REPAYMENT_REVERSE',
      newValue: { reason: reason.trim(), principalReversed, interestReversed },
      result: 'SUCCESS',
    });

    return { success: true, reversedRepaymentId: repaymentId, loanReopened: willReopen };
  }

  /**
   * P1 #11: structured repayment receipt (the web renders/prints it). Includes
   * allocation breakdown and the outstanding balance after the payment.
   */
  async getReceipt(actor: JwtPayload, id: string) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const r = await this.prisma.repayment.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
      include: {
        loan: { include: { borrower: true, branch: true } },
        tenant: { select: { name: true } },
      },
    });
    if (!r) throw new NotFoundException('Repayment not found');
    this.authz.assertBranchAccess(actor, r.loan.branchId);

    const schedules = await this.prisma.repaymentSchedule.findMany({ where: { loanId: r.loanId } });
    const outstandingAfter = schedules.reduce(
      (a, s) => a + Math.max(0, Number(s.totalAmount) - (Number(s.paidPrincipal) + Number(s.paidInterest) + Number(s.paidPenalty))),
      0,
    );

    return {
      receiptNo: r.id,
      date: r.date,
      reversed: !!r.reversedAt,
      organization: r.tenant?.name ?? null,
      borrowerName: `${r.loan.borrower.firstName} ${r.loan.borrower.lastName}`.trim(),
      branch: r.loan.branch?.name ?? null,
      loanId: r.loanId,
      currency: r.currency,
      amount: Number(r.amount),
      principalPaid: Number(r.principalPaid),
      interestPaid: Number(r.interestPaid),
      penaltyPaid: Number(r.penaltyPaid),
      outstandingAfter: Math.round(outstandingAfter * 100) / 100,
    };
  }

  async findAll(
    actor: JwtPayload,
    loanId?: string,
    startDate?: string,
    endDate?: string,
    page = 1,
    limit = 50,
  ) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const where: any = this.authz.scopeWhere(actor, {});
    if (loanId) where.loanId = loanId;
    if (actor.branchId) where.loan = { ...(where.loan || {}), branchId: actor.branchId };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.repayment.findMany({
        where,
        include: { loan: { include: { borrower: true } } },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.repayment.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
