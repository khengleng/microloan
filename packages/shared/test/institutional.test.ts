import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };

describe('institutional lending: ratings, limits and concessionality', () => {
  test('ratings are ranked best first and a minimum is enforced', () => {
    assert.ok(L.ratingRank('AAA') < L.ratingRank('BBB-'));
    assert.ok(L.isInvestmentGrade('BBB-'));
    assert.ok(!L.isInvestmentGrade('BB+'));
    assert.deepEqual(L.meetsMinimumRating('A', 'BBB-'), { ok: true, reason: null });
    assert.match(L.meetsMinimumRating('BB', 'BBB-').reason!, /rated BB; .* BBB- or better/);
    assert.match(L.meetsMinimumRating(null, 'BBB-').reason!, /unrated/);
    assert.equal(L.meetsMinimumRating(null, null).ok, true);
    assert.throws(() => L.ratingRank('Baa3'), /Unknown rating/);
  });

  const limit = { amount: '1000000', currency: 'USD', reviewOn: '2026-12-31' };
  const check = (over: Partial<L.LimitCheckInput>) =>
    L.checkLimitHeadroom({ label: 'Counterparty Bank A', limit, utilised: '600000', requested: '300000', currency: 'USD', asOf: '2026-06-30', ...over });

  test('an exposure within the limit passes and reports what is left', () => {
    const r = check({});
    assert.equal(r.ok, true);
    assert.equal(r.headroom, '400000');
    assert.equal(r.utilisationAfter, '0.9');
    assert.match(r.message, /100000 left/);
  });

  test('an exposure beyond the limit is refused with the figures', () => {
    const r = check({ requested: '500000' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'LIMIT_EXCEEDED');
    assert.match(r.message, /500000 USD would take exposure to 1100000 against a limit of 1000000 \(400000 available\)/);
    // Exactly at the limit is allowed.
    assert.equal(check({ requested: '400000' }).ok, true);
  });

  test('no limit, a lapsed review date or another currency is a refusal, not a pass', () => {
    assert.equal(check({ limit: null }).code, 'NO_LIMIT');
    assert.equal(check({ asOf: '2027-01-01' }).code, 'LIMIT_REVIEW_PASSED');
    assert.equal(check({ asOf: '2026-12-31' }).ok, true);
    assert.equal(check({ currency: 'KHR' }).code, 'LIMIT_CURRENCY');
  });

  test('exposure counts approvals and bookings as well as what is outstanding', () => {
    const e = L.totalExposure([
      { stage: 'OUTSTANDING', amount: '250000' },
      { stage: 'BOOKED', amount: '100000' },
      { stage: 'APPROVED', amount: '50000' },
      { stage: 'OUTSTANDING', amount: '10000' },
    ]);
    assert.equal(e.total, '410000');
    assert.deepEqual(e.byStage, { OUTSTANDING: '260000', BOOKED: '100000', APPROVED: '50000' });
  });

  test('grant element: a loan at the discount rate is not concessional; a soft loan is', () => {
    // 1,000,000 bullet after one year at 5%: PV of 1,050,000 at 5% ≈ face.
    const market = L.grantElement({ principal: '1000000', disbursementDate: '2026-01-01', payments: [{ date: '2027-01-01', amount: '1050000' }] });
    assert.equal(Number(market.grantElement), 0);
    // IDA-style: 0.75% service charge, 10-year grace, 30 years semi-annual equal principal.
    const sched = L.generateSchedule(
      L.toScheduleInput(
        L.TEMPLATE_BY_CODE.DEVELOPMENT_CONCESSIONAL.defaultConfig,
        { principal: '1000000', numberOfInstalments: 60, disbursementDate: '2026-01-01', principalGraceInstalments: 20, annualRate: '0.0075' },
        '1000000',
      ),
    );
    const soft = L.grantElement({
      principal: '1000000',
      disbursementDate: '2026-01-01',
      payments: sched.lines.map((l) => ({ date: l.dueDate, amount: l.total })),
      rounding: USD,
    });
    assert.ok(Number(soft.grantElement) > 0.35, soft.explanation);
    assert.match(soft.explanation, /grant element of/);
  });

  test('institutional products must name their counterparties; the money-market template is a single ACT/360 bullet', () => {
    const c = structuredClone(L.TEMPLATE_BY_CODE.INTERBANK.defaultConfig) as any;
    c.institutional = null;
    const r = L.validateProductConfig(c);
    assert.ok(!r.ok && r.issues.some((i) => i.path === 'institutional'));
    const ib = L.TEMPLATE_BY_CODE.INTERBANK.defaultConfig;
    assert.ok(L.requiredCapabilitiesFor(ib).includes('institutional.counterparty_limits'));
    // A 91-day placement: one line, interest = P × r × 91 / 360.
    const s = L.generateSchedule(L.toScheduleInput(ib, { principal: '1000000', numberOfInstalments: 1, disbursementDate: '2026-01-05', firstDueDate: '2026-04-06', annualRate: '0.05' }, '1000000'));
    assert.equal(s.lines.length, 1);
    assert.equal(s.lines[0].principal, '1000000');
    assert.equal(s.lines[0].interest, '12638.89');
    assert.equal(s.lines[0].dueDate, '2026-04-06');
  });
});
