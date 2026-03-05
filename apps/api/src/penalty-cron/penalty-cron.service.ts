import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BotService } from '../bot/bot.service';

@Injectable()
export class PenaltyCronService {
    private readonly logger = new Logger(PenaltyCronService.name);

    constructor(
        private prisma: PrismaService,
        @Inject(forwardRef(() => BotService))
        private botService: BotService
    ) { }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async applyLatePenalties() {
        this.logger.log('Starting daily penalty and late fee calculation...');
        const now = new Date();

        // Build start-of-today boundary for idempotency check
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        const overdueSchedules = await this.prisma.repaymentSchedule.findMany({
            where: {
                isPaid: false,
                dueDate: { lt: now },
                // Only grab schedules that have NOT yet been penalized today
                OR: [
                    { penaltyLastAppliedAt: null },
                    { penaltyLastAppliedAt: { lt: todayStart } },
                ],
            },
            include: {
                loan: {
                    include: {
                        borrower: true,
                        // Fix 5: load product for per-product penalty override
                        product: { select: { penaltyRatePerDay: true } },
                        // Fix 5: load tenant for platform-wide default
                        tenant: { select: { penaltyRatePerDay: true } },
                    }
                }
            },
        });

        let count = 0;
        for (const schedule of overdueSchedules) {
            if (schedule.loan.status === 'CLOSED') continue;

            // Fix 5: resolve penalty rate from product override → tenant default → hard fallback
            const penaltyAmount = Number(
                schedule.loan.product?.penaltyRatePerDay
                ?? schedule.loan.tenant?.penaltyRatePerDay
                ?? 10.0,
            );

            await this.prisma.repaymentSchedule.update({
                where: { id: schedule.id },
                data: {
                    penaltyAmount: { increment: penaltyAmount },
                    totalAmount: { increment: penaltyAmount },
                    penaltyLastAppliedAt: now, // Mark as processed for today
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

            // Send Alert via Telegram Bot
            if (schedule.loan.borrower?.telegramChatId) {
                try {
                    const msg = `⚠️ **OVERDUE PAYMENT ALERT** ⚠️\n\nDear ${schedule.loan.borrower.firstName},\nYour payment of **$${schedule.totalAmount}** was due on ${new Date(schedule.dueDate).toLocaleDateString()}.\nAccumulated Penalty: **$${schedule.penaltyAmount}**.\n\nPlease pay immediately to avoid further penalties.`;
                    await this.botService.sendDisbursementAlert(schedule.loan.tenantId, schedule.loan.borrower.telegramChatId, msg);
                } catch (e) {
                    this.logger.error(`Failed to alert borrower ${schedule.loan.borrower.id} of late payment`, e);
                }
            }

            count++;
        }

        this.logger.log(`Completed applying penalties. Affected schedules: ${count}`);
    }

    @Cron(CronExpression.EVERY_DAY_AT_9AM)
    async sendUpcomingReminders() {
        this.logger.log('Checking for upcoming repayments (next 2 days)...');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const next2Days = new Date();
        next2Days.setDate(next2Days.getDate() + 2);

        const upcomingSchedules = await this.prisma.repaymentSchedule.findMany({
            where: {
                isPaid: false,
                dueDate: { gte: new Date(), lte: next2Days }
            },
            include: { loan: { include: { borrower: true } } }
        });

        for (const schedule of upcomingSchedules) {
            const borrower = schedule.loan.borrower;
            if (borrower.telegramChatId) {
                try {
                    const msg = `📅 **UPCOMING PAYMENT REMINDER** 📅\n\nHi ${borrower.firstName},\nYour next payment of **$${schedule.totalAmount}** is due on **${new Date(schedule.dueDate).toLocaleDateString()}**.\n\nThank you for choosing Magic Money!`;
                    await this.botService.sendDisbursementAlert(schedule.loan.tenantId, borrower.telegramChatId, msg);
                } catch (e) {
                    this.logger.error(`Failed to send upcoming reminder to ${borrower.id}`, e);
                }
            }
        }
    }
}
