/** The lender's own operating parameters (TenantLendingSettings, DECISIONS D-071). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L, classifyByDaysOverdue, resolveInterestCap, checkInterestRateCap } from '../src/index.js';

describe('tenant lending settings', () => {
  test('defaults are the constants they replaced', () => {
    const d = L.defaultTenantLendingSettings();
    assert.deepEqual(d.regulatory.classes, L.NBC_IMPAIRMENT_CLASSES);
    assert.deepEqual(d.regulatory.sizeBandEdgesUsd, [500, 1_000, 5_000, 10_000, 50_000]);
    assert.equal(d.regulatory.sizeBandKhrPerUsd, '4000');
    assert.deepEqual(d.regulatory.rateBandEdgesPct, ['12', '15']);
    assert.deepEqual(d.accounting, {
      cash: '1000',
      retainedEarnings: '3100',
      regulatoryReserve: '3200',
      migrationClearing: '3900',
      fxPosition: '1050',
      fxGainLoss: '4410',
      unidentifiedSuspense: '2500',
      legacy: {
        loansReceivable: '1200',
        interestIncome: '4000',
        penaltyIncome: '4100',
        feeIncome: '4200',
        loanLossAllowance: '1300',
        provisionExpense: '5000',
        writeOffExpense: '5100',
      },
    });
    assert.deepEqual(d.payments, { maxFileLines: L.MAX_FILE_LINES, maxBackdateDays: 30 });
    assert.equal(d.access.maxDelegationDays, 30);
    assert.equal(d.legacyServicing.defaultAfterDaysOverdue, 30);
    assert.equal(d.legacyServicing.penaltyCapRate, '0.25');
    assert.deepEqual(L.validateTenantLendingSettings(d), []);
  });

  test('operations alert contacts: none by default, valid addresses only, at most ten (D-151)', () => {
    assert.deepEqual(L.defaultTenantLendingSettings().operations, { alertEmails: [] });
    const s = L.tenantLendingSettingsSchema.parse({ operations: { alertEmails: [' Ops@Lender.example '] } });
    assert.deepEqual(s.operations.alertEmails, ['ops@lender.example']);
    assert.equal(L.tenantLendingSettingsSchema.safeParse({ operations: { alertEmails: ['not-an-address'] } }).success, false);
    const eleven = Array.from({ length: 11 }, (_, i) => `ops${i}@lender.example`);
    assert.equal(L.tenantLendingSettingsSchema.safeParse({ operations: { alertEmails: eleven } }).success, false);
  });

  test('a partial version keeps every other default', () => {
    const s = L.tenantLendingSettingsSchema.parse({ access: { maxDelegationDays: 7 } });
    assert.equal(s.access.maxDelegationDays, 7);
    assert.deepEqual(s.accounting, L.defaultTenantLendingSettings().accounting);
  });

  test('unknown keys, bad codes and disordered classes are refused', () => {
    assert.equal(L.tenantLendingSettingsSchema.safeParse({ formula: 'x' }).success, false);
    assert.equal(L.tenantLendingSettingsSchema.safeParse({ accounting: { cash: '10 00' } }).success, false);
    const classes = L.NBC_IMPAIRMENT_CLASSES.map((c) => ({ ...c }));
    classes[1].minDpd = 40;
    const s = L.tenantLendingSettingsSchema.parse({ regulatory: { classes } });
    assert.ok(L.validateTenantLendingSettings(s).some((m) => m.includes('SPECIAL_MENTION')));
    const swapped = L.NBC_IMPAIRMENT_CLASSES.map((c) => ({ ...c }));
    [swapped[3].code, swapped[4].code] = [swapped[4].code, swapped[3].code];
    assert.ok(L.validateTenantLendingSettings(L.tenantLendingSettingsSchema.parse({ regulatory: { classes: swapped } })).length > 0);
  });

  test('every account code is listed for the chart check', () => {
    const codes = L.settingsAccountCodes(L.defaultTenantLendingSettings());
    assert.equal(codes.length, 14);
    assert.ok(codes.includes('3900') && codes.includes('1200') && codes.includes('3200'));
  });

  test('both NBC band sets, the term threshold and the restructure rules are settings (D-113, D-114)', () => {
    const d = L.defaultTenantLendingSettings();
    assert.deepEqual(d.regulatory.classes, L.NBC_SHORT_TERM_CLASSES);
    assert.deepEqual(d.regulatory.longTermClasses, L.NBC_LONG_TERM_CLASSES);
    assert.equal(d.regulatory.shortTermMaxDays, 366);
    assert.deepEqual(d.regulatory.restructured, { minClass: 'SUBSTANDARD', minProbationInstalments: 3 });
    assert.deepEqual(d.regulatory.writeOffMinDpd, { shortTerm: null, longTerm: null });
    // The cure can't be switched off: at least one on-time instalment.
    assert.equal(L.tenantLendingSettingsSchema.safeParse({ regulatory: { restructured: { minProbationInstalments: 0 } } }).success, false);
    const long = L.NBC_LONG_TERM_CLASSES.map((c) => ({ ...c }));
    long[2].minDpd = 20;
    const s = L.tenantLendingSettingsSchema.parse({ regulatory: { longTermClasses: long } });
    assert.ok(L.validateTenantLendingSettings(s).some((m) => m.includes('longTermClasses') && m.includes('SUBSTANDARD')));
    const b = L.regulatoryBands(d);
    assert.equal(b.longTerm[4].minDpd, 360);
    assert.equal(b.restructuredMinClass, 'SUBSTANDARD');
  });
});

describe('engine parameters that used to be constants', () => {
  test('payment files: the line limit is a parameter, 5,000 by default', () => {
    const header = 'reference,loan_ref,amount,currency,value_date,channel_txn_id';
    const rows = [1, 2, 3].map((i) => `R${i},,10.00,USD,2026-01-05,T${i}`);
    const file = [header, ...rows].join('\n');
    assert.equal(L.parseSettlementFile(file).errors.length, 0);
    assert.ok(L.parseSettlementFile(file, 2).errors.some((e) => e.message.includes('at most 2 lines')));
  });

  test('legacy classification takes the tiers, NBC by default', () => {
    assert.equal(classifyByDaysOverdue(20).classification, 'SPECIAL_MENTION');
    const tiers = [
      { classification: 'STANDARD', minDaysOverdue: 0, provisionRate: 0.01, label: 'Standard' },
      { classification: 'SPECIAL_MENTION', minDaysOverdue: 30, provisionRate: 0.05, label: 'Special mention' },
    ] as Parameters<typeof classifyByDaysOverdue>[1];
    assert.equal(classifyByDaysOverdue(20, tiers).classification, 'STANDARD');
  });

  test('the rate ceiling is a parameter, 18% by default; a tenant can only lower it', () => {
    assert.equal(resolveInterestCap(null), 18);
    assert.equal(resolveInterestCap(null, 24), 24);
    assert.equal(resolveInterestCap(30, 24), 24);
    assert.equal(resolveInterestCap(12, 24), 12);
    assert.equal(checkInterestRateCap(20, null).ok, false);
    assert.equal(checkInterestRateCap(20, null, 24).ok, true);
  });

  test('product terms that used to be constants default to the old values', () => {
    const r = L.validateProductConfig(L.TEMPLATE_BY_CODE.OVERDRAFT.defaultConfig);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.config.facility?.minimumPaymentDueDays, 21);
      assert.equal(r.config.restructuring.balloonReminderDays, 30);
    }
  });
});
