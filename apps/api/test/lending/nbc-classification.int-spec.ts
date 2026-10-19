/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: rows come from the untyped API responses and Prisma client. */
/**
 * NBC classification and provisioning (DECISIONS D-113…D-117):
 * - the band set follows the loan's ORIGINAL term (short-term up to 366
 *   days, long-term beyond), kept on the account when a restructure moves
 *   the maturity;
 * - under a CIFRS 9 (ECL) policy the NBC provision above the allowance is
 *   appropriated to a regulatory reserve in equity at month-end close and
 *   released when it falls; the return shows both figures;
 * - in REGULATORY mode the return says the books are not CIFRS 9 compliant.
 */
import { Fixture, TEST_DB, bootstrap, expectOk, grant } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const ECL = {
  mode: 'ECL',
  classes: [
    { code: 'STANDARD', label: 'Standard', minDpd: 0, rate: '0.01' },
    {
      code: 'SPECIAL_MENTION',
      label: 'Special mention',
      minDpd: 15,
      rate: '0.03',
    },
    { code: 'SUBSTANDARD', label: 'Substandard', minDpd: 31, rate: '0.2' },
    { code: 'DOUBTFUL', label: 'Doubtful', minDpd: 61, rate: '0.5' },
    { code: 'LOSS', label: 'Loss', minDpd: 91, rate: '1' },
  ],
  ecl: {
    stage2FromDpd: 30,
    stage3FromDpd: 90,
    restructuredMinStage: 2,
    nonAccrualIsStage3: true,
    // 0.2% × 50%: an expected loss well below the NBC's 1% on a current loan.
    pd: { stage1: '0.002', stage2: '0.1', stage3: '1' },
    lgd: '0.5',
  },
};

d('NBC classification, regulatory reserve and close (integration)', () => {
  let f: Fixture;
  let shortLoan: string;
  let longLoan: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    // Finance proposes; risk (a different person) approves policies and closes.
    await grant(f, f.t1, 'nobody', 'RISK_COMPLIANCE');
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-NBC',
      (c) => {
        c.pricing.fees = [];
        c.pricing.penalty = {
          type: 'NONE',
          flatAmount: null,
          annualRate: null,
          graceDays: 0,
          capPerInstalment: null,
        };
      },
    );
    shortLoan = (
      await originateAndDisburse(f, productId, {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      })
    ).loanId;
    longLoan = (
      await originateAndDisburse(f, productId, {
        principal: '6000',
        numberOfInstalments: 24,
        disbursementDate: '2026-01-05',
      })
    ).loanId;
  }, 120_000);
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
  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const approvePolicy = async (settings: unknown) => {
    const p = expectOk(
      await f
        .as('finance')
        .post('/lending/ops/impairment-policy', { settings }),
    );
    return expectOk(
      await f
        .as('nobody')
        .post(`/lending/ops/impairment-policy/${p.id}/decision`, {
          approve: true,
        }),
    );
  };
  const close = async (month: number) => {
    const p = expectOk(
      await f
        .as('finance')
        .post(`/lending/ops/periods/2026/${month}/prepare`, {}),
    );
    expectOk(
      await f
        .as('nobody')
        .post(`/lending/ops/periods/2026/${month}/decision`, { approve: true }),
    );
    return p;
  };
  const balance = async (code: string) => {
    const tb = expectOk(
      await f.as('finance').get('/lending/ops/trial-balance'),
    );
    const row = tb
      .find((t: any) => t.currency === 'USD')
      .rows.find((a: any) => a.code === code);
    return Number(row?.balance ?? 0);
  };
  const reserveEvents = () =>
    f.system(() =>
      f.prisma.financialEvent.findMany({
        where: { tenantId: f.t1, type: 'REGULATORY_RESERVE' },
        orderBy: { createdAt: 'asc' },
        include: { journal: { include: { lines: true } } },
      }),
    );
  const generate = async (month: number) => {
    const g = expectOk(
      await f.as('finance').post('/lending/regulatory/returns', {
        year: 2026,
        month,
      }),
    );
    return expectOk(
      await f.as('finance').get(`/lending/regulatory/returns/${g.id}`),
    ).content;
  };

  it('keeps the original maturity: the 12-month loan is short-term, the 24-month loan long-term', async () => {
    const accounts = await f.system(() =>
      f.prisma.loanAccount.findMany({
        where: { id: { in: [shortLoan, longLoan] } },
        select: {
          id: true,
          disbursementDate: true,
          maturityDate: true,
          originalMaturityDate: true,
        },
      }),
    );
    for (const a of accounts) {
      expect(a.originalMaturityDate).toEqual(a.maturityDate);
      const days =
        (a.originalMaturityDate.getTime() - a.disbursementDate.getTime()) /
        86_400_000;
      if (a.id === shortLoan) expect(days).toBeLessThanOrEqual(366);
      else expect(days).toBeGreaterThan(366);
    }
    // The database keeps it once the loan is out of booking.
    await f.system(() =>
      f.prisma.loanAccount.update({
        where: { id: longLoan },
        data: { originalMaturityDate: new Date(Date.UTC(2026, 5, 1)) },
      }),
    );
    const kept = await f.system(() =>
      f.prisma.loanAccount.findUnique({
        where: { id: longLoan },
        select: { originalMaturityDate: true, maturityDate: true },
      }),
    );
    expect(kept.originalMaturityDate).toEqual(kept.maturityDate);
  });

  it('ECL: month-end close appropriates the NBC provision above the allowance to the regulatory reserve', async () => {
    await approvePolicy(ECL);
    await moveTo('2026-01-31');
    const month = expectOk(
      await f.as('finance').get('/lending/ops/periods/2026/1'),
    );
    expect(
      month.checks.find((c: any) => c.code === 'IMPAIRMENT_POLICY').status,
    ).toBe('PASS');
    expect(
      month.checks.find((c: any) => c.code === 'REGULATORY_RESERVE'),
    ).toMatchObject({ status: 'PASS' });
    const a = await loan(shortLoan);
    const b = await loan(longLoan);
    const allowance = Number(a.account.allowance) + Number(b.account.allowance);
    expect(allowance).toBeGreaterThan(0);
    // Both loans current: NBC 1% of 12,000 principal.
    const expected = 120 - allowance;
    await close(1);
    const [ev] = await reserveEvents();
    expect(Number(ev.amount)).toBeCloseTo(expected, 2);
    expect(ev.loanAccountId).toBeNull();
    const lines = ev.journal.lines.map(
      (l: any) => `${l.accountCode}:${Number(l.debit)}:${Number(l.credit)}`,
    );
    expect(lines.sort()).toEqual(
      [`3100:${Number(ev.amount)}:0`, `3200:0:${Number(ev.amount)}`].sort(),
    );
    expect(await balance('3200')).toBeCloseTo(-expected, 2);
    // Closing again posts nothing more: the reserve is measured against the ledger.
    expect(await reserveEvents()).toHaveLength(1);

    const c = await generate(1);
    expect(c.checks.filter((x: any) => !x.passed)).toEqual([]);
    const row = c.tables
      .find((t: any) => t.code === 'REGULATORY_RESERVE')
      .rows.find((r: any) => r.currency === 'USD');
    expect(row.basis).toBe('CIFRS 9 expected credit loss');
    expect(row.regulatoryProvision).toBe('120.00');
    expect(Number(row.allowance)).toBeCloseTo(allowance, 2);
    expect(Number(row.reserveRequired)).toBeCloseTo(expected, 2);
    expect(row.reserveHeld).toBe(row.reserveRequired);
  });

  it('REGULATORY: long-term loans grade on the long bands; the reserve is released and the return says not CIFRS 9', async () => {
    await approvePolicy({
      mode: 'REGULATORY',
      classes: ECL.classes,
    });
    // Neither loan pays its 5 February instalment: 20 days past due.
    await moveTo('2026-02-25');
    const s = await loan(shortLoan);
    const l = await loan(longLoan);
    expect(s.account.daysPastDue).toBe(20);
    expect(l.account.daysPastDue).toBe(20);
    expect(s.account.classification).toBe('SPECIAL_MENTION'); // 15–30, short-term
    expect(l.account.classification).toBe('STANDARD'); // 0–29, long-term
    expect(Number(s.account.allowance)).toBeCloseTo(
      Number(s.account.principalOutstanding) * 0.03,
      2,
    );
    expect(Number(l.account.allowance)).toBeCloseTo(
      Number(l.account.principalOutstanding) * 0.01,
      2,
    );
    expect(
      l.events.filter((e: any) => e.type === 'PROVISION').at(-1).components
        .explanation,
    ).toMatch(/long-term bands/);

    await moveTo('2026-02-28');
    const month = expectOk(
      await f.as('finance').get('/lending/ops/periods/2026/2'),
    );
    expect(
      month.checks.find((c: any) => c.code === 'REGULATORY_RESERVE'),
    ).toMatchObject({ status: 'WARN' });
    await close(2);
    const events = await reserveEvents();
    expect(events).toHaveLength(2);
    const release = events[1];
    expect(Number(release.amount)).toBeCloseTo(Number(events[0].amount), 2);
    const lines = release.journal.lines.map(
      (x: any) => `${x.accountCode}:${Number(x.debit)}:${Number(x.credit)}`,
    );
    expect(lines.sort()).toEqual(
      [
        `3100:0:${Number(release.amount)}`,
        `3200:${Number(release.amount)}:0`,
      ].sort(),
    );
    expect(await balance('3200')).toBe(0);

    const c = await generate(2);
    const cls = c.tables.find((t: any) => t.code === 'CLASSIFICATION');
    const at = (term: string, k: string) =>
      cls.rows.find(
        (r: any) => r.currency === 'USD' && r.term === term && r.class === k,
      );
    expect(at('Short-term', 'Special mention').loans).toBe(1);
    expect(at('Long-term', 'Standard').loans).toBe(1);
    expect(at('Long-term', 'Special mention').days).toBe('30–89');
    const reserve = c.tables.find((t: any) => t.code === 'REGULATORY_RESERVE');
    expect(reserve.notes.join(' ')).toMatch(/NOT CIFRS 9 compliant/);
    expect(reserve.rows[0].reserveHeld).toBe('0.00');
    expect(
      c.checks.find((x: any) => x.code === 'IMPAIRMENT_POLICY').passed,
    ).toBe(true);
  });

  it('Loss loans at the write-off floor are queued for write-off; the long-term loan is not Loss yet', async () => {
    // 5 February unpaid → 94 days past due on 10 May.
    for (const day of ['2026-03-31', '2026-04-30', '2026-05-10'])
      await moveTo(day);
    const s = await loan(shortLoan);
    const l = await loan(longLoan);
    expect(s.account.daysPastDue).toBe(94);
    expect(s.account.classification).toBe('LOSS'); // 91+, short-term
    expect(l.account.classification).toBe('SUBSTANDARD'); // 90–179, long-term
    const work = expectOk(await f.as('opsMaker').get('/me/work'));
    const q = work.queues.find((x: any) => x.code === 'AGED_LOSS');
    expect(q.count).toBe(1);
    expect(q.items[0].id).toBe(shortLoan);
    expect(q.href).toBe('/lending/recovery');
  });
});
