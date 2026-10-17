import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const base: L.ScheduleInput = {
  principal: '12000',
  currency: 'USD',
  disbursementDate: '2026-01-05',
  annualRate: '0.12',
  rateConvention: 'NOMINAL',
  interestMethod: 'REDUCING_BALANCE',
  accrualBasis: 'PERIODIC',
  dayCount: 'THIRTY_360_ISDA',
  method: 'EQUAL_INSTALMENT',
  frequency: 'MONTHLY',
  numberOfInstalments: 12,
};

describe('stepped instalments (UC-15)', () => {
  test('step-up: the first six instalments are half the later ones and the loan closes', () => {
    const s = L.generateSchedule({ ...base, instalmentSteps: [{ instalments: 6, multiplier: '0.5' }] });
    const t = s.lines.map((l) => Number(l.total));
    assert.equal(s.lines.at(-1)!.closingPrincipal, '0');
    for (let k = 1; k < 6; k++) assert.equal(t[k], t[0]);
    assert.ok(Math.abs(t[6] - 2 * t[0]) <= 0.02, `${t[6]} ≈ 2 × ${t[0]}`);
    for (let k = 7; k < 11; k++) assert.equal(t[k], t[6]);
    assert.ok(Math.abs(Number(s.finalResidual)) < 0.05);
  });

  test('step-down: larger early instalments mean less interest than level', () => {
    const level = L.generateSchedule(base);
    const down = L.generateSchedule({ ...base, instalmentSteps: [{ instalments: 4, multiplier: '1.5' }] });
    assert.equal(down.lines.at(-1)!.closingPrincipal, '0');
    assert.ok(Number(down.lines[0].total) > Number(down.lines[11].total));
    assert.ok(Number(down.totals.interest) < Number(level.totals.interest));
  });

  test('a graduated step too small to cover interest is refused', () => {
    assert.throws(
      () => L.generateSchedule({ ...base, annualRate: '0.6', instalmentSteps: [{ instalments: 6, multiplier: '0.01' }] }),
      /does not cover interest/,
    );
  });

  test('steps cannot run past the term or mix with flat interest', () => {
    assert.throws(() => L.generateSchedule({ ...base, instalmentSteps: [{ instalments: 13, multiplier: '0.5' }] }), /past the last/);
    assert.throws(
      () => L.generateSchedule({ ...base, interestMethod: 'FLAT', instalmentSteps: [{ instalments: 2, multiplier: '0.5' }] }),
      /reducing balance/,
    );
  });
});

describe('promotional rate (UC-46)', () => {
  const product = () => {
    const c = structuredClone(L.TEMPLATE_BY_CODE.PERSONAL_INSTALMENT.defaultConfig) as L.ProductConfig;
    c.pricing.fees = [];
    c.limits.minInstalments = 6;
    c.pricing.promotion = { code: 'NEWYEAR', annualRate: '0', instalments: 3, label: 'Three months interest-free' };
    return c;
  };

  test('the product validates and an unknown campaign code is refused', () => {
    const c = product();
    assert.ok(L.validateProductConfig(c).ok, JSON.stringify(L.validateProductConfig(c)));
    const bad = L.checkTerms(c, { principal: '5000', numberOfInstalments: 12, disbursementDate: '2026-01-05', promotionCode: 'OTHER' });
    assert.ok(bad.issues.some((i) => i.path === 'promotionCode'));
  });

  test('the promotional rate applies for three instalments, then the contract rate with a re-solved instalment', () => {
    const c = product();
    const t = { principal: '5000', numberOfInstalments: 12, disbursementDate: '2026-01-05', annualRate: '0.18', promotionCode: 'NEWYEAR' };
    const s = L.generateSchedule(L.toScheduleInput(c, t, '5000'));
    assert.deepEqual(s.lines.slice(0, 3).map((l) => l.interest), ['0', '0', '0']);
    assert.ok(Number(s.lines[3].interest) > 0);
    assert.equal(s.lines.at(-1)!.closingPrincipal, '0');
    const plain = L.generateSchedule(L.toScheduleInput(c, { ...t, promotionCode: undefined }, '5000'));
    assert.ok(Number(s.totals.interest) < Number(plain.totals.interest));
  });

  test('a promotion needs fixed pricing and must be shorter than the term', () => {
    const c = product();
    c.pricing.promotion!.instalments = c.limits.minInstalments;
    assert.ok(!L.validateProductConfig(c).ok);
  });
});
