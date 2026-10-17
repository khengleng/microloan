/** Precomputed-interest rebates (UC-33): the methods agree where they must. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const rounding = { mode: 'HALF_UP', increment: '0.01' } as L.RoundingRule;
const flat = { totalInterest: '1200', principal: '10000', instalments: [...Array(11).fill('933.33'), '933.37'], numberOfInstalments: 12, rounding };

describe('interest rebates (UC-33)', () => {
  for (const method of ['RULE_OF_78', 'ACTUARIAL', 'STRAIGHT_LINE'] as const) {
    test(`${method}: nothing back when nothing remains, everything when nothing was paid`, () => {
      assert.equal(new L.D(L.precomputedInterestRebate({ ...flat, method, remainingInstalments: 0 }).rebate).toFixed(2), '0.00');
      assert.equal(new L.D(L.precomputedInterestRebate({ ...flat, method, remainingInstalments: 12 }).rebate).toFixed(2), '1200.00');
    });
  }

  test('the Rule of 78 never returns more than the actuarial method (it favours the lender)', () => {
    for (let k = 1; k < 12; k++) {
      const r78 = new L.D(L.precomputedInterestRebate({ ...flat, method: 'RULE_OF_78', remainingInstalments: k }).rebate);
      const act = new L.D(L.precomputedInterestRebate({ ...flat, method: 'ACTUARIAL', remainingInstalments: k }).rebate);
      assert.ok(r78.lte(act), `k=${k}: rule of 78 ${r78} > actuarial ${act}`);
    }
  });

  test('refuses an impossible number of remaining instalments', () => {
    assert.throws(() => L.precomputedInterestRebate({ ...flat, method: 'RULE_OF_78', remainingInstalments: 13 }), /between 0/);
  });
});
