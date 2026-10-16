import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const contract: L.ScheduleInput = {
  principal: '10000',
  currency: 'USD',
  disbursementDate: '2025-07-01',
  annualRate: '0.12',
  rateConvention: 'NOMINAL',
  interestMethod: 'REDUCING_BALANCE',
  accrualBasis: 'PERIODIC',
  dayCount: 'ACT_365_FIXED',
  method: 'EQUAL_INSTALMENT',
  frequency: 'MONTHLY',
  numberOfInstalments: 24,
};

const snap = (over: Partial<L.BalanceSnapshot> = {}): L.BalanceSnapshot => ({
  asOf: '2026-02-01',
  currency: 'USD',
  principal: '8000',
  overduePrincipal: '700',
  overdueInterest: '150',
  accruedInterestNotDue: '0',
  fees: '20',
  penalties: '35',
  taxes: '0',
  unallocatedPayments: '0',
  ...over,
});

const rules: L.RestructureRules = { allowInterestCapitalization: true, allowFeeCapitalization: true, allowPenaltyCapitalization: false, maxTotalInstalments: 60, minAnnualRate: '0.10', maxAnnualRate: '0.18' };
const sumOf = (xs: string[]) => xs.reduce((a, b) => a.plus(b), new L.D(0));

describe('affordability', () => {
  test('individual: available = income − expenses − other debts − buffer; this loan is not double counted', () => {
    const r = L.assessAffordability(
      { template: 'INDIVIDUAL', verifiedNetIncome: '1200', essentialLivingExpenses: '700', debts: [{ description: 'Phone plan', monthlyPayment: '50' }, { description: 'This loan', monthlyPayment: '470', isThisLoan: true }] },
      'USD',
    );
    // buffer = max(0.10 × 1200, 50) = 120 → 1200 − 700 − 50 − 120 = 330
    assert.equal(r.availableForThisLoanMonthly, '330');
    assert.deepEqual(r.excludedDebts, ['This loan']);
    assert.equal(r.sustainable, true);
  });

  test('insufficient capacity routes to specialist review instead of a schedule', () => {
    const r = L.assessAffordability({ template: 'INDIVIDUAL', verifiedNetIncome: '600', essentialLivingExpenses: '550', debts: [] }, 'USD');
    // 600 − 550 − 0 − max(60, 50) = −10
    assert.equal(r.availableForThisLoanMonthly, '-10');
    assert.equal(r.sustainable, false);
    assert.equal(r.specialistReview, true);
  });

  test('household sums members; thresholds come from policy, not constants', () => {
    const r = L.assessAffordability(
      { template: 'HOUSEHOLD', members: [{ name: 'A', verifiedNetIncome: '800' }, { name: 'B', verifiedNetIncome: '400' }], essentialLivingExpenses: '700', debts: [] },
      'USD',
      { ...L.DEFAULT_AFFORDABILITY_POLICY, bufferFractionOfIncome: '0.2' },
    );
    assert.equal(r.availableForThisLoanMonthly, '260'); // 1200 − 700 − 240
  });

  test('business: capacity keeps DSCR at the policy minimum across all debts', () => {
    const r = L.assessAffordability(
      { template: 'BUSINESS', operatingCashInflows: '20000', operatingCashOutflows: '15000', taxes: '500', essentialCapitalExpenditure: '1000', requiredWorkingCapitalIncrease: '500', debts: [{ description: 'Equipment lease', monthlyPayment: '800' }] },
      'USD',
    );
    // CFADS = 3000; 3000 / 1.25 − 800 = 1600
    assert.equal(r.availableForThisLoanMonthly, '1600');
    assert.equal(L.dscrWith('3000', '800', '1600'), '1.25');
  });

  test('seasonal: uneven cash flow is checked month by month, not as an annual average', () => {
    const forecast = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].map((m, i) => ({ month: `${m}-01`, inflows: i === 3 ? '6000' : '300', outflows: '400' }));
    const r = L.assessAffordability({ template: 'SEASONAL', forecast, debts: [] }, 'USD');
    assert.equal(r.seasonalCapacity![0].available, '-100');
    assert.equal(r.seasonalCapacity![3].available, '5040'); // (6000 − 400) × 0.9
    // A payment in May fails even though the annual total would cover it.
    assert.equal(L.seasonalScheduleFits(r.seasonalCapacity!, [{ dueDate: '2026-05-15', amount: '1000' }]).fits, false);
    assert.equal(L.seasonalScheduleFits(r.seasonalCapacity!, [{ dueDate: '2026-06-20', amount: '4500' }]).fits, true);
  });
});

describe('term from payment capacity', () => {
  test('n = −ln(1 − P·i/C) / ln(1+i), rounded up (bc: 22.4257… → 23)', () => {
    const r = L.termForCapacity('10000', '0.01', '500');
    assert.equal(r.n, 23);
    assert.equal(r.exact, '22.425742');
  });
  test('zero interest: n = ⌈P / C⌉', () => {
    assert.equal(L.termForCapacity('1000', '0', '300').n, 4);
  });
  test('capacity at or below periodic interest is refused, never negative amortization', () => {
    assert.throws(() => L.termForCapacity('10000', '0.01', '100'), /does not amortize this balance at the selected rate/);
    assert.throws(() => L.calculateRestructure(contract, snap(), { effectiveDate: '2026-02-01', targetInstalment: '79' }, rules), /does not amortize/);
  });
});

describe('restructure calculation', () => {
  test('capacity-driven term: the regenerated schedule fits the capacity', () => {
    // 8,000 + 150 capitalized overdue interest at 1%/month, capacity 400.
    const c = L.calculateRestructure(contract, snap(), { effectiveDate: '2026-02-01', targetInstalment: '400', capitalize: { overdueInterest: true } }, rules);
    assert.equal(c.newPrincipal, '8150');
    // bc: −ln(1 − 8150 × 0.01 / 400) / ln(1.01) = 22.94… → 23
    assert.equal(c.termSolution!.instalments, 23);
    assert.equal(c.termSolution!.method, 'CLOSED_FORM');
    assert.ok(new L.D(c.schedule.instalmentAmount!).lte('400'));
    assert.equal(c.lines[c.lines.length - 1].openingPrincipal !== undefined, true);
  });

  test('prohibited capitalization is refused (penalties, and interest where interest-on-interest is barred)', () => {
    assert.throws(() => L.calculateRestructure(contract, snap(), { effectiveDate: '2026-02-01', numberOfInstalments: 24, capitalize: { penalties: true } }, rules), /PROHIBITED|not permitted/);
    assert.throws(() => L.calculateRestructure(contract, snap(), { effectiveDate: '2026-02-01', numberOfInstalments: 24, capitalize: { overdueInterest: true } }, { ...rules, allowInterestCapitalization: false }), /interest on interest/);
  });

  test('no double counting: capitalized amounts leave the arrears, everything else stays owed', () => {
    const c = L.calculateRestructure(contract, snap(), { effectiveDate: '2026-02-01', numberOfInstalments: 24, capitalize: { overdueInterest: true, fees: true }, waive: { penalties: '35' } }, rules);
    assert.equal(c.newPrincipal, '8170'); // 8000 + 150 + 20
    assert.deepEqual(c.components.payableAtEffectiveDate, { interest: '0', fees: '0', penalties: '0', taxes: '0' });
    assert.equal(c.components.waived.penalties, '35');
    // Principal repaid by the new schedule equals the new principal exactly.
    assert.equal(sumOf(c.lines.map((l) => l.principal)).toString(), '8170');
  });

  test('arrears spread over the term are repaid interest-free, not waived', () => {
    const c = L.calculateRestructure(contract, snap(), { effectiveDate: '2026-02-01', numberOfInstalments: 20, arrearsTreatment: 'SPREAD_OVER_TERM' }, rules);
    assert.equal(c.newPrincipal, '8000');
    const deferred = (k: keyof L.ExtraDue) => sumOf(c.lines.map((l) => l.deferred[k])).toString();
    assert.equal(deferred('interest'), '150');
    assert.equal(deferred('fees'), '20');
    assert.equal(deferred('penalties'), '35');
    assert.equal(c.components.waived.interest, '0');
  });

  test('full payment deferral without capitalization moves (not drops) the deferral interest', () => {
    const c = L.calculateRestructure(contract, snap({ overdueInterest: '0', fees: '0', penalties: '0' }), { effectiveDate: '2026-02-01', numberOfInstalments: 24, paymentDeferralInstalments: 3, deferredInterestTreatment: 'DEFER_NO_CAPITALIZATION' }, rules);
    assert.deepEqual(c.lines.slice(0, 3).map((l) => l.total), ['0', '0', '0']);
    // Interest on 8,000 at 1% for three months = 240, carried into later instalments.
    assert.equal(sumOf(c.lines.map((l) => l.deferred.interest)).toString(), '240');
    assert.equal(c.components.deferred.interest, '240');
    assert.equal(c.concessionValue.futureInterestWaived, '0');
  });

  test('deferral with capitalization grows the principal; with waiver it is a recorded concession', () => {
    const capd = L.calculateRestructure(contract, snap({ overdueInterest: '0', fees: '0', penalties: '0' }), { effectiveDate: '2026-02-01', numberOfInstalments: 24, paymentDeferralInstalments: 2, deferredInterestTreatment: 'CAPITALIZE' }, rules);
    assert.equal(capd.schedule.totals.capitalizedInterest, '160.8'); // 80 + 80.80
    const waived = L.calculateRestructure(contract, snap({ overdueInterest: '0', fees: '0', penalties: '0' }), { effectiveDate: '2026-02-01', numberOfInstalments: 24, paymentDeferralInstalments: 2, deferredInterestTreatment: 'WAIVE' }, rules);
    assert.equal(waived.concessionValue.futureInterestWaived, '160');
    assert.throws(
      () => L.calculateRestructure(contract, snap(), { effectiveDate: '2026-02-01', numberOfInstalments: 24, paymentDeferralInstalments: 2, deferredInterestTreatment: 'CAPITALIZE' }, { ...rules, allowInterestCapitalization: false }),
      /not permitted/,
    );
  });

  test('temporary interest-only and temporary rate reduction, with the concession valued', () => {
    const c = L.calculateRestructure(contract, snap({ overdueInterest: '0', fees: '0', penalties: '0' }), { effectiveDate: '2026-02-01', numberOfInstalments: 24, interestOnlyInstalments: 3, temporaryRate: { annualRate: '0.06', instalments: 6 } }, rules);
    assert.deepEqual(c.lines.slice(0, 3).map((l) => l.principal), ['0', '0', '0']);
    assert.equal(c.lines[0].interest, '40'); // 8,000 × 0.06 / 12
    assert.equal(c.lines[6].annualRate, '0.12');
    assert.ok(new L.D(c.concessionValue.rateReduction).gt(0));
  });

  test('a lower instalment can cost more interest overall — the comparison says so', () => {
    const c = L.calculateRestructure(contract, snap({ overdueInterest: '0', fees: '0', penalties: '0' }), { effectiveDate: '2026-02-01', numberOfInstalments: 48 }, rules);
    const original: L.OriginalRemaining = {
      instalmentAmount: '470.73',
      maturityDate: '2027-07-01',
      lines: Array.from({ length: 18 }, (_, i) => ({ dueDate: `2026-${String((i % 12) + 2).padStart(2, '0')}-01`, principal: (8000 / 18).toFixed(2), interest: '50', charges: '0' })),
    };
    const cmp = L.compareRestructure(original, c);
    assert.equal(cmp.lowerInstalmentHigherCost, true);
    assert.match(cmp.warnings[0], /increases total future interest/);
  });

  test('due-date change uses actual intervals; seasonal alignment uses dated principal', () => {
    const moved = L.calculateRestructure(contract, snap({ overdueInterest: '0', fees: '0', penalties: '0' }), { effectiveDate: '2026-02-01', numberOfInstalments: 12, firstDueDate: '2026-03-20' }, rules);
    assert.equal(moved.scheduleInput.accrualBasis, 'DAILY');
    assert.equal(moved.lines[0].dueDate, '2026-03-20');
    const seasonal = L.calculateRestructure(contract, snap({ overdueInterest: '0', fees: '0', penalties: '0' }), { effectiveDate: '2026-02-01', explicitSchedule: [{ dueDate: '2026-06-20', principal: '3000' }, { dueDate: '2026-11-20', principal: '5000' }] }, rules);
    assert.deepEqual(seasonal.lines.map((l) => l.principal), ['3000', '5000']);
    assert.equal(seasonal.scheduleInput.method, 'EXPLICIT');
  });

  test('rates outside the product range are an exception or refused', () => {
    const c = L.calculateRestructure(contract, snap(), { effectiveDate: '2026-02-01', numberOfInstalments: 24, annualRate: '0.08' }, rules);
    assert.match(c.policyExceptions[0], /below the product minimum/);
    assert.throws(() => L.calculateRestructure(contract, snap(), { effectiveDate: '2026-02-01', numberOfInstalments: 24, annualRate: '0.20' }, rules), /exceeds the product maximum/);
  });

  test('payments awaiting allocation block a snapshot; drift between proposal and execution is detected', () => {
    assert.throws(() => L.calculateRestructure(contract, snap({ unallocatedPayments: '10' }), { effectiveDate: '2026-02-01', numberOfInstalments: 24 }, rules), /Allocate pending payments/);
    const drift = L.snapshotDrift(snap(), snap({ overdueInterest: '100' }), '0');
    assert.equal(drift.material, true);
    assert.deepEqual(drift.differences.map((d) => d.field), ['overdueInterest']);
    assert.equal(L.snapshotDrift(snap(), snap({ overdueInterest: '149.5' }), '1').material, false);
  });
});
