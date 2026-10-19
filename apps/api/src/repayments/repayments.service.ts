import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostRepaymentDto } from './dto/post-repayment.dto';
import { SettleLoanDto } from './dto/settle-loan.dto';
import { computePayoff } from '../loans/payoff';
import { LoanStatus, JournalSource, Prisma } from '@microloan/db';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import { LedgerService } from '../ledger/ledger.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatCurrency, Currency as SharedCurrency } from '@microloan/shared';
import { LegacyLoanGate } from '../loans/legacy-loan-gate';
import {
  StoredAllocation,
  allocateRepayment,
  cents,
  dec,
  ledgerAmount,
  lockLegacyLoan,
  totalDue,
  unallocateByComponent,
} from '../loans/legacy-money';

const OPEN_STATUSES: LoanStatus[] = [LoanStatus.DISBURSED, LoanStatus.DEFAULTED];
/** The journal description the loan-book migration gives a legacy loan it moved (loan-migration.service). */
const MIGRATED_PREFIX = 'Loan moved to the lending platform';

@Injectable()
export class RepaymentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private authz: AuthzService,
    private ledger: LedgerService,
    private notifications: NotificationsService,
    /** The lender's settings: which ledger accounts this book posts to. */
    private settings: TenantSettingsService,
    /** D-097: refuses every legacy money operation while the book is read-only. */
    @Optional() private legacyGate?: LegacyLoanGate,
  ) { }

  /**
   * UC-31: early settlement at the payoff quote. Every unpaid instalment is
   * paid in full except interest not yet due, which is waived, and the loan
   * closes. An ordinary repayment of the same amount would not close it: the
   * allocation pays instalments' interest first, future ones included.
   *
   * D-098: the loan is locked and its schedule re-read inside the
   * transaction; the waived interest is recorded per instalment so a
   * reversal restores it (D-103).
   */
  async settleLoan(actor: JwtPayload, dto: SettleLoanDto) {
    this.authz.assertPermission(actor, Permission.LOAN_REPAYMENT_POST);
    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor, { id: dto.loanId }),
    });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);
    await this.legacyGate?.assertOpen(loan.tenantId, 'settlement');
    // A retried request returns the original settlement, even though the
    // loan it closed is no longer open.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.repayment.findFirst({
        where: { tenantId: loan.tenantId, idempotencyKey: dto.idempotencyKey },
      });
      if (existing) return existing;
    }
    if (!OPEN_STATUSES.includes(loan.status)) {
      throw new BadRequestException('Only a disbursed or defaulted loan can be settled.');
    }
    const asOf = dto.date ? new Date(dto.date) : new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await lockLegacyLoan(tx, loan.id, loan.tenantId);
      if (dto.idempotencyKey) {
        const existing = await tx.repayment.findFirst({
          where: { tenantId: loan.tenantId, idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return { replay: existing } as const;
      }
      const fresh = await tx.loan.findFirst({ where: { id: loan.id }, select: { status: true } });
      if (!fresh || !OPEN_STATUSES.includes(fresh.status)) {
        throw new BadRequestException('Only a disbursed or defaulted loan can be settled.');
      }
      const schedules = await tx.repaymentSchedule.findMany({
        where: { loanId: loan.id },
        orderBy: { installmentNumber: 'asc' },
      });
      const q = computePayoff(schedules, asOf);
      if (!cents(dec(dto.amount)).equals(dec(q.payoffAmount.toFixed(2)))) {
        throw new BadRequestException(
          `The settlement amount today is ${q.payoffAmount.toFixed(2)} (principal ${q.outstandingPrincipal.toFixed(2)} + interest due ${q.accruedInterestDue.toFixed(2)} + penalties ${q.outstandingPenalty.toFixed(2)}).`,
        );
      }
      const allocation: StoredAllocation = {
        kind: 'SETTLEMENT',
        lines: q.lines.map((l) => ({
          scheduleId: l.id,
          principal: l.principal.toFixed(2),
          interest: l.interest.toFixed(2),
          penalty: l.penalty.toFixed(2),
          waivedInterest: l.waivedInterest.toFixed(2),
        })),
      };
      const created = await tx.repayment.create({
        data: {
          tenantId: loan.tenantId,
          loanId: loan.id,
          amount: q.payoffAmount,
          currency: loan.currency,
          interestPaid: q.accruedInterestDue,
          principalPaid: q.outstandingPrincipal,
          penaltyPaid: q.outstandingPenalty,
          date: asOf,
          idempotencyKey: dto.idempotencyKey,
          allocation: allocation as unknown as Prisma.InputJsonValue,
        },
      });
      for (const l of allocation.lines) {
        await tx.repaymentSchedule.updateMany({
          where: { id: l.scheduleId, loanId: loan.id },
          data: {
            paidPrincipal: { increment: l.principal },
            paidInterest: { increment: l.interest },
            paidPenalty: { increment: l.penalty },
            // Interest not yet due is waived: it leaves the instalment.
            interestAmount: { decrement: l.waivedInterest },
            totalAmount: { decrement: l.waivedInterest },
            isPaid: true,
          },
        });
      }
      const acc = (await this.settings.get(loan.tenantId, tx)).accounting;
      const lines: { accountCode: string; debit?: number; credit?: number }[] = [
        { accountCode: acc.cash, debit: q.payoffAmount },
      ];
      if (q.outstandingPrincipal > 0) lines.push({ accountCode: acc.legacy.loansReceivable, credit: q.outstandingPrincipal });
      if (q.accruedInterestDue > 0) lines.push({ accountCode: acc.legacy.interestIncome, credit: q.accruedInterestDue });
      if (q.outstandingPenalty > 0) lines.push({ accountCode: acc.legacy.penaltyIncome, credit: q.outstandingPenalty });
      if (q.payoffAmount > 0) {
        await this.ledger.postEntry(
          {
            tenantId: loan.tenantId,
            source: JournalSource.REPAYMENT,
            description: `Early settlement of loan ${loan.id}`,
            currency: loan.currency,
            loanId: loan.id,
            referenceId: created.id,
            createdByUserId: this.authz.actorId(actor),
            lines: lines as never,
          },
          tx,
        );
      }
      const closed = await tx.loan.updateMany({
        where: { id: loan.id, status: { in: OPEN_STATUSES } },
        data: { status: LoanStatus.CLOSED },
      });
      if (closed.count !== 1) throw new ConflictException('The loan changed while it was being settled. Reload and try again.');
      return { created, q } as const;
    });
    if ('replay' in result) return result.replay;
    const { created: repayment, q } = result;
    await this.audit.logAction(loan.tenantId, this.authz.actorId(actor), 'UPDATE', 'Loan', loan.id, {
      action: 'Early settlement',
      payoff: q.payoffAmount,
      futureInterestWaived: q.futureInterestWaived,
      repaymentId: repayment.id,
    });
    return { repayment, ...q, status: LoanStatus.CLOSED };
  }

  /**
   * Post a repayment to a legacy loan (D-098). The loan row is locked
   * (`SELECT … FOR UPDATE`) and its unpaid instalments re-read inside the
   * transaction, the payment is allocated in exact decimals, and each
   * instalment's paid amounts are incremented — so two concurrent payments
   * are applied one after the other and the schedule always agrees with the
   * ledger.
   */
  async postRepayment(actor: JwtPayload, dto: PostRepaymentDto) {
    this.authz.assertPermission(actor, Permission.LOAN_REPAYMENT_POST);

    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor, { id: dto.loanId }),
      include: { borrower: true },
    });

    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);
    await this.legacyGate?.assertOpen(loan.tenantId, 'repayment');
    // A DEFAULTED loan is still owed and must be able to receive collections.
    if (!OPEN_STATUSES.includes(loan.status)) {
      throw new BadRequestException(
        'Can only post repayments for disbursed or defaulted loans',
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

    if (!(dto.amount > 0)) {
      throw new BadRequestException(
        'Repayment amount must be strictly greater than 0',
      );
    }
    const amount = dec(dto.amount);
    if (!cents(amount).equals(amount)) {
      throw new BadRequestException('Repayment amounts are in whole cents (at most two decimals).');
    }

    const actorId = this.authz.actorId(actor);
    let result: Awaited<ReturnType<RepaymentsService['applyRepayment']>>;
    try {
      result = await this.prisma.$transaction((tx) =>
        this.applyRepayment(tx, loan, dto, amount, actorId),
      );
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
    if (result.replay) return result.replay;
    const { repayment, alloc, closed } = result;

    await this.audit.logAction(
      loan.tenantId,
      actorId,
      'CREATE',
      'Repayment',
      repayment.id,
      {
        ...dto,
        allocatedInterest: alloc.interest.toFixed(2),
        allocatedPrincipal: alloc.principal.toFixed(2),
      },
    );
    if (closed) {
      await this.audit.logAction(loan.tenantId, actorId, 'UPDATE', 'Loan', loan.id, {
        action: 'Auto-closed due to full repayment',
      });
    }

    // Best-effort receipt to the borrower via email/SMS (no-op unless a provider
    // is configured and the borrower has an email/phone). Never blocks the post.
    const paid = formatCurrency(dto.amount, loan.currency as unknown as SharedCurrency);
    const b = loan.borrower;
    if (b?.email) {
      void this.notifications.sendEmail(
        b.email,
        'Payment received',
        `<p>Dear ${b.firstName},</p><p>We have received your payment of <b>${paid}</b> toward loan ${loan.id}. Thank you.</p>`,
      );
    }
    if (b?.phone) {
      void this.notifications.sendSms(b.phone, `Payment of ${paid} received for your loan. Thank you.`);
    }

    return repayment;
  }

  /** The repayment's writes, under the loan's row lock. */
  private async applyRepayment(
    tx: Prisma.TransactionClient,
    loan: { id: string; tenantId: string; currency: any },
    dto: PostRepaymentDto,
    amount: Prisma.Decimal,
    actorId: string | null,
  ) {
    await lockLegacyLoan(tx, loan.id, loan.tenantId);
    if (dto.idempotencyKey) {
      const existing = await tx.repayment.findFirst({
        where: { tenantId: loan.tenantId, idempotencyKey: dto.idempotencyKey },
      });
      if (existing) return { replay: existing } as const;
    }
    const fresh = await tx.loan.findFirst({ where: { id: loan.id }, select: { status: true } });
    if (!fresh || !OPEN_STATUSES.includes(fresh.status)) {
      throw new BadRequestException('Can only post repayments for disbursed or defaulted loans');
    }
    const schedules = await tx.repaymentSchedule.findMany({
      where: { loanId: loan.id, isPaid: false },
      orderBy: { installmentNumber: 'asc' },
    });
    const due = totalDue(schedules);
    if (amount.gt(due)) {
      throw new BadRequestException(
        `Repayment amount cannot exceed the remaining balance of ${due.toFixed(2)}`,
      );
    }

    // Allocate payment: interest → principal → penalty, across instalments.
    const alloc = allocateRepayment(schedules, amount);
    const allocation: StoredAllocation = {
      kind: 'REPAYMENT',
      lines: alloc.lines.map(({ isPaid: _isPaid, ...l }) => l),
    };
    const created = await tx.repayment.create({
      data: {
        tenantId: loan.tenantId,
        loanId: loan.id,
        amount: amount.toFixed(2),
        currency: loan.currency,
        interestPaid: alloc.interest.toFixed(2),
        principalPaid: alloc.principal.toFixed(2),
        penaltyPaid: alloc.penalty.toFixed(2),
        date: new Date(dto.date),
        idempotencyKey: dto.idempotencyKey,
        allocation: allocation as unknown as Prisma.InputJsonValue,
      },
    });

    for (const l of alloc.lines) {
      await tx.repaymentSchedule.updateMany({
        where: { id: l.scheduleId, loanId: loan.id },
        data: {
          paidInterest: { increment: l.interest },
          paidPrincipal: { increment: l.principal },
          paidPenalty: { increment: l.penalty },
          isPaid: l.isPaid,
        },
      });
    }

    // Feature #3: GL posting — Dr Cash; Cr Loans Receivable (principal),
    // Interest Income (interest), Penalty Income (penalty).
    if (alloc.applied.gt(0)) {
      const acc = (await this.settings.get(loan.tenantId, tx)).accounting;
      const lines: { accountCode: string; debit?: number; credit?: number }[] = [
        { accountCode: acc.cash, debit: ledgerAmount(alloc.applied) },
      ];
      if (alloc.principal.gt(0)) lines.push({ accountCode: acc.legacy.loansReceivable, credit: ledgerAmount(alloc.principal) });
      if (alloc.interest.gt(0)) lines.push({ accountCode: acc.legacy.interestIncome, credit: ledgerAmount(alloc.interest) });
      if (alloc.penalty.gt(0)) lines.push({ accountCode: acc.legacy.penaltyIncome, credit: ledgerAmount(alloc.penalty) });
      await this.ledger.postEntry(
        {
          tenantId: loan.tenantId,
          source: JournalSource.REPAYMENT,
          description: `Repayment on loan ${loan.id}`,
          currency: loan.currency,
          loanId: loan.id,
          referenceId: created.id,
          createdByUserId: actorId,
          lines,
        },
        tx,
      );
    }

    // Close the loan once nothing is left unpaid.
    let closed = false;
    const unpaidCount = await tx.repaymentSchedule.count({
      where: { loanId: loan.id, isPaid: false },
    });
    if (unpaidCount === 0 && alloc.lines.length > 0) {
      const c = await tx.loan.updateMany({
        where: { id: loan.id, status: { in: OPEN_STATUSES } },
        data: { status: LoanStatus.CLOSED },
      });
      closed = c.count === 1;
    }
    return { replay: null, repayment: created, alloc, closed } as const;
  }

  /**
   * P1 #13: reverse a posted repayment (D-103). Only the loan's latest
   * repayment that is not reversed can be reversed, so the schedule is put
   * back exactly as it was before it: the instalments lose what the payment
   * gave them (and a settlement's waived interest is owed again), and the
   * ledger posts the mirror of the original entry. Earlier repayments are
   * never re-allocated.
   */
  async reverseRepayment(actor: JwtPayload, repaymentId: string, reason: string) {
    this.authz.assertPermission(actor, Permission.LOAN_REPAYMENT_POST);
    const repayment = await this.prisma.repayment.findFirst({
      where: this.authz.scopeWhere(actor, { id: repaymentId }),
      include: { loan: true },
    });
    if (!repayment) throw new NotFoundException('Repayment not found');
    this.authz.assertBranchAccess(actor, repayment.loan.branchId);
    await this.legacyGate?.assertOpen(repayment.tenantId, 'reversal');
    if (repayment.reversedAt) throw new BadRequestException('Repayment is already reversed.');
    if (!reason || !reason.trim()) throw new BadRequestException('A reversal reason is required.');

    const loanId = repayment.loanId;
    const actorId = this.authz.actorId(actor);
    const principalReversed = Number(repayment.principalPaid);
    const interestReversed = Number(repayment.interestPaid);
    const penaltyReversed = Number(repayment.penaltyPaid);

    const { willReopen, waivedRestored } = await this.prisma.$transaction(async (tx) => {
      await lockLegacyLoan(tx, loanId, repayment.tenantId);
      // Bug #7: atomic guard — only one concurrent reversal wins.
      const claim = await tx.repayment.updateMany({
        where: { id: repaymentId, reversedAt: null },
        data: { reversedAt: new Date(), reversedByUserId: actorId, reversalReason: reason.trim() },
      });
      if (claim.count !== 1) {
        throw new BadRequestException('Repayment is already reversed.');
      }
      const latest = await tx.repayment.findFirst({
        where: { loanId, reversedAt: null, id: { not: repaymentId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, createdAt: true },
      });
      if (
        latest &&
        (latest.createdAt > repayment.createdAt ||
          (latest.createdAt.getTime() === repayment.createdAt.getTime() && latest.id > repayment.id))
      ) {
        throw new ConflictException({
          message: `Only the latest repayment on a loan can be reversed. Reverse the later repayment ${latest.id} first.`,
          code: 'LEGACY_REVERSAL_NOT_LATEST',
          latestRepaymentId: latest.id,
        });
      }
      const migrated = await tx.journalEntry.findFirst({
        where: { tenantId: repayment.tenantId, loanId, description: { startsWith: MIGRATED_PREFIX } },
        select: { id: true },
      });
      if (migrated) {
        throw new ConflictException('This loan was moved to the lending platform; reverse the payment there instead.');
      }
      const loanNow = await tx.loan.findFirst({ where: { id: loanId }, select: { status: true } });
      if (loanNow?.status === LoanStatus.WRITTEN_OFF) {
        throw new ConflictException('The loan has been written off; a repayment before the write-off cannot be reversed.');
      }

      const schedules = await tx.repaymentSchedule.findMany({
        where: { loanId },
        orderBy: { installmentNumber: 'asc' },
      });
      const stored = repayment.allocation as unknown as StoredAllocation | null;
      let lines: StoredAllocation['lines'];
      if (stored?.lines) {
        lines = stored.lines;
      } else {
        // Posted before allocations were recorded. A settlement's waived
        // interest is not known, so it cannot be put back automatically.
        const settlement = await tx.journalEntry.findFirst({
          where: {
            tenantId: repayment.tenantId,
            referenceId: repaymentId,
            description: { startsWith: 'Early settlement of loan' },
          },
          select: { id: true },
        });
        if (settlement) {
          throw new ConflictException(
            'This settlement was recorded before waived interest was kept per instalment; reverse it with a manual journal and correct the schedule by migration.',
          );
        }
        try {
          lines = unallocateByComponent(schedules, {
            principal: dec(repayment.principalPaid),
            interest: dec(repayment.interestPaid),
            penalty: dec(repayment.penaltyPaid),
          });
        } catch (e) {
          throw new ConflictException((e as Error).message);
        }
      }

      let waived = dec(0);
      for (const l of lines) {
        waived = waived.plus(dec(l.waivedInterest));
        await tx.repaymentSchedule.updateMany({
          where: { id: l.scheduleId, loanId },
          data: {
            paidInterest: { decrement: l.interest },
            paidPrincipal: { decrement: l.principal },
            paidPenalty: { decrement: l.penalty },
            // A settlement's waived interest is owed again.
            interestAmount: { increment: l.waivedInterest },
            totalAmount: { increment: l.waivedInterest },
          },
        });
      }
      // Whether each touched instalment is still fully paid.
      const touched = await tx.repaymentSchedule.findMany({
        where: { loanId, id: { in: lines.map((l) => l.scheduleId) } },
      });
      for (const s of touched) {
        const paid = dec(s.paidInterest).plus(dec(s.paidPrincipal)).plus(dec(s.paidPenalty));
        const isPaid = paid.gte(dec(s.totalAmount));
        if (isPaid !== s.isPaid)
          await tx.repaymentSchedule.updateMany({ where: { id: s.id, loanId }, data: { isPaid } });
      }

      // GL contra-entry: reverse the original repayment postings.
      const cashReversed = ledgerAmount(
        dec(repayment.principalPaid).plus(dec(repayment.interestPaid)).plus(dec(repayment.penaltyPaid)),
      );
      if (cashReversed > 0) {
        const acc = (await this.settings.get(repayment.tenantId, tx)).accounting;
        const gl: any[] = [{ accountCode: acc.cash, credit: cashReversed }];
        if (principalReversed > 0) gl.push({ accountCode: acc.legacy.loansReceivable, debit: principalReversed });
        if (interestReversed > 0) gl.push({ accountCode: acc.legacy.interestIncome, debit: interestReversed });
        if (penaltyReversed > 0) gl.push({ accountCode: acc.legacy.penaltyIncome, debit: penaltyReversed });
        await this.ledger.postEntry(
          {
            tenantId: repayment.tenantId,
            source: JournalSource.MANUAL,
            description: `Reversal of repayment ${repaymentId}`,
            currency: repayment.currency,
            loanId,
            referenceId: repaymentId,
            createdByUserId: actorId,
            lines: gl,
          },
          tx,
        );
      }

      // Reopen a loan that was closed but is no longer fully paid.
      const unpaid = await tx.repaymentSchedule.count({ where: { loanId, isPaid: false } });
      let reopened = false;
      if (unpaid > 0) {
        const r = await tx.loan.updateMany({
          where: { id: loanId, status: LoanStatus.CLOSED },
          data: { status: LoanStatus.DISBURSED },
        });
        reopened = r.count === 1;
      }
      return { willReopen: reopened, waivedRestored: waived.toFixed(2) };
    });

    await this.audit.logSecurityEvent({
      actorUserId: actorId,
      actorRole: actor.role,
      actorTenantId: repayment.tenantId,
      targetType: 'Repayment',
      targetId: repaymentId,
      action: 'REPAYMENT_REVERSE',
      newValue: { reason: reason.trim(), principalReversed, interestReversed, waivedInterestRestored: waivedRestored },
      result: 'SUCCESS',
    });

    return { success: true, reversedRepaymentId: repaymentId, loanReopened: willReopen, waivedInterestRestored: waivedRestored };
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
