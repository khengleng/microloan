import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const rows = (goods: number[], bads: number[]): L.ScoredOutcome[] => [
  ...goods.map((score) => ({ score, bad: false })),
  ...bads.map((score) => ({ score, bad: true })),
];

describe('discrimination statistics (hand-computed)', () => {
  // Goods 600, 650, 700, 700; bads 550, 600, 700. Of the 12 good–bad pairs the
  // good scores higher in 8 and ties in 1 → AUC = 8.5 / 12.
  const sample = rows([600, 650, 700, 700], [550, 600, 700]);

  test('AUC and Gini', () => {
    assert.deepEqual(L.aucGini(sample), { auc: '0.7083', gini: '0.4167', goods: 4, bads: 3 });
  });

  test('perfect, random and inverted orderings', () => {
    assert.equal(L.aucGini(rows([700, 800], [500, 600]))!.gini, '1.0000');
    assert.equal(L.aucGini(rows([600, 600], [600, 600]))!.auc, '0.5000');
    assert.equal(L.aucGini(rows([500], [800]))!.gini, '-1.0000');
    assert.equal(L.aucGini(rows([600], [])), null);
  });

  test('Kolmogorov–Smirnov: largest gap of the cumulative shares', () => {
    // At 600: 2/3 of bads vs 1/4 of goods → 0.4167.
    assert.deepEqual(L.ksStatistic(sample), { ks: '0.4167', atScore: 600 });
    assert.deepEqual(L.ksStatistic(rows([700, 800], [500, 600])), { ks: '1.0000', atScore: 600 });
    assert.equal(L.ksStatistic(rows([], [600])), null);
  });
});

describe('population stability index (hand-computed)', () => {
  test('shifted mix across grades', () => {
    // (0.4−0.5)·ln 0.8 + 0 + (0.3−0.2)·ln 1.5 = 0.022314 + 0.040547 = 0.062861
    const r = L.populationStability({ A: 50, B: 30, C: 20 }, { A: 40, B: 30, C: 30 }, '0.0001')!;
    assert.equal(r.psi, '0.0629');
    assert.deepEqual(r.bins.map((b) => b.contribution), ['0.0223', '0.0000', '0.0405']);
  });

  test('an empty bin takes epsilon instead of dividing by zero', () => {
    // A: (0.5−1)·ln 0.5 = 0.346574; B: (0.5−0.0001)·ln 5000 = 4.257745
    assert.equal(L.populationStability({ A: 10, B: 0 }, { A: 5, B: 5 }, '0.0001')!.psi, '4.6043');
  });

  test('identical populations are perfectly stable; an empty window has no index', () => {
    assert.equal(L.populationStability({ A: 3, B: 1 }, { A: 30, B: 10 }, '0.0001')!.psi, '0.0000');
    assert.equal(L.populationStability({ A: 3 }, {}, '0.0001'), null);
  });
});

describe('consent', () => {
  const grant = (id: string, source: string, at: string, expires: string | null): L.ConsentEvent => ({ id, action: 'GRANT', source, grantId: null, effectiveAt: at, expiresAt: expires });
  const revoke = (grantId: string, at: string): L.ConsentEvent => ({ id: `r-${grantId}`, action: 'REVOKE', source: 'UTILITY_BILLS', grantId, effectiveAt: at, expiresAt: null });

  test('a grant is in force from when it is given until it expires or is revoked', () => {
    const ev = [grant('g1', 'UTILITY_BILLS', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')];
    assert.equal(L.consentInForce(ev, 'UTILITY_BILLS', '2025-12-31T23:59:59Z'), null);
    assert.equal(L.consentInForce(ev, 'UTILITY_BILLS', '2026-06-01T00:00:00Z')!.id, 'g1');
    assert.equal(L.consentInForce(ev, 'UTILITY_BILLS', '2027-01-01T00:00:00Z'), null);
    assert.equal(L.consentInForce(ev, 'RENT_HISTORY', '2026-06-01T00:00:00Z'), null);
    const withdrawn = [...ev, revoke('g1', '2026-03-01T00:00:00Z')];
    assert.equal(L.consentInForce(withdrawn, 'UTILITY_BILLS', '2026-02-01T00:00:00Z')!.id, 'g1');
    assert.equal(L.consentInForce(withdrawn, 'UTILITY_BILLS', '2026-03-02T00:00:00Z'), null);
    const renewed = [...withdrawn, grant('g2', 'UTILITY_BILLS', '2026-04-01T00:00:00Z', null)];
    assert.equal(L.consentInForce(renewed, 'UTILITY_BILLS', '2026-05-01T00:00:00Z')!.id, 'g2');
  });
});

describe('behavioural and officer-verified features', () => {
  test('repayment behaviour over instalments fallen due', () => {
    const r = L.repaymentBehaviour(
      [
        { dueDate: '2026-01-05', paidOn: '2026-01-05' },
        { dueDate: '2026-02-05', paidOn: '2026-02-10' },
        { dueDate: '2026-03-05', paidOn: null },
        { dueDate: '2026-04-05', paidOn: null },
      ],
      '2026-03-20',
    );
    assert.deepEqual(r, { instalmentsObserved: 3, onTimeRepaymentRatio: '0.3333', averageDaysLate: '6.67', maxDaysPastDueEver: 15 });
    assert.equal(L.repaymentBehaviour([], '2026-01-01').onTimeRepaymentRatio, null);
    assert.equal(L.historyMonths('2025-11-20', '2026-03-19'), 3);
    assert.equal(L.historyMonths(null, '2026-03-19'), 0);
  });

  test('performance outcome within the window, with maturity', () => {
    const inst = [{ dueDate: '2026-02-01', paidOn: '2026-03-15' }];
    const base = { disbursementDate: '2026-01-01', instalments: inst, writtenOff: false, asOf: '2026-06-01', performanceMonths: 2 };
    assert.deepEqual(L.performanceOutcome({ ...base, badDaysPastDue: 30 }), { mature: true, bad: false, worstDaysLate: 28 });
    assert.equal(L.performanceOutcome({ ...base, badDaysPastDue: 25 }).bad, true);
    const young = L.performanceOutcome({ ...base, asOf: '2026-02-10', badDaysPastDue: 30 });
    assert.deepEqual(young, { mature: false, bad: false, worstDaysLate: 9 });
    assert.equal(L.performanceOutcome({ ...base, asOf: '2026-02-10', writtenOff: true, badDaysPastDue: 30 }).mature, true);
  });

  test('officer records combine utilities, take the newest of each kind and leave currency to the caller', () => {
    const f = L.officerFeatures([
      { id: 'e-old', kind: 'UTILITY_BILLS', periodTo: '2025-12-31', data: { utility: 'ELECTRICITY', monthsObserved: 6, monthsOnTime: 3 } },
      { id: 'e', kind: 'UTILITY_BILLS', periodTo: '2026-05-31', data: { utility: 'ELECTRICITY', monthsObserved: 12, monthsOnTime: 11 } },
      { id: 'w', kind: 'UTILITY_BILLS', periodTo: '2026-05-31', data: { utility: 'WATER', monthsObserved: 6, monthsOnTime: 6 } },
      { id: 'c', kind: 'BUSINESS_CASH_FLOW', periodTo: '2026-05-31', data: { averageMonthlyInflow: '4000000', averageMonthlyOutflow: '2500000', currency: 'KHR', method: 'SITE_VISIT', monthsObserved: 3 } },
    ]);
    assert.deepEqual(f.utilityOnTimeRatio, { value: '0.9444', recordIds: ['e', 'w'] });
    assert.equal(f.utilityMonthsObserved!.value, 12);
    assert.deepEqual(f.businessNetMonthlyCashFlow, { value: '1500000', recordIds: ['c'], currency: 'KHR' });
    assert.equal(L.cashFlowCoverage('1500000', '500000'), '3');
    assert.equal(L.cashFlowCoverage('-10', '500'), '0');
    assert.equal(L.cashFlowCoverage('10', '0'), null);
  });

  test('officer data schemas refuse impossible counts', () => {
    assert.equal(L.OFFICER_DATA_SCHEMAS.UTILITY_BILLS.safeParse({ utility: 'WATER', issuer: 'PPWSA', accountReference: 'W-1', monthsObserved: 6, monthsOnTime: 7 }).success, false);
    assert.equal(L.OFFICER_DATA_SCHEMAS.TELCO_STATEMENT.safeParse({ operator: 'Smart', monthsObserved: 6, monthsWithTopUp: 6 }).success, true);
  });
});
