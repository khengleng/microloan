import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const config = () => {
  const c = structuredClone(L.TEMPLATE_BY_CODE.PERSONAL_INSTALMENT.defaultConfig) as L.ProductConfig;
  c.pricing.fees = [];
  return c;
};
const base = (c: L.ProductConfig) =>
  L.toScheduleInput(c, { principal: '1000', numberOfInstalments: 12, disbursementDate: '2026-01-01', annualRate: '0.18' }, '1000');

const row: L.MigrationRowInput = {
  external_loan_id: 'OLD-1', customer_id: 'C-1', first_name: 'Sokha', last_name: 'Chan', product_code: 'PL',
  currency: 'USD', original_principal: '5000', disbursement_date: '2025-06-05', annual_rate_pct: '18',
  principal_outstanding: '3120.40', next_due_date: '2026-11-05', remaining_instalments: '12', current_period_start: '2026-10-05',
};

describe('loan-book migration', () => {
  test('the template parses and its example row is valid', () => {
    const p = L.parseMigrationFile(L.migrationTemplate());
    assert.deepEqual(p.fileErrors, []);
    assert.equal(p.rows.length, 1);
    assert.deepEqual(L.checkMigrationRow(p.rows[0].values, '2026-10-20'), []);
  });

  test('missing columns and repeated loans are file errors', () => {
    const p = L.parseMigrationFile('external_loan_id,customer_id\nA,1\nA,2\n');
    assert.ok(p.fileErrors.some((e) => /Missing column/.test(e)));
    assert.ok(p.fileErrors.some((e) => /appears on lines/.test(e)));
  });

  test('row checks name the field and the problem', () => {
    const issues = L.checkMigrationRow({ ...row, principal_outstanding: '1,200', next_due_date: '2026-10-01' }, '2026-10-20');
    assert.ok(issues.some((i) => i.field === 'principal_outstanding'));
    const later = L.checkMigrationRow({ ...row, next_due_date: '2026-10-01' }, '2026-10-20');
    assert.ok(later.some((i) => i.field === 'next_due_date'));
    const overdue = L.checkMigrationRow({ ...row, overdue_principal: '100' }, '2026-10-20');
    assert.ok(overdue.some((i) => i.field === 'oldest_overdue_date'));
  });

  test('a current loan rebuilds its remaining schedule from the current period, closing at zero', () => {
    const m = L.buildMigratedLoan(base(config()), row, '2026-10-20');
    assert.equal(m.lines.length, 12);
    assert.equal(m.lines[0].periodStart, '2026-10-05');
    assert.equal(m.lines[0].dueDate, '2026-11-05');
    assert.equal(m.lines.at(-1)!.closingPrincipal, '0');
    const principal = m.lines.reduce((s, l) => s.plus(l.principal), L.D(0));
    assert.equal(principal.toString(), '3120.4');
    assert.ok(Number(m.accruedAtCutOver) > 0 && Number(m.accruedAtCutOver) < Number(m.lines[0].interest));
    assert.equal(m.daysPastDue, 0);
    assert.equal(m.arrears, null);
  });

  test('arrears go on one line due on the oldest overdue date and set days past due; the old accrual is compared', () => {
    const m = L.buildMigratedLoan(
      base(config()),
      { ...row, overdue_principal: '200', overdue_interest: '45.10', overdue_penalties: '5', oldest_overdue_date: '2026-09-05', interest_accrued: '1.00' },
      '2026-10-20',
    );
    assert.equal(m.performingPrincipal, '2920.4');
    assert.deepEqual(m.arrears, { principal: '200', interest: '45.1', fees: '0', penalties: '5', dueDate: '2026-09-05' });
    assert.equal(m.daysPastDue, 45);
    assert.equal(m.interestOpening, L.D(m.accruedAtCutOver).plus('45.1').toString());
    assert.ok(m.warnings.some((w) => /Accrued interest per the old system/.test(w)));
    assert.equal(L.D(m.accrualDifference).toString(), L.D(m.accruedAtCutOver).minus(1).toString());
  });

  test('the currency must match the product', () => {
    assert.throws(() => L.buildMigratedLoan(base(config()), { ...row, currency: 'KHR' }, '2026-10-20'), /lends in USD/);
  });
});
