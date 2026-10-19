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
    const cases: [number, string, string][] = [[0, 'STANDARD', '100.00'], [20, 'SPECIAL_MENTION', '300.00'], [45, 'SUBSTANDARD', '2000.00'], [70, 'DOUBTFUL', '5000.00'], [200, 'LOSS', '10000.00']];
    for (const [dpd, cls, amount] of cases) {
      const r = L.assessImpairment(reg, loan({ daysPastDue: dpd }), rounding);
      assert.equal(r.classification, cls);
      assert.equal(new L.D(r.allowance).toFixed(2), amount);
    }
  });

  const bands = L.regulatoryBands(L.defaultTenantLendingSettings());
  const reg: L.ImpairmentPolicy = { mode: 'REGULATORY', classes: L.NBC_IMPAIRMENT_CLASSES };

  test('NBC bands depend on the original term (D-114): short ≤ 366 days, long beyond', () => {
    const at = (dpd: number, term: number | null) => L.classifyRegulatory(bands, { daysPastDue: dpd, originalTermDays: term });
    // Short-term: 0–14 / 15–30 / 31–60 / 61–90 / 91+.
    const short: [number, string][] = [[14, 'STANDARD'], [15, 'SPECIAL_MENTION'], [30, 'SPECIAL_MENTION'], [31, 'SUBSTANDARD'], [60, 'SUBSTANDARD'], [61, 'DOUBTFUL'], [90, 'DOUBTFUL'], [91, 'LOSS']];
    for (const [dpd, code] of short) assert.equal(at(dpd, 365).cls.code, code, `short ${dpd}`);
    // A twelve-month loan over 29 February (366 days) is still short-term; unknown term grades short.
    assert.equal(at(31, 366).term, 'SHORT');
    assert.equal(at(31, null).cls.code, 'SUBSTANDARD');
    // Long-term: 0–29 / 30–89 / 90–179 / 180–359 / 360+.
    const long: [number, string][] = [[29, 'STANDARD'], [30, 'SPECIAL_MENTION'], [89, 'SPECIAL_MENTION'], [90, 'SUBSTANDARD'], [179, 'SUBSTANDARD'], [180, 'DOUBTFUL'], [359, 'DOUBTFUL'], [360, 'LOSS']];
    for (const [dpd, code] of long) assert.equal(at(dpd, 730).cls.code, code, `long ${dpd}`);
    assert.equal(at(31, 367).term, 'LONG');
    // Rates 1 / 3 / 20 / 50 / 100 % on both sets.
    for (const set of [L.NBC_SHORT_TERM_CLASSES, L.NBC_LONG_TERM_CLASSES])
      assert.deepEqual(set.map((c) => c.rate), ['0.01', '0.03', '0.2', '0.5', '1']);
    // REGULATORY mode with the lender's bands provisions a long-term loan on the long set.
    const r = L.assessImpairment(reg, loan({ daysPastDue: 45, originalTermDays: 1095 }), rounding, bands);
    assert.equal(r.classification, 'SPECIAL_MENTION');
    assert.equal(new L.D(r.allowance).toFixed(2), '300.00');
    assert.match(r.explanation, /long-term bands/);
  });

  test('restructure probation floor: graded on max(actual, floor) days until cured (D-113)', () => {
    assert.equal(L.classificationDpd({ daysPastDue: 0, onProbation: true, floorDpd: 75 }), 75);
    assert.equal(L.classificationDpd({ daysPastDue: 80, onProbation: true, floorDpd: 75 }), 80);
    assert.equal(L.classificationDpd({ daysPastDue: 0, onProbation: false, floorDpd: 75 }), 0);
    // Without lender bands (policy classes): the floor still holds the class.
    const held = L.assessImpairment(reg, loan({ daysPastDue: 0, restructured: true, onProbation: true, floorDpd: 75 }), rounding);
    assert.equal(held.classification, 'DOUBTFUL');
    assert.equal(new L.D(held.allowance).toFixed(2), '5000.00');
    assert.match(held.explanation, /probation floor/);
    // ECL staging uses the floor too.
    assert.equal(L.assessImpairment(ecl, loan({ daysPastDue: 0, restructured: true, onProbation: true, floorDpd: 100 }), rounding).stage, 3);
    // Cured: back to the actual days.
    assert.equal(L.assessImpairment(reg, loan({ daysPastDue: 0, restructured: true, onProbation: false, floorDpd: 75 }), rounding).classification, 'STANDARD');
  });

  test('restructured minimum class while on probation (D-113, default Substandard)', () => {
    const f = { daysPastDue: 0, originalTermDays: 365, restructured: true, onProbation: true, floorDpd: 5 };
    const g = L.classifyRegulatory(bands, f);
    assert.equal(g.cls.code, 'SUBSTANDARD');
    assert.equal(g.heldAtMinimum, true);
    const r = L.assessImpairment(reg, loan({ ...f }), rounding, bands);
    assert.equal(new L.D(r.allowance).toFixed(2), '2000.00');
    // A worse class by days is kept; cured loans and unrestructured ones are not held.
    assert.equal(L.classifyRegulatory(bands, { ...f, floorDpd: 95 }).cls.code, 'LOSS');
    assert.equal(L.classifyRegulatory(bands, { ...f, onProbation: false }).cls.code, 'STANDARD');
    assert.equal(L.classifyRegulatory(bands, { ...f, restructured: false, onProbation: false }).cls.code, 'STANDARD');
    // No minimum when the lender sets none.
    assert.equal(L.classifyRegulatory({ ...bands, restructuredMinClass: null }, f).cls.code, 'STANDARD');
  });

  test('regulatory reserve = regulatory provision above the ECL allowance, never negative (D-115)', () => {
    assert.equal(L.regulatoryReserveTarget('2000', '1200.5'), '799.5');
    assert.equal(L.regulatoryReserveTarget('1000', '1000'), '0');
    assert.equal(L.regulatoryReserveTarget('900', '1000'), '0');
    const p = L.regulatoryProvision(bands, { daysPastDue: 40, originalTermDays: 180 }, '10000', rounding);
    assert.equal(p.grade.cls.code, 'SUBSTANDARD');
    assert.equal(new L.D(p.amount).toFixed(2), '2000.00');
    const e = L.assessImpairment(ecl, loan({ daysPastDue: 40 }), rounding);
    assert.equal(new L.D(e.allowance).toFixed(2), '1000.00');
    assert.equal(new L.D(L.regulatoryReserveTarget(p.amount, e.allowance)).toFixed(2), '1000.00');
  });

  test('write-off floor: the Loss threshold of the term set unless the lender sets one (D-117)', () => {
    const none = { shortTerm: null, longTerm: null };
    assert.equal(L.writeOffFloorDpd(bands, 365, none), 91);
    assert.equal(L.writeOffFloorDpd(bands, 1095, none), 360);
    assert.equal(L.writeOffFloorDpd(bands, null, none), 91);
    assert.equal(L.writeOffFloorDpd(bands, 1095, { shortTerm: 120, longTerm: 400 }), 400);
    assert.equal(L.writeOffFloorDpd(bands, 200, { shortTerm: 120, longTerm: 400 }), 120);
  });

  test('an inconsistent policy is refused', () => {
    assert.ok(L.validateImpairmentPolicy({ mode: 'REGULATORY', classes: [{ code: 'A', label: 'A', minDpd: 5, rate: '0.01' }] }).length > 0);
    assert.ok(L.validateImpairmentPolicy({ ...ecl, ecl: { ...ecl.ecl!, stage3FromDpd: 10 } }).length > 0);
  });
});
