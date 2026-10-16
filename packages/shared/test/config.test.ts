import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

describe('product catalogue', () => {
  test('every template default configuration passes full validation', () => {
    for (const t of L.PRODUCT_TEMPLATES) {
      const r = L.validateProductConfig(t.defaultConfig);
      assert.ok(r.ok, `${t.code}: ${!r.ok ? JSON.stringify(r.issues) : ''}`);
    }
  });

  test('all ten families are seeded with templates', () => {
    for (const f of L.LOAN_FAMILY_DEFINITIONS) {
      assert.ok(L.PRODUCT_TEMPLATES.some((t) => t.familyCode === f.code), `${f.code} has templates`);
    }
  });

  test('the Phase 1 slice templates are available', () => {
    const slice = L.PRODUCT_TEMPLATES.filter((t) => t.phase1Slice).map((t) => t.code).sort();
    assert.deepEqual(slice, ['AGRI_CROP_SEASONAL', 'HOME_MORTGAGE', 'MICRO_INDIVIDUAL', 'PERSONAL_INSTALMENT', 'SME_TERM']);
    for (const code of slice) {
      const a = L.templateAvailability(L.TEMPLATE_BY_CODE[code]);
      assert.ok(a.available, `${code} missing ${JSON.stringify(a.missing)}`);
    }
  });

  test('specialized products are seeded unavailable until their capabilities exist', () => {
    for (const code of [
      'CREDIT_CARD', 'BNPL', 'FACTORING', 'FORFAITING', 'INCOME_CONTINGENT_EDUCATION', 'MURABAHA', 'IJARAH',
      'SYNDICATED', 'PROJECT_FINANCE',
      'INVOICE_BACKED', 'SUPPLY_CHAIN_FINANCE', 'INTERBANK', 'SOVEREIGN',
    ]) {
      const a = L.templateAvailability(L.TEMPLATE_BY_CODE[code]);
      assert.equal(a.available, false, `${code} must be unavailable`);
      assert.ok(a.missing.length > 0);
    }
  });

  test('the Phase 2 templates became available with their capabilities', () => {
    for (const code of ['CONSTRUCTION', 'HOME_EQUITY_LINE', 'OVERDRAFT', 'REVOLVING_CREDIT', 'MICRO_GROUP']) {
      const a = L.templateAvailability(L.TEMPLATE_BY_CODE[code]);
      assert.ok(a.available, `${code} missing ${JSON.stringify(a.missing)}`);
    }
  });

  test('a credit card still needs its own Phase 3 capability, not just a revolving limit', () => {
    const a = L.templateAvailability(L.TEMPLATE_BY_CODE['CREDIT_CARD']);
    assert.equal(a.available, false);
    assert.deepEqual(a.missing.map((m) => m.id), ['card.revolving_credit']);
  });

  test('Murabaha and Ijarah are distinct structures, not relabelled loans', () => {
    assert.equal(L.TEMPLATE_BY_CODE.MURABAHA.defaultConfig.attributes.structure, 'MURABAHA');
    assert.equal(L.TEMPLATE_BY_CODE.IJARAH.defaultConfig.attributes.structure, 'IJARAH');
    assert.ok(L.templateAvailability(L.TEMPLATE_BY_CODE.MURABAHA).requiredCapabilities.includes('islamic.murabaha'));
    assert.ok(L.templateAvailability(L.TEMPLATE_BY_CODE.IJARAH).requiredCapabilities.includes('islamic.ijarah'));
  });
});

describe('configuration validation', () => {
  const good = () => structuredClone(L.TEMPLATE_BY_CODE.PERSONAL_INSTALMENT.defaultConfig) as Record<string, any>;

  test('unknown keys are rejected — configuration cannot smuggle code', () => {
    const c = good();
    c.pricing.formula = 'principal * 2';
    const r = L.validateProductConfig(c);
    assert.equal(r.ok, false);
    const c2 = good();
    c2.script = 'process.exit(1)';
    assert.equal(L.validateProductConfig(c2).ok, false);
  });

  test('cross-field rules', () => {
    const c = good();
    c.pricing.fixed.maxAnnualRate = '0.25';
    const r = L.validateProductConfig(c);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.issues.some((i) => i.message.includes('regulatory cap')));

    const d = good();
    d.repayment.allowIrregularFirstPeriod = true; // PERIODIC accrual
    const r2 = L.validateProductConfig(d);
    assert.ok(!r2.ok && r2.issues.some((i) => i.message.includes('DAILY')));

    const e = good();
    e.operations.delinquencyBuckets = [{ code: 'CURRENT', label: 'Current', minDpd: 0, maxDpd: 0 }, { code: 'LATE', label: 'Late', minDpd: 5, maxDpd: null }];
    assert.equal(L.validateProductConfig(e).ok, false);
  });

  test('a floating-rate product can now be activated: resets are implemented', () => {
    const c = good();
    c.attributes.rateType = 'FLOATING';
    c.pricing.fixed = null;
    c.pricing.floating = { benchmarkCode: 'SOFR', margin: '0.03', resetFrequency: 'QUARTERLY', floor: '0', cap: null };
    const r = L.validateProductConfig(c);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.issues));
    const required = L.requiredCapabilitiesFor(r.ok ? r.config : (null as never));
    assert.ok(required.includes('pricing.floating_rate'));
    assert.deepEqual(L.missingCapabilities(required), []);
  });

  test('negotiated terms are checked against product limits', () => {
    const c = L.TEMPLATE_BY_CODE.PERSONAL_INSTALMENT.defaultConfig;
    assert.ok(L.checkTerms(c, { principal: '5000', numberOfInstalments: 12, disbursementDate: '2024-01-15' }).ok);
    const bad = L.checkTerms(c, { principal: '50000', numberOfInstalments: 99, annualRate: '0.30', disbursementDate: '2024-01-15', firstDueDate: '2024-03-01' });
    assert.deepEqual(bad.issues.map((i) => i.path).sort(), ['annualRate', 'firstDueDate', 'numberOfInstalments', 'principal']);
  });

  test('diffs list changed leaves for approval review', () => {
    const before = L.TEMPLATE_BY_CODE.PERSONAL_INSTALMENT.defaultConfig;
    const after = structuredClone(before);
    after.pricing.fixed!.defaultAnnualRate = '0.16';
    after.limits.maxAmount = '12000';
    assert.deepEqual(L.diffConfigs(before, after).map((d) => d.path), ['limits.maxAmount', 'pricing.fixed.defaultAnnualRate']);
    assert.equal(L.canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  });

  test('every template schedule can be simulated from its defaults', () => {
    for (const code of ['PERSONAL_INSTALMENT', 'MICRO_INDIVIDUAL', 'SME_TERM', 'HOME_MORTGAGE', 'AGRI_CROP_SEASONAL']) {
      const c = L.TEMPLATE_BY_CODE[code].defaultConfig;
      const terms: L.NegotiatedTerms =
        c.repayment.method === 'EXPLICIT'
          ? { principal: '1000', disbursementDate: '2024-03-01', explicitSchedule: [{ dueDate: '2024-08-15', principal: '400' }, { dueDate: '2024-12-16', principal: '600' }] }
          : { principal: c.limits.minAmount, numberOfInstalments: c.limits.minInstalments, disbursementDate: '2024-03-01' };
      const calendar = c.repayment.holidayCalendarCode ? { code: 'KH', weekendDays: [6, 7], holidays: [] } : undefined;
      const s = L.generateSchedule(L.toScheduleInput(c, terms, terms.principal, calendar));
      assert.equal(s.lines[s.lines.length - 1].closingPrincipal, '0', code);
    }
  });
});
