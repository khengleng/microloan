/**
 * Financial reference tests for the lending engine.
 *
 * Expected values are computed independently of the engine — with `bc` at
 * 30-digit scale from the textbook formulas (see docs/lending/REFERENCE_CASES.md)
 * — and then rounded by hand to the currency's increment. The engine must
 * reproduce them exactly; there is no tolerance on money.
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

const sumOf = (xs: string[]) => xs.reduce((a, b) => a.plus(b), new L.D(0));
const closes = (s: L.ScheduleResult, principal: string) => {
  assert.equal(sumOf(s.lines.map((l) => l.principal)).minus(sumOf(s.lines.map((l) => l.capitalizedInterest))).toString(), principal);
  assert.equal(s.lines[s.lines.length - 1].closingPrincipal, '0');
  for (const l of s.lines) {
    assert.equal(new L.D(l.openingPrincipal).plus(l.capitalizedInterest).minus(l.principal).toString(), l.closingPrincipal, `line ${l.number} reconciles`);
  }
};

describe('equal instalments (A = P·i / [1 − (1+i)^−n])', () => {
  test('standard amortization: 10,000 USD, 12% nominal, 12 monthly', () => {
    const s = L.generateSchedule(base());
    // bc: A = 888.4878867834… → 888.49
    assert.equal(s.instalmentAmount, '888.49');
    assert.equal(s.lines[0].interest, '100'); // 10,000 × 0.01
    assert.equal(s.lines[0].principal, '788.49');
    assert.equal(s.lines.length, 12);
    for (const l of s.lines.slice(0, 11)) assert.equal(l.total, '888.49');
    closes(s, '10000');
    // The final instalment absorbs the rounding residual.
    const last = s.lines[11];
    assert.equal(s.finalResidual, new L.D(last.total).minus('888.49').toString());
    assert.ok(new L.D(s.finalResidual!).abs().lt('0.10'));
    assert.equal(s.engineVersion, L.LENDING_ENGINE_VERSION);
  });

  test('zero-rate loan: A = P / n with the residual on the last instalment', () => {
    const s = L.generateSchedule(base({ principal: '1000', annualRate: '0', numberOfInstalments: 3 }));
    assert.deepEqual(s.lines.map((l) => l.total), ['333.33', '333.33', '333.34']);
    assert.deepEqual(s.lines.map((l) => l.interest), ['0', '0', '0']);
    closes(s, '1000');
  });

  test('effective annual rate convention: monthly i = (1+r)^(1/12) − 1', () => {
    const s = L.generateSchedule(base({ rateConvention: 'EFFECTIVE' }));
    // bc: 1.12^(1/12) − 1 = 0.009488792934583…, 12 d.p.
    assert.equal(s.lines[0].periodicRate, '0.009488792935');
    assert.equal(s.lines[0].interest, '94.89');
    closes(s, '10000');
  });
});

describe('equal principal', () => {
  test('12,000 USD, 12% nominal, 12 monthly: principal 1,000 each, interest on opening balance', () => {
    const s = L.generateSchedule(base({ principal: '12000', method: 'EQUAL_PRINCIPAL' }));
    assert.ok(s.lines.every((l) => l.principal === '1000'));
    assert.deepEqual(s.lines.slice(0, 3).map((l) => l.interest), ['120', '110', '100']);
    // Σ interest = 0.01 × 1,000 × (12 + 11 + … + 1) = 780
    assert.equal(s.totals.interest, '780');
    closes(s, '12000');
  });
});

describe('flat versus reducing balance', () => {
  test('flat: total interest = P × r × years; payment = (P + TI)/n', () => {
    const s = L.generateSchedule(base({ interestMethod: 'FLAT' }));
    assert.equal(s.totals.interest, '1200'); // 10,000 × 0.12 × 1
    assert.equal(s.lines[0].principal, '833.33');
    assert.equal(s.lines[0].interest, '100');
    assert.equal(s.lines[11].principal, '833.37');
    assert.equal(s.lines[11].total, '933.37');
    closes(s, '10000');
  });

  test('flat interest costs more than reducing balance at the same headline rate', () => {
    const flat = L.generateSchedule(base({ interestMethod: 'FLAT' }));
    const reducing = L.generateSchedule(base());
    assert.ok(new L.D(flat.totals.interest).gt(reducing.totals.interest));
    assert.equal(reducing.totals.interest, new L.D(reducing.totals.payments).minus('10000').toString());
    assert.ok(new L.D(reducing.totals.interest).minus('661.85').abs().lte('0.05'));
  });

  test('flat rejects an effective-rate convention', () => {
    assert.throws(() => L.generateSchedule(base({ interestMethod: 'FLAT', rateConvention: 'EFFECTIVE' })), /flat rate is a nominal/);
  });
});

describe('day count and daily accrual', () => {
  test('ACT/ACT ISDA splits a period at the year boundary (leap year)', () => {
    const r = L.dailyAccrual([{ from: '2023-12-31', to: '2024-01-02', principal: '10000', annualRate: '0.1' }], 'ACT_ACT_ISDA');
    // bc: 10,000 × 0.1 × (1/365 + 1/366) = 5.4719664645557…
    assert.equal(new L.D(r.interest).toDecimalPlaces(10).toString(), '5.4719664646');
    assert.deepEqual(r.lines.map((l) => l.denominator), [365, 366]);
  });

  test('ACT/365F and ACT/360 over the same two days', () => {
    const seg = [{ from: '2023-12-31', to: '2024-01-02', principal: '10000', annualRate: '0.1' }];
    assert.equal(new L.D(L.dailyAccrual(seg, 'ACT_365_FIXED').interest).toDecimalPlaces(10).toString(), '5.4794520548');
    assert.equal(new L.D(L.dailyAccrual(seg, 'ACT_360').interest).toDecimalPlaces(10).toString(), '5.5555555556');
  });

  test('leap day is an accrual day', () => {
    const r = L.dailyAccrual([{ from: '2024-02-28', to: '2024-03-01', principal: '36500', annualRate: '0.1' }], 'ACT_365_FIXED');
    assert.equal(r.days, 2);
    assert.equal(new L.D(r.interest).toString(), '20');
  });

  test('30/360 ISDA versus 30E/360 at month ends', () => {
    assert.equal(L.dayCountDays('2024-01-31', '2024-02-29', 'THIRTY_360_ISDA'), 29);
    assert.equal(L.dayCountDays('2024-01-30', '2024-03-31', 'THIRTY_360_ISDA'), 60);
    assert.equal(L.dayCountDays('2024-01-15', '2024-03-31', 'THIRTY_360_ISDA'), 76);
    assert.equal(L.dayCountDays('2024-01-15', '2024-03-31', 'THIRTY_E_360'), 75);
  });

  test('unsupported conventions are rejected, not approximated', () => {
    assert.throws(() => L.yearFraction('2024-01-01', '2024-02-01', 'ACT_364'), /not supported/);
    assert.throws(() => L.generateSchedule(base({ dayCount: 'BUS_252' })), /not supported/);
    assert.throws(() => L.dailyAccrual([{ from: '2024-01-01', to: '2024-02-01', principal: '1', annualRate: '0.1' }], 'THIRTY_360_ISDA'), /period convention/);
  });
});

describe('irregular first period', () => {
  const irregular = base({ disbursementDate: '2024-01-10', firstDueDate: '2024-02-25', numberOfInstalments: 3 });

  test('periodic formula is refused for an irregular first period', () => {
    assert.throws(() => L.generateSchedule(irregular), (e: Error) => (e as L.EngineError).code === 'IRREGULAR_PERIOD_REQUIRES_DAILY');
  });

  test('daily accrual over actual intervals (46, 29, 31 days)', () => {
    const s = L.generateSchedule({ ...irregular, accrualBasis: 'DAILY' });
    assert.deepEqual(s.lines.map((l) => l.accrualDays), [46, 29, 31]);
    assert.deepEqual(s.lines.map((l) => l.dueDate), ['2024-02-25', '2024-03-25', '2024-04-25']);
    // bc: first-period interest 10,000 × 0.12 × 46/365 = 151.2328… → 151.23
    assert.equal(s.lines[0].interest, '151.23');
    // bc: level payment with per-period factors = 3416.6374921… → 3416.64
    assert.equal(s.instalmentAmount, '3416.64');
    closes(s, '10000');
  });
});

describe('grace and capitalization', () => {
  test('1 interest-grace (capitalized) + 1 interest-only, then annuity on the capitalized balance', () => {
    const s = L.generateSchedule(base({ numberOfInstalments: 6, interestGraceInstalments: 1, principalGraceInstalments: 2 }));
    assert.equal(s.lines[0].kind, 'CAPITALIZATION');
    assert.equal(s.lines[0].total, '0');
    assert.equal(s.lines[0].capitalizedInterest, '100');
    assert.equal(s.lines[0].closingPrincipal, '10100');
    assert.equal(s.lines[1].kind, 'INTEREST_ONLY');
    assert.equal(s.lines[1].interest, '101');
    assert.equal(s.lines[1].principal, '0');
    // bc: 10,100 × 0.01 / (1 − 1.01⁻⁴) = 2588.4390485… → 2588.44
    assert.equal(s.instalmentAmount, '2588.44');
    assert.equal(s.totals.capitalizedInterest, '100');
    closes(s, '10000');
  });

  test('interest grace cannot exceed principal grace', () => {
    assert.throws(() => L.generateSchedule(base({ interestGraceInstalments: 2, principalGraceInstalments: 1 })), /Interest grace/);
  });
});

describe('interest-only and balloon', () => {
  test('interest-only: periodic interest, principal plus interest at maturity', () => {
    const s = L.generateSchedule(base({ method: 'INTEREST_ONLY', numberOfInstalments: 4 }));
    assert.deepEqual(s.lines.map((l) => l.total), ['100', '100', '100', '10100']);
    closes(s, '10000');
  });

  test('balloon: A = [P − F/(1+i)^n] · i / [1 − (1+i)^−n]', () => {
    const s = L.generateSchedule(base({ principal: '20000', annualRate: '0.10', numberOfInstalments: 36, method: 'BALLOON', balloonAmount: '8000' }));
    // bc: 453.8729129927… → 453.87
    assert.equal(s.instalmentAmount, '453.87');
    const last = s.lines[35];
    assert.ok(new L.D(last.principal).gt('8000'));
    assert.ok(new L.D(last.total).minus('8453.87').abs().lt('1'));
    closes(s, '20000');
  });
});

describe('seasonal / explicitly dated schedules', () => {
  test('principal on harvest dates, interest over actual intervals', () => {
    const s = L.generateSchedule(
      base({
        principal: '5000',
        annualRate: '0.14',
        disbursementDate: '2024-03-01',
        method: 'EXPLICIT',
        accrualBasis: 'DAILY',
        frequency: undefined,
        numberOfInstalments: undefined,
        explicitSchedule: [
          { dueDate: '2024-08-15', principal: '2000' },
          { dueDate: '2024-12-20', principal: '3000' },
        ],
      }),
    );
    // bc: 5,000 × 0.14 × 167/365 = 320.2739… ; 3,000 × 0.14 × 127/365 = 146.1369…
    assert.deepEqual(s.lines.map((l) => l.accrualDays), [167, 127]);
    assert.deepEqual(s.lines.map((l) => l.interest), ['320.27', '146.14']);
    assert.deepEqual(s.lines.map((l) => l.principal), ['2000', '3000']);
  });

  test('explicit principal must equal the loan principal', () => {
    assert.throws(
      () => L.generateSchedule(base({ method: 'EXPLICIT', accrualBasis: 'DAILY', explicitSchedule: [{ dueDate: '2024-06-01', principal: '9000' }] })),
      /totals 9000/,
    );
  });
});

describe('business-day adjustment', () => {
  const calendar = { code: 'KH', weekendDays: [6, 7], holidays: ['2024-04-15'] };
  test('FOLLOWING moves weekend and holiday due dates forward', () => {
    const s = L.generateSchedule(base({ disbursementDate: '2024-01-13', numberOfInstalments: 4, businessDayConvention: 'FOLLOWING', calendar }));
    // 13 Feb (Tue), 13 Mar (Wed), 13 Apr (Sat → Mon 15 Apr is a holiday → Tue 16 Apr), 13 May (Mon)
    assert.deepEqual(s.lines.map((l) => l.dueDate), ['2024-02-13', '2024-03-13', '2024-04-16', '2024-05-13']);
    // Accrual stays on unadjusted dates, so PERIODIC remains valid.
    assert.equal(s.lines[2].periodEnd, '2024-04-13');
  });

  test('MODIFIED_FOLLOWING rolls back rather than into the next month', () => {
    assert.equal(L.adjustBusinessDay('2024-08-31', 'MODIFIED_FOLLOWING', calendar), '2024-08-30');
    assert.equal(L.adjustBusinessDay('2024-08-31', 'FOLLOWING', calendar), '2024-09-02');
  });

  test('month-end anchoring does not drift after February', () => {
    const s = L.generateSchedule(base({ disbursementDate: '2024-01-31', numberOfInstalments: 3 }));
    assert.deepEqual(s.lines.map((l) => l.dueDate), ['2024-02-29', '2024-03-31', '2024-04-30']);
  });
});

describe('currency minor units and rounding', () => {
  test('KHR rounds every line to 100 riel; the final line absorbs the residual', () => {
    const s = L.generateSchedule(base({ currency: 'KHR', principal: '4000000', annualRate: '0.18' }));
    // bc: 366,719.9716… → 366,700 at a 100-riel increment
    assert.equal(s.instalmentAmount, '366700');
    for (const l of s.lines) {
      assert.ok(new L.D(l.interest).mod(100).isZero(), `interest ${l.interest} is a multiple of 100`);
      assert.ok(new L.D(l.principal).mod(100).isZero(), `principal ${l.principal} is a multiple of 100`);
    }
    closes(s, '4000000');
  });

  test('KWD carries three decimals', () => {
    const s = L.generateSchedule(base({ currency: 'KWD', principal: '1000.000', annualRate: '0.05', numberOfInstalments: 4 }));
    // bc: 252.6095807… → 252.610
    assert.equal(s.instalmentAmount, '252.61');
    assert.equal(L.formatAmount(new L.D(s.instalmentAmount!), 'KWD'), '252.610');
    closes(s, '1000');
  });

  test('JPY has no minor units: fractional principal is rejected', () => {
    assert.throws(() => L.generateSchedule(base({ currency: 'JPY', principal: '100000.5' })), /decimal places/);
    const s = L.generateSchedule(base({ currency: 'JPY', principal: '1000000' }));
    assert.ok(s.lines.every((l) => !l.total.includes('.')));
  });

  test('an increment finer than the currency allows is rejected', () => {
    assert.throws(() => L.generateSchedule(base({ rounding: { increment: '0.001', mode: 'HALF_UP' } })), /more decimal places/);
  });
});

describe('floating-rate projection', () => {
  test('a projected reset re-solves the instalment and marks amounts as projected', () => {
    const s = L.generateSchedule(
      base({
        annualRate: undefined,
        rates: [
          { effectiveFrom: '2024-01-15', annualRate: '0.12', source: 'SOFR+3%' },
          { effectiveFrom: '2024-07-15', annualRate: '0.15', source: 'SOFR+3% projected', projected: true },
        ],
      }),
    );
    assert.equal(s.lines[0].total, '888.49');
    assert.equal(s.lines[5].projected, false);
    assert.equal(s.lines[6].projected, true);
    assert.equal(s.lines[6].annualRate, '0.15');
    assert.ok(new L.D(s.lines[6].total).gt('888.49'));
    assert.equal(s.hasProjectedAmounts, true);
    closes(s, '10000');
  });
});
