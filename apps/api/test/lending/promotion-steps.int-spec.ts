/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * A promotional rate for the first instalments (UC-46) and stepped
 * instalments (UC-15), serviced from disbursement to closure.
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  key,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Promotional rates and stepped instalments (integration)', () => {
  let f: Fixture;
  let promoProduct: string;
  let stepProduct: string;
  let promoLoan: string;
  let stepLoan: string;
  const terms = {
    principal: '6000',
    numberOfInstalments: 6,
    disbursementDate: '2026-01-05',
    annualRate: '0.18',
  };

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    ({ productId: promoProduct } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-PROMO',
      (c) => {
        c.pricing.fees = [];
        c.limits.minInstalments = 6;
        c.pricing.promotion = {
          code: 'NEWYEAR',
          annualRate: '0',
          instalments: 2,
          label: 'Two months interest-free',
        };
      },
    ));
    ({ productId: stepProduct } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-STEP',
      (c) => {
        c.pricing.fees = [];
        c.limits.minInstalments = 6;
        c.repayment.instalmentSteps = [{ instalments: 3, multiplier: '0.5' }];
      },
    ));
  }, 90_000);
  afterAll(async () => f?.app.close());

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const live = (l: any) =>
    l.schedule
      .filter((x: any) => x.status !== 'SUPERSEDED')
      .sort((a: any, b: any) => a.number - b.number);

  it('UC-46: an unknown campaign code is refused', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const res = await f.as('ro').post('/lending/applications', {
      borrowerId: b.id,
      productId: promoProduct,
      terms: { ...terms, promotionCode: 'NOPE' },
    });
    expect(res.status).toBe(400);
  });

  it('UC-46: the promotional rate covers the first two instalments, then the contract rate', async () => {
    promoLoan = (
      await originateAndDisburse(f, promoProduct, {
        ...terms,
        promotionCode: 'NEWYEAR',
      })
    ).loanId;
    const lines = live(await loan(promoLoan));
    expect(lines.slice(0, 2).map((x: any) => x.interestDue)).toEqual([
      '0',
      '0',
    ]);
    expect(lines.slice(0, 2).map((x: any) => x.annualRate)).toEqual(['0', '0']);
    expect(lines[2].annualRate).toBe('0.18');
    expect(Number(lines[2].interestDue)).toBeGreaterThan(0);
  });

  it('UC-15: three half-size instalments, then three full ones', async () => {
    stepLoan = (await originateAndDisburse(f, stepProduct, terms)).loanId;
    const t = live(await loan(stepLoan)).map(
      (x: any) => Number(x.principalDue) + Number(x.interestDue),
    );
    expect(t[0]).toBe(t[1]);
    expect(Math.abs(t[3] - 2 * t[0])).toBeLessThanOrEqual(0.02);
  });

  it('both loans are serviced to closure on their due dates, with no interest accrued during the promotion', async () => {
    const dates = [
      '2026-01-20',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
      '2026-07-05',
    ];
    for (const date of dates) {
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate: date }),
      );
      expect(
        expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
      ).toEqual([]);
      if (date === '2026-02-05') {
        const p = await loan(promoLoan);
        expect(p.account.interestReceivable).toBe('0');
      }
      for (const id of [promoLoan, stepLoan]) {
        const l = await loan(id);
        if (l.account.status === 'CLOSED') continue;
        const due = live(l).filter(
          (x: any) => x.status === 'DUE' && x.dueDate <= date,
        );
        for (const line of due) {
          const amount = (
            Number(line.principalDue) +
            Number(line.interestDue) -
            Number(line.principalPaid) -
            Number(line.interestPaid)
          ).toFixed(2);
          if (Number(amount) > 0)
            expectOk(
              await f
                .as('opsMaker')
                .post(
                  `/lending/loans/${id}/repayments`,
                  { amount },
                  key(`pay-${id}-${line.number}`),
                ),
            );
        }
      }
    }
    for (const id of [promoLoan, stepLoan]) {
      const l = await loan(id);
      expect(l.account.status).toBe('CLOSED');
      expect(l.account.principalOutstanding).toBe('0');
    }
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  });
});
