import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };
const four = (paid: number) => [1, 2, 3, 4].map((n) => ({ number: n, principalDue: '100', principalPaid: n <= paid ? '100' : '0' }));

describe('BNPL merchant settlement and refunds (LT-11, UC-52)', () => {
  test('the merchant is paid the price less the discount', () => {
    assert.deepEqual(L.merchantSettlement('400', '0.04', USD), { gross: '400', discount: '16', net: '384' });
    assert.throws(() => L.merchantSettlement('400', '1', USD), /below 1/);
  });

  test('a refund reduces the remaining instalments latest first', () => {
    const r = L.bnplRefund({ amount: '150', lines: four(1), purchaseAmount: '400', alreadyRefunded: '0', merchantDiscount: '16', discountAlreadyReversed: '0' }, USD);
    assert.deepEqual(r.reductions, [
      { number: 4, principal: '100' },
      { number: 3, principal: '50' },
    ]);
    assert.equal(r.appliedToPrincipal, '150');
    assert.equal(r.customerRefund, '0');
    // The discount is given back pro rata: 16 × 150 / 400.
    assert.equal(r.discountReversed, '6');
    assert.equal(r.merchantClawback, '144');
  });

  test('what the customer already paid comes back to them in cash', () => {
    const r = L.bnplRefund({ amount: '400', lines: four(3), purchaseAmount: '400', alreadyRefunded: '0', merchantDiscount: '16', discountAlreadyReversed: '0' }, USD);
    assert.equal(r.appliedToPrincipal, '100');
    assert.equal(r.customerRefund, '300');
    assert.equal(r.discountReversed, '16');
    assert.equal(r.merchantClawback, '384');
  });

  test('the last refund reverses exactly the discount that is left', () => {
    const r = L.bnplRefund({ amount: '250', lines: four(0), purchaseAmount: '400', alreadyRefunded: '150', merchantDiscount: '16', discountAlreadyReversed: '6' }, USD);
    assert.equal(r.discountReversed, '10');
    assert.equal(r.merchantClawback, '240');
  });

  test('a refund larger than what is left of the purchase is refused', () => {
    assert.throws(
      () => L.bnplRefund({ amount: '300', lines: four(0), purchaseAmount: '400', alreadyRefunded: '150', merchantDiscount: '16', discountAlreadyReversed: '6' }, USD),
      /Only 250 of the 400 purchase/,
    );
  });
});

describe('lease end (LT-15)', () => {
  const base = { residualValue: '3000', principalOutstanding: '3000', chargesOutstanding: '0', overdueRentals: '0', finalInstalmentDue: true };
  test('the asset may be returned once only the residual is left', () => {
    assert.equal(L.leaseReturnCheck(base).ok, true);
  });
  test('a return is refused while rentals or charges are unpaid, or before the final rental', () => {
    assert.equal(L.leaseReturnCheck({ ...base, principalOutstanding: '3400' }).ok, false);
    assert.equal(L.leaseReturnCheck({ ...base, chargesOutstanding: '12' }).ok, false);
    assert.equal(L.leaseReturnCheck({ ...base, finalInstalmentDue: false }).issues.length, 1);
  });
});
