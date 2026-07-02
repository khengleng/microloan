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

    // P0 #2: idempotency — if this key was already posted for the tenant, return
    // the original repayment rather than posting a duplicate.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.repayment.findFirst({
        where: this.authz.scopeWhere(actor, { idempotencyKey: dto.idempotencyKey }),
      });
      if (existing) return existing;
    }

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

    if (dto.amount <= 0) {
      throw new BadRequestException(
        'Repayment amount must be strictly greater than 0',
      );
    }

    const totalDue = loan.schedules.reduce((acc, schedule) => {
      const dueInt = Math.max(0, Number(schedule.interestAmount) - Number(schedule.paidInterest));
      const duePrin = Math.max(0, Number(schedule.principalAmount) - Number(schedule.paidPrincipal));
      return acc + dueInt + duePrin;
    }, 0);

    if (dto.amount > totalDue + 0.01) {
      throw new BadRequestException(
        `Repayment amount cannot exceed the remaining balance of $${totalDue.toFixed(2)}`
      );
    }

    // Allocate payment
    let remainingAmount = dto.amount;
    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;
    const scheduleUpdates: { id: string; paidInterest: number; paidPrincipal: number; isPaid: boolean }[] = [];

    // "pay due interest first, then principal" across schedules
    for (const schedule of loan.schedules) {
      if (remainingAmount <= 0) break;

      const scheduleInterest = Number(schedule.interestAmount);
      const schedulePrincipal = Number(schedule.principalAmount);
      const alreadyPaidInterest = Number(schedule.paidInterest);
      const alreadyPaidPrincipal = Number(schedule.paidPrincipal);

      const dueInterest = Math.max(0, scheduleInterest - alreadyPaidInterest);
      const duePrincipal = Math.max(0, schedulePrincipal - alreadyPaidPrincipal);

      let interestToPay = 0;
      let principalToPay = 0;

      // 1. Pay Interest
      if (dueInterest > 0) {
        interestToPay = Math.min(remainingAmount, dueInterest);
        remainingAmount -= interestToPay;
        totalInterestPaid += interestToPay;
      }

      // 2. Pay Principal
      if (remainingAmount > 0 && duePrincipal > 0) {
        principalToPay = Math.min(remainingAmount, duePrincipal);
        remainingAmount -= principalToPay;
        totalPrincipalPaid += principalToPay;
      }

      if (interestToPay > 0 || principalToPay > 0) {
        const newPaidInterest = alreadyPaidInterest + interestToPay;
        const newPaidPrincipal = alreadyPaidPrincipal + principalToPay;
        const isPaid =
          newPaidInterest + newPaidPrincipal >= Number(schedule.totalAmount);

        scheduleUpdates.push({
          id: schedule.id,
          paidInterest: newPaidInterest,
          paidPrincipal: newPaidPrincipal,
          isPaid,
        });
      }
    }

    // Amount actually applied to the loan (guards GL balance against any
    // sub-cent rounding between the tendered amount and the allocation).
    const appliedAmount = Math.round((totalInterestPaid + totalPrincipalPaid) * 100) / 100;

    // Process repayment, schedule updates, and the GL posting atomically.
    const repayment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.repayment.create({
        data: {
          tenantId: loan.tenantId,
          loanId: dto.loanId,
          amount: dto.amount,
          currency: loan.currency,
          interestPaid: totalInterestPaid,
          principalPaid: totalPrincipalPaid,
          date: new Date(dto.date),
          idempotencyKey: dto.idempotencyKey,
        },
      });

      for (const u of scheduleUpdates) {
        await tx.repaymentSchedule.update({
          where: { id: u.id },
          data: { paidInterest: u.paidInterest, paidPrincipal: u.paidPrincipal, isPaid: u.isPaid },
        });
      }

      // Feature #3: GL posting — Dr Cash; Cr Loans Receivable (principal),
      // Interest Income (interest). Skip if nothing was actually applied.
      if (appliedAmount > 0) {
        const lines = [{ accountCode: ACCOUNT_CODES.CASH, debit: appliedAmount }];
        if (totalPrincipalPaid > 0) {
          lines.push({ accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, credit: totalPrincipalPaid } as any);
        }
        if (totalInterestPaid > 0) {
          lines.push({ accountCode: ACCOUNT_CODES.INTEREST_INCOME, credit: totalInterestPaid } as any);
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
    // with the same interest-first allocation used when posting.
    const recomputed = schedules.map((s) => ({
      id: s.id,
      principalAmount: Number(s.principalAmount),
      interestAmount: Number(s.interestAmount),
      totalAmount: Number(s.totalAmount),
      paidInterest: 0,
      paidPrincipal: 0,
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
        s.isPaid = s.paidInterest + s.paidPrincipal >= s.totalAmount;
      }
    }

    const principalReversed = Number(repayment.principalPaid);
    const interestReversed = Number(repayment.interestPaid);
    const cashReversed = Math.round((principalReversed + interestReversed) * 100) / 100;
    const allPaid = recomputed.every((s) => s.isPaid);
    const actorId = this.authz.actorId(actor);

    await this.prisma.$transaction(async (tx) => {
      for (const s of recomputed) {
        await tx.repaymentSchedule.update({
          where: { id: s.id },
          data: {
            paidInterest: Math.round(s.paidInterest * 100) / 100,
            paidPrincipal: Math.round(s.paidPrincipal * 100) / 100,
            isPaid: s.isPaid,
          },
        });
      }

      await tx.repayment.update({
        where: { id: repaymentId },
        data: { reversedAt: new Date(), reversedByUserId: actorId, reversalReason: reason.trim() },
      });

      // GL contra-entry: reverse the original repayment postings.
      if (cashReversed > 0) {
        const lines: any[] = [{ accountCode: ACCOUNT_CODES.CASH, credit: cashReversed }];
        if (principalReversed > 0) lines.push({ accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, debit: principalReversed });
        if (interestReversed > 0) lines.push({ accountCode: ACCOUNT_CODES.INTEREST_INCOME, debit: interestReversed });
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
      if (!allPaid && repayment.loan.status === LoanStatus.CLOSED) {
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

    return { success: true, reversedRepaymentId: repaymentId, loanReopened: !allPaid && repayment.loan.status === LoanStatus.CLOSED };
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
