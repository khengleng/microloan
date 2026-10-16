import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const terms = (over: Partial<L.FloatingTerms> = {}): L.FloatingTerms => ({
  benchmarkCode: 'NBC_BASE',
  margin: '0.04',
  resetFrequency: 'QUARTERLY',
  floor: null,
  cap: null,
  ...over,
});

const obs = (rate: string, observationDate = '2026-01-01'): L.BenchmarkObservation => ({
  benchmarkCode: 'NBC_BASE',
  observationDate,
  rate,
});

/** A 12-month annuity at 10%, the contract the reset tests re-price. */
const contract: L.ScheduleInput = {
  principal: '12000',
  currency: 'USD',
  disbursementDate: '2026-01-01',
  annualRate: '0.10',
  rateConvention: 'NOMINAL',
  interestMethod: 'REDUCING_BALANCE',
  accrualBasis: 'PERIODIC',
  dayCount: 'ACT_365_FIXED',
  method: 'EQUAL_INSTALMENT',
  frequency: 'MONTHLY',
  numberOfInstalments: 12,
};

const remainingFrom = (s: L.ScheduleResult, fromIndex: number): L.RemainingLine[] =>
  s.lines.slice(fromIndex).map((l) => ({
    number: l.number,
    periodStart: l.periodStart,
    periodEnd: l.periodEnd,
    dueDate: l.dueDate,
    openingPrincipal: l.openingPrincipal,
    principal: l.principal,
    interest: l.interest,
  }));

describe('resolving a floating rate', () => {
  test('benchmark plus margin when neither bound binds', () => {
    const r = L.resolveFloatingRate(terms(), obs('0.065'));
    assert.equal(r.annualRate, '0.105');
    assert.equal(r.bound, 'BENCHMARK');
    assert.equal(r.indicated, '0.105');
    assert.match(r.source, /NBC_BASE 2026-01-01 \(0.065\) \+ 0.04/);
  });

  test('a floor lifts the rate and the source says so', () => {
    const r = L.resolveFloatingRate(terms({ floor: '0.09' }), obs('0.02'));
    assert.equal(r.annualRate, '0.09');
    assert.equal(r.bound, 'FLOOR');
    // The unbounded figure is kept: an auditor must see what was overridden.
    assert.equal(r.indicated, '0.06');
    assert.match(r.source, /floor 0.09 applied/);
  });

  test('a cap holds the rate down', () => {
    const r = L.resolveFloatingRate(terms({ cap: '0.12' }), obs('0.15'));
    assert.equal(r.annualRate, '0.12');
    assert.equal(r.bound, 'CAP');
    assert.equal(r.indicated, '0.19');
  });

  test('a floor below the indicated rate does not bind', () => {
    const r = L.resolveFloatingRate(terms({ floor: '0.05', cap: '0.20' }), obs('0.065'));
    assert.equal(r.annualRate, '0.105');
    assert.equal(r.bound, 'BENCHMARK');
  });

  test('an observation of another benchmark is refused, not silently used', () => {
    const wrong = { ...obs('0.05'), benchmarkCode: 'SOFR' };
    assert.throws(() => L.resolveFloatingRate(terms(), wrong), /BENCHMARK_MISMATCH|prices off NBC_BASE/);
  });

  test('a negative all-in rate is refused rather than charged', () => {
    assert.throws(
      () => L.resolveFloatingRate(terms({ margin: '0.01' }), obs('-0.03')),
      /NEGATIVE_RATE|set a floor/,
    );
  });
});

describe('reset schedule', () => {
  test('quarterly resets start one cycle after drawdown and stop before maturity', () => {
    const dates = L.resetSchedule('2026-01-01', '2027-01-01', 'QUARTERLY');
    assert.deepEqual(dates, ['2026-04-01', '2026-07-01', '2026-10-01']);
  });

  test('each frequency produces the right cycle over two years', () => {
    const count = (f: L.ResetFrequency) => L.resetSchedule('2026-01-01', '2028-01-01', f).length;
    assert.equal(count('MONTHLY'), 23);
    assert.equal(count('QUARTERLY'), 7);
    assert.equal(count('SEMI_ANNUAL'), 3);
    assert.equal(count('ANNUAL'), 1);
  });

  test('month-end anchoring follows the date arithmetic, not a 30-day step', () => {
    assert.deepEqual(L.resetSchedule('2026-01-31', '2026-07-01', 'MONTHLY'), [
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  test('a loan shorter than one cycle never resets', () => {
    assert.deepEqual(L.resetSchedule('2026-01-01', '2026-03-01', 'QUARTERLY'), []);
  });

  test('maturity on or before disbursement is refused', () => {
    assert.throws(() => L.resetSchedule('2026-01-01', '2026-01-01', 'MONTHLY'), /is not after disbursement/);
  });
});

describe('due resets', () => {
  const dates = ['2026-04-01', '2026-07-01', '2026-10-01'];

  test('only resets already reached and not yet applied are due', () => {
    assert.deepEqual(L.dueResets(dates, [], '2026-08-01'), ['2026-04-01', '2026-07-01']);
  });

  test('applied resets drop out', () => {
    assert.deepEqual(L.dueResets(dates, ['2026-04-01'], '2026-08-01'), ['2026-07-01']);
  });

  test('missed resets come back oldest first, to be caught up one at a time', () => {
    // Each is re-priced at the benchmark that applied then, never by jumping
    // the loan straight to today's rate.
    assert.deepEqual(L.dueResets(dates, [], '2026-12-01'), dates);
  });

  test('nothing is due before the first reset', () => {
    assert.deepEqual(L.dueResets(dates, [], '2026-03-31'), []);
  });
});

describe('projected timeline', () => {
  test('today rate first, then one projected point per reset', () => {
    const resolved = L.resolveFloatingRate(terms(), obs('0.06'));
    const timeline = L.projectRateTimeline(terms(), resolved, '2026-01-01', '2027-01-01');
    assert.equal(timeline.length, 4);
    assert.equal(timeline[0].annualRate, '0.1');
    assert.equal(timeline[0].projected, undefined); // the contractual opening rate
    assert.deepEqual(
      timeline.slice(1).map((p) => p.effectiveFrom),
      ['2026-04-01', '2026-07-01', '2026-10-01'],
    );
    assert.ok(timeline.slice(1).every((p) => p.projected === true));
  });

  test('a projection drives a real schedule', () => {
    const resolved = L.resolveFloatingRate(terms(), obs('0.06'));
    const rates = L.projectRateTimeline(terms(), resolved, '2026-01-01', '2027-01-01');
    const s = L.generateSchedule({ ...contract, annualRate: undefined, rates });
    assert.equal(s.lines.length, 12);
    // Held flat, the projection is just a 10% loan.
    const flat = L.generateSchedule({ ...contract, annualRate: '0.1' });
    assert.equal(s.totals.interest, flat.totals.interest);
  });
});

describe('applying a reset to a booked loan', () => {
  const original = L.generateSchedule(contract);

  test('re-prices from the first period starting on or after the reset date', () => {
    // Reset dated mid-period: it lands on the next period boundary, so
    // interest already earned is never re-priced.
    const r = L.applyRateReset(contract, remainingFrom(original, 3), '2026-04-10', '0.14', 'NBC_BASE + 4%');
    assert.equal(r.effectiveFrom, '2026-05-01');
    assert.equal(r.lines[0].number, 5);
    assert.equal(r.unchangedLines, 1); // the April line keeps the old rate
  });

  test('a reset exactly on a period start takes effect on that period', () => {
    const r = L.applyRateReset(contract, remainingFrom(original, 3), '2026-04-01', '0.14', 'src');
    assert.equal(r.effectiveFrom, '2026-04-01');
    assert.equal(r.unchangedLines, 0);
    assert.equal(r.lines[0].number, 4);
  });

  test('the balance is untouched and the remaining term is kept', () => {
    const remaining = remainingFrom(original, 3);
    const r = L.applyRateReset(contract, remaining, '2026-04-01', '0.14', 'src');
    assert.equal(r.lines.length, remaining.length); // 9 payments, re-priced
    assert.equal(r.lines[0].openingPrincipal, remaining[0].openingPrincipal);
    const repaid = r.lines.reduce((a, l) => a.plus(l.principal), new L.D(0));
    assert.equal(repaid.toString(), remaining[0].openingPrincipal);
    assert.equal(r.lines[8].closingPrincipal, '0');
  });

  test('a rise increases the instalment and the interest; a fall reduces both', () => {
    const remaining = remainingFrom(original, 3);
    const up = L.applyRateReset(contract, remaining, '2026-04-01', '0.14', 'src');
    const down = L.applyRateReset(contract, remaining, '2026-04-01', '0.06', 'src');
    const base = L.totalInterest(remaining);
    assert.ok(new L.D(L.totalInterest(up.lines)).gt(base), 'a rise must cost more');
    assert.ok(new L.D(L.totalInterest(down.lines)).lt(base), 'a fall must cost less');
    assert.ok(new L.D(up.instalmentAmount!).gt(down.instalmentAmount!));
    assert.match(up.explanation[0], /rises from 0.10 to 0.14/);
    assert.match(down.explanation[0], /falls from 0.10 to 0.06/);
  });

  test('the first re-priced period charges interest at the new rate', () => {
    const remaining = remainingFrom(original, 3);
    const r = L.applyRateReset(contract, remaining, '2026-04-01', '0.12', 'src');
    // bc: monthly nominal 0.12/12 = 0.01 on the opening balance.
    const expected = new L.D(remaining[0].openingPrincipal).times('0.01').toDecimalPlaces(2);
    assert.equal(r.lines[0].interest, expected.toString());
    assert.equal(r.lines[0].annualRate, '0.12');
  });

  test('an unchanged rate leaves the schedule as it was', () => {
    const remaining = remainingFrom(original, 3);
    const r = L.applyRateReset(contract, remaining, '2026-04-01', '0.1', 'src');
    assert.equal(L.totalInterest(r.lines), L.totalInterest(remaining));
    assert.match(r.explanation[0], /is unchanged/);
  });

  test('earlier rate points are kept, so the timeline stays a full history', () => {
    const remaining = remainingFrom(original, 3);
    const first = L.applyRateReset(contract, remaining, '2026-04-01', '0.14', 'first reset');
    // Re-price again later off a contract already carrying the first reset.
    const after: L.ScheduleInput = {
      ...contract,
      annualRate: undefined,
      rates: [
        { effectiveFrom: '2026-01-01', annualRate: '0.1', source: 'opening' },
        { effectiveFrom: '2026-04-01', annualRate: '0.14', source: 'first reset' },
      ],
    };
    const second = L.applyRateReset(after, remainingFrom({ ...original, lines: first.lines } as L.ScheduleResult, 3), '2026-07-01', '0.08', 'second reset');
    assert.equal(second.previousAnnualRate, '0.14');
    assert.equal(second.newAnnualRate, '0.08');
  });

  test('flat-rate interest cannot be re-priced', () => {
    const flat: L.ScheduleInput = { ...contract, interestMethod: 'FLAT' };
    assert.throws(
      () => L.applyRateReset(flat, remainingFrom(original, 3), '2026-04-01', '0.14', 'src'),
      /REPRICING_UNSUPPORTED|fixed when the loan is written/,
    );
  });

  test('a reset after the last period is refused rather than silently dropped', () => {
    assert.throws(
      () => L.applyRateReset(contract, remainingFrom(original, 11), '2027-06-01', '0.14', 'src'),
      /matures before this reset takes effect/,
    );
  });

  test('a fully repaid loan has nothing to re-price', () => {
    assert.throws(() => L.applyRateReset(contract, [], '2026-04-01', '0.14', 'src'), /nothing to re-price/);
  });

  test('a negative rate is refused', () => {
    assert.throws(
      () => L.applyRateReset(contract, remainingFrom(original, 3), '2026-04-01', '-0.01', 'src'),
      /contractual rate cannot be negative/,
    );
  });

  test('an equal-principal loan keeps its principal plan and re-prices only interest', () => {
    const ep: L.ScheduleInput = { ...contract, method: 'EQUAL_PRINCIPAL' };
    const base = L.generateSchedule(ep);
    const remaining = remainingFrom(base, 3);
    const r = L.applyRateReset(ep, remaining, '2026-04-01', '0.14', 'src');
    assert.deepEqual(
      r.lines.map((l) => l.principal),
      remaining.map((l) => l.principal),
    );
    assert.ok(new L.D(L.totalInterest(r.lines)).gt(L.totalInterest(remaining)));
  });
});
