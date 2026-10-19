/**
 * Composable loan policies (docs/servicing/POLICY_MODEL.md).
 *
 * A policy owns one part of the product configuration and its body has
 * exactly that part's shape. A contract's configuration is the product's,
 * with each chosen policy's (parameter-resolved) body laid over its part, then
 * validated with the same rules as any product. Pure: no I/O, no clock.
 */
import { dec, ZERO, EngineError } from './decimal.js';
import { compareDates, parseDate, LocalDate } from './dates.js';
import { roundMoney } from './money.js';
import { PolicyKind, POLICY_KINDS, ProductConfig, ConfigIssue, validateProductConfig } from './config.js';

// ── Policy definitions ─────────────────────────────────────────────────────

export interface PolicyParameter {
  type: 'int' | 'decimal';
  default: number;
  min: number;
  max: number;
  label?: string;
}

/** What a policy body may contain, per kind. */
export const POLICY_PARTS: Record<PolicyKind, { section: 'repayment' | 'pricing' | 'operations'; keys: string[] }> = {
  PREPAYMENT: { section: 'repayment', keys: ['prepayment', 'earlySettlement', 'earlyRepaymentCharges'] },
  LATE_CHARGES: { section: 'pricing', keys: ['penalty'] },
  ALLOCATION: { section: 'repayment', keys: ['allocation'] },
  NON_ACCRUAL: { section: 'operations', keys: ['nonAccrual'] },
};

export interface PolicyDefinition {
  kind: PolicyKind;
  code: string;
  version: number;
  parameters?: Record<string, PolicyParameter>;
  /** Keys of POLICY_PARTS[kind].keys; values may contain { "$param": name } placeholders. */
  body: Record<string, unknown>;
}

export interface ResolvedPolicy {
  kind: PolicyKind;
  code: string;
  version: number;
  parameters: Record<string, number>;
  body: Record<string, unknown>;
}

const isParamRef = (v: unknown): v is { $param: string } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { $param?: unknown }).$param === 'string';

function substitute(value: unknown, params: Record<string, number>, kind: string): unknown {
  if (isParamRef(value)) {
    if (!(value.$param in params)) throw new EngineError('UNKNOWN_POLICY_PARAMETER', `Policy body uses parameter "${value.$param}" that the ${kind} policy does not declare.`);
    return params[value.$param];
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, params, kind));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, params, kind)]));
  }
  return value;
}

/**
 * Resolve a policy for one contract: check the requested parameter values
 * against the policy's own bounds and the product's narrower bounds, then
 * substitute them into the body.
 */
export function resolvePolicy(
  policy: PolicyDefinition,
  requested: Record<string, number> = {},
  productBounds: Record<string, { min: number; max: number }> = {},
): ResolvedPolicy {
  const allowedKeys = POLICY_PARTS[policy.kind].keys;
  const stray = Object.keys(policy.body).filter((k) => !allowedKeys.includes(k));
  if (stray.length) throw new EngineError('INVALID_POLICY_BODY', `A ${policy.kind} policy may only set ${allowedKeys.join(', ')}; found ${stray.join(', ')}.`);

  const declared = policy.parameters ?? {};
  for (const name of Object.keys(requested)) {
    if (!(name in declared)) throw new EngineError('UNKNOWN_POLICY_PARAMETER', `Policy ${policy.code} has no parameter "${name}".`);
  }
  const values: Record<string, number> = {};
  for (const [name, p] of Object.entries(declared)) {
    const v = requested[name] ?? p.default;
    const lo = Math.max(p.min, productBounds[name]?.min ?? -Infinity);
    const hi = Math.min(p.max, productBounds[name]?.max ?? Infinity);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new EngineError('INVALID_POLICY_PARAMETER', `${name} must be a number.`);
    if (p.type === 'int' && !Number.isInteger(v)) throw new EngineError('INVALID_POLICY_PARAMETER', `${name} must be a whole number.`);
    if (v < lo || v > hi) throw new EngineError('POLICY_PARAMETER_OUT_OF_RANGE', `${name} must be between ${lo} and ${hi} for this product; got ${v}.`);
    values[name] = v;
  }
  return {
    kind: policy.kind,
    code: policy.code,
    version: policy.version,
    parameters: values,
    body: substitute(policy.body, values, policy.kind) as Record<string, unknown>,
  };
}

/**
 * The contract's configuration: the product configuration with each resolved
 * policy laid over the part it owns, validated as a whole. Returns the issues
 * instead of a configuration when the combination is invalid.
 */
export function composeContractConfig(
  product: ProductConfig,
  policies: ResolvedPolicy[],
): { ok: true; config: ProductConfig } | { ok: false; issues: ConfigIssue[] } {
  const seen = new Set<string>();
  const next = JSON.parse(JSON.stringify(product)) as Record<string, Record<string, unknown>>;
  for (const p of policies) {
    if (!POLICY_KINDS.includes(p.kind)) return { ok: false, issues: [{ path: 'policies', message: `Unknown policy kind ${p.kind}` }] };
    if (seen.has(p.kind)) return { ok: false, issues: [{ path: `policies.${p.kind}`, message: 'Only one policy per kind' }] };
    seen.add(p.kind);
    const part = POLICY_PARTS[p.kind];
    for (const [k, v] of Object.entries(p.body)) next[part.section][k] = v;
  }
  return validateProductConfig(next);
}

/** Which policy a contract uses for a kind, given the product's menu and the contract's choice. */
export function choosePolicyCode(product: ProductConfig, kind: PolicyKind, requestedCode?: string): string | null {
  const choice = product.policies[kind];
  if (!choice) {
    if (requestedCode) throw new EngineError('POLICY_NOT_OFFERED', `This product does not offer a choice of ${kind} policy.`);
    return null;
  }
  const code = requestedCode ?? choice.defaultCode;
  if (!choice.menu.includes(code)) throw new EngineError('POLICY_NOT_OFFERED', `${kind} policy ${code} is not offered on this product (choose from ${choice.menu.join(', ')}).`);
  return code;
}

// ── Lock-in and early repayment charges ────────────────────────────────────

/** Whole calendar months from `start` to `end` (a month is complete on the same day-of-month). */
export function wholeMonthsBetween(start: LocalDate, end: LocalDate): number {
  if (compareDates(end, start) < 0) return 0;
  const a = parseDate(start, 'start');
  const b = parseDate(end, 'end');
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return Math.max(0, months);
}

export type EarlyRepaymentKind = 'PARTIAL_PREPAYMENT' | 'EARLY_SETTLEMENT';

export interface EarlyRepaymentCharge {
  /** True when a REFUSE tier applies: early repayment is not allowed yet. */
  refused: boolean;
  charge: string;
  /** Which rule set the charge: a lock-in tier (index) or the base fee. */
  source: { kind: 'TIER'; index: number; untilMonth: number } | { kind: 'BASE' } | { kind: 'NONE' };
  monthsElapsed: number;
  explanation: string;
}

/**
 * The charge for repaying early (UC-32, DECISIONS D-004, D-005).
 *
 * The first lock-in tier whose `untilMonth` has not passed applies and
 * replaces the base fee; after the last tier the base fee applies. Tiers
 * never stack with the base fee.
 *
 * `amountRepaid` is the principal repaid early (the prepaid amount, or the
 * principal settled); `principalOutstanding` the principal before it.
 */
export function earlyRepaymentCharge(
  config: ProductConfig,
  kind: EarlyRepaymentKind,
  disbursementDate: LocalDate,
  valueDate: LocalDate,
  amountRepaid: string,
  principalOutstanding: string,
): EarlyRepaymentCharge {
  const erc = config.repayment.earlyRepaymentCharges;
  const rounding = config.pricing.rounding;
  const monthsElapsed = wholeMonthsBetween(disbursementDate, valueDate);
  const repaid = dec(amountRepaid, 'amountRepaid');
  const outstanding = dec(principalOutstanding, 'principalOutstanding');

  if (erc.appliesTo.includes(kind)) {
    const index = erc.tiers.findIndex((t) => monthsElapsed < t.untilMonth);
    if (index >= 0) {
      const t = erc.tiers[index];
      const source = { kind: 'TIER' as const, index, untilMonth: t.untilMonth };
      if (t.action === 'REFUSE') {
        return {
          refused: true,
          charge: '0',
          source,
          monthsElapsed,
          explanation: `Early repayment is not allowed until month ${t.untilMonth} of the loan (lock-in); ${monthsElapsed} month(s) have passed.`,
        };
      }
      const basis = erc.basis === 'OUTSTANDING_PRINCIPAL' ? outstanding : repaid;
      const raw = (t.rate ? basis.times(t.rate) : ZERO).plus(t.fixed ? dec(t.fixed, 'fixed') : ZERO);
      const charge = roundMoney(raw, rounding);
      const parts = [t.rate ? `${dec(t.rate).times(100).toString()}% of ${erc.basis === 'OUTSTANDING_PRINCIPAL' ? 'outstanding principal' : 'the amount repaid'} (${basis.toString()})` : null, t.fixed ? `${t.fixed} fixed` : null].filter(Boolean);
      return {
        refused: false,
        charge: charge.toString(),
        source,
        monthsElapsed,
        explanation: `Lock-in charge for repaying in month ${monthsElapsed + 1} (tier until month ${t.untilMonth}): ${parts.join(' + ')} = ${charge.toString()}.`,
      };
    }
  }

  const base = kind === 'PARTIAL_PREPAYMENT'
    ? { rate: config.repayment.prepayment.feeRate, fixed: null as string | null, basis: repaid }
    : { rate: config.repayment.earlySettlement.feeRate, fixed: config.repayment.earlySettlement.feeFixed, basis: repaid };
  if (!base.rate && !base.fixed) {
    return { refused: false, charge: '0', source: { kind: 'NONE' }, monthsElapsed, explanation: 'No early repayment charge applies.' };
  }
  const charge = roundMoney((base.rate ? base.basis.times(base.rate) : ZERO).plus(base.fixed ? dec(base.fixed, 'fixed') : ZERO), rounding);
  return {
    refused: false,
    charge: charge.toString(),
    source: { kind: 'BASE' },
    monthsElapsed,
    explanation: `Base ${kind === 'PARTIAL_PREPAYMENT' ? 'prepayment' : 'early settlement'} fee: ${charge.toString()}.`,
  };
}
