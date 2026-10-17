import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lending } from '@microloan/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';
import { BusinessDateService } from '../common/business-date.service';
import { LendingActor } from '../common/util';
import { ServicingService } from './servicing.service';

/** Arbitrary, fixed key for the cross-instance advisory lock. */
const EOD_LOCK_KEY = 7_264_190_311;

/** Permissions the end-of-day job acts with — exactly what runBatch enforces. */
export const EOD_SCOPES = ['servicing.batch.run', 'loan.read'];

export function eodActor(tenantId: string): LendingActor {
  return {
    id: 'system:end-of-day',
    type: 'SERVICE',
    tenantId,
    assurance: 'SERVICE_KEY',
    channel: 'SYSTEM',
    scopes: EOD_SCOPES,
  };
}

/**
 * The business days a tenant must be rolled through to reach `today`,
 * oldest first. Each day gets its own batch run, so accrual, penalties and
 * delinquency are computed as of every day rather than jumping to the end.
 */
export function daysToRun(current: string, today: string): string[] {
  const days: string[] = [];
  let d = current;
  while (lending.compareDates(d, today) < 0) {
    d = lending.addDays(d, 1);
    days.push(d);
  }
  return days;
}

/**
 * Runs the lending end-of-day automatically: for every tenant with lending
 * accounts, advance the business date one day at a time up to today (local
 * time) and run the batch after each step.
 *
 * Without this, accrual, penalties, delinquency, rate resets and restructure
 * monitoring only moved when someone pressed "run batch".
 *
 * - Schedule: LENDING_EOD_CRON (default 00:15) in LENDING_EOD_TZ
 *   (default Asia/Phnom_Penh). LENDING_EOD_DISABLED=true turns it off.
 * - One instance runs it: a Postgres advisory lock held for the run.
 * - Missed days (downtime) catch up day by day, up to LENDING_EOD_MAX_CATCHUP_DAYS
 *   (default 31) per run, so a long outage cannot start an unbounded run.
 */
@Injectable()
export class EodSchedulerService {
  private readonly logger = new Logger(EodSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {}

  @Cron(process.env.LENDING_EOD_CRON || '15 0 * * *', {
    name: 'lending-end-of-day',
    timeZone: process.env.LENDING_EOD_TZ || 'Asia/Phnom_Penh',
  })
  async scheduled(): Promise<void> {
    if (process.env.LENDING_EOD_DISABLED === 'true') return;
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.runAll();
    } catch (e) {
      this.logger.error(`End-of-day run failed: ${(e as Error).message}`);
    }
  }

  /** Run end-of-day for every tenant. Returns null when another instance holds the lock. */
  async runAll(today = BusinessDateService.calendarToday()) {
    const maxDays = Number(process.env.LENDING_EOD_MAX_CATCHUP_DAYS || 31);
    return runAsSystem('lending end-of-day', () =>
      this.prisma.$transaction(
        async (tx) => {
          // Transaction-scoped: released automatically however the run ends.
          const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${EOD_LOCK_KEY}::bigint) AS locked`;
          if (!locked) {
            this.logger.log('End-of-day already running on another instance');
            return null;
          }
          const tenants = await this.prisma.loanAccount.findMany({
            where: { status: 'ACTIVE' },
            distinct: ['tenantId'],
            select: { tenantId: true },
          });
          const results: Awaited<
            ReturnType<EodSchedulerService['runTenant']>
          >[] = [];
          for (const { tenantId } of tenants) {
            results.push(await this.runTenant(tenantId, today, maxDays));
          }
          return results;
        },
        // The lock is held for the whole run; the batches run in their own
        // transactions, so this one only keeps a connection open.
        { timeout: 6 * 60 * 60_000, maxWait: 30_000 },
      ),
    );
  }

  async runTenant(tenantId: string, today: string, maxDays = 31) {
    return runAsSystem(`lending end-of-day ${tenantId}`, async () => {
      const actor = eodActor(tenantId);
      const current = await this.businessDate.get(tenantId);
      const days = daysToRun(current, today).slice(0, maxDays);
      const runs: {
        businessDate: string;
        processed: number;
        failed: number;
      }[] = [];
      for (const day of days) {
        await this.businessDate.advance(tenantId, day, actor.id);
        const r = await this.servicing.runBatch(actor);
        runs.push({
          businessDate: day,
          processed: r.processed,
          failed: r.failed.length,
        });
        if (r.failed.length) {
          this.logger.warn(
            `EOD ${tenantId} ${day}: ${r.failed.length} account(s) failed — ${r.failed
              .slice(0, 3)
              .map((f) => `${f.id}: ${f.error}`)
              .join('; ')}`,
          );
        }
      }
      if (days.length) {
        this.logger.log(
          `EOD ${tenantId}: ran ${days.length} day(s) to ${days[days.length - 1]}`,
        );
      }
      return { tenantId, from: current, runs };
    });
  }
}
