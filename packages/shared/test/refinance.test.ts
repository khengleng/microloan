import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };

/** A current loan: 8,000 principal, 200 interest, nothing overdue. */
const CURRENT: L.RefinancePayoff = {
  principal: '8000',
  interest: '200',
  fees: '0',
  penalties: '0',
  overdue: '0',
  daysPastDue: 0,
};

/** The same size of loan, 90 days behind, with 650 of arrears. */
const DELINQUENT: L.RefinancePayoff = {
  principal: '8000',
  interest: '500',
  fees: '0',
  penalties: '150',
  overdue: '650',
  daysPastDue: 90,
};

const refinance = (payoff: L.RefinancePayoff, terms: L.RefinanceTerms) =>
  L.calculateRefinance(payoff, terms, 'USD', USD);

describe('refinance arithmetic', () => {
  test('proceeds settle the old loan and the rest goes to the borrower', () => {
    const r = refinance(CURRENT, { newPrincipal: '10000', deductedFees: '100' });
    assert.equal(r.payoffAmount, '8200');
    assert.equal(r.netProceeds, '9900');
    assert.equal(r.appliedToPayoff, '8200');
    assert.equal(r.topUpToBorrower, '1700');
    assert.equal(r.shortfall, '0');
  });

  test('an exact refinance leaves no top-up and no shortfall', () => {
    const r = refinance(CURRENT, { newPrincipal: '8200' });
    assert.equal(r.topUpToBorrower, '0');
    assert.equal(r.shortfall, '0');
    assert.match(r.explanation[1], /exactly settle/);
  });

  test('a settlement fee on the old loan is part of the payoff', () => {
    const r = refinance({ ...CURRENT, settlementFee: '50' }, { newPrincipal: '10000' });
    assert.equal(r.payoffAmount, '8250');
  });

  test('a shortfall is refused unless the borrower is funding it', () => {
    assert.throws(
      () => refinance(CURRENT, { newPrincipal: '7000' }),
      /short of the 8200 payoff/,
    );
    const r = refinance(CURRENT, {
      newPrincipal: '7000',
      allowBorrowerShortfallPayment: true,
    });
    assert.equal(r.shortfall, '1200');
    assert.equal(r.appliedToPayoff, '7000');
    assert.match(r.explanation[1], /borrower funds the remaining 1200/);
  });

  test('fees that swallow the loan are refused', () => {
    assert.throws(
      () => refinance(CURRENT, { newPrincipal: '1000', deductedFees: '1000' }),
      /leave nothing of a 1000 loan/,
    );
  });

  test('a loan that owes nothing cannot be refinanced', () => {
    assert.throws(
      () =>
        refinance(
          { principal: '0', interest: '0', fees: '0', penalties: '0' },
          { newPrincipal: '1000' },
        ),
      /owes nothing/,
    );
  });

  test('a negative payoff component is a contradiction', () => {
    assert.throws(
      () => refinance({ ...CURRENT, penalties: '-1' }, { newPrincipal: '10000' }),
      /payoff.penalties is negative|must be a decimal string/,
    );
  });

  test('arrears larger than the payoff are refused', () => {
    assert.throws(
      () => refinance({ ...CURRENT, overdue: '99999' }, { newPrincipal: '10000' }),
      /exceed the payoff/,
    );
  });
});

describe('evergreening', () => {
  test('refinancing a current loan is not evergreening', () => {
    const r = refinance(CURRENT, { newPrincipal: '10000' });
    assert.equal(r.replacingDelinquentLoan, false);
    assert.equal(r.evergreening, false);
    assert.equal(r.arrearsRolledIn, '0');
  });

  test('funding a delinquent loan arrears from the new loan is flagged', () => {
    const r = refinance(DELINQUENT, { newPrincipal: '10000' });
    assert.equal(r.payoffAmount, '8650');
    assert.equal(r.arrears, '650');
    // Principal 8,000 is covered first, so all 650 of arrears is funded.
    assert.equal(r.arrearsRolledIn, '650');
    assert.equal(r.replacingDelinquentLoan, true);
    assert.equal(r.evergreening, true);
    assert.match(
      r.explanation.join(' '),
      /conceals delinquency rather than resolving it/,
    );
  });

  test('arrears the borrower settles themselves are not rolled in', () => {
    // The new loan covers only the principal; the borrower funds the arrears.
    const r = refinance(DELINQUENT, {
      newPrincipal: '8000',
      allowBorrowerShortfallPayment: true,
    });
    assert.equal(r.arrearsRolledIn, '0');
    assert.equal(r.shortfall, '650');
    assert.equal(r.evergreening, false, 'the borrower, not the lender, cleared the arrears');
    assert.match(r.explanation.join(' '), /settled by the borrower, not rolled into/);
  });

  test('part-funded arrears report only the part the new loan carries', () => {
    // 8,300 covers the 8,000 principal and 300 of the 650 arrears.
    const r = refinance(DELINQUENT, {
      newPrincipal: '8300',
      allowBorrowerShortfallPayment: true,
    });
    assert.equal(r.arrearsRolledIn, '300');
    assert.equal(r.shortfall, '350');
    assert.equal(r.evergreening, true);
  });

  test('a delinquent loan with no arrears in its payoff is not evergreening', () => {
    const r = refinance(
      { principal: '8000', interest: '0', fees: '0', penalties: '0', overdue: '0', daysPastDue: 45 },
      { newPrincipal: '10000' },
    );
    assert.equal(r.replacingDelinquentLoan, true);
    assert.equal(r.evergreening, false);
  });

  test('unstated arrears are assumed to be the whole of the charges', () => {
    // Assuming none is overdue would understate the risk, so the engine
    // assumes the worst when the caller has not said.
    const r = refinance(
      { principal: '8000', interest: '500', fees: '0', penalties: '150', daysPastDue: 90 },
      { newPrincipal: '10000' },
    );
    assert.equal(r.arrears, '650');
    assert.equal(r.evergreening, true);
  });
});

describe('product rules', () => {
  const rules = (over: Partial<L.RefinanceRules> = {}): L.RefinanceRules => ({
    allowDelinquent: false,
    allowArrearsRollIn: false,
    maxDaysPastDue: 30,
    minInstalmentsPaid: 6,
    maxRefinanceCount: 1,
    ...over,
  });
  const loan = (over = {}) => ({
    daysPastDue: 0,
    instalmentsPaid: 12,
    refinanceCount: 0,
    ...over,
  });

  test('a clean refinance passes every rule', () => {
    const r = refinance(CURRENT, { newPrincipal: '10000' });
    assert.deepEqual(L.checkRefinanceRules(rules(), r, loan()), []);
  });

  test('a delinquent loan is refused when the product says so', () => {
    const r = refinance(DELINQUENT, { newPrincipal: '10000' });
    const issues = L.checkRefinanceRules(rules(), r, loan({ daysPastDue: 90 }));
    const codes = issues.map((i) => i.code).sort();
    assert.deepEqual(codes, ['ARREARS_ROLL_IN', 'DELINQUENT', 'DPD']);
  });

  test('a product may permit a delinquent refinance but not roll-in', () => {
    const r = refinance(DELINQUENT, { newPrincipal: '10000' });
    const issues = L.checkRefinanceRules(
      rules({ allowDelinquent: true, maxDaysPastDue: 120 }),
      r,
      loan({ daysPastDue: 90 }),
    );
    assert.deepEqual(issues.map((i) => i.code), ['ARREARS_ROLL_IN']);
  });

  test('seasoning is enforced', () => {
    const r = refinance(CURRENT, { newPrincipal: '10000' });
    const issues = L.checkRefinanceRules(rules(), r, loan({ instalmentsPaid: 2 }));
    assert.deepEqual(issues.map((i) => i.code), ['SEASONING']);
    assert.match(issues[0].message, /requires 6 before refinancing/);
  });

  test('a repeatedly refinanced borrowing is refused', () => {
    const r = refinance(CURRENT, { newPrincipal: '10000' });
    const issues = L.checkRefinanceRules(rules(), r, loan({ refinanceCount: 1 }));
    assert.deepEqual(issues.map((i) => i.code), ['REFINANCE_LIMIT']);
  });

  test('a product with no DPD ceiling does not impose one', () => {
    const r = refinance(DELINQUENT, { newPrincipal: '10000' });
    const issues = L.checkRefinanceRules(
      rules({ allowDelinquent: true, allowArrearsRollIn: true, maxDaysPastDue: null }),
      r,
      loan({ daysPastDue: 400 }),
    );
    assert.deepEqual(issues, []);
  });
});
