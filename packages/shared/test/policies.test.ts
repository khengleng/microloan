/**
 * Composable policies and lock-in charges (docs/servicing/POLICY_MODEL.md;
 * DECISIONS D-003, D-004, D-005). UC-32.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const product = (): L.ProductConfig => {
  const r = L.validateProductConfig(L.TEMPLATE_BY_CODE['PERSONAL_INSTALMENT'].defaultConfig);
  assert.ok(r.ok);
  return r.config;
};

const LOCK_IN: L.PolicyDefinition = {
  kind: 'PREPAYMENT',
  code: 'P-LOCK',
  version: 1,
  parameters: { lockInMonths: { type: 'int', default: 12, min: 6, max: 24 } },
  body: {
    prepayment: { allowed: true, minAmount: null, feeRate: null, allowedStrategies: ['RECAST', 'SHORTEN'], defaultStrategy: 'RECAST' },
    earlySettlement: { allowed: true, feeRate: '0.01', feeFixed: null },
    earlyRepaymentCharges: {
      appliesTo: ['PARTIAL_PREPAYMENT', 'EARLY_SETTLEMENT'],
      basis: 'AMOUNT_REPAID',
      tiers: [{ untilMonth: { $param: 'lockInMonths' }, action: 'CHARGE', rate: '0.03', fixed: null }],
    },
  },
};

describe('policy resolution', () => {
  test('uses the declared default when the contract sets nothing', () => {
    const r = L.resolvePolicy(LOCK_IN);
    assert.deepEqual(r.parameters, { lockInMonths: 12 });
    const tiers = (r.body.earlyRepaymentCharges as { tiers: { untilMonth: number }[] }).tiers;
    assert.equal(tiers[0].untilMonth, 12);
  });

  test('accepts a value inside the product’s narrower bounds', () => {
    const r = L.resolvePolicy(LOCK_IN, { lockInMonths: 18 }, { lockInMonths: { min: 12, max: 18 } });
    assert.equal(r.parameters.lockInMonths, 18);
  });

  test('refuses a value outside the product’s bounds even if the policy allows it', () => {
    assert.throws(() => L.resolvePolicy(LOCK_IN, { lockInMonths: 24 }, { lockInMonths: { min: 12, max: 18 } }), /between 12 and 18/);
  });

  test('refuses a parameter the policy does not declare', () => {
    assert.throws(() => L.resolvePolicy(LOCK_IN, { graceDays: 3 }), /no parameter "graceDays"/);
  });

  test('refuses a fractional value for a whole-number parameter', () => {
    assert.throws(() => L.resolvePolicy(LOCK_IN, { lockInMonths: 12.5 }), /whole number/);
  });

  test('a policy cannot reach outside the part it owns', () => {
    const bad: L.PolicyDefinition = { ...LOCK_IN, body: { ...LOCK_IN.body, allocation: {} } };
    assert.throws(() => L.resolvePolicy(bad), /may only set prepayment, earlySettlement, earlyRepaymentCharges/);
  });
});

describe('contract composition', () => {
  test('lays the policy over its part and leaves the rest of the product alone', () => {
    const base = product();
    const r = L.composeContractConfig(base, [L.resolvePolicy(LOCK_IN, { lockInMonths: 9 })]);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.issues));
    assert.equal(r.config.repayment.earlyRepaymentCharges.tiers[0].untilMonth, 9);
    assert.equal(r.config.repayment.earlySettlement.feeRate, '0.01');
    assert.deepEqual(r.config.pricing, base.pricing);
    assert.deepEqual(r.config.repayment.allocation, base.repayment.allocation);
  });

  test('an invalid combination is reported, not composed', () => {
    const broken: L.PolicyDefinition = {
      ...LOCK_IN,
      parameters: {},
      body: { ...LOCK_IN.body, earlyRepaymentCharges: { appliesTo: ['EARLY_SETTLEMENT'], basis: 'AMOUNT_REPAID', tiers: [{ untilMonth: 12, action: 'CHARGE', rate: null, fixed: null }] } },
    };
    const r = L.composeContractConfig(product(), [L.resolvePolicy(broken)]);
    assert.equal(r.ok, false);
    assert.match(JSON.stringify(!r.ok && r.issues), /needs a rate or a fixed amount/);
  });

  test('only one policy per kind', () => {
    const p = L.resolvePolicy(LOCK_IN);
    const r = L.composeContractConfig(product(), [p, p]);
    assert.equal(r.ok, false);
  });

  test('the contract chooses from the product menu, or gets the default', () => {
    const c = product();
    c.policies.PREPAYMENT = { defaultCode: 'P-LOCK', menu: ['P-LOCK', 'P-NONE'], parameterBounds: {} };
    assert.equal(L.choosePolicyCode(c, 'PREPAYMENT'), 'P-LOCK');
    assert.equal(L.choosePolicyCode(c, 'PREPAYMENT', 'P-NONE'), 'P-NONE');
    assert.throws(() => L.choosePolicyCode(c, 'PREPAYMENT', 'P-OTHER'), /not offered/);
    assert.equal(L.choosePolicyCode(c, 'LATE_CHARGES'), null);
    assert.throws(() => L.choosePolicyCode(c, 'LATE_CHARGES', 'L-STD'), /does not offer a choice/);
  });

  test('a product menu must include its default', () => {
    const c = product() as unknown as Record<string, unknown>;
    c.policies = { PREPAYMENT: { defaultCode: 'P-LOCK', menu: ['P-NONE'], parameterBounds: {} } };
    const r = L.validateProductConfig(c);
    assert.equal(r.ok, false);
  });
});

describe('lock-in charges (UC-32)', () => {
  const contract = () => {
    const r = L.composeContractConfig(product(), [L.resolvePolicy(LOCK_IN)]);
    assert.ok(r.ok);
    return r.config;
  };

  test('charges the lock-in rate on the amount repaid inside the lock-in', () => {
    // Disbursed 15 Jan 2026; prepay 2,000.00 on 20 Jun 2026 = 5 whole months.
    const c = L.earlyRepaymentCharge(contract(), 'PARTIAL_PREPAYMENT', '2026-01-15', '2026-06-20', '2000', '8000');
    assert.equal(c.refused, false);
    assert.equal(c.charge, '60');
    assert.equal(c.monthsElapsed, 5);
    assert.deepEqual(c.source, { kind: 'TIER', index: 0, untilMonth: 12 });
    assert.match(c.explanation, /month 6/);
  });

  test('the lock-in ends on the anniversary: month 12 falls back to the base fee', () => {
    const c = L.earlyRepaymentCharge(contract(), 'EARLY_SETTLEMENT', '2026-01-15', '2027-01-15', '5000', '5000');
    assert.equal(c.monthsElapsed, 12);
    assert.deepEqual(c.source, { kind: 'BASE' });
    assert.equal(c.charge, '50'); // base early settlement fee 1% of 5,000
  });

  test('the day before the anniversary is still inside the lock-in', () => {
    const c = L.earlyRepaymentCharge(contract(), 'EARLY_SETTLEMENT', '2026-01-15', '2027-01-14', '5000', '5000');
    assert.equal(c.monthsElapsed, 11);
    assert.equal(c.charge, '150');
  });

  test('a REFUSE tier makes early repayment impossible during a hard lock-in', () => {
    const hard: L.PolicyDefinition = {
      ...LOCK_IN,
      parameters: {},
      body: { ...LOCK_IN.body, earlyRepaymentCharges: { appliesTo: ['PARTIAL_PREPAYMENT', 'EARLY_SETTLEMENT'], basis: 'AMOUNT_REPAID', tiers: [{ untilMonth: 6, action: 'REFUSE', rate: null, fixed: null }, { untilMonth: 12, action: 'CHARGE', rate: '0.02', fixed: null }] } },
    };
    const r = L.composeContractConfig(product(), [L.resolvePolicy(hard)]);
    assert.ok(r.ok);
    assert.equal(L.earlyRepaymentCharge(r.config, 'PARTIAL_PREPAYMENT', '2026-01-15', '2026-03-01', '1000', '9000').refused, true);
    const later = L.earlyRepaymentCharge(r.config, 'PARTIAL_PREPAYMENT', '2026-01-15', '2026-08-01', '1000', '9000');
    assert.equal(later.refused, false);
    assert.equal(later.charge, '20');
  });

  test('a charge on outstanding principal uses the balance before repayment', () => {
    const p: L.PolicyDefinition = { ...LOCK_IN, body: { ...LOCK_IN.body, earlyRepaymentCharges: { appliesTo: ['EARLY_SETTLEMENT'], basis: 'OUTSTANDING_PRINCIPAL', tiers: [{ untilMonth: { $param: 'lockInMonths' }, action: 'CHARGE', rate: '0.02', fixed: '25' }] } } };
    const r = L.composeContractConfig(product(), [L.resolvePolicy(p)]);
    assert.ok(r.ok);
    const c = L.earlyRepaymentCharge(r.config, 'EARLY_SETTLEMENT', '2026-01-15', '2026-04-15', '8415.14', '8415.14');
    assert.equal(c.charge, '193.3'); // 2% × 8,415.14 = 168.30 + 25 fixed
  });

  test('tiers apply only to the kinds listed in appliesTo', () => {
    const p: L.PolicyDefinition = { ...LOCK_IN, body: { ...LOCK_IN.body, earlyRepaymentCharges: { appliesTo: ['EARLY_SETTLEMENT'], basis: 'AMOUNT_REPAID', tiers: [{ untilMonth: 12, action: 'CHARGE', rate: '0.03', fixed: null }] } } };
    const r = L.composeContractConfig(product(), [L.resolvePolicy(p)]);
    assert.ok(r.ok);
    const c = L.earlyRepaymentCharge(r.config, 'PARTIAL_PREPAYMENT', '2026-01-15', '2026-03-15', '1000', '9000');
    assert.deepEqual(c.source, { kind: 'NONE' });
  });

  test('TV-11 penalty: 2% of 8,415.14 is 168.30', () => {
    const p: L.PolicyDefinition = { ...LOCK_IN, parameters: {}, body: { ...LOCK_IN.body, earlyRepaymentCharges: { appliesTo: ['EARLY_SETTLEMENT'], basis: 'OUTSTANDING_PRINCIPAL', tiers: [{ untilMonth: 12, action: 'CHARGE', rate: '0.02', fixed: null }] } } };
    const r = L.composeContractConfig(product(), [L.resolvePolicy(p)]);
    assert.ok(r.ok);
    assert.equal(new L.D(L.earlyRepaymentCharge(r.config, 'EARLY_SETTLEMENT', '2024-01-15', '2024-03-30', '8415.14', '8415.14').charge).toFixed(2), '168.30');
  });

  test('whole months count a month only once its day-of-month is reached', () => {
    assert.equal(L.wholeMonthsBetween('2026-01-31', '2026-02-28'), 0);
    assert.equal(L.wholeMonthsBetween('2026-01-31', '2026-03-31'), 2);
    assert.equal(L.wholeMonthsBetween('2026-01-15', '2026-01-14'), 0);
  });
});
