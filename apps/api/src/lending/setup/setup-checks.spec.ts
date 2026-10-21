import { lending } from '@microloan/shared';
import {
  SETUP_ITEMS,
  SetupSnapshot,
  SnapshotProductVersion,
  checkAdminMfa,
  checkAlertEmails,
  checkAmlSettings,
  checkAmlWatchList,
  checkApprovalAuthorities,
  checkBranches,
  checkBusinessDate,
  checkChartOfAccounts,
  checkConsumerProtection,
  checkFeatureFlags,
  checkFxRates,
  checkImpairmentPolicy,
  checkLearning,
  checkOpeningBalances,
  checkPaymentKhqr,
  checkProducts,
  checkScorecards,
  checkStaffRoles,
  currenciesInUse,
  evaluateSetup,
  progressOf,
} from './setup-checks';

/** The go-live setup checklist's decisions (D-171…D-175), as pure functions. */

const codes = (c: { reasons: { code: string }[] }) =>
  c.reasons.map((x) => x.code);

/** A brand-new organisation: nothing configured. */
function fresh(): SetupSnapshot {
  return {
    calendarToday: '2026-10-21',
    eod: { timeZone: 'Asia/Phnom_Penh', schedule: '15 0 * * *', maxLagDays: 1 },
    tenant: { name: 'New Lender', baseCurrency: 'USD' },
    settings: {
      approved: false,
      invalid: false,
      effective: lending.defaultTenantLendingSettings(),
      pending: null,
    },
    branches: { active: 0 },
    users: [
      {
        id: 'a1',
        email: 'admin@x.test',
        role: 'TENANT_ADMIN',
        twoFactorEnabled: false,
      },
    ],
    assignments: [],
    authorities: [],
    businessDate: null,
    fxPairs: [],
    ledgerCodes: [],
    defaultChartCodes: lending.settingsAccountCodes(
      lending.defaultTenantLendingSettings(),
    ),
    migrationStatuses: [],
    versions: [],
    impairmentStatuses: [],
    activeScorecards: [],
    watchListStatuses: [],
    khqr: null,
    learning: { members: 0, required: 0, completed: 0 },
    waivers: {},
  };
}

const product = (
  over: Partial<SnapshotProductVersion> = {},
): SnapshotProductVersion => ({
  productCode: 'PL-1',
  familyCode: 'PERSONAL',
  status: 'ACTIVE',
  currency: 'USD',
  championScorecard: 'STANDARD_RETAIL',
  accountCodes: ['1000', '1200'],
  rateCapFindings: [],
  flags: [
    { key: 'lending.origination', enabled: true },
    { key: 'lending.family.personal.enabled', enabled: true },
  ],
  ...over,
});

function configuredSettings(): lending.TenantLendingSettings {
  const s = lending.defaultTenantLendingSettings();
  s.consumerProtection.lenderLegalName = 'New Lender Plc';
  s.consumerProtection.licenceNumber = 'MFI-0042';
  s.consumerProtection.complaints = {
    phone: '+855 23 000 000',
    email: 'complaints@lender.test',
    address: 'Street 1, Phnom Penh',
  };
  s.operations.alertEmails = ['ops@lender.test'];
  return s;
}

/** Everything in place. */
function ready(): SetupSnapshot {
  const s = fresh();
  const people = [
    ['a1', 'TENANT_ADMIN'],
    ['a2', 'TENANT_ADMIN'],
    ['u3', 'CREDIT_ANALYST'],
    ['u4', 'CREDIT_APPROVER'],
    ['u5', 'LOAN_OPS_MAKER'],
    ['u6', 'LOAN_OPS_CHECKER'],
    ['u7', 'FINANCE_OFFICER'],
    ['u8', 'RISK_COMPLIANCE'],
  ];
  return {
    ...s,
    settings: {
      ...s.settings,
      approved: true,
      effective: configuredSettings(),
    },
    branches: { active: 2 },
    users: people.map(([id]) => ({
      id,
      email: `${id}@lender.test`,
      role: 'LOAN_OFFICER',
      twoFactorEnabled: true,
    })),
    assignments: people.map(([userId, roleCode]) => ({
      userId,
      roleCode,
      status: 'ACTIVE',
    })),
    authorities: [
      {
        permission: 'credit_decision.approve',
        currency: 'USD',
        status: 'ACTIVE',
      },
    ],
    businessDate: '2026-10-21',
    ledgerCodes: ['1000', '1200', '3100'],
    migrationStatuses: ['POSTED'],
    versions: [product()],
    impairmentStatuses: ['ACTIVE'],
    activeScorecards: ['STANDARD_RETAIL'],
    watchListStatuses: ['ACTIVE'],
    khqr: { active: true },
    learning: { members: 8, required: 40, completed: 10 },
  };
}

describe('go-live setup checks', () => {
  it('a fresh organisation has every counted item to do or blocked, 0%', () => {
    const r = evaluateSetup(fresh());
    expect(r.items.map((i) => i.key)).toEqual(SETUP_ITEMS.map((i) => i.key));
    const counted = r.items.filter(
      (i) => i.status !== 'INFO' && i.status !== 'NOT_CHECKED',
    );
    // FX: a single-currency lender needs no rate, so it starts done.
    expect(
      counted.filter((i) => i.status === 'DONE').map((i) => i.key),
    ).toEqual(['fx_rates']);
    expect(r.progress.complete).toBe(false);
    expect(r.progress.percent).toBeLessThan(10);
    expect(r.items.find((i) => i.key === 'payment_khqr')!.status).toBe(
      'NOT_CHECKED',
    );
    expect(r.items.find((i) => i.key === 'learning')!.status).toBe('INFO');
  });

  it('a configured organisation is complete, 100%', () => {
    const r = evaluateSetup(ready());
    const notDone = r.items.filter((i) => !['DONE', 'INFO'].includes(i.status));
    expect(notDone).toEqual([]);
    expect(r.progress).toMatchObject({ percent: 100, complete: true, todo: 0 });
  });

  describe('consumer protection (key facts statement)', () => {
    it('lists the disclosure fields still missing', () => {
      const c = checkConsumerProtection(fresh());
      expect(c.status).toBe('TODO');
      expect(c.facts!.missing).toEqual([
        'lenderLegalName',
        'licenceNumber',
        'complaintsPhone',
        'complaintsEmail',
        'complaintsAddress',
      ]);
    });
    it('is blocked while a complete proposal waits for its checker', () => {
      const s = fresh();
      s.settings.pending = configuredSettings();
      const c = checkConsumerProtection(s);
      expect(c.status).toBe('BLOCKED');
      expect(codes(c)).toEqual(['settingsAwaitingApproval']);
    });
    it('is blocked when the settings in force no longer validate', () => {
      const s = ready();
      s.settings.invalid = true;
      expect(checkConsumerProtection(s).status).toBe('BLOCKED');
      expect(checkAmlSettings(s).status).toBe('BLOCKED');
    });
    it('is done once every field is set', () => {
      expect(checkConsumerProtection(ready()).status).toBe('DONE');
    });
  });

  it('branches: at least one active branch', () => {
    expect(checkBranches(fresh()).status).toBe('TODO');
    expect(checkBranches(ready()).status).toBe('DONE');
  });

  describe('staff and roles', () => {
    it('names each role short of its count; the legacy admin counts as one administrator', () => {
      const c = checkStaffRoles(fresh());
      expect(c.status).toBe('TODO');
      expect(c.facts!.counts).toMatchObject({
        TENANT_ADMIN: 1,
        CREDIT_ANALYST: 0,
      });
      expect(
        c.reasons.find((x) => x.params?.role === 'TENANT_ADMIN'),
      ).toMatchObject({
        code: 'roleMissing',
        params: { have: 1, need: 2 },
      });
    });
    it('is blocked while the missing assignments wait for approval', () => {
      const s = ready();
      s.assignments = s.assignments.map((a) =>
        a.roleCode === 'RISK_COMPLIANCE' ? { ...a, status: 'PENDING' } : a,
      );
      const c = checkStaffRoles(s);
      expect(c.status).toBe('BLOCKED');
      expect(c.reasons).toEqual([
        expect.objectContaining({
          code: 'roleAwaitingApproval',
          params: { role: 'RISK_COMPLIANCE' },
        }),
      ]);
    });
    it('needs two people for each maker-checker pair', () => {
      const s = ready();
      s.assignments = s.assignments.map((a) =>
        a.roleCode === 'LOAN_OPS_CHECKER' ? { ...a, userId: 'u5' } : a,
      );
      const c = checkStaffRoles(s);
      expect(c.status).toBe('TODO');
      expect(codes(c)).toEqual(['samePerson']);
    });
    it('ignores suspended staff', () => {
      const s = ready();
      s.users = s.users.filter((u) => u.id !== 'u8');
      expect(codes(checkStaffRoles(s))).toEqual(['roleMissing']);
    });
  });

  it('admin 2FA: every tenant administrator has an authenticator', () => {
    const c = checkAdminMfa(fresh());
    expect(c.status).toBe('TODO');
    expect(c.reasons[0].params).toMatchObject({
      count: 1,
      emails: 'admin@x.test',
    });
    expect(checkAdminMfa(ready()).status).toBe('DONE');
    const none = fresh();
    none.users = [];
    expect(codes(checkAdminMfa(none))).toEqual(['noAdmins']);
  });

  describe('approval authorities', () => {
    it('needs a credit approval limit in every currency in use', () => {
      const s = ready();
      s.versions = [
        product(),
        product({ productCode: 'PL-KHR', currency: 'KHR' }),
      ];
      const c = checkApprovalAuthorities(s);
      expect(c.status).toBe('TODO');
      expect(c.reasons[0].params).toEqual({ currencies: 'KHR' });
      s.authorities.push({
        permission: 'credit_decision.approve',
        currency: 'KHR',
        status: 'PENDING',
      });
      expect(checkApprovalAuthorities(s).status).toBe('BLOCKED');
      s.authorities[1].status = 'ACTIVE';
      expect(checkApprovalAuthorities(s).status).toBe('DONE');
    });
    it('other permissions do not count', () => {
      const s = ready();
      s.authorities = [
        {
          permission: 'loan.disbursement.approve',
          currency: 'USD',
          status: 'ACTIVE',
        },
      ];
      expect(checkApprovalAuthorities(s).status).toBe('TODO');
    });
  });

  it('business date: set, and not behind the calendar by more than the allowed lag', () => {
    expect(codes(checkBusinessDate(fresh()))).toEqual(['businessDateNotSet']);
    const s = ready();
    expect(checkBusinessDate(s).status).toBe('DONE');
    expect(checkBusinessDate({ ...s, businessDate: '2026-10-20' }).status).toBe(
      'DONE',
    );
    const behind = checkBusinessDate({ ...s, businessDate: '2026-10-18' });
    expect(behind.status).toBe('TODO');
    expect(behind.reasons[0].params).toMatchObject({
      days: 3,
      timeZone: 'Asia/Phnom_Penh',
    });
    expect(behind.facts).toMatchObject({ schedule: '15 0 * * *' });
  });

  it('FX: needed only when more than one currency is in use, in either direction', () => {
    const s = ready();
    expect(codes(checkFxRates(s))).toEqual(['singleCurrency']);
    s.versions.push(product({ productCode: 'PL-KHR', currency: 'KHR' }));
    expect(currenciesInUse(s)).toEqual(['KHR', 'USD']);
    expect(checkFxRates(s).status).toBe('TODO');
    expect(checkFxRates({ ...s, fxPairs: ['USD->KHR'] }).status).toBe('DONE');
    expect(checkFxRates({ ...s, fxPairs: ['KHR->USD'] }).status).toBe('DONE');
    // A product only approved, not active, does not count.
    const t = ready();
    t.versions.push(product({ status: 'APPROVED', currency: 'KHR' }));
    expect(codes(checkFxRates(t))).toEqual(['singleCurrency']);
  });

  it('chart of accounts: opened, and every mapped account in it', () => {
    expect(codes(checkChartOfAccounts(fresh()))).toEqual([
      'chartNotProvisioned',
    ]);
    const s = ready();
    expect(checkChartOfAccounts(s).status).toBe('DONE');
    s.versions = [product({ accountCodes: ['1000', '9999'] })];
    const c = checkChartOfAccounts(s);
    expect(c.status).toBe('BLOCKED');
    expect(c.reasons[0].params).toEqual({ codes: '9999' });
  });

  it('opening balances: a posted migration, or waiting for approval', () => {
    expect(checkOpeningBalances(fresh()).status).toBe('TODO');
    expect(
      checkOpeningBalances({ ...fresh(), migrationStatuses: ['VALIDATED'] })
        .status,
    ).toBe('BLOCKED');
    expect(
      checkOpeningBalances({ ...fresh(), migrationStatuses: ['REJECTED'] })
        .status,
    ).toBe('TODO');
    expect(
      checkOpeningBalances({
        ...fresh(),
        migrationStatuses: ['PARTIALLY_POSTED'],
      }).status,
    ).toBe('DONE');
  });

  describe('products', () => {
    it('needs an active version; approved or submitted ones block', () => {
      expect(codes(checkProducts(fresh()))).toEqual(['noActiveProduct']);
      expect(
        codes(
          checkProducts({
            ...fresh(),
            versions: [product({ status: 'SUBMITTED' })],
          }),
        ),
      ).toEqual(['productAwaitingApproval']);
      expect(
        codes(
          checkProducts({
            ...fresh(),
            versions: [product({ status: 'APPROVED' })],
          }),
        ),
      ).toEqual(['productAwaitingActivation']);
      expect(checkProducts(ready()).status).toBe('DONE');
    });
    it('blocks an active product priced above the interest-rate cap', () => {
      const c = checkProducts({
        ...ready(),
        versions: [
          product({
            rateCapFindings: [
              'The maximum annual rate 24.00% is above the cap 18.00%.',
            ],
          }),
        ],
      });
      expect(c.status).toBe('BLOCKED');
      expect(codes(c)).toEqual(['rateCapExceeded']);
      expect(c.reasons[0].message).toContain('24.00%');
    });
  });

  it('impairment policy: approved, or waiting for its checker', () => {
    expect(checkImpairmentPolicy(fresh()).status).toBe('TODO');
    expect(
      checkImpairmentPolicy({ ...fresh(), impairmentStatuses: ['PENDING'] })
        .status,
    ).toBe('BLOCKED');
    expect(checkImpairmentPolicy(ready()).status).toBe('DONE');
  });

  it('scorecards: each active family scored by an approved scorecard of the lender', () => {
    expect(codes(checkScorecards(fresh()))).toEqual(['needsActiveProduct']);
    const s = ready();
    expect(checkScorecards(s).status).toBe('DONE');
    s.versions.push(
      product({
        productCode: 'MF-1',
        familyCode: 'MICROFINANCE',
        championScorecard: 'MICRO',
      }),
    );
    const c = checkScorecards(s);
    expect(c.status).toBe('TODO');
    expect(c.reasons[0].params).toEqual({ scorecards: 'MICROFINANCE: MICRO' });
  });

  it('AML watch list: active, or waiting for activation', () => {
    expect(checkAmlWatchList(fresh()).status).toBe('TODO');
    expect(
      checkAmlWatchList({ ...fresh(), watchListStatuses: ['PENDING'] }).status,
    ).toBe('BLOCKED');
    expect(checkAmlWatchList(ready()).status).toBe('DONE');
  });

  it('AML settings: an approved settings version, with a CTR threshold for every currency', () => {
    expect(codes(checkAmlSettings(fresh()))).toEqual([
      'amlDefaultsNotConfirmed',
    ]);
    expect(
      checkAmlSettings({
        ...fresh(),
        settings: { ...fresh().settings, pending: configuredSettings() },
      }).status,
    ).toBe('BLOCKED');
    const s = ready();
    expect(checkAmlSettings(s).status).toBe('DONE');
    s.settings.effective.aml.ctr.thresholds = { USD: '10000' };
    s.versions.push(product({ currency: 'KHR' }));
    const c = checkAmlSettings(s);
    expect(c.status).toBe('TODO');
    expect(c.reasons[0].params).toEqual({ currencies: 'KHR' });
  });

  it('payment KHQR: not checked until the KHQR configuration can be read', () => {
    expect(checkPaymentKhqr(fresh()).status).toBe('NOT_CHECKED');
    expect(
      checkPaymentKhqr({ ...fresh(), khqr: { active: false } }).status,
    ).toBe('TODO');
    expect(checkPaymentKhqr(ready()).status).toBe('DONE');
  });

  it('alert e-mails: set in the settings in force', () => {
    expect(checkAlertEmails(fresh()).status).toBe('TODO');
    expect(
      checkAlertEmails({
        ...fresh(),
        settings: { ...fresh().settings, pending: configuredSettings() },
      }).status,
    ).toBe('BLOCKED');
    expect(checkAlertEmails(ready()).status).toBe('DONE');
  });

  it('feature flags: every flag new business on an active product needs is on', () => {
    expect(codes(checkFeatureFlags(fresh()))).toEqual(['needsActiveProduct']);
    const s = ready();
    expect(checkFeatureFlags(s).status).toBe('DONE');
    s.versions = [
      product({
        flags: [{ key: 'lending.family.personal.enabled', enabled: false }],
      }),
    ];
    const c = checkFeatureFlags(s);
    expect(c.status).toBe('TODO');
    expect(c.reasons[0].params).toEqual({
      flags: 'PL-1: lending.family.personal.enabled',
    });
  });

  it('learning: information only, with the team completion', () => {
    const c = checkLearning(ready());
    expect(c.status).toBe('INFO');
    expect(c.facts).toMatchObject({ percent: 25, members: 8 });
    expect(checkLearning(fresh()).facts).toMatchObject({ percent: 0 });
  });

  describe('not applicable', () => {
    const waiver = {
      reason: 'New lender, no existing book',
      markedBy: 'a1',
      markedAt: '2026-10-21T00:00:00.000Z',
    };
    it('counts a waived waivable item as done', () => {
      const s = fresh();
      s.waivers = { opening_balances: waiver, payment_khqr: waiver };
      const r = evaluateSetup(s);
      const ob = r.items.find((i) => i.key === 'opening_balances')!;
      expect(ob.status).toBe('NOT_APPLICABLE');
      expect(ob.waiver).toEqual(waiver);
      // The reasons stay, so the page can still say what was not done.
      expect(codes(ob)).toEqual(['noMigration']);
      expect(r.items.find((i) => i.key === 'payment_khqr')!.status).toBe(
        'NOT_APPLICABLE',
      );
      const before = evaluateSetup(fresh()).progress;
      expect(r.progress.done).toBe(before.done + 2);
      expect(r.progress.total).toBe(before.total + 1);
    });
    it('never waives an item every lender needs', () => {
      const s = fresh();
      s.waivers = { impairment_policy: waiver, consumer_protection: waiver };
      const r = evaluateSetup(s);
      expect(r.items.find((i) => i.key === 'impairment_policy')!).toMatchObject(
        { status: 'TODO', waiver: null },
      );
      expect(r.items.find((i) => i.key === 'consumer_protection')!.status).toBe(
        'TODO',
      );
    });
    it('a done item stays done', () => {
      const s = ready();
      s.waivers = { opening_balances: waiver };
      expect(
        evaluateSetup(s).items.find((i) => i.key === 'opening_balances')!
          .status,
      ).toBe('DONE');
    });
  });

  it('progress leaves information-only and not-checked items out', () => {
    expect(
      progressOf([
        { status: 'DONE' },
        { status: 'TODO' },
        { status: 'INFO' },
        { status: 'NOT_CHECKED' },
        { status: 'BLOCKED' },
      ]),
    ).toEqual({
      total: 3,
      done: 1,
      todo: 1,
      blocked: 1,
      percent: 33,
      complete: false,
    });
    expect(
      progressOf([{ status: 'NOT_APPLICABLE' }, { status: 'INFO' }]),
    ).toMatchObject({ percent: 100, complete: true });
  });

  it('only optional items are waivable', () => {
    expect(SETUP_ITEMS.filter((i) => i.waivable).map((i) => i.key)).toEqual([
      'fx_rates',
      'opening_balances',
      'scorecards',
      'payment_khqr',
      'alert_emails',
    ]);
  });
});
