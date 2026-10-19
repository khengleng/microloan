/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Monitoring: the Prometheus endpoint is closed unless configured, carries
 * aggregates only (no tenant, user or loan id anywhere), and reports end of
 * day, reconciliation, month end, the outbox and the database pool; liveness
 * and readiness are separate probes.
 */
import { Fixture, TEST_DB, bootstrap, expectOk } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Monitoring (integration)', () => {
  let f: Fixture;
  let loanId: string;
  let collector: any;
  let scheduler: any;
  const TOKEN = 'metrics-token-for-tests-0123456789';

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const {
      LendingMetricsCollector,
    } = require('../../src/lending/monitoring/lending-metrics.collector');
    const {
      EodSchedulerService,
    } = require('../../src/lending/servicing/eod-scheduler.service');
    collector = f.app.get(LendingMetricsCollector);
    scheduler = f.app.get(EodSchedulerService);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'MON-STD',
    );
    const start = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    loanId = (
      await originateAndDisburse(f, productId, {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: start,
      })
    ).loanId;
  }, 90_000);
  afterAll(async () => {
    delete process.env.METRICS_BEARER_TOKEN;
    delete process.env.METRICS_ALLOW_PRIVATE_NETWORK;
    await f?.app.close();
  });

  const scrape = (headers: Record<string, string> = {}) => {
    const r = f.http().get('/v1/metrics');
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return r;
  };
  const value = (body: string, metric: string) => {
    const line = body
      .split('\n')
      .find((l) => l.startsWith(`${metric} `) || l.startsWith(`${metric}{`));
    return line ? Number(line.split(' ').pop()) : undefined;
  };

  it('is closed until a token or the private network is configured', async () => {
    delete process.env.METRICS_BEARER_TOKEN;
    delete process.env.METRICS_ALLOW_PRIVATE_NETWORK;
    expect((await scrape()).status).toBe(404);
    expect((await scrape({ Authorization: `Bearer ${TOKEN}` })).status).toBe(
      404,
    );
    // A staff token is not a metrics credential.
    expect(
      (await scrape({ Authorization: `Bearer ${f.tokens.admin1}` })).status,
    ).toBe(404);
  });

  it('accepts the configured bearer token and nothing else', async () => {
    process.env.METRICS_BEARER_TOKEN = TOKEN;
    expect((await scrape({ Authorization: `Bearer ${TOKEN}x` })).status).toBe(
      404,
    );
    const ok = await scrape({ Authorization: `Bearer ${TOKEN}` });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/text\/plain/);
    delete process.env.METRICS_BEARER_TOKEN;
  });

  it('on the private network, only direct requests — never forwarded ones', async () => {
    process.env.METRICS_ALLOW_PRIVATE_NETWORK = 'true';
    expect((await scrape()).status).toBe(200);
    expect((await scrape({ 'X-Forwarded-For': '10.0.0.1' })).status).toBe(404);
    delete process.env.METRICS_ALLOW_PRIVATE_NETWORK;
  });

  it('reports end of day, the books, the outbox and the pool — as aggregates only', async () => {
    process.env.METRICS_BEARER_TOKEN = TOKEN;
    const from = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    const r = await scheduler.runTenant(f.t1, lending.addDays(from, 2));
    expect(r.runs.every((x: any) => x.failed === 0)).toBe(true);
    expect(await collector.reconcileAll()).toMatchObject({ breaks: 0 });
    await collector.refresh();
    // Some traffic for the HTTP histogram.
    expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`));

    const body = (await scrape({ Authorization: `Bearer ${TOKEN}` })).text;
    expect(value(body, 'lending_eod_loans_processed_total')).toBeGreaterThan(0);
    expect(value(body, 'lending_eod_loans_failed_total')).toBe(0);
    expect(body).toMatch(/lending_eod_run_duration_seconds_count \d+/);
    expect(body).toMatch(/lending_eod_loan_duration_seconds_bucket/);
    expect(value(body, 'lending_tenants_with_active_loans')).toBeGreaterThan(0);
    expect(value(body, 'lending_eod_tenants_behind')).toBeGreaterThanOrEqual(0);
    expect(value(body, 'lending_reconciliation_breaks')).toBe(0);
    expect(
      value(body, 'lending_reconciliation_oldest_run_timestamp_seconds'),
    ).toBeGreaterThanOrEqual(0);
    expect(body).toMatch(
      /lending_month_end_closes_pending\{status="PENDING"\}/,
    );
    expect(body).toMatch(/lending_outbox_backlog\{status="PENDING"\}/);
    expect(body).toMatch(/lending_db_connections\{state="active"\}/);
    expect(body).toMatch(/lending_db_pool_size \d+/);
    expect(body).toMatch(/prisma_pool_connections_open/);
    // Routes are patterns, never raw paths with ids in them.
    expect(body).toMatch(
      /http_requests_total\{method="GET",route="\/v1\/lending\/loans\/:id",status="2xx"\}/,
    );

    // No record id of any kind appears anywhere in the scrape.
    const ids: string[] = await f.system(async () => [
      ...(await f.prisma.tenant.findMany({ select: { id: true } })).map(
        (x: any) => x.id,
      ),
      ...(await f.prisma.user.findMany({ select: { id: true } })).map(
        (x: any) => x.id,
      ),
      ...(await f.prisma.loanAccount.findMany({ select: { id: true } })).map(
        (x: any) => x.id,
      ),
      ...(await f.prisma.branch.findMany({ select: { id: true } })).map(
        (x: any) => x.id,
      ),
    ]);
    expect(ids.length).toBeGreaterThan(3);
    for (const id of ids) expect(body).not.toContain(id);
    delete process.env.METRICS_BEARER_TOKEN;
  });

  it('separates liveness from readiness', async () => {
    const live = await f.http().get('/v1/health/live');
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: 'ok' });
    const ready = await f.http().get('/v1/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ok', checks: { database: 'up' } });
  });
});
