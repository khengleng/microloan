/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * The operational health monitor (D-150…D-152): an alert opens once, is
 * reminded at most once per interval, resolves once; e-mail goes out only
 * with recipients and a provider (logged otherwise); a tenant sees and is
 * e-mailed only its own alerts; platform alerts are visible in system
 * context only.
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  expectOk,
  grant,
  lendingSettings,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Operational alerts (integration)', () => {
  let f: Fixture;
  let monitor: any;
  let runAsTenant: (t: string, fn: () => Promise<any>) => Promise<any>;
  let today: string;
  let fetchSpy: jest.SpyInstance;
  const sent: { to: string[]; subject: string; html: string }[] = [];
  const realFetch = global.fetch;
  const ENV = [
    'ALERT_EMAIL_TO',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'ALERT_BACKLOG_MAX_AGE_MINUTES',
    'ALERT_DB_CONNECTIONS_PCT',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t2, 't2admin', 'FINANCE_OFFICER');
    const {
      OperationalAlertService,
    } = require('../../src/lending/monitoring/operational-alerts.service');
    runAsTenant = require('../../src/prisma/tenant-context').runAsTenant;
    monitor = f.app.get(OperationalAlertService);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'ALERT-STD',
    );
    const businessDate = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    await originateAndDisburse(f, productId, {
      principal: '3000',
      numberOfInstalments: 6,
      disbursementDate: businessDate,
    });
    // End of day is measured against the calendar in the tenant's zone.
    today = require('../../src/lending/common/util').localDateIn(new Date());
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url: any, init?: any) => {
        if (String(url).includes('resend')) {
          const body = JSON.parse(init.body);
          sent.push({
            to: [body.to].flat(),
            subject: body.subject,
            html: body.html,
          });
          return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 });
        }
        return realFetch(url, init);
      });
  }, 120_000);

  beforeEach(() => {
    // The fixture's own outbox messages are never delivered here (the
    // worker is off in tests); only the backlog test looks at a backlog.
    process.env.ALERT_BACKLOG_MAX_AGE_MINUTES = '10080';
    // Other suites share the database server: keep the platform pool check quiet.
    process.env.ALERT_DB_CONNECTIONS_PCT = '100';
    sent.length = 0;
  });

  afterAll(async () => {
    fetchSpy?.mockRestore();
    for (const k of ENV)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    if (f)
      await f.system(async () => {
        await f.prisma.outboxMessage.deleteMany({
          where: { tenantId: f.t2, topic: 'test.alert-backlog' },
        });
      });
    await f?.app.close();
  });

  const at = (hoursFromNow: number) =>
    new Date(Date.now() + hoursFromNow * 3_600_000);
  const run = (now = at(0)) => monitor.run({ now, tenantIds: [f.t1, f.t2] });
  const rows = (tenantId: string, key: string) =>
    f.system(() =>
      f.prisma.operationalAlert.findMany({
        where: { tenantId, key },
        orderBy: { openedAt: 'asc' },
      }),
    );
  const setLastBatch = (date: string) =>
    f.system(() =>
      f.prisma.tenantBusinessDate.update({
        where: { tenantId: f.t1 },
        data: { lastBatchDate: new Date(`${date}T00:00:00.000Z`) },
      }),
    );
  /** E-mails about one tenant's alert (other checks may raise their own). */
  const mine = (tenantName: string, about = 'End of day') =>
    sent.filter(
      (m) => m.subject.includes(tenantName) && m.subject.includes(about),
    );

  let t1Name: string;
  let t2Name: string;

  it('logs only — no e-mail — without RESEND_API_KEY or without recipients', async () => {
    [t1Name, t2Name] = await f.system(async () =>
      Promise.all(
        [f.t1, f.t2].map(
          async (id) =>
            (await f.prisma.tenant.findUnique({ where: { id } })).name,
        ),
      ),
    );
    // Recipients but no provider.
    process.env.ALERT_EMAIL_TO = 'ops@platform.example';
    delete process.env.RESEND_API_KEY;
    await setLastBatch(lending.addDays(today, -5));
    await run();
    let [a] = await rows(f.t1, 'eod.stale');
    expect(a).toMatchObject({
      status: 'OPEN',
      severity: 'CRITICAL',
      lastDelivery: 'LOG_ONLY',
      notifyCount: 1,
    });
    expect(sent).toEqual([]);

    // A provider but nobody to tell: resolve, then reopen with no recipients.
    await setLastBatch(today);
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'alerts@platform.example';
    delete process.env.ALERT_EMAIL_TO;
    await run();
    await setLastBatch(lending.addDays(today, -5));
    await run();
    const all = await rows(f.t1, 'eod.stale');
    expect(all.map((x: any) => x.status)).toEqual(['RESOLVED', 'OPEN']);
    a = all[1];
    expect(a.lastDelivery).toBe('LOG_ONLY');
    expect(mine(t1Name)).toEqual([]);
  });

  it('a persisting problem keeps one open alert and sends nothing more until a reminder is due', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@platform.example';
    await run(at(0));
    await run(at(1));
    const open = (await rows(f.t1, 'eod.stale')).filter(
      (x: any) => x.status === 'OPEN',
    );
    expect(open).toHaveLength(1);
    expect(open[0].notifyCount).toBe(1);
    expect(mine(t1Name)).toEqual([]);
  });

  it('reminds after the interval, to the operator and the lender’s own contacts separately', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@platform.example';
    await lendingSettings(f, f.t1, {
      operations: { alertEmails: ['ops@lender-one.example'] },
    });
    await run(at(6.1));
    const reminders = mine(t1Name);
    expect(reminders).toHaveLength(2);
    expect(reminders.map((m) => m.to)).toEqual([
      ['ops@platform.example'],
      ['ops@lender-one.example'],
    ]);
    for (const m of reminders) {
      expect(m.subject).toMatch(
        /Still open: End of day is \d+ day\(s\) behind/,
      );
      expect(m.html).toContain('eod.stale');
    }
    // The lender is pointed at its operations page, the operator at the platform's.
    expect(reminders[1].html).toContain('/lending/operations');
    expect(reminders[0].html).toContain('/tenants');
    const [open] = (await rows(f.t1, 'eod.stale')).filter(
      (x: any) => x.status === 'OPEN',
    );
    expect(open).toMatchObject({ lastDelivery: 'EMAIL', notifyCount: 2 });

    // Just after a reminder, no other one.
    sent.length = 0;
    await run(at(6.2));
    expect(mine(t1Name)).toEqual([]);
  });

  it('resolves once, with one "resolved" e-mail; the same problem returning opens a new alert', async () => {
    await setLastBatch(today);
    await run(at(6.3));
    expect(mine(t1Name).map((m) => m.subject)).toEqual([
      expect.stringMatching(/Resolved: End of day/),
      expect.stringMatching(/Resolved: End of day/),
    ]);
    sent.length = 0;
    await run(at(6.4));
    expect(mine(t1Name)).toEqual([]);
    expect(
      (await rows(f.t1, 'eod.stale')).every(
        (x: any) => x.status === 'RESOLVED',
      ),
    ).toBe(true);

    await setLastBatch(lending.addDays(today, -3));
    await run(at(6.5));
    expect(mine(t1Name).map((m) => m.subject)).toEqual([
      expect.stringMatching(/ALERT: End of day is \d+ day\(s\) behind/),
      expect.stringMatching(/ALERT: End of day/),
    ]);
    const all = await rows(f.t1, 'eod.stale');
    expect(all.filter((x: any) => x.status === 'OPEN')).toHaveLength(1);
    await setLastBatch(today);
    await run(at(6.6));
  });

  it('a tenant sees and is e-mailed only its own alerts', async () => {
    // A stuck outbox message of the second tenant.
    await f.system(() =>
      f.prisma.outboxMessage.create({
        data: {
          tenantId: f.t2,
          topic: 'test.alert-backlog',
          payload: {},
          createdAt: at(-24 * 8),
        },
      }),
    );
    await run(at(7));
    const [b] = await rows(f.t2, 'outbox.backlog');
    expect(b).toMatchObject({ status: 'OPEN', lastDelivery: 'EMAIL' });
    // The second tenant has no contacts of its own: the operator only, and
    // the first tenant's contacts never hear of it.
    const t2Mail = mine(t2Name, 'Outbox');
    expect(t2Mail.map((m) => m.to)).toEqual([['ops@platform.example']]);
    expect(sent.some((m) => m.to.includes('ops@lender-one.example'))).toBe(
      false,
    );

    const t1View = expectOk(await f.as('finance').get('/lending/ops/alerts'));
    const t2View = expectOk(await f.as('t2admin').get('/lending/ops/alerts'));
    expect(t2View.open.map((x: any) => x.key)).toEqual(['outbox.backlog']);
    expect(t1View.open.map((x: any) => x.id)).not.toContain(b.id);
    expect(t1View.recentlyResolved.length).toBeGreaterThan(0);
    // Not even through raw SQL in the first tenant's context.
    const seen = await runAsTenant(
      f.t1,
      () =>
        f.prisma
          .$queryRaw`SELECT id FROM "OperationalAlert" WHERE "tenantId" = ${f.t2}`,
    );
    expect(seen).toEqual([]);

    // The platform operator sees both tenants' alerts; staff cannot use the platform route.
    const platform = expectOk(
      await f
        .http()
        .get('/v1/platform/operational-alerts')
        .set('Authorization', `Bearer ${f.tokens.platform}`),
    );
    expect(platform.open.map((x: any) => x.id)).toContain(b.id);
    expect(platform.emailConfigured).toBe(true);
    expect(
      (await f.as('admin1').get('/platform/operational-alerts')).status,
    ).toBe(403);
  });

  it('one instance per check slot: the platform-scoped claim is taken once, and old claims are pruned', async () => {
    const {
      JobClaimService,
      PLATFORM_JOB_SCOPE,
    } = require('../../src/prisma/job-claim.service');
    const {
      ALERT_MONITOR_JOB,
    } = require('../../src/lending/monitoring/operational-alerts.service');
    const claims = f.app.get(JobClaimService);
    const slot = `test-slot-${Date.now()}`;
    expect(await claims.once(PLATFORM_JOB_SCOPE, ALERT_MONITOR_JOB, slot)).toBe(
      true,
    );
    expect(await claims.once(PLATFORM_JOB_SCOPE, ALERT_MONITOR_JOB, slot)).toBe(
      false,
    );
    const later = new Date(Date.now() + 60_000);
    expect(
      await claims.prune(PLATFORM_JOB_SCOPE, ALERT_MONITOR_JOB, later),
    ).toBeGreaterThanOrEqual(1);
    expect(await claims.once(PLATFORM_JOB_SCOPE, ALERT_MONITOR_JOB, slot)).toBe(
      true,
    );
    await claims.prune(PLATFORM_JOB_SCOPE, ALERT_MONITOR_JOB, later);
  });

  it('platform alerts (no tenant) exist in system context only', async () => {
    const row = await f.system(() =>
      f.prisma.operationalAlert.create({
        data: {
          tenantId: null,
          key: `test.platform.${Date.now()}`,
          severity: 'WARNING',
          summary: 'test platform alert',
        },
      }),
    );
    try {
      const fromTenant = await runAsTenant(
        f.t1,
        () =>
          f.prisma
            .$queryRaw`SELECT id FROM "OperationalAlert" WHERE "tenantId" IS NULL`,
      );
      expect(fromTenant).toEqual([]);
      const view = expectOk(await f.as('finance').get('/lending/ops/alerts'));
      expect(view.open.map((x: any) => x.id)).not.toContain(row.id);
      // One open alert per scope and key, enforced by the database.
      await expect(
        f.system(() =>
          f.prisma.operationalAlert.create({
            data: {
              tenantId: null,
              key: row.key,
              severity: 'WARNING',
              summary: 'duplicate',
            },
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await f.system(() =>
        f.prisma.operationalAlert.delete({ where: { id: row.id } }),
      );
    }
  });
});
