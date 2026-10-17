import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const good: L.ScoreInput = {
  debtServiceRatio: '0.25', ageYears: 35, closedLoans: 2, worstCurrentDpd: 0, writtenOff: false,
  loanToValue: '0.5', guarantees: 1, bureauScore: null,
};

describe('origination credit score (OPS-2)', () => {
  test('every point is explained and the score is the base plus the factors', () => {
    const r = L.creditScore(good);
    assert.equal(r.score, L.SCORE_BASE + r.factors.reduce((s, f) => s + f.points, 0));
    assert.equal(r.grade, 'A');
    assert.ok(r.factors.every((f) => f.reason.length > 0));
  });

  test('a write-off, arrears and a high burden pull the score down to grade D', () => {
    const r = L.creditScore({ ...good, debtServiceRatio: '0.7', closedLoans: 0, writtenOff: true, loanToValue: null, guarantees: 0 });
    assert.equal(r.grade, 'D');
    assert.ok(r.score < 550);
  });

  test('the score stays within 300–850 and a bureau score moves it', () => {
    const low = L.creditScore({ ...good, debtServiceRatio: '0.9', writtenOff: true, bureauScore: 300, loanToValue: null, guarantees: 0, ageYears: 19 });
    assert.ok(low.score >= L.SCORE_MIN);
    const withBureau = L.creditScore({ ...good, bureauScore: 800 });
    assert.ok(withBureau.score > L.creditScore(good).score);
    assert.ok(withBureau.score <= L.SCORE_MAX);
  });
});

describe('debt-service coverage (LT-16)', () => {
  test('NOI over annual debt service', () => {
    assert.equal(L.debtServiceCoverage('125000', '100000')!.toString(), '1.25');
    assert.equal(L.debtServiceCoverage('1', '0'), null);
  });
});
