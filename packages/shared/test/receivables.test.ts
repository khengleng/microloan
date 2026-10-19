/**
 * Receivables purchase (factoring, forfaiting, supply-chain finance) and
 * documentary trade loans: the pure calculations and the product rules.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const R = { increment: '0.01', mode: 'HALF_UP' } as const;
const m = (v: string) => new L.D(v).toFixed(2);
const cfg = (code: string) => structuredClone(L.TEMPLATE_BY_CODE[code].defaultConfig) as any;
const issues = (c: unknown) => {
  const r = L.validateProductConfig(c);
  return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
};

describe('discounting (forfaiting, supply-chain finance)', () => {
  test('straight discount: 100,000 at 7% for 93 days on a 360-day year', () => {
    const r = L.discountForDays({ faceAmount: '100000', annualRate: '0.07', dayCountBasis: 360, method: 'STRAIGHT' }, 93, R);
    assert.equal(m(r.discount), '1808.33');
    assert.equal(m(r.purchasePrice), '98191.67');
  });

  test('discount to yield is smaller than the straight discount for the same rate', () => {
    const straight = L.discountForDays({ faceAmount: '100000', annualRate: '0.07', dayCountBasis: 360, method: 'STRAIGHT' }, 180, R);
    const yieldD = L.discountForDays({ faceAmount: '100000', annualRate: '0.07', dayCountBasis: 360, method: 'YIELD' }, 180, R);
    assert.equal(m(yieldD.discount), '3381.64');
    assert.ok(new L.D(yieldD.discount).lt(straight.discount));
  });

  test('bad inputs are refused', () => {
    assert.throws(() => L.discountForDays({ faceAmount: '0', annualRate: '0.07', dayCountBasis: 360, method: 'STRAIGHT' }, 10, R), /positive/);
    assert.throws(() => L.discountForDays({ faceAmount: '100', annualRate: '0.07', dayCountBasis: 360, method: 'STRAIGHT' }, -1, R), /whole number/);
    // A discount that consumes the face is not a purchase.
    assert.throws(() => L.discountForDays({ faceAmount: '100', annualRate: '0.9', dayCountBasis: 360, method: 'STRAIGHT' }, 720, R), /whole face/);
  });

  test('the discount is earned straight-line to maturity and in full from it', () => {
    assert.equal(L.discountEarnedToDate('900', '2026-01-01', '2026-03-02', '2026-01-01', R), '0');
    assert.equal(m(L.discountEarnedToDate('900', '2026-01-01', '2026-03-02', '2026-01-21', R)), '300.00');
    assert.equal(m(L.discountEarnedToDate('900', '2026-01-01', '2026-03-02', '2026-03-02', R)), '900.00');
    assert.equal(m(L.discountEarnedToDate('900', '2026-01-01', '2026-03-02', '2026-06-01', R)), '900.00');
  });
});

describe('factoring', () => {
  test('the seller receives the advance less the service fee; the rest is reserve', () => {
    const p = L.factoringPurchase({ invoiceAmount: '20000', advanceRate: '0.85', serviceFeeRate: '0.005' }, R);
    assert.equal(m(p.advance), '17000.00');
    assert.equal(m(p.serviceFee), '100.00');
    assert.equal(m(p.paidToSeller), '16900.00');
    assert.equal(m(p.reserve), '3000.00');
    assert.throws(() => L.factoringPurchase({ invoiceAmount: '100', advanceRate: '0.1', serviceFeeRate: '0.2' }, R), /consume/);
  });

  test('recourse: FULL puts everything on the seller, NONE nothing, LIMITED up to its cap', () => {
    assert.deepEqual(L.recourseSplit('FULL', '1000', null), { borrowerOwes: '1000', lenderBears: '0' });
    assert.deepEqual(L.recourseSplit('NONE', '1000', null), { borrowerOwes: '0', lenderBears: '1000' });
    assert.deepEqual(L.recourseSplit('LIMITED', '1000', '400'), { borrowerOwes: '400', lenderBears: '600' });
    // What the seller already paid counts towards the cap.
    assert.deepEqual(L.recourseSplit('LIMITED', '700', '400', '300'), { borrowerOwes: '100', lenderBears: '600' });
    assert.deepEqual(L.recourseSplit('LIMITED', '50', '400'), { borrowerOwes: '50', lenderBears: '0' });
    assert.throws(() => L.recourseSplit('LIMITED', '10', null), /cap/);
  });

  test('debtor concentration is measured against the limit', () => {
    assert.equal(L.debtorConcentration({ limit: '100000', debtorOutstanding: '30000', newAdvance: '20000', maxShare: '0.5' }).ok, true);
    const over = L.debtorConcentration({ limit: '100000', debtorOutstanding: '40000', newAdvance: '20000', maxShare: '0.5' });
    assert.equal(over.ok, false);
    assert.match(over.message!, /60%/);
    assert.equal(L.debtorConcentration({ limit: '100', debtorOutstanding: '0', newAdvance: '100', maxShare: null }).ok, true);
  });
});

describe('documentary trade loans', () => {
  const terms = { maxTradeCycleDays: 120, proceedsGraceDays: 30, maxFinancingRatio: '0.9' };
  const base = { transactionValue: '100000', principal: '90000', cycleStartDate: '2026-01-10', expectedProceedsDate: '2026-04-10', financeDate: '2026-01-15', maturityDate: '2026-05-01' };

  test('a loan within the ratio, cycle and proceeds date passes', () => {
    const r = L.checkTradeCycle(terms, base);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
    assert.equal(r.latestMaturity, '2026-05-10');
    assert.equal(r.cycleDays, 90);
  });

  test('over-financing, a long cycle and a tenor past the proceeds are each refused', () => {
    const codes = (x: Partial<typeof base>) => L.checkTradeCycle(terms, { ...base, ...x }).issues.map((i) => i.code);
    assert.deepEqual(codes({ principal: '90000.01' }), ['TRADE_FINANCING_RATIO']);
    assert.deepEqual(codes({ expectedProceedsDate: '2026-06-01', maturityDate: '2026-06-15' }), ['TRADE_CYCLE']);
    assert.deepEqual(codes({ maturityDate: '2026-05-11' }), ['TRADE_TENOR']);
    assert.deepEqual(codes({ expectedProceedsDate: '2026-01-12', maturityDate: '2026-01-20' }), ['TRADE_PROCEEDS_PAST']);
  });

  test('the checklist is complete only when every required document is verified', () => {
    const req = ['COMMERCIAL_INVOICE', 'BILL_OF_LADING'];
    assert.deepEqual(L.documentChecklist(req, []), { complete: false, missing: req, unverified: [] });
    assert.deepEqual(L.documentChecklist(req, [{ code: 'COMMERCIAL_INVOICE', status: 'VERIFIED' }, { code: 'BILL_OF_LADING', status: 'RECEIVED' }]), {
      complete: false,
      missing: [],
      unverified: ['BILL_OF_LADING'],
    });
    assert.equal(L.documentChecklist(req, [{ code: 'COMMERCIAL_INVOICE', status: 'VERIFIED' }, { code: 'BILL_OF_LADING', status: 'VERIFIED' }]).complete, true);
    assert.deepEqual(L.documentChecklist(req, [{ code: 'COMMERCIAL_INVOICE', status: 'VERIFIED' }, { code: 'BILL_OF_LADING', status: 'REJECTED' }]).missing, ['BILL_OF_LADING']);
  });

  test('proceeds settle the loan and the rest goes to the customer; less is a repayment', () => {
    assert.deepEqual(L.proceedsApplication('100000', '91234.56'), { applied: '91234.56', remitted: '8765.44', settles: true });
    assert.deepEqual(L.proceedsApplication('50000', '91234.56'), { applied: '50000', remitted: '0', settles: false });
  });
});

describe('product rules', () => {
  test('the receivables and documentary templates are available, each needing its capability', () => {
    const need: Record<string, string> = {
      FACTORING: 'trade.factoring',
      FORFAITING: 'trade.forfaiting',
      SUPPLY_CHAIN_FINANCE: 'trade.supply_chain',
      IMPORT_LOAN: 'trade.documentary',
      EXPORT_WORKING_CAPITAL: 'trade.documentary',
    };
    for (const [code, cap] of Object.entries(need)) {
      const a = L.templateAvailability(L.TEMPLATE_BY_CODE[code]);
      assert.ok(a.available, `${code} missing ${JSON.stringify(a.missing)}`);
      assert.ok(a.requiredCapabilities.includes(cap), `${code} requires ${cap}`);
    }
    assert.equal(L.receivablesKind(cfg('FACTORING')), 'FACTORING');
    assert.equal(L.receivablesKind(cfg('FORFAITING')), 'FORFAITING');
    assert.equal(L.receivablesKind(cfg('SUPPLY_CHAIN_FINANCE')), 'SUPPLY_CHAIN');
    assert.equal(L.receivablesKind(cfg('INVOICE_BACKED')), 'INVOICE_FINANCE');
    assert.equal(L.receivablesKind(cfg('IMPORT_LOAN')), null);
  });

  test('factoring recourse must agree with the product attribute, and LIMITED needs its share', () => {
    const c = cfg('FACTORING');
    c.trade.factoring.recourse = 'NONE';
    assert.ok(issues(c).some((i) => i.startsWith('attributes.recourse')));
    c.attributes.recourse = 'NON_RECOURSE';
    assert.deepEqual(issues(c), []);
    c.trade.factoring.recourse = 'LIMITED';
    c.attributes.recourse = 'LIMITED';
    assert.ok(issues(c).some((i) => i.startsWith('trade.factoring.limitedRecourseRate')));
    c.trade.factoring.limitedRecourseRate = '0.3';
    assert.deepEqual(issues(c), []);
  });

  test('receivables ride a revolving limit; a documentary loan is a term loan that can settle early', () => {
    const f = cfg('FORFAITING');
    f.facility = { ...f.facility, type: 'TERM' };
    assert.ok(issues(f).some((i) => i.startsWith('facility.type')));
    const g = cfg('FORFAITING');
    g.attributes.recourse = 'FULL';
    assert.ok(issues(g).some((i) => i.startsWith('attributes.recourse')));
    const d = cfg('IMPORT_LOAN');
    d.repayment.earlySettlement.allowed = false;
    assert.ok(issues(d).some((i) => i.startsWith('repayment.earlySettlement')));
    const both = cfg('FACTORING');
    both.trade.forfaiting = cfg('FORFAITING').trade.forfaiting;
    assert.ok(issues(both).some((i) => i.startsWith('trade:')));
  });
});
