import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };
const TPL = L.TEMPLATE_BY_CODE.MURABAHA.defaultConfig;

function schedule(principal = '12000', n = 12, rate = '0.08') {
  return L.generateSchedule(L.toScheduleInput(TPL, { principal, numberOfInstalments: n, disbursementDate: '2026-01-05', annualRate: rate }, principal));
}
const lines = (s: L.ScheduleResult): L.MurabahaScheduleLine[] =>
  s.lines.map((l) => ({ number: l.number, periodStart: l.periodStart, periodEnd: l.periodEnd, dueDate: l.dueDate, principal: l.principal, interest: l.interest }));

describe('Murabaha: sale at cost plus a disclosed profit', () => {
  test('the contract discloses cost, profit and sale price', () => {
    // Flat 8% for one year on 12,000: a fixed profit of 960.
    const c = L.murabahaContract('12000', '0', lines(schedule()));
    assert.equal(c.cost, '12000');
    assert.equal(c.profit, '960');
    assert.equal(c.salePrice, '12960');
    assert.equal(c.deferredPrice, '12960');
    assert.equal(c.markUp, '0.08');
    assert.match(c.explanation, /Bought for 12000, sold for 12960/);
  });

  test('a down payment reduces what is financed, not the price', () => {
    const c = L.murabahaContract('15000', '3000', lines(schedule()));
    assert.equal(c.financed, '12000');
    assert.equal(c.salePrice, '15960');
    assert.equal(c.deferredPrice, '12960');
    assert.throws(() => L.murabahaContract('16000', '3000', lines(schedule())), /financed/);
  });

  test('the deferred profit is recognised over the term and runs off to nothing', () => {
    const rows = L.murabahaProfitRecognition(lines(schedule()));
    assert.equal(rows.length, 12);
    assert.equal(rows[0].profit, '80');
    assert.equal(rows[0].deferredRemaining, '880');
    assert.equal(rows.at(-1)!.cumulativeRecognised, '960');
    assert.equal(rows.at(-1)!.deferredRemaining, '0');
    // Within a period the deferred profit falls by days elapsed.
    assert.equal(L.deferredProfitAt(lines(schedule()), '2026-01-05', USD), '960');
    assert.equal(L.deferredProfitAt(lines(schedule()), '2026-02-05', USD), '880');
    assert.equal(L.deferredProfitAt(lines(schedule()), '2026-01-20', USD), '921.29');
    assert.equal(L.deferredProfitTarget('960', '960', true), '0');
    assert.equal(L.deferredProfitTarget('960', '200', false), '0');
    assert.equal(L.deferredProfitTarget('960', '200', true), '760');
  });

  test('early settlement: unearned profit is rebated by the ibra’ share, or payable in full without it', () => {
    const full = L.murabahaEarlySettlement({ remainingProfit: '480', earnedUnpaid: '40', ibraShare: '1', rounding: USD });
    assert.deepEqual([full.unearnedProfit, full.ibra, full.profitOwed], ['440', '440', '40']);
    const half = L.murabahaEarlySettlement({ remainingProfit: '480', earnedUnpaid: '40', ibraShare: '0.5', rounding: USD });
    assert.deepEqual([half.ibra, half.profitOwed], ['220', '260']);
    const none = L.murabahaEarlySettlement({ remainingProfit: '480', earnedUnpaid: '40', ibraShare: null, rounding: USD });
    assert.deepEqual([none.ibra, none.profitOwed], ['0', '480']);
    assert.match(none.explanation, /no rebate/);
  });

  test('configuration: profit is income of its own, late charges go to charity, nothing re-prices the sale', () => {
    assert.equal(TPL.accounting.interestIncome, '4700');
    assert.equal(TPL.accounting.loansReceivable, '1350');
    assert.equal(TPL.accounting.penaltyIncome, '2800');
    assert.equal(TPL.accounting.deferredProfit, '2510');
    assert.equal(TPL.accounting.unearnedProfitReceivable, '1360');
    const bad = (mutate: (c: any) => void) => {
      const c = structuredClone(TPL) as any;
      mutate(c);
      const r = L.validateProductConfig(c);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    assert.deepEqual(bad(() => undefined), []);
    assert.ok(bad((c) => { c.murabaha = null; }).includes('murabaha'));
    assert.ok(bad((c) => { c.accounting.penaltyIncome = c.accounting.interestIncome; }).includes('accounting.penaltyIncome'));
    assert.ok(bad((c) => { c.accounting.interestIncome = '4000'; }).includes('accounting.interestIncome'));
    assert.ok(bad((c) => { c.operations.restructureAllowed = true; }).includes('operations.restructureAllowed'));
    assert.ok(bad((c) => { c.attributes.rateType = 'FLOATING'; c.pricing.fixed = null; c.pricing.floating = { benchmarkCode: 'SOFR', margin: '0.02', resetFrequency: 'QUARTERLY', floor: null, cap: null }; }).includes('attributes.rateType'));
    assert.ok(L.requiredCapabilitiesFor(TPL).includes('islamic.murabaha'));
  });
});
