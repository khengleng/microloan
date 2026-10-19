/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Late charges and returned payments: grace days (UC-54), a percentage late
 * fee with a per-loan cap (UC-55), the returned-payment fee (UC-23) and a
 * payer other than the borrower (UC-20).
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Late charges and returned payments (integration)', () => {
  let f: Fixture;
  let late: string;
  let bounced: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-LATE',
      (c) => {
        c.pricing.fees = [];
        c.pricing.penalty = {
          type: 'PERCENT_PER_INSTALMENT',
          flatAmount: null,
          percentOfOverdue: '0.05',
          annualRate: null,
          graceDays: 3,
          capPerInstalment: null,
          capPerLoan: '30',
        };
        c.pricing.returnedPaymentFee = '5';
      },
    );
    const terms = {
      principal: '6000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    };
    late = (await originateAndDisburse(f, productId, terms)).loanId;
    bounced = (await originateAndDisburse(f, productId, terms)).loanId;
  }, 90_000);
  afterAll(async () => f?.app.close());

  const batch = async (businessDate: string) => {
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
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
  };

  it('UC-54: no late fee inside the grace days', async () => {
    await batch('2026-02-05');
    await batch('2026-02-08');
    const l = await loan(late);
    expect(l.account.daysPastDue).toBe(3);
    expect(l.account.penaltyReceivable).toBe('0');
  });

  it('UC-55: a percentage of the overdue instalment, charged once', async () => {
    await batch('2026-02-09');
    const l = await loan(late);
    const first = l.schedule.find((x: any) => x.number === 1);
    const overdue = Number(first.principalDue) + Number(first.interestDue);
    expect(Number(first.penaltyDue)).toBeCloseTo(
      Math.round(overdue * 0.05 * 100) / 100,
      2,
    );
    await batch('2026-02-20');
    expect(
      (await loan(late)).schedule.find((x: any) => x.number === 1).penaltyDue,
    ).toBe(first.penaltyDue);
  });

  it('UC-55: late fees never total more than the per-loan cap', async () => {
    await batch('2026-03-05');
    await batch('2026-03-09');
    const l = await loan(late);
    const total = l.schedule.reduce(
      (t: number, x: any) => t + Number(x.penaltyDue),
      0,
    );
    expect(total).toBeCloseTo(30, 2);
    await reconcile();
  });

  it('UC-20 and UC-23: a payment by a relative bounces; the returned-payment fee falls due', async () => {
    const before = await loan(bounced);
    const first = before.schedule.find((x: any) => x.number === 1);
    const ev = expectOk(
      await f.as('opsMaker').post(
        `/lending/loans/${bounced}/repayments`,
        {
          amount: (
            Number(first.principalDue) + Number(first.interestDue)
          ).toFixed(2),
          payer: {
            name: 'Sok Chenda',
            relationship: 'FAMILY',
            reference: 'CHQ-0091',
          },
        },
        key('pay'),
      ),
    );
    expect(ev.components.payer.relationship).toBe('FAMILY');
    expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${bounced}/events/${ev.id}/reverse`,
          { reason: 'Cheque returned unpaid', returned: true },
          key('rev'),
        ),
    );
    const after = await loan(bounced);
    const fee = after.events.find((e: any) => e.type === 'FEE');
    expect(fee.components.code).toBe('RETURNED_PAYMENT');
    expect(Number(after.schedule.find((x: any) => x.number === 1).feeDue)).toBe(
      5,
    );
    expect(Number(after.account.feesReceivable)).toBe(5);
    await reconcile();
  });
});
