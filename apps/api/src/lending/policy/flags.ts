/**
 * Feature-flag evaluation — availability, never permission.
 *
 * Precedence (deterministic, documented in docs/lending/ACCESS_CONTROL.md):
 *   1. Unknown flag key                → OFF (fail closed)
 *   2. Platform emergency-off rule     → OFF, cannot be overridden
 *   3. Tenant emergency-off rule       → OFF, cannot be overridden by narrower tenant rules
 *   4. Most specific matching tenant rule wins:
 *        COHORT > SEGMENT > CHANNEL > BRANCH > PRODUCT > TENANT
 *      ties: lower `priority`, then later `effectiveFrom`, then lower id
 *   5. Platform (non-emergency) rule, same tie-break
 *   6. Flag default
 *
 * Only ACTIVE rules inside their effective window are considered. Cohorts are
 * explicit memberships, so the same subject always gets the same answer.
 */

export type FlagScopeType =
  | 'TENANT'
  | 'PRODUCT'
  | 'BRANCH'
  | 'CHANNEL'
  | 'SEGMENT'
  | 'COHORT';

export const SCOPE_SPECIFICITY: Record<FlagScopeType, number> = {
  TENANT: 1,
  PRODUCT: 2,
  BRANCH: 3,
  CHANNEL: 4,
  SEGMENT: 5,
  COHORT: 6,
};

export interface FlagCatalogueEntry {
  key: string;
  sensitive: boolean;
  defaultEnabled: boolean;
}

export interface PlatformRule {
  id: string;
  flagKey: string;
  enabled: boolean;
  emergency: boolean;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface TenantRule {
  id: string;
  flagKey: string;
  scopeType: string;
  scopeValue: string | null;
  enabled: boolean;
  emergency: boolean;
  priority: number;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface FlagContext {
  productCode?: string | null;
  branchId?: string | null;
  channel?: string | null;
  segment?: string | null;
  cohorts?: string[];
}

export interface FlagEvaluation {
  key: string;
  enabled: boolean;
  /** Which precedence step decided the outcome. */
  source:
    | 'UNKNOWN_FLAG'
    | 'PLATFORM_EMERGENCY'
    | 'TENANT_EMERGENCY'
    | 'TENANT_RULE'
    | 'PLATFORM_RULE'
    | 'DEFAULT';
  ruleId?: string;
  scope?: string;
}

export interface FlagSnapshot {
  catalogue: Map<string, FlagCatalogueEntry>;
  platformRules: PlatformRule[];
  tenantRules: TenantRule[];
}

const live = (
  r: { status: string; effectiveFrom: Date; effectiveTo: Date | null },
  now: Date,
) =>
  r.status === 'ACTIVE' &&
  r.effectiveFrom.getTime() <= now.getTime() &&
  (!r.effectiveTo || r.effectiveTo.getTime() > now.getTime());

function matches(rule: TenantRule, ctx: FlagContext): boolean {
  switch (rule.scopeType as FlagScopeType) {
    case 'TENANT':
      return true;
    case 'PRODUCT':
      return !!ctx.productCode && rule.scopeValue === ctx.productCode;
    case 'BRANCH':
      return !!ctx.branchId && rule.scopeValue === ctx.branchId;
    case 'CHANNEL':
      return !!ctx.channel && rule.scopeValue === ctx.channel;
    case 'SEGMENT':
      return !!ctx.segment && rule.scopeValue === ctx.segment;
    case 'COHORT':
      return !!rule.scopeValue && (ctx.cohorts ?? []).includes(rule.scopeValue);
    default:
      return false; // an unrecognised scope never matches
  }
}

function tieBreak<
  T extends { priority?: number; effectiveFrom: Date; id: string },
>(a: T, b: T): number {
  return (
    (a.priority ?? 100) - (b.priority ?? 100) ||
    b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function evaluateFlag(
  key: string,
  ctx: FlagContext,
  snapshot: FlagSnapshot,
  now = new Date(),
): FlagEvaluation {
  const def = snapshot.catalogue.get(key);
  if (!def) return { key, enabled: false, source: 'UNKNOWN_FLAG' };

  const platform = snapshot.platformRules.filter(
    (r) => r.flagKey === key && live(r, now),
  );
  const platformEmergency = platform.find((r) => r.emergency && !r.enabled);
  if (platformEmergency)
    return {
      key,
      enabled: false,
      source: 'PLATFORM_EMERGENCY',
      ruleId: platformEmergency.id,
    };

  const tenant = snapshot.tenantRules.filter(
    (r) => r.flagKey === key && live(r, now),
  );
  const tenantEmergency = tenant.find(
    (r) => r.emergency && !r.enabled && r.scopeType === 'TENANT',
  );
  if (tenantEmergency)
    return {
      key,
      enabled: false,
      source: 'TENANT_EMERGENCY',
      ruleId: tenantEmergency.id,
    };

  const applicable = tenant.filter(
    (r) => r.scopeType in SCOPE_SPECIFICITY && matches(r, ctx),
  );
  if (applicable.length) {
    applicable.sort(
      (a, b) =>
        SCOPE_SPECIFICITY[b.scopeType as FlagScopeType] -
          SCOPE_SPECIFICITY[a.scopeType as FlagScopeType] || tieBreak(a, b),
    );
    const winner = applicable[0];
    return {
      key,
      enabled: winner.enabled,
      source: 'TENANT_RULE',
      ruleId: winner.id,
      scope: `${winner.scopeType}${winner.scopeValue ? `:${winner.scopeValue}` : ''}`,
    };
  }

  const platformRegular = platform
    .filter((r) => !r.emergency)
    .sort((a, b) => tieBreak(a, b));
  if (platformRegular.length)
    return {
      key,
      enabled: platformRegular[0].enabled,
      source: 'PLATFORM_RULE',
      ruleId: platformRegular[0].id,
    };

  return { key, enabled: def.defaultEnabled, source: 'DEFAULT' };
}
