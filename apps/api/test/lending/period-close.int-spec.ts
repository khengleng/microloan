/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped API responses. */
/**
 * Month-end and year-end close (OPS-6): checks, snapshot, maker-checker lock,
 * the period lock in the application and in the database, reopening under
 * maker-checker, month end as a stage of end of day, and the year-end
 * journal into retained earnings.
 */
import { randomUUID } from 'node:crypto';
import { Fixture, TEST_DB, bootstrap, expectOk, grant, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Month-end and year-end close (integration)', () => {
  let f: Fixture;
  let loanId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    // Finance prepares; risk (a different person) approves.
    await grant(f, f.t1, 'nobody', 'RISK_COMPLIANCE');
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-CLOSE',
      (c) => {
        c.pricing.fees = [];
      },
    );
    loanId = (
      await originateAndDisburse(f, productId, {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      })
    ).loanId;
  }, 90_000);
  afterAll(async () => f?.app.close());

  const moveTo = async (businessDate: string) => {
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate }),
    );
    expect(
      expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
    ).toEqual([]);
  };
  const month = (y: number, m: number) =>
    f.as('finance').get(`/lending/ops/periods/${y}/${m}`);
  const prepare = (y: number, m: number, who = 'finance') =>
    f.as(who).post(`/lending/ops/periods/${y}/${m}/prepare`, {});
  const decide = (y: number, m: number, approve: boolean, who = 'nobody') =>
    f.as(who).post(`/lending/ops/periods/${y}/${m}/decision`, { approve });
  const pay = (amount: string, k: string) =>
    f
      .as('opsMaker')
      .post(`/lending/loans/${loanId}/repayments`, { amount }, key(k));

  it('the year view shows the current month and what the viewer may do', async () => {
    const o = expectOk(
      await f.as('finance').get('/lending/ops/periods?year=2026'),
    );
    expect(o.months).toHaveLength(12);
    expect(o.months[0].status).toBe('CURRENT');
    expect(o.months[1].status).toBe('FUTURE');
    expect(o.permissions.prepare.allowed).toBe(true);
    expect(o.permissions.approve.allowed).toBe(false);
  });

  it('a month cannot be closed before it ends; the failing check says why', async () => {
    const res = await prepare(2026, 1);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CLOSE_CHECKS_FAILED');
    expect(
      res.body.checks.find((c: any) => c.code === 'BUSINESS_DATE').status,
    ).toBe('FAIL');
  });

  it('after the last end of day the month is ready, with a snapshot of the books and the portfolio', async () => {
    await moveTo('2026-01-31');
    const m = expectOk(await month(2026, 1));
    expect(m.ready).toBe(true);
    expect(m.checks.map((c: any) => c.code)).toEqual(
      expect.arrayContaining([
        'BUSINESS_DATE',
        'END_OF_DAY',
        'PREVIOUS_MONTH',
        'BOOKS_BALANCE',
        'RECONCILIATION',
      ]),
    );
    expect(m.snapshotIsPreview).toBe(true);
    expect(m.snapshot.portfolio.USD.activeLoans).toBeGreaterThanOrEqual(1);
    expect(Number(m.snapshot.month.USD.disbursed)).toBeGreaterThanOrEqual(6000);
  });

  it('finance prepares, cannot approve its own close; another person locks it', async () => {
    const p = expectOk(await prepare(2026, 1));
    expect(p.status).toBe('PENDING');
    expect((await prepare(2026, 1)).status).toBe(409);
    expect((await decide(2026, 1, true, 'finance')).status).toBe(403);
    const c = expectOk(await decide(2026, 1, true));
    expect(c.status).toBe('CLOSED');
    const m = expectOk(await month(2026, 1));
    expect(m.status).toBe('CLOSED');
    expect(m.log.map((l: any) => l.action)).toEqual(['PREPARED', 'APPROVED']);
    expect(m.snapshot.trialBalance.length).toBeGreaterThan(0);
  });

  it('nothing is posted into a closed month — by the application or straight into the database', async () => {
    const res = await pay('100.00', 'jan-late');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PERIOD_CLOSED');
    await expect(
      f.system(() =>
        f.prisma.lendingJournalEntry.create({
          data: {
            tenantId: f.t1,
            financialEventId: randomUUID(),
            entryDate: new Date(Date.UTC(2026, 0, 20)),
            currency: 'USD',
            description: 'Back-dated attempt',
          },
        }),
      ),
    ).rejects.toThrow(/PERIOD_CLOSED/);
    // The next business day is open.
    await moveTo('2026-02-01');
    expectOk(await pay('100.00', 'feb-1'));
  });

  it('reopening needs a reason and a second person; the month can then be closed again', async () => {
    expect(
      (
        await f
          .as('finance')
          .post('/lending/ops/periods/2026/1/reopen', { reason: 'short' })
      ).status,
    ).toBe(400);
    expectOk(
      await f.as('finance').post('/lending/ops/periods/2026/1/reopen', {
        reason: 'Correct a misposted January receipt',
      }),
    );
    expect(expectOk(await month(2026, 1)).status).toBe('REOPEN_PENDING');
    expect(
      (
        await f
          .as('finance')
          .post('/lending/ops/periods/2026/1/reopen-decision', {
            approve: true,
          })
      ).status,
    ).toBe(403);
    expectOk(
      await f
        .as('nobody')
        .post('/lending/ops/periods/2026/1/reopen-decision', { approve: true }),
    );
    const reopened = expectOk(await month(2026, 1));
    expect(reopened.status).toBe('OPEN');
    expectOk(await prepare(2026, 1));
    expectOk(await decide(2026, 1, true));
  });

  it('only the latest closed month can be reopened; a rejected close leaves the month open', async () => {
    await moveTo('2026-02-28');
    expectOk(await prepare(2026, 2));
    expectOk(await decide(2026, 2, false));
    expect(expectOk(await month(2026, 2)).status).toBe('OPEN');
    expectOk(await prepare(2026, 2));
    expectOk(await decide(2026, 2, true));
    const res = await f
      .as('finance')
      .post('/lending/ops/periods/2026/1/reopen', {
        reason: 'Reopen an older month out of order',
      });
    expect(res.status).toBe(409);
  });

  it('month end is a stage of end of day: the last day prepares the close for approval', async () => {
    const {
      EodSchedulerService,
    } = require('../../src/lending/servicing/eod-scheduler.service');
    const scheduler = f.app.get(EodSchedulerService);
    await scheduler.runTenant(f.t1, '2026-03-31', 31);
    const m = expectOk(await month(2026, 3));
    expect(m.status).toBe('PENDING');
    expect(m.preparedBy).toBe('system:period-close');
    expectOk(await decide(2026, 3, true));
  });

  it('the year cannot close while months are open', async () => {
    const y = expectOk(await f.as('finance').get('/lending/ops/years/2026'));
    expect(y.ready).toBe(false);
    expect(y.checks.find((c: any) => c.code === 'MONTHS_CLOSED').status).toBe(
      'FAIL',
    );
    expect(
      (await f.as('finance').post('/lending/ops/years/2026/prepare', {}))
        .status,
    ).toBe(400);
  });

  it('year end carries income and expense into retained earnings and leaves the books balanced', async () => {
    const {
      EodSchedulerService,
    } = require('../../src/lending/servicing/eod-scheduler.service');
    const scheduler = f.app.get(EodSchedulerService);
    // Roll through the rest of the year; each month end is prepared by end of day and locked by risk.
    for (let m = 4; m <= 12; m++) {
      const end = new Date(Date.UTC(2026, m, 0)).toISOString().slice(0, 10);
      await scheduler.runTenant(f.t1, end, 31);
      const p = expectOk(await month(2026, m));
      expect(p.status).toBe('PENDING');
      expectOk(await decide(2026, m, true));
    }
    const view = expectOk(await f.as('finance').get('/lending/ops/years/2026'));
    expect(view.ready).toBe(true);
    const usd = view.closing.find((c: any) => c.currency === 'USD');
    expect(Number(usd.income)).toBeGreaterThan(0);

    expectOk(await f.as('finance').post('/lending/ops/years/2026/prepare', {}));
    expect(
      (
        await f
          .as('finance')
          .post('/lending/ops/years/2026/decision', { approve: true })
      ).status,
    ).toBe(403);
    const closed = expectOk(
      await f
        .as('nobody')
        .post('/lending/ops/years/2026/decision', { approve: true }),
    );
    expect(closed.status).toBe('CLOSED');
    expect(closed.closingEventIds.length).toBeGreaterThan(0);

    // Income and expense for 2026 now net to zero; retained earnings hold the result.
    const tb = expectOk(
      await f.as('finance').get('/lending/ops/trial-balance'),
    );
    const usdTb = tb.find((t: any) => t.currency === 'USD');
    expect(usdTb.totals.balanced).toBe(true);
    const re = usdTb.rows.find((a: any) => a.code === '3100');
    expect(Number(re.balance)).toBeLessThan(0);
    for (const r of usdTb.rows.filter((a: any) => ['INCOME', 'EXPENSE'].includes(a.type)))
      expect(Number(r.balance)).toBe(0);
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    // A month of a closed year cannot be reopened.
    expect(
      (
        await f.as('finance').post('/lending/ops/periods/2026/12/reopen', {
          reason: 'Try to reopen December after year end',
        })
      ).status,
    ).toBe(409);
  }, 300_000);
});
