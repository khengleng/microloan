import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };

const revolving = (over: Partial<L.FacilityTerms> = {}): L.FacilityTerms => ({
  type: 'REVOLVING',
  currency: 'USD',
  limitAmount: '100000',
  availabilityStart: '2024-01-01',
  availabilityEnd: '2024-12-31',
  maturityDate: '2025-12-31',
  annualRate: '0.12',
  dayCount: 'ACT_365_FIXED',
  rounding: USD,
  minimumDrawdown: null,
  maximumDrawdown: null,
  commitmentFeeRate: null,
  minimumPaymentRate: null,
  minimumPaymentFloor: null,
  overlimitRate: null,
  tranches: [],
  ...over,
});

/** 40,000 drawn, 15,000 repaid, 20,000 drawn again — 2024 is a leap year. */
const MOVEMENTS: L.FacilityMovement[] = [
  { date: '2024-01-01', type: 'DRAWDOWN', amount: '40000' },
  { date: '2024-02-01', type: 'REPAYMENT', amount: '15000' },
  { date: '2024-03-01', type: 'DRAWDOWN', amount: '20000' },
];

describe('facility position', () => {
  test('a revolving limit measures headroom against the outstanding balance', () => {
    const p = L.facilityPosition(revolving(), MOVEMENTS, '2024-03-31');
    assert.equal(p.outstanding, '45000');
    assert.equal(p.totalDrawn, '60000');
    assert.equal(p.totalRepaid, '15000');
    assert.equal(p.available, '55000'); // 100,000 − 45,000: repaying reinstated the limit
    assert.equal(p.utilization, '0.45');
    assert.equal(p.overlimit, '0');
  });

  test('a staged drawdown measures headroom against the total ever advanced', () => {
    const terms = revolving({ type: 'STAGED_DRAWDOWN', tranches: [] });
    const p = L.facilityPosition(terms, MOVEMENTS, '2024-03-31');
    assert.equal(p.outstanding, '45000');
    assert.equal(p.available, '40000'); // 100,000 − 60,000 drawn: repayment does NOT reinstate
  });

  test('limitReinstates distinguishes the two families', () => {
    assert.equal(L.limitReinstates('REVOLVING'), true);
    assert.equal(L.limitReinstates('OVERDRAFT'), true);
    assert.equal(L.limitReinstates('STAGED_DRAWDOWN'), false);
  });

  test('movements after the as-of date are ignored', () => {
    const p = L.facilityPosition(revolving(), MOVEMENTS, '2024-01-31');
    assert.equal(p.outstanding, '40000');
    assert.equal(p.available, '60000');
  });

  test('capitalized charges consume headroom but are not an advance', () => {
    const p = L.facilityPosition(revolving(), [...MOVEMENTS, { date: '2024-03-15', type: 'CAPITALIZATION', amount: '500' }], '2024-03-31');
    assert.equal(p.outstanding, '45500');
    assert.equal(p.totalDrawn, '60000');
    assert.equal(p.available, '54500');
  });

  test('available is floored at zero once the balance passes the limit', () => {
    const p = L.facilityPosition(revolving({ limitAmount: '10000' }), [{ date: '2024-01-01', type: 'DRAWDOWN', amount: '12000' }], '2024-01-31');
    assert.equal(p.available, '0');
    assert.equal(p.overlimit, '2000');
    assert.equal(p.utilization, '1.2');
  });
});

describe('balance timeline', () => {
  test('one segment per constant-balance run, half-open at each boundary', () => {
    const segs = L.balanceTimeline(revolving(), MOVEMENTS, '2024-01-01', '2024-04-01');
    assert.deepEqual(segs, [
      { from: '2024-01-01', to: '2024-02-01', balance: '40000' },
      { from: '2024-02-01', to: '2024-03-01', balance: '25000' },
      { from: '2024-03-01', to: '2024-04-01', balance: '45000' },
    ]);
  });

  test('movements before the window fold into the opening balance', () => {
    const segs = L.balanceTimeline(revolving(), MOVEMENTS, '2024-02-15', '2024-03-01');
    assert.deepEqual(segs, [{ from: '2024-02-15', to: '2024-03-01', balance: '25000' }]);
  });

  test('an empty window produces no segments', () => {
    assert.deepEqual(L.balanceTimeline(revolving(), MOVEMENTS, '2024-02-01', '2024-02-01'), []);
  });

  test('a window ending before it starts is refused', () => {
    assert.throws(() => L.balanceTimeline(revolving(), MOVEMENTS, '2024-03-01', '2024-02-01'), /ends/);
  });
});

describe('facility interest', () => {
  // bc: (40000*31 + 25000*29 + 45000*31) = 403200 day-dollars
  //     403200 * 0.12 / 365 = 1104.657534246575342465753424657534246575
  test('interest follows the drawn balance day by day (bc: 1104.6575342465…)', () => {
    const r = L.accrueFacilityInterest(revolving(), MOVEMENTS, '2024-01-01', '2024-04-01');
    assert.equal(r.interest, '1104.66');
    assert.equal(r.overlimitInterest, '0');
    assert.equal(r.total, '1104.66');
    assert.equal(r.days, 91); // 31 + 29 + 31, leap February
    assert.equal(r.segments.length, 3);
  });

  test('per-segment interest sums to the unrounded total', () => {
    const r = L.accrueFacilityInterest(revolving(), MOVEMENTS, '2024-01-01', '2024-04-01');
    const summed = r.segments.reduce((a, s) => a.plus(s.interest), new L.D(0));
    assert.equal(summed.toDecimalPlaces(2).toString(), '1104.66');
  });

  // bc: 10000*0.12*31/365 = 101.9178082191780821917808219178082191780
  //     2000*0.24*31/365  =  40.76712328767123287671232876712328767123
  test('a balance over the limit is priced separately at the over-limit rate', () => {
    const terms = revolving({ limitAmount: '10000', overlimitRate: '0.24' });
    const r = L.accrueFacilityInterest(terms, [{ date: '2024-01-01', type: 'DRAWDOWN', amount: '12000' }], '2024-01-01', '2024-02-01');
    assert.equal(r.interest, '101.92');
    assert.equal(r.overlimitInterest, '40.77');
    assert.equal(r.total, '142.69');
  });

  test('an over-limit balance with no over-limit rate is refused, not silently charged', () => {
    const terms = revolving({ limitAmount: '10000', overlimitRate: null });
    assert.throws(
      () => L.accrueFacilityInterest(terms, [{ date: '2024-01-01', type: 'DRAWDOWN', amount: '12000' }], '2024-01-01', '2024-02-01'),
      /OVERLIMIT_NOT_PRICED|over-limit rate/,
    );
  });

  test('an overdraft in credit earns nothing — the engine pays no credit interest', () => {
    const terms = revolving({ type: 'OVERDRAFT', minimumPaymentRate: '0.05', minimumPaymentFloor: '50' });
    const r = L.accrueFacilityInterest(terms, [{ date: '2024-01-01', type: 'REPAYMENT', amount: '5000' }], '2024-01-01', '2024-02-01');
    assert.equal(r.total, '0');
  });

  // ACT/ACT ISDA splits at the year boundary: 2024 is leap (366), 2025 is not (365).
  // bc: 10000*0.12*(16/366 + 15/365) = 52.4590163934426229508 + 49.3150684931506849315
  test('ACT/ACT ISDA uses 366 across a leap-year boundary and still reports one segment', () => {
    const terms = revolving({ dayCount: 'ACT_ACT_ISDA' });
    const r = L.accrueFacilityInterest(terms, [{ date: '2024-12-16', type: 'DRAWDOWN', amount: '10000' }], '2024-12-16', '2025-01-16');
    assert.equal(r.days, 31);
    assert.equal(r.segments.length, 1);
    assert.equal(r.interest, '101.77'); // 52.459016… + 49.315068… = 101.774084…
    // The two year-parts are regrouped back onto the single balance segment
    // rather than leaking out as two, and they carry the unrounded total.
    assert.equal(new L.D(r.segments[0].interest).toDecimalPlaces(6).toString(), '101.774085');
  });
});

describe('commitment fee', () => {
  // bc: undrawn day-dollars = 60000*31 + 75000*29 + 55000*31 = 5740000
  //     5740000 * 0.005 / 365 = 78.63013698630136986301369863013698630
  test('priced on the daily undrawn commitment (bc: 78.6301369863…)', () => {
    const terms = revolving({ commitmentFeeRate: '0.005' });
    const r = L.commitmentFee(terms, MOVEMENTS, '2024-01-01', '2024-04-01');
    assert.equal(r.fee, '78.63');
    assert.equal(r.days, 91);
  });

  test('no rate means no fee', () => {
    assert.equal(L.commitmentFee(revolving(), MOVEMENTS, '2024-01-01', '2024-04-01').fee, '0');
  });

  test('a fully drawn facility leaves nothing undrawn to charge for', () => {
    const terms = revolving({ limitAmount: '40000', commitmentFeeRate: '0.005' });
    const r = L.commitmentFee(terms, [{ date: '2024-01-01', type: 'DRAWDOWN', amount: '40000' }], '2024-01-01', '2024-02-01');
    assert.equal(r.fee, '0');
  });
});

describe('drawdown eligibility', () => {
  const terms = revolving({ minimumDrawdown: '1000', maximumDrawdown: '50000' });

  test('a drawdown within the limit and the window is permitted', () => {
    const r = L.checkDrawdown(terms, MOVEMENTS, { date: '2024-04-01', amount: '10000' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.issues, []);
    assert.equal(r.resulting?.outstanding, '55000');
    assert.equal(r.resulting?.available, '45000');
  });

  test('drawing more than the available limit is refused', () => {
    const r = L.checkDrawdown(terms, MOVEMENTS, { date: '2024-04-01', amount: '60000' });
    assert.equal(r.ok, false);
    assert.equal(r.resulting, null);
    assert.match(r.issues.map((i) => i.message).join(' '), /exceed the available limit of 55000/);
  });

  test('drawing before availability starts and after it ends are both refused', () => {
    assert.match(L.checkDrawdown(terms, [], { date: '2023-12-31', amount: '5000' }).issues[0].message, /not available until 2024-01-01/);
    assert.match(L.checkDrawdown(terms, [], { date: '2025-01-01', amount: '5000' }).issues[0].message, /ended on 2024-12-31/);
  });

  test('every reason is reported at once, not one at a time', () => {
    const r = L.checkDrawdown(terms, MOVEMENTS, { date: '2025-06-01', amount: '60000' });
    assert.equal(r.ok, false);
    assert.ok(r.issues.length >= 2, `expected several issues, got ${JSON.stringify(r.issues)}`);
  });

  test('the minimum drawdown is enforced', () => {
    const r = L.checkDrawdown(terms, MOVEMENTS, { date: '2024-04-01', amount: '500' });
    assert.match(r.issues.map((i) => i.message).join(' '), /minimum drawdown is 1000/);
  });

  test('a final drawdown smaller than the minimum is allowed when it empties the line', () => {
    // Available is exactly 500, which is below the 1,000 floor — the borrower
    // must still be able to take the rest of their facility.
    const nearlyDrawn: L.FacilityMovement[] = [{ date: '2024-01-01', type: 'DRAWDOWN', amount: '99500' }];
    const r = L.checkDrawdown(terms, nearlyDrawn, { date: '2024-04-01', amount: '500' });
    assert.equal(r.ok, true);
  });

  test('the maximum single drawdown is enforced', () => {
    const r = L.checkDrawdown(terms, [], { date: '2024-04-01', amount: '60000' });
    assert.match(r.issues.map((i) => i.message).join(' '), /maximum single drawdown is 50000/);
  });

  test('sub-minor-unit amounts are refused', () => {
    const r = L.checkDrawdown(terms, [], { date: '2024-04-01', amount: '1000.005' });
    assert.equal(r.ok, false);
  });

  test('a tranche code on a revolving line is refused', () => {
    const r = L.checkDrawdown(terms, [], { date: '2024-04-01', amount: '5000', trancheCode: 'A' });
    assert.match(r.issues.map((i) => i.message).join(' '), /no tranches/);
  });
});

describe('staged drawdown tranches', () => {
  const staged = revolving({
    type: 'STAGED_DRAWDOWN',
    limitAmount: '70000',
    tranches: [
      { code: 'FOUNDATION', amount: '30000', availableFrom: '2024-01-01', conditions: [] },
      { code: 'FRAME', amount: '40000', availableFrom: '2024-03-01', conditions: ['SURVEY'] },
    ],
  });

  test('a tranche releases in full on or after its date with its conditions met', () => {
    const r = L.checkDrawdown(staged, [], { date: '2024-01-15', amount: '30000', trancheCode: 'FOUNDATION' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.resulting?.releasedTranches, ['FOUNDATION']);
  });

  test('a staged drawdown must name its tranche', () => {
    const r = L.checkDrawdown(staged, [], { date: '2024-01-15', amount: '30000' });
    assert.match(r.issues.map((i) => i.message).join(' '), /must name the tranche/);
  });

  test('a tranche is not partially released', () => {
    const r = L.checkDrawdown(staged, [], { date: '2024-01-15', amount: '25000', trancheCode: 'FOUNDATION' });
    assert.match(r.issues.map((i) => i.message).join(' '), /releases exactly 30000/);
  });

  test('a tranche cannot be drawn before its own availability date', () => {
    const r = L.checkDrawdown(staged, [], { date: '2024-02-01', amount: '40000', trancheCode: 'FRAME', satisfiedConditions: ['SURVEY'] });
    assert.match(r.issues.map((i) => i.message).join(' '), /not available until 2024-03-01/);
  });

  test('unsatisfied conditions block the release and are named', () => {
    const r = L.checkDrawdown(staged, [], { date: '2024-03-05', amount: '40000', trancheCode: 'FRAME' });
    assert.match(r.issues.map((i) => i.message).join(' '), /unsatisfied conditions: SURVEY/);
  });

  test('a satisfied condition releases the tranche', () => {
    const r = L.checkDrawdown(staged, [], { date: '2024-03-05', amount: '40000', trancheCode: 'FRAME', satisfiedConditions: ['SURVEY'] });
    assert.equal(r.ok, true);
  });

  test('a tranche cannot be released twice', () => {
    const released: L.FacilityMovement[] = [{ date: '2024-01-15', type: 'DRAWDOWN', amount: '30000', trancheCode: 'FOUNDATION' }];
    const r = L.checkDrawdown(staged, released, { date: '2024-02-01', amount: '30000', trancheCode: 'FOUNDATION' });
    assert.match(r.issues.map((i) => i.message).join(' '), /already been released/);
  });

  test('repaying does not let a construction tranche be drawn again', () => {
    const history: L.FacilityMovement[] = [
      { date: '2024-01-15', type: 'DRAWDOWN', amount: '30000', trancheCode: 'FOUNDATION' },
      { date: '2024-02-15', type: 'REPAYMENT', amount: '30000' },
    ];
    const p = L.facilityPosition(staged, history, '2024-02-20');
    assert.equal(p.outstanding, '0');
    assert.equal(p.available, '40000'); // only the FRAME tranche remains, not the repaid 30,000
  });
});

describe('overdraft minimum payment', () => {
  const od = revolving({ type: 'OVERDRAFT', limitAmount: '5000', minimumPaymentRate: '0.05', minimumPaymentFloor: '50' });

  test('the percentage applies when it beats the floor', () => {
    const m = L.overdraftMinimumPayment(od, '3000', '45');
    assert.equal(m.basis, 'RATE');
    assert.equal(m.amount, '195'); // 3000 × 5% = 150, + 45 charges
  });

  test('the floor applies when the percentage is smaller', () => {
    const m = L.overdraftMinimumPayment(od, '500', '10');
    assert.equal(m.basis, 'FLOOR');
    assert.equal(m.amount, '60'); // max(25, 50) + 10
  });

  test('the minimum never exceeds what is actually owed', () => {
    const m = L.overdraftMinimumPayment(od, '30', '2');
    assert.equal(m.basis, 'FULL_BALANCE');
    assert.equal(m.amount, '32');
  });

  test('the whole over-limit excess is demanded, not a percentage of it', () => {
    const m = L.overdraftMinimumPayment(od, '6000', '100');
    assert.equal(m.basis, 'OVERLIMIT');
    // 5,000 within limit × 5% = 250, + 100 charges, + the full 1,000 excess
    assert.equal(m.amount, '1350');
    assert.equal(m.components.overlimitComponent, '1000');
  });

  test('nothing is due on a facility in credit', () => {
    const m = L.overdraftMinimumPayment(od, '0', '0');
    assert.equal(m.basis, 'NONE');
    assert.equal(m.amount, '0');
  });

  test('asking a revolving line for a minimum payment is a programming error', () => {
    assert.throws(() => L.overdraftMinimumPayment(revolving(), '1000', '0'), /NOT_AN_OVERDRAFT|overdraft term/);
  });
});

describe('facility statement', () => {
  test('a period statement reports movements, charges and the closing position', () => {
    const terms = revolving({ commitmentFeeRate: '0.005' });
    const s = L.facilityStatement(terms, MOVEMENTS, '2024-01-01', '2024-04-01');
    assert.equal(s.openingBalance, '0');
    assert.equal(s.drawdowns, '60000');
    assert.equal(s.repayments, '15000');
    assert.equal(s.closingBalance, '45000');
    assert.equal(s.interest, '1104.66');
    assert.equal(s.commitmentFee, '78.63');
    assert.equal(s.chargesRaised, '1183.29'); // charges are stated, not folded into the balance
    assert.equal(s.position.available, '55000');
    assert.equal(s.minimumPayment, null);
  });

  test('an overdraft statement carries a minimum payment', () => {
    const od = revolving({ type: 'OVERDRAFT', limitAmount: '5000', minimumPaymentRate: '0.05', minimumPaymentFloor: '50' });
    const s = L.facilityStatement(od, [{ date: '2024-01-01', type: 'DRAWDOWN', amount: '2000' }], '2024-01-01', '2024-02-01');
    assert.equal(s.closingBalance, '2000');
    assert.ok(s.minimumPayment);
    assert.equal(s.minimumPayment?.basis, 'RATE');
  });

  test('the opening balance carries forward from an earlier period', () => {
    const s = L.facilityStatement(revolving(), MOVEMENTS, '2024-02-01', '2024-03-01');
    assert.equal(s.openingBalance, '40000');
    assert.equal(s.repayments, '15000');
    assert.equal(s.closingBalance, '25000');
  });
});

describe('term-out', () => {
  test('the drawn balance at the end of availability amortizes to maturity', () => {
    const terms = revolving({ availabilityEnd: '2024-06-30', maturityDate: '2026-06-30' });
    const t = L.termOut(terms, [{ date: '2024-01-01', type: 'DRAWDOWN', amount: '50000' }]);
    assert.equal(t.principal, '50000');
    assert.equal(t.effectiveDate, '2024-06-30');
    assert.equal(t.months, 24);
  });

  test('a part month does not count', () => {
    const terms = revolving({ availabilityEnd: '2024-06-30', maturityDate: '2025-06-29' });
    const t = L.termOut(terms, [{ date: '2024-01-01', type: 'DRAWDOWN', amount: '50000' }]);
    assert.equal(t.months, 11);
  });

  test('a facility with nothing drawn has nothing to term out', () => {
    assert.throws(() => L.termOut(revolving(), []), /NOTHING_TO_TERM_OUT|no balance/);
  });

  test('less than a month to maturity is refused rather than amortized into nothing', () => {
    const terms = revolving({ availabilityEnd: '2024-06-30', maturityDate: '2024-07-10' });
    assert.throws(() => L.termOut(terms, [{ date: '2024-01-01', type: 'DRAWDOWN', amount: '50000' }]), /TERM_OUT_TOO_SHORT|less than a month/);
  });
});

describe('terms validation', () => {
  const issues = (t: L.FacilityTerms) => L.validateFacilityTerms(t).map((i) => `${i.path}: ${i.message}`).join(' | ');

  test('a well-formed revolving line validates clean', () => {
    assert.deepEqual(L.validateFacilityTerms(revolving()), []);
  });

  test('a 30/360 convention is refused: a facility accrues on a fluctuating balance', () => {
    assert.match(issues(revolving({ dayCount: 'THIRTY_360_ISDA' })), /period convention/);
  });

  test('availability must not end before it starts, nor maturity before availability', () => {
    assert.match(issues(revolving({ availabilityStart: '2024-06-01', availabilityEnd: '2024-01-01' })), /ends .* before it starts/);
    assert.match(issues(revolving({ availabilityEnd: '2024-12-31', maturityDate: '2024-06-30' })), /before the end of availability/);
  });

  test('a non-positive limit is refused', () => {
    assert.match(issues(revolving({ limitAmount: '0' })), /greater than zero/);
  });

  test('minimum above maximum, and maximum above the limit, are both caught', () => {
    assert.match(issues(revolving({ minimumDrawdown: '5000', maximumDrawdown: '1000' })), /exceeds the maximum/);
    assert.match(issues(revolving({ maximumDrawdown: '200000' })), /exceeds the facility limit/);
  });

  test('overdraft terms do not leak onto other facility types', () => {
    assert.match(issues(revolving({ minimumPaymentRate: '0.05' })), /apply to an overdraft/);
    assert.match(issues(revolving({ tranches: [{ code: 'A', amount: '1000', availableFrom: '2024-01-01', conditions: [] }] })), /apply to a staged drawdown/);
  });

  test('an overdraft with no minimum payment terms is refused', () => {
    assert.match(issues(revolving({ type: 'OVERDRAFT' })), /needs a minimum payment/);
  });

  test('a staged facility needs tranches, and they must fit inside the limit', () => {
    assert.match(issues(revolving({ type: 'STAGED_DRAWDOWN' })), /at least one tranche/);
    const over = revolving({
      type: 'STAGED_DRAWDOWN',
      limitAmount: '50000',
      tranches: [
        { code: 'A', amount: '30000', availableFrom: '2024-01-01', conditions: [] },
        { code: 'B', amount: '30000', availableFrom: '2024-02-01', conditions: [] },
      ],
    });
    assert.match(issues(over), /exceeds the facility limit/);
  });

  test('duplicate tranche codes are caught', () => {
    const dup = revolving({
      type: 'STAGED_DRAWDOWN',
      tranches: [
        { code: 'A', amount: '1000', availableFrom: '2024-01-01', conditions: [] },
        { code: 'A', amount: '2000', availableFrom: '2024-02-01', conditions: [] },
      ],
    });
    assert.match(issues(dup), /Duplicate tranche code A/);
  });

  test('a negative rate is refused', () => {
    assert.match(issues(revolving({ annualRate: '-0.01' })), /cannot be negative/);
  });
});

describe('facility product configuration', () => {
  /** A template's config, deep-cloned so a patch cannot leak between tests. */
  const cfg = (code: string): L.ProductConfig => JSON.parse(JSON.stringify(L.TEMPLATE_BY_CODE[code].defaultConfig));
  const issues = (c: unknown): string => {
    const r = L.validateProductConfig(c);
    return r.ok ? '' : r.issues.map((i) => `${i.path}: ${i.message}`).join(' | ');
  };

  test('the shipped facility templates configure real terms, not just a type', () => {
    for (const code of ['CREDIT_CARD', 'CONSTRUCTION', 'HOME_EQUITY_LINE', 'OVERDRAFT', 'REVOLVING_CREDIT']) {
      const f = cfg(code).facility;
      assert.notEqual(f.type, 'TERM', `${code} must be a facility`);
      assert.ok(f.availabilityMonths, `${code} needs an availability period`);
      assert.equal(cfg(code).pricing.accrualBasis, 'DAILY', `${code} must accrue daily`);
    }
  });

  test('a TERM product cannot carry facility terms', () => {
    const c = cfg('PERSONAL_INSTALMENT');
    c.facility.commitmentFeeRate = '0.005';
    assert.match(issues(c), /a TERM product draws no limit; remove commitmentFeeRate/);
  });

  test('a facility must accrue daily — a periodic rate is undefined on a moving balance', () => {
    const c = cfg('REVOLVING_CREDIT');
    c.pricing.accrualBasis = 'PERIODIC';
    assert.match(issues(c), /requires DAILY accrual/);
  });

  test('flat interest cannot price a facility', () => {
    const c = cfg('REVOLVING_CREDIT');
    c.pricing.interestMethod = 'FLAT';
    assert.match(issues(c), /flat interest prices a fixed principal/);
  });

  test('an availability period is required', () => {
    const c = cfg('REVOLVING_CREDIT');
    c.facility.availabilityMonths = null;
    assert.match(issues(c), /needs an availability period/);
  });

  test('minimum payment terms belong to an overdraft only', () => {
    const c = cfg('REVOLVING_CREDIT');
    c.facility.minimumPaymentRate = '0.05';
    assert.match(issues(c), /apply to an overdraft/);
    const od = cfg('OVERDRAFT');
    od.facility.minimumPaymentRate = null;
    od.facility.minimumPaymentFloor = null;
    assert.match(issues(od), /needs a minimum payment rate or floor/);
  });

  test('tranches belong to a staged drawdown only, and must total the whole limit', () => {
    const c = cfg('REVOLVING_CREDIT');
    c.facility.tranches = [{ code: 'TRANCHE_A', label: 'A', shareOfLimit: '1', availableAfterMonths: 0, conditions: [] }];
    assert.match(issues(c), /tranches apply to a staged drawdown/);

    const staged = cfg('CONSTRUCTION');
    staged.facility.tranches = [
      { code: 'TRANCHE_A', label: 'A', shareOfLimit: '0.3', availableAfterMonths: 0, conditions: [] },
      { code: 'TRANCHE_B', label: 'B', shareOfLimit: '0.3', availableAfterMonths: 1, conditions: [] },
    ];
    assert.match(issues(staged), /shares must total exactly 1 \(they total 0.6\)/);
  });

  test('a staged drawdown must term out', () => {
    const c = cfg('CONSTRUCTION');
    c.facility.termOutOnExpiry = false;
    assert.match(issues(c), /must term out/);
  });

  test('a tranche cannot mature after availability ends', () => {
    const c = cfg('CONSTRUCTION');
    c.facility.tranches[2].availableAfterMonths = 99;
    assert.match(issues(c), /becomes available after the facility stops being available/);
  });

  test('facility type selects the capability activation will demand', () => {
    assert.ok(L.requiredCapabilitiesFor(cfg('REVOLVING_CREDIT')).includes('facility.revolving'));
    assert.ok(L.requiredCapabilitiesFor(cfg('OVERDRAFT')).includes('facility.overdraft'));
    assert.ok(L.requiredCapabilitiesFor(cfg('CONSTRUCTION')).includes('facility.staged_drawdown'));
    assert.ok(!L.requiredCapabilitiesFor(cfg('PERSONAL_INSTALMENT')).some((c) => c.startsWith('facility.')));
  });
});
