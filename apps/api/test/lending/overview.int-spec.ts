/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * The home dashboard's lending overview (GET /lending/overview): real counts
 * and amounts from the lending book, dated by the business date, confined to
 * the caller's loan scope and totalled in the tenant's base currency.
 */
import { Fixture, TEST_DB, bootstrap, expectOk, grant, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Lending overview for the dashboard (integration)', () => {
  let f: Fixture;
  let late: string;
  let good: string;
  let paid = 0;

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const moveTo = async (businessDate: string) => {
    expectOk(
      await f.as('finance').post('/lending/ops/business-date', { businessDate }),
    );
    expect(
      expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
    ).toEqual([]);
  };
  const overview = async (who = 'opsMaker') =>
    expectOk(await f.as(who).get('/lending/overview'));

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-OVERVIEW',
      (c) => {
        c.pricing.fees = [];
      },
    );
    const terms = {
      principal: '3000',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    };
    late = (await originateAndDisburse(f, productId, terms)).loanId;
    good = (await originateAndDisburse(f, productId, terms)).loanId;
    await moveTo('2026-02-05');
    const line = (await loan(good)).schedule.find(
      (x: any) => x.number === 1 && x.status !== 'SUPERSEDED',
    );
    paid = Number(line.principalDue) + Number(line.interestDue);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${good}/repayments`,
          { amount: paid.toFixed(2), externalReference: 'CASH-OV-1' },
          key('ov'),
        ),
    );
    await moveTo('2026-02-28');
  }, 120_000);
  afterAll(async () => f?.app.close());

  it('counts the book, the overdue loans and what falls due in the next days, by business date', async () => {
    const o = await overview();
    expect(o.businessDate).toBe('2026-02-28');
    expect(o.reportingCurrency).toBe('USD');
    expect(o.totals.activeLoans).toBe(2);
    expect(o.totals.borrowers).toBe(2);
    expect(o.totals.overdueLoans).toBe(1);
    const [a, b] = [await loan(late), await loan(good)];
    expect(Number(o.totals.principalOutstanding)).toBeCloseTo(
      Number(a.account.principalOutstanding) +
        Number(b.account.principalOutstanding),
      2,
    );
    expect(Number(o.totals.overdueOutstanding)).toBeCloseTo(
      Number(a.account.principalOutstanding),
      2,
    );
    // Both loans' second instalment falls due on 2026-03-05, inside the 7-day window.
    expect(Number(o.totals.dueNextDays)).toBeGreaterThan(0);
    expect(o.dueWindowDays).toBe(7);
    // A shorter window (to 2026-03-03) holds nothing; the window is bounded.
    const short = expectOk(await f.as('opsMaker').get('/lending/overview?days=3'));
    expect(short.dueWindowDays).toBe(3);
    expect(short.totals.dueNextDays).toBe('0.00');
    const capped = expectOk(await f.as('opsMaker').get('/lending/overview?days=9999'));
    expect(capped.dueWindowDays).toBe(60);
    expect(o.totals.collectedThisMonth).toBe(paid.toFixed(2));
    expect(o.totals.collectedLastMonth).toBe('0.00');
    expect(o.trend).toHaveLength(6);
    const jan = o.trend.find((t: any) => t.month === '2026-01');
    const feb = o.trend.find((t: any) => t.month === '2026-02');
    expect(Number(jan.disbursements)).toBeCloseTo(6000, 2);
    expect(feb.collections).toBe(paid.toFixed(2));
    expect(o.byCurrency.map((c: any) => c.currency)).toEqual(['USD']);
    expect(o.unconverted).toEqual([]);
  });

  it('stays inside the caller’s scope and is refused without loan.read', async () => {
    // ro2 reads loans in the Siem Reap branch only; both loans are in Phnom Penh.
    const other = await overview('ro2');
    expect(other.totals.activeLoans).toBe(0);
    expect(other.totals.principalOutstanding).toBe('0.00');
    const denied = await f.as('nobody').get('/lending/overview');
    expect(denied.status).toBe(403);
    // Another organisation sees none of tenant 1's book.
    await grant(f, f.t2, 't2ops', 'LOAN_OPS_MAKER');
    const foreign = expectOk(await f.as('t2ops').get('/lending/overview'));
    expect(foreign.totals.activeLoans).toBe(0);
  });

  it('totals in the base currency with the tenant FX table, and names currencies it cannot convert', async () => {
    await f.system(() =>
      f.prisma.tenant.update({
        where: { id: f.t1 },
        data: { baseCurrency: 'KHR' },
      }),
    );
    const missing = await overview();
    expect(missing.reportingCurrency).toBe('KHR');
    expect(missing.unconverted).toEqual(['USD']);
    expect(missing.totals.principalOutstanding).toBe('0.00');
    // Per-currency figures are still reported in their own currency.
    expect(Number(missing.byCurrency[0].principalOutstanding)).toBeGreaterThan(0);
    await f.system(() =>
      f.prisma.exchangeRate.create({
        data: {
          tenantId: f.t1,
          fromCurrency: 'USD',
          toCurrency: 'KHR',
          rate: '4000',
          effectiveDate: new Date(Date.UTC(2026, 0, 1)),
        },
      }),
    );
    const converted = await overview();
    expect(converted.unconverted).toEqual([]);
    expect(Number(converted.totals.principalOutstanding)).toBeCloseTo(
      Number(converted.byCurrency[0].principalOutstanding) * 4000,
      2,
    );
    await f.system(() =>
      f.prisma.tenant.update({
        where: { id: f.t1 },
        data: { baseCurrency: 'USD' },
      }),
    );
  });
});
