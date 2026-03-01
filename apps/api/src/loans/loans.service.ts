import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateLoanDto, ChangeLoanStatusDto } from './dto/create-loan.dto';
import { calculateRepaymentSchedule, LoanParams } from '@microloan/shared';
import { LoanStatus } from '@microloan/db';
import { BotService } from '../bot/bot.service';

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    @Inject(forwardRef(() => BotService))
    private bot: BotService,
  ) { }

  async create(tenantId: string, userId: string, dto: CreateLoanDto) {
    // 1. Validate borrower
    const borrower = await this.prisma.borrower.findUnique({
      where: { id: dto.borrowerId, tenantId },
    });
    if (!borrower) throw new NotFoundException('Borrower not found');

    // 2. Generate Schedule
    const params: LoanParams = {
      principal: dto.principal,
      annualInterestRate: dto.annualInterestRate,
      termMonths: dto.termMonths,
      startDate: new Date(dto.startDate),
      interestMethod: dto.interestMethod,
    };
    const scheduleItems = calculateRepaymentSchedule(params);

    // 3. Create Loan + Schedule in transaction
    const loan = await this.prisma.$transaction(async (tx) => {
      const createdLoan = await tx.loan.create({
        data: {
          tenantId,
          borrowerId: dto.borrowerId,
          principal: dto.principal,
          annualInterestRate: dto.annualInterestRate,
          termMonths: dto.termMonths,
          startDate: new Date(dto.startDate),
          interestMethod: dto.interestMethod,
          productId: dto.productId,
          creditRatingApplied: dto.creditRatingApplied,
          status: LoanStatus.DRAFT,
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

    await this.audit.logAction(
      tenantId,
      userId,
      'CREATE',
      'Loan',
      loan.id,
      dto,
    );
    return loan;
  }

  async findAll(tenantId: string) {
    return this.prisma.loan.findMany({
      where: { tenantId },
      include: { borrower: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id, tenantId },
      include: {
        borrower: { include: { loans: true } },
        schedules: { orderBy: { installmentNumber: 'asc' } },
        repayments: { orderBy: { date: 'asc' } },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  async changeStatus(
    tenantId: string,
    userId: string,
    userRole: string,
    id: string,
    dto: ChangeLoanStatusDto,
  ) {
    const loan = await this.prisma.loan.findUnique({ where: { id, tenantId } });
    if (!loan) throw new NotFoundException('Loan not found');

    // ── Strict Financial Transition State Machine (RBAC) ─────────────────────
    const currentStatus = loan.status;
    const targetStatus = dto.status as LoanStatus;

    if (currentStatus === LoanStatus.CLOSED) {
      throw new BadRequestException('Cannot change status of a closed loan');
    }

    if (currentStatus === targetStatus) return loan;

    // Transition Rule 1: DRAFT -> APPROVED
    if (currentStatus === LoanStatus.DRAFT && targetStatus === ('APPROVED' as any)) {
      if (!['SUPERADMIN', 'ADMIN', 'FINANCE', 'OPERATOR'].includes(userRole)) {
        throw new ForbiddenException(`Your role (${userRole}) is not authorized to APPROVE loans.`);
      }
    }

    // Transition Rule 2: APPROVED -> DISBURSED
    if (currentStatus === ('APPROVED' as any) && targetStatus === LoanStatus.DISBURSED) {
      if (!['SUPERADMIN', 'ADMIN', 'FINANCE'].includes(userRole)) {
        throw new ForbiddenException(`Your role (${userRole}) is not authorized to DISBURSE funds.`);
      }
    }

    // Transition Rule 3: Mark as DEFAULTED
    if (targetStatus === LoanStatus.DEFAULTED) {
      if (!['SUPERADMIN', 'ADMIN'].includes(userRole)) {
        throw new ForbiddenException(`Only an ADMIN can mark a loan as DEFAULTED.`);
      }
    }

    // Protection for backward transitions (e.g. DISBURSED -> DRAFT)
    if (currentStatus === LoanStatus.DISBURSED && ['DRAFT', 'APPROVED'].includes(targetStatus)) {
      if (!['SUPERADMIN', 'ADMIN'].includes(userRole)) {
        throw new ForbiddenException(`Cannot reverse a disbursed loan without ADMIN privileges.`);
      }
    }

    const updated = await this.prisma.loan.update({
      where: { id, tenantId },
      data: { status: dto.status as LoanStatus },
      include: { borrower: true },
    });

    if (updated.status === LoanStatus.DISBURSED && loan.status !== LoanStatus.DISBURSED) {
      // Send alert via telegram if they have a telegram chat mapped to them
      if (updated.borrower.telegramChatId) {
        try {
          const msg = `🎉 Good news! Your loan of **$${updated.principal}** has been DISBURSED and is now ready. Please check the Magic Money portal for your repayment schedule.`;
          await this.bot.sendDisbursementAlert(tenantId, updated.borrower.telegramChatId, msg);
        } catch (error) {
          console.error('Failed to send telegram disbursement alert', error);
        }
      }
    }

    await this.audit.logAction(tenantId, userId, 'UPDATE', 'Loan', loan.id, {
      old: loan.status,
      new: dto.status,
    });
    return updated;
  }

  async remove(tenantId: string, userId: string, id: string) {
    const loan = await this.prisma.loan.findUnique({ where: { id, tenantId } });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.status !== LoanStatus.DRAFT) {
      throw new BadRequestException('Only draft loans can be deleted');
    }

    await this.prisma.loan.delete({ where: { id, tenantId } });
    await this.audit.logAction(tenantId, userId, 'DELETE', 'Loan', id, loan);
    return { success: true };
  }

  async addDocument(
    tenantId: string,
    userId: string,
    loanId: string,
    dto: { name: string; content: string; type: string },
  ) {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId, tenantId } });
    if (!loan) throw new NotFoundException('Loan not found');

    if (dto.content.length > 5 * 1024 * 1024) { // 5MB limit
      throw new BadRequestException('File is too large. Limit is 5MB.');
    }

    const document = await this.prisma.document.create({
      data: {
        tenantId,
        loanId,
        name: dto.name,
        content: dto.content,
        type: dto.type,
      },
    });

    await this.audit.logAction(tenantId, userId, 'CREATE', 'Document', document.id, { loanId, name: dto.name });
    return document;
  }

  async removeDocument(tenantId: string, userId: string, loanId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId, tenantId, loanId },
    });
    if (!document) throw new NotFoundException('Document not found');

    await this.prisma.document.delete({ where: { id: documentId, tenantId, loanId } });
    await this.audit.logAction(tenantId, userId, 'DELETE', 'Document', documentId, { loanId, name: document.name });
    return { success: true };
  }
}
