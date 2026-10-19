import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BotService } from '../bot/bot.service';
import { SystemContext } from '../prisma/tenant-context';
import { JobClaimService } from '../prisma/job-claim.service';
import { formatCurrency, Currency as SharedCurrency } from '@microloan/shared';
import { LEGACY_TIME_ZONE } from '../loans/legacy-money';

@Injectable()
export class ReminderService {
    private readonly logger = new Logger(ReminderService.name);

    constructor(
        private prisma: PrismaService,
        private bot: BotService,
        private claims: JobClaimService,
    ) { }

    /**
     * Daily job (LEGACY_REMINDER_CRON, default 8:00 AM) to send reminders for
     * payments due tomorrow. Every API instance runs it; each tenant's batch
     * is claimed once per day (ScheduledJobClaim), so nobody is messaged twice.
     */
    @Cron(process.env.LEGACY_REMINDER_CRON || CronExpression.EVERY_DAY_AT_8AM, { timeZone: LEGACY_TIME_ZONE })
    @SystemContext('cron: scans installments across all tenants')
    async sendDailyReminders() {
        this.logger.log('[ReminderService] Starting daily payment reminders scan...');

        // 1. Get tomorrow's date
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const dayAfterTomorrow = new Date(tomorrow);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

        // 2. Find all unpaid installments due tomorrow
        const installments = await this.prisma.repaymentSchedule.findMany({
            where: {
                dueDate: {
                    gte: tomorrow,
                    lt: dayAfterTomorrow,
                },
                isPaid: false,
                loan: {
                    status: 'DISBURSED',
                },
            },
            include: {
                loan: {
                    include: {
                        borrower: true,
                        tenant: true,
                    },
                },
            },
        });

        this.logger.log(`[ReminderService] Found ${installments.length} installments due tomorrow.`);

        const runKey = new Date().toISOString().slice(0, 10);
        const claimed = new Map<string, boolean>();
        for (const item of installments) {
            const { loan } = item;
            const { borrower } = loan;
            if (!claimed.has(loan.tenantId))
                claimed.set(loan.tenantId, await this.claims.once(loan.tenantId, 'legacy.due-tomorrow-reminders', runKey));
            if (!claimed.get(loan.tenantId)) continue;

            // ── Sending to Borrower (if they have a Telegram Chat ID) ───────────────
            if (borrower.telegramChatId) {
                try {
                    const msg = `🔔 **Payment Reminder**\n\nDear ${borrower.firstName},\nYour installment of **${formatCurrency(Number(item.totalAmount), loan.currency as unknown as SharedCurrency)}** for Loan #${loan.id.slice(0, 8).toUpperCase()} is due tomorrow (${item.dueDate.toLocaleDateString()}).\n\nPlease ensure your payment is made on time to avoid penalties. Thank you!`;

                    await this.bot.sendDisbursementAlert(loan.tenantId, borrower.telegramChatId, msg);
                    this.logger.log(`[ReminderService] Reminder sent to borrower ${borrower.id} for loan ${loan.id}`);
                } catch (err) {
                    this.logger.error(`[ReminderService] Failed to send reminder to borrower ${borrower.id}`, err);
                }
            }

            // ── Optional: Sending to Tenant Staff could be added here ──────────────
        }

        this.logger.log('[ReminderService] Daily reminders scan complete.');
    }
}
