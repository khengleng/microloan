import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { BusinessDateService } from '../common/business-date.service';
import type { LendingActor } from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { ACTIONS } from '../policy/actions';
import { CUSTOMER_PERMISSIONS, ROLE_DEFINITIONS } from '../policy/catalogue';
import { evaluateFlag } from '../policy/flags';
import type { Grant, Subject } from '../policy/decision';

/** Permissions with at least one action that needs a multi-factor sign-in. */
export const MFA_GATED_PERMISSIONS = new Set(
  ACTIONS.filter((a) => a.minAssurance === 'MFA').map((a) => a.permission),
);

export interface ScopeSummary {
  /** Every branch, unrestricted by legal entity. */
  all: boolean;
  allBranches: boolean;
  branches: { id: string; name: string; code: string | null }[];
  portfolioIds: string[];
  legalEntities: { id: string; code: string; name: string }[];
}

/** Legacy JWT fields the access view reports alongside the lending grants. */
export interface StaffIdentity {
  email?: string;
  role?: string;
  permissions?: string[];
  tenantName?: string;
}

/**
 * "What can I do": the signed-in principal's effective lending access,
 * computed by the same `PolicyService.subject()` the decision engine uses,
 * so the workspace never re-derives a permission the API would refuse.
 *
 * This is for the user interface only. Every action is still decided on its
 * resource by `PolicyService.enforce` (scope, maker-checker, authority, MFA,
 * flags, product and workflow state).
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly businessDate: BusinessDateService,
  ) {}

  async access(actor: LendingActor, who: StaffIdentity = {}) {
    if (actor.type === 'PLATFORM') return this.platformAccess(actor, who);
    if (actor.type === 'CUSTOMER') return this.borrowerAccess(actor);
    const tenantId = actor.tenantId!;
    const subject = await this.policy.subject(actor);
    const ctx = await this.policy.context(tenantId);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const [user, tenant, assignments, delegations, given, businessDate] =
        await Promise.all([
          tx.user.findFirst({
            where: { id: actor.id, tenantId },
            select: {
              id: true,
              email: true,
              role: true,
              branchId: true,
              twoFactorEnabled: true,
            },
          }),
          tx.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, name: true },
          }),
          tx.roleAssignment.findMany({
            where: {
              tenantId,
              userId: actor.id,
              status: 'ACTIVE',
              revokedAt: null,
              validFrom: { lte: new Date() },
              OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
            },
            include: { role: { select: { code: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          }),
          tx.delegation.findMany({
            where: {
              tenantId,
              toUserId: actor.id,
              status: 'ACTIVE',
              revokedAt: null,
              validFrom: { lte: new Date() },
              validTo: { gt: new Date() },
            },
            orderBy: { validTo: 'asc' },
          }),
          tx.delegation.findMany({
            where: {
              tenantId,
              fromUserId: actor.id,
              status: 'ACTIVE',
              revokedAt: null,
              validTo: { gt: new Date() },
            },
            orderBy: { validTo: 'asc' },
          }),
          this.businessDate.get(tenantId, tx),
        ]);
      const people = await this.emails(tx, tenantId, [
        ...delegations.map((d) => d.fromUserId),
        ...given.map((d) => d.toUserId),
      ]);
      const permissions = [
        ...new Set(subject.grants.map((g) => g.permission)),
      ].sort();
      const scope = await this.scopeSummary(tx, tenantId, subject.grants);
      const mfaGated = permissions.filter((p) => MFA_GATED_PERMISSIONS.has(p));
      const flags = [...ctx.flags.catalogue.keys()].sort().map((key) => {
        const e = evaluateFlag(
          key,
          {
            branchId: user?.branchId ?? null,
            channel: actor.channel,
            cohorts: subject.cohorts,
          },
          ctx.flags,
        );
        return { key, enabled: e.enabled, source: e.source };
      });
      const branchName = user?.branchId
        ? (scope.branches.find((b) => b.id === user.branchId)?.name ??
          (
            await tx.branch.findFirst({
              where: { id: user.branchId, tenantId },
              select: { name: true },
            })
          )?.name ??
          null)
        : null;
      return {
        principal: {
          type: 'USER' as const,
          id: actor.id,
          email: user?.email ?? who.email ?? null,
          active: subject.active,
          branchId: user?.branchId ?? null,
          branchName,
        },
        tenant: { id: tenantId, name: tenant?.name ?? who.tenantName ?? '' },
        businessDate,
        hasLending: permissions.length > 0,
        roles: this.roles(subject, assignments),
        assignments: assignments.map((a) => ({
          id: a.id,
          roleCode: a.role.code,
          roleName: a.role.name,
          allBranches: a.allBranches,
          branchIds: a.branchIds,
          portfolioIds: a.portfolioIds,
          legalEntityIds: a.legalEntityIds,
          validTo: a.validTo,
        })),
        permissions,
        scope,
        authorities: subject.authorities.map((a) => ({
          permission: a.permission,
          currency: a.currency,
          maxAmount: a.maxAmount,
          familyCode: a.familyCode ?? null,
          source: a.source,
        })),
        delegations: {
          received: delegations.map((d) => ({
            id: d.id,
            fromUserId: d.fromUserId,
            fromEmail: people.get(d.fromUserId) ?? null,
            permissions: d.permissions,
            maxAmount: d.maxAmount?.toString() ?? null,
            currency: d.currency,
            validFrom: d.validFrom,
            validTo: d.validTo,
          })),
          given: given.map((d) => ({
            id: d.id,
            toUserId: d.toUserId,
            toEmail: people.get(d.toUserId) ?? null,
            permissions: d.permissions,
            maxAmount: d.maxAmount?.toString() ?? null,
            currency: d.currency,
            validFrom: d.validFrom,
            validTo: d.validTo,
          })),
        },
        assurance: {
          current: actor.assurance,
          mfaEnrolled: !!user?.twoFactorEnabled,
          mfaGatedPermissions: mfaGated,
          stepUpNeeded: mfaGated.length > 0 && actor.assurance !== 'MFA',
        },
        flags,
        legacy: {
          role: user?.role ?? actor.legacyRole ?? null,
          permissions: [...(who.permissions ?? [])].sort(),
        },
      };
    });
  }

  /** Union of the branches, portfolios and legal entities the grants reach. */
  async scopeSummary(
    tx: Tx,
    tenantId: string,
    grants: Grant[],
  ): Promise<ScopeSummary> {
    const all = grants.some(
      (g) => g.allBranches && g.legalEntityIds.length === 0,
    );
    const allBranches = grants.some((g) => g.allBranches);
    const branchIds = new Set(grants.flatMap((g) => g.branchIds));
    const portfolioIds = new Set(grants.flatMap((g) => g.portfolioIds));
    const legalEntityIds = new Set(grants.flatMap((g) => g.legalEntityIds));
    const [branches, entities] = await Promise.all([
      branchIds.size
        ? tx.branch.findMany({
            where: { tenantId, id: { in: [...branchIds] } },
            select: { id: true, name: true, code: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
      legalEntityIds.size
        ? tx.legalEntity.findMany({
            where: { tenantId, id: { in: [...legalEntityIds] } },
            select: { id: true, code: true, name: true },
            orderBy: { code: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    return {
      all,
      allBranches,
      branches,
      portfolioIds: [...portfolioIds].sort(),
      legalEntities: entities,
    };
  }

  private roles(
    subject: Subject,
    assignments: { role: { code: string; name: string } }[],
  ) {
    const named = new Map(assignments.map((a) => [a.role.code, a.role.name]));
    const sources = new Map<string, Set<string>>();
    for (const g of subject.grants) {
      if (g.source === 'DELEGATION') continue;
      const code = g.roleCode?.replace(/ \(legacy admin\)$/, '') ?? '';
      if (!code) continue;
      if (!sources.has(code)) sources.set(code, new Set());
      sources
        .get(code)!
        .add(g.source === 'BOOTSTRAP' ? 'LEGACY_ADMIN' : 'ASSIGNMENT');
    }
    for (const code of subject.roles)
      if (!sources.has(code)) sources.set(code, new Set(['ASSIGNMENT']));
    return [...sources.entries()].map(([code, src]) => {
      const def = ROLE_DEFINITIONS.find((r) => r.code === code);
      return {
        code,
        name: named.get(code) ?? def?.name ?? code,
        description: def?.description ?? '',
        sources: [...src].sort(),
      };
    });
  }

  private async emails(
    tx: Tx,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await tx.user.findMany({
      where: { tenantId, id: { in: [...new Set(ids)] } },
      select: { id: true, email: true },
    });
    return new Map(rows.map((r) => [r.id, r.email]));
  }

  private async platformAccess(actor: LendingActor, who: StaffIdentity) {
    const subject = await this.policy.subject(actor);
    const ctx = await this.policy.context(null);
    const user = await this.prisma.user.findFirst({
      where: { id: actor.id, tenantId: null },
      select: { email: true, twoFactorEnabled: true, role: true },
    });
    const permissions = [
      ...new Set(subject.grants.map((g) => g.permission)),
    ].sort();
    return {
      principal: {
        type: 'PLATFORM' as const,
        id: actor.id,
        email: user?.email ?? who.email ?? null,
        active: true,
        branchId: null,
        branchName: null,
      },
      tenant: null,
      businessDate: null,
      // Platform operators never see tenant loans; their lending permissions are catalogue-level only.
      hasLending: false,
      roles: [
        {
          code: 'PLATFORM_ADMIN',
          name: 'Platform operator',
          description:
            'Runs the platform across organisations. No access to tenant loans or money.',
          sources: ['PLATFORM'],
        },
      ],
      assignments: [],
      permissions,
      scope: {
        all: false,
        allBranches: false,
        branches: [],
        portfolioIds: [],
        legalEntities: [],
      } satisfies ScopeSummary,
      authorities: [],
      delegations: { received: [], given: [] },
      assurance: {
        current: actor.assurance,
        mfaEnrolled: !!user?.twoFactorEnabled,
        mfaGatedPermissions: [],
        stepUpNeeded: false,
      },
      flags: [...ctx.flags.catalogue.keys()].sort().map((key) => {
        const e = evaluateFlag(key, {}, ctx.flags);
        return { key, enabled: e.enabled, source: e.source };
      }),
      legacy: {
        role: user?.role ?? actor.legacyRole ?? 'SUPERADMIN',
        permissions: [...(who.permissions ?? [])].sort(),
      },
    };
  }

  /** A borrower in the portal: their own loans only, by one-time code. */
  private async borrowerAccess(actor: LendingActor) {
    const tenantId = actor.tenantId!;
    const ctx = await this.policy.context(tenantId);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const b = await tx.borrower.findFirst({
        where: { id: actor.id, tenantId },
        select: { id: true, firstName: true, branchId: true },
      });
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true },
      });
      return {
        principal: {
          type: 'CUSTOMER' as const,
          id: actor.id,
          firstName: b?.firstName ?? null,
        },
        tenant: { id: tenantId, name: tenant?.name ?? '' },
        permissions: [...CUSTOMER_PERMISSIONS].sort(),
        assurance: { current: actor.assurance },
        flags: ['lending.restructure.request'].map((key) => {
          const e = evaluateFlag(
            key,
            { branchId: b?.branchId ?? null, channel: actor.channel },
            ctx.flags,
          );
          return { key, enabled: e.enabled, source: e.source };
        }),
      };
    });
  }
}
