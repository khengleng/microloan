import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateLoanDto, ChangeLoanStatusDto } from './dto/create-loan.dto';
import { calculateRepaymentSchedule, LoanParams } from '@microloan/shared';
import { LoanStatus } from '@microloan/db';

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
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
          interestMethod: dto.interestMethod, // this is correct, types mapped properly
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
        borrower: true,
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
    id: string,
    dto: ChangeLoanStatusDto,
  ) {
    const loan = await this.prisma.loan.findUnique({ where: { id, tenantId } });
    if (!loan) throw new NotFoundException('Loan not found');

    // Status machine logic
    if (loan.status === LoanStatus.CLOSED) {
      throw new BadRequestException('Cannot change status of a closed loan');
    }

    const updated = await this.prisma.loan.update({
      where: { id },
      data: { status: dto.status as LoanStatus },
    });

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

    await this.prisma.loan.delete({ where: { id } });
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

    await this.prisma.document.delete({ where: { id: documentId } });
    await this.audit.logAction(tenantId, userId, 'DELETE', 'Document', documentId, { loanId, name: document.name });
    return { success: true };
  }
}
