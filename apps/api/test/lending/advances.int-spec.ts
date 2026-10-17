/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Money paid before it is due, and loans that stop accruing income:
 * UC-26, UC-27 (DECISIONS D-001) and UC-62 (D-002, D-006).
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Advances and non-accrual (integration)', () => {
  let f: Fixture;
  let productId: string;
  let early: string;
  let late: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    ({ productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-ADV',
      (c) => {
        c.repayment.allocation.excessHandling = 'ADVANCE';
        c.operations.nonAccrual = { enabled: true, fromDpd: 30, cureAtDpd: 0 };
      },
    ));
    const terms = {
      principal: '6000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    };
    early = (await originateAndDisburse(f, productId, terms)).loanId;
    late = (await originateAndDisburse(f, productId, terms)).loanId;
  }, 90_000);
  afterAll(async () => f?.app.close());

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const line = (l: any, n: number) =>
    l.schedule.find((x: any) => x.number === n && x.status !== 'SUPERSEDED');
  const instalment = (l: any, n: number) => {
    const x = line(l, n);
    return (Number(x.principalDue) + Number(x.interestDue)).toFixed(2);
  };
  const moveTo = async (businessDate: string) => {
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate }),
    );
    const run = expectOk(
      await f.as('finance').post('/lending/loans/batch/run'),
    );
    expect(run.failed).toEqual([]);
  };
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  const pay = (
    id: string,
    amount: string,
    extra: Record<string, unknown> = {},
  ) =>
    f
      .as('opsMaker')
      .post(
        `/lending/loans/${id}/repayments`,
        { amount, ...extra },
        key('adv'),
      );

  it('UC-26 UC-27: an instalment paid before its due date is held as an advance, not prepaid', async () => {
    await moveTo('2026-01-20');
    const before = await loan(early);
    const amount = instalment(before, 1);
    const ev = expectOk(await pay(early, amount));
    expect(ev.components.advance).toBe(amount);
    expect(ev.components.prepaidPrincipal).toBe('0');
    expect(ev.components.rescheduled).toBe(false);

    const after = await loan(early);
    expect(after.account.advanceBalance).toBe(amount);
    // Nothing was prepaid: principal and the schedule are unchanged.
    expect(after.account.principalOutstanding).toBe(
      before.account.principalOutstanding,
    );
    expect(line(after, 1).status).toBe('DUE');
    const lines = after.events.find((e: any) => e.id === ev.id).journal.lines;
    expect(
      lines.find((l: any) => l.accountCode === '2300' && Number(l.credit) > 0)
        .credit,
    ).toBe(amount);
    await reconcile();
  });

  it('UC-27: end of day applies the advance on the due date, so the borrower is never late', async () => {
    await moveTo('2026-02-05');
    const l = await loan(early);
    expect(line(l, 1).status).toBe('PAID');
    expect(l.account.advanceBalance).toBe('0');
    expect(l.account.daysPastDue).toBe(0);
    const applied = l.events.find((e: any) => e.type === 'ADVANCE_APPLIED');
    expect(applied).toBeDefined();
    expect(applied.amount).toBe(instalment(l, 1));

    await moveTo('2026-02-20');
    const later = await loan(early);
    expect(later.account.daysPastDue).toBe(0);
    expect(later.account.penaltyReceivable).toBe('0');
    await reconcile();
  });

  it('UC-26: an advance can never exceed what the loan owes', async () => {
    const res = await pay(early, '100000.00');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/early settlement/);
  });

  it('UC-26: the customer may choose prepayment instead where the product allows it', async () => {
    const before = await loan(early);
    const ev = expectOk(
      await pay(early, '500.00', {
        applyExcessAs: 'PREPAY',
        prepaymentStrategy: 'SHORTEN',
      }),
    );
    expect(ev.components.advance).toBe('0');
    expect(Number(ev.components.prepaidPrincipal)).toBeGreaterThan(0);
    const after = await loan(early);
    expect(Number(after.account.principalOutstanding)).toBeLessThan(
      Number(before.account.principalOutstanding),
    );
    await reconcile();
  });

  it('UC-31: the settlement quote nets off money held on advance', async () => {
    const q0 = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${early}/settlement-quote`),
    );
    expectOk(await pay(early, '200.00'));
    const q1 = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${early}/settlement-quote`),
    );
    expect(q1.advanceApplied).toBe('200');
    expect(Number(q1.payable)).toBeCloseTo(Number(q0.payable) - 200, 2);
  });

  it('UC-23: a repayment whose advance was applied reverses only after the application', async () => {
    // The 200.00 advance is applied on the next due date.
    await moveTo('2026-03-05');
    const l = await loan(early);
    const repayment = l.events
      .filter((e: any) => e.type === 'REPAYMENT' && e.status === 'POSTED')
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))[0];
    const application = l.events
      .filter((e: any) => e.type === 'ADVANCE_APPLIED')
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))[0];
    const reverse = (eventId: string) =>
      f
        .as('opsChecker')
        .post(
          `/lending/loans/${early}/events/${eventId}/reverse`,
          { reason: 'Payment bounced' },
          key('rev'),
        );
    expect((await reverse(repayment.id)).status).toBe(409);
    expectOk(await reverse(application.id));
    expect((await loan(early)).account.advanceBalance).toBe('200');
    expectOk(await reverse(repayment.id));
    const after = await loan(early);
    expect(after.account.advanceBalance).toBe('0');
    await reconcile();
  });

  it('UC-62: at the configured days past due, unpaid and future interest moves to suspense', async () => {
    // The second loan has paid nothing since 5 Feb: 30 days past due on 7 Mar.
    const before = await loan(late);
    expect(before.account.daysPastDue).toBe(28);
    expect(before.account.nonAccrual).toBe(false);
    await moveTo('2026-03-07');
    const on = await loan(late);
    expect(on.account.daysPastDue).toBe(30);
    expect(on.account.nonAccrual).toBe(true);
    expect(on.account.nonAccrualSince).toBe('2026-03-07');
    // Recognised-but-unpaid interest left income on entry.
    expect(on.account.interestInSuspense).toBe(on.account.interestReceivable);
    const entry = on.events.find((e: any) => e.type === 'NON_ACCRUAL');
    expect(entry.components.direction).toBe('ENTER');

    await moveTo('2026-03-20');
    const later = await loan(late);
    expect(Number(later.account.interestReceivable)).toBeGreaterThan(
      Number(on.account.interestReceivable),
    );
    // Interest keeps accruing as owed, but none of it is income.
    expect(later.account.interestInSuspense).toBe(
      later.account.interestReceivable,
    );
    const accrual = later.events
      .filter((e: any) => e.type === 'ACCRUAL')
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))[0];
    expect(accrual.components.suspended).toBe(true);
    await reconcile();
  });

  it('UC-62: paying the arrears releases collected interest, and the cure releases the rest', async () => {
    const l = await loan(late);
    const arrears = l.schedule
      .filter(
        (x: any) =>
          x.status === 'DUE' && x.number > 0 && x.dueDate <= '2026-03-20',
      )
      .reduce(
        (s: number, x: any) =>
          s +
          Number(x.principalDue) -
          Number(x.principalPaid) +
          Number(x.interestDue) -
          Number(x.interestPaid) +
          Number(x.penaltyDue) -
          Number(x.penaltyPaid) +
          Number(x.feeDue) -
          Number(x.feePaid),
        0,
      );
    const ev = expectOk(await pay(late, arrears.toFixed(2)));
    expect(Number(ev.components.suspenseReleased)).toBeCloseTo(
      Number(ev.components.interest),
      2,
    );
    await moveTo('2026-03-21');
    const cured = await loan(late);
    expect(cured.account.daysPastDue).toBe(0);
    expect(cured.account.nonAccrual).toBe(false);
    expect(cured.account.interestInSuspense).toBe('0');
    const cure = cured.events.find(
      (e: any) => e.type === 'NON_ACCRUAL' && e.components.direction === 'CURE',
    );
    expect(cure).toBeDefined();
    await reconcile();
  });
});
