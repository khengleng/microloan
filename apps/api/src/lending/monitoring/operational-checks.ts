import { lending } from '@microloan/shared';

/**
 * The operational health checks' decisions (DECISIONS D-150), as pure
 * functions of what the monitor read: each returns the alerts that should be
 * open now, keyed by a stable key, and nothing else. The monitor
 * (OperationalAlertService) compares them with the alerts already open,
 * opens, keeps or resolves rows, and decides who is e-mailed.
 */

export type AlertSeverity = 'CRITICAL' | 'WARNING';

export interface AlertFinding {
  /** Stable for the condition: the same problem keeps the same key while it lasts. */
  key: string;
  severity: AlertSeverity;
  /** One line, for the e-mail subject and the screens. */
  summary: string;
  details: Record<string, unknown>;
}

/** Every key a check can raise. */
export const ALERT_KEYS = {
  eodStale: 'eod.stale',
  eodFailures: 'eod.failures',
  monthEnd: 'month_end.overdue',
  outbox: 'outbox.backlog',
  webhooks: 'webhooks.backlog',
  reconciliation: 'reconciliation.breaks',
  jobs: 'jobs.failed',
  databaseUnreachable: 'database.unreachable',
  databaseConnections: 'database.connections',
} as const;

/**
 * Audit actions written with outcome FAILURE by a system actor that are not
 * a failed job: reconciliation breaks have a check of their own, and a
 * declined auto-debit is the customer's payment outcome.
 */
export const NOT_JOB_FAILURES: readonly string[] = [
  'accounting.reconciliation',
  'payment.auto_debit.attempt',
];

/**
 * End of day: the last run (else the business date) lags today in the
 * tenant's time zone by more than `maxLagDays`, or the last run left
 * accounts unprocessed.
 *
 * The scheduled run starts just after midnight and processes up to today, so
 * on a healthy day the lag is 0 — and 1 only in the minutes before it runs.
 */
export function checkEndOfDay(input: {
  today: string;
  businessDate: string | null;
  lastBatchDate: string | null;
  lastBatchFailures: number;
  maxLagDays: number;
}): AlertFinding[] {
  const out: AlertFinding[] = [];
  const ref = input.lastBatchDate ?? input.businessDate;
  const lag = ref ? lending.daysBetween(ref, input.today) : null;
  if (lag === null || lag > input.maxLagDays)
    out.push({
      key: ALERT_KEYS.eodStale,
      severity: 'CRITICAL',
      summary:
        lag === null
          ? 'End of day has never run'
          : `End of day is ${lag} day(s) behind (last run ${ref}, today ${input.today})`,
      details: {
        today: input.today,
        lastBatchDate: input.lastBatchDate,
        businessDate: input.businessDate,
        lagDays: lag,
        allowedLagDays: input.maxLagDays,
      },
    });
  if (input.lastBatchFailures > 0)
    out.push({
      key: ALERT_KEYS.eodFailures,
      severity: 'WARNING',
      summary: `End of day for ${input.lastBatchDate ?? 'the last business date'} left ${input.lastBatchFailures} account(s) unprocessed`,
      details: {
        lastBatchDate: input.lastBatchDate,
        failedAccounts: input.lastBatchFailures,
      },
    });
  return out;
}

/** "2026-09" for a date in September 2026. */
const monthOf = (date: string) => date.slice(0, 7);
const firstOf = (month: string) => `${month}-01`;
const nextMonth = (month: string) =>
  monthOf(lending.addMonths(firstOf(month), 1));

/**
 * Month end: every month from the tenant's first posting up to last month
 * that is not closed although `graceDays` of the following month have
 * passed. One alert lists them all, so it stays open until the oldest is
 * closed and does not resolve merely because the calendar moved on.
 */
export function checkMonthEnd(input: {
  today: string;
  firstPostingDate: string | null;
  /** Months closed (or closed with a reopen pending), as "YYYY-MM". */
  closedMonths: readonly string[];
  graceDays: number;
}): AlertFinding[] {
  if (!input.firstPostingDate) return [];
  const closed = new Set(input.closedMonths);
  const current = monthOf(input.today);
  const overdue: string[] = [];
  for (let m = monthOf(input.firstPostingDate); m < current; m = nextMonth(m)) {
    if (closed.has(m)) continue;
    const deadline = lending.addDays(firstOf(nextMonth(m)), input.graceDays);
    if (lending.compareDates(input.today, deadline) >= 0) overdue.push(m);
  }
  if (!overdue.length) return [];
  return [
    {
      key: ALERT_KEYS.monthEnd,
      severity: 'WARNING',
      summary:
        overdue.length === 1
          ? `Month end ${overdue[0]} is not closed (${input.graceDays} days into the next month)`
          : `${overdue.length} month ends are not closed, the oldest ${overdue[0]}`,
      details: { months: overdue, graceDays: input.graceDays },
    },
  ];
}

/** Outbox or webhook deliveries: the oldest pending message is older than allowed. */
export function checkBacklog(input: {
  kind: 'outbox' | 'webhooks';
  now: Date;
  oldestPendingAt: Date | null;
  pending: number;
  maxAgeMinutes: number;
}): AlertFinding[] {
  if (!input.oldestPendingAt) return [];
  const ageMinutes = Math.floor(
    (input.now.getTime() - input.oldestPendingAt.getTime()) / 60_000,
  );
  if (ageMinutes <= input.maxAgeMinutes) return [];
  const what =
    input.kind === 'outbox' ? 'Outbox messages' : 'Webhook deliveries';
  return [
    {
      key: input.kind === 'outbox' ? ALERT_KEYS.outbox : ALERT_KEYS.webhooks,
      severity: 'WARNING',
      summary: `${what} are backed up: ${input.pending} pending, the oldest ${ageMinutes} minutes old`,
      details: {
        pending: input.pending,
        oldestPendingAt: input.oldestPendingAt.toISOString(),
        oldestAgeMinutes: ageMinutes,
        allowedAgeMinutes: input.maxAgeMinutes,
      },
    },
  ];
}

/** Reconciliation: the latest run found differences between the sub-ledgers and the ledger. */
export function checkReconciliation(input: {
  lastRun: { at: Date; breaks: number } | null;
}): AlertFinding[] {
  const r = input.lastRun;
  if (!r || !(r.breaks > 0)) return [];
  return [
    {
      key: ALERT_KEYS.reconciliation,
      severity: 'CRITICAL',
      summary: `Reconciliation found ${r.breaks} break(s) between the sub-ledgers and the ledger`,
      details: { breaks: r.breaks, checkedAt: r.at.toISOString() },
    },
  ];
}

/** Scheduled jobs that recorded a failure in the look-back window. */
export function checkFailedJobs(input: {
  failures: readonly { action: string; at: Date }[];
  lookbackHours: number;
}): AlertFinding[] {
  const failures = input.failures.filter(
    (f) => !NOT_JOB_FAILURES.includes(f.action),
  );
  if (!failures.length) return [];
  const byAction: Record<string, number> = {};
  for (const f of failures) byAction[f.action] = (byAction[f.action] ?? 0) + 1;
  const latest = failures.reduce(
    (a, f) => (f.at > a ? f.at : a),
    failures[0].at,
  );
  return [
    {
      key: ALERT_KEYS.jobs,
      // End of day failing for the whole tenant stops accrual and arrears.
      severity: byAction['servicing.eod.run'] ? 'CRITICAL' : 'WARNING',
      summary: `${failures.length} scheduled job failure(s) in the last ${input.lookbackHours} h: ${Object.entries(
        byAction,
      )
        .map(([a, n]) => `${a} × ${n}`)
        .join(', ')}`,
      details: {
        byAction,
        latestAt: latest.toISOString(),
        lookbackHours: input.lookbackHours,
      },
    },
  ];
}

/**
 * The database (platform-wide): the readiness probe's ping (GET
 * /v1/health/ready) failed, or the connections in use reach `maxPct` of the
 * server's max_connections.
 */
export function checkDatabase(input: {
  reachable: boolean;
  connections: number | null;
  maxConnections: number | null;
  maxPct: number;
}): AlertFinding[] {
  if (!input.reachable)
    return [
      {
        key: ALERT_KEYS.databaseUnreachable,
        severity: 'CRITICAL',
        summary: 'The database did not answer the readiness check in time',
        details: {},
      },
    ];
  const { connections: n, maxConnections: max } = input;
  if (n === null || !max) return [];
  const pct = Math.round((n / max) * 100);
  if (pct < input.maxPct) return [];
  return [
    {
      key: ALERT_KEYS.databaseConnections,
      severity: 'WARNING',
      summary: `Database connections at ${pct}% of the server's limit (${n} of ${max})`,
      details: {
        connections: n,
        maxConnections: max,
        pct,
        allowedPct: input.maxPct,
      },
    },
  ];
}

export interface OpenAlertState {
  id: string;
  key: string;
  lastNotifiedAt: Date | null;
}

export interface AlertPlan {
  /** Findings with no open alert: open one and send "opened". */
  open: AlertFinding[];
  /** Open alerts still found: refresh them; `remind` when a reminder is due. */
  keep: { alert: OpenAlertState; finding: AlertFinding; remind: boolean }[];
  /** Open alerts no longer found: resolve and send "resolved". */
  resolve: OpenAlertState[];
}

/**
 * What to do with one scope's (a tenant's, or the platform's) alerts, given
 * what is open and what the checks found now. A reminder is due when the
 * last e-mail went out at least `reminderMs` ago.
 */
export function planAlerts(
  open: readonly OpenAlertState[],
  findings: readonly AlertFinding[],
  now: Date,
  reminderMs: number,
): AlertPlan {
  const byKey = new Map(open.map((a) => [a.key, a]));
  const found = new Map(findings.map((f) => [f.key, f]));
  const plan: AlertPlan = { open: [], keep: [], resolve: [] };
  for (const f of found.values()) {
    const a = byKey.get(f.key);
    if (!a) plan.open.push(f);
    else
      plan.keep.push({
        alert: a,
        finding: f,
        remind:
          !a.lastNotifiedAt ||
          now.getTime() - a.lastNotifiedAt.getTime() >= reminderMs,
      });
  }
  for (const a of open) if (!found.has(a.key)) plan.resolve.push(a);
  return plan;
}

/** Operator addresses plus the tenant's own, without repeats. */
export function alertRecipients(
  operator: readonly string[],
  tenant: readonly string[] = [],
): { operator: string[]; tenant: string[] } {
  const op = [...new Set(operator.map((a) => a.toLowerCase()))];
  const ten = [
    ...new Set(
      tenant.map((a) => a.toLowerCase()).filter((a) => !op.includes(a)),
    ),
  ];
  return { operator: op, tenant: ten };
}
