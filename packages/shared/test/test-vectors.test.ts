/**
 * Golden test vectors TV-01..TV-20 (docs/servicing/TEST_VECTORS.md).
 *
 * Each vector is checked to the cent. Vectors the engine cannot yet reproduce
 * are recorded as `todo` with the reason, never weakened to pass; see
 * docs/servicing/TRACEABILITY.md for the gap and the use case it belongs to.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const base = (over: Partial<L.ScheduleInput> = {}): L.ScheduleInput => ({
  principal: '10000',
  currency: 'USD',
  disbursementDate: '2024-01-15',
  annualRate: '0.12',
  rateConvention: 'NOMINAL',
  interestMethod: 'REDUCING_BALANCE',
  accrualBasis: 'PERIODIC',
  dayCount: 'ACT_365_FIXED',
  method: 'EQUAL_INSTALMENT',
  frequency: 'MONTHLY',
  numberOfInstalments: 12,
  ...over,
});
const m = (v: string | null) => new L.D(v!).toFixed(2);
const accrue = (principal: string, annualRate: string, from: string, to: string) =>
  m(L.dailyAccrual([{ from, to, principal, annualRate }], 'ACT_365_FIXED').interest);

describe('test vectors', () => {
  test('TV-01 equal instalment (RM-1, UC-08)', () => {
    const s = L.generateSchedule(base());
    assert.equal(m(s.instalmentAmount), '888.49');
    assert.deepEqual([s.lines[0].interest, s.lines[0].principal, s.lines[0].closingPrincipal].map(m), ['100.00', '788.49', '9211.51']);
    assert.deepEqual([s.lines[1].interest, s.lines[1].principal, s.lines[1].closingPrincipal].map(m), ['92.12', '796.37', '8415.14']);
    assert.deepEqual([s.lines[10].interest, s.lines[10].principal, s.lines[10].closingPrincipal].map(m), ['17.51', '870.98', '879.67']);
    assert.deepEqual([s.lines[11].interest, s.lines[11].principal, s.lines[11].total, s.lines[11].closingPrincipal].map(m), ['8.80', '879.67', '888.47', '0.00']);
    assert.equal(m(s.totals.interest), '661.86');
  });

  test('TV-02 mortgage, 240 monthly (RM-1, LT-02)', () => {
    const s = L.generateSchedule(base({ principal: '100000', annualRate: '0.08', numberOfInstalments: 240 }));
    assert.equal(m(s.instalmentAmount), '836.44');
    assert.equal(m(s.lines[239].total), '836.37');
    assert.equal(m(s.totals.interest), '100745.53');
  });

  test('TV-03 equal principal (RM-2, UC-09)', () => {
    const s = L.generateSchedule(base({ method: 'EQUAL_PRINCIPAL' }));
    assert.equal(m(s.lines[0].principal), '833.33');
    assert.equal(m(s.lines[11].principal), '833.37');
    assert.deepEqual([s.lines[0].total, s.lines[1].total, s.lines[11].total].map(m), ['933.33', '925.00', '841.70']);
    assert.equal(m(s.totals.interest), '650.00');
  });

  test('TV-04 flat rate: schedule (RM-3, UC-10)', () => {
    const s = L.generateSchedule(base({ interestMethod: 'FLAT' }));
    assert.equal(m(s.totals.interest), '1200.00');
    for (const l of s.lines.slice(0, 11)) assert.equal(m(l.total), '933.33');
    assert.equal(m(s.lines[11].total), '933.37');
  });
  test('TV-04 flat rate: nominal 21.46%, effective 23.70% on 12 equal monthly periods (UC-10)', () => {
    const r = L.periodicRateFromPayments('10000', [...Array(11).fill('933.33'), '933.37'], 12);
    assert.equal(new L.D(r.nominalAnnualRate).times(100).toFixed(2), '21.46');
    assert.equal(new L.D(r.effectiveAnnualRate).times(100).toFixed(2), '23.70');
  });

  test('TV-05 interest-only then bullet (RM-4, UC-11, UC-12)', () => {
    const s = L.generateSchedule(base({ method: 'INTEREST_ONLY' }));
    for (const l of s.lines.slice(0, 11)) assert.equal(m(l.total), '100.00');
    assert.equal(m(s.lines[11].total), '10100.00');
  });

  test('TV-06 balloon balance after 60 payments (UC-12, LT-16)', () => {
    const s = L.generateSchedule(base({ principal: '100000', annualRate: '0.08', numberOfInstalments: 240 }));
    assert.equal(m(s.lines[59].closingPrincipal), '87525.57');
    assert.equal(m(new L.D(s.lines[59].total).plus(s.lines[59].closingPrincipal).toString()), '88362.01');
  });

  test('TV-07 revolving interest, 30 days at 24% (RM-5, UC-37)', () => {
    assert.equal(accrue('1000', '0.24', '2024-01-01', '2024-01-31'), '19.73');
  });

  test('TV-08 payday APR 391.07%: 75.00 on 500.00 for 14 days (LT-08)', () => {
    const r = L.periodicRateFromPayments('500', ['575'], new L.D(365).div(14).toString());
    assert.equal(new L.D(r.nominalAnnualRate).times(100).toFixed(2), '391.07');
  });

  test('TV-09 broken-period interest, 10 days (UC-07)', () => {
    assert.equal(accrue('10000', '0.12', '2024-01-01', '2024-01-11'), '32.88');
  });

  describe('TV-10 partial prepayment after month 2 (UC-29, UC-30)', () => {
    const s = L.generateSchedule(base());
    const remaining = s.lines.slice(2).map((l) => ({
      number: l.number, periodStart: l.periodStart, periodEnd: l.periodEnd, dueDate: l.dueDate,
      openingPrincipal: l.openingPrincipal, principal: l.principal, interest: l.interest,
    }));
    const asOf = remaining[0].periodStart;
    test('option A, keep term: new instalment 677.32', () => {
      const r = L.rescheduleAfterPrepayment(base(), remaining, asOf, '6415.14', 'RECAST', '888.49');
      assert.equal(m(r.lines[0].total), '677.32');
      assert.equal(r.lines.length, 10);
    });
    test('option B, keep instalment: 7 × 888.49 then 473.43', () => {
      const r = L.rescheduleAfterPrepayment(base(), remaining, asOf, '6415.14', 'SHORTEN', '888.49');
      assert.equal(r.lines.length, 8);
      for (const l of r.lines.slice(0, 7)) assert.equal(m(l.total), '888.49');
      assert.equal(m(r.lines[7].total), '473.43');
      assert.equal(m(r.lines[7].interest), '4.69');
    });
  });

  test('TV-11 full payoff 15 days into month 3: accrued interest and 2% penalty (UC-31, UC-32)', () => {
    const accrued = accrue('8415.14', '0.12', '2024-03-15', '2024-03-30');
    assert.equal(accrued, '41.50');
    // The API's early-settlement fee is feeRate × principal not yet due
    // (apps/api/src/lending/servicing/servicing.service.ts, settlement quote).
    const penalty = L.roundMoney(new L.D('8415.14').times('0.02'), { mode: 'HALF_UP', increment: '0.01' } as any);
    assert.equal(m(penalty.toString()), '168.30');
    assert.equal(m(new L.D('8415.14').plus(accrued).toString()), '8456.64');
    assert.equal(m(new L.D('8415.14').plus(accrued).plus(penalty).toString()), '8624.94');
  });

  test('TV-12 Rule of 78 rebate 323.08 (UC-33)', () => {
    const r = L.precomputedInterestRebate({ method: 'RULE_OF_78', totalInterest: '1200', principal: '10000', instalments: [], numberOfInstalments: 12, remainingInstalments: 6, rounding: { mode: 'HALF_UP', increment: '0.01' } as any });
    assert.equal(m(r.rebate), '323.08');
  });
  test('TV-13 3-month deferral, simple interest capitalized 252.45 → 8,667.59 (UC-49)', () => {
    const s = L.generateSchedule(base({ principal: '8415.14', numberOfInstalments: 13, principalGraceInstalments: 3, interestGraceInstalments: 3, graceCapitalization: 'SIMPLE' }));
    assert.equal(m(s.totals.capitalizedInterest), '252.45');
    assert.equal(m(s.lines[3].openingPrincipal), '8667.59');
  });

  test('TV-14 penalty interest, 10 days at 18% (UC-56)', () => {
    assert.equal(accrue('888.49', '0.18', '2024-01-01', '2024-01-11'), '4.38');
  });

  test('TV-15 allocation waterfall (UC-24, UC-25)', () => {
    const due = (component: L.DueComponent, outstanding: string) => ({ instalmentNumber: 1, dueDate: '2024-02-15', component, outstanding });
    const r = L.allocatePayment('500', [due('FEE', '10'), due('PENALTY', '4.38'), due('INTEREST', '100'), due('PRINCIPAL', '788.49')], ['FEE', 'PENALTY', 'INTEREST', 'PRINCIPAL'], 'OLDEST_DUE_FIRST');
    const got = (c: string) => m(r.allocations.filter((a) => a.component === c).reduce((s, a) => s.plus(a.amount), new L.D(0)).toString());
    assert.deepEqual(['FEE', 'PENALTY', 'INTEREST', 'PRINCIPAL'].map(got), ['10.00', '4.38', '100.00', '385.62']);
    assert.equal(m(new L.D('788.49').minus(got('PRINCIPAL')).toString()), '402.87');
  });

  test('TV-16 student loan, 4 years simple interest capitalized → 24,800.00 at repayment start (LT-06)', () => {
    const s = L.generateSchedule(base({ principal: '20000', annualRate: '0.06', numberOfInstalments: 168, principalGraceInstalments: 48, interestGraceInstalments: 48, graceCapitalization: 'SIMPLE' }));
    assert.equal(m(s.totals.capitalizedInterest), '4800.00');
    assert.equal(m(s.lines[48].openingPrincipal), '24800.00');
  });
  test('TV-17 HELOC available limit 40,000.00 (LT-04)', () => {
    assert.equal(m(L.securedLineLimit('200000', '0.80', ['120000'], { mode: 'HALF_UP', increment: '0.01' } as any).limit), '40000.00');
  });
  test('TV-18 gold loan margin call: LTV 87.50%, repay 600.00 (UC-51)', () => {
    const r = L.marginCall('7000', '8000', '0.80', { mode: 'HALF_UP', increment: '0.01' } as any);
    assert.equal(new L.D(r.ltv).times(100).toFixed(2), '87.50');
    assert.equal(r.breached, true);
    assert.equal(m(r.requiredRepayment), '600.00');
    assert.equal(m(r.requiredAdditionalCollateral), '750.00');
  });

  test('TV-19 equipment lease with residual (LT-15)', () => {
    const s = L.generateSchedule(base({ principal: '50000', annualRate: '0.10', numberOfInstalments: 36, method: 'BALLOON', balloonAmount: '10000' }));
    assert.equal(m(s.instalmentAmount), '1374.02');
  });

  test('TV-20 invoice financing: advance 8,000.00, fee 400.00, 1,600.00 to the borrower (LT-18, UC-67)', () => {
    const terms = { invoiceAmount: '10000', advanceRate: '0.80', feeRatePerPeriod: '0.02', feePeriodDays: 30, feeBasis: 'WHOLE_PERIODS' as const };
    const r = L.invoiceSettlement(terms, 60, '10000', { mode: 'HALF_UP', increment: '0.01' } as any);
    assert.equal(m(r.advance), '8000.00');
    assert.equal(m(r.fee), '400.00');
    assert.equal(m(r.paidToBorrower), '1600.00');
    // Recourse: the customer pays 5,000 → the borrower owes the shortfall.
    assert.equal(m(L.invoiceSettlement(terms, 60, '5000', { mode: 'HALF_UP', increment: '0.01' } as any).recourseOwedByBorrower), '3400.00');
  });
});
