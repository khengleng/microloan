/**
 * Financial-review fixes: cumulative penalty rounding (D-133), rewinding
 * penalties a backdated payment prevented (D-135), the flat-schedule clamp
 * (D-136) and cross-currency payments in the loan's rounding increment (D-136).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD = { increment: '0.01', mode: 'HALF_UP' as const };
const KHR100 = { increment: '100', mode: 'HALF_UP' as const };

/** Run the daily assessment `days` times from `start`, one day at a time. */
function daily(overdue: string, rate: string, rounding: L.RoundingRule, days: number, start = '2026-03-01') {
  let accrued = '0';
  let posted = '0';
  const charges: string[] = [];
  let from = start;
  for (let i = 0; i < days; i++) {
    const to = L.addDays(from, 1);
    const r = L.accruePenalty({ accruedToDate: accrued, postedToDate: posted, from, to, overdue, annualRate: rate, rounding });
    accrued = r.accruedToDate;
    posted = r.postedToDate;
    charges.push(r.charge);
    from = to;
  }
  return { accrued, posted, charges };
}

describe('penalty accrual rounds the cumulative amount (D-133)', () => {
  test('USD 10 overdue at 24%: 30 days charge 0.20, not 30 × 0.01', () => {
    // 10 × 0.24 / 365 = 0.0065753… a day; 30 days = 0.19726… → 0.20.
    const r = daily('10', '0.24', USD, 30);
    const total = r.charges.reduce((s, c) => s.plus(c), new L.D(0));
    assert.equal(total.toString(), '0.2');
    assert.equal(r.posted, '0.2');
    assert.equal(new L.D(r.accrued).toDecimalPlaces(6).toString(), '0.19726');
    // Day 1 (0.0066) rounds to a cent; day 2 (0.0132 to date) adds nothing.
    assert.equal(r.charges[0], '0.01');
    assert.equal(r.charges[1], '0');
  });

  test('a single multi-day assessment and daily assessments post the same total', () => {
    const once = L.accruePenalty({
      accruedToDate: '0',
      postedToDate: '0',
      from: '2026-03-01',
      to: '2026-03-31',
      overdue: '10',
      annualRate: '0.24',
      rounding: USD,
    });
    assert.equal(once.charge, daily('10', '0.24', USD, 30).posted);
  });

  test('KHR rounded to 100 riel: the penalty is charged once it adds up to 50 riel or more', () => {
    // 40,000 KHR at 36% = 39.45 riel a day; day 1 rounds to 0, day 2 (78.9) to 100.
    const r = daily('40000', '0.36', KHR100, 10);
    assert.deepEqual(r.charges.slice(0, 3), ['0', '100', '0']);
    const total = r.charges.reduce((s, c) => s.plus(c), new L.D(0));
    // 10 days = 394.52 riel → 400.
    assert.equal(total.toString(), '400');
    assert.equal(r.posted, '400');
  });

  test('nothing overdue accrues nothing; a period that ends before it starts is refused', () => {
    const r = L.accruePenalty({ accruedToDate: '0.5', postedToDate: '0', from: '2026-03-01', to: '2026-03-05', overdue: '0', annualRate: '0.24', rounding: USD });
    assert.equal(r.periodAccrual, '0');
    assert.equal(r.charge, '0.5');
    assert.throws(
      () => L.accruePenalty({ accruedToDate: '0', postedToDate: '0', from: '2026-03-05', to: '2026-03-01', overdue: '1', annualRate: '0.24', rounding: USD }),
      /ends before it starts/,
    );
  });
});

describe('penalties a backdated payment prevented (D-135)', () => {
  test('a daily accrual is apportioned by the days on or after the value date', () => {
    const rec = { kind: 'DAILY' as const, from: '2026-03-01', to: '2026-03-11', accrued: '1' };
    assert.equal(L.penaltyPreventedBy(rec, '2026-03-06').toString(), '0.5');
    assert.equal(L.penaltyPreventedBy(rec, '2026-02-20').toString(), '1');
    assert.equal(L.penaltyPreventedBy(rec, '2026-03-11').toString(), '0');
  });

  test('a one-off charge is prevented only by a payment within grace', () => {
    const rec = { kind: 'ONCE' as const, from: '2026-03-05', to: '2026-03-10', accrued: '5' };
    assert.equal(L.penaltyPreventedBy(rec, '2026-03-05').toString(), '5');
    assert.equal(L.penaltyPreventedBy(rec, '2026-03-06').toString(), '0');
  });

  test('the reversal is posted less the rounded accrual left, and never more than is unpaid', () => {
    const r = L.rewindPenalty({ accruedToDate: '0.19726', postedToDate: '0.2', prevented: '0.0986', unpaid: '0.2', rounding: USD });
    assert.equal(r.reverse, '0.1');
    assert.equal(r.postedToDate, '0.1');
    const capped = L.rewindPenalty({ accruedToDate: '0.19726', postedToDate: '0.2', prevented: '0.19726', unpaid: '0.05', rounding: USD });
    assert.equal(capped.reverse, '0.05');
    assert.equal(capped.accruedToDate, '0');
  });
});

describe('flat schedules never carry a negative line (D-136)', () => {
  const flat = (over: Partial<L.ScheduleInput>): L.ScheduleInput => ({
    principal: '1000000',
    currency: 'KHR',
    disbursementDate: '2026-01-15',
    annualRate: '0.12',
    rateConvention: 'NOMINAL',
    interestMethod: 'FLAT',
    accrualBasis: 'PERIODIC',
    dayCount: 'ACT_365_FIXED',
    method: 'EQUAL_INSTALMENT',
    frequency: 'MONTHLY',
    numberOfInstalments: 7,
    ...over,
  });

  test('rounding each share up clamps the line at what is left', () => {
    // 1,000,000 / 12 = 83,333 → 100,000 in 100,000-riel steps would repay
    // 1,100,000 in eleven lines; lines stop at the balance instead.
    const s = L.generateSchedule(flat({ rounding: { increment: '100000', mode: 'HALF_UP' }, numberOfInstalments: 12 }));
    for (const l of s.lines) assert.ok(!new L.D(l.principal).isNegative(), `line ${l.number} principal ${l.principal}`);
    const repaid = s.lines.reduce((t, l) => t.plus(l.principal), new L.D(0));
    assert.equal(repaid.toString(), '1000000');
    assert.equal(s.lines[s.lines.length - 1].closingPrincipal, '0');
  });

  test('interest rounded up beyond the flat total is refused rather than given back on the last line', () => {
    assert.throws(
      () => L.generateSchedule(flat({ rounding: { increment: '100000', mode: 'UP' } })),
      /would be negative/,
    );
  });
});

describe('cross-currency payments are credited in the loan rounding increment (D-136)', () => {
  test('USD into a KHR loan rounding to 100 riel: the remainder is a rounding difference', () => {
    const r = L.convertPayment({
      amount: '10.01',
      from: 'USD',
      to: 'KHR',
      quote: { base: 'USD', quote: 'KHR', rate: '4100' },
      spreadBps: 0,
      rounding: KHR100,
    });
    // 10.01 × 4100 = 41,041 → credited 41,000; 41 riel to rounding differences.
    assert.equal(r.converted, '41000');
    assert.equal(r.roundingDifference, '41');
    assert.equal(r.gainLoss, '0');
    assert.equal(new L.D(r.converted).plus(r.roundingDifference).plus(r.gainLoss).toString(), r.midValue);
  });

  test('rounding up gives the borrower the difference (negative)', () => {
    const r = L.convertPayment({
      amount: '10.02',
      from: 'USD',
      to: 'KHR',
      quote: { base: 'USD', quote: 'KHR', rate: '4100' },
      spreadBps: 0,
      rounding: { increment: '100', mode: 'UP' },
    });
    assert.equal(r.converted, '41100');
    assert.equal(r.roundingDifference, '-18');
  });

  test('without a loan rule the currency minor units apply and there is no rounding difference', () => {
    const r = L.convertPayment({ amount: '100', from: 'USD', to: 'KHR', quote: { base: 'USD', quote: 'KHR', rate: '4100' }, spreadBps: 50 });
    assert.equal(r.roundingDifference, '0');
    assert.equal(r.gainLoss, '2050');
  });
});
