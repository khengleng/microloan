import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PenaltyCronService {
    private readonly logger = new Logger(PenaltyCronService.name);

    constructor(private prisma: PrismaService) { }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async applyLatePenalties() {
        this.logger.log('Starting daily penalty and late fee calculation...');
        const now = new Date();

        const overdueSchedules = await this.prisma.repaymentSchedule.findMany({
            where: {
                isPaid: false,
                dueDate: { lt: now },
            },
            include: { loan: true },
        });

        let count = 0;
        for (const schedule of overdueSchedules) {
            if (schedule.loan.status === 'CLOSED') continue;

            // Ensure we don't apply penalties more than once, or define specific logic.
            // E.g., apply a flat late fee of $10, or 1% of the outstanding principal.
            // This is a simple flat rate penalty for demonstration.
            const penaltyAmount = 10.0;

            await this.prisma.repaymentSchedule.update({
                where: { id: schedule.id },
                data: {
                    penaltyAmount: { increment: penaltyAmount },
                    totalAmount: { increment: penaltyAmount },
                },
            });

            // Update the loan status to DEFAULTED if overdue by more than 30 days
            const daysOverdue = Math.floor((now.getTime() - schedule.dueDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysOverdue > 30 && schedule.loan.status !== 'DEFAULTED') {
                await this.prisma.loan.update({
                    where: { id: schedule.loan.id },
                    data: { status: 'DEFAULTED' },
                });
            }

            count++;
        }

        this.logger.log(`Completed applying penalties. Affected schedules: ${count}`);
    }
}
