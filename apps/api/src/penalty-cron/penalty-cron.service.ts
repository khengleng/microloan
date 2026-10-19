import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { formatCurrency, Currency as SharedCurrency } from '@microloan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BotService } from '../bot/bot.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemContext, runAsTenant } from '../prisma/tenant-context';
import { JobClaimService } from '../prisma/job-claim.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { operationalConfig } from '../config/operational-config';

const money = (amount: unknown, currency: string) =>
  formatCurrency(Number(amount), currency as unknown as SharedCurrency);

/**
 * The original loan book's daily jobs: late penalties and payment reminders.
 *
 * Every API instance runs these crons. Each penalty is applied with a
 * conditional update on the instalment (not yet penalised today), so two
 * instances cannot both charge it; each tenant's reminders are claimed once
 * per day in ScheduledJobClaim, so a borrower is never messaged twice.
 */
@Injectable()
export class PenaltyCronService {
  private readonly logger = new Logger(PenaltyCronService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    @Inject(forwardRef(() => BotService))
    private botService: BotService,
    private claims: JobClaimService,
    private settings: TenantSettingsService,
  ) {}

  @Cron(process.env.LEGACY_PENALTY_CRON || CronExpression.EVERY_DAY_AT_MIDNIGHT)
  @SystemContext('cron: applies penalties across all tenants')
  async applyLatePenalties() {
    this.logger.log('Starting daily penalty and late fee calculation...');
    const now = new Date();

    // Build start-of-today boundary for idempotency check
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const notPenalisedToday = [
      { penaltyLastAppliedAt: null },
      { penaltyLastAppliedAt: { lt: todayStart } },
    ];

    const overdueSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        isPaid: false,
        dueDate: { lt: now },
        // Penalties accrue only on money actually lent and still owed —
        // not on PENDING / APPROVED / REJECTED / WRITTEN_OFF / CLOSED loans.
        loan: { status: { in: ['DISBURSED', 'DEFAULTED'] } },
        // Only grab schedules that have NOT yet been penalized today
        OR: notPenalisedToday,
      },
      include: {
        loan: {
          include: {
            borrower: true,
            // Fix 5: load product for per-product penalty override
            product: { select: { penaltyRatePerDay: true } },
            // Fix 5: load tenant for platform-wide default
            tenant: { select: { penaltyRatePerDay: true } },
          },
        },
      },
    });

    // Per-run memo of each tenant's threshold: read once per tenant for
    // this run only, never kept between runs.
    const defaultAfter = new Map<string, number>();
    let count = 0;
    for (const schedule of overdueSchedules) {
      if (schedule.loan.status === 'CLOSED') continue;
      // The list is read across tenants; each loan's writes and alerts
      // run inside its own tenant's wall.
      await runAsTenant(schedule.loan.tenantId, async () => {
        // Fix 5: penalty from the product override, else the tenant's own
        // rate (Tenant.penaltyRatePerDay is required, with a column default).
        const penaltyAmount = Number(
          schedule.loan.product?.penaltyRatePerDay ??
            schedule.loan.tenant.penaltyRatePerDay,
        );

        // Claim the instalment for today and charge it in one statement:
        // a second instance (or a re-run) finds it already penalised.
        const charged = await this.prisma.repaymentSchedule.updateMany({
          where: {
            id: schedule.id,
            loanId: schedule.loan.id,
            OR: notPenalisedToday,
          },
          data: {
            penaltyAmount: { increment: penaltyAmount },
            totalAmount: { increment: penaltyAmount },
            penaltyLastAppliedAt: now, // Mark as processed for today
          },
        });
        if (charged.count !== 1) return;

        // Mark the loan DEFAULTED once overdue longer than the lender's
        // threshold (lending settings legacyServicing.defaultAfterDaysOverdue, default 30).
        const tenantId = schedule.loan.tenantId;
        if (!defaultAfter.has(tenantId))
          defaultAfter.set(
            tenantId,
            (await this.settings.get(tenantId)).legacyServicing
              .defaultAfterDaysOverdue,
          );
        const daysOverdue = Math.floor(
          (now.getTime() - schedule.dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (
          daysOverdue > defaultAfter.get(tenantId)! &&
          schedule.loan.status !== 'DEFAULTED'
        ) {
          await this.prisma.loan.update({
            where: { id: schedule.loan.id },
            data: { status: 'DEFAULTED' },
          });
        }

        const currency = schedule.loan.currency;
        // Send Alert via Telegram Bot
        const borrower = schedule.loan.borrower;
        if (borrower?.telegramChatId) {
          try {
            const msg = `⚠️ **OVERDUE PAYMENT ALERT** ⚠️\n\nDear ${borrower.firstName},\nYour payment of **${money(schedule.totalAmount, currency)}** was due on ${new Date(schedule.dueDate).toLocaleDateString()}.\nAccumulated Penalty: **${money(schedule.penaltyAmount, currency)}**.\n\nPlease pay immediately to avoid further penalties.`;
            await this.botService.sendDisbursementAlert(
              schedule.loan.tenantId,
              borrower.telegramChatId,
              msg,
            );
          } catch (e) {
            this.logger.error(
              `Failed to alert borrower ${borrower.id} of late payment`,
              e,
            );
          }
        }
        // Best-effort email/SMS (no-op unless a provider is configured).
        const dueDateStr = new Date(schedule.dueDate).toLocaleDateString();
        if ((borrower as any)?.email) {
          void this.notifications.sendEmail(
            (borrower as any).email,
            'Overdue payment reminder',
            `<p>Dear ${borrower.firstName},</p><p>Your payment of ${money(schedule.totalAmount, currency)} was due on ${dueDateStr}. Please pay to avoid further penalties.</p>`,
          );
        }
        if (borrower?.phone) {
          void this.notifications.sendSms(
            borrower.phone,
            `Overdue: your payment of ${money(schedule.totalAmount, currency)} (due ${dueDateStr}) is outstanding. Please pay soon.`,
          );
        }
        count++;
      });
    }

    this.logger.log(
      `Completed applying penalties. Affected schedules: ${count}`,
    );
  }

  @Cron(
    process.env.LEGACY_UPCOMING_REMINDER_CRON ||
      CronExpression.EVERY_DAY_AT_9AM,
  )
  @SystemContext('cron: scans upcoming dues across all tenants')
  async sendUpcomingReminders() {
    this.logger.log('Checking for upcoming repayments (next 2 days)...');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const next2Days = new Date();
    next2Days.setDate(next2Days.getDate() + 2);
    const runKey = new Date().toISOString().slice(0, 10);

    const upcomingSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        isPaid: false,
        dueDate: { gte: new Date(), lte: next2Days },
      },
      include: { loan: { include: { borrower: true } } },
    });

    const platformName = operationalConfig().platformName;
    const claimed = new Map<string, boolean>();
    for (const schedule of upcomingSchedules) {
      const tenantId = schedule.loan.tenantId;
      // One instance sends a tenant's reminders for the day.
      if (!claimed.has(tenantId))
        claimed.set(
          tenantId,
          await this.claims.once(tenantId, 'legacy.upcoming-reminders', runKey),
        );
      if (!claimed.get(tenantId)) continue;
      const borrower = schedule.loan.borrower;
      const currency = schedule.loan.currency;
      const dueDateStr = new Date(schedule.dueDate).toLocaleDateString();
      if (borrower.telegramChatId) {
        try {
          const msg = `📅 **UPCOMING PAYMENT REMINDER** 📅\n\nHi ${borrower.firstName},\nYour next payment of **${money(schedule.totalAmount, currency)}** is due on **${dueDateStr}**.\n\nThank you for choosing ${platformName}!`;
          await this.botService.sendDisbursementAlert(
            tenantId,
            borrower.telegramChatId,
            msg,
          );
        } catch (e) {
          this.logger.error(
            `Failed to send upcoming reminder to ${borrower.id}`,
            e,
          );
        }
      }
      if ((borrower as any)?.email) {
        void this.notifications.sendEmail(
          (borrower as any).email,
          'Upcoming payment reminder',
          `<p>Hi ${borrower.firstName},</p><p>Your next payment of ${money(schedule.totalAmount, currency)} is due on ${dueDateStr}.</p>`,
        );
      }
      if (borrower.phone) {
        void this.notifications.sendSms(
          borrower.phone,
          `Reminder: your payment of ${money(schedule.totalAmount, currency)} is due on ${dueDateStr}.`,
        );
      }
    }
  }
}
