/** Classification and impairment (OPS-5). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const rounding = { mode: 'HALF_UP', increment: '0.01' } as L.RoundingRule;
const loan = (over: Partial<L.ImpairmentInput> = {}): L.ImpairmentInput => ({
  daysPastDue: 0, principal: '10000', exposure: '10000', restructured: false, onProbation: false, nonAccrual: false, ...over,
});
const ecl: L.ImpairmentPolicy = {
  mode: 'ECL',
  classes: L.NBC_IMPAIRMENT_CLASSES,
  ecl: { stage2FromDpd: 30, stage3FromDpd: 90, restructuredMinStage: 2, nonAccrualIsStage3: true, pd: { stage1: '0.05', stage2: '0.25', stage3: '1' }, lgd: '0.40' },
};

describe('impairment (OPS-5)', () => {
  test('ECL = PD × LGD × EAD: EAD 10,000, PD 5%, LGD 40% → 200.00 (prompt C4)', () => {
    const r = L.assessImpairment(ecl, loan(), rounding);
    assert.equal(r.stage, 1);
    assert.equal(new L.D(r.allowance).toFixed(2), '200.00');
  });

  test('ECL staging by days past due, non-accrual and restructuring', () => {
    assert.equal(L.assessImpairment(ecl, loan({ daysPastDue: 45 }), rounding).stage, 2);
    assert.equal(new L.D(L.assessImpairment(ecl, loan({ daysPastDue: 45 }), rounding).allowance).toFixed(2), '1000.00');
    assert.equal(L.assessImpairment(ecl, loan({ daysPastDue: 120 }), rounding).stage, 3);
    assert.equal(L.assessImpairment(ecl, loan({ nonAccrual: true }), rounding).stage, 3);
    assert.equal(L.assessImpairment(ecl, loan({ restructured: true, onProbation: true }), rounding).stage, 2);
    assert.equal(L.assessImpairment(ecl, loan({ restructured: true, onProbation: false }), rounding).stage, 1);
  });

  test('REGULATORY: the NBC class rate on principal', () => {
    const reg: L.ImpairmentPolicy = { mode: 'REGULATORY', classes: L.NBC_IMPAIRMENT_CLASSES };
    const cases: [number, string, string][] = [[0, 'STANDARD', '100.00'], [20, 'SPECIAL_MENTION', '300.00'], [45, 'SUBSTANDARD', '2500.00'], [70, 'DOUBTFUL', '5000.00'], [200, 'LOSS', '10000.00']];
    for (const [dpd, cls, amount] of cases) {
      const r = L.assessImpairment(reg, loan({ daysPastDue: dpd }), rounding);
      assert.equal(r.classification, cls);
      assert.equal(new L.D(r.allowance).toFixed(2), amount);
    }
  });

  test('an inconsistent policy is refused', () => {
    assert.ok(L.validateImpairmentPolicy({ mode: 'REGULATORY', classes: [{ code: 'A', label: 'A', minDpd: 5, rate: '0.01' }] }).length > 0);
    assert.ok(L.validateImpairmentPolicy({ ...ecl, ecl: { ...ecl.ecl!, stage3FromDpd: 10 } }).length > 0);
  });
});
