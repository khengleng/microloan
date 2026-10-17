/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Waiving an early repayment fee under maker-checker (UC-32): the next
 * settlement or prepayment of that kind is charged no fee, once.
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Fee waivers (integration)', () => {
  let f: Fixture;
  let settleLoan: string;
  let prepayLoan: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-WAIVE',
      (c) => {
        c.pricing.fees = [];
        c.repayment.earlySettlement.feeRate = '0.02';
        c.repayment.prepayment.feeRate = '0.01';
        c.repayment.allocation.excessHandling = 'PREPAY';
      },
    );
    const terms = {
      principal: '5000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    };
    settleLoan = (await originateAndDisburse(f, productId, terms)).loanId;
    prepayLoan = (await originateAndDisburse(f, productId, terms)).loanId;
  }, 90_000);
  afterAll(async () => f?.app.close());

  const waive = async (loanId: string, kind: string) => {
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/fee-waivers`, {
        kind,
        reason: 'Customer complaint resolved in their favour',
      }),
    );
    const own = await f
      .as('opsMaker')
      .post(`/lending/loans/${loanId}/fee-waivers/${task.id}/decision`, {
        approve: true,
      });
    expect(own.status).toBe(403);
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/loans/${loanId}/fee-waivers/${task.id}/decision`, {
          approve: true,
        }),
    );
    return task.id as string;
  };

  it('UC-32: an approved waiver removes the settlement fee, once', async () => {
    const before = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${settleLoan}/settlement-quote`),
    );
    expect(Number(before.settlementFee)).toBeGreaterThan(0);
    const taskId = await waive(settleLoan, 'EARLY_SETTLEMENT');
    const q = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${settleLoan}/settlement-quote`),
    );
    expect(q.settlementFee).toBe('0');
    expect(q.settlementFeeExplanation).toMatch(/Waived/);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${settleLoan}/settlement`,
          { amount: q.payable },
          key('ws'),
        ),
    );
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${settleLoan}`),
    );
    expect(loan.account.status).toBe('CLOSED');
    expect(loan.tasks.find((t: any) => t.id === taskId).status).toBe(
      'EXECUTED',
    );
  });

  it('UC-32: an approved waiver removes the prepayment fee, and only for one prepayment', async () => {
    await waive(prepayLoan, 'PARTIAL_PREPAYMENT');
    const first = expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${prepayLoan}/repayments`,
          { amount: '500.00' },
          key('wp'),
        ),
    );
    expect(first.components.prepaymentFee).toBe('0');
    expect(first.components.prepaidPrincipal).toBe('500');
    const second = expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${prepayLoan}/repayments`,
          { amount: '505.00' },
          key('wp'),
        ),
    );
    expect(second.components.prepaymentFee).toBe('5');
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
  });

  it('a second waiver of the same fee cannot be stacked while one is open', async () => {
    const t = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${prepayLoan}/fee-waivers`, {
        kind: 'EARLY_SETTLEMENT',
        reason: 'Goodwill',
      }),
    );
    expect(t.status).toBe('PENDING');
    const again = await f
      .as('opsMaker')
      .post(`/lending/loans/${prepayLoan}/fee-waivers`, {
        kind: 'EARLY_SETTLEMENT',
        reason: 'Goodwill again',
      });
    expect(again.status).toBe(409);
  });
});
