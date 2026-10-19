/** The interest-rate cap (NBC Prakas B7-017-109; DECISIONS D-105…D-112). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const CEILING = '0.18';
const cap18 = L.resolveRateCap({ regulatorCeiling: CEILING });
const DEFAULT_POLICY = L.rateCapPolicyOf(L.defaultTenantLendingSettings());
const clone = (code: string): L.ProductConfig => structuredClone(L.TEMPLATE_BY_CODE[code].defaultConfig);

function book(c: L.ProductConfig, terms: L.NegotiatedTerms) {
  const fees = L.computeUpfrontFees(terms.principal, c.identity.currency, c.pricing.rounding, L.feesOf(c), terms.waivedFeeCodes);
  const calendar = c.repayment.holidayCalendarCode ? { code: c.repayment.holidayCalendarCode, weekendDays: [], holidays: [] } : undefined;
  const input = L.toScheduleInput(c, terms, fees.bookedPrincipal, calendar);
  return L.scheduleRates(input, L.generateSchedule(input), fees);
}

describe('resolving the cap in force', () => {
  test('the lowest configured cap applies, and says which it is', () => {
    const r = L.resolveRateCap({ regulatorCeiling: '0.18', tenantCap: '0.16', productCap: '0.17' });
    assert.equal(r.annualRate, '0.16');
    assert.equal(r.source, 'TENANT');
    assert.match(r.description, /lender's interest-rate cap of 16\.00%/);
    assert.equal(L.resolveRateCap({ regulatorCeiling: '0.18', tenantCap: '0.2', productCap: '0.15' }).source, 'PRODUCT');
  });

  test('a tie names the regulator; nothing configured means no cap', () => {
    assert.equal(L.resolveRateCap({ regulatorCeiling: '0.18', tenantCap: '0.18', productCap: '0.18' }).source, 'REGULATOR');
    const none = L.resolveRateCap({ regulatorCeiling: null, tenantCap: undefined, productCap: null });
    assert.equal(none.annualRate, null);
    assert.equal(L.checkRateAgainstCap('CONTRACT_RATE', 'x', 'Rate', '0.5', none), null);
  });

  test('percent settings convert to fractions; zero or absent is no cap', () => {
    assert.equal(L.pctToFraction(18), '0.18');
    assert.equal(L.pctToFraction('16.50'), '0.165');
    assert.equal(L.pctToFraction(null), null);
    assert.equal(L.pctToFraction(0), null);
  });

  test('the defaults count fees and cap penalty interest (conservative)', () => {
    assert.deepEqual(DEFAULT_POLICY, { includeFeesInEffectiveRate: true, penaltyRateMustFitCap: true });
  });
});

describe('comparing on one basis', () => {
  test('a flat rate is compared as the reducing-balance rate its schedule charges', () => {
    const c = clone('MURABAHA');
    // 12% flat on 10,000 over 12 months is the textbook ~21.45% reducing-balance rate.
    const r = book(c, { principal: '10000', numberOfInstalments: 12, annualRate: '0.10', disbursementDate: '2026-01-05' });
    assert.equal(r.basis, 'FLAT_EQUIVALENT');
    assert.equal(r.contractRate, '0.1');
    assert.ok(new L.D(r.comparableRate).gt('0.179') && new L.D(r.comparableRate).lt('0.181'), r.comparableRate);
    c.pricing.fixed!.maxAnnualRate = '0.12';
    const r12 = book(c, { principal: '10000', numberOfInstalments: 12, annualRate: '0.12', disbursementDate: '2026-01-05' });
    assert.ok(new L.D(r12.comparableRate).gt('0.2145') && new L.D(r12.comparableRate).lt('0.2147'), r12.comparableRate);
    const [finding] = L.checkScheduleRates(r12, cap18, DEFAULT_POLICY);
    assert.equal(finding.code, 'FLAT_EQUIVALENT_RATE');
    assert.match(finding.message, /flat rate 12\.00% \(21\.4\d%, computed\) exceeds the regulatory ceiling \(REGULATORY_MAX_ANNUAL_RATE_PCT\) of 18\.00%/);
  });

  test('a reducing-balance rate is compared as agreed; without fees the effective rate is the same', () => {
    const c = clone('SALARY_LOAN');
    const r = book(c, { principal: '1000', numberOfInstalments: 12, annualRate: '0.18', disbursementDate: '2026-01-05' });
    assert.deepEqual([r.basis, r.comparableRate, r.effectiveRate], ['CONTRACT', '0.18', '0.18']);
    assert.deepEqual(L.checkScheduleRates(r, cap18, DEFAULT_POLICY), []);
    const above = book(c, { principal: '1000', numberOfInstalments: 12, annualRate: '0.18', disbursementDate: '2026-01-05' });
    assert.deepEqual(L.checkScheduleRates({ ...above, contractRate: '0.1801', comparableRate: '0.1801' }, cap18, DEFAULT_POLICY).map((f) => f.code), ['CONTRACT_RATE']);
  });

  test('fees count toward the effective rate only when the lender says so', () => {
    const c = clone('PERSONAL_INSTALMENT'); // 1% processing fee, deducted
    const r = book(c, { principal: '5000', numberOfInstalments: 12, annualRate: '0.175', disbursementDate: '2026-01-05' });
    assert.ok(new L.D(r.effectiveRate).gt('0.19'), r.effectiveRate);
    const findings = L.checkScheduleRates(r, cap18, DEFAULT_POLICY);
    assert.deepEqual(findings.map((f) => f.code), ['EFFECTIVE_RATE']);
    assert.match(findings[0].message, /effective annual rate including fees \(19\.\d\d%, computed\) exceeds/);
    assert.deepEqual(L.checkScheduleRates(r, cap18, { ...DEFAULT_POLICY, includeFeesInEffectiveRate: false }), []);
    // Waiving the fee brings it back under.
    const waived = book(c, { principal: '5000', numberOfInstalments: 12, annualRate: '0.175', disbursementDate: '2026-01-05', waivedFeeCodes: ['PROCESSING'] });
    assert.deepEqual(L.checkScheduleRates(waived, cap18, DEFAULT_POLICY), []);
  });

  test('rounding alone cannot tip a loan priced at the cap over it', () => {
    const c = clone('SALARY_LOAN');
    const terms = { principal: '137', numberOfInstalments: 7, annualRate: '0.18', disbursementDate: '2026-01-05' };
    const input = L.toScheduleInput(c, terms, '137');
    const schedule = L.generateSchedule(input);
    // Cent rounding of each month's interest puts the raw IRR a little above 18%…
    const raw = L.scheduleEquivalentRate('137', schedule.lines, '2026-01-05', { regular: true, periodsPerYear: '12' });
    assert.ok(new L.D(raw).gt('0.1801'), raw);
    // …but fees are measured as what they add to the contract rate, so the noise cancels.
    const fee = L.computeUpfrontFees('137', 'USD', c.pricing.rounding, [{ code: 'F', name: 'F', calculation: 'FIXED', amount: '0.01', treatment: 'SEPARATE', waivable: false }]);
    const none = L.computeUpfrontFees('137', 'USD', c.pricing.rounding, []);
    assert.equal(L.scheduleRates(input, schedule, none).effectiveRate, '0.18');
    assert.deepEqual(L.checkScheduleRates(L.scheduleRates(input, schedule, none), cap18, DEFAULT_POLICY), []);
    // A one-cent fee on 137 over seven months adds about 0.02% a year — and that is a breach.
    const r = L.scheduleRates(input, schedule, fee);
    assert.ok(new L.D(r.effectiveRate).gt('0.1801') && new L.D(r.effectiveRate).lt('0.1803'), r.effectiveRate);
    assert.deepEqual(L.checkScheduleRates(r, cap18, DEFAULT_POLICY).map((f) => f.code), ['EFFECTIVE_RATE']);
    // Computed rates are compared at 0.01%.
    assert.equal(L.checkRateAgainstCap('EFFECTIVE_RATE', 'fees', 'Rate', '0.18004', cap18, true), null);
    assert.notEqual(L.checkRateAgainstCap('EFFECTIVE_RATE', 'fees', 'Rate', '0.18006', cap18, true), null);
  });

  test('an income-contingent schedule is held to its contract rate; its fees have no IRR to measure', () => {
    const c = clone('INCOME_CONTINGENT_EDUCATION');
    c.pricing.fees = [{ code: 'ADMIN', name: 'Admin', calculation: 'FIXED', amount: '50', treatment: 'DEDUCTED', waivable: false, payee: 'LENDER' }];
    const r = book(c, { principal: '5000', numberOfInstalments: 60, annualRate: '0.05', disbursementDate: '2026-01-05', declaredAnnualIncome: '0' });
    assert.deepEqual([r.comparableRate, r.effectiveRate], ['0.05', '0.05']);
  });

  test('irregular dates use the dated IRR, annualised as often as the schedule pays', () => {
    // A single payment after half a year at 18% simple interest.
    const rate = L.scheduleEquivalentRate('1000', [{ dueDate: '2026-07-04', total: '1089.26' }], '2026-01-05', { regular: false, periodsPerYear: null });
    assert.ok(new L.D(rate).gt('0.179') && new L.D(rate).lt('0.181'), rate);
  });
});

describe('floating rates', () => {
  const terms: L.FloatingTerms = { benchmarkCode: 'SOFR', margin: '0.09', resetFrequency: 'QUARTERLY', floor: null, cap: null };
  const obs = { benchmarkCode: 'SOFR', observationDate: '2026-04-01', rate: '0.11' };

  test('a reset is held at the cap, not refused', () => {
    const r = L.resolveFloatingRate(terms, obs, '0.18');
    assert.deepEqual([r.annualRate, r.bound, r.indicated], ['0.18', 'REGULATORY_CAP', '0.2']);
    assert.match(r.source, /regulatory cap 0\.18 applied/);
    assert.equal(L.resolveFloatingRate(terms, { ...obs, rate: '0.05' }, '0.18').bound, 'BENCHMARK');
    assert.equal(L.resolveFloatingRate(terms, obs).annualRate, '0.2');
  });

  test("a product's own floating cap must fit under the cap; without one, benchmark + margin must", () => {
    const c = clone('SYNDICATED');
    c.attributes.rateType = 'FLOATING';
    c.pricing.fixed = null;
    c.pricing.floating = { ...terms, cap: '0.2' };
    const withCap = L.productRateCapReport(c, cap18, DEFAULT_POLICY, { asOf: '2026-01-05', benchmarkRate: '0.05' });
    assert.deepEqual(withCap.findings.map((f) => f.code), ['FLOATING_CAP']);
    c.pricing.floating = { ...terms, cap: null };
    const high = L.productRateCapReport(c, cap18, DEFAULT_POLICY, { asOf: '2026-01-05', benchmarkRate: '0.11' });
    assert.deepEqual(high.findings.map((f) => f.code), ['FLOATING_RATE']);
    assert.match(high.findings[0].message, /SOFR 11\.00% \+ margin 9\.00% =? ?\(20\.00%\) exceeds/);
    const ok = L.productRateCapReport(c, cap18, DEFAULT_POLICY, { asOf: '2026-01-05', benchmarkRate: '0.05' });
    assert.deepEqual(ok.findings, []);
    assert.equal(ok.worstComparableRate, '0.14');
  });
});

describe('the other rates a product charges', () => {
  test('penalty interest must fit unless the lender has decided otherwise', () => {
    const c = clone('SALARY_LOAN');
    c.pricing.penalty = { ...c.pricing.penalty, type: 'RATE_ON_OVERDUE', annualRate: '0.24' };
    assert.deepEqual(L.productRateCapReport(c, cap18, DEFAULT_POLICY, { asOf: '2026-01-05' }).findings.map((f) => f.code), ['PENALTY_RATE']);
    assert.deepEqual(L.productRateCapReport(c, cap18, { ...DEFAULT_POLICY, penaltyRateMustFitCap: false }, { asOf: '2026-01-05' }).findings, []);
  });

  test('card cash-advance and instalment-plan rates, and the promotional rate', () => {
    const c = clone('CREDIT_CARD');
    c.card!.cashAdvanceAnnualRate = '0.24';
    c.card!.instalmentPlan!.annualRate = '0.19';
    assert.deepEqual(
      L.productRateCapReport(c, cap18, DEFAULT_POLICY, { asOf: '2026-01-05' }).findings.map((f) => f.code),
      ['CARD_CASH_ADVANCE_RATE', 'CARD_PLAN_RATE'],
    );
    const p = clone('SALARY_LOAN');
    p.pricing.promotion = { code: 'PROMO', annualRate: '0.2', instalments: 2, label: '' };
    assert.deepEqual(L.productRateCapReport(p, cap18, DEFAULT_POLICY, { asOf: '2026-01-05' }).findings.map((f) => f.code), ['PROMOTION_RATE']);
  });

  test('a lower lender cap blocks a maximum rate the regulator would allow', () => {
    const c = clone('SALARY_LOAN');
    const cap = L.resolveRateCap({ regulatorCeiling: '0.18', tenantCap: '0.15' });
    const [f] = L.productRateCapReport(c, cap, DEFAULT_POLICY, { asOf: '2026-01-05' }).findings;
    assert.equal(f.code, 'CONTRACT_RATE');
    assert.equal(f.message, "The maximum annual rate (18.00%) exceeds the lender's interest-rate cap of 15.00%.");
  });

  test('fees at the edge of the limits are advisories at product level, not refusals', () => {
    const r = L.productRateCapReport(clone('PERSONAL_INSTALMENT'), cap18, DEFAULT_POLICY, { asOf: '2026-01-05' });
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.advisories.map((f) => f.code), ['EFFECTIVE_RATE']);
    assert.match(r.advisories[0].message, /^At 100 USD over 3 instalment\(s\) and the highest rate/);
  });

  test('restructure rates: permanent and temporary', () => {
    assert.deepEqual(L.restructureRateFindings('0.15', '0.2', cap18).map((f) => f.code), ['TEMPORARY_RATE']);
    assert.deepEqual(L.restructureRateFindings('0.19', null, cap18).map((f) => f.code), ['RESTRUCTURE_RATE']);
    assert.deepEqual(L.restructureRateFindings('0.18', '0.05', cap18), []);
  });
});

describe('the catalogue', () => {
  test('every available template fits under an 18% ceiling with the default settings', () => {
    for (const t of L.PRODUCT_TEMPLATES.filter((x) => L.templateAvailability(x).available)) {
      const cap = L.resolveRateCap({ regulatorCeiling: CEILING, productCap: t.defaultConfig.pricing.regulatoryCapAnnualRate });
      const r = L.productRateCapReport(t.defaultConfig, cap, DEFAULT_POLICY, { asOf: '2026-01-05', benchmarkRate: '0.05' });
      assert.deepEqual(r.findings, [], `${t.code}: ${r.findings.map((f) => f.message).join(' ')}`);
    }
  });

  test('the microfinance template books at its default rate with its fee under the cap', () => {
    const c = clone('MICRO_INDIVIDUAL');
    const r = book(c, { principal: '1500', numberOfInstalments: 26, disbursementDate: '2026-01-05' });
    assert.deepEqual(L.checkScheduleRates(r, cap18, DEFAULT_POLICY), []);
  });
});
