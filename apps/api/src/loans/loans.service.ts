import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateLoanDto, ChangeLoanStatusDto } from './dto/create-loan.dto';
import {
  calculateRepaymentSchedule,
  LoanParams,
  checkInterestRateCap,
  normalizeCurrency,
  formatCurrency,
  Currency as SharedCurrency,
} from '@microloan/shared';
import { LoanStatus, Currency, JournalSource } from '@microloan/db';
import { BotService } from '../bot/bot.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import { LedgerService } from '../ledger/ledger.service';
import { ACCOUNT_CODES } from '../ledger/chart-of-accounts';
import { isCbcConfigured } from '../credit-bureau/cbc.provider';

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private authz: AuthzService,
    private ledger: LedgerService,
    @Inject(forwardRef(() => BotService))
    private bot: BotService,
  ) {}

  async create(actor: JwtPayload, dto: CreateLoanDto) {
    this.authz.assertPermission(actor, Permission.LOAN_APPLICATION_CREATE);

    const borrower = await this.prisma.borrower.findFirst({
      where: this.authz.scopeWhere(actor, { id: dto.borrowerId }),
      include: { tenant: { select: { maxAnnualInterestRatePct: true } } },
    });
    if (!borrower) throw new NotFoundException('Borrower not found');
    this.authz.assertBranchAccess(actor, borrower.branchId);

    // Feature #1: enforce the NBC interest-rate cap (tenant may set a lower cap).
    const cap = checkInterestRateCap(
      dto.annualInterestRate,
      Number(borrower.tenant?.maxAnnualInterestRatePct),
    );
    if (!cap.ok) {
      throw new BadRequestException(cap.message);
    }

    const currency = normalizeCurrency(dto.currency) as unknown as Currency;

    // Prevent referencing another tenant's loan product via a forged productId.
    if (dto.productId) {
      const product = await this.prisma.loanProduct.findFirst({
        where: { id: dto.productId, tenantId: borrower.tenantId },
        select: { id: true },
      });
      if (!product) throw new NotFoundException('Loan product not found');
    }

    const params: LoanParams = {
      principal: dto.principal,
      annualInterestRate: dto.annualInterestRate,
      termMonths: dto.termMonths,
      startDate: new Date(dto.startDate),
      interestMethod: dto.interestMethod,
    };
    const scheduleItems = calculateRepaymentSchedule(params);
    const actorId = this.authz.actorId(actor);

    const loan = await this.prisma.$transaction(async (tx) => {
      const createdLoan = await tx.loan.create({
        data: {
          tenantId: borrower.tenantId,
          branchId: borrower.branchId,
          borrowerId: dto.borrowerId,
          principal: dto.principal,
          annualInterestRate: dto.annualInterestRate,
          termMonths: dto.termMonths,
          currency,
          startDate: new Date(dto.startDate),
          interestMethod: dto.interestMethod,
          productId: dto.productId,
          creditRatingApplied: dto.creditRatingApplied,
          status: LoanStatus.PENDING,
          createdByUserId: actorId,
          collaterals: dto.collaterals
            ? {
                create: dto.collaterals.map((c) => ({
                  type: c.type,
                  description: c.description,
                  value: c.value,
                  idNumber: c.idNumber,
                })),
              }
            : undefined,
          guarantors: dto.guarantors
            ? {
                create: dto.guarantors.map((g) => ({
                  name: g.name,
                  phone: g.phone,
                  idNumber: g.idNumber,
                  relation: g.relation,
                })),
              }
            : undefined,
        },
      });

      if (scheduleItems.length > 0) {
        await tx.repaymentSchedule.createMany({
          data: scheduleItems.map((item) => ({
            loanId: createdLoan.id,
            installmentNumber: item.installmentNumber,
            dueDate: item.dueDate,
            principalAmount: item.principalAmount,
            interestAmount: item.interestAmount,
            totalAmount: item.totalAmount,
            outstandingPrincipal: item.outstandingPrincipal,
          })),
        });
      }

      return createdLoan;
    });

    await this.audit.logSecurityEvent({
      actorUserId: actorId,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      targetType: 'Loan',
      targetId: loan.id,
      action: 'LOAN_CREATE',
      result: 'SUCCESS',
    });

    return loan;
  }

  async findAll(actor: JwtPayload, search?: string, status?: string, page = 1, limit = 50) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const where: any = this.authz.scopeWhere(actor, {});
    if (status && status !== 'ALL') where.status = status;
    if (search) {
      where.borrower = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ],
      };
    }
    if (actor.branchId) {
      where.branchId = actor.branchId;
    }

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        include: { borrower: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.loan.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(actor: JwtPayload, id: string) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
      include: {
        borrower: { include: { loans: true } },
        schedules: { orderBy: { installmentNumber: 'asc' } },
        repayments: { orderBy: { date: 'asc' } },
        documents: { orderBy: { createdAt: 'desc' } },
        collaterals: true,
        guarantors: true,
        interactions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);
    return loan;
  }

  async changeStatus(actor: JwtPayload, id: string, dto: ChangeLoanStatusDto) {
    const loan = await this.prisma.loan.findFirst({ where: this.authz.scopeWhere(actor, { id }) });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);

    const currentStatus = loan.status;
    const targetStatus = dto.status as LoanStatus;
    const actorId = this.authz.actorId(actor);

    if (currentStatus === LoanStatus.CLOSED) {
      throw new BadRequestException('Cannot change status of a closed loan');
    }
    if (currentStatus === targetStatus) return loan;

    const data: any = { status: targetStatus };
    if (targetStatus === LoanStatus.APPROVED) {
      this.authz.assertPermission(actor, Permission.LOAN_APPROVE);
      this.authz.assertMakerChecker(actor, loan.createdByUserId, Permission.LOAN_APPROVE);
      if (loan.reviewedByUserId && loan.reviewedByUserId === actorId) {
        throw new BadRequestException('Reviewer cannot approve the same loan.');
      }
      // Feature #3: block approval without a valid CBC credit check (tenant-configurable).
      await this.assertCreditCheckForApproval(loan.tenantId, loan.borrowerId);
      data.approvedBy = actorId;
      data.approvedAt = new Date();
      data.reviewedByUserId = data.reviewedByUserId || actorId;
    } else if (targetStatus === LoanStatus.REJECTED) {
      this.authz.assertPermission(actor, Permission.LOAN_REJECT);
      this.authz.assertMakerChecker(actor, loan.createdByUserId, Permission.LOAN_REJECT);
      data.rejectedBy = actorId;
      data.rejectedAt = new Date();
      data.rejectionReason = dto.reason;
      data.reviewedByUserId = data.reviewedByUserId || actorId;
    } else if (targetStatus === LoanStatus.DISBURSED) {
      this.authz.assertPermission(actor, Permission.LOAN_DISBURSE);
      if (loan.approvedBy && loan.approvedBy === actorId) {
        throw new BadRequestException('Approver cannot disburse the same loan.');
      }
      this.authz.assertMakerChecker(actor, loan.createdByUserId, Permission.LOAN_DISBURSE);
      data.disbursedByUserId = actorId;
    } else {
      throw new BadRequestException('Unsupported status transition');
    }

    let updated;
    if (targetStatus === LoanStatus.DISBURSED) {
      // Feature #1: snapshot FX rate to base currency for stable portfolio value.
      data.fxRateToBase = await this.resolveFxRateToBase(loan.tenantId, loan.currency);

      // Feature #3: post the disbursement to the general ledger atomically.
      const principal = Number(loan.principal);

      // P1 #11: origination fee from the product, deducted from disbursed cash
      // and recognised as fee income. Capped at principal for safety.
      let feeAmount = 0;
      if (loan.productId) {
        const product = await this.prisma.loanProduct.findUnique({
          where: { id: loan.productId },
          select: { processingFeePct: true, adminFee: true },
        });
        if (product) {
          const pct = Number(product.processingFeePct || 0);
          const flat = Number(product.adminFee || 0);
          feeAmount = Math.min(principal, Math.round((principal * pct / 100 + flat) * 100) / 100);
        }
      }
      data.feeCharged = feeAmount;
      const cashOut = Math.round((principal - feeAmount) * 100) / 100;

      updated = await this.prisma.$transaction(async (tx) => {
        const u = await tx.loan.update({
          where: { id: loan.id },
          data,
          include: { borrower: true },
        });
        const lines: any[] = [
          { accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, debit: principal },
          { accountCode: ACCOUNT_CODES.CASH, credit: cashOut },
        ];
        if (feeAmount > 0) {
          lines.push({ accountCode: ACCOUNT_CODES.FEE_INCOME, credit: feeAmount });
        }
        await this.ledger.postEntry(
          {
            tenantId: loan.tenantId,
            source: JournalSource.DISBURSEMENT,
            description: `Loan ${loan.id} disbursed${feeAmount > 0 ? ` (fee ${feeAmount})` : ''}`,
            currency: loan.currency,
            loanId: loan.id,
            createdByUserId: actorId,
            lines,
          },
          tx,
        );
        return u;
      });
    } else {
      updated = await this.prisma.loan.update({
        where: { id: loan.id },
        data,
        include: { borrower: true },
      });
    }

    if (updated.status === LoanStatus.DISBURSED && loan.status !== LoanStatus.DISBURSED && updated.borrower.telegramChatId) {
      try {
        const amount = formatCurrency(Number(updated.principal), updated.currency as unknown as SharedCurrency);
        const msg = `🎉 Your loan of **${amount}** has been DISBURSED. Check your schedule at the Magic Money portal.`;
        await this.bot.sendDisbursementAlert(updated.tenantId, updated.borrower.telegramChatId, msg);
      } catch {}
    }

    await this.audit.logSecurityEvent({
      actorUserId: actorId,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      targetType: 'Loan',
      targetId: loan.id,
      action: `LOAN_STATUS_${targetStatus}`,
      oldValue: { status: loan.status },
      newValue: { status: targetStatus, reason: dto.reason || null },
      result: 'SUCCESS',
    });
    return updated;
  }

  async findOverdue(actor: JwtPayload) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const today = new Date();
    const where: any = this.authz.scopeWhere(actor, {
      status: LoanStatus.DISBURSED,
      schedules: {
        some: {
          dueDate: { lt: today },
          isPaid: false,
        },
      },
    });
    if (actor.branchId) {
      where.branchId = actor.branchId;
    }
    return this.prisma.loan.findMany({
      where,
      include: {
        borrower: true,
        schedules: {
          where: { dueDate: { lt: today }, isPaid: false },
        },
      },
    });
  }

  async addInteraction(actor: JwtPayload, loanId: string, notes: string, title?: string, type?: string) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_UPDATE);
    const loan = await this.prisma.loan.findFirst({ where: this.authz.scopeWhere(actor, { id: loanId }) });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);

    return this.prisma.loanInteraction.create({
      data: {
        loanId,
        userId: this.authz.actorId(actor),
        notes,
        title,
        type: type || 'NOTE',
      },
    });
  }

  /**
   * P1 #9: early-settlement payoff quote (read-only). Payoff today = outstanding
   * principal + interest already due (accrued) + outstanding penalties. Interest
   * on installments due after today is waived on early settlement.
   */
  async payoffQuote(actor: JwtPayload, id: string) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
      include: { schedules: true },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);

    const now = new Date();
    let outstandingPrincipal = 0;
    let accruedInterestDue = 0;
    let futureInterestWaived = 0;
    let outstandingPenalty = 0;
    for (const s of loan.schedules) {
      if (s.isPaid) continue;
      outstandingPrincipal += Math.max(0, Number(s.principalAmount) - Number(s.paidPrincipal));
      outstandingPenalty += Math.max(0, Number(s.penaltyAmount) - Number(s.paidPenalty));
      const dueInterest = Math.max(0, Number(s.interestAmount) - Number(s.paidInterest));
      if (new Date(s.dueDate) <= now) accruedInterestDue += dueInterest;
      else futureInterestWaived += dueInterest;
    }
    const round = (x: number) => Math.round(x * 100) / 100;
    const payoffAmount = round(outstandingPrincipal + accruedInterestDue + outstandingPenalty);

    return {
      loanId: loan.id,
      currency: loan.currency,
      asOf: now,
      outstandingPrincipal: round(outstandingPrincipal),
      accruedInterestDue: round(accruedInterestDue),
      outstandingPenalty: round(outstandingPenalty),
      futureInterestWaived: round(futureInterestWaived),
      payoffAmount,
    };
  }

  /**
   * P1 #9: write off an uncollectable loan. Posts Dr Allowance for Loan Losses /
   * Cr Loans Receivable for the outstanding principal and marks the loan
   * WRITTEN_OFF (removing it from the active portfolio).
   */
  async writeOff(actor: JwtPayload, id: string, reason: string) {
    this.authz.assertPermission(actor, Permission.LOAN_WRITEOFF);
    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
      include: { schedules: true },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);

    if (loan.status !== LoanStatus.DISBURSED && loan.status !== LoanStatus.DEFAULTED) {
      throw new BadRequestException('Only disbursed or defaulted loans can be written off.');
    }
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A write-off reason is required.');
    }

    const outstandingPrincipal = loan.schedules.reduce(
      (sum, s) => sum + (s.isPaid ? 0 : Math.max(0, Number(s.principalAmount) - Number(s.paidPrincipal))),
      0,
    );
    const amount = Math.round(outstandingPrincipal * 100) / 100;
    const actorId = this.authz.actorId(actor);

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.loan.update({
        where: { id: loan.id },
        data: {
          status: LoanStatus.WRITTEN_OFF,
          writtenOffAt: new Date(),
          writtenOffByUserId: actorId,
          writeOffReason: reason.trim(),
        },
      });
      if (amount > 0) {
        await this.ledger.postEntry(
          {
            tenantId: loan.tenantId,
            source: JournalSource.WRITEOFF,
            description: `Write-off of loan ${loan.id}`,
            currency: loan.currency,
            loanId: loan.id,
            createdByUserId: actorId,
            lines: [
              { accountCode: ACCOUNT_CODES.ALLOWANCE_FOR_LOAN_LOSSES, debit: amount },
              { accountCode: ACCOUNT_CODES.LOANS_RECEIVABLE, credit: amount },
            ],
          },
          tx,
        );
      }
      return u;
    });

    await this.audit.logSecurityEvent({
      actorUserId: actorId,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      targetType: 'Loan',
      targetId: loan.id,
      action: 'LOAN_WRITEOFF',
      newValue: { writeOffAmount: amount, reason: reason.trim() },
      result: 'SUCCESS',
    });
    return updated;
  }

  async remove(actor: JwtPayload, id: string) {
    this.authz.assertPermission(actor, Permission.USER_DELETE);
    const loan = await this.prisma.loan.findFirst({ where: this.authz.scopeWhere(actor, { id }) });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);
    if (loan.status !== LoanStatus.PENDING) {
      throw new BadRequestException('Only pending loans can be deleted');
    }

    await this.prisma.loan.delete({ where: { id: loan.id } });
    await this.audit.logSecurityEvent({
      actorUserId: this.authz.actorId(actor),
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      targetType: 'Loan',
      targetId: id,
      action: 'LOAN_DELETE',
      result: 'SUCCESS',
    });
    return { success: true };
  }

  async addDocument(
    actor: JwtPayload,
    loanId: string,
    dto: { name: string; content: string; type: string },
  ) {
    this.authz.assertPermission(actor, Permission.DOCUMENT_UPLOAD);
    const loan = await this.prisma.loan.findFirst({ where: this.authz.scopeWhere(actor, { id: loanId }) });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);

    if (dto.content.length > 5 * 1024 * 1024) {
      throw new BadRequestException('File is too large. Limit is 5MB.');
    }

    const document = await this.prisma.document.create({
      data: {
        tenantId: loan.tenantId,
        loanId,
        name: dto.name,
        content: dto.content,
        type: dto.type,
      },
    });

    await this.audit.logSecurityEvent({
      actorUserId: this.authz.actorId(actor),
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      targetType: 'Document',
      targetId: document.id,
      action: 'DOCUMENT_UPLOAD',
      result: 'SUCCESS',
    });
    return document;
  }

  async removeDocument(actor: JwtPayload, loanId: string, documentId: string) {
    this.authz.assertPermission(actor, Permission.DOCUMENT_DELETE);
    const document = await this.prisma.document.findFirst({
      where: this.authz.scopeWhere(actor, { id: documentId, loanId }),
      include: { loan: true },
    });
    if (!document) throw new NotFoundException('Document not found');
    this.authz.assertBranchAccess(actor, document.loan.branchId);

    await this.prisma.document.delete({ where: { id: document.id } });
    await this.audit.logSecurityEvent({
      actorUserId: this.authz.actorId(actor),
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      targetType: 'Document',
      targetId: documentId,
      action: 'DOCUMENT_DELETE',
      result: 'SUCCESS',
    });
    return { success: true };
  }

  /**
   * Feature #3: enforce that a borrower has a COMPLETED credit-bureau (CBC)
   * check within the tenant's validity window before their loan is approved.
   * No-op when the tenant has disabled the requirement.
   */
  private async assertCreditCheckForApproval(tenantId: string, borrowerId: string) {
    // CBC isn't provisioned yet — don't block approvals on a check that can't be
    // produced. The requirement re-activates automatically once credentials are set.
    if (!isCbcConfigured()) return;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { requireCreditCheckForApproval: true, creditCheckValidityDays: true },
    });
    if (!tenant || !tenant.requireCreditCheckForApproval) return;

    const validityDays = tenant.creditCheckValidityDays ?? 90;
    const cutoff = new Date(Date.now() - validityDays * 24 * 60 * 60 * 1000);
    const recent = await this.prisma.creditCheck.findFirst({
      where: {
        tenantId,
        borrowerId,
        status: 'COMPLETED',
        completedAt: { gte: cutoff },
      },
      orderBy: { completedAt: 'desc' },
    });
    if (!recent) {
      throw new BadRequestException(
        `A completed credit bureau (CBC) check within the last ${validityDays} days is required before approving this loan.`,
      );
    }
  }

  /**
   * Feature #1: resolve the FX rate from a loan's currency to the tenant's base
   * currency, using the latest effective-dated ExchangeRate. Returns 1 when the
   * currencies match, or null when no rate is configured (loan still disburses;
   * base-currency value is simply unknown until a rate is entered).
   */
  private async resolveFxRateToBase(
    tenantId: string,
    loanCurrency: Currency,
  ): Promise<number | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { baseCurrency: true },
    });
    if (!tenant) return null;
    if (tenant.baseCurrency === loanCurrency) return 1;

    const rate = await this.prisma.exchangeRate.findFirst({
      where: {
        tenantId,
        fromCurrency: loanCurrency,
        toCurrency: tenant.baseCurrency,
        effectiveDate: { lte: new Date() },
      },
      orderBy: { effectiveDate: 'desc' },
    });
    return rate ? Number(rate.rate) : null;
  }
}

