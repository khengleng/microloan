/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Money received without a loan (UC-28) and refunds of money held for a
 * borrower (UC-74): always on the books, matched or returned under
 * maker-checker, and reconciled.
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Unidentified payments and refunds (integration)', () => {
  let f: Fixture;
  let loanId: string;
  let advanceLoan: string;
  let paymentId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-SUS',
      (c) => {
        c.repayment.allocation.excessHandling = 'ADVANCE';
      },
    );
    const terms = {
      principal: '3000',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    };
    loanId = (await originateAndDisburse(f, productId, terms)).loanId;
    advanceLoan = (await originateAndDisburse(f, productId, terms)).loanId;
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: '2026-02-05' }),
    );
    expectOk(await f.as('finance').post('/lending/loans/batch/run'));
  }, 90_000);
  afterAll(async () => f?.app.close());

  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));

  it('UC-28: an unidentified receipt is posted to suspense instead of being refused', async () => {
    const k = key('sus');
    const body = {
      amount: '700.00',
      currency: 'USD',
      channel: 'BANK_TRANSFER',
      externalReference: 'ABA-778812',
      payerName: 'S. Dara',
    };
    const p = expectOk(
      await f.as('opsMaker').post('/lending/suspense', body, k),
    );
    paymentId = p.id;
    expect(p.status).toBe('OPEN');
    // Idempotent: the same key and body return the original receipt event.
    const replay = expectOk(
      await f.as('opsMaker').post('/lending/suspense', body, k),
    );
    expect(replay.replayed).toBe(true);
    const list = expectOk(
      await f.as('opsMaker').get('/lending/suspense?status=OPEN'),
    );
    const row = list.payments.find((x: any) => x.id === paymentId);
    expect(row.remaining).toBe('700');
    expect(row.ageDays).toBe(0);
    expect(list.totals.remaining).toBe('700');
    await reconcile();
  });

  it('UC-28: matching applies the money to a loan as a repayment funded from suspense', async () => {
    const before = await loan(loanId);
    const first = before.schedule.find((l: any) => l.number === 1);
    const due = (
      Number(first.principalDue) + Number(first.interestDue)
    ).toFixed(2);
    const ev = expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/suspense/${paymentId}/matches`,
          { loanId, amount: due },
          key('m'),
        ),
    );
    expect(ev.type).toBe('REPAYMENT');
    const after = await loan(loanId);
    expect(after.schedule.find((l: any) => l.number === 1).status).toBe('PAID');
    const lines = after.events.find((e: any) => e.id === ev.id).journal.lines;
    // Funded from suspense, not from cash: the cash came in with the receipt.
    expect(lines.find((l: any) => Number(l.debit) > 0).accountCode).toBe(
      '2500',
    );
    const list = expectOk(await f.as('opsMaker').get('/lending/suspense'));
    const row = list.payments.find((x: any) => x.id === paymentId);
    expect(Number(row.remaining)).toBeCloseTo(700 - Number(due), 2);
    expect(row.matches).toHaveLength(1);
    await reconcile();
  });

  it('a match can never exceed what is still held, nor cross currencies', async () => {
    const res = await f
      .as('opsMaker')
      .post(
        `/lending/suspense/${paymentId}/matches`,
        { loanId, amount: '5000.00' },
        key('m'),
      );
    expect(res.status).toBe(400);
    const khr = expectOk(
      await f.as('opsMaker').post(
        '/lending/suspense',
        {
          amount: '100000',
          currency: 'KHR',
          channel: 'BRANCH_CASH',
          externalReference: 'CASH-KHR-1',
        },
        key('khr'),
      ),
    );
    const cross = await f
      .as('opsMaker')
      .post(
        `/lending/suspense/${khr.id}/matches`,
        { loanId, amount: '100000' },
        key('m'),
      );
    expect(cross.status).toBe(400);
  });

  it('UC-74: the rest is refunded to the payer under maker-checker', async () => {
    const list = expectOk(await f.as('opsMaker').get('/lending/suspense'));
    const left = list.payments.find((x: any) => x.id === paymentId).remaining;
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/suspense/${paymentId}/refunds`, {
        amount: left,
        reason: 'Payer had no loan with us',
      }),
    );
    // Any session sees the proposal waiting on the receipt.
    const waiting = expectOk(await f.as('opsChecker').get('/lending/suspense'));
    expect(
      waiting.payments.find((x: any) => x.id === paymentId).pendingRefund
        .taskId,
    ).toBe(task.id);
    // The proposer cannot approve their own refund.
    const own = await f
      .as('opsMaker')
      .post(
        `/lending/suspense/${paymentId}/refunds/${task.id}/decision`,
        { approve: true },
        key('r'),
      );
    expect(own.status).toBe(403);
    const ev = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/suspense/${paymentId}/refunds/${task.id}/decision`,
          { approve: true },
          key('r'),
        ),
    );
    expect(ev.type).toBe('SUSPENSE_REFUND');
    const after = expectOk(await f.as('opsMaker').get('/lending/suspense'));
    const row = after.payments.find((x: any) => x.id === paymentId);
    expect(row.remaining).toBe('0');
    expect(row.status).toBe('MATCHED');
    await reconcile();
  });

  it('UC-74: money held on advance for a borrower is refunded under maker-checker', async () => {
    // Pay today's instalment plus 50.00, which is held on advance.
    const first = (await loan(advanceLoan)).schedule.find(
      (l: any) => l.number === 1,
    );
    const due = Number(first.principalDue) + Number(first.interestDue);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${advanceLoan}/repayments`,
          { amount: (due + 50).toFixed(2), applyExcessAs: 'ADVANCE' },
          key('a'),
        ),
    );
    const before = await loan(advanceLoan);
    const held = Number(before.account.advanceBalance);
    expect(held).toBeGreaterThan(0);
    const tooMuch = await f
      .as('opsMaker')
      .post(`/lending/loans/${advanceLoan}/advance-refunds`, {
        amount: (held + 1).toFixed(2),
        reason: 'Customer asked',
      });
    expect(tooMuch.status).toBe(400);
    const task = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${advanceLoan}/advance-refunds`, {
          amount: held.toFixed(2),
          reason: 'Customer asked',
        }),
    );
    const ev = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${advanceLoan}/advance-refunds/${task.id}/decision`,
          { approve: true },
          key('ar'),
        ),
    );
    expect(ev.type).toBe('ADVANCE_REFUND');
    expect((await loan(advanceLoan)).account.advanceBalance).toBe('0');
    await reconcile();
  });
});
