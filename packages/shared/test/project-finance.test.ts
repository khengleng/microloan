import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const D = (v: string) => new L.D(v);

/** Twelve semi-annual periods from 2028-01-01 with CFADS ramping up then flat. */
const projection = (from = '2028-01-01', n = 12) =>
  Array.from({ length: n }, (_, i) => ({ dueDate: L.addMonths(from, 6 * (i + 1)), cfads: i < 2 ? '800000' : '1200000' }));

const base = {
  principal: '8000000',
  currency: 'USD',
  startDate: '2028-01-01',
  annualRate: '0.08',
  dayCount: 'ACT_365_FIXED',
  targetDscr: '1.30',
};

describe('sculpted repayment (LT-17)', () => {
  test('debt service follows CFADS at one cover ratio and the loan closes to exactly zero', () => {
    const r = L.sculptRepayment({ ...base, periods: projection() });
    const principal = r.explicitSchedule.reduce((t, l) => t.plus(l.principal), D('0'));
    assert.equal(principal.toString(), '8000000');
    assert.equal(r.lines[r.lines.length - 1].closingBalance, '0');
    assert.ok(D(r.sculptedDscr).gte(D('1.30')), `sculpted ${r.sculptedDscr}`);
    // Every period except the last (which absorbs rounding) sits on the sculpted ratio.
    for (const l of r.lines.slice(0, -1)) assert.ok(D(l.dscr!).minus(r.sculptedDscr).abs().lt(D('0.001')), `${l.dueDate}: ${l.dscr}`);
    // Lower CFADS → lower debt service in the ramp-up periods.
    assert.ok(D(r.lines[0].debtService).lt(D(r.lines[3].debtService)));
    assert.ok(D(r.minDscr!).gte(D('1.29')));
  });

  test('the sculpted principals rebuild through the ordinary schedule engine unchanged', () => {
    const r = L.sculptRepayment({ ...base, periods: projection() });
    const again = L.generateSchedule(r.scheduleInput);
    assert.deepEqual(again.lines.map((l) => [l.principal, l.interest]), r.schedule.lines.map((l) => [l.principal, l.interest]));
  });

  test('debt sizing: a principal the projection cannot carry at the target is refused, naming the maximum', () => {
    const r = L.sculptRepayment({ ...base, periods: projection() });
    assert.throws(
      () => L.sculptRepayment({ ...base, principal: L.roundMoney(D(r.maxDebt).plus(1000), { increment: '1', mode: 'UP' }).toString(), periods: projection() }),
      (e: Error) => /supports at most/.test(e.message),
    );
    // Exactly the maximum sculpts at the target.
    const at = L.sculptRepayment({ ...base, principal: r.maxDebt, periods: projection() });
    assert.ok(D(at.sculptedDscr).minus('1.30').abs().lt(D('0.0001')));
  });

  test('a balloon leaves principal to the last date and still closes', () => {
    const r = L.sculptRepayment({ ...base, balloonAmount: '1000000', periods: projection() });
    const last = r.lines[r.lines.length - 1];
    assert.ok(D(last.principal).gt(D('1000000')));
    assert.equal(last.closingBalance, '0');
  });

  test('refuses a period whose CFADS cannot pay its interest, and negative CFADS', () => {
    const p = projection();
    p[0].cfads = '1000';
    assert.throws(() => L.sculptRepayment({ ...base, principal: '6000000', periods: p }), /does not cover that period's interest/);
    p[0].cfads = '-5';
    assert.throws(() => L.sculptRepayment({ ...base, periods: p }), /negative/);
  });
});

describe('debt service reserve and cash waterfall (LT-17)', () => {
  test('the reserve target is the scheduled debt service of the months ahead', () => {
    const lines = [
      { dueDate: '2029-01-01', principal: '100', interest: '50' },
      { dueDate: '2029-07-01', principal: '100', interest: '40' },
      { dueDate: '2030-01-01', principal: '100', interest: '30' },
    ];
    assert.equal(L.dsraTarget(lines, '2028-12-31', 6), '150');
    assert.equal(L.dsraTarget(lines, '2029-01-01', 6), '140');
    assert.equal(L.dsraTarget(lines, '2029-01-01', 12), '270');
    assert.equal(L.dsraTarget(lines, '2029-01-01', 0), '0');
  });

  const wf = (over: Partial<Parameters<typeof L.applyWaterfall>[0]> = {}) =>
    L.applyWaterfall({
      currency: 'USD',
      revenue: '1500',
      operatingCosts: '300',
      taxes: '100',
      debtServiceDue: '700',
      periodDebtService: '700',
      dsraBalance: '0',
      dsraTarget: '200',
      lockUpBalance: '0',
      lockUpDscr: '1.10',
      sweepRate: '0.5',
      sweepCap: '10000',
      ...over,
    });

  test('applies receipts in order: debt service, reserve, sweep, distribution', () => {
    const r = wf();
    assert.equal(r.cfads, '1100');
    assert.equal(r.seniorFromCash, '700');
    assert.equal(r.dsraTopUp, '200');
    assert.equal(r.cashSweep, '100');
    assert.equal(r.distribution, '100');
    assert.equal(r.lockedUp, false);
    assert.equal(r.dscr, '1.5714');
    assert.deepEqual(r.steps.map((s) => s.code), ['OPERATING_COSTS', 'TAXES', 'SENIOR_DEBT_SERVICE', 'DSRA_DRAW', 'DSRA_TOP_UP', 'CASH_SWEEP', 'LOCK_UP', 'LOCK_UP_RELEASE', 'DISTRIBUTION']);
    assert.ok(r.steps[0].informational && r.steps[1].informational);
    // Every unit of CFADS is accounted for.
    const out = ['seniorFromCash', 'dsraTopUp', 'cashSweep', 'lockUpRetained', 'distribution'].reduce((t, k) => t.plus((r as any)[k]), D('0'));
    assert.equal(out.toString(), r.cfads);
  });

  test('locks up distributions when DSCR falls below the threshold, and releases them once it recovers', () => {
    const low = wf({ revenue: '1150', dsraBalance: '200' });
    assert.equal(low.dscr, '1.0714');
    assert.equal(low.lockedUp, true);
    assert.equal(low.distribution, '0');
    assert.equal(low.lockUpRetained, '25');
    assert.equal(low.cashSweep, '25');
    const back = wf({ dsraBalance: '200', lockUpBalance: low.lockUpBalanceAfter });
    assert.equal(back.lockedUp, false);
    assert.equal(back.lockUpReleased, '25');
    assert.equal(back.lockUpBalanceAfter, '0');
    assert.equal(back.distribution, D(back.cfads).minus(700).minus(back.cashSweep).plus(25).toString());
  });

  test('a shortfall is met from the reserve, and the period is locked up', () => {
    const r = wf({ revenue: '900', dsraBalance: '200' });
    assert.equal(r.seniorFromCash, '500');
    assert.equal(r.dsraDraw, '200');
    assert.equal(r.shortfall, '0');
    assert.equal(r.dsraBalanceAfter, '0');
    assert.equal(r.lockedUp, true);
    const worse = wf({ revenue: '600', dsraBalance: '100' });
    assert.equal(worse.shortfall, '400');
    assert.match(worse.lockUpReasons.join(' '), /went unpaid/);
  });
});
