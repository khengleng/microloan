import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };

/** 4,000 principal, 120 interest, 30 fees, 50 penalties — 4,200 owed. */
const OWED: L.SettlementPosition = { principal: '4000', interest: '120', fees: '30', penalties: '50' };

describe('LT-09 pawn and gold valuation', () => {
  test('value = weight × purity × price per gram', () => {
    // 50 g of 18k gold (0.75 fine) at 60 per gram of pure gold.
    const v = L.pawnValuation({ weightGrams: '50', karat: 18, pricePerGram: '60' }, 'USD', USD);
    assert.equal(v.fineness, '0.75');
    assert.equal(v.fineWeightGrams, '37.5');
    assert.equal(v.value, '2250');
    assert.equal(v.maxLoan, null);
  });

  test('purity can be given directly, and a maximum LTV caps the loan (rounded down)', () => {
    const v = L.pawnValuation({ weightGrams: '10.37', purity: '0.9999', pricePerGram: '61.25', maxLtv: '0.7' }, 'USD', USD);
    // 10.37 × 0.9999 = 10.368963 g × 61.25 = 635.0989... → 635.10; × 70% = 444.57 (down).
    assert.equal(v.value, '635.1');
    assert.equal(v.maxLoan, '444.57');
  });

  test('karat 24 is pure', () => {
    assert.equal(L.pawnValuation({ weightGrams: '1', karat: 24, pricePerGram: '70' }, 'USD', USD).value, '70');
  });

  test('refuses impossible inputs', () => {
    assert.throws(() => L.pawnValuation({ weightGrams: '0', karat: 18, pricePerGram: '60' }, 'USD', USD), /Weight/);
    assert.throws(() => L.pawnValuation({ weightGrams: '5', karat: 25, pricePerGram: '60' }, 'USD', USD), /Karat/);
    assert.throws(() => L.pawnValuation({ weightGrams: '5', purity: '1.2', pricePerGram: '60' }, 'USD', USD), /Purity/);
    assert.throws(() => L.pawnValuation({ weightGrams: '5', pricePerGram: '60' }, 'USD', USD), /karat or the purity/);
    assert.throws(() => L.pawnValuation({ weightGrams: '5', karat: 18, purity: '0.75', pricePerGram: '60' }, 'USD', USD), /not both/);
  });
});

describe('UC-66 redemption deadline', () => {
  test('a pawn is forfeitable only after the deadline and any grace', () => {
    assert.equal(L.pawnForfeitable('2026-03-01', '2026-03-01', 0), false);
    assert.equal(L.pawnForfeitable('2026-03-01', '2026-03-02', 0), true);
    assert.equal(L.pawnForfeitable('2026-03-01', '2026-03-08', 7), false);
    assert.equal(L.pawnForfeitable('2026-03-01', '2026-03-09', 7), true);
  });
});

describe('UC-65 recovery proceeds waterfall', () => {
  test('surplus: costs, then interest, then principal, then fees and penalties; the rest is the borrower’s', () => {
    const r = L.applyRecoveryProceeds({ grossProceeds: '5000', costs: '300', owed: OWED }, 'USD');
    assert.equal(r.costsRecovered, '300');
    assert.equal(r.netProceeds, '4700');
    assert.deepEqual(r.applied, [
      { component: 'INTEREST', amount: '120' },
      { component: 'PRINCIPAL', amount: '4000' },
      { component: 'FEE', amount: '30' },
      { component: 'PENALTY', amount: '50' },
    ]);
    assert.equal(r.totalApplied, '4200');
    assert.equal(r.surplus, '500');
    assert.equal(r.deficiencyTotal, '0');
    assert.equal(r.settlesLoan, true);
  });

  test('deficiency: what the proceeds do not cover stays owed, by component', () => {
    const r = L.applyRecoveryProceeds({ grossProceeds: '3000', costs: '200', owed: OWED }, 'USD');
    assert.equal(r.netProceeds, '2800');
    assert.deepEqual(r.applied, [
      { component: 'INTEREST', amount: '120' },
      { component: 'PRINCIPAL', amount: '2680' },
    ]);
    assert.equal(r.surplus, '0');
    assert.deepEqual(r.deficiency, [
      { component: 'PRINCIPAL', amount: '1320' },
      { component: 'FEE', amount: '30' },
      { component: 'PENALTY', amount: '50' },
    ]);
    assert.equal(r.deficiencyTotal, '1400');
    assert.equal(r.settlesLoan, false);
  });

  test('the product may put penalties and fees first', () => {
    const r = L.applyRecoveryProceeds(
      { grossProceeds: '100', owed: OWED, order: ['PENALTY', 'FEE', 'INTEREST', 'PRINCIPAL'] },
      'USD',
    );
    assert.deepEqual(r.applied, [
      { component: 'PENALTY', amount: '50' },
      { component: 'FEE', amount: '30' },
      { component: 'INTEREST', amount: '20' },
    ]);
  });

  test('costs beyond the proceeds are not covered and nothing reaches the loan', () => {
    const r = L.applyRecoveryProceeds({ grossProceeds: '150', costs: '200', owed: OWED }, 'USD');
    assert.equal(r.costsRecovered, '150');
    assert.equal(r.unrecoveredCosts, '50');
    assert.equal(r.totalApplied, '0');
    assert.equal(r.deficiencyTotal, '4200');
  });

  test('an insurance claim (no costs) larger than the balance leaves a surplus for the estate', () => {
    const r = L.applyRecoveryProceeds({ grossProceeds: '4500.55', owed: OWED }, 'USD');
    assert.equal(r.surplus, '300.55');
    assert.equal(r.settlesLoan, true);
  });

  test('balances: gross = costs recovered + applied + surplus', () => {
    for (const gross of ['1', '2500.37', '4200', '9999.99']) {
      const r = L.applyRecoveryProceeds({ grossProceeds: gross, costs: '12.5', owed: OWED }, 'USD');
      const back = new L.D(r.costsRecovered).plus(r.totalApplied).plus(r.surplus);
      assert.equal(back.toString(), new L.D(gross).toString());
    }
  });

  test('refuses bad input', () => {
    assert.throws(() => L.applyRecoveryProceeds({ grossProceeds: '0', owed: OWED }, 'USD'), /greater than zero/);
    assert.throws(() => L.applyRecoveryProceeds({ grossProceeds: '1.001', owed: OWED }, 'USD'), /decimal places/);
    assert.throws(
      () => L.applyRecoveryProceeds({ grossProceeds: '1', owed: OWED, order: ['INTEREST', 'INTEREST', 'FEE', 'PENALTY'] }, 'USD'),
      /once each/,
    );
  });
});

describe('spreading applied amounts over instalments', () => {
  const lines: L.InstalmentOutstanding[] = [
    { number: 2, outstanding: { PRINCIPAL: '300', INTEREST: '40', FEE: '0', TAX: '0', PENALTY: '10' } },
    { number: 1, outstanding: { PRINCIPAL: '250', INTEREST: '45', FEE: '5', TAX: '1', PENALTY: '10' } },
    { number: 3, outstanding: { PRINCIPAL: '450', INTEREST: '30' } },
  ];

  test('oldest instalment first, fee covering fee then tax', () => {
    const r = L.spreadOverInstalments(lines, [
      { component: 'INTEREST', amount: '60' },
      { component: 'PRINCIPAL', amount: '600' },
      { component: 'FEE', amount: '6' },
    ]);
    assert.deepEqual(r.unplaced, []);
    assert.deepEqual(r.allocations, [
      { instalmentNumber: 1, component: 'INTEREST', amount: '45' },
      { instalmentNumber: 2, component: 'INTEREST', amount: '15' },
      { instalmentNumber: 1, component: 'PRINCIPAL', amount: '250' },
      { instalmentNumber: 2, component: 'PRINCIPAL', amount: '300' },
      { instalmentNumber: 3, component: 'PRINCIPAL', amount: '50' },
      { instalmentNumber: 1, component: 'FEE', amount: '5' },
      { instalmentNumber: 1, component: 'TAX', amount: '1' },
    ]);
  });

  test('reports what does not fit instead of dropping it', () => {
    const r = L.spreadOverInstalments(lines, [{ component: 'PENALTY', amount: '25' }]);
    assert.deepEqual(r.unplaced, [{ component: 'PENALTY', amount: '5' }]);
  });
});

describe('UC-71 debt sale', () => {
  test('sold below carrying amount: a loss net of the allowance', () => {
    const r = L.debtSaleResult({ price: '1500', owed: OWED, allowance: '2000', interestInSuspense: '100' }, 'USD');
    assert.equal(r.grossReceivable, '4200');
    assert.equal(r.carryingAmount, '2100');
    assert.equal(r.gainLoss, '-600');
    assert.equal(r.loss, '600');
    assert.equal(r.gain, '0');
  });

  test('sold above carrying amount: a gain', () => {
    const r = L.debtSaleResult({ price: '2500', owed: OWED, allowance: '2000', interestInSuspense: '100' }, 'USD');
    assert.equal(r.gain, '400');
    assert.equal(r.loss, '0');
  });

  test('a written-off loan is carried at nothing, so the whole price is a gain', () => {
    const r = L.debtSaleResult(
      { price: '300', owed: { principal: '0', interest: '0', fees: '0', penalties: '0' }, allowance: '0', interestInSuspense: '0' },
      'USD',
    );
    assert.equal(r.carryingAmount, '0');
    assert.equal(r.gain, '300');
  });

  test('refuses a zero price', () => {
    assert.throws(() => L.debtSaleResult({ price: '0', owed: OWED, allowance: '0', interestInSuspense: '0' }, 'USD'), /greater than zero/);
  });
});

describe('product configuration', () => {
  test('recovery settings default sensibly and reject a repeated component', () => {
    const ok = L.productConfigSchema.shape.recovery.parse(undefined);
    assert.deepEqual(ok.proceedsOrder, ['INTEREST', 'PRINCIPAL', 'FEE', 'PENALTY']);
    assert.equal(ok.repossessionMinDpd, 90);
    const fee = L.productConfigSchema.shape.pricing.shape.fees.parse([
      { code: 'CLI', name: 'Credit life premium', calculation: 'FIXED', amount: '60', treatment: 'FINANCED', waivable: false, payee: 'INSURER' },
    ]);
    assert.equal(fee[0].payee, 'INSURER');
  });

  test('an insurer-payee fee is marked on the fee line', () => {
    const r = L.computeUpfrontFees('1000', 'USD', USD, [
      { code: 'CLI', name: 'Credit life premium', calculation: 'FIXED', amount: '60', treatment: 'FINANCED', waivable: false, payee: 'INSURER' },
      { code: 'ADM', name: 'Admin', calculation: 'FIXED', amount: '10', treatment: 'DEDUCTED', waivable: false },
    ]);
    assert.equal(r.bookedPrincipal, '1060');
    assert.equal(r.lines[0].payee, 'INSURER');
    assert.equal(r.lines[1].payee, undefined);
  });
});
