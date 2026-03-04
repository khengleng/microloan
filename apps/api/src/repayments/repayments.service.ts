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
  ) { }

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
    const updates: any[] = [];

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

        updates.push(
          this.prisma.repaymentSchedule.update({
            where: { id: schedule.id },
            data: {
              paidInterest: newPaidInterest,
              paidPrincipal: newPaidPrincipal,
              isPaid,
            },
          }),
        );
      }
    }

    // Process all in a transaction
    const [repayment] = await this.prisma.$transaction([
      this.prisma.repayment.create({
        data: {
          tenantId,
          loanId: dto.loanId,
          amount: dto.amount,
          interestPaid: totalInterestPaid,
          principalPaid: totalPrincipalPaid,
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

    if (unpaidCount === 0 && (updates.length > 0 || loan.schedules.length === 0)) {
      await this.prisma.loan.update({
        where: { id: dto.loanId, tenantId },
        data: { status: LoanStatus.CLOSED },
      });
      await this.audit.logAction(tenantId, userId, 'UPDATE', 'Loan', loan.id, {
        action: 'Auto-closed due to full repayment',
      });
    }

    return repayment;
  }

  async findAll(
    tenantId: string,
    loanId?: string,
    startDate?: string,
    endDate?: string,
    page = 1,
    limit = 50,
  ) {
    const where: any = { tenantId };
    if (loanId) where.loanId = loanId;
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
