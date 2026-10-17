/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Credit cards (LT-07) end to end over the real HTTP API, guards and
 * database: a card booked on a revolving line, purchases and cash advances as
 * separate balances, monthly statements with a due date and a minimum
 * payment, the purchase grace period (UC-39), the cash-advance fee and
 * day-one interest (UC-40), an instalment plan (UC-44), minimum-payment
 * arrears, and closure — with the GL reconciling throughout.
 */
import {
  Fixture,
  TEST_DB,
  borrower,
  bootstrap,
  expectOk,
  key,
} from './harness';
import { activeProduct, docs, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Credit cards (integration)', () => {
  let f: Fixture;
  let productId: string;
  let cardId: string;
  let facilityId: string;
  let loanId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    ({ productId } = await activeProduct(f, 'CREDIT_CARD', 'CARD-CLASSIC'));
  }, 90_000);
  afterAll(async () => f?.app.close());

  async function setBusinessDate(target: string) {
    let current = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    while (lending.compareDates(current, target) < 0) {
      const step = lending.addDays(current, 31);
      const next = lending.compareDates(step, target) > 0 ? target : step;
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate: next }),
      );
      expectOk(await f.as('finance').post('/lending/loans/batch/run'));
      current = next;
    }
  }

  const card = async () =>
    expectOk(await f.as('opsMaker').get(`/lending/cards/${cardId}`));
  const loan = async () =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`));
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  const journal = (event: any) =>
    event.journal.lines
      .map(
        (l: any) => `${l.accountCode}:${Number(l.debit)}:${Number(l.credit)}`,
      )
      .sort();
  const post = (path: string, body: unknown, tag = 'card') =>
    f.as('opsMaker').post(`/lending/cards/${cardId}${path}`, body, key(tag));

  it('LT-07: booking a card product issues a card on a revolving line', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId,
        terms: {
          principal: '5000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
          annualRate: '0.15',
        },
      }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Within policy',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approved within authority',
      }),
    );
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
    expect(booked.card).toBeTruthy();
    cardId = booked.card.id;
    facilityId = booked.facility.id;
    loanId = booked.account.id;
    const c = await card();
    expect(c.card.status).toBe('ACTIVE');
    expect(c.card.maskedNumber).toMatch(/^•••• \d{4}$/);
    expect(c.position.available).toBe('5000');
    expect(c.terms.purchaseAnnualRate).toBe('0.15');
    expect(c.terms.cashAdvanceAnnualRate).toBe('0.18');
  });

  it('card money cannot be moved through the generic facility endpoints', async () => {
    const r = await f
      .as('opsMaker')
      .post(
        `/lending/facilities/${facilityId}/statements`,
        { periodEnd: '2026-01-05' },
        key('fac'),
      );
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CARD_FACILITY');
  });

  it('a purchase raises the purchase balance and posts a balanced journal', async () => {
    await setBusinessDate('2026-01-10');
    const k = key('purchase');
    const body = { amount: '1000', merchantName: 'Lucky Supermarket' };
    const r = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/cards/${cardId}/purchases`, body, k),
    );
    expect(r.fee).toBe('0');
    // A retry with the same key replays instead of charging twice.
    const replay = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/cards/${cardId}/purchases`, body, k),
    );
    expect(replay.replayed).toBe(true);
    const c = await card();
    expect(c.position.purchaseBalance).toBe('1000');
    expect(c.position.available).toBe('4000');
    const l = await loan();
    expect(l.account.status).toBe('ACTIVE');
    expect(l.account.principalOutstanding).toBe('1000');
    const ev = l.events.find((e: any) => e.type === 'DISBURSEMENT');
    expect(journal(ev)).toEqual(['1000:0:1000', '1200:1000:0']);
    await reconcile();
  });

  it('UC-40: a cash advance charges its fee at once, on its own income account', async () => {
    await setBusinessDate('2026-01-20');
    const r = expectOk(
      await post('/cash-advances', {
        amount: '200',
        externalReference: 'ATM-0042',
      }),
    );
    // 3% of 200 = 6, above the 5 minimum.
    expect(r.fee).toBe('6');
    const c = await card();
    expect(c.position.cashBalance).toBe('200');
    expect(c.position.feesOwed).toBe('6');
    const l = await loan();
    const ev = l.events.find((e: any) => e.id === r.eventId);
    expect(journal(ev)).toEqual([
      '1000:0:200',
      '1200:200:0',
      '1220:6:0',
      '4520:0:6',
    ]);
    await reconcile();
  });

  it('refuses spending beyond the limit and cash beyond the cash-advance share', async () => {
    const over = await post('/purchases', {
      amount: '4000',
      merchantName: 'Big Electronics',
    });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('CARD_LIMIT_EXCEEDED');
    // 30% of 5,000 = 1,500 of cash; 200 is already out.
    const cash = await post('/cash-advances', {
      amount: '1400',
      externalReference: 'ATM-0043',
    });
    expect(cash.status).toBe(400);
    expect(cash.body.code).toBe('CASH_ADVANCE_LIMIT_EXCEEDED');
  });

  it('UC-44: a large purchase converts into fixed monthly instalments', async () => {
    await setBusinessDate('2026-01-25');
    const p = expectOk(
      await post('/purchases', { amount: '600', merchantName: 'Phone Shop' }),
    );
    const small = expectOk(
      await post('/purchases', { amount: '50', merchantName: 'Cafe' }),
    );
    const tooSmall = await f
      .as('opsMaker')
      .post(
        `/lending/cards/${cardId}/transactions/${small.transaction.id}/instalment-plan`,
        { months: 6 },
      );
    expect(tooSmall.status).toBe(400);
    const badTerm = await f
      .as('opsMaker')
      .post(
        `/lending/cards/${cardId}/transactions/${p.transaction.id}/instalment-plan`,
        { months: 5 },
      );
    expect(badTerm.status).toBe(400);
    const plan = expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/cards/${cardId}/transactions/${p.transaction.id}/instalment-plan`,
          { months: 6 },
        ),
    );
    // 600 at 12% a year (1% a month) over 6 months.
    expect(plan.plan.instalmentAmount).toBe('103.53');
    const again = await f
      .as('opsMaker')
      .post(
        `/lending/cards/${cardId}/transactions/${p.transaction.id}/instalment-plan`,
        { months: 6 },
      );
    expect(again.status).toBe(409);
    // The cafe purchase is repaid now so the purchase balance stays simple.
    expectOk(await post('/payments', { amount: '50' }));
    const c = await card();
    // The 50 paid off the fee (6) and interest first, then cash: allocation
    // order is charges, cash, purchases, plan.
    expect(c.position.purchaseBalance).toBe('1050');
    expect(c.position.planBalance).toBe('600');
    await reconcile();
  });

  it('UC-39 + UC-40: the first statement waives purchase interest but charges cash-advance interest from day one', async () => {
    await setBusinessDate('2026-02-05');
    const r = expectOk(await post('/statements', { periodEnd: '2026-02-05' }));
    const s = r.statement;
    expect(s.graceApplied).toBe(true);
    expect(s.purchaseInterest).toBe('0');
    // 1,000 from 10 Jan for 26 days at 15% (10.68) plus the cafe's 50 from
    // 25 Jan for 11 days (0.23) — computed, then waived.
    expect(s.purchaseInterestWaived).toBe('10.91');
    // The cash advance accrued from the day it was taken, at 18%: 200 for 5
    // days, then 156 for 11 days once the 50 payment of 25 Jan had cleared
    // the 6 fee and 44 of cash.
    expect(s.cashInterest).toBe('1.34');
    // First plan instalment billed: 6.00 interest, 97.53 principal.
    expect(s.planInterest).toBe('6');
    expect(s.planPrincipalBilled).toBe('97.53');
    expect(s.dueDate).toBe('2026-02-26');
    expect(Number(s.minimumPayment)).toBeGreaterThan(97.53);
    expect(Number(s.minimumPayment)).toBeLessThan(Number(s.statementBalance));
    const c = await card();
    expect(c.position.planBalance).toBe('502.47');
    const l = await loan();
    const accrual = l.events.filter((e: any) => e.type === 'ACCRUAL').at(-1);
    expect(journal(accrual)).toEqual(
      [
        `1210:${Number(s.cashInterest) + 6}:0`,
        `4000:0:${Number(s.cashInterest) + 6}`,
      ].sort(),
    );
    // A second statement for the same period is refused.
    const dup = await post('/statements', { periodEnd: '2026-02-05' });
    expect(dup.status).toBe(409);
    await reconcile();
  });

  it('UC-39: paying the statement in full by the due date keeps the grace period', async () => {
    await setBusinessDate('2026-02-20');
    const c = await card();
    const toPay = c.position.lastStatement.toPayInFull;
    expectOk(await post('/payments', { amount: toPay }));
    const after = await card();
    expect(after.position.lastStatement.toPayInFull).toBe('0');
    expect(after.position.purchaseBalance).toBe('0');
    expect(after.position.cashBalance).toBe('0');
    // The plan is not on the statement; it keeps its own schedule.
    expect(after.position.planBalance).toBe('502.47');

    await setBusinessDate('2026-02-22');
    expectOk(
      await post('/purchases', { amount: '300', merchantName: 'Bookshop' }),
    );
    // The next statement cannot close before the previous one is due.
    const early = await post('/statements', { periodEnd: '2026-02-22' });
    expect(early.status).toBe(409);

    await setBusinessDate('2026-03-05');
    const s = expectOk(
      await post('/statements', { periodEnd: '2026-03-05' }),
    ).statement;
    expect(s.graceApplied).toBe(true);
    expect(s.purchaseInterest).toBe('0');
    expect(Number(s.purchaseInterestWaived)).toBeGreaterThan(0);
    // Cash advanced at 18% kept accruing until the payment on 20 Feb.
    expect(Number(s.cashInterest)).toBeGreaterThan(0);
    await reconcile();
  });

  it('UC-39: paying only the minimum loses the grace period on the next statement', async () => {
    await setBusinessDate('2026-03-20');
    const c = await card();
    expectOk(
      await post('/payments', {
        amount: c.position.lastStatement.minimumPayment,
      }),
    );
    await setBusinessDate('2026-04-05');
    const s = expectOk(
      await post('/statements', { periodEnd: '2026-04-05' }),
    ).statement;
    expect(s.graceApplied).toBe(false);
    expect(s.purchaseInterestWaived).toBe('0');
    expect(Number(s.purchaseInterest)).toBeGreaterThan(0);
    await reconcile();
  });

  it('an unpaid minimum payment ages into arrears and a payment cures them', async () => {
    const c = await card();
    const due = c.position.lastStatement.dueDate;
    expect(due).toBe('2026-04-26');
    await setBusinessDate('2026-05-01');
    expect((await loan()).account.daysPastDue).toBe(5);
    expect((await card()).position.daysPastDue).toBe(5);
    expectOk(
      await post('/payments', {
        amount: c.position.lastStatement.minimumPayment,
      }),
    );
    expectOk(await f.as('finance').post('/lending/loans/batch/run'));
    expect((await loan()).account.daysPastDue).toBe(0);
  });

  it('a payment of everything owed prepays the plan, and the card closes', async () => {
    const before = await card();
    const over = await post('/payments', {
      amount: String(Number(before.position.totalOwed) + 1),
    });
    expect(over.status).toBe(400);
    expectOk(await post('/payments', { amount: before.position.totalOwed }));
    const c = await card();
    expect(c.position.totalOwed).toBe('0');
    expect(c.plans[0].status).toBe('COMPLETED');
    await reconcile();
    const closed = expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/cards/${cardId}/close`, { reason: 'Customer request' }),
    );
    expect(closed.status).toBe('CLOSED');
    expect((await card()).card.status).toBe('CLOSED');
    expect((await loan()).account.status).toBe('CLOSED');
    const used = await post('/purchases', {
      amount: '10',
      merchantName: 'Cafe',
    });
    expect(used.status).toBe(403);
    await reconcile();
  });

  it('cards are listed within the caller scope', async () => {
    const list = expectOk(await f.as('opsMaker').get('/lending/cards'));
    expect(list.data.map((c: any) => c.id)).toContain(cardId);
  });
});
