import Decimal from 'decimal.js';
import { ActionDefinition } from './actions';
import { AttributeBag, CompiledPolicy, evaluatePolicies } from './abac';
import {
  FlagContext,
  FlagEvaluation,
  FlagSnapshot,
  evaluateFlag,
} from './flags';
import { familyFlagKey } from './catalogue';

/**
 * The single authorization decision for every protected lending action.
 *
 * Effective access requires, in order:
 *   1. an authenticated, active identity
 *   2. the correct tenant boundary
 *   3. the RBAC permission
 *   4. ABAC allow (scope, maker-checker, approval authority, assurance, tenant policies)
 *   5. the required feature flags
 *   6. a valid product configuration / state
 *   7. a valid workflow state
 *
 * Every check runs and is recorded, so the explanation lists everything that
 * blocked — but the outcome is deny-overrides with default deny. A flag never
 * grants access, and a missing attribute is a failed check, never a pass.
 */

export type Layer =
  | 'IDENTITY'
  | 'TENANT'
  | 'RBAC'
  | 'ABAC'
  | 'FLAG'
  | 'PRODUCT'
  | 'WORKFLOW';

export interface Grant {
  permission: string;
  source: 'ROLE' | 'DELEGATION' | 'BOOTSTRAP' | 'SERVICE_SCOPE' | 'PLATFORM';
  roleCode?: string;
  allBranches: boolean;
  branchIds: string[];
  portfolioIds: string[];
  legalEntityIds: string[];
}

export interface Authority {
  permission: string;
  currency: string;
  maxAmount: string;
  familyCode?: string | null;
  source: string;
}

export interface Subject {
  id: string;
  /** CUSTOMER is a borrower signed in to the portal; their id is the borrower id. */
  type: 'USER' | 'SERVICE' | 'PLATFORM' | 'CUSTOMER';
  tenantId: string | null;
  active: boolean;
  branchId?: string | null;
  roles: string[];
  grants: Grant[];
  authorities: Authority[];
  assurance: 'SINGLE_FACTOR' | 'MFA' | 'SERVICE_KEY' | 'OTP';
  cohorts: string[];
}

export interface Resource {
  type: string;
  id: string;
  tenantId: string | null;
  branchId?: string | null;
  portfolioId?: string | null;
  legalEntityId?: string | null;
  productCode?: string | null;
  familyCode?: string | null;
  /** Status of the product version the action relies on. */
  productStatus?: string | null;
  /** Whether the pinned product configuration still validates. */
  productConfigValid?: boolean | null;
  amount?: string | null;
  currency?: string | null;
  riskCategory?: string | null;
  dataClassification?: string | null;
  workflowState?: string | null;
  segment?: string | null;
  /** Users who created or proposed the resource / the pending step. */
  makerIds: string[];
  /** The borrower who owns the resource; customers may act only on their own. */
  ownerBorrowerId?: string | null;
  /** Additional flags the product's configuration depends on (balloon, floating …). */
  requiredFlags?: string[];
}

export interface Environment {
  now: Date;
  /** Server-derived; never taken from the client. */
  channel: 'STAFF_PORTAL' | 'BORROWER_PORTAL' | 'API' | 'SYSTEM';
  assurance: 'SINGLE_FACTOR' | 'MFA' | 'SERVICE_KEY' | 'OTP';
  emergencyAccess: false;
}

export interface FxQuote {
  rate: string;
  asOf: Date;
  source: string;
}

export interface DecisionInput {
  action: ActionDefinition;
  subject: Subject;
  resource: Resource;
  environment: Environment;
  flags: FlagSnapshot;
  policies: CompiledPolicy[];
  /** Recorded FX rate (tenant FX table): units of `to` per unit of `from`. Null when none is recorded. */
  fx: (from: string, to: string) => FxQuote | null;
  /** Maximum age of an FX rate usable for approval limits. */
  fxMaxAgeDays?: number;
  policyVersion?: number;
}

export interface Check {
  layer: Layer;
  code: string;
  passed: boolean;
  /** Safe to show to the user. */
  message: string;
  /** Internal detail for auditors and the policy simulator. */
  detail?: string;
}

export interface Decision {
  allowed: boolean;
  action: string;
  resource: { type: string; id: string };
  checks: Check[];
  /** The first failing check, in evaluation order. */
  denial: Check | null;
  flags: FlagEvaluation[];
  policyVersion: number | null;
  evaluatedAt: string;
}

function coversScope(grant: Grant, r: Resource): boolean {
  if (
    grant.legalEntityIds.length &&
    (!r.legalEntityId || !grant.legalEntityIds.includes(r.legalEntityId))
  )
    return false;
  if (grant.allBranches) return true;
  if (r.branchId && grant.branchIds.includes(r.branchId)) return true;
  if (r.portfolioId && grant.portfolioIds.includes(r.portfolioId)) return true;
  return false;
}

export function requiredFlagsFor(
  action: ActionDefinition,
  r: Resource,
): string[] {
  const flags: string[] = [];
  if (action.kind === 'ORIGINATION' || action.kind === 'DISBURSEMENT') {
    flags.push('lending.origination');
    if (r.familyCode) flags.push(familyFlagKey(r.familyCode));
    flags.push(...(r.requiredFlags ?? []));
  }
  if (action.kind === 'DISBURSEMENT' || action.kind === 'SERVICING_MONEY') {
    flags.push('lending.accounting.posting');
  }
  if (action.kind === 'SERVICING_MONEY') flags.push('lending.servicing');
  if (action.kind === 'RESTRUCTURE') {
    const c = action.code;
    if (c === 'restructure.request') flags.push('lending.restructure.request');
    else if (c === 'restructure.execute')
      flags.push(
        'lending.restructure.execution',
        'lending.accounting.posting',
        'lending.servicing',
        ...(r.requiredFlags ?? []),
      );
    else if (c === 'restructure.reverse')
      flags.push('lending.accounting.posting', 'lending.servicing');
    else if (
      [
        'restructure.simulate',
        'restructure.propose',
        'restructure.approve',
        'restructure.waive_charges',
        'restructure.forgive_principal',
        'restructure.record_acceptance',
        'restructure.accept_own',
      ].includes(c)
    ) {
      flags.push('lending.restructure.simulation', ...(r.requiredFlags ?? []));
    }
  }
  return [...new Set(flags)];
}

export function decide(input: DecisionInput): Decision {
  const { action, subject: s, resource: r, environment: env } = input;
  const checks: Check[] = [];
  const add = (
    layer: Layer,
    code: string,
    passed: boolean,
    message: string,
    detail?: string,
  ) => checks.push({ layer, code, passed, message, detail });

  // 1. Identity
  add(
    'IDENTITY',
    'AUTHENTICATED',
    !!s.id && s.active,
    s.active ? 'Signed in' : 'Your account is not active',
    `subject=${s.id} type=${s.type}`,
  );

  // 2. Tenant boundary
  if (s.type === 'PLATFORM') {
    const ok =
      action.kind === 'PLATFORM' ||
      (action.kind === 'ACCESS' && r.tenantId === null);
    add(
      'TENANT',
      'PLATFORM_SCOPE',
      ok,
      ok
        ? 'Platform action'
        : 'Platform administrators have no access to tenant lending data or transactions',
      `action kind ${action.kind}`,
    );
  } else {
    const ok =
      !!s.tenantId &&
      (action.kind === 'PLATFORM' ||
        (!!r.tenantId && r.tenantId === s.tenantId));
    add(
      'TENANT',
      'SAME_TENANT',
      ok,
      ok ? 'Same organisation' : 'This record belongs to another organisation',
      `subject tenant ${s.tenantId}, resource tenant ${r.tenantId}`,
    );
  }

  // 3. RBAC
  const grants = s.grants.filter((g) => g.permission === action.permission);
  add(
    'RBAC',
    'PERMISSION',
    grants.length > 0,
    grants.length
      ? `Permitted by ${grants.map((g) => g.roleCode ?? g.source).join(', ')}`
      : `Your roles do not include ${action.permission}`,
    `permission ${action.permission}`,
  );

  // 4. ABAC
  if (s.type === 'CUSTOMER') {
    // Customers act only on their own loans and cases; branch scope does not apply to them.
    const ok = !!r.ownerBorrowerId && r.ownerBorrowerId === s.id;
    add(
      'ABAC',
      'OWNER',
      ok,
      ok ? 'Your own loan' : 'This is not your loan',
      `owner=${r.ownerBorrowerId}`,
    );
  } else if (action.scoped) {
    const missing = !r.branchId && !r.portfolioId;
    const ok = !missing && grants.some((g) => coversScope(g, r));
    add(
      'ABAC',
      'SCOPE',
      ok,
      ok
        ? 'Within your branch / portfolio scope'
        : missing
          ? 'The record has no branch scope'
          : 'Outside your branch or portfolio scope',
      `branch=${r.branchId} portfolio=${r.portfolioId} legalEntity=${r.legalEntityId}`,
    );
  }
  if (action.makerChecker) {
    const ok = !r.makerIds.includes(s.id);
    add(
      'ABAC',
      'MAKER_CHECKER',
      ok,
      ok
        ? 'Independent of the maker'
        : 'You cannot approve or complete an action you created or proposed',
      `makers=${r.makerIds.join(',')}`,
    );
  }
  if (action.approvalAuthority) {
    const result = checkAuthority(input, grants);
    add('ABAC', 'APPROVAL_AUTHORITY', result.ok, result.message, result.detail);
  }
  if (action.minAssurance === 'MFA') {
    const ok = env.assurance === 'MFA';
    add(
      'ABAC',
      'ASSURANCE',
      ok,
      ok
        ? 'Multi-factor sign-in'
        : 'This action requires signing in with multi-factor authentication',
      `assurance=${env.assurance}`,
    );
  }
  const attrs: Partial<AttributeBag> = {
    'resource.amount': r.amount ?? undefined,
    'resource.currency': r.currency ?? undefined,
    'resource.familyCode': r.familyCode ?? undefined,
    'resource.productCode': r.productCode ?? undefined,
    'resource.branchId': r.branchId ?? undefined,
    'resource.legalEntityId': r.legalEntityId ?? undefined,
    'resource.portfolioId': r.portfolioId ?? undefined,
    'resource.riskCategory': r.riskCategory ?? undefined,
    'resource.dataClassification': r.dataClassification ?? undefined,
    'resource.workflowState': r.workflowState ?? undefined,
    'resource.segment': r.segment ?? undefined,
    'subject.branchId': s.branchId ?? undefined,
    'subject.roles': s.roles,
    'subject.assurance': s.assurance,
    'environment.channel': env.channel,
    'environment.assurance': env.assurance,
    'environment.hourUtc': env.now.getUTCHours(),
    'environment.dayOfWeek': ((env.now.getUTCDay() + 6) % 7) + 1,
  };
  for (const o of evaluatePolicies(input.policies, action.code, attrs)) {
    add(
      'ABAC',
      `POLICY:${o.policyCode}:${o.ruleId}`,
      !o.blocked,
      o.blocked ? o.message : 'Policy satisfied',
      `policy ${o.policyCode} v${o.policyVersion} rule ${o.ruleId} → ${String(o.result)}`,
    );
  }

  // 5. Feature flags — availability only; evaluated after authorization so a flag can never turn a deny into an allow.
  const flagCtx: FlagContext = {
    productCode: r.productCode,
    branchId: r.branchId,
    channel: env.channel,
    segment: r.segment,
    cohorts: s.cohorts,
  };
  const flags = requiredFlagsFor(action, r).map((key) =>
    evaluateFlag(key, flagCtx, input.flags, env.now),
  );
  for (const f of flags) {
    add(
      'FLAG',
      `FLAG:${f.key}`,
      f.enabled,
      f.enabled ? `${f.key} is available` : `${f.key} is currently unavailable`,
      `source=${f.source}${f.scope ? ` scope=${f.scope}` : ''}${f.ruleId ? ` rule=${f.ruleId}` : ''}`,
    );
  }

  // 6. Product
  if (action.requiresActiveProduct) {
    const ok = r.productStatus === 'ACTIVE' && r.productConfigValid === true;
    add(
      'PRODUCT',
      'ACTIVE_PRODUCT',
      ok,
      ok ? 'Product is active' : 'The product is not active for new business',
      `status=${r.productStatus} configValid=${r.productConfigValid}`,
    );
  } else if (r.type === 'LOAN_ACCOUNT' && action.kind !== 'READ') {
    // Servicing relies on the agreement snapshot, so a retired product does not block it.
    const ok = r.productConfigValid !== false;
    add(
      'PRODUCT',
      'AGREEMENT_SNAPSHOT',
      ok,
      ok ? 'Agreement terms available' : 'The agreement snapshot is invalid',
      `configValid=${r.productConfigValid}`,
    );
  }

  // 7. Workflow
  if (action.workflowStates) {
    const ok =
      !!r.workflowState && action.workflowStates.includes(r.workflowState);
    add(
      'WORKFLOW',
      'STATE',
      ok,
      ok
        ? `State ${r.workflowState}`
        : `Not allowed while the record is ${r.workflowState ?? 'in an unknown state'}`,
      `allowed=${action.workflowStates.join(',')}`,
    );
  }

  const denial = checks.find((c) => !c.passed) ?? null;
  return {
    allowed: denial === null,
    action: action.code,
    resource: { type: r.type, id: r.id },
    checks,
    denial,
    flags,
    policyVersion: input.policyVersion ?? null,
    evaluatedAt: env.now.toISOString(),
  };
}

function checkAuthority(
  input: DecisionInput,
  grants: Grant[],
): { ok: boolean; message: string; detail: string } {
  const r = input.resource;
  if (!r.amount || !r.currency)
    return {
      ok: false,
      message: 'The amount to approve is unknown',
      detail: 'missing resource.amount/currency',
    };
  let amount: Decimal;
  try {
    amount = new Decimal(r.amount);
  } catch {
    return {
      ok: false,
      message: 'The amount to approve is invalid',
      detail: `amount=${r.amount}`,
    };
  }
  if (!grants.length)
    return { ok: false, message: 'No approval authority', detail: 'no grant' };
  const maxAge = (input.fxMaxAgeDays ?? 3) * 86_400_000;
  const candidates = input.subject.authorities.filter(
    (a) =>
      a.permission === input.action.permission &&
      (!a.familyCode || a.familyCode === r.familyCode),
  );
  if (!candidates.length)
    return {
      ok: false,
      message: 'You have no approval authority for this action',
      detail: 'no authority rows',
    };
  const notes: string[] = [];
  // Limits that could not be applied because no usable FX rate exists, and
  // limits the amount genuinely exceeded — so the denial says which it was.
  const fxMissing: string[] = [];
  const fxStale: string[] = [];
  let exceeded = false;
  for (const a of candidates) {
    if (a.currency === r.currency) {
      if (amount.lte(a.maxAmount))
        return {
          ok: true,
          message: 'Within your approval authority',
          detail: `${r.amount} ${r.currency} ≤ ${a.maxAmount} (${a.source})`,
        };
      notes.push(`${a.maxAmount} ${a.currency} < amount`);
      exceeded = true;
      continue;
    }
    // Cross-currency limits need a recorded, recent FX rate; otherwise deny.
    // Rates are entered by FX managers and are not separately approved.
    const q = input.fx(r.currency, a.currency);
    if (!q) {
      notes.push(`no recorded FX ${r.currency}->${a.currency}`);
      fxMissing.push(`${r.currency}→${a.currency}`);
      continue;
    }
    if (input.environment.now.getTime() - q.asOf.getTime() > maxAge) {
      notes.push(
        `FX ${r.currency}->${a.currency} from ${q.asOf.toISOString()} is stale`,
      );
      fxStale.push(
        `${r.currency}→${a.currency} (${q.asOf.toISOString().slice(0, 10)})`,
      );
      continue;
    }
    const converted = amount.times(q.rate);
    if (converted.lte(a.maxAmount)) {
      return {
        ok: true,
        message: 'Within your approval authority',
        detail: `${r.amount} ${r.currency} × ${q.rate} (${q.source} @ ${q.asOf.toISOString()}) = ${converted.toString()} ≤ ${a.maxAmount} ${a.currency}`,
      };
    }
    notes.push(`${converted.toString()} ${a.currency} exceeds ${a.maxAmount}`);
    exceeded = true;
  }
  if (!exceeded && (fxMissing.length || fxStale.length)) {
    const days = input.fxMaxAgeDays ?? 3;
    const parts = [
      ...(fxMissing.length
        ? [`no exchange rate is recorded for ${fxMissing.join(', ')}`]
        : []),
      ...(fxStale.length
        ? [
            `the latest rate for ${fxStale.join(', ')} is older than ${days} days`,
          ]
        : []),
    ];
    return {
      ok: false,
      message: `Your approval authority is set in another currency and cannot be applied: ${parts.join('; ')}. Record a current rate in FX rates, then try again.`,
      detail: notes.join('; '),
    };
  }
  return {
    ok: false,
    message: 'The amount exceeds your approval authority',
    detail: notes.join('; '),
  };
}

/** Public explanation: which layer blocked and why, without internal policy detail. */
export function publicExplanation(d: Decision): {
  allowed: boolean;
  blockedBy: { layer: Layer; message: string }[];
} {
  return {
    allowed: d.allowed,
    blockedBy: d.checks
      .filter((c) => !c.passed)
      .map((c) => ({ layer: c.layer, message: c.message })),
  };
}
