/* eslint-disable @typescript-eslint/no-unsafe-call -- end-to-end fixtures: API responses are untyped. */
/**
 * Business journeys, onboarding to closure (docs/servicing/SCENARIOS.md):
 *
 *  S14 LT-20 SME loan, equal principal (TV-03), fee with VAT deducted, a
 *      partial payment completed inside the grace days (UC-09, UC-25, UC-54)
 *  S15 LT-12 corporate term loan, quarterly equal principal, to maturity
 *  S16 LT-13 overdraft: draw, statement with a minimum payment, the unpaid
 *      minimum ages, part payment does not cure, full minimum does (UC-38)
 *  S17 LT-14 revolving credit: draws, statement interest and commitment fee,
 *      limit increase under maker-checker, term-out, settlement (UC-36,
 *      UC-37, UC-41, UC-43)
 */
import { TEST_DB } from '../harness';
import { Journey, c2, collateral, expectOk, lending, sum } from './journey';

const d = TEST_DB ? describe : describe.skip;

d('S14 LT-20 SME loan, equal principal (TV-03)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('SME_TERM', 'SME');
    loanId = (
      await j.originate(
        productId,
        {
          principal: '10000',
          numberOfInstalments: 12,
          annualRate: '0.12',
          disbursementDate: '2026-01-05',
        },
        {
          docs: [
            'BUSINESS_REGISTRATION',
            'FINANCIAL_STATEMENTS',
            'COLLATERAL_TITLE',
          ],
          collateral: [collateral.commercial('30000')],
          borrower: { occupation: 'Restaurant owner', monthlyIncome: 5000 },
        },
      )
    ).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('UC-01: the 1% arrangement fee and 10% VAT on it are deducted from the payout', async () => {
    const l = await j.checkpoint(loanId, {
      status: 'ACTIVE',
      principal: 10000,
      fees: 0,
    });
    const disb = l.events.find((e: any) => e.type === 'DISBURSEMENT');
    expect(Journey.journal(l, disb.id)).toEqual([
      '1000:0.00:9890.00',
      '1200:10000.00:0.00',
      '2200:0.00:10.00',
      '4200:0.00:100.00',
    ]);
  });

  it('TV-03: 833.33 of principal a month (833.37 last); 933.33, 925.00 … 841.70; interest 650.00', async () => {
    const lines = Journey.due(await j.loan(loanId));
    expect(
      lines.slice(0, 11).every((x: any) => c2(x.principalDue) === '833.33'),
    ).toBe(true);
    expect(c2(lines[11].principalDue)).toBe('833.37');
    const total = (x: any) =>
      c2(Number(x.principalDue) + Number(x.interestDue));
    expect([total(lines[0]), total(lines[1]), total(lines[11])]).toEqual([
      '933.33',
      '925.00',
      '841.70',
    ]);
    expect(c2(sum(lines.map((x: any) => x.interestDue)))).toBe('650.00');
  });

  it('five instalments are paid on time', async () => {
    await j.payOnTime(loanId, 1, 5);
  });

  it('UC-25: instalment 6 is part-paid on its due date and completed two days later, inside the grace days', async () => {
    const l0 = await j.loan(loanId);
    const six = Journey.due(l0)[5];
    await j.moveTo(six.dueDate);
    const owed = Journey.owed(six);
    expectOk(await j.pay(loanId, '500.00'));
    await j.moveTo(lending.addDays(six.dueDate, 2));
    const late = await j.checkpoint(loanId, { dpd: 2, penalty: 0 });
    expect(c2(Journey.owed(Journey.due(late)[5]))).toBe(c2(owed - 500));
    expectOk(await j.pay(loanId, owed - 500));
    await j.moveTo(lending.addDays(six.dueDate, 3));
    await j.checkpoint(loanId, { dpd: 0, penalty: 0 });
  });

  it('the rest is paid on time to maturity and the shophouse title is released', async () => {
    await j.payOnTime(loanId, 7, 12);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
    await j.releaseCollateral(loanId);
  });
});

d('S15 LT-12 corporate term loan, quarterly equal principal', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('CORPORATE_TERM', 'CORP-Q');
    loanId = (
      await j.originate(
        productId,
        {
          principal: '400000',
          numberOfInstalments: 4,
          annualRate: '0.10',
          disbursementDate: '2026-01-05',
        },
        {
          // 400,000 is above the first approver's 200,000 authority.
          approvers: ['approver2'],
          borrower: {
            firstName: 'Mekong',
            lastName: 'Agro Co Ltd',
            occupation: 'Company',
            monthlyIncome: 200000,
          },
        },
      )
    ).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('OPS-8: an approver cannot approve above their 200,000 authority', async () => {
    const l0 = await j.loan(loanId);
    const app = expectOk(
      await j.as('ro').post('/lending/applications', {
        borrowerId: l0.account.borrowerId,
        productId: l0.account.productId,
        terms: {
          principal: '400000',
          numberOfInstalments: 4,
          annualRate: '0.10',
          disbursementDate: '2026-01-05',
        },
      }),
    );
    await j.uploadDocs(app.id, ['ID_DOCUMENT']);
    expectOk(await j.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await j.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Second facility request',
      }),
    );
    const denied = await j
      .as('approver')
      .post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approve',
      });
    expect(denied.status).toBe(403);
    expect(denied.body.blockedBy[0].message).toMatch(
      /exceeds your approval authority/,
    );
  });

  it('the booked schedule: four quarters of 100,000 principal, interest at 10% ÷ 4', async () => {
    const l = await j.checkpoint(loanId, {
      status: 'ACTIVE',
      principal: 400000,
    });
    const lines = Journey.due(l);
    expect(lines.map((x: any) => x.dueDate)).toEqual([
      '2026-04-05',
      '2026-07-05',
      '2026-10-05',
      '2027-01-05',
    ]);
    expect(lines.map((x: any) => c2(x.principalDue))).toEqual(
      Array(4).fill('100000.00'),
    );
    // Periodic rate = 10% ÷ 4 on the declining balance.
    expect(lines.map((x: any) => c2(x.interestDue))).toEqual([
      '10000.00',
      '7500.00',
      '5000.00',
      '2500.00',
    ]);
  });

  it('four quarterly instalments are paid on their dates and the loan closes', async () => {
    await j.payOnTime(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
  });
});

d('S16 LT-13 overdraft: minimum payment, arrears ageing, cure (UC-38)', () => {
  let j: Journey;
  let facilityId: string;
  let loanId: string;
  let minimum: { amount: number; due: string };

  beforeAll(async () => {
    j = await Journey.start({ flags: ['lending.facility.overdraft'] });
    const productId = await j.product('OVERDRAFT', 'OD');
    const r = await j.originate(
      productId,
      {
        principal: '20000',
        numberOfInstalments: 12,
        annualRate: '0.18',
        disbursementDate: '2026-01-05',
      },
      { borrower: { occupation: 'Trader', monthlyIncome: 40000 } },
    );
    facilityId = r.facilityId!;
    loanId = r.loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('draws 8,000; a 30-day statement charges 118.36 and asks for 5% of the balance plus the charges', async () => {
    await j.draw(facilityId, { amount: '8000' });
    await j.checkpoint(loanId, { status: 'ACTIVE', principal: 8000 });
    await j.moveTo('2026-02-04');
    const st = await j.statement(facilityId, '2026-02-04');
    // 8,000 × 18% × 30/365.
    expect(st.statement.interest).toBe('118.36');
    expect(st.detail.minimumPayment.basis).toBe('RATE');
    expect(c2(st.statement.minimumPayment)).toBe('518.36');
    expect(st.statement.minimumPaymentDue).toBe('2026-02-25');
    minimum = {
      amount: Number(st.statement.minimumPayment),
      due: st.statement.minimumPaymentDue,
    };
    await j.checkpoint(loanId, { principal: 8000, interest: '118.36', dpd: 0 });
  });

  it('UC-38: the unpaid minimum goes past due after its due date', async () => {
    await j.moveTo(lending.addDays(minimum.due, 7));
    const l = await j.checkpoint(loanId, { dpd: 7, bucket: 'DPD_1_30' });
    expect(l.account.collectionStage).toBe('REMINDER');
  });

  it('UC-38: half the minimum does not cure it; the rest does', async () => {
    await j.repayFacility(facilityId, minimum.amount / 2);
    await j.eod();
    await j.checkpoint(loanId, { dpd: 7 });
    await j.repayFacility(facilityId, minimum.amount / 2);
    await j.eod();
    // The interest was paid first; the rest of the minimum reduced the balance.
    await j.checkpoint(loanId, {
      dpd: 0,
      interest: 0,
      principal: 8000 - (minimum.amount - 118.36),
    });
  });

  it('the balance is repaid in full and the facility is closed at its review', async () => {
    const l = await j.loan(loanId);
    await j.repayFacility(facilityId, Number(l.account.principalOutstanding));
    const v = await j.facility(facilityId);
    expect(v.position.outstanding).toBe('0');
    expect(v.position.available).toBe('20000');
    expectOk(
      await j
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/status`, {
          action: 'EXPIRE',
          reason: 'Annual review: customer no longer needs the line',
        }),
    );
    expect((await j.facility(facilityId)).facility.status).toBe('EXPIRED');
    await j.checkpoint(loanId, { principal: 0, interest: 0 });
    await j.audited(facilityId, 'facility.manage');
  });
});

d(
  'S17 LT-14 revolving credit: draws, charges, limit increase, term-out',
  () => {
    let j: Journey;
    let facilityId: string;
    let loanId: string;

    beforeAll(async () => {
      j = await Journey.start({ flags: ['lending.revolving.drawdown'] });
      const productId = await j.product('REVOLVING_CREDIT', 'RCF', (c) => {
        c.facility.availabilityMonths = 2;
      });
      const r = await j.originate(
        productId,
        {
          principal: '100000',
          numberOfInstalments: 12,
          annualRate: '0.12',
          disbursementDate: '2026-01-05',
        },
        { borrower: { occupation: 'Distributor', monthlyIncome: 40000 } },
      );
      facilityId = r.facilityId!;
      loanId = r.loanId;
    }, 120_000);
    afterAll(async () => j?.close());

    it('UC-36 / UC-37: draws 40,000; a month later interest on the drawn and the commitment fee on the undrawn', async () => {
      await j.draw(facilityId, { amount: '40000' });
      await j.moveTo('2026-02-05');
      const st = await j.statement(facilityId, '2026-02-05');
      // 40,000 × 12% × 31/365 and 60,000 × 0.5% × 31/365.
      expect(st.statement.interest).toBe('407.67');
      expect(st.statement.commitmentFee).toBe('25.48');
      await j.checkpoint(loanId, {
        principal: 40000,
        interest: '407.67',
        fees: '25.48',
      });
    });

    it('a 10,433.15 repayment clears the charges and 10,000 of principal; the limit reinstates', async () => {
      await j.repayFacility(facilityId, '10433.15');
      const v = await j.facility(facilityId);
      expect(v.position).toMatchObject({
        outstanding: '30000',
        available: '70000',
      });
      await j.checkpoint(loanId, { principal: 30000, interest: 0, fees: 0 });
    });

    it('UC-41: a limit increase is requested and approved by a second person; a cut below the drawn balance is refused', async () => {
      const tooLow = await j
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/limit-changes`, {
          newLimit: '20000',
          changeType: 'DECREASE',
          reason: 'Risk appetite',
        });
      expect(tooLow.status).toBe(400);
      const change = expectOk(
        await j
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/limit-changes`, {
            newLimit: '150000',
            changeType: 'INCREASE',
            reason: 'Turnover grew 50%',
          }),
      );
      expectOk(
        await j
          .as('approver')
          .post(
            `/lending/facilities/${facilityId}/limit-changes/${change.id}/decide`,
            {
              outcome: 'APPROVE',
            },
          ),
      );
      const v = await j.facility(facilityId);
      expect(v.facility.limitAmount).toBe('150000');
      expect(v.position.available).toBe('120000');
    });

    it('UC-43: at the end of availability the 30,000 drawn terms out; two instalments, then early settlement', async () => {
      const v = await j.facility(facilityId);
      const end = v.facility.availabilityTo.slice(0, 10);
      await j.moveTo(end);
      await j.statement(facilityId, end);
      const plan = expectOk(
        await j
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/term-out`),
      );
      expect(plan.principal).toBe('30000');
      const l = await j.checkpoint(loanId, { principal: 30000 });
      expect(c2(sum(Journey.due(l).map((x: any) => x.principalDue)))).toBe(
        '30000.00',
      );
      await j.payOnTime(loanId, 1, 2);
      await j.moveTo(lending.addDays(await j.today(), 9));
      await j.settle(loanId);
      await j.checkpoint(loanId, {
        status: 'CLOSED',
        principal: 0,
        interest: 0,
        fees: 0,
      });
    });
  },
);
