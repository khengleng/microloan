/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * UC-23: a prepayment that rescheduled the loan can be reversed (it bounced,
 * or was posted to the wrong loan): the instalments it replaced come back
 * under a new agreement version and the balances return to what they were.
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Reversing a rescheduling prepayment (integration)', () => {
  let f: Fixture;
  let id: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-PREPAY-REV',
      (c) => {
        c.pricing.fees = [];
        c.pricing.returnedPaymentFee = '5';
      },
    );
    id = (
      await originateAndDisburse(f, productId, {
        principal: '6000',
        numberOfInstalments: 6,
        disbursementDate: '2026-01-05',
      })
    ).loanId;
  }, 90_000);
  afterAll(async () => f?.app.close());

  const loan = async () =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const live = (l: any) =>
    l.schedule
      .filter((x: any) => ['DUE', 'PAID'].includes(x.status))
      .sort((a: any, b: any) => a.number - b.number);
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
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };

  it('restores the replaced instalments, the instalment amount and maturity, and charges the returned-payment fee', async () => {
    await moveTo('2026-01-20');
    const before = await loan();
    const beforeLines = live(before).map((x: any) => [
      x.number,
      x.dueDate,
      x.principalDue,
      x.interestDue,
    ]);
    const ev = expectOk(
      await f.as('opsMaker').post(
        `/lending/loans/${id}/repayments`,
        {
          amount: '1500.00',
          applyExcessAs: 'PREPAY',
          prepaymentStrategy: 'RECAST',
        },
        key('pp'),
      ),
    );
    expect(ev.components.rescheduled).toBe(true);
    const mid = await loan();
    expect(mid.account.instalmentAmount).not.toBe(
      before.account.instalmentAmount,
    );

    const rev = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${id}/events/${ev.id}/reverse`,
          { reason: 'Cheque bounced', returned: true },
          key('rv'),
        ),
    );
    expect(rev.type).toBe('REVERSAL');
    const after = await loan();
    expect(after.account.principalOutstanding).toBe(
      before.account.principalOutstanding,
    );
    expect(after.account.instalmentAmount).toBe(
      before.account.instalmentAmount,
    );
    expect(after.account.maturityDate).toBe(before.account.maturityDate);
    const afterLines = live(after);
    expect(
      afterLines.map((x: any) => [
        x.number,
        x.dueDate,
        x.principalDue,
        x.interestDue,
      ]),
    ).toEqual(beforeLines);
    // The fee for the returned payment is due with the first open instalment.
    expect(afterLines[0].feeDue).toBe('5');
    expect(
      after.agreementVersions.some(
        (v: any) => v.reason === 'PREPAYMENT_REVERSED',
      ),
    ).toBe(true);
    await reconcile();
  });

  it('the loan then services normally to its due date', async () => {
    await moveTo('2026-02-05');
    const l = await loan();
    const first = live(l)[0];
    const owed = (
      Number(first.principalDue) +
      Number(first.interestDue) +
      Number(first.feeDue)
    ).toFixed(2);
    expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${id}/repayments`, { amount: owed }, key('i1')),
    );
    expect((await loan()).account.daysPastDue).toBe(0);
    await reconcile();
  });
});
