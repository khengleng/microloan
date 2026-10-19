/** The original loan module's schedule dates (DECISIONS D-104). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addMonthsClamped, calculateRepaymentSchedule, InterestMethod } from '../src/index.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('legacy schedule due dates', () => {
  test('a month-end start stays at month end instead of overflowing', () => {
    const s = calculateRepaymentSchedule({
      principal: 1200,
      annualInterestRate: 12,
      termMonths: 5,
      startDate: new Date('2026-01-31'),
      interestMethod: InterestMethod.FLAT,
    });
    assert.deepEqual(
      s.map((i) => iso(i.dueDate)),
      ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'],
    );
  });

  test('leap years and the 29th/30th', () => {
    assert.equal(iso(addMonthsClamped(new Date('2028-01-31'), 1)), '2028-02-29');
    assert.equal(iso(addMonthsClamped(new Date('2026-01-29'), 1)), '2026-02-28');
    assert.equal(iso(addMonthsClamped(new Date('2026-01-30'), 2)), '2026-03-30');
    assert.equal(iso(addMonthsClamped(new Date('2026-11-30'), 3)), '2027-02-28');
  });

  test('ordinary days are unchanged', () => {
    assert.equal(iso(addMonthsClamped(new Date('2026-01-15'), 1)), '2026-02-15');
    assert.equal(iso(addMonthsClamped(new Date('2026-12-10'), 1)), '2027-01-10');
    const at = new Date('2026-03-15T07:30:00.000Z');
    assert.equal(addMonthsClamped(at, 1).toISOString(), '2026-04-15T07:30:00.000Z');
  });
});
