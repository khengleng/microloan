import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };

const terms = (over: Partial<L.CardTerms> = {}): L.CardTerms => ({
  currency: 'USD',
  dayCount: 'ACT_365_FIXED',
  rounding: USD,
  purchaseAnnualRate: '0.15',
  cashAdvanceAnnualRate: '0.18',
  cashAdvanceFeeRate: '0.03',
  cashAdvanceFeeMinimum: '5',
  cashAdvanceLimitShare: '0.3',
  minimumPaymentRate: '0.05',
  minimumPaymentFloor: '10',
  paymentDueDays: 21,
  ...over,
});

const movements: L.CardMovement[] = [
  { date: '2026-01-10', bucket: 'PURCHASE', amount: '1000' },
  { date: '2026-01-20', bucket: 'CASH', amount: '200' },
];

describe('credit cards (LT-07)', () => {
  test('balances are kept per bucket', () => {
    assert.equal(L.cardBalanceAt(movements, 'PURCHASE', '2026-01-31'), '1000');
    assert.equal(L.cardBalanceAt(movements, 'CASH', '2026-01-19'), '0');
    const t = L.cardBalanceTimeline(movements, 'PURCHASE', '2026-01-05', '2026-02-05');
    assert.deepEqual(t, [
      { from: '2026-01-05', to: '2026-01-10', balance: '0' },
      { from: '2026-01-10', to: '2026-02-05', balance: '1000' },
    ]);
  });

  test('UC-39: in a grace period purchase interest is computed and waived', () => {
    const c = L.cardCycleCharges(terms(), movements, '2026-01-05', '2026-02-05', true);
    // 1000 × 15% × 26 / 365 = 10.68
    assert.equal(c.purchaseInterest, '0');
    assert.equal(c.purchaseInterestWaived, '10.68');
    assert.equal(c.graceApplied, true);
    assert.equal(c.days, 31);
  });

  test('UC-39: without the grace period purchase interest runs from each purchase date', () => {
    const c = L.cardCycleCharges(terms(), movements, '2026-01-05', '2026-02-05', false);
    assert.equal(c.purchaseInterest, '10.68');
    assert.equal(c.purchaseInterestWaived, '0');
  });

  test('UC-40: cash-advance interest runs from day one and is never waived', () => {
    const c = L.cardCycleCharges(terms(), movements, '2026-01-05', '2026-02-05', true);
    // 200 × 18% × 16 / 365 = 1.58
    assert.equal(c.cashInterest, '1.58');
  });

  test('UC-40: the cash-advance fee is the greater of the rate and the minimum', () => {
    assert.equal(L.cashAdvanceFee(terms(), '200'), '6');
    assert.equal(L.cashAdvanceFee(terms(), '100'), '5');
    assert.equal(L.cashAdvanceFee(terms({ cashAdvanceFeeMinimum: null }), '100'), '3');
  });

  test('the grace period holds only when the previous statement was paid in full by its due date', () => {
    assert.equal(L.cardGraceApplies(null, '0'), true);
    assert.equal(L.cardGraceApplies({ statementBalance: '0', dueDate: '2026-02-26' }, '0'), true);
    assert.equal(L.cardGraceApplies({ statementBalance: '500', dueDate: '2026-02-26' }, '500'), true);
    assert.equal(L.cardGraceApplies({ statementBalance: '500', dueDate: '2026-02-26' }, '499.99'), false);
  });

  test('the minimum payment covers the charges and the plan instalment, then a floored share of principal', () => {
    const m = L.cardMinimumPayment(terms(), { statementDate: '2026-02-05', statementBalance: '1207.58', charges: '7.58', planInstalment: '0', revolvingPrincipal: '1200' });
    assert.equal(m.amount, '67.58');
    assert.equal(m.dueDate, '2026-02-26');
    const floor = L.cardMinimumPayment(terms(), { statementDate: '2026-02-05', statementBalance: '150', charges: '0', planInstalment: '50', revolvingPrincipal: '100' });
    assert.equal(floor.amount, '60');
    const capped = L.cardMinimumPayment(terms(), { statementDate: '2026-02-05', statementBalance: '8', charges: '0', planInstalment: '0', revolvingPrincipal: '8' });
    assert.equal(capped.amount, '8');
    assert.equal(L.cardMinimumPayment(terms(), { statementDate: '2026-02-05', statementBalance: '0', charges: '0', planInstalment: '0', revolvingPrincipal: '0' }).amount, '0');
  });

  test('payments clear charges, then the dearest balance, and prepay a plan last', () => {
    const r = L.allocateCardPayment('300', { PENALTY: '0', FEE: '6', INTEREST: '1.58', CASH: '200', PURCHASE: '1000', PLAN: '600' });
    assert.deepEqual(r.applied, { PENALTY: '0', FEE: '6', INTEREST: '1.58', CASH: '200', PURCHASE: '92.42', PLAN: '0' });
    assert.equal(r.unapplied, '0');
    const all = L.allocateCardPayment('1900', { PENALTY: '0', FEE: '0', INTEREST: '0', CASH: '0', PURCHASE: '1000', PLAN: '600' });
    assert.equal(all.applied.PLAN, '600');
    assert.equal(all.unapplied, '300');
  });

  test('UC-44: a purchase converts into level monthly instalments that repay it exactly', () => {
    const p = L.instalmentPlan('1200', '0.12', 12, USD);
    assert.equal(p.instalmentAmount, '106.62');
    assert.equal(p.lines.length, 12);
    const principal = p.lines.reduce((t, l) => t.plus(l.principal), new L.D(0));
    assert.equal(principal.toString(), '1200');
    assert.equal(p.lines[0].interest, '12');
    const flat = L.instalmentPlan('1000', '0', 3, USD);
    assert.deepEqual(
      flat.lines.map((l) => l.principal),
      ['333.33', '333.33', '333.34'],
    );
    assert.throws(() => L.instalmentPlan('0', '0.12', 3, USD), /positive principal/);
  });
});
