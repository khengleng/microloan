/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Payoff letters: a quote good through a date, settled against (UC-31), and
 * a takeover quote addressed to the lender buying the loan out (UC-34).
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Payoff letters (integration)', () => {
  let f: Fixture;
  let productId: string;
  const loans: string[] = [];

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    ({ productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-PAYOFF',
      (c) => {
        c.pricing.fees = [];
      },
    ));
    for (let i = 0; i < 4; i++)
      loans.push(
        (
          await originateAndDisburse(f, productId, {
            principal: '5000',
            numberOfInstalments: 12,
            disbursementDate: '2026-01-05',
          })
        ).loanId,
      );
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
  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const issue = async (id: string, body: Record<string, unknown>) =>
    f.as('opsMaker').post(`/lending/loans/${id}/payoff-quotes`, body);
  const settle = (id: string, body: Record<string, unknown>, k: string) =>
    f.as('opsMaker').post(`/lending/loans/${id}/settlement`, body, key(k));

  it('UC-31: a letter lists the payoff for each day it is good through', async () => {
    await moveTo('2026-01-20');
    const q = expectOk(
      await issue(loans[0], { purpose: 'BORROWER', validDays: 5 }),
    );
    expect(q.goodThrough).toHaveLength(6);
    expect(q.goodThrough[0].date).toBe('2026-01-20');
    expect(q.expiresOn).toBe('2026-01-25');
    expect(Number(q.goodThrough[5].payable)).toBeGreaterThan(
      Number(q.goodThrough[0].payable),
    );
    expect(Number(q.perDiem)).toBeGreaterThan(0);
    const letter = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${loans[0]}/payoff-quotes/${q.id}/letter`),
    );
    expect(letter.letter).toContain(q.reference);
    expect(letter.letter).toContain(q.goodThrough[0].payable);

    expectOk(
      await settle(
        loans[0],
        { amount: q.goodThrough[0].payable, payoffQuoteId: q.id },
        'pq1',
      ),
    );
    expect((await loan(loans[0])).account.status).toBe('CLOSED');
    const list = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans[0]}/payoff-quotes`),
    );
    expect(list[0].status).toBe('USED');
    expect(list[0].settlementEventId).toBeTruthy();
  });

  it('UC-34: a takeover quote names the acquiring lender and is settled with its funds', async () => {
    const bad = await issue(loans[1], { purpose: 'TAKEOVER' });
    expect(bad.status).toBe(400);
    const q = expectOk(
      await issue(loans[1], {
        purpose: 'TAKEOVER',
        validDays: 7,
        recipientName: 'Acquiring Bank Plc',
        recipientReference: 'TO-2026-88',
      }),
    );
    const letter = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${loans[1]}/payoff-quotes/${q.id}/letter`),
    );
    expect(letter.letter).toContain('Acquiring Bank Plc');
    await moveTo('2026-01-22');
    const day = q.goodThrough.find((g: any) => g.date === '2026-01-22');
    expectOk(
      await settle(
        loans[1],
        {
          amount: day.payable,
          payoffQuoteId: q.id,
          externalReference: 'Acquiring Bank wire 5512',
        },
        'pq2',
      ),
    );
    expect((await loan(loans[1])).account.status).toBe('CLOSED');
  });

  it('a letter is refused once the balance has changed, or after it expires', async () => {
    const q = expectOk(
      await issue(loans[2], { purpose: 'BORROWER', validDays: 3 }),
    );
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loans[2]}/repayments`,
          { amount: '100.00' },
          key('part'),
        ),
    );
    const now = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans[2]}/settlement-quote`),
    ).payable;
    const stale = await settle(
      loans[2],
      { amount: now, payoffQuoteId: q.id },
      'pq3',
    );
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe('PAYOFF_QUOTE_STALE');

    const q2 = expectOk(
      await issue(loans[3], { purpose: 'BORROWER', validDays: 1 }),
    );
    await moveTo('2026-01-30');
    const late = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans[3]}/settlement-quote`),
    ).payable;
    const expired = await settle(
      loans[3],
      { amount: late, payoffQuoteId: q2.id },
      'pq4',
    );
    expect(expired.body.code).toBe('PAYOFF_QUOTE_EXPIRED');
    const list = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans[3]}/payoff-quotes`),
    );
    expect(list[0].status).toBe('EXPIRED');
    // Without the letter the current amount still settles.
    expectOk(await settle(loans[3], { amount: late }, 'pq5'));
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
  });
});
