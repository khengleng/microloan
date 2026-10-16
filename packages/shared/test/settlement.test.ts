import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };

/** 10,000 principal, 500 interest, 100 fees, 400 penalties — 11,000 owed. */
const POSITION: L.SettlementPosition = {
  principal: '10000',
  interest: '500',
  fees: '100',
  penalties: '400',
};

const CHARGES_ONLY: L.DueComponent[] = ['PENALTY', 'FEE', 'TAX', 'INTEREST'];
const ALL: L.DueComponent[] = ['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL'];

describe('negotiated settlement', () => {
  test('by default principal is recovered first and charges are given up', () => {
    // 10,100 clears all 10,000 of principal and 100 of interest; the
    // remaining 400 interest, 100 fees and 400 penalties are forgiven.
    const r = L.calculateNegotiatedSettlement(
      POSITION,
      { agreedAmount: '10100', forgivable: ALL },
      'USD',
      USD,
    );
    assert.equal(r.fullAmount, '11000');
    assert.equal(r.concession, '900');
    assert.deepEqual(r.allocations, [
      { component: 'PRINCIPAL', amount: '10000' },
      { component: 'INTEREST', amount: '100' },
    ]);
    assert.deepEqual(r.forgiven, [
      { component: 'INTEREST', amount: '400' },
      { component: 'FEE', amount: '100' },
      { component: 'PENALTY', amount: '400' },
    ]);
    assert.equal(r.forgivesPrincipal, false);
  });

  test('forgiving principal is possible, and is called out when it happens', () => {
    // 9,000 cannot even cover the principal, so 1,000 of it is forgiven.
    const r = L.calculateNegotiatedSettlement(
      POSITION,
      { agreedAmount: '9000', forgivable: ALL },
      'USD',
      USD,
    );
    assert.deepEqual(r.allocations, [{ component: 'PRINCIPAL', amount: '9000' }]);
    assert.equal(r.forgivesPrincipal, true);
    assert.equal(r.concession, '2000');
    assert.match(r.explanation[3], /forgives principal, not only charges/);
  });

  test('the concession is priced as a fraction of the full amount', () => {
    const r = L.calculateNegotiatedSettlement(
      POSITION,
      { agreedAmount: '10100', forgivable: ALL },
      'USD',
      USD,
    );
    // bc: 900 / 11000 = 0.0818181818…
    assert.equal(r.concessionRate, '0.081818');
  });

  test('paying exactly the principal forgives the charges and nothing more', () => {
    const r = L.calculateNegotiatedSettlement(
      POSITION,
      { agreedAmount: '10000', forgivable: CHARGES_ONLY },
      'USD',
      USD,
    );
    assert.equal(r.concession, '1000');
    assert.equal(r.forgivesPrincipal, false);
    assert.deepEqual(
      r.forgiven.map((f) => f.component).sort(),
      ['FEE', 'INTEREST', 'PENALTY'],
    );
    assert.match(r.explanation[3], /principal is recovered in full/);
  });

  test('forgiving a component the terms do not permit is refused, not silent', () => {
    // 9,000 cannot clear the principal, and principal is not forgivable here.
    assert.throws(
      () =>
        L.calculateNegotiatedSettlement(
          POSITION,
          { agreedAmount: '9000', forgivable: CHARGES_ONLY },
          'USD',
          USD,
        ),
      /would forgive PRINCIPAL, which the terms do not permit/,
    );
  });

  test('the dangerous order is still available, and still refused when it strands principal', () => {
    // Charges-first protects the penalties and strands the principal — which
    // is exactly why it is not the default.
    assert.throws(
      () =>
        L.calculateNegotiatedSettlement(
          POSITION,
          {
            agreedAmount: '10100',
            allocationOrder: ['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL'],
            forgivable: CHARGES_ONLY,
          },
          'USD',
          USD,
        ),
      /would forgive PRINCIPAL/,
    );
  });

  test('an amount at or above the balance is not a concession', () => {
    assert.throws(
      () =>
        L.calculateNegotiatedSettlement(
          POSITION,
          { agreedAmount: '11000', forgivable: ALL },
          'USD',
          USD,
        ),
      /settle the loan in full instead/,
    );
    assert.throws(
      () =>
        L.calculateNegotiatedSettlement(
          POSITION,
          { agreedAmount: '12000', forgivable: ALL },
          'USD',
          USD,
        ),
      /settle the loan in full instead/,
    );
  });

  test('a zero or negative settlement is refused', () => {
    assert.throws(
      () => L.calculateNegotiatedSettlement(POSITION, { agreedAmount: '0', forgivable: ALL }, 'USD', USD),
      /greater than zero/,
    );
  });

  test('a loan that owes nothing cannot be settled', () => {
    assert.throws(
      () =>
        L.calculateNegotiatedSettlement(
          { principal: '0', interest: '0', fees: '0', penalties: '0' },
          { agreedAmount: '100', forgivable: ALL },
          'USD',
          USD,
        ),
      /owes nothing/,
    );
  });

  test('the allocation order governs where the loss falls', () => {
    // Charges-first: the penalties survive and the principal takes the hit.
    const r = L.calculateNegotiatedSettlement(
      POSITION,
      {
        agreedAmount: '10100',
        allocationOrder: ['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL'],
        forgivable: ALL,
      },
      'USD',
      USD,
    );
    assert.deepEqual(r.allocations, [
      { component: 'PENALTY', amount: '400' },
      { component: 'FEE', amount: '100' },
      { component: 'INTEREST', amount: '500' },
      { component: 'PRINCIPAL', amount: '9100' },
    ]);
    assert.equal(r.forgivesPrincipal, true);
    assert.equal(r.concession, '900');
  });

  test('a repeated or unknown component in the order is refused', () => {
    assert.throws(
      () =>
        L.calculateNegotiatedSettlement(
          POSITION,
          { agreedAmount: '100', allocationOrder: ['PENALTY', 'PENALTY'], forgivable: ALL },
          'USD',
          USD,
        ),
      /repeats a component/,
    );
  });

  test('sub-minor-unit amounts are refused', () => {
    assert.throws(
      () =>
        L.calculateNegotiatedSettlement(
          POSITION,
          { agreedAmount: '10000.005', forgivable: ALL },
          'USD',
          USD,
        ),
      /decimal places than USD allows/,
    );
  });

  test('allocations plus forgiveness always equal what was owed', () => {
    for (const agreed of ['1', '500', '1000', '5000', '10999']) {
      const r = L.calculateNegotiatedSettlement(
        POSITION,
        { agreedAmount: agreed, forgivable: ALL },
        'USD',
        USD,
      );
      const applied = r.allocations.reduce((a, x) => a.plus(x.amount), new L.D(0));
      const given = r.forgiven.reduce((a, x) => a.plus(x.amount), new L.D(0));
      assert.equal(applied.plus(given).toString(), '11000', `at ${agreed}`);
      assert.equal(applied.toString(), agreed);
    }
  });
});

describe('recovery after write-off', () => {
  test('principal is recovered first, because that is the loss taken', () => {
    const r = L.allocateRecovery(POSITION, [], '3000', 'USD', USD);
    assert.deepEqual(r.allocations, [{ component: 'PRINCIPAL', amount: '3000' }]);
    assert.equal(r.recoveredToDate, '3000');
    assert.equal(r.remainingWrittenOff, '8000');
    assert.equal(r.fullyRecovered, false);
  });

  test('a later recovery continues where the last one stopped', () => {
    const r = L.allocateRecovery(
      POSITION,
      [{ component: 'PRINCIPAL', amount: '10000' }],
      '600',
      'USD',
      USD,
    );
    // Principal is fully recovered, so this falls to interest and then fees.
    assert.deepEqual(r.allocations, [
      { component: 'INTEREST', amount: '500' },
      { component: 'FEE', amount: '100' },
    ]);
    assert.equal(r.recoveredToDate, '10600');
  });

  test('recovering everything written off is reported as full recovery', () => {
    const r = L.allocateRecovery(POSITION, [], '11000', 'USD', USD);
    assert.equal(r.fullyRecovered, true);
    assert.equal(r.remainingWrittenOff, '0');
    assert.deepEqual(r.allocations.map((a) => a.component), [
      'PRINCIPAL',
      'INTEREST',
      'FEE',
      'PENALTY',
    ]);
  });

  test('a recovery larger than what was written off is refused', () => {
    assert.throws(
      () => L.allocateRecovery(POSITION, [], '11001', 'USD', USD),
      /exceeds the 11000 still written off/,
    );
  });

  test('a recovery larger than what remains is refused', () => {
    assert.throws(
      () =>
        L.allocateRecovery(
          POSITION,
          [{ component: 'PRINCIPAL', amount: '10000' }],
          '1001',
          'USD',
          USD,
        ),
      /exceeds the 1000 still written off/,
    );
  });

  test('a prior recovery exceeding what was written off is a contradiction', () => {
    assert.throws(
      () =>
        L.allocateRecovery(
          POSITION,
          [{ component: 'INTEREST', amount: '900' }],
          '100',
          'USD',
          USD,
        ),
      /already been recovered against INTEREST/,
    );
  });

  test('a zero recovery is refused', () => {
    assert.throws(() => L.allocateRecovery(POSITION, [], '0', 'USD', USD), /greater than zero/);
  });

  test('the attribution order can be overridden', () => {
    const r = L.allocateRecovery(POSITION, [], '500', 'USD', USD, [
      'PENALTY',
      'FEE',
      'TAX',
      'INTEREST',
      'PRINCIPAL',
    ]);
    assert.deepEqual(r.allocations, [
      { component: 'PENALTY', amount: '400' },
      { component: 'FEE', amount: '100' },
    ]);
  });

  test('a negative written-off component is a contradiction', () => {
    assert.throws(
      () => L.allocateRecovery({ ...POSITION, interest: '-1' }, [], '100', 'USD', USD),
      /INTEREST is negative/,
    );
  });

  test('allocations always sum to the recovery', () => {
    for (const amount of ['1', '400', '500', '10000', '11000']) {
      const r = L.allocateRecovery(POSITION, [], amount, 'USD', USD);
      const total = r.allocations.reduce((a, x) => a.plus(x.amount), new L.D(0));
      assert.equal(total.toString(), amount, `at ${amount}`);
    }
  });
});
