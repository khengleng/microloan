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
    // Which templates are still blocked changes as capabilities ship; the rule does not.
    const blocked = L.PRODUCT_TEMPLATES.filter((t) =>
      [...L.requiredCapabilitiesFor(t.defaultConfig), ...t.extraCapabilities].some((id) => L.CAPABILITY_BY_ID[id]?.status !== 'IMPLEMENTED'),
    );
    for (const t of L.PRODUCT_TEMPLATES) {
      const a = L.templateAvailability(t);
      assert.equal(a.available, !blocked.includes(t), `${t.code}: ${JSON.stringify(a.missing)}`);
      if (!a.available) assert.ok(a.missing.length > 0);
    }
  });

  test('institutional, income-contingent and Murabaha templates became available with their capabilities', () => {
    const need: Record<string, string> = {
      INTERBANK: 'institutional.counterparty_limits',
      MUNICIPAL: 'institutional.counterparty_limits',
      SOVEREIGN: 'institutional.counterparty_limits',
      DEVELOPMENT_CONCESSIONAL: 'institutional.counterparty_limits',
      INCOME_CONTINGENT_EDUCATION: 'education.income_contingent',
      MURABAHA: 'islamic.murabaha',
    };
    for (const [code, cap] of Object.entries(need)) {
      const a = L.templateAvailability(L.TEMPLATE_BY_CODE[code]);
      assert.ok(a.available, `${code} missing ${JSON.stringify(a.missing)}`);
      assert.ok(a.requiredCapabilities.includes(cap), `${code} requires ${cap}`);
      assert.equal(L.CAPABILITY_BY_ID[cap].status, 'IMPLEMENTED');
    }
  });

  test('the Phase 2 templates became available with their capabilities', () => {
    for (const code of ['CONSTRUCTION', 'HOME_EQUITY_LINE', 'OVERDRAFT', 'REVOLVING_CREDIT', 'MICRO_GROUP', 'INVOICE_BACKED', 'LETTER_OF_CREDIT', 'SYNDICATED']) {
      const a = L.templateAvailability(L.TEMPLATE_BY_CODE[code]);
      assert.ok(a.available, `${code} missing ${JSON.stringify(a.missing)}`);
    }
  });

  test('project, infrastructure, acquisition and inventory-backed templates became available with their capabilities', () => {
    const need: Record<string, string[]> = {
      PROJECT_FINANCE: ['project_finance.waterfall', 'covenants.monitoring', 'facility.staged_drawdown'],
      INFRASTRUCTURE: ['project_finance.waterfall', 'covenants.monitoring', 'facility.staged_drawdown'],
      ACQUISITION_FINANCE: ['covenants.monitoring'],
      INVENTORY_BACKED: ['collateral.borrowing_base', 'facility.revolving', 'collateral.ltv'],
    };
    for (const [code, caps] of Object.entries(need)) {
      const a = L.templateAvailability(L.TEMPLATE_BY_CODE[code]);
      assert.ok(a.available, `${code} missing ${JSON.stringify(a.missing)}`);
      for (const cap of caps) assert.ok(a.requiredCapabilities.includes(cap), `${code} requires ${cap}`);
    }
  });

  test('project finance, borrowing base and covenant terms are refused on the wrong product shape', () => {
    const issues = (code: string, mutate: (c: any) => void) => {
      const c = structuredClone(L.TEMPLATE_BY_CODE[code].defaultConfig) as any;
      mutate(c);
      const r = L.validateProductConfig(c);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    assert.ok(issues('CORPORATE_TERM', (c) => { c.projectFinance = L.TEMPLATE_BY_CODE.PROJECT_FINANCE.defaultConfig.projectFinance; }).includes('projectFinance'));
    assert.ok(issues('PROJECT_FINANCE', (c) => { c.projectFinance.targetDscr = '0.9'; }).includes('projectFinance.targetDscr'));
    assert.ok(issues('PROJECT_FINANCE', (c) => { c.projectFinance.lockUpDscr = '1.5'; }).includes('projectFinance.lockUpDscr'));
    assert.ok(issues('CORPORATE_TERM', (c) => { c.borrowingBase = L.TEMPLATE_BY_CODE.INVENTORY_BACKED.defaultConfig.borrowingBase; }).includes('borrowingBase'));
    assert.ok(issues('INVENTORY_BACKED', (c) => { c.borrowingBase.classes[1].code = 'RAW_MATERIALS'; }).includes('borrowingBase.classes.1.code'));
    assert.ok(issues('ACQUISITION_FINANCE', (c) => { c.covenants[0].threshold = null; }).includes('covenants.0.threshold'));
    assert.ok(issues('ACQUISITION_FINANCE', (c) => { c.covenants[3].threshold = '1'; }).includes('covenants.3.threshold'));
    assert.deepEqual(issues('ACQUISITION_FINANCE', () => undefined), []);
  });

  test('the Phase 3 card, BNPL and lease templates became available with their capabilities', () => {
    const need: Record<string, string> = { CREDIT_CARD: 'card.revolving_credit', BNPL: 'bnpl.merchant_settlement', IJARAH: 'islamic.ijarah' };
    for (const [code, cap] of Object.entries(need)) {
      const a = L.templateAvailability(L.TEMPLATE_BY_CODE[code]);
      assert.ok(a.available, `${code} missing ${JSON.stringify(a.missing)}`);
      assert.ok(a.requiredCapabilities.includes(cap), `${code} requires ${cap}`);
    }
    assert.ok(L.templateAvailability(L.TEMPLATE_BY_CODE.IJARAH).requiredCapabilities.includes('lease.true_lease'));
  });

  test('card, BNPL and lease terms are refused on the wrong product shape', () => {
    const issues = (code: string, mutate: (c: any) => void) => {
      const c = structuredClone(L.TEMPLATE_BY_CODE[code].defaultConfig) as any;
      mutate(c);
      const r = L.validateProductConfig(c);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    assert.deepEqual(issues('CREDIT_CARD', () => undefined), []);
    assert.ok(issues('PERSONAL_INSTALMENT', (c) => { c.card = L.TEMPLATE_BY_CODE.CREDIT_CARD.defaultConfig.card; }).includes('card'));
    assert.ok(issues('CREDIT_CARD', (c) => { c.card.cashAdvanceFeeRate = null; c.card.cashAdvanceFeeMinimum = null; }).includes('card.cashAdvanceFeeRate'));
    assert.ok(issues('OVERDRAFT', (c) => { c.bnpl = { merchantDiscountRate: '0.03' }; }).includes('bnpl'));
    assert.ok(issues('IJARAH', (c) => { c.lease = null; }).includes('lease'));
    assert.ok(issues('IJARAH', (c) => { c.repayment.method = 'EQUAL_INSTALMENT'; }).includes('repayment.method'));
  });

  test('a lease posts rentals as rental income and late charges to charity, not as interest', () => {
    const acc = L.TEMPLATE_BY_CODE.IJARAH.defaultConfig.accounting;
    assert.equal(acc.loansReceivable, '1250');
    assert.equal(acc.interestIncome, '4510');
    assert.equal(acc.penaltyIncome, '2800');
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
