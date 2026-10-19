import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const programme = (over: Partial<L.HolidayProgramme> = {}): L.HolidayProgramme => ({
  code: 'FLOOD_2026',
  name: 'Flood relief 2026',
  maxInstalments: 3,
  interestTreatment: 'DEFER_NO_CAPITALIZATION',
  termTreatment: 'EXTEND_TERM',
  opensOn: '2026-01-01',
  closesOn: '2026-06-30',
  minInstalmentsPaid: 3,
  maxDaysPastDue: 30,
  minInstalmentsRemaining: 2,
  maxHolidaysPerLoan: 1,
  allowRestructured: false,
  ...over,
});

const candidate = (over: Partial<L.HolidayCandidate> = {}): L.HolidayCandidate => ({
  status: 'ACTIVE',
  instalmentsPaid: 6,
  instalmentsRemaining: 12,
  daysPastDue: 0,
  priorHolidays: 0,
  isRestructured: false,
  holidayInProgress: false,
  ...over,
});

const ASOF = '2026-03-01';
const codes = (e: L.HolidayEligibility) => e.reasons.map((r) => r.code).sort();

describe('holiday eligibility', () => {
  test('a seasoned, current loan qualifies for the full holiday', () => {
    const e = L.checkHolidayEligibility(programme(), candidate(), ASOF);
    assert.equal(e.eligible, true);
    assert.deepEqual(e.reasons, []);
    assert.equal(e.maxInstalments, 3);
  });

  test('the programme window is enforced at both ends', () => {
    assert.deepEqual(codes(L.checkHolidayEligibility(programme(), candidate(), '2025-12-31')), ['NOT_OPEN']);
    assert.deepEqual(codes(L.checkHolidayEligibility(programme(), candidate(), '2026-07-01')), ['CLOSED']);
  });

  test('only an active loan qualifies', () => {
    for (const status of ['BOOKED', 'CLOSED', 'WRITTEN_OFF']) {
      const e = L.checkHolidayEligibility(programme(), candidate({ status }), ASOF);
      assert.ok(codes(e).includes('STATUS'), status);
    }
  });

  test('a loan already on holiday cannot take another', () => {
    const e = L.checkHolidayEligibility(programme(), candidate({ holidayInProgress: true }), ASOF);
    assert.deepEqual(codes(e), ['IN_PROGRESS']);
  });

  test('seasoning is required', () => {
    const e = L.checkHolidayEligibility(programme(), candidate({ instalmentsPaid: 1 }), ASOF);
    assert.deepEqual(codes(e), ['SEASONING']);
    assert.match(e.reasons[0].message, /requires 3/);
  });

  test('a loan too far behind does not qualify', () => {
    const e = L.checkHolidayEligibility(programme(), candidate({ daysPastDue: 60 }), ASOF);
    assert.deepEqual(codes(e), ['DPD']);
    assert.match(e.reasons[0].message, /allows at most 30/);
  });

  test('a loan slightly behind still qualifies: relief is for people in trouble', () => {
    const e = L.checkHolidayEligibility(programme(), candidate({ daysPastDue: 30 }), ASOF);
    assert.equal(e.eligible, true);
  });

  test('the per-loan limit is enforced', () => {
    const e = L.checkHolidayEligibility(programme(), candidate({ priorHolidays: 1 }), ASOF);
    assert.deepEqual(codes(e), ['LIMIT']);
  });

  test('a restructured loan is excluded unless the programme allows it', () => {
    const c = candidate({ isRestructured: true });
    assert.deepEqual(codes(L.checkHolidayEligibility(programme(), c, ASOF)), ['RESTRUCTURED']);
    assert.equal(
      L.checkHolidayEligibility(programme({ allowRestructured: true }), c, ASOF).eligible,
      true,
    );
  });

  test('a holiday must leave instalments behind to serve it', () => {
    // Two remaining and two that must remain leaves no room: deferring the
    // last payments is a term extension, not a holiday.
    const e = L.checkHolidayEligibility(programme(), candidate({ instalmentsRemaining: 2 }), ASOF);
    assert.deepEqual(codes(e), ['TOO_LATE']);
    assert.equal(e.maxInstalments, 0);
  });

  test('a short remaining term shortens the holiday rather than refusing it', () => {
    // 4 remaining − 2 that must remain = 2 deferrable, below the 3 offered.
    const e = L.checkHolidayEligibility(programme(), candidate({ instalmentsRemaining: 4 }), ASOF);
    assert.equal(e.eligible, true);
    assert.equal(e.maxInstalments, 2);
  });

  test('every reason is reported at once', () => {
    const e = L.checkHolidayEligibility(
      programme(),
      candidate({ instalmentsPaid: 0, daysPastDue: 90, isRestructured: true }),
      ASOF,
    );
    assert.deepEqual(codes(e), ['DPD', 'RESTRUCTURED', 'SEASONING']);
  });

  test('an incoherent programme is a programming error, not a refusal', () => {
    assert.throws(
      () => L.checkHolidayEligibility(programme({ maxInstalments: 0 }), candidate(), ASOF),
      /must defer at least one instalment/,
    );
    assert.throws(
      () => L.checkHolidayEligibility(programme({ opensOn: '2026-06-01', closesOn: '2026-01-01' }), candidate(), ASOF),
      /closes .* before it opens/,
    );
  });
});

describe('a holiday is an ordinary restructure', () => {
  test('it maps to a payment deferral with the programme treatment', () => {
    const o = L.holidayRestructureOptions(programme(), 3, '2026-03-01', 9);
    assert.equal(o.effectiveDate, '2026-03-01');
    assert.equal(o.paymentDeferralInstalments, 3);
    assert.equal(o.deferredInterestTreatment, 'DEFER_NO_CAPITALIZATION');
  });

  test('EXTEND_TERM pushes the maturity out by the holiday', () => {
    const o = L.holidayRestructureOptions(programme(), 3, '2026-03-01', 9);
    assert.equal(o.numberOfInstalments, 12, '9 remaining + 3 deferred');
  });

  test('KEEP_MATURITY holds the term and makes the later instalments heavier', () => {
    const o = L.holidayRestructureOptions(
      programme({ termTreatment: 'KEEP_MATURITY' }),
      3,
      '2026-03-01',
      9,
    );
    assert.equal(o.numberOfInstalments, 9);
  });

  test('a holiday longer than the programme grants is refused', () => {
    assert.throws(
      () => L.holidayRestructureOptions(programme(), 4, '2026-03-01', 9),
      /grants at most 3 instalment\(s\); 4 were requested/,
    );
  });

  test('a zero-instalment holiday is refused', () => {
    assert.throws(
      () => L.holidayRestructureOptions(programme(), 0, '2026-03-01', 9),
      /at least one instalment/,
    );
  });

  test('a holiday covering the whole remaining loan is a term extension, not a holiday', () => {
    assert.throws(
      () => L.holidayRestructureOptions(programme(), 3, '2026-03-01', 3),
      /that is a term extension, not a holiday/,
    );
  });

  test('the options drive the real restructure engine', () => {
    const contract: L.ScheduleInput = {
      principal: '12000',
      currency: 'USD',
      disbursementDate: '2026-01-01',
      annualRate: '0.12',
      rateConvention: 'NOMINAL',
      interestMethod: 'REDUCING_BALANCE',
      accrualBasis: 'DAILY',
      dayCount: 'ACT_365_FIXED',
      method: 'EQUAL_INSTALMENT',
      frequency: 'MONTHLY',
      numberOfInstalments: 12,
    };
    const schedule = L.generateSchedule(contract);
    const snapshot: L.BalanceSnapshot = {
      asOf: '2026-04-01',
      currency: 'USD',
      principal: schedule.lines[2].closingPrincipal,
      overduePrincipal: '0',
      overdueInterest: '0',
      accruedInterestNotDue: '0',
      fees: '0',
      penalties: '0',
      taxes: '0',
      unallocatedPayments: '0',
    };
    const options = L.holidayRestructureOptions(programme(), 3, '2026-04-01', 9);
    const calc = L.calculateRestructure(contract, snapshot, options, {
      allowInterestCapitalization: false,
      allowFeeCapitalization: true,
      allowPenaltyCapitalization: false,
      maxTotalInstalments: 60,
    });
    // The first three instalments after the holiday starts pay nothing.
    const deferred = calc.lines.slice(0, 3);
    assert.ok(
      deferred.every((l) => new L.D(l.total).isZero()),
      `expected three zero instalments, got ${JSON.stringify(deferred.map((l) => l.total))}`,
    );
    assert.ok(calc.lines.length > 3, 'the loan continues after the holiday');
  });
});

describe('the interest a holiday defers', () => {
  const contract: L.ScheduleInput = {
    principal: '12000',
    currency: 'USD',
    disbursementDate: '2026-01-01',
    annualRate: '0.12',
    rateConvention: 'NOMINAL',
    interestMethod: 'REDUCING_BALANCE',
    accrualBasis: 'DAILY',
    dayCount: 'ACT_365_FIXED',
    method: 'EQUAL_INSTALMENT',
    frequency: 'MONTHLY',
    numberOfInstalments: 12,
  };
  const schedule = L.generateSchedule(contract);
  const snapshot: L.BalanceSnapshot = {
    asOf: '2026-04-01',
    currency: 'USD',
    principal: schedule.lines[2].closingPrincipal,
    overduePrincipal: '0',
    overdueInterest: '0',
    accruedInterestNotDue: '0',
    fees: '0',
    penalties: '0',
    taxes: '0',
    unallocatedPayments: '0',
  };
  const calcFor = (treatment: L.DeferredInterestTreatment) =>
    L.calculateRestructure(
      contract,
      snapshot,
      L.holidayRestructureOptions(programme({ interestTreatment: treatment }), 3, '2026-04-01', 9),
      {
        allowInterestCapitalization: true,
        allowFeeCapitalization: true,
        allowPenaltyCapitalization: false,
        maxTotalInstalments: 60,
      },
    );

  test('a deferred holiday defers real interest, not zero', () => {
    // The deferred instalments show zero interest by construction, so reading
    // it off them would report every holiday as free.
    const calc = calcFor('DEFER_NO_CAPITALIZATION');
    assert.ok(
      calc.lines.slice(0, 3).every((l) => new L.D(l.interest).isZero()),
      'the deferred lines carry no interest of their own',
    );
    const deferred = L.holidayDeferredInterest(calc, 'DEFER_NO_CAPITALIZATION', 3);
    assert.ok(new L.D(deferred).gt(0), `expected real interest, got ${deferred}`);
  });

  test('a waived holiday reports what was given up', () => {
    const calc = calcFor('WAIVE');
    const waived = L.holidayDeferredInterest(calc, 'WAIVE', 3);
    assert.ok(new L.D(waived).gt(0), `expected a waived amount, got ${waived}`);
    assert.equal(waived, calc.concessionValue.futureInterestWaived);
  });

  test('a capitalizing holiday reports the interest it adds to the principal', () => {
    // Regression: the capitalized interest sits in capitalizedInterest, not
    // in interest, so summing interest reported every such holiday as free.
    const calc = calcFor('CAPITALIZE');
    const capitalized = L.holidayDeferredInterest(calc, 'CAPITALIZE', 3);
    assert.ok(new L.D(capitalized).gt(0), `expected capitalized interest, got ${capitalized}`);
    assert.equal(
      capitalized,
      calc.lines
        .slice(0, 3)
        .reduce((t, l) => t.plus(l.capitalizedInterest), new L.D(0))
        .toString(),
    );
  });

  test('paying separately leaves the interest on the instalments', () => {
    const calc = calcFor('PAY_SEPARATELY');
    const paid = L.holidayDeferredInterest(calc, 'PAY_SEPARATELY', 3);
    assert.ok(new L.D(paid).gt(0));
  });

  test('an unknown treatment is refused', () => {
    const calc = calcFor('DEFER_NO_CAPITALIZATION');
    assert.throws(
      () => L.holidayDeferredInterest(calc, 'FREE_MONEY' as never, 3),
      /Unknown deferred interest treatment/,
    );
  });
});

describe('what a holiday costs', () => {
  test('waiving the interest is the only treatment that is free', () => {
    const r = L.describeHolidayCost('WAIVE', '250');
    assert.equal(r.costsBorrower, false);
    assert.match(r.summary, /waived; the borrower pays nothing/);
  });

  test('capitalizing says plainly that the debt grows', () => {
    const r = L.describeHolidayCost('CAPITALIZE', '250');
    assert.equal(r.costsBorrower, true);
    assert.match(r.summary, /added to the principal and bears interest/);
  });

  test('deferring without capitalizing is payable later, without compounding', () => {
    const r = L.describeHolidayCost('DEFER_NO_CAPITALIZATION', '250');
    assert.equal(r.costsBorrower, true);
    assert.match(r.summary, /without bearing further interest/);
  });

  test('paying separately defers only principal', () => {
    const r = L.describeHolidayCost('PAY_SEPARATELY', '250');
    assert.equal(r.costsBorrower, true);
    assert.match(r.summary, /only principal is deferred/);
  });

  test('an unknown treatment is refused', () => {
    assert.throws(
      () => L.describeHolidayCost('FREE_MONEY' as never, '250'),
      /Unknown deferred interest treatment/,
    );
  });
});
