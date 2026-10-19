import { Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { formatCurrency, Currency as SharedCurrency } from '@microloan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BotService } from '../bot/bot.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemContext, runAsTenant } from '../prisma/tenant-context';
import { JobClaimService } from '../prisma/job-claim.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { operationalConfig } from '../config/operational-config';
import { LegacyLoanGate } from '../loans/legacy-loan-gate';
import {
  LEGACY_TIME_ZONE,
  ZERO,
  calendarDate,
  cents,
  daysBetween,
  dec,
  localDate,
  localMidnight,
  maxDec,
  minDec,
} from '../loans/legacy-money';

const money = (amount: unknown, currency: string) =>
  formatCurrency(Number(amount), currency as unknown as SharedCurrency);

/**
 * The original loan book's daily jobs: late penalties and payment reminders.
 *
 * Every API instance runs these crons. Each penalty is applied with a
 * conditional update on the instalment (not yet penalised today, penalty
 * unchanged since it was read), so two instances cannot both charge it; each
 * tenant's reminders are claimed once per day in ScheduledJobClaim, so a
 * borrower is never messaged twice.
 *
 * D-102: the jobs run in the tenant's zone (LENDING_EOD_TZ, Asia/Phnom_Penh);
 * an instalment is late from the calendar day after its due date; only
 * instalments with principal or interest still unpaid are charged (never a
 * penalty on an unpaid penalty); one instalment's penalty stops at
 * `legacyServicing.penaltyCapRate` × its principal + interest; and nothing is
 * charged for a tenant whose legacy book is read-only (D-097).
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
    @Optional() private legacyGate?: LegacyLoanGate,
  ) {}

  @Cron(process.env.LEGACY_PENALTY_CRON || CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    timeZone: LEGACY_TIME_ZONE,
  })
  @SystemContext('cron: applies penalties across all tenants')
  async applyLatePenalties(now: Date = new Date()) {
    this.logger.log('Starting daily penalty and late fee calculation...');

    // Today in the tenant's zone. Legacy due dates are date-only values
    // stored at UTC midnight, so "due before today" compares calendar dates.
    const today = localDate(now);
    const dueBefore = new Date(`${today}T00:00:00.000Z`);
    // A penalty applied since local midnight was today's.
    const todayStart = localMidnight(today);
    const notPenalisedToday = [
      { penaltyLastAppliedAt: null },
      { penaltyLastAppliedAt: { lt: todayStart } },
    ];

    const overdueSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        isPaid: false,
        dueDate: { lt: dueBefore },
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

    // Per-run memo of each tenant's gate and settings: read once per tenant
    // for this run only, never kept between runs.
    const tenantRules = new Map<
      string,
      { frozen: boolean; defaultAfter: number; capRate: string }
    >();
    let count = 0;
    for (const schedule of overdueSchedules) {
      if (schedule.loan.status === 'CLOSED') continue;
      const tenantId = schedule.loan.tenantId;
      if (!tenantRules.has(tenantId)) {
        const s = (await this.settings.get(tenantId)).legacyServicing;
        tenantRules.set(tenantId, {
          frozen: (await this.legacyGate?.isFrozen(tenantId)) ?? false,
          defaultAfter: s.defaultAfterDaysOverdue,
          capRate: s.penaltyCapRate,
        });
      }
      const rules = tenantRules.get(tenantId)!;
      if (rules.frozen) continue;

      // Penalty on an instalment whose principal and interest are paid would
      // be a penalty on a penalty.
      const unpaidPrincipalAndInterest = maxDec(
        ZERO,
        dec(schedule.principalAmount).minus(dec(schedule.paidPrincipal)),
      ).plus(
        maxDec(ZERO, dec(schedule.interestAmount).minus(dec(schedule.paidInterest))),
      );
      if (unpaidPrincipalAndInterest.lte(0)) continue;

      // Fix 5: penalty from the product override, else the tenant's own
      // rate (Tenant.penaltyRatePerDay is required, with a column default),
      // up to the cap on this instalment.
      const rate = dec(
        schedule.loan.product?.penaltyRatePerDay ??
          schedule.loan.tenant.penaltyRatePerDay,
      );
      const cap = cents(
        dec(schedule.principalAmount)
          .plus(dec(schedule.interestAmount))
          .times(dec(rules.capRate)),
      );
      const charge = cents(
        minDec(rate, maxDec(ZERO, cap.minus(dec(schedule.penaltyAmount)))),
      );
      if (charge.lte(0)) continue;

      // The list is read across tenants; each loan's writes and alerts
      // run inside its own tenant's wall.
      await runAsTenant(tenantId, async () => {
        // Claim the instalment for today and charge it in one statement:
        // a second instance (or a re-run) finds it already penalised, and a
        // penalty changed since it was read is not charged on a stale cap.
        const charged = await this.prisma.repaymentSchedule.updateMany({
          where: {
            id: schedule.id,
            loanId: schedule.loan.id,
            isPaid: false,
            penaltyAmount: schedule.penaltyAmount,
            OR: notPenalisedToday,
          },
          data: {
            penaltyAmount: { increment: charge.toFixed(2) },
            totalAmount: { increment: charge.toFixed(2) },
            penaltyLastAppliedAt: now, // Mark as processed for today
          },
        });
        if (charged.count !== 1) return;

        // Mark the loan DEFAULTED once overdue longer than the lender's
        // threshold (lending settings legacyServicing.defaultAfterDaysOverdue, default 30),
        // counted in calendar days to today in the tenant's zone.
        const daysOverdue = daysBetween(calendarDate(schedule.dueDate), today);
        if (
          daysOverdue > rules.defaultAfter &&
          schedule.loan.status !== 'DEFAULTED'
        ) {
          await this.prisma.loan.updateMany({
            where: { id: schedule.loan.id, status: 'DISBURSED' },
            data: { status: 'DEFAULTED' },
          });
        }

        const penaltyNow = dec(schedule.penaltyAmount).plus(charge);
        const totalNow = dec(schedule.totalAmount).plus(charge);
        const currency = schedule.loan.currency;
        // Send Alert via Telegram Bot
        const borrower = schedule.loan.borrower;
        if (borrower?.telegramChatId) {
          try {
            const msg = `⚠️ **OVERDUE PAYMENT ALERT** ⚠️\n\nDear ${borrower.firstName},\nYour payment of **${money(totalNow, currency)}** was due on ${calendarDate(schedule.dueDate)}.\nAccumulated Penalty: **${money(penaltyNow, currency)}**.\n\nPlease pay immediately to avoid further penalties.`;
            await this.botService.sendDisbursementAlert(
              tenantId,
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
        const dueDateStr = calendarDate(schedule.dueDate);
        if ((borrower as any)?.email) {
          void this.notifications.sendEmail(
            (borrower as any).email,
            'Overdue payment reminder',
            `<p>Dear ${borrower.firstName},</p><p>Your payment of ${money(totalNow, currency)} was due on ${dueDateStr}. Please pay to avoid further penalties.</p>`,
          );
        }
        if (borrower?.phone) {
          void this.notifications.sendSms(
            borrower.phone,
            `Overdue: your payment of ${money(totalNow, currency)} (due ${dueDateStr}) is outstanding. Please pay soon.`,
          );
        }
        count++;
      });
    }

    this.logger.log(
      `Completed applying penalties. Affected schedules: ${count}`,
    );
    return { charged: count };
  }


  @Cron(
    process.env.LEGACY_UPCOMING_REMINDER_CRON ||
      CronExpression.EVERY_DAY_AT_9AM,
    { timeZone: LEGACY_TIME_ZONE },
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
