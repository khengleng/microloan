/** The pre-contract key facts statement's figures (DECISIONS D-123). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const clone = (code: string): L.ProductConfig => structuredClone(L.TEMPLATE_BY_CODE[code].defaultConfig);

function facts(c: L.ProductConfig, terms: L.NegotiatedTerms) {
  const fees = L.computeUpfrontFees(terms.principal, c.identity.currency, c.pricing.rounding, L.feesOf(c), terms.waivedFeeCodes);
  const calendar = c.repayment.holidayCalendarCode ? { code: c.repayment.holidayCalendarCode, weekendDays: [], holidays: [] } : undefined;
  const input = L.toScheduleInput(c, terms, fees.bookedPrincipal, calendar);
  const schedule = L.generateSchedule(input);
  const apr = L.effectiveAnnualRate([
    { date: terms.disbursementDate, amount: L.dec(fees.netDisbursement).minus(fees.separate).toString() },
    ...schedule.lines.map((l) => ({ date: l.dueDate, amount: L.dec(l.total).negated().toString() })),
  ]);
  return {
    fees,
    schedule,
    k: L.buildKeyFacts({
      currency: c.identity.currency,
      principal: terms.principal,
      disbursementDate: terms.disbursementDate,
      nominalAnnualRate: input.annualRate ?? null,
      effectiveAnnualRate: apr,
      fees,
      schedule,
      config: c,
    }),
  };
}

describe('key facts statement', () => {
  test('rates are percentages with two decimals', () => {
    assert.equal(L.ratePct('0.18'), '18.00');
    assert.equal(L.ratePct('0.123456'), '12.35');
    assert.equal(L.ratePct('0.005'), '0.50');
    assert.equal(L.ratePct(null), null);
  });

  test('totals reconcile: repayable less cash received is interest plus every fee', () => {
    const c = clone('PERSONAL_INSTALMENT');
    c.pricing.fees = [
      { code: 'PROC', name: 'Processing fee', calculation: 'PERCENT_OF_PRINCIPAL', rate: '0.02', treatment: 'DEDUCTED', waivable: false, payee: 'LENDER' },
      { code: 'DOC', name: 'Documentation', calculation: 'FIXED', amount: '15', treatment: 'FINANCED', taxRate: '0.1', waivable: false, payee: 'LENDER' },
      { code: 'INS', name: 'Credit insurance', calculation: 'FIXED', amount: '10', treatment: 'SEPARATE', waivable: false, payee: 'INSURER' },
    ];
    const { k, schedule } = facts(c, { principal: '1000', numberOfInstalments: 12, annualRate: '0.18', disbursementDate: '2026-01-05' });
    assert.equal(k.rates.nominalAnnualRatePct, '18.00');
    assert.match(k.rates.effectiveAnnualRatePct!, /^\d+\.\d{2}$/);
    assert.ok(Number(k.rates.effectiveAnnualRatePct) > 18, 'fees raise the effective rate above the nominal');
    // Fees: 20 deducted, 16.50 financed (15 + 10% tax), 10 separate.
    assert.equal(k.totals.fees, '46.5');
    assert.equal(k.netDisbursement, '980');
    assert.equal(k.bookedPrincipal, '1016.5');
    assert.equal(k.totals.interest, L.dec(schedule.totals.interest).toString());
    assert.equal(k.totals.repayable, L.dec(schedule.totals.payments).plus(10).toString());
    assert.equal(L.dec(k.totals.costOfCredit!).toString(), L.dec(k.totals.repayable!).minus(980).toString());
    assert.equal(L.dec(k.totals.costOfCredit!).toString(), L.dec(k.totals.interest!).plus(k.totals.fees).toString());
    const ins = k.fees.find((x) => x.code === 'INS')!;
    assert.equal(ins.payee, 'INSURER');
    assert.equal(k.fees.find((x) => x.code === 'DOC')!.total, '16.5');
    assert.equal(k.schedule!.numberOfInstalments, 12);
    assert.equal(k.schedule!.frequency, 'MONTHLY');
    assert.equal(k.schedule!.lastDueDate, schedule.maturityDate);
  });

  test('late-payment, prepayment and lock-in terms come from the contract', () => {
    const c = clone('PERSONAL_INSTALMENT');
    c.pricing.penalty = { type: 'RATE_ON_OVERDUE', flatAmount: null, percentOfOverdue: null, annualRate: '0.06', graceDays: 3, capPerInstalment: null, capPerLoan: '100' };
    c.repayment.earlySettlement = { allowed: true, feeRate: '0.01', feeFixed: null, rebateMethod: 'ACCRUED' };
    c.repayment.earlyRepaymentCharges = {
      appliesTo: ['EARLY_SETTLEMENT'],
      basis: 'OUTSTANDING_PRINCIPAL',
      tiers: [{ untilMonth: 3, action: 'REFUSE', rate: null, fixed: null }, { untilMonth: 6, action: 'CHARGE', rate: '0.02', fixed: null }],
    };
    const { k } = facts(c, { principal: '2000', numberOfInstalments: 12, disbursementDate: '2026-01-05' });
    assert.deepEqual(k.latePayment, {
      type: 'RATE_ON_OVERDUE',
      flatAmount: null,
      percentOfOverduePct: null,
      annualRatePct: '6.00',
      graceDays: 3,
      capPerInstalment: null,
      capPerLoan: '100',
      returnedPaymentFee: c.pricing.returnedPaymentFee,
    });
    assert.equal(k.prepayment.settlementFeePct, '1.00');
    assert.deepEqual(k.lockIn.tiers, [
      { untilMonth: 3, action: 'REFUSE', ratePct: null, fixed: null },
      { untilMonth: 6, action: 'CHARGE', ratePct: '2.00', fixed: null },
    ]);
  });

  test('a credit line has a limit and no schedule', () => {
    const c = clone('PERSONAL_INSTALMENT');
    c.facility = { ...c.facility, type: 'REVOLVING', commitmentFeeRate: '0.005', minimumPaymentRate: '0.05', minimumPaymentFloor: '10' };
    const k = L.buildKeyFacts({
      currency: 'USD',
      principal: '5000',
      disbursementDate: '2026-01-05',
      nominalAnnualRate: '0.15',
      effectiveAnnualRate: null,
      fees: { lines: [], financed: '0', deducted: '0', separate: '0', bookedPrincipal: '5000', netDisbursement: '5000' },
      schedule: null,
      config: c,
    });
    assert.equal(k.schedule, null);
    assert.equal(k.totals.repayable, null);
    assert.deepEqual(k.facility, { type: 'REVOLVING', limit: '5000', commitmentFeePct: '0.50', overlimitRatePct: null, minimumPaymentPct: '5.00', minimumPaymentFloor: '10' });
  });
});

describe('scoring strategy: unknown debt-service ratio (D-126)', () => {
  const strategy = (k: Partial<L.ScoringStrategy['knockouts']>) =>
    L.strategySchema.parse({ defaultOutcome: 'AUTO_APPROVE', knockouts: k });
  const run = (s: L.ScoringStrategy, inputs: Record<string, unknown>) =>
    L.evaluateStrategy(s, { score: 700, grade: 'A', inputs: inputs as never, requestedAmount: '1000', minCreditScore: null });

  test('refers when the ratio is tested but income is unknown (default)', () => {
    const r = run(strategy({ maxDebtServiceRatio: '0.5' }), { debtServiceRatio: null });
    assert.equal(r.outcome, 'REFER');
    assert.ok(r.reasons.some((x) => x.code === 'DEBT_SERVICE_UNKNOWN'));
  });

  test('IGNORE keeps the old behaviour; a known ratio within the limit passes', () => {
    assert.equal(run(strategy({ maxDebtServiceRatio: '0.5', missingDebtServiceRatio: 'IGNORE' }), {}).outcome, 'AUTO_APPROVE');
    assert.equal(run(strategy({ maxDebtServiceRatio: '0.5' }), { debtServiceRatio: '0.3' }).outcome, 'AUTO_APPROVE');
    assert.equal(run(strategy({}), {}).outcome, 'AUTO_APPROVE');
  });

  test('a ratio above the limit still declines', () => {
    assert.equal(run(strategy({ maxDebtServiceRatio: '0.5' }), { debtServiceRatio: '0.7' }).outcome, 'DECLINE');
  });
});

describe('tenant settings: consumer protection and affordability', () => {
  test('defaults: cooling-off 7 days, no lender-count limit', () => {
    const d = L.defaultTenantLendingSettings();
    assert.equal(d.consumerProtection.coolingOffDays, 7);
    assert.equal(d.consumerProtection.coolingOffChargesAccruedInterest, true);
    assert.equal(d.consumerProtection.coolingOffRefundsLenderFees, true);
    assert.equal(d.consumerProtection.licenceNumber, null);
    assert.equal(d.affordability.maxLendersPerBorrower, null);
    assert.equal(d.affordability.includeOwnLoans, true);
  });
});
