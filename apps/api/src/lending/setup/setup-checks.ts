import { lending } from '@microloan/shared';

/**
 * The go-live setup checklist (DECISIONS D-171…D-175): every item is
 * computed from what is really configured — never from a stored tick — by
 * the pure functions below, from one snapshot the setup service reads in a
 * single round of queries. Each item says whether it is done, still to do,
 * or blocked (waiting for someone else's approval or for an earlier item),
 * and why, as reason codes the portal translates.
 *
 * A tenant administrator may mark a `waivable` item "not applicable" with a
 * reason (D-172). Items that a regulator, the key facts statement, maker-
 * checker or month-end close depend on are never waivable.
 */

export type SetupItemStatus =
  | 'DONE'
  | 'TODO'
  | 'BLOCKED'
  | 'NOT_APPLICABLE'
  /** The check cannot be made yet (no source of truth for it in this build). */
  | 'NOT_CHECKED'
  /** Shown for information; not counted in progress. */
  | 'INFO';

export const SETUP_SECTIONS = [
  'organisation',
  'people',
  'operations',
  'accounting',
  'products',
  'compliance',
  'channels',
  'training',
] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

export interface SetupReason {
  /** Stable code; the portal translates GoLiveSetup.reasons.<code>. */
  code: string;
  params?: Record<string, string | number>;
  /** English text, for the API and the audit trail. */
  message: string;
}

export interface SetupItemDefinition {
  key: string;
  section: SetupSection;
  /** The screen where the item is completed (without the locale). */
  href: string;
  /** May be marked not applicable by a tenant administrator. */
  waivable: boolean;
  /** Not counted in progress (information only). */
  informational?: boolean;
}

/** The checklist, in the order a new lender works through it. */
export const SETUP_ITEMS: readonly SetupItemDefinition[] = [
  {
    key: 'consumer_protection',
    section: 'organisation',
    href: '/lending/operations?tab=settings',
    waivable: false,
  },
  {
    key: 'branches',
    section: 'people',
    href: '/lending/access?tab=branches',
    waivable: false,
  },
  { key: 'staff_roles', section: 'people', href: '/users', waivable: false },
  { key: 'admin_mfa', section: 'people', href: '/users', waivable: false },
  {
    key: 'approval_authorities',
    section: 'people',
    href: '/lending/access?tab=authorities',
    waivable: false,
  },
  {
    key: 'business_date',
    section: 'operations',
    href: '/lending/operations?tab=date',
    waivable: false,
  },
  { key: 'fx_rates', section: 'operations', href: '/fx', waivable: true },
  {
    key: 'chart_of_accounts',
    section: 'accounting',
    href: '/lending/accounting',
    waivable: false,
  },
  {
    key: 'opening_balances',
    section: 'accounting',
    href: '/lending/migration',
    waivable: true,
  },
  {
    key: 'products',
    section: 'products',
    href: '/lending/catalogue',
    waivable: false,
  },
  {
    key: 'impairment_policy',
    section: 'products',
    href: '/lending/operations?tab=impairment',
    waivable: false,
  },
  {
    key: 'scorecards',
    section: 'products',
    href: '/lending/scorecards',
    waivable: true,
  },
  {
    key: 'aml_watch_list',
    section: 'compliance',
    href: '/lending/aml',
    waivable: false,
  },
  {
    key: 'aml_settings',
    section: 'compliance',
    href: '/lending/operations?tab=settings',
    waivable: false,
  },
  {
    key: 'payment_khqr',
    section: 'channels',
    href: '/lending/qr-repayments?tab=codes',
    waivable: true,
  },
  {
    key: 'alert_emails',
    section: 'channels',
    href: '/lending/operations?tab=settings',
    waivable: true,
  },
  {
    key: 'feature_flags',
    section: 'channels',
    href: '/lending/access?tab=flags',
    waivable: false,
  },
  {
    key: 'learning',
    section: 'training',
    href: '/learn/team',
    waivable: false,
    informational: true,
  },
];

export const SETUP_ITEM_BY_KEY: Record<string, SetupItemDefinition> =
  Object.fromEntries(SETUP_ITEMS.map((i) => [i.key, i]));

/**
 * People the checklist expects, by lending role (D-173): two tenant
 * administrators so access changes have a checker, and a distinct person on
 * each side of the credit and loan-operations maker-checker pairs.
 */
export const REQUIRED_ROLES: readonly { role: string; count: number }[] = [
  { role: 'TENANT_ADMIN', count: 2 },
  { role: 'CREDIT_ANALYST', count: 1 },
  { role: 'CREDIT_APPROVER', count: 1 },
  { role: 'LOAN_OPS_MAKER', count: 1 },
  { role: 'LOAN_OPS_CHECKER', count: 1 },
  { role: 'FINANCE_OFFICER', count: 1 },
  { role: 'RISK_COMPLIANCE', count: 1 },
];

/** Maker-checker pairs that need two different people. */
export const MAKER_CHECKER_PAIRS: readonly [string, string][] = [
  ['CREDIT_ANALYST', 'CREDIT_APPROVER'],
  ['LOAN_OPS_MAKER', 'LOAN_OPS_CHECKER'],
];

/** Legacy staff roles that hold the tenant administrator role (PolicyService bootstrap). */
export const LEGACY_ADMIN_ROLES: readonly string[] = ['TENANT_ADMIN', 'ADMIN'];

/** The permission whose approval limits the checklist expects per currency. */
export const CREDIT_APPROVAL_PERMISSION = 'credit_decision.approve';

// ── Snapshot ────────────────────────────────────────────────────────────────

export interface SnapshotUser {
  id: string;
  email: string;
  /** Legacy staff role. */
  role: string;
  twoFactorEnabled: boolean;
}

export interface SnapshotProductVersion {
  productCode: string;
  familyCode: string;
  status: string;
  /** Null when the stored configuration no longer validates. */
  currency: string | null;
  championScorecard: string | null;
  accountCodes: string[];
  /** Rate-cap findings of an ACTIVE version (D-110): configured rates above the cap. */
  rateCapFindings: string[];
  /** The flags new business on an ACTIVE version needs, evaluated for the tenant. */
  flags: { key: string; enabled: boolean }[];
}

export interface SetupSnapshot {
  /** The tenant's local calendar date (end-of-day time zone). */
  calendarToday: string;
  eod: { timeZone: string; schedule: string; maxLagDays: number };
  tenant: { name: string; baseCurrency: string };
  settings: {
    /** An approved version is in force. */
    approved: boolean;
    /** The version in force does not validate any more (the defaults are shown). */
    invalid: boolean;
    effective: lending.TenantLendingSettings;
    /** The latest version waiting for its checker, if any. */
    pending: lending.TenantLendingSettings | null;
  };
  branches: { active: number };
  /** Active staff of the tenant. */
  users: SnapshotUser[];
  /** Role assignments of active staff that are in force (ACTIVE) or waiting (PENDING). */
  assignments: { userId: string; roleCode: string; status: string }[];
  authorities: { permission: string; currency: string; status: string }[];
  businessDate: string | null;
  /** Exchange-rate pairs in force, "USD->KHR". */
  fxPairs: string[];
  ledgerCodes: string[];
  defaultChartCodes: string[];
  migrationStatuses: string[];
  versions: SnapshotProductVersion[];
  impairmentStatuses: string[];
  /** Tenant scorecard codes with an ACTIVE version. */
  activeScorecards: string[];
  watchListStatuses: string[];
  /** Static KHQR for collections: null when this build cannot tell (D-174). */
  khqr: { active: boolean } | null;
  learning: { members: number; required: number; completed: number };
  waivers: Record<
    string,
    { reason: string; markedBy: string; markedAt: string }
  >;
}

export interface SetupItemResult {
  key: string;
  section: SetupSection;
  href: string;
  waivable: boolean;
  status: SetupItemStatus;
  reasons: SetupReason[];
  facts: Record<string, unknown>;
  waiver: { reason: string; markedBy: string; markedAt: string } | null;
}

type Check = Pick<SetupItemResult, 'status' | 'reasons'> & {
  facts?: Record<string, unknown>;
};

const r = (
  code: string,
  message: string,
  params?: Record<string, string | number>,
): SetupReason => (params ? { code, message, params } : { code, message });

const done = (facts?: Record<string, unknown>, reasons: SetupReason[] = []) =>
  ({ status: 'DONE', reasons, facts }) satisfies Check;
const todo = (reasons: SetupReason[], facts?: Record<string, unknown>) =>
  ({ status: 'TODO', reasons, facts }) satisfies Check;
const blocked = (reasons: SetupReason[], facts?: Record<string, unknown>) =>
  ({ status: 'BLOCKED', reasons, facts }) satisfies Check;

const list = (xs: readonly string[]) => [...xs].sort().join(', ');

// ── Helpers on the snapshot ─────────────────────────────────────────────────

/** ACTIVE product versions (new business is open on them). */
export function activeVersions(s: SetupSnapshot): SnapshotProductVersion[] {
  return s.versions.filter((v) => v.status === 'ACTIVE');
}

/** Currencies the lender works in: its base currency and its active products'. */
export function currenciesInUse(s: SetupSnapshot): string[] {
  const set = new Set<string>([s.tenant.baseCurrency]);
  for (const v of activeVersions(s)) if (v.currency) set.add(v.currency);
  return [...set].sort();
}

/** Active staff holding each lending role (in force), tenant administrators including the legacy admin roles. */
export function roleHolders(
  s: SetupSnapshot,
  status: 'ACTIVE' | 'PENDING' = 'ACTIVE',
): Map<string, Set<string>> {
  const active = new Set(s.users.map((u) => u.id));
  const holders = new Map<string, Set<string>>();
  const add = (role: string, userId: string) => {
    if (!holders.has(role)) holders.set(role, new Set());
    holders.get(role)!.add(userId);
  };
  for (const a of s.assignments)
    if (a.status === status && active.has(a.userId)) add(a.roleCode, a.userId);
  if (status === 'ACTIVE')
    for (const u of s.users)
      if (LEGACY_ADMIN_ROLES.includes(u.role)) add('TENANT_ADMIN', u.id);
  return holders;
}

// ── The checks ──────────────────────────────────────────────────────────────

export function checkConsumerProtection(s: SetupSnapshot): Check {
  const missingIn = (cp: lending.TenantLendingSettings['consumerProtection']) =>
    [
      ['lenderLegalName', cp.lenderLegalName],
      ['licenceNumber', cp.licenceNumber],
      ['complaintsPhone', cp.complaints.phone],
      ['complaintsEmail', cp.complaints.email],
      ['complaintsAddress', cp.complaints.address],
      ['regulatorContact', cp.regulatorContact],
    ]
      .filter(([, v]) => !v || !String(v).trim())
      .map(([k]) => k as string);
  const cp = s.settings.effective.consumerProtection;
  const facts = {
    lenderLegalName: cp.lenderLegalName ?? s.tenant.name,
    licenceNumber: cp.licenceNumber,
    regulatorContact: cp.regulatorContact,
  };
  if (s.settings.invalid)
    return blocked(
      [
        r(
          'settingsInvalid',
          'The lending settings in force no longer validate; propose a corrected version.',
        ),
      ],
      facts,
    );
  const missing = missingIn(cp);
  if (!missing.length) return done(facts);
  const fields = missing.join(', ');
  if (
    s.settings.pending &&
    missingIn(s.settings.pending.consumerProtection).length === 0
  )
    return blocked(
      [
        r(
          'settingsAwaitingApproval',
          'The details are in a lending settings proposal waiting for a second person to approve it.',
        ),
      ],
      { ...facts, missing },
    );
  return todo(
    [
      r(
        'disclosureMissing',
        `The key facts statement prints "not configured" for: ${fields}. Set them in the lending settings (consumer protection).`,
        { fields },
      ),
    ],
    { ...facts, missing },
  );
}

export function checkBranches(s: SetupSnapshot): Check {
  if (s.branches.active > 0) return done({ active: s.branches.active });
  return todo([r('noBranches', 'Create at least one branch.')]);
}

export function checkStaffRoles(s: SetupSnapshot): Check {
  const active = roleHolders(s, 'ACTIVE');
  const pending = roleHolders(s, 'PENDING');
  const counts: Record<string, number> = {};
  const short: string[] = [];
  const waiting: string[] = [];
  for (const { role, count } of REQUIRED_ROLES) {
    const have = active.get(role)?.size ?? 0;
    counts[role] = have;
    if (have >= count) continue;
    const coming = [...(pending.get(role) ?? [])].filter(
      (u) => !active.get(role)?.has(u),
    ).length;
    if (have + coming >= count) waiting.push(role);
    else short.push(role);
  }
  const reasons: SetupReason[] = [];
  for (const role of short) {
    const need = REQUIRED_ROLES.find((x) => x.role === role)!.count;
    reasons.push(
      r('roleMissing', `${role}: ${counts[role]} of ${need} needed.`, {
        role,
        have: counts[role],
        need,
      }),
    );
  }
  // Maker-checker needs two people: one person holding both roles of a pair
  // (and nobody else holding either) cannot complete the work alone.
  for (const [maker, checker] of MAKER_CHECKER_PAIRS) {
    const m = active.get(maker) ?? new Set<string>();
    const c = active.get(checker) ?? new Set<string>();
    if (!m.size || !c.size) continue;
    const distinct = [...m].some((a) => [...c].some((b) => a !== b));
    if (!distinct)
      reasons.push(
        r(
          'samePerson',
          `${maker} and ${checker} are held by the same one person; maker-checker needs two.`,
          { maker, checker },
        ),
      );
  }
  if (reasons.length) return todo(reasons, { counts });
  if (waiting.length)
    return blocked(
      waiting.map((role) =>
        r(
          'roleAwaitingApproval',
          `${role}: an assignment is waiting for a second administrator to approve it.`,
          { role },
        ),
      ),
      { counts },
    );
  return done({ counts });
}

export function checkAdminMfa(s: SetupSnapshot): Check {
  const admins = adminsOf(s);
  if (!admins.all.length)
    return todo([r('noAdmins', 'There is no active tenant administrator.')]);
  if (admins.without.length)
    return todo(
      [
        r(
          'adminsWithoutMfa',
          `Administrators without an authenticator: ${list(admins.without)}. Each sets it up under My account.`,
          { count: admins.without.length, emails: list(admins.without) },
        ),
      ],
      { admins: admins.all.length },
    );
  return done({ admins: admins.all.length });
}

function adminsOf(s: SetupSnapshot) {
  const ids = roleHolders(s).get('TENANT_ADMIN') ?? new Set<string>();
  const all = s.users.filter((u) => ids.has(u.id));
  return {
    all,
    without: all.filter((u) => !u.twoFactorEnabled).map((u) => u.email),
  };
}

export function checkApprovalAuthorities(s: SetupSnapshot): Check {
  const currencies = currenciesInUse(s);
  const of = (status: string) =>
    new Set(
      s.authorities
        .filter(
          (a) =>
            a.permission === CREDIT_APPROVAL_PERMISSION && a.status === status,
        )
        .map((a) => a.currency),
    );
  const active = of('ACTIVE');
  const pending = of('PENDING');
  const missing = currencies.filter((c) => !active.has(c));
  const facts = { currencies, withLimits: [...active].sort() };
  if (!missing.length) return done(facts);
  const waiting = missing.filter((c) => pending.has(c));
  const none = missing.filter((c) => !pending.has(c));
  if (none.length)
    return todo(
      [
        r(
          'noApprovalLimit',
          `No approval limit for credit decisions in ${list(none)}: approvers cannot approve a loan in that currency.`,
          { currencies: list(none) },
        ),
      ],
      facts,
    );
  return blocked(
    [
      r(
        'limitAwaitingApproval',
        `Approval limits in ${list(waiting)} are waiting for a second administrator.`,
        { currencies: list(waiting) },
      ),
    ],
    facts,
  );
}

export function checkBusinessDate(s: SetupSnapshot): Check {
  const facts = {
    businessDate: s.businessDate,
    calendarDate: s.calendarToday,
    timeZone: s.eod.timeZone,
    schedule: s.eod.schedule,
  };
  if (!s.businessDate)
    return todo(
      [
        r(
          'businessDateNotSet',
          'The business date has not been set yet: open Operations › Business date to confirm it.',
        ),
      ],
      facts,
    );
  const lag = lending.daysBetween(s.businessDate, s.calendarToday);
  if (lag > s.eod.maxLagDays)
    return todo(
      [
        r(
          'businessDateBehind',
          `The business date ${s.businessDate} is ${lag} day(s) behind the calendar date ${s.calendarToday} (${s.eod.timeZone}); run end of day to catch up.`,
          { businessDate: s.businessDate, days: lag, timeZone: s.eod.timeZone },
        ),
      ],
      facts,
    );
  return done(facts);
}

export function checkFxRates(s: SetupSnapshot): Check {
  const base = s.tenant.baseCurrency;
  const others = currenciesInUse(s).filter((c) => c !== base);
  const facts = { baseCurrency: base, currencies: currenciesInUse(s) };
  if (!others.length)
    return done(facts, [
      r(
        'singleCurrency',
        `Only ${base} is in use: no exchange rate is needed.`,
        { currency: base },
      ),
    ]);
  const have = new Set(s.fxPairs);
  const missing = others.filter(
    (c) => !have.has(`${c}->${base}`) && !have.has(`${base}->${c}`),
  );
  if (!missing.length) return done(facts);
  return todo(
    [
      r(
        'fxMissing',
        `No ${base} exchange rate published for ${list(missing)}.`,
        { base, currencies: list(missing) },
      ),
    ],
    facts,
  );
}

export function checkChartOfAccounts(s: SetupSnapshot): Check {
  if (!s.ledgerCodes.length)
    return todo([
      r(
        'chartNotProvisioned',
        'The chart of accounts has not been opened yet: open Accounting to provision and review it.',
      ),
    ]);
  const chart = new Set([...s.ledgerCodes, ...s.defaultChartCodes]);
  const named = new Set<string>(
    lending.settingsAccountCodes(s.settings.effective),
  );
  for (const v of activeVersions(s))
    for (const c of v.accountCodes) named.add(c);
  const missing = [...named].filter((c) => !chart.has(c));
  const facts = { accounts: s.ledgerCodes.length, mapped: named.size };
  if (missing.length)
    return blocked(
      [
        r(
          'unknownAccounts',
          `The account mapping names accounts that are not in the chart: ${list(missing)}.`,
          { codes: list(missing) },
        ),
      ],
      facts,
    );
  return done(facts);
}

export function checkOpeningBalances(s: SetupSnapshot): Check {
  const st = s.migrationStatuses;
  const posted = st.filter(
    (x) => x === 'POSTED' || x === 'PARTIALLY_POSTED',
  ).length;
  if (posted) return done({ postedBatches: posted });
  if (st.includes('VALIDATED') || st.includes('POSTING'))
    return blocked([
      r(
        'migrationAwaitingApproval',
        'A loan-book migration file is loaded and waiting for a second person to approve posting it.',
      ),
    ]);
  return todo([
    r(
      'noMigration',
      'Bring the existing loan book over with the loan-book migration (opening balances), or mark this not applicable for a new lender with no existing loans.',
    ),
  ]);
}

export function checkProducts(s: SetupSnapshot): Check {
  const active = activeVersions(s);
  if (!active.length) {
    const approved = s.versions.filter((v) => v.status === 'APPROVED');
    const submitted = s.versions.filter((v) => v.status === 'SUBMITTED');
    if (approved.length)
      return blocked([
        r(
          'productAwaitingActivation',
          `Approved but not active yet: ${list(approved.map((v) => v.productCode))}.`,
          { products: list(approved.map((v) => v.productCode)) },
        ),
      ]);
    if (submitted.length)
      return blocked([
        r(
          'productAwaitingApproval',
          `Waiting for a product checker: ${list(submitted.map((v) => v.productCode))}.`,
          { products: list(submitted.map((v) => v.productCode)) },
        ),
      ]);
    return todo([
      r(
        'noActiveProduct',
        'No product is active: create one from a catalogue template, then have it approved and activated.',
      ),
    ]);
  }
  const facts = {
    active: active.length,
    products: active.map((v) => v.productCode).sort(),
  };
  const overCap = active.filter((v) => v.rateCapFindings.length);
  if (overCap.length)
    return blocked(
      [
        r(
          'rateCapExceeded',
          `Rates above the interest-rate cap in: ${list(overCap.map((v) => v.productCode))}. ${overCap.flatMap((v) => v.rateCapFindings).join(' ')}`,
          { products: list(overCap.map((v) => v.productCode)) },
        ),
      ],
      facts,
    );
  return done(facts);
}

export function checkImpairmentPolicy(s: SetupSnapshot): Check {
  if (s.impairmentStatuses.includes('ACTIVE')) return done();
  if (s.impairmentStatuses.includes('PENDING'))
    return blocked([
      r(
        'impairmentAwaitingApproval',
        'An impairment policy is waiting for a second person to approve it.',
      ),
    ]);
  return todo([
    r(
      'noImpairmentPolicy',
      'No impairment policy is approved: no loss allowance is posted and month-end close is blocked while loans are outstanding.',
    ),
  ]);
}

export function checkScorecards(s: SetupSnapshot): Check {
  const active = activeVersions(s);
  if (!active.length)
    return blocked([
      r('needsActiveProduct', 'Activate a product first (product step).'),
    ]);
  const live = new Set(s.activeScorecards);
  const families = new Map<string, Set<string>>();
  for (const v of active) {
    const code = v.championScorecard;
    if (!code) continue;
    if (!families.has(v.familyCode)) families.set(v.familyCode, new Set());
    families.get(v.familyCode)!.add(code);
  }
  const onTemplate: string[] = [];
  for (const [family, codes] of families)
    for (const code of codes)
      if (!live.has(code)) onTemplate.push(`${family}: ${code}`);
  const facts = { families: [...families.keys()].sort() };
  if (!onTemplate.length) return done(facts);
  return todo(
    [
      r(
        'scorecardOnTemplate',
        `Scored with the default template, not an approved scorecard of yours: ${list(onTemplate)}. Install and approve a scorecard, or mark this not applicable to accept the default template.`,
        { scorecards: list(onTemplate) },
      ),
    ],
    facts,
  );
}

export function checkAmlWatchList(s: SetupSnapshot): Check {
  const st = s.watchListStatuses;
  const lists = st.filter((x) => x === 'ACTIVE').length;
  if (lists) return done({ activeLists: lists });
  if (st.includes('PENDING'))
    return blocked([
      r(
        'watchListAwaitingApproval',
        'An uploaded watch list is waiting for a second compliance officer to activate it.',
      ),
    ]);
  return todo([
    r(
      'noWatchList',
      'No watch list is active: customers cannot be screened (sanctions, PEP).',
    ),
  ]);
}

export function checkAmlSettings(s: SetupSnapshot): Check {
  const aml = s.settings.effective.aml;
  const facts = {
    ctrThresholds: aml.ctr.thresholds,
    riskWeights: aml.risk.weights,
    mediumAt: aml.risk.mediumAt,
    highAt: aml.risk.highAt,
  };
  if (s.settings.invalid)
    return blocked(
      [
        r(
          'settingsInvalid',
          'The lending settings in force no longer validate; propose a corrected version.',
        ),
      ],
      facts,
    );
  const missing = currenciesInUse(s).filter((c) => !aml.ctr.thresholds[c]);
  if (missing.length)
    return todo(
      [
        r(
          'ctrCurrencyMissing',
          `No cash transaction reporting threshold for ${list(missing)}.`,
          { currencies: list(missing) },
        ),
      ],
      facts,
    );
  if (s.settings.approved) return done(facts);
  if (s.settings.pending)
    return blocked(
      [
        r(
          'settingsAwaitingApproval',
          'The details are in a lending settings proposal waiting for a second person to approve it.',
        ),
      ],
      facts,
    );
  return todo(
    [
      r(
        'amlDefaultsNotConfirmed',
        'The cash transaction threshold and customer risk weights are still the defaults: review them and approve a version of the lending settings.',
      ),
    ],
    facts,
  );
}

export function checkPaymentKhqr(s: SetupSnapshot): Check {
  if (!s.khqr)
    return {
      status: 'NOT_CHECKED',
      reasons: [
        r(
          'khqrNotChecked',
          'Static KHQR collection cannot be checked yet. Set it up under Payment channels, or mark this not applicable.',
        ),
      ],
    };
  if (s.khqr.active) return done();
  return todo([
    r(
      'noKhqr',
      'No active static KHQR: customers cannot pay by scanning the lender’s QR.',
    ),
  ]);
}

export function checkAlertEmails(s: SetupSnapshot): Check {
  const emails = s.settings.effective.operations.alertEmails;
  if (emails.length) return done({ recipients: emails.length });
  if (s.settings.pending?.operations.alertEmails.length)
    return blocked([
      r(
        'settingsAwaitingApproval',
        'The details are in a lending settings proposal waiting for a second person to approve it.',
      ),
    ]);
  return todo([
    r(
      'noAlertEmails',
      'Nobody at the lender is e-mailed when end of day, month end or a payment file needs attention: add operations alert e-mails in the lending settings.',
    ),
  ]);
}

export function checkFeatureFlags(s: SetupSnapshot): Check {
  const active = activeVersions(s);
  if (!active.length)
    return blocked([
      r('needsActiveProduct', 'Activate a product first (product step).'),
    ]);
  const off: string[] = [];
  for (const v of active)
    for (const f of v.flags)
      if (!f.enabled) off.push(`${v.productCode}: ${f.key}`);
  const facts = {
    checked: [
      ...new Set(active.flatMap((v) => v.flags.map((f) => f.key))),
    ].sort(),
  };
  if (!off.length) return done(facts);
  return todo(
    [
      r(
        'flagsOff',
        `New business is switched off by these feature flags: ${list([...new Set(off)])}.`,
        { flags: list([...new Set(off)]) },
      ),
    ],
    facts,
  );
}

export function checkLearning(s: SetupSnapshot): Check {
  const { members, required, completed } = s.learning;
  const percent = required ? Math.round((completed / required) * 100) : 0;
  return {
    status: 'INFO',
    reasons: [
      r(
        'learningProgress',
        `${completed} of ${required} lessons on staff role paths completed (${percent}%) by ${members} staff.`,
        { completed, required, percent, members },
      ),
    ],
    facts: { members, required, completed, percent },
  };
}

const CHECKS: Record<string, (s: SetupSnapshot) => Check> = {
  consumer_protection: checkConsumerProtection,
  branches: checkBranches,
  staff_roles: checkStaffRoles,
  admin_mfa: checkAdminMfa,
  approval_authorities: checkApprovalAuthorities,
  business_date: checkBusinessDate,
  fx_rates: checkFxRates,
  chart_of_accounts: checkChartOfAccounts,
  opening_balances: checkOpeningBalances,
  products: checkProducts,
  impairment_policy: checkImpairmentPolicy,
  scorecards: checkScorecards,
  aml_watch_list: checkAmlWatchList,
  aml_settings: checkAmlSettings,
  payment_khqr: checkPaymentKhqr,
  alert_emails: checkAlertEmails,
  feature_flags: checkFeatureFlags,
  learning: checkLearning,
};

export interface SetupStatus {
  items: SetupItemResult[];
  progress: {
    /** Items counted: everything but information-only and not-checked items. */
    total: number;
    /** Done or marked not applicable. */
    done: number;
    todo: number;
    blocked: number;
    percent: number;
    complete: boolean;
  };
}

/** Every item from the snapshot, with not-applicable marks applied, and the progress. */
export function evaluateSetup(s: SetupSnapshot): SetupStatus {
  const items = SETUP_ITEMS.map((def): SetupItemResult => {
    const c = CHECKS[def.key](s);
    const waiver = def.waivable ? (s.waivers[def.key] ?? null) : null;
    const status: SetupItemStatus =
      waiver && c.status !== 'DONE' ? 'NOT_APPLICABLE' : c.status;
    return {
      key: def.key,
      section: def.section,
      href: def.href,
      waivable: def.waivable,
      status,
      reasons: c.reasons,
      facts: c.facts ?? {},
      waiver,
    };
  });
  return { items, progress: progressOf(items) };
}

export function progressOf(
  items: Pick<SetupItemResult, 'status'>[],
): SetupStatus['progress'] {
  const counted = items.filter(
    (i) => i.status !== 'INFO' && i.status !== 'NOT_CHECKED',
  );
  const done = counted.filter(
    (i) => i.status === 'DONE' || i.status === 'NOT_APPLICABLE',
  ).length;
  const total = counted.length;
  return {
    total,
    done,
    todo: counted.filter((i) => i.status === 'TODO').length,
    blocked: counted.filter((i) => i.status === 'BLOCKED').length,
    percent: total ? Math.floor((done / total) * 100) : 100,
    complete: done === total,
  };
}
