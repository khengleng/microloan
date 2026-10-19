import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';
import { creditScore, type ScoreInput } from './fixtures/legacy-credit-score.js';

const STANDARD = L.SCORECARD_TEMPLATE_BY_CODE.STANDARD_RETAIL.definition;
const THIN = L.SCORECARD_TEMPLATE_BY_CODE.THIN_FILE.definition;

const good: ScoreInput = {
  debtServiceRatio: '0.25', ageYears: 35, closedLoans: 2, worstCurrentDpd: 0, writtenOff: false,
  loanToValue: '0.5', guarantees: 1, bureauScore: null,
};
const asInputs = (x: ScoreInput): L.ScoringInputs => ({ ...x });

describe('standard scorecard template: exact parity with the original origination score', () => {
  const grid = {
    debtServiceRatio: [null, '0', '0.25', '0.3', '0.3001', '0.45', '0.5', '0.6', '0.6001', '0.95', '1.4'],
    ageYears: [null, 18, 24, 25, 40, 55, 56, 71],
    closedLoans: [0, 1, 2, 3, 9],
    worstCurrentDpd: [0, 1, 30, 31, 200],
    writtenOff: [false, true],
    loanToValue: [null, '0.45', '0.6', '0.65', '0.8', '0.8001', '1.2'],
    guarantees: [0, 1, 4],
    bureauScore: [null, 0, 300, 574, 575, 576, 577, 640, 850],
  } as const;
  const keys = Object.keys(grid) as (keyof typeof grid)[];
  // Every value of every input against a varied background, plus a seeded
  // sample of the full cross product.
  const cases: ScoreInput[] = [];
  for (const k of keys) for (const value of grid[k]) cases.push({ ...good, [k]: value } as ScoreInput);
  let seed = 20261018;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  for (let i = 0; i < 4000; i++) {
    const c = {} as Record<string, unknown>;
    for (const k of keys) c[k] = grid[k][rnd(grid[k].length)];
    cases.push(c as unknown as ScoreInput);
  }

  test(`score, grade and every factor match on ${cases.length} input sets`, () => {
    for (const x of cases) {
      const old = creditScore(x);
      const now = L.evaluateScorecard(STANDARD, asInputs(x));
      const ctx = JSON.stringify(x);
      assert.equal(now.score, old.score, ctx);
      assert.equal(now.grade, old.grade, ctx);
      assert.deepEqual(
        now.factors.map((f) => [f.factor, f.points + 0, f.reason]),
        old.factors.map((f) => [f.factor, f.points + 0, f.reason]),
        ctx,
      );
    }
  });

  test('the template carries the original scale, base and grades', () => {
    assert.equal(STANDARD.baseScore, 450);
    assert.deepEqual([STANDARD.minScore, STANDARD.maxScore], [300, 850]);
    assert.deepEqual(STANDARD.grades.map((g) => [g.grade, g.minScore]), [['A', 700], ['B', 620], ['C', 550], ['D', 300]]);
  });

  test('every point is explained and the score is the base plus the factors', () => {
    const r = L.evaluateScorecard(STANDARD, asInputs(good));
    assert.equal(r.rawScore, STANDARD.baseScore + r.characteristics.reduce((s, c) => s + c.points, 0));
    assert.equal(r.grade, 'A');
    assert.ok(r.factors.every((f) => f.reason.length > 0));
  });

  test('a write-off skips history and conduct and pulls the score down to grade D', () => {
    const r = L.evaluateScorecard(STANDARD, asInputs({ ...good, debtServiceRatio: '0.7', closedLoans: 0, writtenOff: true, loanToValue: null, guarantees: 0 }));
    assert.equal(r.grade, 'D');
    assert.ok(r.characteristics.find((c) => c.code === 'CONDUCT')!.skipped);
    // The burden costs 160 points against its best bin, the write-off 150.
    assert.deepEqual(r.adverseReasons.map((a) => a.code).slice(0, 2), ['DEBT_BURDEN', 'PREVIOUS_DEFAULT']);
  });

  test('the score is clamped to the scale', () => {
    const low = L.evaluateScorecard(STANDARD, asInputs({ ...good, debtServiceRatio: '0.9', writtenOff: true, bureauScore: 300, loanToValue: null, guarantees: 0, ageYears: 19 }));
    assert.ok(low.score >= 300);
    const high = L.evaluateScorecard(STANDARD, asInputs({ ...good, bureauScore: 850, closedLoans: 5 }));
    assert.equal(high.score, Math.min(850, high.rawScore));
  });
});

describe('scorecard definition validation', () => {
  const clone = () => structuredClone(STANDARD) as unknown as Record<string, any>;
  const issues = (d: unknown) => {
    const r = L.validateScorecardDefinition(d);
    return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
  };

  test('both templates are valid', () => {
    assert.deepEqual(issues(STANDARD), []);
    assert.deepEqual(issues(THIN), []);
  });

  test('bins must ascend without overlap and end open-ended', () => {
    const d = clone();
    d.characteristics[0].bins[1].upTo = '0.2';
    assert.match(issues(d).join(), /ascending order without overlap/);
    const e = clone();
    e.characteristics[0].bins[3].upTo = '2';
    assert.match(issues(e).join(), /last bin must be open-ended/);
    const f = clone();
    f.characteristics[0].bins[1].upTo = null;
    assert.match(issues(f).join(), /only the last bin may be open-ended/);
  });

  test('variables must exist and suit the characteristic type', () => {
    const d = clone();
    d.characteristics[0].variable = 'monthlySalaryUsd';
    assert.match(issues(d).join(), /unknown input variable/);
    const e = clone();
    e.characteristics[2].type = 'BINS';
    assert.match(issues(e).join(), /not numeric/);
  });

  test('grades are ordered, unique and cover the whole scale', () => {
    const d = clone();
    d.grades = [];
    assert.ok(issues(d).length);
    const e = clone();
    e.grades[3].minScore = 400;
    assert.match(issues(e).join(), /lowest band must start at or below minScore/);
    const f = clone();
    f.grades[1].minScore = 750;
    assert.match(issues(f).join(), /highest first/);
    const g = clone();
    g.minScore = 900;
    assert.match(issues(g).join(), /minScore must be below maxScore/);
  });

  test('bounds, placeholders and omitted outcomes are checked; unknown keys refused', () => {
    const d = clone();
    d.characteristics[0].bins[0].points = 5000;
    assert.ok(issues(d).length);
    const e = clone();
    e.characteristics[0].bins[0].reason = 'Ratio {ratio}';
    assert.match(issues(e).join(), /unknown placeholder/);
    const f = clone();
    f.characteristics[2].categories[1].points = 10;
    assert.match(issues(f).join(), /omitted outcome contributes no points/);
    const g = clone();
    g.formula = 'score * 2';
    assert.ok(issues(g).length);
    const h = clone();
    h.characteristics[1].code = 'AFFORDABILITY';
    assert.match(issues(h).join(), /duplicate characteristic code/);
  });

  test('a missing input and an out-of-domain input both take the missing outcome', () => {
    const r = L.evaluateScorecard(STANDARD, { ...asInputs(good), bureauScore: 0, ageYears: null });
    assert.equal(r.characteristics.find((c) => c.code === 'BUREAU')!.outcome, 'MISSING');
    assert.equal(r.characteristics.find((c) => c.code === 'AGE')!.points, 20);
  });
});

describe('decision strategy', () => {
  const base = L.productScoringSchema.parse({});
  const run = (strategy: unknown, score: number, grade: string, inputs: L.ScoringInputs = {}, amount = '1000', minCreditScore: number | null = null) =>
    L.evaluateStrategy(L.strategySchema.parse(strategy), { score, grade, inputs, requestedAmount: amount, minCreditScore });

  test('defaults preserve the original behaviour: every grade referred, no knock-outs, minCreditScore still declines', () => {
    assert.equal(base.championCode, 'STANDARD_RETAIL');
    assert.equal(base.challengerCode, null);
    assert.equal(base.thinFile.enabled, false);
    assert.equal(run({}, 720, 'A').outcome, 'REFER');
    assert.equal(run({}, 400, 'D', { writtenOff: true }).outcome, 'REFER');
    const r = run({}, 540, 'D', {}, '1000', 550);
    assert.equal(r.outcome, 'DECLINE');
    assert.equal(r.declineBelowScore, 550);
  });

  test('grade rules map to outcomes; the stricter cut-off applies', () => {
    const s = { declineBelowScore: 560, gradeRules: [{ grade: 'A', outcome: 'AUTO_APPROVE', rateAddOnBps: 0 }, { grade: 'C', outcome: 'REFER', rateAddOnBps: 150 }] };
    assert.equal(run(s, 720, 'A').outcome, 'AUTO_APPROVE');
    assert.equal(run(s, 600, 'C').rateAddOnBps, 150);
    assert.equal(run(s, 555, 'C', {}, '1000', 550).outcome, 'DECLINE');
    assert.equal(run(s, 555, 'C', {}, '1000', 550).declineBelowScore, 560);
    assert.equal(run(s, 640, 'B').outcome, 'REFER');
  });

  test('knock-outs decline whatever the score', () => {
    const s = { gradeRules: [{ grade: 'A', outcome: 'AUTO_APPROVE' }], knockouts: { writtenOff: true, maxCurrentDpd: 30, minAgeYears: 18, maxAgeYears: 65, maxDebtServiceRatio: '0.5' } };
    assert.equal(run(s, 800, 'A', { writtenOff: true }).outcome, 'DECLINE');
    assert.deepEqual(run(s, 800, 'A', { worstCurrentDpd: 45, ageYears: 30 }).knockouts.map((k) => k.code), ['KO_CURRENT_ARREARS']);
    assert.equal(run(s, 800, 'A', { worstCurrentDpd: 30, ageYears: 30, debtServiceRatio: '0.3' }).outcome, 'AUTO_APPROVE');
    // D-126: a ratio the strategy tests but cannot measure (income unknown) is referred, not passed.
    assert.equal(run(s, 800, 'A', { worstCurrentDpd: 30, ageYears: 30 }).outcome, 'REFER');
    assert.equal(run(s, 800, 'A', { ageYears: 70 }).outcome, 'DECLINE');
    assert.equal(run(s, 800, 'A', { ageYears: null }).outcome, 'DECLINE');
    assert.equal(run(s, 800, 'A', { ageYears: 30, debtServiceRatio: '0.51' }).outcome, 'DECLINE');
  });

  test('an amount above the grade maximum is never auto-approved', () => {
    const s = { gradeRules: [{ grade: 'B', outcome: 'AUTO_APPROVE', maxAmount: '2000' }] };
    const r = run(s, 650, 'B', {}, '2500');
    assert.equal(r.outcome, 'REFER');
    assert.ok(r.amountAboveGradeLimit);
    assert.equal(run(s, 650, 'B', {}, '2000').outcome, 'AUTO_APPROVE');
  });

  test('product configuration checks the scoring section', () => {
    const tpl = structuredClone(L.TEMPLATE_BY_CODE.PERSONAL_INSTALMENT.defaultConfig) as any;
    tpl.scoring = { championCode: 'STANDARD_RETAIL', challengerCode: 'STANDARD_RETAIL' };
    const r = L.validateProductConfig(tpl);
    assert.equal(r.ok, false);
    tpl.scoring = { strategy: { gradeRules: [{ grade: 'A', outcome: 'AUTO_APPROVE', maxAmount: '999999999999' }] } };
    assert.equal(L.validateProductConfig(tpl).ok, false);
    tpl.scoring = { challengerCode: 'THIN_FILE' };
    assert.equal(L.validateProductConfig(tpl).ok, true);
  });

  test('customers are told the outcome and plain reasons, never points', () => {
    const r = L.evaluateScorecard(STANDARD, asInputs({ ...good, debtServiceRatio: '0.7', worstCurrentDpd: 40 }));
    const e = L.publicScoreExplanation('DECLINE', r.adverseReasons, [{ code: 'KO_CURRENT_ARREARS', message: 'internal 40 > 30' }]);
    assert.equal(e.reasons[0].message, 'A current loan is in arrears.');
    assert.ok(!JSON.stringify(e).match(/points|\d{3}/));
  });
});

describe('thin-file selection', () => {
  const rule = L.thinFileRuleSchema.parse({ enabled: true, maxInternalHistoryMonths: 6 });
  test('no bureau score and short history is thin; either one missing is not', () => {
    assert.equal(L.isThinFile(rule, { bureauScore: null, internalHistoryMonths: 2 }), true);
    assert.equal(L.isThinFile(rule, { bureauScore: null }), true);
    assert.equal(L.isThinFile(rule, { bureauScore: null, internalHistoryMonths: 6 }), false);
    assert.equal(L.isThinFile(rule, { bureauScore: 610, internalHistoryMonths: 0 }), false);
    assert.equal(L.isThinFile({ ...rule, requireNoBureauScore: false }, { bureauScore: 610, internalHistoryMonths: 0 }), true);
    assert.equal(L.isThinFile({ ...rule, enabled: false }, { internalHistoryMonths: 0 }), false);
  });

  test('the thin-file template scores verified alternative data and nothing for its absence', () => {
    const none = L.evaluateScorecard(THIN, { debtServiceRatio: '0.25', ageYears: 30, worstCurrentDpd: 0, writtenOff: false });
    const alt = L.evaluateScorecard(THIN, {
      debtServiceRatio: '0.25', ageYears: 30, worstCurrentDpd: 0, writtenOff: false,
      utilityOnTimeRatio: '1', utilityMonthsObserved: 12, rentOnTimeRatio: '0.85', mobileTopUpMonthsActive: 12, businessCashFlowCoverage: '3',
    });
    assert.equal(none.score, 480 + 100 + 40);
    assert.equal(alt.score, none.score + 70 + 30 + 20 + 30 + 60);
    assert.equal(alt.grade, 'A');
    assert.ok(none.adverseReasons.some((a) => a.code === 'UTILITY_PAYMENTS'));
  });
});

describe('debt-service coverage (LT-16)', () => {
  test('NOI over annual debt service', () => {
    assert.equal(L.debtServiceCoverage('125000', '100000')!.toString(), '1.25');
    assert.equal(L.debtServiceCoverage('1', '0'), null);
  });
});
