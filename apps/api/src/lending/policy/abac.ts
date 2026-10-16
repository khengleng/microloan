import { z } from 'zod';

/**
 * Constrained ABAC policy language.
 *
 * Tenant administrators can add restrictions, never grants: a rule either
 * DENYs an action when its condition holds, or REQUIREs a condition for the
 * action to proceed. Policies are evaluated after RBAC, so they can only
 * narrow what a role already permits (deny-overrides, default deny).
 *
 * Conditions use a closed vocabulary of attributes and operators — no
 * expressions, no code. Evaluation is three-valued: a condition over a
 * missing or malformed attribute is UNKNOWN, and UNKNOWN never allows:
 * a DENY rule fires on TRUE or UNKNOWN, a REQUIRE rule fails on FALSE or UNKNOWN.
 */

export const POLICY_ATTRIBUTES = [
  'resource.amount',
  'resource.currency',
  'resource.familyCode',
  'resource.productCode',
  'resource.branchId',
  'resource.legalEntityId',
  'resource.portfolioId',
  'resource.riskCategory',
  'resource.dataClassification',
  'resource.workflowState',
  'resource.segment',
  'subject.branchId',
  'subject.roles',
  'subject.assurance',
  'environment.channel',
  'environment.assurance',
  'environment.hourUtc',
  'environment.dayOfWeek',
] as const;
export type PolicyAttribute = (typeof POLICY_ATTRIBUTES)[number];

export const POLICY_OPERATORS = [
  'eq',
  'neq',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'contains',
] as const;
export type PolicyOperator = (typeof POLICY_OPERATORS)[number];

const scalar = z.union([z.string().max(120), z.number().finite(), z.boolean()]);

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
      attr: PolicyAttribute;
      op: PolicyOperator;
      value?: string | number | boolean | (string | number)[];
    };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1).max(20) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1).max(20) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z
      .object({
        attr: z.enum(POLICY_ATTRIBUTES),
        op: z.enum(POLICY_OPERATORS),
        value: z
          .union([
            scalar,
            z
              .array(z.union([z.string().max(120), z.number().finite()]))
              .max(50),
          ])
          .optional(),
      })
      .strict()
      .superRefine((c, ctx) => {
        if (c.op !== 'exists' && c.value === undefined)
          ctx.addIssue({
            code: 'custom',
            message: `operator ${c.op} needs a value`,
          });
        if ((c.op === 'in' || c.op === 'nin') && !Array.isArray(c.value))
          ctx.addIssue({
            code: 'custom',
            message: `operator ${c.op} needs a list`,
          });
      }),
  ]),
);

export const policyRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    effect: z.enum(['DENY', 'REQUIRE']),
    /** Exact action codes, or a prefix ending in ".*" (e.g. "loan.disbursement.*"). */
    actions: z
      .array(z.string().regex(/^[a-z_.]+(\.\*)?$/))
      .min(1)
      .max(30),
    condition: conditionSchema,
    /** Shown to users when the rule blocks; must not reveal sensitive policy detail. */
    message: z.string().min(3).max(200),
  })
  .strict();
export type PolicyRule = z.infer<typeof policyRuleSchema>;

export const policyRulesSchema = z.array(policyRuleSchema).max(100);

export type AttributeBag = Record<PolicyAttribute, unknown>;
type Tri = true | false | 'UNKNOWN';

function compareNumeric(left: unknown, right: unknown): number | null {
  const a =
    typeof left === 'number'
      ? left
      : typeof left === 'string' && /^-?\d+(\.\d+)?$/.test(left)
        ? Number(left)
        : NaN;
  const b =
    typeof right === 'number'
      ? right
      : typeof right === 'string' && /^-?\d+(\.\d+)?$/.test(right)
        ? Number(right)
        : NaN;
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  // Policy thresholds are coarse limits; exact money arithmetic lives in the engine.
  return a === b ? 0 : a < b ? -1 : 1;
}

export function evaluateCondition(
  c: Condition,
  attrs: Partial<AttributeBag>,
): Tri {
  if ('all' in c) {
    let unknown = false;
    for (const sub of c.all) {
      const r = evaluateCondition(sub, attrs);
      if (r === false) return false;
      if (r === 'UNKNOWN') unknown = true;
    }
    return unknown ? 'UNKNOWN' : true;
  }
  if ('any' in c) {
    let unknown = false;
    for (const sub of c.any) {
      const r = evaluateCondition(sub, attrs);
      if (r === true) return true;
      if (r === 'UNKNOWN') unknown = true;
    }
    return unknown ? 'UNKNOWN' : false;
  }
  if ('not' in c) {
    const r = evaluateCondition(c.not, attrs);
    return r === 'UNKNOWN' ? 'UNKNOWN' : !r;
  }
  const value = attrs[c.attr];
  if (c.op === 'exists') return value !== undefined && value !== null;
  if (value === undefined || value === null) return 'UNKNOWN';
  // Only scalars are comparable; an object or list in a scalar comparison is UNKNOWN (fails closed).
  const sv = scalarText(value);
  switch (c.op) {
    case 'eq':
      return sv === null ? 'UNKNOWN' : sv === String(c.value);
    case 'neq':
      return sv === null ? 'UNKNOWN' : sv !== String(c.value);
    case 'in':
      return sv === null
        ? 'UNKNOWN'
        : (c.value as (string | number)[]).map(String).includes(sv);
    case 'nin':
      return sv === null
        ? 'UNKNOWN'
        : !(c.value as (string | number)[]).map(String).includes(sv);
    case 'contains':
      return Array.isArray(value)
        ? value.map((x) => scalarText(x)).includes(String(c.value))
        : 'UNKNOWN';
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cmp = compareNumeric(value, c.value);
      if (cmp === null) return 'UNKNOWN';
      return c.op === 'gt'
        ? cmp > 0
        : c.op === 'gte'
          ? cmp >= 0
          : c.op === 'lt'
            ? cmp < 0
            : cmp <= 0;
    }
  }
}

function scalarText(v: unknown): string | null {
  return typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
    ? String(v)
    : null;
}

export function ruleAppliesTo(rule: PolicyRule, action: string): boolean {
  return rule.actions.some((a) =>
    a.endsWith('.*') ? action.startsWith(a.slice(0, -1)) : a === action,
  );
}

export interface PolicyOutcome {
  ruleId: string;
  policyCode: string;
  policyVersion: number;
  blocked: boolean;
  /** Why: condition TRUE/FALSE/UNKNOWN. UNKNOWN means an attribute was missing. */
  result: Tri;
  message: string;
}

export interface CompiledPolicy {
  code: string;
  version: number;
  rules: PolicyRule[];
}

export function evaluatePolicies(
  policies: CompiledPolicy[],
  action: string,
  attrs: Partial<AttributeBag>,
): PolicyOutcome[] {
  const out: PolicyOutcome[] = [];
  for (const p of policies) {
    for (const rule of p.rules) {
      if (!ruleAppliesTo(rule, action)) continue;
      const result = evaluateCondition(rule.condition, attrs);
      const blocked =
        rule.effect === 'DENY' ? result !== false : result !== true;
      out.push({
        ruleId: rule.id,
        policyCode: p.code,
        policyVersion: p.version,
        blocked,
        result,
        message: rule.message,
      });
    }
  }
  return out;
}
