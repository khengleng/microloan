/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Early payoff of a flat-rate loan under a Rule of 78 rebate (UC-33, TV-12)
 * through the live loan flow.
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  expectOk,
  key,
  raiseRateCap,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Flat-rate payoff rebates (integration)', () => {
  let f: Fixture;
  let loanId: string;
  let restoreCap: () => Promise<void>;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    // TV-12's 12% flat is 21.45% on a reducing balance: above the NBC cap.
    restoreCap = await raiseRateCap(f, '36');
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-FLAT78',
      (c) => {
        c.pricing.interestMethod = 'FLAT';
        c.pricing.regulatoryCapAnnualRate = null;
        c.pricing.fees = [];
        c.repayment.prepayment.allowed = false;
        c.repayment.earlySettlement.rebateMethod = 'RULE_OF_78';
      },
    );
    loanId = (
      await originateAndDisburse(f, productId, {
        principal: '10000',
        numberOfInstalments: 12,
        annualRate: '0.12',
        disbursementDate: '2026-01-05',
      })
    ).loanId;
  }, 90_000);
  afterAll(async () => {
    await restoreCap?.();
    await f?.app.close();
  });

  it('a flat product cannot be configured with a rebate on reducing-balance interest', async () => {
    const tpl = expectOk(
      await f.as('maker').get('/lending/templates/PERSONAL_INSTALMENT'),
    );
    const config = structuredClone(tpl.defaultConfig);
    config.repayment.earlySettlement.rebateMethod = 'RULE_OF_78';
    const res = await f.as('maker').post('/lending/products', {
      templateCode: 'PERSONAL_INSTALMENT',
      code: 'PL-BAD78',
      name: 'Bad',
      config,
    });
    expect(res.status).toBe(400);
  });

  it('TV-12: six instalments paid, six remaining → rebate 323.08 and the loan closes', async () => {
    // Pay the first six instalments on their due dates.
    let loan = expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`));
    const due = loan.schedule.filter((l: any) => l.number > 0);
    expect(
      due.reduce((s: number, l: any) => s + Number(l.interestDue), 0),
    ).toBeCloseTo(1200, 2);
    for (const l of due.slice(0, 6)) {
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate: l.dueDate }),
      );
      expectOk(
        await f.as('opsMaker').post(
          `/lending/loans/${loanId}/repayments`,
          {
            amount: (Number(l.principalDue) + Number(l.interestDue)).toFixed(2),
          },
          key('flat'),
        ),
      );
    }
    const q = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}/settlement-quote`),
    );
    expect(q.interestRebate.method).toBe('RULE_OF_78');
    expect(q.interestRebate.rebate).toBe('323.08');
    // Owed interest = 1,200.00 − 323.08 − 600.00 already paid.
    expect(Number(q.interest)).toBeCloseTo(276.92, 2);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/settlement`,
          { amount: q.payable },
          key('payoff'),
        ),
    );
    loan = expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`));
    expect(loan.account.status).toBe('CLOSED');
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  });
});
