import {
  ALERT_KEYS,
  alertRecipients,
  checkBacklog,
  checkDatabase,
  checkEndOfDay,
  checkFailedJobs,
  checkMonthEnd,
  checkReconciliation,
  planAlerts,
} from './operational-checks';

/** The operational health checks' decisions (D-150), as pure functions. */
describe('operational checks', () => {
  const at = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(Date.UTC(y, m - 1, d, h, min));

  describe('end of day', () => {
    const base = {
      today: '2026-10-20',
      businessDate: '2026-10-20',
      lastBatchDate: '2026-10-20',
      lastBatchFailures: 0,
      maxLagDays: 1,
    };
    it('is quiet when the last run reached today, or yesterday before the nightly run', () => {
      expect(checkEndOfDay(base)).toEqual([]);
      expect(checkEndOfDay({ ...base, lastBatchDate: '2026-10-19' })).toEqual(
        [],
      );
    });
    it('alerts when the last run lags more than the allowed days', () => {
      const [f] = checkEndOfDay({ ...base, lastBatchDate: '2026-10-18' });
      expect(f).toMatchObject({
        key: ALERT_KEYS.eodStale,
        severity: 'CRITICAL',
        details: { lagDays: 2, allowedLagDays: 1 },
      });
      expect(
        checkEndOfDay({ ...base, lastBatchDate: '2026-10-18', maxLagDays: 2 }),
      ).toEqual([]);
    });
    it('falls back to the business date when no batch has run, and alerts when there is neither', () => {
      expect(checkEndOfDay({ ...base, lastBatchDate: null })).toEqual([]);
      expect(
        checkEndOfDay({
          ...base,
          lastBatchDate: null,
          businessDate: '2026-10-10',
        }),
      ).toHaveLength(1);
      expect(
        checkEndOfDay({ ...base, lastBatchDate: null, businessDate: null })[0]
          .summary,
      ).toMatch(/never run/);
    });
    it('warns when the last run left accounts unprocessed', () => {
      expect(checkEndOfDay({ ...base, lastBatchFailures: 3 })).toEqual([
        expect.objectContaining({
          key: ALERT_KEYS.eodFailures,
          severity: 'WARNING',
          details: { lastBatchDate: '2026-10-20', failedAccounts: 3 },
        }),
      ]);
    });
  });

  describe('month end', () => {
    const base = {
      today: '2026-10-11',
      firstPostingDate: '2026-08-05',
      closedMonths: ['2026-08', '2026-09'],
      graceDays: 10,
    };
    it('is quiet when every past month is closed, or with no postings', () => {
      expect(checkMonthEnd(base)).toEqual([]);
      expect(
        checkMonthEnd({ ...base, firstPostingDate: null, closedMonths: [] }),
      ).toEqual([]);
    });
    it('alerts from the day after the grace period, not before', () => {
      const open = { ...base, closedMonths: ['2026-08'] };
      expect(checkMonthEnd({ ...open, today: '2026-10-10' })).toEqual([]);
      expect(checkMonthEnd(open)).toEqual([
        expect.objectContaining({
          key: ALERT_KEYS.monthEnd,
          details: { months: ['2026-09'], graceDays: 10 },
        }),
      ]);
    });
    it('keeps an old unclosed month open when the calendar moves on (no false resolve)', () => {
      const [f] = checkMonthEnd({
        ...base,
        today: '2026-11-02',
        closedMonths: ['2026-08'],
      });
      expect(f.details.months).toEqual(['2026-09']);
      const [g] = checkMonthEnd({
        ...base,
        today: '2027-01-15',
        closedMonths: [],
      });
      expect(g.details.months).toEqual([
        '2026-08',
        '2026-09',
        '2026-10',
        '2026-11',
        '2026-12',
      ]);
      expect(g.summary).toMatch(/5 month ends/);
    });
    it('never counts the current month, nor months before the first posting', () => {
      expect(
        checkMonthEnd({
          ...base,
          firstPostingDate: '2026-10-01',
          closedMonths: [],
        }),
      ).toEqual([]);
    });
  });

  describe('outbox and webhook backlog', () => {
    const now = at(2026, 10, 20, 12, 0);
    it('alerts only when the oldest pending message is older than allowed', () => {
      const base = {
        kind: 'outbox' as const,
        now,
        pending: 4,
        maxAgeMinutes: 30,
      };
      expect(checkBacklog({ ...base, oldestPendingAt: null })).toEqual([]);
      expect(
        checkBacklog({ ...base, oldestPendingAt: at(2026, 10, 20, 11, 30) }),
      ).toEqual([]);
      expect(
        checkBacklog({ ...base, oldestPendingAt: at(2026, 10, 20, 11, 29) }),
      ).toEqual([
        expect.objectContaining({
          key: ALERT_KEYS.outbox,
          details: expect.objectContaining({
            pending: 4,
            oldestAgeMinutes: 31,
          }),
        }),
      ]);
      expect(
        checkBacklog({
          ...base,
          kind: 'webhooks',
          oldestPendingAt: at(2026, 10, 20, 9),
        })[0].key,
      ).toBe(ALERT_KEYS.webhooks);
    });
  });

  describe('reconciliation', () => {
    it('alerts when the latest run found breaks', () => {
      const t = at(2026, 10, 20, 6, 40);
      expect(checkReconciliation({ lastRun: null })).toEqual([]);
      expect(checkReconciliation({ lastRun: { at: t, breaks: 0 } })).toEqual(
        [],
      );
      expect(checkReconciliation({ lastRun: { at: t, breaks: 2 } })).toEqual([
        expect.objectContaining({
          key: ALERT_KEYS.reconciliation,
          severity: 'CRITICAL',
          details: { breaks: 2, checkedAt: t.toISOString() },
        }),
      ]);
    });
  });

  describe('failed scheduled jobs', () => {
    const t = at(2026, 10, 20, 0, 20);
    it('ignores reconciliation results and declined auto-debits', () => {
      expect(
        checkFailedJobs({
          failures: [
            { action: 'accounting.reconciliation', at: t },
            { action: 'payment.auto_debit.attempt', at: t },
          ],
          lookbackHours: 24,
        }),
      ).toEqual([]);
    });
    it('counts failures by job; end of day failing is critical', () => {
      const [w] = checkFailedJobs({
        failures: [
          { action: 'document.file_generated', at: t },
          { action: 'document.file_generated', at: t },
        ],
        lookbackHours: 24,
      });
      expect(w).toMatchObject({
        key: ALERT_KEYS.jobs,
        severity: 'WARNING',
        details: { byAction: { 'document.file_generated': 2 } },
      });
      const [c] = checkFailedJobs({
        failures: [{ action: 'servicing.eod.run', at: t }],
        lookbackHours: 24,
      });
      expect(c.severity).toBe('CRITICAL');
    });
  });

  describe('database', () => {
    it('alerts when the readiness ping fails, or connections reach the threshold', () => {
      const base = {
        reachable: true,
        connections: 10,
        maxConnections: 100,
        maxPct: 80,
      };
      expect(checkDatabase(base)).toEqual([]);
      expect(checkDatabase({ ...base, reachable: false })[0].key).toBe(
        ALERT_KEYS.databaseUnreachable,
      );
      expect(checkDatabase({ ...base, connections: 80 })[0]).toMatchObject({
        key: ALERT_KEYS.databaseConnections,
        details: { pct: 80 },
      });
      expect(checkDatabase({ ...base, connections: null })).toEqual([]);
    });
  });

  describe('alert state', () => {
    const now = at(2026, 10, 20, 12);
    const hours6 = 6 * 3_600_000;
    const finding = (key: string) => ({
      key,
      severity: 'WARNING' as const,
      summary: key,
      details: {},
    });
    it('opens new findings, keeps open ones, resolves the rest', () => {
      const plan = planAlerts(
        [
          { id: 'a', key: 'eod.stale', lastNotifiedAt: at(2026, 10, 20, 11) },
          {
            id: 'b',
            key: 'outbox.backlog',
            lastNotifiedAt: at(2026, 10, 20, 11),
          },
        ],
        [finding('eod.stale'), finding('jobs.failed')],
        now,
        hours6,
      );
      expect(plan.open.map((f) => f.key)).toEqual(['jobs.failed']);
      expect(plan.keep).toEqual([
        expect.objectContaining({
          alert: expect.objectContaining({ id: 'a' }),
          remind: false,
        }),
      ]);
      expect(plan.resolve.map((a) => a.id)).toEqual(['b']);
    });
    it('reminds at most once per reminder interval', () => {
      const plan = (last: Date | null) =>
        planAlerts(
          [{ id: 'a', key: 'eod.stale', lastNotifiedAt: last }],
          [finding('eod.stale')],
          now,
          hours6,
        ).keep[0].remind;
      expect(plan(at(2026, 10, 20, 6, 1))).toBe(false);
      expect(plan(at(2026, 10, 20, 6, 0))).toBe(true);
      expect(plan(null)).toBe(true);
    });
    it('a finding reported twice opens one alert', () => {
      expect(
        planAlerts(
          [],
          [finding('eod.stale'), finding('eod.stale')],
          now,
          hours6,
        ).open,
      ).toHaveLength(1);
    });
  });

  it('recipients: the operator list, and the tenant list without the operator addresses', () => {
    expect(alertRecipients([], [])).toEqual({ operator: [], tenant: [] });
    expect(
      alertRecipients(
        ['ops@platform.example'],
        ['OPS@platform.example', 'a@lender.example'],
      ),
    ).toEqual({
      operator: ['ops@platform.example'],
      tenant: ['a@lender.example'],
    });
  });
});
