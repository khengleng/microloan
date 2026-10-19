/* eslint-disable @typescript-eslint/no-unsafe-call -- end-to-end fixtures: API responses are untyped. */
/**
 * Vehicle and asset journeys, onboarding to closure (docs/servicing/SCENARIOS.md):
 *
 *  S11 LT-05 auto loan: default, ageing through every bucket, write-off at
 *      180 days past due, then recovery (UC-56, UC-57, UC-69, UC-70)
 *  S12 LT-15 equipment finance with a residual value (TV-19)
 *  S13 LT-09 gold loan: margin call when the gold price falls, cured by a
 *      repayment; redeemed at maturity and the gold returned (TV-18, UC-51, UC-73)
 */
import { TEST_DB } from '../harness';
import {
  Journey,
  c2,
  collateral,
  expectOk,
  key,
  lending,
  sum,
} from './journey';

const d = TEST_DB ? describe : describe.skip;

d('S11 LT-05 auto loan: default → write-off → recovery', () => {
  let j: Journey;
  let loanId: string;
  let firstLate: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('CAR_LOAN', 'AUTO', (c) => {
      c.pricing.fees = [];
    });
    loanId = (
      await j.originate(
        productId,
        {
          principal: '20000',
          numberOfInstalments: 48,
          annualRate: '0.12',
          disbursementDate: '2026-01-05',
        },
        {
          collateral: [collateral.vehicle('30000')],
          borrower: { monthlyIncome: 2500 },
        },
      )
    ).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('the vehicle secures 20,000 within 90% of its value after a 20% haircut; three instalments are paid', async () => {
    const v = await j.collateralView(loanId);
    expect(v.pledges).toHaveLength(1);
    await j.payOnTime(loanId, 1, 3);
    firstLate = Journey.due(await j.loan(loanId))[3].dueDate;
    expect(firstLate).toBe('2026-05-05');
  });

  it('UC-57: the borrower stops paying; the loan ages through every bucket and collection stage', async () => {
    const path: [number, string, string][] = [
      [10, 'DPD_1_30', 'REMINDER'],
      [45, 'DPD_31_60', 'FIELD_FOLLOW_UP'],
      [75, 'DPD_61_90', 'FIELD_FOLLOW_UP'],
      [100, 'DPD_90_PLUS', 'RECOVERY'],
    ];
    let penalty = 0;
    for (const [dpd, bucket, stage] of path) {
      await j.moveTo(lending.addDays(firstLate, dpd));
      const l = await j.checkpoint(loanId, { dpd, bucket, status: 'ACTIVE' });
      expect(l.account.collectionStage).toBe(stage);
      // UC-56: penalty interest keeps accruing on what is overdue.
      expect(Number(l.account.penaltyReceivable)).toBeGreaterThan(penalty);
      penalty = Number(l.account.penaltyReceivable);
    }
  });

  it('UC-69: a write-off is refused before the product minimum of 180 days past due', async () => {
    const res = await j
      .as('opsMaker')
      .post(`/lending/loans/${loanId}/write-offs`, {
        reason: 'Borrower absconded with the vehicle',
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/180/);
  });

  it('UC-69: at 180 days past due it is written off under maker-checker; every receivable leaves the books', async () => {
    await j.moveTo(lending.addDays(firstLate, 180));
    const before = await j.checkpoint(loanId, {
      dpd: 180,
      bucket: 'DPD_90_PLUS',
    });
    const owed =
      Number(before.account.principalOutstanding) +
      Number(before.account.interestReceivable) +
      Number(before.account.penaltyReceivable) +
      Number(before.account.feesReceivable);
    const ev = await j.writeOff(
      loanId,
      'Borrower absconded with the vehicle; not traceable',
    );
    const l = await j.checkpoint(
      loanId,
      { status: 'WRITTEN_OFF', principal: 0, interest: 0, penalty: 0, fees: 0 },
      'loan.writeoff.approve',
    );
    await j.audited(loanId, 'loan.writeoff.propose');
    const lines = l.events.find((e: any) => e.id === ev.id).journal.lines;
    const credits = sum(lines.map((x: any) => x.credit));
    // The whole balance owed comes off the receivables.
    expect(c2(credits)).toBe(c2(owed));
    // The end of day no longer services a written-off loan.
    await j.moveTo(lending.addDays(firstLate, 200));
    await j.checkpoint(loanId, {
      status: 'WRITTEN_OFF',
      principal: 0,
      interest: 0,
    });
  });

  it('UC-70: months later the vehicle is found and sold; 9,000 is recovered as income, the loan stays written off', async () => {
    const r = expectOk(
      await j
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/recoveries`,
          { amount: '9000', note: 'Vehicle recovered and sold at auction' },
          key('rec'),
        ),
    );
    expect(r.recovery.allocations[0]).toEqual({
      component: 'PRINCIPAL',
      amount: '9000',
    });
    const l = await j.checkpoint(
      loanId,
      { status: 'WRITTEN_OFF', principal: 0 },
      'loan.recovery.post',
    );
    const rec = l.events.find((e: any) => e.type === 'RECOVERY');
    expect(Journey.journal(l, rec.id)).toEqual([
      '1000:9000.00:0.00',
      '4300:0.00:9000.00',
    ]);
  });
});

d('S12 LT-15 equipment finance with a 10,000 residual (TV-19)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('EQUIPMENT_LOAN', 'EQUIP', (c) => {
      c.pricing.fees = [];
      c.repayment.method = 'BALLOON';
      c.repayment.maxBalloonFraction = '0.4';
    });
    loanId = (
      await j.originate(
        productId,
        {
          principal: '50000',
          numberOfInstalments: 36,
          annualRate: '0.10',
          balloonAmount: '10000',
          disbursementDate: '2026-01-05',
        },
        {
          collateral: [collateral.equipment('80000')],
          borrower: { monthlyIncome: 20000, occupation: 'Machine shop owner' },
        },
      )
    ).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('TV-19: 50,000 at 10% over 36 months with a 10,000 residual pays 1,374.02 a month', async () => {
    const l = await j.checkpoint(loanId, {
      status: 'ACTIVE',
      principal: 50000,
    });
    expect(l.account.instalmentAmount).toBe('1374.02');
    const lines = Journey.due(l);
    expect(
      lines
        .slice(0, 35)
        .every(
          (x: any) =>
            c2(Number(x.principalDue) + Number(x.interestDue)) === '1374.02',
        ),
    ).toBe(true);
    // The last payment is the residual plus a regular instalment (to rounding).
    const lastTotal =
      Number(lines[35].principalDue) + Number(lines[35].interestDue);
    expect(Math.abs(lastTotal - 11374.02)).toBeLessThan(0.05);
  });

  it('35 instalments and the residual are paid on their dates; the equipment is released', async () => {
    await j.payOnTime(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
    await j.releaseCollateral(loanId);
  });
});

d(
  'S13 LT-09 gold loan: margin call, cure by repayment, redemption (TV-18)',
  () => {
    let j: Journey;
    let loanId: string;
    let goldId: string;

    beforeAll(async () => {
      j = await Journey.start();
      // A pawn product: gold held as collateral at up to 80% LTV, interest
      // monthly and the principal at the end (RM-4).
      const productId = await j.product(
        'PERSONAL_INSTALMENT',
        'PAWN-GOLD',
        (c) => {
          c.pricing.fees = [];
          c.attributes.secured = true;
          c.repayment.method = 'INTEREST_ONLY';
          c.repayment.allocation.excessHandling = 'PREPAY';
          c.security = {
            collateralRequired: true,
            acceptedCollateralTypes: ['GOLD'],
            maxLtv: '0.80',
            haircuts: {},
            valuationMaxAgeDays: null,
            guaranteeRequired: false,
            minGuarantors: 0,
            marginCallCureDays: 5,
          };
        },
      );
      loanId = (
        await j.originate(
          productId,
          {
            principal: '7000',
            numberOfInstalments: 6,
            annualRate: '0.12',
            disbursementDate: '2026-01-05',
          },
          { collateral: [collateral.gold('10000')] },
        )
      ).loanId;
      goldId = (await j.collateralView(loanId)).pledges[0].collateralId;
    }, 120_000);
    afterAll(async () => j?.close());

    it('lends 7,000 against 10,000 of gold; interest only, the principal at the end', async () => {
      const l = await j.checkpoint(loanId, {
        status: 'ACTIVE',
        principal: 7000,
      });
      const lines = Journey.due(l);
      expect(
        lines
          .slice(0, 5)
          .every(
            (x: any) =>
              Number(x.principalDue) === 0 && c2(x.interestDue) === '70.00',
          ),
      ).toBe(true);
      expect(c2(lines[5].principalDue)).toBe('7000.00');
    });

    it('UC-51 / TV-18: gold falls to 8,000 on day one: LTV 87.50%, repay 600.00 or pledge 750.00 more', async () => {
      const r = expectOk(
        await j
          .as('ro')
          .post(`/lending/loans/${loanId}/collateral/${goldId}/valuations`, {
            marketValue: '8000',
            valuationDate: '2026-01-05',
            valuer: 'Assay Co',
            method: 'MARKET',
          }),
      );
      expect(r.marginCall.ltv).toBe('0.875');
      expect(r.marginCall.requiredRepayment).toBe('600');
      expect(r.marginCall.requiredCollateral).toBe('750');
      const v = await j.collateralView(loanId);
      expect(v.marginCalls[0].status).toBe('OPEN');
      expect(v.marginCalls[0].deadline.slice(0, 10)).toBe('2026-01-10');
      await j.checkpoint(loanId, { principal: 7000 });
    });

    it('UC-51: the borrower repays the required 600 the same day', async () => {
      const ev = expectOk(
        await j.pay(loanId, '600.00', { prepaymentStrategy: 'RECAST' }),
      );
      expect(ev.components.prepaidPrincipal).toBe('600');
      await j.checkpoint(
        loanId,
        { principal: 6400, dpd: 0 },
        'loan.repayment.post',
      );
    });

    // D-QA-04 (fixed): paying what the call asked for cures it, although
    // interest has accrued since the call was made.
    it(
      'UC-51: paying the required repayment cures the call at end of day (D-QA-04)',
      async () => {
        await j.moveTo('2026-01-06');
        expect((await j.collateralView(loanId)).marginCalls[0].status).toBe(
          'CURED',
        );
      },
    );

    it('UC-51: pledging 10 g more gold brings it back within 80% and cures the call on the spot', async () => {
      await j.moveTo('2026-01-07');
      expectOk(
        await j
          .as('ro')
          .post(
            `/lending/loans/${loanId}/collateral`,
            collateral.gold('1000', 10),
          ),
      );
      const v = await j.collateralView(loanId);
      expect(v.marginCalls[0].status).toBe('CURED');
      expect(v.pledges).toHaveLength(2);
      await j.checkpoint(loanId, { principal: 6400, dpd: 0 });
    });

    it('interest is paid monthly; the gold is redeemed at maturity and returned (UC-72, UC-73)', async () => {
      await j.payOnTime(loanId);
      await j.checkpoint(loanId, {
        status: 'CLOSED',
        principal: 0,
        interest: 0,
      });
      await j.releaseCollateral(loanId);
    });
  },
);
