import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const HEADER = 'reference,loan_ref,amount,currency,value_date,channel_txn_id';

describe('settlement file parsing (UC-18)', () => {
  test('parses lines, totals by currency and tolerates BOM, CRLF, comments and quotes', () => {
    const text =
      '﻿' +
      [
        HEADER + ',payer_name',
        '# settlement for 5 Feb',
        'R1,LN-1,100.50,USD,2026-02-05,TX-1,"Dara, Sok"',
        'R2,,20,USD,2026-02-05,TX-2,',
        'R3,LN-3,40000,KHR,2026-02-05,TX-3,',
      ].join('\r\n');
    const r = L.parseSettlementFile(text);
    assert.deepEqual(r.errors, []);
    assert.equal(r.lines.length, 3);
    assert.equal(r.lines[0].payerName, 'Dara, Sok');
    assert.equal(r.lines[0].lineNo, 3);
    assert.equal(r.lines[1].loanRef, null);
    assert.deepEqual(r.totals, { USD: '120.5', KHR: '40000' });
  });

  test('columns may come in any order', () => {
    const r = L.parseSettlementFile(
      'channel_txn_id,amount,currency,value_date,loan_ref,reference\nTX-9,5,USD,2026-02-05,LN-1,R',
    );
    assert.deepEqual(r.errors, []);
    assert.equal(r.lines[0].channelTxnId, 'TX-9');
    assert.equal(r.lines[0].amount, '5');
  });

  test('every malformed line is reported with its line number', () => {
    const r = L.parseSettlementFile(
      [
        HEADER,
        'R1,LN-1,-5,USD,2026-02-05,TX-1',
        'R2,LN-1,1.234,USD,2026-02-05,TX-2',
        'R3,LN-1,10,XXX,2026-02-05,TX-3',
        'R4,LN-1,10,USD,2026-02-30,TX-4',
        'R5,LN-1,10,USD,2026-02-05,',
        'R6,LN-1,0,USD,2026-02-05,TX-6',
      ].join('\n'),
    );
    assert.deepEqual(
      r.errors.map((e) => e.lineNo),
      [2, 3, 4, 5, 6, 7],
    );
    assert.match(r.errors[1].message, /more decimal places/);
    assert.equal(r.lines.length, 0);
  });

  test('a header without a required column, or with an unknown one, is refused', () => {
    assert.throws(() => L.parseSettlementFile('reference,amount\nx,1'), /missing column/);
    assert.throws(() => L.parseSettlementFile(`${HEADER},secret\n`), /Unknown column/);
    assert.throws(() => L.parseSettlementFile(''), /no header/);
  });

  test('an identical repeat of a transaction id is a duplicate; a different payment under the same id is an error', () => {
    const r = L.parseSettlementFile(
      [HEADER, 'R1,LN-1,10,USD,2026-02-05,TX-1', 'R1,LN-1,10.00,USD,2026-02-05,TX-1'].join('\n'),
    );
    assert.deepEqual(r.errors, []);
    assert.equal(r.lines[1].duplicateOf, 2);
    // Duplicates do not count towards the file total.
    assert.deepEqual(r.totals, { USD: '10' });
    const bad = L.parseSettlementFile(
      [HEADER, 'R1,LN-1,10,USD,2026-02-05,TX-1', 'R1,LN-1,11,USD,2026-02-05,TX-1'].join('\n'),
    );
    assert.equal(bad.errors.length, 1);
    assert.match(bad.errors[0].message, /different payment/);
  });

  test('normalised text hashes the same whatever the line endings', () => {
    assert.equal(L.normalizeFileText('a\r\nb\r\n\r\n'), L.normalizeFileText('a\nb'));
    assert.throws(() => L.parseCsv('a,"b\n'), /Unterminated/);
  });
});

describe('payroll remittance parsing (UC-19)', () => {
  const meta = { employer: 'ACME', period: '2026-02', currency: 'USD', valueDate: '2026-02-25' };

  test('lines take the file currency and date, and a transaction id from employer, period and employee', () => {
    const r = L.parsePayrollFile('employee_ref,national_id,loan_ref,amount\nE1,010203,,55.00\nE2,,LN-2,60', meta);
    assert.deepEqual(r.errors, []);
    assert.equal(r.lines[0].channelTxnId, 'ACME:2026-02:E1');
    assert.equal(r.lines[0].nationalId, '010203');
    assert.equal(r.lines[1].currency, 'USD');
    assert.equal(r.lines[1].valueDate, '2026-02-25');
    assert.deepEqual(r.totals, { USD: '115' });
  });

  test('a line needs a national id or a loan reference; the period must be a month', () => {
    const r = L.parsePayrollFile('employee_ref,national_id,loan_ref,amount\nE1,,,5', meta);
    assert.match(r.errors[0].message, /national_id or a loan_ref/);
    assert.throws(() => L.parsePayrollFile('employee_ref,amount\nE1,5', { ...meta, period: '2026-13' }), /YYYY-MM/);
  });
});

describe('cross-currency conversion (UC-21)', () => {
  test('USD paid on a KHR loan: bank rate is mid less the spread; the difference is FX gain', () => {
    const r = L.convertPayment({
      amount: '100',
      from: 'USD',
      to: 'KHR',
      quote: { base: 'USD', quote: 'KHR', rate: '4100' },
      spreadBps: 50,
    });
    assert.equal(r.midRate, '4100');
    assert.equal(r.bankRate, '4079.5');
    assert.equal(r.converted, '407950');
    assert.equal(r.midValue, '410000');
    assert.equal(r.gainLoss, '2050');
  });

  test('a rate quoted the other way is inverted, and the result rounds half-up to minor units', () => {
    const r = L.convertPayment({
      amount: '410050',
      from: 'KHR',
      to: 'USD',
      quote: { base: 'USD', quote: 'KHR', rate: '4100' },
      spreadBps: 0,
    });
    // 410050 / 4100 = 100.0121951…; the inverse rate is shown to 12 significant digits.
    assert.equal(r.midRate, '0.000243902439024');
    assert.equal(r.converted, '100.01');
    assert.equal(r.gainLoss, '0');
  });

  test('with no spread there is no gain, even on a rate with more decimals than the currency', () => {
    const r = L.convertPayment({
      amount: '0.03',
      from: 'USD',
      to: 'KHR',
      quote: { base: 'USD', quote: 'KHR', rate: '4100.123' },
      spreadBps: 0,
    });
    assert.equal(r.converted, '123');
    assert.equal(r.gainLoss, '0');
  });

  test('refuses same currency, wrong pair, bad spread and too-precise amounts', () => {
    const q = { base: 'USD', quote: 'KHR', rate: '4100' };
    assert.throws(() => L.convertPayment({ amount: '1', from: 'USD', to: 'USD', quote: q, spreadBps: 0 }), /already in the loan currency/);
    assert.throws(() => L.convertPayment({ amount: '1', from: 'THB', to: 'KHR', quote: q, spreadBps: 0 }), /cannot convert/);
    assert.throws(() => L.convertPayment({ amount: '1', from: 'USD', to: 'KHR', quote: q, spreadBps: 2000 }), /basis points/);
    assert.throws(() => L.convertPayment({ amount: '1.001', from: 'USD', to: 'KHR', quote: q, spreadBps: 0 }), /decimal places/);
    assert.throws(() => L.convertPayment({ amount: '1', from: 'USD', to: 'KHR', quote: { ...q, rate: '0' }, spreadBps: 0 }), /positive/);
  });

  test('a rate is usable only on or shortly before the value date', () => {
    assert.equal(L.rateUsable('2026-02-05', '2026-02-05', 0), true);
    assert.equal(L.rateUsable('2026-02-04', '2026-02-05', 0), false);
    assert.equal(L.rateUsable('2026-02-04', '2026-02-05', 1), true);
    assert.equal(L.rateUsable('2026-02-06', '2026-02-05', 5), false);
  });
});

describe('auto-debit (UC-16)', () => {
  const policy = { maxAttempts: 3, retryIntervalDays: 2 };

  test('retries until the attempt limit, and never after a final failure', () => {
    assert.equal(L.nextDebitAttempt(policy, 1, '2026-02-05', 'INSUFFICIENT_FUNDS'), '2026-02-07');
    assert.equal(L.nextDebitAttempt(policy, 2, '2026-02-07', 'INSUFFICIENT_FUNDS'), '2026-02-09');
    assert.equal(L.nextDebitAttempt(policy, 3, '2026-02-09', 'INSUFFICIENT_FUNDS'), null);
    assert.equal(L.nextDebitAttempt(policy, 1, '2026-02-05', 'ACCOUNT_CLOSED'), null);
  });

  test('collects what has fallen due, less any advance', () => {
    const lines = [
      { dueDate: '2026-02-05', outstanding: '120.50' },
      { dueDate: '2026-03-05', outstanding: '120.50' },
    ];
    assert.equal(L.amountToCollect(lines, '2026-02-05', '0'), '120.5');
    assert.equal(L.amountToCollect(lines, '2026-03-05', '20'), '221');
    assert.equal(L.amountToCollect(lines, '2026-02-05', '500'), '0');
  });
});

describe('channel reconciliation (UC-18, UC-19)', () => {
  const line = (over: Partial<L.ReconciliationLine>): L.ReconciliationLine => ({
    lineId: 'l',
    fileId: 'f',
    lineNo: 2,
    channelTxnId: 'TX',
    currency: 'USD',
    amount: '10',
    outcome: 'POSTED',
    ...over,
  });

  test('every amount is accounted for; open suspense, reversals and conflicting repeats are breaks', () => {
    const r = L.reconcileChannel([
      line({ lineId: 'a', amount: '100' }),
      line({ lineId: 'b', amount: '30', reversed: true }),
      line({ lineId: 'c', amount: '50', outcome: 'SUSPENSE', suspense: { remaining: '20', matched: '25', refunded: '5' } }),
      line({ lineId: 'd', amount: '100', outcome: 'DUPLICATE' }),
      line({ lineId: 'e', amount: '7', outcome: 'DUPLICATE', conflicting: true }),
    ]);
    assert.deepEqual(r.totals, [
      {
        currency: 'USD',
        lines: 5,
        duplicates: 2,
        fileTotal: '180',
        posted: '100',
        reversed: '30',
        suspenseMatched: '25',
        suspenseRefunded: '5',
        suspenseOpen: '20',
        difference: '0',
      },
    ]);
    assert.deepEqual(
      r.breaks.map((b) => [b.lineId, b.kind, b.amount]),
      [
        ['b', 'REVERSED', '30'],
        ['c', 'UNMATCHED_IN_SUSPENSE', '20'],
        ['e', 'CONFLICTING_DUPLICATE', '7'],
      ],
    );
  });

  test('no breaks once suspense is fully matched', () => {
    const r = L.reconcileChannel([
      line({ amount: '40', outcome: 'SUSPENSE', suspense: { remaining: '0', matched: '40', refunded: '0' } }),
      line({ amount: '60', currency: 'KHR' }),
    ]);
    assert.deepEqual(r.breaks, []);
    assert.deepEqual(
      r.totals.map((t) => [t.currency, t.difference]),
      [
        ['KHR', '0'],
        ['USD', '0'],
      ],
    );
  });
});
