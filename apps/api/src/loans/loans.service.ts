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
import { calculateRepaymentSchedule, LoanParams } from '@microloan/shared';
import { LoanStatus } from '@microloan/db';
import { BotService } from '../bot/bot.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private authz: AuthzService,
    @Inject(forwardRef(() => BotService))
    private bot: BotService,
  ) {}

  async create(actor: JwtPayload, dto: CreateLoanDto) {
    this.authz.assertPermission(actor, Permission.LOAN_APPLICATION_CREATE);

    const borrower = await this.prisma.borrower.findFirst({
      where: this.authz.scopeWhere(actor, { id: dto.borrowerId }),
    });
    if (!borrower) throw new NotFoundException('Borrower not found');
    this.authz.assertBranchAccess(actor, borrower.branchId);

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

    const updated = await this.prisma.loan.update({
      where: { id: loan.id },
      data,
      include: { borrower: true },
    });

    if (updated.status === LoanStatus.DISBURSED && loan.status !== LoanStatus.DISBURSED && updated.borrower.telegramChatId) {
      try {
        const msg = `🎉 Your loan of **$${updated.principal}** has been DISBURSED. Check your schedule at the Magic Money portal.`;
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
}

