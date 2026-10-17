import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { configuredPoolSize } from '../../prisma/pool-size';

export { configuredPoolSize };

/**
 * Prometheus metrics for the API (docs/lending/OPERATIONS.md, Monitoring).
 *
 * Every metric is an aggregate: no label ever carries a tenant, user, loan
 * or any other record id, so a scrape cannot reveal whose data is where.
 * Values that need a database query are refreshed by periodic jobs
 * (LendingMetricsCollector), never computed during a scrape.
 *
 * Each instance owns its registry rather than prom-client's global one, so
 * an application built twice in one process (the test suites) does not
 * register the same metric twice.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  // ── HTTP ────────────────────────────────────────────────────────────────
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency, by method, route pattern and status class.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });
  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests, by method, route pattern and status class.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  // ── End of day ──────────────────────────────────────────────────────────
  readonly eodRunDuration = new Histogram({
    name: 'lending_eod_run_duration_seconds',
    help: 'Duration of one end-of-day batch run (one tenant, one business date).',
    buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200],
    registers: [this.registry],
  });
  readonly eodLoanDuration = new Histogram({
    name: 'lending_eod_loan_duration_seconds',
    help: 'Time to process one loan in the end-of-day batch.',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  readonly eodLoansProcessed = new Counter({
    name: 'lending_eod_loans_processed_total',
    help: 'Loans processed successfully by end of day.',
    registers: [this.registry],
  });
  readonly eodLoansFailed = new Counter({
    name: 'lending_eod_loans_failed_total',
    help: 'Loans that failed in end of day (left for the next run).',
    registers: [this.registry],
  });
  readonly eodRuns = new Counter({
    name: 'lending_eod_runs_total',
    help: 'End-of-day batch runs, by outcome (success: no loan failed).',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });
  readonly eodLastRunProcessed = new Gauge({
    name: 'lending_eod_last_run_loans_processed',
    help: 'Loans processed in the most recent end-of-day run on this instance.',
    registers: [this.registry],
  });
  readonly eodLastRunFailed = new Gauge({
    name: 'lending_eod_last_run_loans_failed',
    help: 'Loans that failed in the most recent end-of-day run on this instance.',
    registers: [this.registry],
  });
  readonly eodLastRunFinished = new Gauge({
    name: 'lending_eod_last_run_finished_timestamp_seconds',
    help: 'When the most recent end-of-day run on this instance finished.',
    registers: [this.registry],
  });

  // ── Refreshed from the database by LendingMetricsCollector ──────────────
  readonly tenantsBehind = new Gauge({
    name: 'lending_eod_tenants_behind',
    help: 'Tenants with active loans whose end of day has not processed the calendar day before today.',
    registers: [this.registry],
  });
  readonly tenantsWithFailures = new Gauge({
    name: 'lending_eod_tenants_with_failures',
    help: 'Tenants whose last end of day left failed accounts.',
    registers: [this.registry],
  });
  readonly tenantsActive = new Gauge({
    name: 'lending_tenants_with_active_loans',
    help: 'Tenants with at least one active loan.',
    registers: [this.registry],
  });
  readonly closesPending = new Gauge({
    name: 'lending_month_end_closes_pending',
    help: 'Month-end closes prepared and waiting for a checker, by status.',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });
  readonly closesNotPrepared = new Gauge({
    name: 'lending_month_end_closes_not_prepared',
    help: 'Tenants with active loans whose previous month has no close prepared or approved.',
    registers: [this.registry],
  });
  readonly reconciliationBreaks = new Gauge({
    name: 'lending_reconciliation_breaks',
    help: 'Sub-ledger to ledger breaks found by the latest reconciliation of each tenant, summed.',
    registers: [this.registry],
  });
  readonly reconciliationTenantsWithBreaks = new Gauge({
    name: 'lending_reconciliation_tenants_with_breaks',
    help: 'Tenants whose latest reconciliation found at least one break.',
    registers: [this.registry],
  });
  readonly reconciliationOldest = new Gauge({
    name: 'lending_reconciliation_oldest_run_timestamp_seconds',
    help: 'The oldest of the tenants’ latest reconciliation runs (0 when a tenant with loans has none in the last 7 days).',
    registers: [this.registry],
  });
  readonly outboxBacklog = new Gauge({
    name: 'lending_outbox_backlog',
    help: 'Outbox messages not yet delivered, by status.',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });
  readonly outboxOldestAge = new Gauge({
    name: 'lending_outbox_oldest_pending_age_seconds',
    help: 'Age of the oldest pending outbox message.',
    registers: [this.registry],
  });
  readonly dbConnections = new Gauge({
    name: 'lending_db_connections',
    help: 'Connections the application role holds on its database (all instances), by state.',
    labelNames: ['state'] as const,
    registers: [this.registry],
  });
  readonly dbPoolSize = new Gauge({
    name: 'lending_db_pool_size',
    help: 'Connection pool size configured for this instance (connection_limit).',
    registers: [this.registry],
  });
  readonly collectorErrors = new Counter({
    name: 'lending_metrics_collector_errors_total',
    help: 'Periodic metric refreshes that failed.',
    labelNames: ['job'] as const,
    registers: [this.registry],
  });
  readonly collectorLastSuccess = new Gauge({
    name: 'lending_metrics_collector_last_success_timestamp_seconds',
    help: 'When a periodic metric refresh last succeeded.',
    labelNames: ['job'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.dbPoolSize.set(configuredPoolSize());
  }

  /** Record one HTTP request; `route` must be the pattern, never the raw path. */
  observeHttp(method: string, route: string, status: number, seconds: number) {
    const labels = {
      method,
      route,
      status: `${Math.floor(status / 100)}xx`,
    };
    this.httpDuration.observe(labels, seconds);
    this.httpRequests.inc(labels);
  }

  async render(extra = ''): Promise<string> {
    return (await this.registry.metrics()) + extra;
  }
}
