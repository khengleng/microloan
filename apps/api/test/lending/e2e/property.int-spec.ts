/* eslint-disable @typescript-eslint/no-unsafe-call -- end-to-end fixtures: API responses are untyped. */
/**
 * Property journeys, onboarding to closure (docs/servicing/SCENARIOS.md):
 *
 *  S05 LT-02 mortgage: variable-rate reset, partial prepayment inside the
 *      lock-in, early payoff with the lock-in charge, collateral released
 *      (TV-02, TV-06 at booking; UC-29, UC-31, UC-32, UC-45, UC-73)
 *  S06 LT-03 home equity term loan: combined LTV behind a first mortgage,
 *      a late instalment with penalty interest, early settlement with the
 *      fee waived under maker-checker (UC-32, UC-54, UC-56, UC-57)
 *  S07 LT-04 HELOC: combined-LTV limit (TV-17), draws, statement interest
 *      (TV-07), term-out to instalments, arrears aging and cure (UC-36,
 *      UC-37, UC-43, UC-57)
 *  S08 LT-17 construction: staged draws against conditions, interest only
 *      on the drawn amount, term-out (UC-04, UC-43)
 *  S09 LT-23 bridge loan: interest only then bullet (TV-05, UC-11, UC-12)
 *  S10 LT-16 commercial real estate with a balloon (TV-06, UC-12)
 */
import { TEST_DB } from '../harness';
import { Journey, c2, collateral, expectOk, key, lending, sum } from './journey';

const d = TEST_DB ? describe : describe.skip;

d('S05 LT-02 mortgage: rate reset, prepayment in lock-in, early payoff (TV-02, TV-06)', () => {
  let j: Journey;
  let loanId: string;

  const observe = async (observationDate: string, rate: string) =>
    expectOk(
      await j.as('finance').post('/lending/ops/rates', {
        benchmarkCode: 'NBC_BASE',
        observationDate,
        rate,
        source: 'Central bank publication',
      }),
    );

  beforeAll(async () => {
    j = await Journey.start({ flags: ['lending.pricing.floating_rate'] });
    await observe('2026-01-01', '0.05');
    const productId = await j.product('HOME_MORTGAGE', 'MTG-VAR', (c) => {
      c.attributes.rateType = 'FLOATING';
      c.pricing.fixed = null;
      // NBC base + 3%, reset quarterly, floored at 6% and capped at 12%.
      c.pricing.floating = {
        benchmarkCode: 'NBC_BASE',
        margin: '0.03',
        resetFrequency: 'QUARTERLY',
        floor: '0.06',
        cap: '0.12',
      };
      c.pricing.fees = [];
      c.repayment.allocation.excessHandling = 'PREPAY';
      c.repayment.prepayment.defaultStrategy = 'SHORTEN';
      // Lock-in: 3% of what is repaid early in the first 24 months; 1% after.
      c.repayment.earlyRepaymentCharges = {
        appliesTo: ['PARTIAL_PREPAYMENT', 'EARLY_SETTLEMENT'],
        basis: 'AMOUNT_REPAID',
        tiers: [{ untilMonth: 24, action: 'CHARGE', rate: '0.03', fixed: null }],
      };
      c.repayment.earlySettlement.feeRate = '0.01';
    });
    loanId = (
      await j.originate(
        productId,
        {
          principal: '100000',
          numberOfInstalments: 240,
          disbursementDate: '2026-01-05',
        },
        {
          docs: ['ID_DOCUMENT', 'TITLE_DEED', 'VALUATION_REPORT'],
          collateral: [collateral.home('150000')],
          borrower: { monthlyIncome: 4000 },
        },
      )
    ).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('TV-02 / TV-06: priced at benchmark 5% + 3% = 8%, the schedule matches the vectors', async () => {
    const l = await j.checkpoint(
      loanId,
      { status: 'ACTIVE', principal: 100000 },
      'loan.disbursement.execute',
    );
    const lines = Journey.due(l);
    expect(lines).toHaveLength(240);
    expect(lines[0].annualRate).toBe('0.08');
    expect(l.account.instalmentAmount).toBe('836.44');
    const last = lines[239];
    expect(c2(Number(last.principalDue) + Number(last.interestDue))).toBe('836.37');
    expect(c2(sum(lines.map((x: any) => x.interestDue)))).toBe('100745.53');
    // TV-06: balance after 60 payments.
    expect(c2(lines[60].openingPrincipal)).toBe('87525.57');
    // Mortgage conditions precedent were satisfied before money moved.
    const app = await j.application(l.account.applicationId);
    expect(app.conditions.map((c: any) => c.code).sort()).toEqual([
      'AGREEMENT_SIGNED',
      'MORTGAGE_REGISTERED',
    ]);
    expect(app.conditions.every((c: any) => c.status === 'SATISFIED')).toBe(true);
  });

  it('two instalments are paid on time at 8%', async () => {
    await j.payOnTime(loanId, 1, 2);
  });

  it('UC-45: the quarterly reset on 5 April re-prices the unpaid tail at 6% + 3% = 9%', async () => {
    await j.moveTo('2026-04-01');
    await observe('2026-04-01', '0.06');
    // Instalment 3 (period 5 March – 5 April) is still at 8%; the batch on
    // 5 April re-prices everything after it.
    await j.payOnTime(loanId, 3, 3);
    const r = expectOk(await j.as('opsMaker').get(`/lending/loans/${loanId}/rate-resets`));
    expect(r.due).toEqual([]);
    expect(r.resets).toHaveLength(1);
    expect(r.resets[0]).toMatchObject({
      resetDate: '2026-04-05',
      previousAnnualRate: '0.08',
      newAnnualRate: '0.09',
      bound: 'BENCHMARK',
    });
    const l = await j.checkpoint(loanId, { dpd: 0 }, 'loan.rate_reset.apply');
    expect(l.agreementVersions.map((v: any) => v.reason)).toContain('RATE_RESET');
    const live = Journey.due(l).filter((x: any) => x.status === 'DUE');
    expect(live.every((x: any) => x.annualRate === '0.09')).toBe(true);
    expect(Number(l.account.instalmentAmount)).toBeGreaterThan(836.44);
    // The tail is re-priced; the instalments already paid are untouched.
    expect(
      l.schedule.filter((x: any) => x.status === 'PAID' && x.annualRate === '0.08'),
    ).toHaveLength(3);
  });

  it('UC-29 / UC-32: a 10,000 prepayment inside the lock-in carries the 3% lock-in charge and shortens the term', async () => {
    await j.moveTo('2026-05-05');
    const before = await j.loan(loanId);
    const dueBefore = Journey.due(before).filter((x: any) => x.status === 'DUE').length;
    const owed = Journey.arrears(before, '2026-05-05');
    const ev = expectOk(
      await j.pay(loanId, owed + 10300, { prepaymentStrategy: 'SHORTEN' }),
    );
    expect(ev.components.prepaidPrincipal).toBe('10000');
    expect(ev.components.prepaymentFee).toBe('300');
    expect(ev.components.prepaymentCharge.source.kind).toBe('TIER');
    const l = await j.checkpoint(loanId, { dpd: 0, fees: 0 }, 'loan.repayment.post');
    const due = Journey.due(l).filter((x: any) => x.status === 'DUE');
    expect(due.length).toBeLessThan(dueBefore - 1);
    // Keep the instalment, shorten the term.
    expect(c2(l.account.instalmentAmount)).toBe(c2(before.account.instalmentAmount));
    const scheduled = Number(Journey.due(before).find((x: any) => x.dueDate === '2026-05-05').principalDue);
    expect(c2(l.account.principalOutstanding)).toBe(
      c2(Number(before.account.principalOutstanding) - scheduled - 10000),
    );
  });

  it('UC-31 / UC-32: early payoff inside the lock-in is quoted with the lock-in charge and closes the loan', async () => {
    await j.payOnTime(loanId, 5, 6);
    await j.moveTo('2026-07-20');
    const l = await j.loan(loanId);
    const q = await j.quote(loanId);
    expect(c2(q.principal)).toBe(c2(l.account.principalOutstanding));
    // 15 of 30 days of July's instalment interest has accrued.
    expect(Number(q.interest)).toBeGreaterThan(0);
    expect(q.settlementFeeExplanation).toMatch(/Lock-in charge/);
    expect(c2(q.settlementFee)).toBe(c2(Math.round(Number(q.principal) * 3) / 100));
    expect(c2(q.payable)).toBe(
      c2(Number(q.principal) + Number(q.interest) + Number(q.settlementFee)),
    );
    await j.settle(loanId);
    await j.checkpoint(
      loanId,
      { status: 'CLOSED', principal: 0, interest: 0, fees: 0 },
      'loan.settlement',
    );
  });

  it('UC-73: the title is released after closure, signed off by a second person', async () => {
    await j.releaseCollateral(loanId);
  });
});

d('S06 LT-03 home equity term loan: late instalment, waived settlement fee', () => {
  let j: Journey;
  let productId: string;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    productId = await j.product('HOME_EQUITY_TERM', 'HE-TERM', (c) => {
      c.pricing.fees = [];
      c.repayment.earlySettlement.feeRate = '0.02';
      c.operations.requiredDocuments = [
        { code: 'ID_DOCUMENT', label: 'Identity document', stage: 'APPLICATION', mandatory: true },
        { code: 'TITLE_DEED', label: 'Property title', stage: 'APPROVAL', mandatory: true },
      ];
    });
  }, 120_000);
  afterAll(async () => j?.close());

  it('lends against the equity behind a first mortgage: 70% of 200,000 less 100,000 owed', async () => {
    const r = await j.originate(
      productId,
      {
        principal: '30000',
        numberOfInstalments: 60,
        annualRate: '0.12',
        disbursementDate: '2026-01-05',
      },
      {
        docs: ['ID_DOCUMENT', 'TITLE_DEED'],
        collateral: [collateral.home('200000', '100000')],
        borrower: { monthlyIncome: 6000 },
      },
    );
    loanId = r.loanId;
    const app = await j.application(r.applicationId);
    expect(app.pledges).toHaveLength(1);
    await j.checkpoint(loanId, { status: 'ACTIVE', principal: 30000 });
  });

  it('pays two instalments on time', async () => {
    await j.payOnTime(loanId, 1, 2);
  });

  it('UC-54 / UC-56 / UC-57: instalment 3 is late; penalty interest starts after the 3 grace days', async () => {
    const l0 = await j.loan(loanId);
    const third = Journey.due(l0).find((x: any) => x.number === 3);
    const overdue = Number(third.principalDue) + Number(third.interestDue);
    await j.moveTo('2026-04-08');
    await j.checkpoint(loanId, { dpd: 3, penalty: 0, bucket: 'DPD_1_30' });
    await j.moveTo('2026-04-15');
    // 6% a year on the overdue instalment from 8 April (due date + 3 grace days) to 15 April.
    const penalty = Math.round(overdue * 0.06 * 7 / 365 * 100) / 100;
    const l = await j.checkpoint(loanId, { dpd: 10, penalty, bucket: 'DPD_1_30' });
    expect(l.account.collectionStage).toBe('REMINDER');
  });

  it('the arrears and penalty are paid; the loan cures', async () => {
    const l = await j.loan(loanId);
    expectOk(await j.pay(loanId, Journey.arrears(l, '2026-04-15')));
    await j.moveTo('2026-04-16');
    await j.checkpoint(loanId, { dpd: 0, penalty: 0, bucket: 'CURRENT' }, 'loan.repayment.post');
  });

  it('UC-32: the 2% settlement fee is waived under maker-checker and the loan is settled', async () => {
    await j.payOnTime(loanId, 4, 5);
    await j.moveTo('2026-06-20');
    const before = await j.quote(loanId);
    expect(c2(before.settlementFee)).toBe(c2(Math.round(Number(before.principal) * 2) / 100));
    const task = expectOk(
      await j.as('opsMaker').post(`/lending/loans/${loanId}/fee-waivers`, {
        kind: 'EARLY_SETTLEMENT',
        reason: 'Borrower selling the property; goodwill',
      }),
    );
    expect(
      (
        await j.as('opsMaker').post(`/lending/loans/${loanId}/fee-waivers/${task.id}/decision`, {
          approve: true,
        })
      ).status,
    ).toBe(403);
    expectOk(
      await j.as('opsChecker').post(`/lending/loans/${loanId}/fee-waivers/${task.id}/decision`, {
        approve: true,
      }),
    );
    const q = await j.quote(loanId);
    expect(q.settlementFee).toBe('0');
    expect(c2(q.payable)).toBe(c2(Number(before.payable) - Number(before.settlementFee)));
    await j.settle(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0, penalty: 0 });
    await j.releaseCollateral(loanId);
  });
});

d('S07 LT-04 HELOC: combined LTV limit, draws, statements, term-out, arrears (TV-17, TV-07)', () => {
  let j: Journey;
  let productId: string;
  let facilityId: string;
  let loanId: string;
  let borrowerId: string;

  beforeAll(async () => {
    j = await Journey.start({ flags: ['lending.revolving.drawdown'] });
    productId = await j.product('HOME_EQUITY_LINE', 'HELOC', (c) => {
      c.security.maxLtv = '0.80';
      c.pricing.fees = [];
      c.pricing.fixed = { defaultAnnualRate: '0.24', minAnnualRate: '0.10', maxAnnualRate: '0.24' };
      c.pricing.regulatoryCapAnnualRate = '0.24';
      c.facility.commitmentFeeRate = null;
      c.facility.availabilityMonths = 3;
    });
  }, 120_000);
  afterAll(async () => j?.close());

  const terms = (principal: string) => ({
    principal,
    numberOfInstalments: 24,
    annualRate: '0.24',
    disbursementDate: '2026-01-05',
  });

  it('TV-17: behind a 120,000 mortgage on a 200,000 home at 80% LTV the line is at most 40,000', async () => {
    borrowerId = await j.onboard({ monthlyIncome: 20000 });
    const app = expectOk(
      await j.as('ro').post('/lending/applications', {
        borrowerId,
        productId,
        terms: terms('40001'),
      }),
    );
    await j.uploadDocs(app.id, ['ID_DOCUMENT']);
    expectOk(
      await j.as('ro').post(
        `/lending/applications/${app.id}/collateral`,
        collateral.home('200000', '120000'),
      ),
    );
    expectOk(await j.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await j.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Within policy',
      }),
    );
    const over = await j.as('approver').post(`/lending/applications/${app.id}/approve`, {
      rationale: 'Approve',
    });
    expect(over.status).toBe(400);
    const ltv = over.body.issues.find((i: any) => i.code === 'LTV');
    expect(ltv.message).toMatch(/Combined loan-to-value/);
    expect(ltv.message).toMatch(/40000/);
  });

  it('a 40,000 line is approved and booked as a facility with nothing drawn', async () => {
    const r = await j.originate(productId, terms('40000'), {
      borrowerId,
      collateral: [collateral.home('200000', '120000')],
    });
    facilityId = r.facilityId!;
    loanId = r.loanId;
    const v = await j.facility(facilityId);
    expect(v.facility.facilityType).toBe('REVOLVING');
    expect(v.position).toMatchObject({ available: '40000', outstanding: '0' });
    await j.checkpoint(loanId, { status: 'BOOKED', principal: 0 });
  });

  it('UC-36: draws 1,000; TV-07: a 30-day statement at 24% on 1,000 charges 19.73 (UC-37)', async () => {
    await j.draw(facilityId, { amount: '1000' });
    await j.checkpoint(loanId, { status: 'ACTIVE', principal: 1000 });
    await j.moveTo('2026-02-04');
    const st = await j.statement(facilityId, '2026-02-04');
    expect(st.statement.interest).toBe('19.73');
    expect(st.statement.minimumPayment).toBeNull();
    await j.checkpoint(loanId, { principal: 1000, interest: '19.73' });
    await j.audited(facilityId, 'facility.statement.generate');
  });

  it('draws 9,000 more, repays 2,000; the limit reinstates', async () => {
    await j.draw(facilityId, { amount: '9000' });
    expect((await j.facility(facilityId)).position).toMatchObject({
      outstanding: '10000',
      available: '30000',
    });
    await j.moveTo('2026-03-01');
    await j.repayFacility(facilityId, '2019.73');
    const v = await j.facility(facilityId);
    expect(v.position).toMatchObject({ outstanding: '8000', available: '32000' });
    await j.checkpoint(loanId, { principal: 8000, interest: 0 });
  });

  it('UC-43: at the end of availability the drawn balance terms out into instalments', async () => {
    const v = await j.facility(facilityId);
    const end = v.facility.availabilityTo.slice(0, 10);
    await j.moveTo(end);
    await j.statement(facilityId, end);
    const stated = await j.loan(loanId);
    const plan = expectOk(await j.as('opsChecker').post(`/lending/facilities/${facilityId}/term-out`));
    expect(plan.principal).toBe('8000');
    const l = await j.checkpoint(loanId, { principal: 8000 });
    expect(l.agreementVersions.at(-1).reason).toBe('TERM_OUT');
    const lines = Journey.due(l);
    expect(lines).toHaveLength(plan.months);
    expect(c2(sum(lines.map((x: any) => x.principalDue)))).toBe('8000.00');
    expect(c2(lines[0].deferredInterestDue)).toBe(c2(stated.account.interestReceivable));
    expect((await j.facility(facilityId)).facility.status).toBe('TERMED_OUT');
  });

  it('UC-57: an unpaid instalment ages through the buckets; paying the arrears cures it', async () => {
    const l0 = await j.loan(loanId);
    const first = Journey.due(l0)[0];
    await j.moveTo(lending.addDays(first.dueDate, 10));
    await j.checkpoint(loanId, { dpd: 10, bucket: 'DPD_1_30' });
    await j.moveTo(lending.addDays(first.dueDate, 35));
    const late = await j.checkpoint(loanId, { dpd: 35, bucket: 'DPD_31_60' });
    expect(late.account.collectionStage).toBe('FIELD_FOLLOW_UP');
    const today = await j.today();
    expectOk(await j.pay(loanId, Journey.arrears(late, today)));
    await j.moveTo(lending.addDays(today, 1));
    await j.checkpoint(loanId, { dpd: 0, bucket: 'CURRENT', penalty: 0 });
  });

  it('the termed-out line is settled early and the home is released', async () => {
    await j.settle(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
    await j.releaseCollateral(loanId);
  });
});

d('S08 LT-17 construction: staged draws against conditions, then term-out (UC-04)', () => {
  let j: Journey;
  let facilityId: string;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start({ flags: ['lending.facility.staged_drawdown'] });
    const productId = await j.product('CONSTRUCTION', 'CONSTRUCT', (c) => {
      c.pricing.fees = [];
      c.facility.availabilityMonths = 9;
      c.facility.tranches = [
        { code: 'FOUNDATION', label: 'Foundation complete', shareOfLimit: '0.3', availableAfterMonths: 0, conditions: [] },
        { code: 'STRUCTURE', label: 'Structure complete', shareOfLimit: '0.4', availableAfterMonths: 3, conditions: ['SURVEYOR_REPORT'] },
        { code: 'COMPLETION', label: 'Practical completion', shareOfLimit: '0.3', availableAfterMonths: 6, conditions: ['SURVEYOR_REPORT', 'OCCUPANCY_CERTIFICATE'] },
      ];
    });
    const r = await j.originate(
      productId,
      {
        principal: '100000',
        numberOfInstalments: 120,
        annualRate: '0.12',
        disbursementDate: '2026-01-05',
      },
      {
        collateral: [collateral.home('250000')],
        borrower: { monthlyIncome: 40000 },
      },
    );
    facilityId = r.facilityId!;
    loanId = r.loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  const satisfy = async (tranche: string) => {
    const v = await j.facility(facilityId);
    for (const c of v.conditions.filter((x: any) => x.trancheCode === tranche && x.status === 'PENDING'))
      expectOk(
        await j.as('opsMaker').post(`/lending/facilities/${facilityId}/conditions/${c.id}/satisfy`, {
          evidence: `${c.code} on file`,
        }),
      );
  };

  it('UC-04: the foundation tranche (30%) is released; interest runs only on what is drawn', async () => {
    await j.draw(facilityId, { amount: '30000', trancheCode: 'FOUNDATION' });
    await j.checkpoint(loanId, { status: 'ACTIVE', principal: 30000 });
    await j.moveTo('2026-02-05');
    const st = await j.statement(facilityId, '2026-02-05');
    // 30,000 × 12% × 31/365.
    expect(st.statement.interest).toBe('305.75');
    await j.checkpoint(loanId, { principal: 30000, interest: '305.75' });
    await j.repayFacility(facilityId, '305.75');
    await j.checkpoint(loanId, { principal: 30000, interest: 0 });
    await j.audited(facilityId, 'loan.repayment.post');
  });

  it('the structure tranche is refused until its date and its surveyor report, then released', async () => {
    const early = await j.as('opsMaker').post(`/lending/facilities/${facilityId}/drawdowns`, {
      amount: '40000',
      trancheCode: 'STRUCTURE',
    });
    expect(early.status).toBe(400);
    await j.moveTo('2026-04-05');
    const blocked = await j.as('opsMaker').post(`/lending/facilities/${facilityId}/drawdowns`, {
      amount: '40000',
      trancheCode: 'STRUCTURE',
    });
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body.issues)).toMatch(/SURVEYOR_REPORT/);
    await j.statement(facilityId, '2026-04-05');
    await satisfy('STRUCTURE');
    await j.draw(facilityId, { amount: '40000', trancheCode: 'STRUCTURE' });
    await j.checkpoint(loanId, { principal: 70000 });
  });

  it('the completion tranche is released after both conditions; the facility is fully drawn', async () => {
    await j.moveTo('2026-07-05');
    await j.statement(facilityId, '2026-07-05');
    await satisfy('COMPLETION');
    await j.draw(facilityId, { amount: '30000', trancheCode: 'COMPLETION' });
    const v = await j.facility(facilityId);
    expect(v.position).toMatchObject({ outstanding: '100000', available: '0' });
    expect(v.position.releasedTranches.sort()).toEqual(['COMPLETION', 'FOUNDATION', 'STRUCTURE']);
    await j.checkpoint(loanId, { principal: 100000 });
  });

  it('UC-43: at the end of availability the loan terms out; the stated interest falls due with instalment 1', async () => {
    const v = await j.facility(facilityId);
    const end = v.facility.availabilityTo.slice(0, 10);
    await j.moveTo(end);
    await j.statement(facilityId, end);
    const stated = await j.loan(loanId);
    const plan = expectOk(await j.as('opsChecker').post(`/lending/facilities/${facilityId}/term-out`));
    expect(plan.principal).toBe('100000');
    const l = await j.checkpoint(loanId, { principal: 100000 });
    const lines = Journey.due(l);
    expect(c2(lines[0].deferredInterestDue)).toBe(c2(stated.account.interestReceivable));
    expect(c2(sum(lines.map((x: any) => x.principalDue)))).toBe('100000.00');
  });

  it('the first two instalments are paid on time; the owner then refinances elsewhere and settles', async () => {
    await j.payOnTime(loanId, 1, 2);
    await j.moveTo(lending.addDays(await j.today(), 10));
    await j.settle(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
    await j.releaseCollateral(loanId);
  });
});

d('S09 LT-23 bridge loan: interest only, then the bullet from the sale (TV-05)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('BRIDGE_LOAN', 'BRIDGE', (c) => {
      c.pricing.fees = [];
    });
    loanId = (
      await j.originate(
        productId,
        {
          principal: '10000',
          numberOfInstalments: 12,
          annualRate: '0.12',
          disbursementDate: '2026-01-05',
        },
        { collateral: [collateral.home('50000')] },
      )
    ).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('TV-05: months 1–11 are 100.00 of interest; month 12 is 10,100.00', async () => {
    const l = await j.checkpoint(loanId, { status: 'ACTIVE', principal: 10000 });
    const lines = Journey.due(l);
    expect(lines.slice(0, 11).every((x: any) => c2(x.interestDue) === '100.00' && Number(x.principalDue) === 0)).toBe(true);
    expect(c2(Number(lines[11].principalDue) + Number(lines[11].interestDue))).toBe('10100.00');
  });

  it('interest is paid monthly, the bullet on maturity from the sale proceeds; the title is released', async () => {
    await j.payOnTime(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
    const l = await j.loan(loanId);
    const paid = l.events
      .filter((e: any) => e.type === 'REPAYMENT')
      .map((e: any) => c2(e.amount));
    expect(paid).toEqual([...Array(11).fill('100.00'), '10100.00']);
    await j.releaseCollateral(loanId);
  });
});

d('S10 LT-16 commercial real estate with a balloon (TV-06)', () => {
  let j: Journey;
  let loanId: string;

  beforeAll(async () => {
    j = await Journey.start();
    const productId = await j.product('COMMERCIAL_PROPERTY', 'CRE', (c) => {
      c.pricing.fees = [];
      c.repayment.method = 'BALLOON';
      c.repayment.maxBalloonFraction = '0.9';
      c.pricing.fixed = { defaultAnnualRate: '0.08', minAnnualRate: '0.06', maxAnnualRate: '0.12' };
    });
    loanId = (
      await j.originate(
        productId,
        {
          principal: '100000',
          numberOfInstalments: 60,
          annualRate: '0.08',
          balloonAmount: '87525.57',
          disbursementDate: '2026-01-05',
        },
        {
          collateral: [collateral.commercial('200000')],
          borrower: { monthlyIncome: 20000, occupation: 'Property investor' },
        },
      )
    ).loanId;
  }, 120_000);
  afterAll(async () => j?.close());

  it('TV-06: amortizes as the 240-month TV-02 loan; 88,362.01 is due on instalment 60', async () => {
    const l = await j.checkpoint(loanId, { status: 'ACTIVE', principal: 100000 });
    const lines = Journey.due(l);
    expect(l.account.instalmentAmount).toBe('836.44');
    expect(c2(Number(lines[59].principalDue) + Number(lines[59].interestDue))).toBe('88362.01');
    // The balance after the 60th regular payment is the TV-06 balloon.
    expect(c2(Number(lines[59].principalDue) - (836.44 - Number(lines[59].interestDue)))).toBe('87525.57');
  });

  it('59 instalments and the balloon are paid on their dates; the property is released', async () => {
    await j.payOnTime(loanId);
    await j.checkpoint(loanId, { status: 'CLOSED', principal: 0, interest: 0 });
    await j.releaseCollateral(loanId);
  });
});
