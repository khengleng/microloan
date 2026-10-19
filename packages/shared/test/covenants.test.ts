import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

describe('covenant ratios (LT-16)', () => {
  test('net leverage is (debt − cash) ÷ EBITDA, unbounded without positive EBITDA', () => {
    assert.equal(L.netLeverage('9000000', '1000000', '2000000')!.toString(), '4');
    assert.equal(L.netLeverage('1', '0', '0'), null);
    assert.equal(L.covenantPasses('MAX_LEVERAGE', L.netLeverage('9000000', '1000000', '2000000'), '3.5'), false);
    assert.equal(L.covenantPasses('MAX_LEVERAGE', L.netLeverage('6000000', '1000000', '2000000'), '3.5'), true);
    assert.equal(L.covenantPasses('MAX_LEVERAGE', null, '3.5'), false);
  });

  test('interest cover is EBITDA ÷ interest; minimum covenants pass at or above the threshold', () => {
    assert.equal(L.interestCover('2000000', '500000')!.toString(), '4');
    assert.equal(L.interestCover('2000000', '0'), null);
    assert.equal(L.covenantPasses('MIN_INTEREST_COVER', L.interestCover('1500000', '500000'), '3'), true);
    assert.equal(L.covenantPasses('MIN_INTEREST_COVER', L.interestCover('1400000', '500000'), '3'), false);
    assert.equal(L.covenantPasses('MAX_LTV', new L.D('0.7'), '0.7'), true);
  });
});
