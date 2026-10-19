/**
 * Trade finance engine: invoice servicing (LT-18, UC-67, TV-20) and letters
 * of credit (LT-19, UC-53).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const R = { increment: '0.01', mode: 'HALF_UP' } as const;
const m = (v: string) => new L.D(v).toFixed(2);
const terms: L.InvoiceTerms = { invoiceAmount: '10000', advanceRate: '0.80', feeRatePerPeriod: '0.02', feePeriodDays: 30, feeBasis: 'WHOLE_PERIODS' };
const funded = (over: Partial<L.InvoicePosition> = {}): L.InvoicePosition => ({
  terms,
  advanceDate: '2026-01-05',
  advanceOutstanding: '8000',
  feeRaised: '0',
  feePaid: '0',
  recourseDate: null,
  ...over,
});

describe('invoice financing (LT-18)', () => {
  test('TV-20: debtor pays 10,000 after 60 days → fee 400, advance 8,000, 1,600 to the borrower', () => {
    assert.equal(m(L.invoiceAdvance(terms, R).advance), '8000.00');
    const r = L.allocateInvoiceCollection(funded(), { amount: '10000', valueDate: '2026-03-06', source: 'DEBTOR' }, R);
    assert.equal(m(r.feeRaise), '400.00');
    assert.equal(m(r.toFee), '400.00');
    assert.equal(m(r.toAdvance), '8000.00');
    assert.equal(m(r.toReserve), '1600.00');
    assert.equal(r.settled, true);
    // The servicing path agrees with the one-shot settlement calculation.
    const s = L.invoiceSettlement(terms, 60, '10000', R);
    assert.equal(m(s.paidToBorrower), m(r.toReserve));
  });

  test('a part period is a whole period; at least one period is charged', () => {
    assert.equal(m(L.invoiceFee(terms, 0, R)), '200.00');
    assert.equal(m(L.invoiceFee(terms, 30, R)), '200.00');
    assert.equal(m(L.invoiceFee(terms, 31, R)), '400.00');
    assert.equal(m(L.invoiceFee({ ...terms, feeBasis: 'PRO_RATA' }, 45, R)), '300.00');
  });

  test('partial debtor payments: the fee grows with time and is raised only once per amount', () => {
    const first = L.allocateInvoiceCollection(funded(), { amount: '3000', valueDate: '2026-01-20', source: 'DEBTOR' }, R);
    assert.equal(m(first.feeRaise), '200.00');
    assert.equal(m(first.toFee), '200.00');
    assert.equal(m(first.toAdvance), '2800.00');
    assert.equal(first.settled, false);
    const second = L.allocateInvoiceCollection(
      funded({ advanceOutstanding: '5200', feeRaised: '200', feePaid: '200' }),
      { amount: '7000', valueDate: '2026-02-20', source: 'DEBTOR' },
      R,
    );
    // 46 days → two periods → 400 in all, 200 more raised now.
    assert.equal(m(second.feeRaise), '200.00');
    assert.equal(m(second.toFee), '200.00');
    assert.equal(m(second.toAdvance), '5200.00');
    assert.equal(m(second.toReserve), '1600.00');
  });

  test('UC-67 recourse: the fee stops at the recourse date and the borrower owes advance + fee', () => {
    const recourseDate = L.invoiceRecourseDate('2026-02-04', 30);
    assert.equal(recourseDate, '2026-03-06');
    const p = funded({ recourseDate });
    // Fee to the recourse date: 60 days → 400; months later it has not grown.
    assert.equal(m(L.invoiceFeeToDate(p, '2026-06-30', R)), '400.00');
    const r = L.allocateInvoiceCollection(p, { amount: '8400', valueDate: '2026-06-30', source: 'BORROWER' }, R);
    assert.equal(m(r.toFee), '400.00');
    assert.equal(m(r.toAdvance), '8000.00');
    assert.equal(r.settled, true);
    assert.throws(
      () => L.allocateInvoiceCollection(p, { amount: '8400.01', valueDate: '2026-06-30', source: 'BORROWER' }, R),
      /recourse payment cannot exceed/,
    );
  });

  test('a debtor paying late, after recourse, still pays the surplus to the borrower', () => {
    const p = funded({ recourseDate: '2026-03-06', advanceOutstanding: '3000', feeRaised: '400', feePaid: '400' });
    const r = L.allocateInvoiceCollection(p, { amount: '10000', valueDate: '2026-04-01', source: 'DEBTOR' }, R);
    assert.equal(m(r.feeRaise), '0.00');
    assert.equal(m(r.toAdvance), '3000.00');
    assert.equal(m(r.toReserve), '7000.00');
  });

  test('a collection cannot precede the advance', () => {
    assert.throws(() => L.allocateInvoiceCollection(funded(), { amount: '1', valueDate: '2026-01-04', source: 'DEBTOR' }, R), /before the advance/);
  });
});

describe('letters of credit (LT-19, UC-53)', () => {
  const lc: L.LetterOfCreditFeeTerms = { feeRatePerPeriod: '0.005', feePeriodDays: 90, minimumFee: '50', maxTenorDays: 365 };

  test('fee: rate per started period, never below the minimum', () => {
    // 100,000 for 120 days: two quarters → 0.5% × 2 = 1,000.
    const f = L.letterOfCreditFee(lc, '100000', '2026-01-05', '2026-05-05', R);
    assert.equal(f.days, 120);
    assert.equal(f.periods, 2);
    assert.equal(m(f.fee), '1000.00');
    assert.equal(m(L.letterOfCreditFee(lc, '5000', '2026-01-05', '2026-02-05', R).fee), '50.00');
  });

  test('tenor and dates are checked', () => {
    assert.throws(() => L.letterOfCreditFee(lc, '1000', '2026-01-05', '2027-02-05', R), /at most 365 days/);
    assert.throws(() => L.letterOfCreditFee(lc, '1000', '2026-01-05', '2026-01-05', R), /after the issue date/);
  });

  test('a drawing must be within the undrawn amount and before expiry', () => {
    const credit = { amount: '100000', drawn: '60000', expiryDate: '2026-05-05' };
    assert.equal(L.checkLetterOfCreditDrawing(credit, { amount: '40000', date: '2026-05-05' }).ok, true);
    const over = L.checkLetterOfCreditDrawing(credit, { amount: '40000.01', date: '2026-04-01' });
    assert.equal(over.ok, false);
    assert.equal(over.issues[0].code, 'LC_EXCEEDED');
    assert.equal(L.checkLetterOfCreditDrawing(credit, { amount: '1', date: '2026-05-06' }).issues[0].code, 'LC_EXPIRED');
  });
});

describe('trade configuration', () => {
  const tpl = (code: string) => structuredClone(L.TEMPLATE_BY_CODE[code].defaultConfig);

  test('the invoice and letter-of-credit templates are available', () => {
    assert.equal(L.templateAvailability(L.TEMPLATE_BY_CODE.INVOICE_BACKED).available, true);
    assert.equal(L.templateAvailability(L.TEMPLATE_BY_CODE.LETTER_OF_CREDIT).available, true);
    assert.ok(L.requiredCapabilitiesFor(tpl('INVOICE_BACKED')).includes('trade.invoice_finance'));
    assert.ok(L.requiredCapabilitiesFor(tpl('LETTER_OF_CREDIT')).includes('trade.letter_of_credit'));
  });

  test('invoice financing needs a revolving facility with full recourse', () => {
    const c = tpl('INVOICE_BACKED');
    c.attributes.recourse = 'NON_RECOURSE';
    const r = L.validateProductConfig(c);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.issues.some((i) => i.path === 'attributes.recourse'));
    const t = tpl('SME_TERM') as any;
    t.trade = { invoice: { advanceRate: '0.8', feeRatePerPeriod: '0.02', feePeriodDays: 30 } };
    const r2 = L.validateProductConfig(t);
    assert.ok(!r2.ok && r2.issues.some((i) => i.path === 'trade.invoice'));
  });

  test('configurations without the new sections parse exactly as before', () => {
    const c = tpl('SME_TERM');
    assert.equal('trade' in c, false);
    assert.equal('syndication' in c, false);
  });
});
