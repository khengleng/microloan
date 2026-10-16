import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const contract: L.ScheduleInput = {
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
};

const remainingFrom = (s: L.ScheduleResult, fromIndex: number): L.RemainingLine[] =>
  s.lines.slice(fromIndex).map((l) => ({ ...l }));

describe('partial prepayment', () => {
  const original = L.generateSchedule(contract);
  const balanceAfter3 = new L.D(original.lines[2].closingPrincipal);
  const newBalance = balanceAfter3.minus(2000);
  const asOf = original.lines[3].periodStart; // prepaid on the 3rd due date

  test('RECAST keeps 9 instalments and lowers the instalment (bc: factor 0.1167403628…)', () => {
    const r = L.rescheduleAfterPrepayment(contract, remainingFrom(original, 3), asOf, newBalance.toString(), 'RECAST', original.instalmentAmount);
    assert.equal(r.lines.length, 9);
    const expected = newBalance.times('0.116740362849681101498273002996').toDecimalPlaces(2);
    assert.equal(r.instalmentAmount, expected.toString());
    assert.equal(r.lines[0].number, 4);
    assert.equal(r.lines[0].interest, newBalance.times('0.01').toDecimalPlaces(2).toString());
    const repaid = r.lines.reduce((a, l) => a.plus(l.principal), new L.D(0));
    assert.equal(repaid.toString(), newBalance.toString());
    assert.equal(r.lines[8].closingPrincipal, '0');
  });

  test('SHORTEN keeps the 888.49 instalment and drops instalments from the end', () => {
    const r = L.rescheduleAfterPrepayment(contract, remainingFrom(original, 3), asOf, newBalance.toString(), 'SHORTEN', original.instalmentAmount);
    assert.ok(r.lines.length < 9);
    for (const l of r.lines.slice(0, -1)) assert.equal(l.total, '888.49');
    const repaid = r.lines.reduce((a, l) => a.plus(l.principal), new L.D(0));
    assert.equal(repaid.toString(), newBalance.toString());
    assert.equal(r.lines[r.lines.length - 1].closingPrincipal, '0');
  });

  test('mid-period prepayment splits current-period interest at the prepayment date (daily basis)', () => {
    const daily = { ...contract, accrualBasis: 'DAILY' as const };
    const s = L.generateSchedule(daily);
    const line = s.lines[0]; // 2024-01-15 → 2024-02-15, 31 days
    const r = L.rescheduleAfterPrepayment(daily, remainingFrom(s, 0), '2024-01-25', '5000', 'RECAST', s.instalmentAmount);
    // 10,000 × 0.12 × 10/365 + 5,000 × 0.12 × 21/365 = 32.876… + 34.520… = 67.397… → 67.40
    assert.equal(r.currentPeriodInterest, '67.4');
    assert.equal(r.lines[0].interest, '67.4');
    assert.ok(new L.D(r.lines[0].interest).lt(line.interest));
  });

  test('explicit (seasonal) schedules RECAST pro-rata and SHORTEN from the last harvest', () => {
    const seasonal: L.ScheduleInput = {
      ...contract,
      principal: '6000',
      method: 'EXPLICIT',
      accrualBasis: 'DAILY',
      frequency: undefined,
      numberOfInstalments: undefined,
      explicitSchedule: [
        { dueDate: '2024-05-15', principal: '2000' },
        { dueDate: '2024-09-15', principal: '2000' },
        { dueDate: '2024-12-15', principal: '2000' },
      ],
    };
    const s = L.generateSchedule(seasonal);
    const recast = L.rescheduleAfterPrepayment(seasonal, remainingFrom(s, 0), '2024-01-15', '3000', 'RECAST', null);
    assert.deepEqual(recast.lines.map((l) => l.principal), ['1000', '1000', '1000']);
    const shorten = L.rescheduleAfterPrepayment(seasonal, remainingFrom(s, 0), '2024-01-15', '3000', 'SHORTEN', null);
    assert.deepEqual(shorten.lines.map((l) => l.principal), ['2000', '1000']);
  });

  test('flat-rate loans refuse partial prepayment', () => {
    const flat = { ...contract, interestMethod: 'FLAT' as const };
    const s = L.generateSchedule(flat);
    assert.throws(() => L.rescheduleAfterPrepayment(flat, remainingFrom(s, 3), s.lines[3].periodStart, '5000', 'RECAST', s.instalmentAmount), /early settlement/);
  });
});

describe('contractual accrual reconciles to scheduled interest', () => {
  const s = L.generateSchedule(contract);
  const line = s.lines[0]; // interest 100.00 over 31 days

  test('periodic basis accrues straight-line by actual days', () => {
    assert.equal(L.accruedOnLine(line, '2024-01-30', contract).toString(), '48.39'); // 100 × 15/31
  });
  test('nothing before the period, everything at period end', () => {
    assert.equal(L.accruedOnLine(line, '2024-01-15', contract).toString(), '0');
    assert.equal(L.accruedOnLine(line, '2024-02-15', contract).toString(), '100');
    assert.equal(L.accruedOnLine(line, '2024-06-01', contract).toString(), '100');
  });
});

describe('payment allocation', () => {
  const dues: L.DueItem[] = [
    { instalmentNumber: 1, dueDate: '2024-02-15', component: 'PENALTY', outstanding: '2' },
    { instalmentNumber: 1, dueDate: '2024-02-15', component: 'INTEREST', outstanding: '10' },
    { instalmentNumber: 1, dueDate: '2024-02-15', component: 'PRINCIPAL', outstanding: '50' },
    { instalmentNumber: 2, dueDate: '2024-03-15', component: 'INTEREST', outstanding: '9' },
    { instalmentNumber: 2, dueDate: '2024-03-15', component: 'PRINCIPAL', outstanding: '51' },
  ];
  const order: L.DueComponent[] = ['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL'];

  test('oldest due first clears instalment 1 before instalment 2', () => {
    const r = L.allocatePayment('70', dues, order, 'OLDEST_DUE_FIRST');
    assert.deepEqual(r.allocations.map((a) => `${a.instalmentNumber}:${a.component}:${a.amount}`), ['1:PENALTY:2', '1:INTEREST:10', '1:PRINCIPAL:50', '2:INTEREST:8']);
    assert.equal(r.unallocated, '0');
  });

  test('component first clears all interest before any principal', () => {
    const r = L.allocatePayment('70', dues, order, 'COMPONENT_FIRST');
    assert.deepEqual(r.allocations.map((a) => `${a.instalmentNumber}:${a.component}:${a.amount}`), ['1:PENALTY:2', '1:INTEREST:10', '2:INTEREST:9', '1:PRINCIPAL:49']);
  });

  test('overpayment is returned as unallocated for excess handling', () => {
    const r = L.allocatePayment('200', dues, order, 'OLDEST_DUE_FIRST');
    assert.equal(r.unallocated, '78');
  });
});

describe('fees and effective rate', () => {
  const fees: L.FeeDefinition[] = [
    { code: 'PROCESSING', name: 'Processing', calculation: 'PERCENT_OF_PRINCIPAL', rate: '0.01', treatment: 'DEDUCTED', waivable: true },
    { code: 'ADMIN', name: 'Admin', calculation: 'FIXED', amount: '5', treatment: 'SEPARATE', taxRate: '0.1', waivable: false },
    { code: 'ARRANGEMENT', name: 'Arrangement', calculation: 'PERCENT_OF_PRINCIPAL', rate: '0.02', treatment: 'FINANCED', waivable: false },
  ];

  test('deducted, financed and separately collected fees with tax', () => {
    const r = L.computeUpfrontFees('1000', 'USD', { increment: '0.01', mode: 'HALF_UP' }, fees);
    assert.equal(r.deducted, '10');
    assert.equal(r.financed, '20');
    assert.equal(r.separate, '5.5');
    assert.equal(r.bookedPrincipal, '1020');
    assert.equal(r.netDisbursement, '990');
  });

  test('waiving a non-waivable fee is refused; waiving a waivable one zeroes it', () => {
    assert.throws(() => L.computeUpfrontFees('1000', 'USD', { increment: '0.01', mode: 'HALF_UP' }, fees, ['ADMIN']), /cannot be waived/);
    const r = L.computeUpfrontFees('1000', 'USD', { increment: '0.01', mode: 'HALF_UP' }, fees, ['PROCESSING']);
    assert.equal(r.deducted, '0');
  });

  test('fees raise the effective rate above the contractual rate', () => {
    const s = L.generateSchedule({ ...contract, principal: '1000' });
    const flows = (received: string) => [{ date: '2024-01-15', amount: received }, ...s.lines.map((l) => ({ date: l.dueDate, amount: `-${l.total}` }))];
    const noFees = new L.D(L.effectiveAnnualRate(flows('1000')));
    const withFees = new L.D(L.effectiveAnnualRate(flows('990')));
    // 12% nominal monthly ≈ 12.68% effective (actual/365 dates shift it slightly).
    assert.ok(noFees.gt('0.12') && noFees.lt('0.13'), `no-fee rate ${noFees}`);
    assert.ok(withFees.gt(noFees.plus('0.015')), `fee rate ${withFees}`);
  });
});
