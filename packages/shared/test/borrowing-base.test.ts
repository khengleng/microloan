import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const classes: L.BorrowingBaseClass[] = [
  { code: 'RAW_MATERIALS', label: 'Raw materials', kind: 'INVENTORY', advanceRate: '0.5', maxAgeDays: 180, concentrationLimit: null },
  { code: 'FINISHED_GOODS', label: 'Finished goods', kind: 'INVENTORY', advanceRate: '0.6', maxAgeDays: null, concentrationLimit: null },
  { code: 'RECEIVABLES', label: 'Trade receivables', kind: 'RECEIVABLES', advanceRate: '0.8', maxAgeDays: 90, concentrationLimit: '0.25' },
];

describe('borrowing base (LT-14)', () => {
  test('eligible value by class × advance rate, less stated and aged ineligibles', () => {
    const r = L.computeBorrowingBase(
      classes,
      [
        { classCode: 'RAW_MATERIALS', description: 'Rice paddy, warehouse A', grossValue: '100000', ineligibleAmount: '10000', ineligibleReason: 'Damaged', ageDays: 30 },
        { classCode: 'RAW_MATERIALS', description: 'Old stock', grossValue: '20000', ageDays: 200 },
        { classCode: 'FINISHED_GOODS', description: 'Milled rice', grossValue: '50000' },
      ],
      'USD',
    );
    const raw = r.classes.find((c) => c.code === 'RAW_MATERIALS')!;
    assert.equal(raw.gross, '120000');
    assert.equal(raw.ineligible, '10000');
    assert.equal(raw.agedOut, '20000');
    assert.equal(raw.eligible, '90000');
    assert.equal(raw.advance, '45000');
    assert.equal(r.classes.find((c) => c.code === 'FINISHED_GOODS')!.advance, '30000');
    assert.equal(r.borrowingBase, '75000');
    assert.equal(r.eligible, '140000');
    assert.equal(r.ineligible, '30000');
    // Classes with no lines are left out.
    assert.equal(r.classes.length, 2);
  });

  test('one debtor above the concentration limit is capped at its share of the class', () => {
    const r = L.computeBorrowingBase(
      classes,
      [
        { classCode: 'RECEIVABLES', description: 'INV-1', counterparty: 'Big Buyer', grossValue: '60000', ageDays: 20 },
        { classCode: 'RECEIVABLES', description: 'INV-2', counterparty: 'big buyer ', grossValue: '20000', ageDays: 40 },
        { classCode: 'RECEIVABLES', description: 'INV-3', counterparty: 'Small Co', grossValue: '20000', ageDays: 10 },
        { classCode: 'RECEIVABLES', description: 'INV-4', counterparty: 'Late Co', grossValue: '5000', ageDays: 120 },
      ],
      'USD',
    );
    const rec = r.classes[0];
    // Eligible before concentration 100000 (INV-4 aged out); cap 25000 per debtor.
    assert.equal(rec.agedOut, '5000');
    assert.equal(rec.concentrationExcess, '55000');
    assert.equal(rec.eligible, '45000');
    assert.equal(rec.advance, '36000');
    assert.equal(r.lines[0].concentrationExcess, '55000');
    assert.equal(r.lines[1].concentrationExcess, '0');
  });

  test('refuses unknown classes and ineligibles above the gross value', () => {
    assert.throws(() => L.computeBorrowingBase(classes, [{ classCode: 'GOLD', description: 'x', grossValue: '1' }], 'USD'), /not a collateral class/);
    assert.throws(() => L.computeBorrowingBase(classes, [{ classCode: 'RAW_MATERIALS', description: 'x', grossValue: '1', ineligibleAmount: '2' }], 'USD'), /exceeds the gross/);
    assert.throws(() => L.computeBorrowingBase(classes, [], 'USD'), /at least one line/);
  });

  test('availability is the lower of limit and base less what is drawn, and nothing on a stale or missing certificate', () => {
    const ok = L.borrowingBaseAvailability({ limit: '100000', outstanding: '20000', date: '2026-02-10', maxAgeDays: 31, certificate: { asOfDate: '2026-01-31', borrowingBase: '75000' } });
    assert.equal(ok.drawingCap, '75000');
    assert.equal(ok.available, '55000');
    assert.equal(ok.stale, false);
    assert.equal(ok.certificateValidThrough, '2026-03-03');
    const capped = L.borrowingBaseAvailability({ limit: '50000', outstanding: '0', date: '2026-02-10', maxAgeDays: 31, certificate: { asOfDate: '2026-01-31', borrowingBase: '75000' } });
    assert.equal(capped.available, '50000');
    const stale = L.borrowingBaseAvailability({ limit: '100000', outstanding: '0', date: '2026-03-04', maxAgeDays: 31, certificate: { asOfDate: '2026-01-31', borrowingBase: '75000' } });
    assert.equal(stale.stale, true);
    assert.equal(stale.available, '0');
    assert.match(stale.reason!, /more than 31 days old/);
    const none = L.borrowingBaseAvailability({ limit: '100000', outstanding: '0', date: '2026-03-04', maxAgeDays: 31, certificate: null });
    assert.equal(none.available, '0');
    const over = L.borrowingBaseAvailability({ limit: '100000', outstanding: '80000', date: '2026-02-01', maxAgeDays: 31, certificate: { asOfDate: '2026-01-31', borrowingBase: '75000' } });
    assert.equal(over.available, '0');
  });
});
