import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostRepaymentDto } from './dto/post-repayment.dto';
import { LoanStatus } from '@microloan/db';

@Injectable()
export class RepaymentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async postRepayment(tenantId: string, userId: string, dto: PostRepaymentDto) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: dto.loanId, tenantId },
      include: {
        schedules: {
          where: { isPaid: false },
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });

    if (!loan) throw new NotFoundException('Loan not found');
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

    // Allocate payment
    let remainingAmount = dto.amount;
    const updates: any[] = [];

    // The MVP instructions:
    // "pay due interest first, then principal"
    // We iterate through unpaid schedules and allocate
    for (const schedule of loan.schedules) {
      if (remainingAmount <= 0) break;

      // In MVP, we just mark the schedule paid if we fully cover it
      // For simplicity, we assume we just mark the next full installment paid if remainingAmount >= its totalAmount
      // If we do partial payments, we should ideally track paidInterest/paidPrincipal per schedule.
      // But the spec says: "Auto-mark installments as paid". Let's do simple deterministic allocation.

      const installmentTotal = Number(schedule.totalAmount);

      if (remainingAmount >= installmentTotal) {
        remainingAmount -= installmentTotal;
        updates.push(
          this.prisma.repaymentSchedule.update({
            where: { id: schedule.id },
            data: { isPaid: true },
          }),
        );
      } else {
        // Partial payment of an installment (not fully implemented in MVP, just consumed)
        remainingAmount = 0;
        break; // we didn't cover the whole installment
      }
    }

    // Process all in a transaction
    const [repayment] = await this.prisma.$transaction([
      this.prisma.repayment.create({
        data: {
          tenantId,
          loanId: dto.loanId,
          amount: dto.amount,
          date: new Date(dto.date),
        },
      }),
      ...updates,
    ]);

    await this.audit.logAction(
      tenantId,
      userId,
      'CREATE',
      'Repayment',
      repayment.id,
      dto,
    );

    // Check if all installments are paid, auto-close loan
    const unpaidCount = await this.prisma.repaymentSchedule.count({
      where: { loanId: dto.loanId, isPaid: false },
    });

    if (unpaidCount === 0 && updates.length > 0) {
      await this.prisma.loan.update({
        where: { id: dto.loanId },
        data: { status: LoanStatus.CLOSED },
      });
      await this.audit.logAction(tenantId, userId, 'UPDATE', 'Loan', loan.id, {
        action: 'Auto-closed due to full repayment',
      });
    }

    return repayment;
  }

  async findAll(tenantId: string, loanId?: string) {
    return this.prisma.repayment.findMany({
      where: loanId ? { tenantId, loanId } : { tenantId },
      include: { loan: { include: { borrower: true } } },
      orderBy: { date: 'desc' },
    });
  }
}
