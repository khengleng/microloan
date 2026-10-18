import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lending } from '@microloan/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem, runAsTenant } from '../../prisma/tenant-context';
import { MetricsService } from '../../observability/metrics/metrics.service';
import { BusinessDateService } from '../common/business-date.service';
import { LendingActor, toLocalDate } from '../common/util';
import { LendingOperationsService } from '../accounting/operations.service';
import { ServicingService } from '../servicing/servicing.service';
import { operationalConfig } from '../../config/operational-config';

/** Arbitrary, fixed key for the cross-instance reconciliation lock. */
const RECONCILIATION_LOCK_KEY = 7_264_190_312;

export function reconciliationMonitorActor(tenantId: string): LendingActor {
  return {
    id: 'system:reconciliation-monitor',
    type: 'SERVICE',
    tenantId,
    assurance: 'SERVICE_KEY',
    channel: 'SYSTEM',
    scopes: ['accounting.read'],
  };
}

/**
 * Feeds the lending metrics (docs/lending/OPERATIONS.md, Monitoring).
 *
 * - End of day reports each run through a batch observer: duration, loans
 *   processed and failed.
 * - Every LENDING_METRICS_REFRESH_SECONDS (default 60) the gauges that need
 *   the database are refreshed with a handful of aggregate queries: tenants
 *   behind on end of day, month-end closes pending, the latest
 *   reconciliation result, outbox backlog and database connections. A scrape
 *   reads the last values and never queries.
 * - On LENDING_RECONCILIATION_CRON (default every six hours at :40) one
 *   instance reconciles every tenant with loans; each run is recorded in the
 *   audit trail, which is where the breaks gauge reads it from, so every
 *   instance reports the same figure and a restart loses nothing.
 *
 * Labels never carry a tenant id: tenants appear only as counts.
 */
@Injectable()
export class LendingMetricsCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LendingMetricsCollector.name);
  private timer: NodeJS.Timeout | null = null;
  private refreshing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly servicing: ServicingService,
    private readonly ops: LendingOperationsService,
  ) {
    const m = this.metrics;
    this.servicing.registerBatchObserver({
      loanProcessed: (_tenant, ms) => m.eodLoanDuration.observe(ms / 1000),
      batchFinished: (_tenant, _date, r) => {
        m.eodRunDuration.observe(r.ms / 1000);
        m.eodLoansProcessed.inc(r.processed);
        m.eodLoansFailed.inc(r.failed);
        m.eodRuns.inc({ outcome: r.failed ? 'failure' : 'success' });
        m.eodLastRunProcessed.set(r.processed);
        m.eodLastRunFailed.set(r.failed);
        m.eodLastRunFinished.set(Date.now() / 1000);
      },
    });
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.LENDING_METRICS_REFRESH_DISABLED === 'true') return;
    const seconds = operationalConfig().metricsRefreshSeconds;
    this.timer = setInterval(() => void this.refresh(), seconds * 1000);
    this.timer.unref();
    void this.refresh();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Refresh every database-backed gauge. Safe to call concurrently. */
  async refresh(today = BusinessDateService.calendarToday()) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await runAsSystem('lending metrics refresh', () => this.collect(today));
      this.metrics.collectorLastSuccess.set(
        { job: 'refresh' },
        Date.now() / 1000,
      );
    } catch (e) {
      this.metrics.collectorErrors.inc({ job: 'refresh' });
      this.logger.warn(`Metrics refresh failed: ${(e as Error).message}`);
    } finally {
      this.refreshing = false;
    }
  }

  private async collect(today: string) {
    const m = this.metrics;
    const p = this.prisma;
    // GROUP BY in the database (a Prisma `distinct` reads every row).
    const active = await p.loanAccount.groupBy({
      by: ['tenantId'],
      where: { status: 'ACTIVE' },
    });
    const tenantIds = active.map((a) => a.tenantId);
    m.tenantsActive.set(tenantIds.length);

    // End of day: a tenant is behind when the latest scheduled run (which
    // processes the calendar day it starts on) has not reached yesterday.
    const dates = await p.tenantBusinessDate.findMany({
      where: { tenantId: { in: tenantIds } },
      select: {
        tenantId: true,
        businessDate: true,
        lastBatchDate: true,
        lastBatchFailures: true,
      },
    });
    const byTenant = new Map(dates.map((d) => [d.tenantId, d]));
    const yesterday = lending.addDays(today, -1);
    let behind = 0;
    let withFailures = 0;
    let notPrepared = 0;
    for (const t of tenantIds) {
      const d = byTenant.get(t);
      const last = toLocalDate(d?.lastBatchDate ?? null);
      if (!last || lending.compareDates(last, yesterday) < 0) behind++;
      if ((d?.lastBatchFailures ?? 0) > 0) withFailures++;
    }
    m.tenantsBehind.set(behind);
    m.tenantsWithFailures.set(withFailures);

    // Month end: closes waiting for a checker, and tenants whose previous
    // month (by their business date) had postings but has no close yet.
    const pending = await p.accountingPeriod.groupBy({
      by: ['status'],
      where: { status: { in: ['PENDING', 'REOPEN_PENDING'] } },
      _count: { _all: true },
    });
    for (const status of ['PENDING', 'REOPEN_PENDING'])
      m.closesPending.set(
        { status },
        pending.find((x) => x.status === status)?._count._all ?? 0,
      );
    for (const t of tenantIds) {
      const bd = toLocalDate(byTenant.get(t)?.businessDate ?? null);
      if (!bd) continue;
      const monthStart = `${bd.slice(0, 7)}-01`;
      const prevEnd = lending.addDays(monthStart, -1);
      const [y, mo] = prevEnd.split('-').map(Number);
      const first = await p.lendingJournalEntry.findFirst({
        where: { tenantId: t },
        orderBy: { entryDate: 'asc' },
        select: { entryDate: true },
      });
      if (!first || toLocalDate(first.entryDate)! > prevEnd) continue;
      const row = await p.accountingPeriod.findFirst({
        where: { tenantId: t, year: y, month: mo },
        select: { status: true },
      });
      if (!row || row.status === 'OPEN') notPrepared++;
    }
    m.closesNotPrepared.set(notPrepared);

    // Reconciliation: the latest recorded run per tenant, looked for over the
    // last week only so the lookup stays a short index range scan; none in a
    // week counts as never (and trips the staleness alert).
    let breaks = 0;
    let tenantsWithBreaks = 0;
    let oldest = Number.POSITIVE_INFINITY;
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    for (const t of tenantIds) {
      const last = await p.auditEvent.findFirst({
        where: {
          tenantId: t,
          action: 'accounting.reconciliation',
          eventTime: { gte: weekAgo },
        },
        orderBy: { eventTime: 'desc' },
        select: { details: true, eventTime: true },
      });
      if (!last) {
        oldest = 0;
        continue;
      }
      const n = Number((last.details as { breaks?: number } | null)?.breaks);
      if (Number.isFinite(n) && n > 0) {
        breaks += n;
        tenantsWithBreaks++;
      }
      oldest = Math.min(oldest, last.eventTime.getTime() / 1000);
    }
    m.reconciliationBreaks.set(breaks);
    m.reconciliationTenantsWithBreaks.set(tenantsWithBreaks);
    m.reconciliationOldest.set(Number.isFinite(oldest) ? oldest : 0);

    // Outbox backlog.
    const outbox = await p.outboxMessage.groupBy({
      by: ['status'],
      where: { status: { in: ['PENDING', 'FAILED'] } },
      _count: { _all: true },
    });
    for (const status of ['PENDING', 'FAILED'])
      m.outboxBacklog.set(
        { status },
        outbox.find((x) => x.status === status)?._count._all ?? 0,
      );
    const oldestPending = await p.outboxMessage.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    m.outboxOldestAge.set(
      oldestPending
        ? Math.max(0, (Date.now() - oldestPending.createdAt.getTime()) / 1000)
        : 0,
    );

    // Database connections held by this application's role, all instances.
    const conns = await p.$queryRaw<{ state: string | null; n: bigint }[]>`
      SELECT state, count(*) AS n FROM pg_stat_activity
      WHERE datname = current_database() AND usename = current_user
      GROUP BY state`;
    for (const state of ['active', 'idle', 'idle in transaction'])
      m.dbConnections.set(
        { state },
        Number(conns.find((c) => c.state === state)?.n ?? 0),
      );
  }

  /** Reconcile every tenant with loans, on one instance at a time. */
  @Cron(process.env.LENDING_RECONCILIATION_CRON || '40 */6 * * *', {
    name: 'lending-reconciliation-monitor',
  })
  async scheduledReconciliation(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.LENDING_RECONCILIATION_JOB_DISABLED === 'true') return;
    await this.reconcileAll();
  }

  /** Returns null when another instance holds the lock. */
  async reconcileAll(): Promise<{ tenants: number; breaks: number } | null> {
    try {
      return await runAsSystem('lending reconciliation monitor', () =>
        this.prisma.$transaction(
          async (tx) => {
            const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
              SELECT pg_try_advisory_xact_lock(${RECONCILIATION_LOCK_KEY}::bigint) AS locked`;
            if (!locked) return null;
            const tenants = await this.prisma.loanAccount.groupBy({
              by: ['tenantId'],
              where: { status: { not: 'BOOKED' } },
            });
            let breaks = 0;
            for (const { tenantId } of tenants) {
              const r = await runAsTenant(tenantId, () =>
                this.ops.reconciliation(reconciliationMonitorActor(tenantId)),
              );
              breaks += r.breaks.length;
            }
            this.metrics.collectorLastSuccess.set(
              { job: 'reconciliation' },
              Date.now() / 1000,
            );
            return { tenants: tenants.length, breaks };
          },
          { timeout: 6 * 60 * 60_000, maxWait: 30_000 },
        ),
      );
    } catch (e) {
      this.metrics.collectorErrors.inc({ job: 'reconciliation' });
      this.logger.error(
        `Reconciliation monitor failed: ${(e as Error).message}`,
      );
      return null;
    } finally {
      await this.refresh();
    }
  }
}
