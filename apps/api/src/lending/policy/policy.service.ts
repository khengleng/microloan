import { ForbiddenException, Injectable } from '@nestjs/common';
import { lending } from '@microloan/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';
import { AuditEventService } from '../common/audit-event.service';
import type { Tx } from '../common/lending-prisma';
import type { LendingActor } from '../common/util';
import { currentBatch } from '../servicing/batch-scope';
import { operationalConfig } from '../../config/operational-config';
import { MFA_STEP_UP_REQUIRED } from '../../auth/mfa-policy';
import { ACTION_BY_CODE, actionsFor, ResourceType } from './actions';
import { CompiledPolicy, policyRulesSchema } from './abac';
import {
  Decision,
  FxQuote,
  Resource,
  Subject,
  decide,
  publicExplanation,
  Grant,
  Authority,
} from './decision';
import { FlagSnapshot } from './flags';
import {
  CUSTOMER_PERMISSIONS,
  PERMISSION_CODES,
  PLATFORM_PERMISSIONS,
  ROLE_DEFINITIONS,
} from './catalogue';

interface TenantContextCache {
  version: number;
  loadedAt: number;
  flags: FlagSnapshot;
  policies: CompiledPolicy[];
  fx: Map<string, FxQuote>;
}

/** How long a built subject or context is reused at an unchanged version: LENDING_AUTHZ_CACHE_TTL_MS (default 30 s). */
const cacheTtlMs = () => operationalConfig().authzCacheTtlMs;
/** Entries kept per cache before expired ones are swept: LENDING_AUTHZ_CACHE_MAX_ENTRIES (default 5,000). */
const cacheMaxEntries = () => operationalConfig().authzCacheMaxEntries;
/** Legacy roles that implicitly hold the tenant-administrator lending role, so a tenant can bootstrap access. */
const BOOTSTRAP_ADMIN_ROLES = new Set(['TENANT_ADMIN', 'ADMIN']);

/**
 * Builds subjects and context from trusted server-side sources and runs the
 * decision engine. Decisions themselves are never cached; the inputs are,
 * keyed by tenant + user + the tenant's `authzVersion`, which every change to
 * roles, assignments, delegations, authorities, policies, flags and exchange
 * rates bumps.
 *
 * Several API instances: the version is read from the database on every
 * request, so a change made on any instance invalidates every instance's
 * entry at once — the in-process maps are a read-through memo of database
 * rows, never the source of truth. Platform-wide changes bump every tenant's
 * version (see `invalidateAll`); the platform's own context is not cached.
 * The maps are bounded: expired entries are swept as they fill.
 */
@Injectable()
export class PolicyService {
  private subjects = new Map<string, { subject: Subject; loadedAt: number }>();
  private contexts = new Map<string, TenantContextCache>();

  /** Drop expired entries once a cache passes its bound; empty it if all are live. */
  private remember<V extends { loadedAt: number }>(
    map: Map<string, V>,
    key: string,
    value: V,
  ) {
    if (map.size >= cacheMaxEntries()) {
      const cutoff = Date.now() - cacheTtlMs();
      for (const [k, v] of map) if (v.loadedAt < cutoff) map.delete(k);
      if (map.size >= cacheMaxEntries()) map.clear();
    }
    map.set(key, value);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventService,
  ) {}

  // ── Versioning ────────────────────────────────────────────────────────────

  async authzVersion(tenantId: string, tx?: Tx): Promise<number> {
    const db = tx ?? this.prisma;
    // Select the id too: the tenant guard verifies row ownership by id, and a row without it reads as foreign.
    const t = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, authzVersion: true },
    });
    return t?.authzVersion ?? -1;
  }

  /** Invalidate every cached subject and context for the tenant. Call inside the changing transaction. */
  async bumpVersion(tenantId: string, tx: Tx): Promise<void> {
    await tx.tenant.update({
      where: { id: tenantId },
      data: { authzVersion: { increment: 1 } },
    });
  }

  /**
   * Platform rules affect every tenant. Bumping every tenant's version in the
   * database invalidates the cached contexts on every API instance (each
   * reads the version per request), not only this one's.
   */
  async invalidateAll(): Promise<void> {
    await runAsSystem('platform rule change invalidates every tenant', () =>
      this.prisma.tenant.updateMany({
        data: { authzVersion: { increment: 1 } },
      }),
    );
    this.subjects.clear();
    this.contexts.clear();
  }

  // ── Subject ───────────────────────────────────────────────────────────────

  async subject(actor: LendingActor, tx?: Tx): Promise<Subject> {
    if (actor.type === 'PLATFORM') {
      return {
        id: actor.id,
        type: 'PLATFORM',
        tenantId: null,
        active: true,
        roles: ['PLATFORM_ADMIN'],
        grants: PLATFORM_PERMISSIONS.map((p) => fullScopeGrant(p, 'PLATFORM')),
        authorities: [],
        assurance: actor.assurance,
        cohorts: [],
      };
    }
    if (actor.type === 'CUSTOMER') {
      return {
        id: actor.id,
        type: 'CUSTOMER',
        tenantId: actor.tenantId,
        active: true,
        roles: ['CUSTOMER'],
        grants: CUSTOMER_PERMISSIONS.map((p) =>
          fullScopeGrant(p, 'SERVICE_SCOPE'),
        ),
        authorities: [],
        assurance: actor.assurance,
        cohorts: [],
      };
    }
    if (actor.type === 'SERVICE') {
      const scopes = (actor.scopes ?? []).filter((s) =>
        PERMISSION_CODES.has(s),
      );
      return {
        id: actor.id,
        type: 'SERVICE',
        tenantId: actor.tenantId,
        active: true,
        roles: ['INTEGRATION_SERVICE'],
        grants: scopes.map((p) => fullScopeGrant(p, 'SERVICE_SCOPE')),
        authorities: [],
        assurance: 'SERVICE_KEY',
        cohorts: [],
      };
    }
    const tenantId = actor.tenantId!;
    const version = await this.authzVersion(tenantId, tx);
    const key = `${tenantId}:${actor.id}:${version}`;
    const hit = this.subjects.get(key);
    if (!tx && hit && Date.now() - hit.loadedAt < cacheTtlMs())
      return { ...hit.subject, assurance: actor.assurance };
    const subject = await this.loadUserSubject(
      tenantId,
      actor.id,
      actor.assurance,
      tx,
    );
    if (!tx)
      this.remember(this.subjects, key, { subject, loadedAt: Date.now() });
    return subject;
  }

  async loadUserSubject(
    tenantId: string,
    userId: string,
    assurance: Subject['assurance'],
    tx?: Tx,
  ): Promise<Subject> {
    const db = tx ?? this.prisma;
    const now = new Date();
    const user = await db.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, isActive: true, branchId: true, role: true },
    });
    if (!user) {
      return {
        id: userId,
        type: 'USER',
        tenantId,
        active: false,
        roles: [],
        grants: [],
        authorities: [],
        assurance,
        cohorts: [],
      };
    }
    const own = await this.assignmentGrants(db, tenantId, userId, now);
    const grants: Grant[] = [...own.grants];
    const roles = new Set(own.roles);

    if (BOOTSTRAP_ADMIN_ROLES.has(user.role)) {
      const def = ROLE_DEFINITIONS.find((r) => r.code === 'TENANT_ADMIN')!;
      roles.add('TENANT_ADMIN');
      grants.push(
        ...def.permissions.map((p) => ({
          ...fullScopeGrant(p, 'BOOTSTRAP'),
          roleCode: 'TENANT_ADMIN (legacy admin)',
        })),
      );
    }

    // Approval authorities held directly or through an active role.
    const authorityRows = await db.approvalAuthority.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        AND: [
          {
            OR: [
              { userId },
              { roleId: { in: own.roleIds.length ? own.roleIds : ['-'] } },
            ],
          },
        ],
      },
    });
    const authorities: Authority[] = authorityRows.map((a) => ({
      permission: a.permission,
      currency: a.currency,
      maxAmount: a.maxAmount.toString(),
      familyCode: a.familyCode,
      source: a.userId ? 'user authority' : 'role authority',
    }));

    // Delegations: the delegate receives only what the delegator holds *now*,
    // with the delegator's scope, until the delegation expires.
    const delegations = await db.delegation.findMany({
      where: {
        tenantId,
        toUserId: userId,
        status: 'ACTIVE',
        revokedAt: null,
        validFrom: { lte: now },
        validTo: { gt: now },
      },
    });
    for (const d of delegations) {
      const from = await db.user.findFirst({
        where: { id: d.fromUserId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!from) continue;
      const fromGrants = await this.assignmentGrants(
        db,
        tenantId,
        d.fromUserId,
        now,
      );
      for (const g of fromGrants.grants) {
        if (d.permissions.includes(g.permission))
          grants.push({
            ...g,
            source: 'DELEGATION',
            roleCode: `delegated by ${d.fromUserId}`,
          });
      }
      if (d.maxAmount && d.currency) {
        const fromAuth = await db.approvalAuthority.findMany({
          where: {
            tenantId,
            status: 'ACTIVE',
            currency: d.currency,
            permission: { in: d.permissions },
            OR: [
              { userId: d.fromUserId },
              {
                roleId: {
                  in: fromGrants.roleIds.length ? fromGrants.roleIds : ['-'],
                },
              },
            ],
          },
        });
        for (const a of fromAuth) {
          const cap = a.maxAmount.lessThan(d.maxAmount)
            ? a.maxAmount
            : d.maxAmount;
          authorities.push({
            permission: a.permission,
            currency: a.currency,
            maxAmount: cap.toString(),
            familyCode: a.familyCode,
            source: 'delegated authority',
          });
        }
      }
    }

    const cohorts = await db.cohortMembership.findMany({
      where: {
        tenantId,
        OR: [
          { subjectType: 'USER', subjectId: userId },
          ...(user.branchId
            ? [{ subjectType: 'BRANCH', subjectId: user.branchId }]
            : []),
        ],
      },
      select: { cohortCode: true },
    });

    return {
      id: userId,
      type: 'USER',
      tenantId,
      active: user.isActive,
      branchId: user.branchId,
      roles: [...roles],
      grants,
      authorities,
      assurance,
      cohorts: [...new Set(cohorts.map((c) => c.cohortCode))],
    };
  }

  private async assignmentGrants(
    db: Tx | PrismaService,
    tenantId: string,
    userId: string,
    now: Date,
  ): Promise<{ grants: Grant[]; roles: string[]; roleIds: string[] }> {
    const rows = await db.roleAssignment.findMany({
      where: {
        tenantId,
        userId,
        status: 'ACTIVE',
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      include: { role: { include: { permissions: true } } },
    });
    const grants: Grant[] = [];
    for (const a of rows) {
      for (const p of a.role.permissions) {
        grants.push({
          permission: p.permissionCode,
          source: 'ROLE',
          roleCode: a.role.code,
          allBranches: a.allBranches,
          branchIds: a.branchIds,
          portfolioIds: a.portfolioIds,
          legalEntityIds: a.legalEntityIds,
        });
      }
    }
    return {
      grants,
      roles: [...new Set(rows.map((r) => r.role.code))],
      roleIds: [...new Set(rows.map((r) => r.roleId))],
    };
  }

  // ── Context: flags, policies, FX ───────────────────────────────────────────

  async context(tenantId: string | null, tx?: Tx): Promise<TenantContextCache> {
    const version = tenantId ? await this.authzVersion(tenantId, tx) : 0;
    const key = `${tenantId ?? 'platform'}`;
    const hit = this.contexts.get(key);
    if (
      !tx &&
      tenantId &&
      hit &&
      hit.version === version &&
      Date.now() - hit.loadedAt < cacheTtlMs()
    )
      return hit;
    // Inside an end-of-day run the decision is still made in the loan's
    // transaction on the authorization version it reads above; the rest of
    // the context is shared by the run's loans while that version holds, on
    // the same terms as the cache above (DECISIONS D-051).
    const batch = tx && tenantId ? currentBatch(tenantId) : undefined;
    const shared = batch?.memo.get('policy-context') as
      | TenantContextCache
      | undefined;
    if (
      shared &&
      shared.version === version &&
      Date.now() - shared.loadedAt < cacheTtlMs()
    )
      return shared;
    const db = tx ?? this.prisma;
    const [flags, platformRules, tenantRules, policyVersions, fxRows] =
      await Promise.all([
        db.featureFlag.findMany(),
        db.platformFlagRule.findMany({ where: { status: 'ACTIVE' } }),
        tenantId
          ? db.flagRule.findMany({ where: { tenantId, status: 'ACTIVE' } })
          : Promise.resolve([]),
        tenantId
          ? db.policyVersion.findMany({
              where: { tenantId, status: 'ACTIVE' },
              include: { policy: { select: { code: true } } },
            })
          : Promise.resolve([]),
        tenantId
          ? db.exchangeRate.findMany({
              where: { tenantId },
              orderBy: { effectiveDate: 'desc' },
              take: 200,
            })
          : Promise.resolve([]),
      ]);
    const policies: CompiledPolicy[] = [];
    for (const pv of policyVersions) {
      const parsed = policyRulesSchema.safeParse(pv.rules);
      // A stored policy that no longer parses fails closed: it denies the actions it names.
      policies.push(
        parsed.success
          ? { code: pv.policy.code, version: pv.version, rules: parsed.data }
          : {
              code: pv.policy.code,
              version: pv.version,
              rules: brokenPolicyRules(pv.rules),
            },
      );
    }
    const fx = new Map<string, FxQuote>();
    for (const r of fxRows) {
      const k = `${r.fromCurrency}->${r.toCurrency}`;
      if (!fx.has(k) && r.effectiveDate.getTime() <= Date.now())
        fx.set(k, {
          rate: r.rate.toString(),
          asOf: r.effectiveDate,
          source: 'TENANT_FX_TABLE',
        });
    }
    const ctx: TenantContextCache = {
      version,
      loadedAt: Date.now(),
      flags: {
        catalogue: new Map(
          flags.map((f) => [
            f.key,
            {
              key: f.key,
              sensitive: f.sensitive,
              defaultEnabled: f.defaultEnabled,
            },
          ]),
        ),
        platformRules,
        tenantRules,
      },
      policies,
      fx,
    };
    // The platform's own context (tenantId null) has no version to check a
    // cached copy against, so it is always read fresh.
    if (!tx && tenantId) this.remember(this.contexts, key, ctx);
    else batch?.memo.set('policy-context', ctx);
    return ctx;
  }

  // ── Decisions ─────────────────────────────────────────────────────────────

  async decide(
    actor: LendingActor,
    actionCode: string,
    resource: Resource,
    tx?: Tx,
  ): Promise<Decision> {
    const action = ACTION_BY_CODE[actionCode];
    if (!action) throw new Error(`Unknown lending action ${actionCode}`);
    const [subject, ctx] = await Promise.all([
      this.subject(actor, tx),
      this.context(actor.tenantId ?? resource.tenantId ?? null, tx),
    ]);
    return decide({
      action,
      subject,
      resource,
      environment: {
        now: new Date(),
        channel: actor.channel,
        assurance: actor.assurance,
        emergencyAccess: false,
      },
      flags: ctx.flags,
      policies: ctx.policies,
      fx: (from, to) => fxLookup(ctx.fx, from, to),
      policyVersion: ctx.version,
    });
  }

  /**
   * Decide and throw on deny. Call it inside the business transaction, after
   * the resource is re-read, so the decision is made on committed state.
   */
  async enforce(
    actor: LendingActor,
    actionCode: string,
    resource: Resource,
    tx?: Tx,
  ): Promise<Decision> {
    const d = await this.decide(actor, actionCode, resource, tx);
    if (!d.allowed) {
      // Outside the transaction so the denial is recorded even though the request fails.
      void runAsSystem('lending audit: authorization denial', () =>
        this.audit.write({
          actor,
          action: actionCode,
          resourceType: resource.type,
          resourceId: resource.id,
          outcome: 'DENY',
          decision: d,
        }),
      );
      const explanation = publicExplanation(d);
      // Denied only for want of a recent authenticator code: the client can
      // step up (POST /auth/mfa/step-up) and retry, so say so (D-129).
      const failing = d.checks.filter((c) => !c.passed);
      const stepUp =
        failing.length > 0 && failing.every((c) => c.code === 'ASSURANCE');
      throw new ForbiddenException({
        message: explanation.blockedBy[0]?.message ?? 'Not permitted',
        code: stepUp ? MFA_STEP_UP_REQUIRED : 'ACCESS_DENIED',
        action: actionCode,
        blockedBy: explanation.blockedBy,
      });
    }
    return d;
  }

  /** Coarse pre-check used by the route guard: does the actor hold the permission anywhere? */
  async holdsPermission(
    actor: LendingActor,
    actionCode: string,
  ): Promise<boolean> {
    const action = ACTION_BY_CODE[actionCode];
    if (!action) return false;
    const s = await this.subject(actor);
    return s.active && s.grants.some((g) => g.permission === action.permission);
  }

  /**
   * A Prisma `where` fragment confining a list, search, dashboard or export to
   * the records the actor's grants for `permission` cover. `null` means the
   * actor holds the permission nowhere — return nothing.
   */
  async scopeFilter(
    actor: LendingActor,
    permission: string,
  ): Promise<Record<string, unknown> | null> {
    const s = await this.subject(actor);
    if (!s.active || s.type === 'PLATFORM') return null;
    const grants = s.grants.filter((g) => g.permission === permission);
    if (!grants.length) return null;
    const unrestricted = grants.filter(
      (g) => g.allBranches && g.legalEntityIds.length === 0,
    );
    if (unrestricted.length) return {};
    const or: Record<string, unknown>[] = [];
    for (const g of grants) {
      const le = g.legalEntityIds.length
        ? { legalEntityId: { in: g.legalEntityIds } }
        : {};
      if (g.allBranches) or.push(le);
      if (g.branchIds.length) or.push({ branchId: { in: g.branchIds }, ...le });
      if (g.portfolioIds.length)
        or.push({ portfolioId: { in: g.portfolioIds }, ...le });
    }
    return or.length ? { OR: or } : null;
  }

  /** Which actions on this resource the actor may take, with reasons. For UI consistency only. */
  async capabilities(
    actor: LendingActor,
    resourceType: ResourceType,
    resource: Resource,
  ) {
    const out: Record<
      string,
      { allowed: boolean; blockedBy: { layer: string; message: string }[] }
    > = {};
    for (const a of actionsFor(resourceType)) {
      out[a.code] = publicExplanation(
        await this.decide(actor, a.code, resource),
      );
    }
    return out;
  }
}

function fullScopeGrant(permission: string, source: Grant['source']): Grant {
  return {
    permission,
    source,
    allBranches: true,
    branchIds: [],
    portfolioIds: [],
    legalEntityIds: [],
  };
}

function fxLookup(
  fx: Map<string, FxQuote>,
  from: string,
  to: string,
): FxQuote | null {
  const direct = fx.get(`${from}->${to}`);
  if (direct) return direct;
  const inverse = fx.get(`${to}->${from}`);
  if (inverse && Number(inverse.rate) !== 0) {
    // 1 / rate in decimal; 20 significant digits is ample for a limit check.
    return {
      rate: new lending.D(1)
        .div(inverse.rate)
        .toSignificantDigits(20)
        .toString(),
      asOf: inverse.asOf,
      source: `${inverse.source} (inverse)`,
    };
  }
  return null;
}

/** A policy whose stored rules fail validation denies every action it mentions. */
function brokenPolicyRules(raw: unknown): CompiledPolicy['rules'] {
  const actions = Array.isArray(raw)
    ? raw
        .flatMap((r) =>
          r && Array.isArray((r as { actions?: unknown }).actions)
            ? (r as { actions: string[] }).actions
            : [],
        )
        .filter((a) => typeof a === 'string')
    : [];
  if (!actions.length) return [];
  return [
    {
      id: 'invalid-policy',
      effect: 'DENY',
      actions,
      condition: { attr: 'environment.channel', op: 'exists' },
      message:
        'An access policy for this action is invalid; contact your administrator',
    },
  ];
}
