/* eslint-disable @typescript-eslint/no-unsafe-call -- end-to-end fixtures: API responses are untyped. */
/**
 * Consumer journeys, onboarding to closure (docs/servicing/SCENARIOS.md):
 *
 *  S01 LT-01 personal loan paid on time to maturity (TV-01, UC-01/03/08/17/72)
 *  S02 LT-08 salary advance, single payment at payday (RM-6)
 *  S03 LT-10 debt consolidation that refinances an existing loan (UC-34/50)
 *  S04 LT-06 student loan: grace, simple capitalization, repayment (TV-16, UC-14)
 *  S34 LT-01 personal loan with a broken first period (TV-09, UC-07)
 */
import { TEST_DB } from '../harness';
import { Journey, c2, expectOk, sum } from './journey';

const d = TEST_DB ? describe : describe.skip;

d('S01 LT-01 personal loan paid on time to maturity (TV-01)', () => {
  let j: Journey;
  let productId: string;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    productId = await j.product('PERSONAL_INSTALMENT', 'PL-E2E');
  }, 120_000);
  afterAll(async () => j?.close());

  it('onboarding: KYC must be verified before the application can be submitted', async () => {
    const borrowerId = await j.onboard({}, false);
    const app = expectOk(
      await j.as('ro').post('/lending/applications', {
        borrowerId,
        productId,
        terms: {
          principal: '10000',
          numberOfInstalments: 12,
          annualRate: '0.12',
          disbursementDate: '2026-01-05',
        },
      }),
    );
    await j.uploadDocs(app.id, ['ID_DOCUMENT']);
    const blocked = await j
      .as('ro')
      .post(`/lending/applications/${app.id}/submit`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe('SUBMISSION_BLOCKED');
    expect(blocked.body.issues.map((i: any) => i.code)).toContain('KYC');
    await j.verifyKyc(borrowerId);
    expectOk(await j.as('ro').post(`/lending/applications/${app.id}/submit`));
  });

  it('originates, books and disburses 10,000 at 12% over 12 months, net of the 1% fee (UC-01, UC-03)', async () => {
    const r = await j.originate(productId, {
      principal: '10000',
      numberOfInstalments: 12,
      annualRate: '0.12',
      disbursementDate: '2026-01-05',
    });
    loanId = r.loanId;
    const l = await j.checkpoint(
      loanId,
      { status: 'ACTIVE', principal: 10000, interest: 0, fees: 0, dpd: 0 },
      'loan.disbursement.execute',
    );
    const disb = l.events.find((e: any) => e.type === 'DISBURSEMENT');
    // 10,000 lent, 9,900 paid out, 100 processing fee earned.
    expect(Journey.journal(l, disb.id)).toEqual([
      '1000:0.00:9900.00',
      '1200:10000.00:0.00',
      '4200:0.00:100.00',
    ]);
    for (const a of [
      'loan.agreement.book',
      'loan.disbursement.prepare',
      'loan.disbursement.approve',
    ])
      await j.audited(loanId, a);
  });

  it('TV-01: the booked schedule matches every published figure', async () => {
    const l = await j.loan(loanId);
    const lines = Journey.due(l);
    expect(l.account.instalmentAmount).toBe('888.49');
    const row = (n: number) => lines.find((x: any) => x.number === n);
    expect([c2(row(1).interestDue), c2(row(1).principalDue)]).toEqual([
      '100.00',
      '788.49',
    ]);
    expect(c2(row(2).openingPrincipal)).toBe('9211.51');
    expect([c2(row(2).interestDue), c2(row(2).principalDue)]).toEqual([
      '92.12',
      '796.37',
    ]);
    expect(c2(row(3).openingPrincipal)).toBe('8415.14');
    expect([c2(row(11).interestDue), c2(row(11).principalDue)]).toEqual([
      '17.51',
      '870.98',
    ]);
    expect(c2(row(12).openingPrincipal)).toBe('879.67');
    expect([c2(row(12).interestDue), c2(row(12).principalDue)]).toEqual([
      '8.80',
      '879.67',
    ]);
    expect(c2(Number(row(12).interestDue) + Number(row(12).principalDue))).toBe(
      '888.47',
    );
    expect(c2(sum(lines.map((x: any) => x.interestDue)))).toBe('661.86');
  });

  it('accrues interest day by day between due dates (OPS-4)', async () => {
    await j.moveTo('2026-01-20');
    // Periodic accrual: 15 of the period's 31 days of the 100.00 instalment interest.
    await j.checkpoint(loanId, { interest: '48.39', principal: 10000, dpd: 0 });
  });

  it('every instalment paid on its due date at branch; the last one closes the loan (UC-08, UC-17, UC-72)', async () => {
    const l = await j.payOnTime(loanId);
    await j.checkpoint(loanId, {
      status: 'CLOSED',
      principal: 0,
      interest: 0,
      fees: 0,
      penalty: 0,
      advance: 0,
      dpd: 0,
    });
    expect(Journey.due(l).every((x: any) => x.status === 'PAID')).toBe(true);
    // Interest income recognised over the life equals the schedule's 661.86.
    const income = l.events
      .filter((e: any) => e.type === 'ACCRUAL')
      .reduce((t: number, e: any) => t + Number(e.amount), 0);
    expect(c2(income)).toBe('661.86');
    const repaid = l.events
      .filter((e: any) => e.type === 'REPAYMENT' && e.status === 'POSTED')
      .reduce((t: number, e: any) => t + Number(e.amount), 0);
    expect(c2(repaid)).toBe('10661.86');
    expect(l.account.closedAt).toBeTruthy();
  });

  it('a closed loan takes no more money and drops out of end of day', async () => {
    const res = await j.pay(loanId, '10.00');
    expect(res.status).toBeGreaterThanOrEqual(400);
    await j.moveTo('2027-02-05');
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
  });
});

d('S02 LT-08 salary advance repaid in one payment on payday (RM-6)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('SALARY_ADVANCE', 'SAL-ADV');
    loanId = (
      await j.originate(
        productId,
        {
          principal: '500',
          numberOfInstalments: 1,
          disbursementDate: '2026-01-05',
        },
        { borrower: { occupation: 'Garment worker', monthlyIncome: 1500 } },
      )
    ).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('books one bullet instalment: 500 principal plus one month at 15% = 6.25', async () => {
    const l = await j.checkpoint(loanId, { status: 'ACTIVE', principal: 500 });
    const lines = Journey.due(l);
    expect(lines).toHaveLength(1);
    expect([c2(lines[0].principalDue), c2(lines[0].interestDue)]).toEqual([
      '500.00',
      '6.25',
    ]);
    expect(lines[0].dueDate).toBe('2026-02-05');
  });

  it('refuses an early part-payment: the product does not allow prepayment', async () => {
    await j.moveTo('2026-01-20');
    const res = await j.pay(loanId, '200.00');
    // Nothing is due yet and the excess cannot be prepaid.
    expect(res.status).toBe(400);
    await j.checkpoint(loanId, { principal: 500 });
  });

  it('payday: 506.25 is paid and the advance closes', async () => {
    await j.moveTo('2026-02-05');
    await j.checkpoint(loanId, { interest: '6.25', dpd: 0 });
    expectOk(await j.pay(loanId, '506.25'));
    await j.checkpoint(
      loanId,
      { status: 'CLOSED', principal: 0, interest: 0 },
      'loan.repayment.post',
    );
  });
});

d(
  'S03 LT-10 debt consolidation refinancing an existing loan (UC-34, UC-50)',
  () => {
    let j: Journey;
    let productId: string;
    let first: { loanId: string; borrowerId: string };
    let second: string;

    beforeAll(async () => {
      j = await Journey.start();
      productId = await j.product('DEBT_CONSOLIDATION', 'CONSOL', (c) => {
        c.pricing.fees = [];
        c.restructuring.allowRefinance = true;
        c.restructuring.refinanceMinInstalmentsPaid = 2;
      });
      const r = await j.originate(productId, {
        principal: '3000',
        numberOfInstalments: 12,
        annualRate: '0.15',
        disbursementDate: '2026-01-05',
      });
      first = { loanId: r.loanId, borrowerId: r.borrowerId };
    }, 120_000);
    afterAll(async () => j?.close());

    it('the first loan is serviced on time for two months', async () => {
      await j.payOnTime(first.loanId, 1, 2);
      await j.checkpoint(first.loanId, { status: 'ACTIVE', dpd: 0 });
    });

    it('a larger consolidation loan settles the first at disbursement, in one transaction (UC-34, UC-50)', async () => {
      const before = await j.loan(first.loanId);
      const owed = Number(before.account.principalOutstanding);
      const r = await j.originate(
        productId,
        {
          principal: '6000',
          numberOfInstalments: 24,
          annualRate: '0.15',
          disbursementDate: '2026-03-05',
        },
        { borrowerId: first.borrowerId, refinancesLoanId: first.loanId },
      );
      second = r.loanId;
      const old = await j.checkpoint(first.loanId, {
        status: 'CLOSED',
        principal: 0,
        interest: 0,
      });
      const settled = old.events.find((e: any) => e.type === 'SETTLEMENT');
      expect(c2(settled.amount)).toBe(c2(owed));
      const fresh = await j.checkpoint(
        second,
        { status: 'ACTIVE', principal: 6000 },
        'loan.disbursement.execute',
      );
      // Net of the two journals, only the top-up leaves the bank as cash: the
      // rest of the new loan repays the old one.
      const disb = fresh.events.find((e: any) => e.type === 'DISBURSEMENT');
      const cashOut = (e: any) =>
        e.journal.lines
          .filter((x: any) => x.accountCode === '1000')
          .reduce(
            (t: number, x: any) => t + Number(x.credit) - Number(x.debit),
            0,
          );
      expect(c2(cashOut(disb) + cashOut(settled))).toBe(c2(6000 - owed));
      expect(settled.businessDate ?? settled.valueDate).toBeTruthy();
      expect(fresh.account.refinancedFromLoanId).toBe(first.loanId);
      const audit = expectOk(
        await j
          .as('admin1')
          .get('/lending/ops/audit?action=loan.refinance.execute'),
      );
      expect(audit.data[0].details.evergreening).toBe(false);
    });

    it('the consolidation loan is paid off early at its settlement quote (UC-31)', async () => {
      await j.payOnTime(second, 1, 1);
      await j.moveTo('2026-04-20');
      const q = await j.quote(second);
      expect(c2(q.principal)).toBe(
        c2((await j.loan(second)).account.principalOutstanding),
      );
      expect(Number(q.interest)).toBeGreaterThan(0);
      await j.settle(second);
      await j.checkpoint(second, {
        status: 'CLOSED',
        principal: 0,
        interest: 0,
      });
    });
  },
);

d(
  'S04 LT-06 student loan: grace, simple capitalization, repayment (TV-16)',
  () => {
    let j: Journey;
    let loanId: string;

    beforeAll(async () => {
      j = await Journey.start();
      const productId = await j.product('STUDENT_LOAN', 'STUDENT', (c) => {
        c.pricing.capitalization.basis = 'SIMPLE';
        c.pricing.fees = [];
        c.limits.maxAmount = '20000';
        c.pricing.fixed = {
          defaultAnnualRate: '0.06',
          minAnnualRate: '0.04',
          maxAnnualRate: '0.10',
        };
      });
      loanId = (
        await j.originate(
          productId,
          {
            principal: '20000',
            numberOfInstalments: 60,
            annualRate: '0.06',
            disbursementDate: '2026-01-05',
            interestGraceInstalments: 48,
            principalGraceInstalments: 48,
          },
          {
            borrower: {
              dateOfBirth: '2007-03-01',
              occupation: 'Student',
              monthlyIncome: 3000,
            },
          },
        )
      ).loanId;
    }, 120_000);
    afterAll(async () => j?.close());

    it('books 48 months in school with nothing to pay, interest capitalized on the original principal only', async () => {
      const l = await j.checkpoint(loanId, {
        status: 'ACTIVE',
        principal: 20000,
      });
      const lines = Journey.due(l);
      expect(
        lines
          .slice(0, 48)
          .every((x: any) => c2(x.capitalizedInterest) === '100.00'),
      ).toBe(true);
      expect(
        lines
          .slice(0, 48)
          .every(
            (x: any) => Number(x.principalDue) + Number(x.interestDue) === 0,
          ),
      ).toBe(true);
      expect(c2(lines[48].openingPrincipal)).toBe('24800.00');
    });

    it('each month in school the interest is capitalized, nothing falls due and the loan stays current', async () => {
      const l0 = await j.loan(loanId);
      const lines = Journey.due(l0);
      for (const n of [1, 2, 12, 24, 36, 48]) {
        await j.moveTo(lines[n - 1].dueDate);
        await j.checkpoint(loanId, {
          principal: 20000 + 100 * n,
          interest: 0,
          dpd: 0,
        });
      }
    });

    it('TV-16: 4 years at 6% simple → 4,800.00 capitalized, 24,800.00 at repayment start', async () => {
      const l = await j.loan(loanId);
      const caps = l.events.filter((e: any) => e.type === 'CAPITALIZATION');
      expect(caps).toHaveLength(48);
      expect(c2(sum(caps.map((e: any) => e.amount)))).toBe('4800.00');
      expect(c2(l.account.principalOutstanding)).toBe('24800.00');
    });

    it('repays the 12 amortizing instalments on time and closes', async () => {
      await j.payOnTime(loanId, 49, 60);
      await j.checkpoint(loanId, {
        status: 'CLOSED',
        principal: 0,
        interest: 0,
      });
    });
  },
);

d('S34 LT-01 personal loan with a broken first period (TV-09, UC-07)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product(
      'PERSONAL_INSTALMENT',
      'PL-BROKEN',
      (c) => {
        c.pricing.fees = [];
        c.repayment.allowIrregularFirstPeriod = true;
        c.repayment.maxFirstPeriodDays = 45;
        // An irregular period is priced day by day.
        c.pricing.accrualBasis = 'DAILY';
      },
    );
    loanId = (
      await j.originate(productId, {
        principal: '10000',
        numberOfInstalments: 12,
        annualRate: '0.12',
        disbursementDate: '2026-01-05',
        // Paid on the 15th: the first period runs 41 days, 10 more than a month.
        firstDueDate: '2026-02-15',
      })
    ).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('TV-09: the first period is 41 days; its first 10 extra days accrue 10,000 × 12% × 10/365 = 32.88', async () => {
    const l = await j.checkpoint(loanId, {
      status: 'ACTIVE',
      principal: 10000,
    });
    const lines = Journey.due(l);
    expect(lines[0].dueDate).toBe('2026-02-15');
    expect(lines[1].dueDate).toBe('2026-03-15');
    // 41 days at ACT/365 on the full principal.
    expect(c2(lines[0].interestDue)).toBe('134.79');
    await j.moveTo('2026-01-15');
    await j.checkpoint(loanId, { interest: '32.88', dpd: 0 });
  });

  it('is repaid on the 15th of each month to maturity', async () => {
    await j.payOnTime(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
  });
});
