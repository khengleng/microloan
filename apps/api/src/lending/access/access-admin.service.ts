import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@microloan/db';
import { lending } from '@microloan/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  requireTenant,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import {
  PERMISSIONS,
  PERMISSION_CODES,
  ROLE_DEFINITIONS,
  isSensitiveRole,
} from '../policy/catalogue';
import { policyRulesSchema } from '../policy/abac';
import { evaluateFlag, SCOPE_SPECIFICITY } from '../policy/flags';
import { ACTION_BY_CODE } from '../policy/actions';
import { decide, Resource } from '../policy/decision';
import {
  tenantResource,
  applicationResource,
  loanAccountResource,
  productVersionResource,
  parseConfig,
} from '../policy/resources';
import { serviceKeyHash } from '../policy/lending-action.guard';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';

type Json = Prisma.InputJsonValue;

/** Maker-checker requests kept in the generic ApprovalTask table. */
export const SERVICE_ACCOUNT_SUBJECT = 'SERVICE_ACCOUNT';
export const SERVICE_ACCOUNT_ACTION = 'SERVICE_ACCOUNT_ISSUE';
export const COHORT_SUBJECT = 'COHORT';
export const COHORT_ACTION = 'COHORT_MEMBERSHIP';

/**
 * Access governance for lending: roles, scoped assignments, delegations,
 * approval authorities, ABAC policies, feature flags, cohorts and service
 * accounts. Every change that widens access needs a second person (maker ≠
 * checker), and every change bumps the tenant's authzVersion so cached
 * subjects and contexts are discarded on the next request.
 */
@Injectable()
export class AccessAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly settings: TenantSettingsService,
  ) {}

  private access(
    tenantId: string | null,
    makers: string[] = [],
    id = 'access',
  ) {
    return tenantResource(tenantId, 'ACCESS', id, makers);
  }

  // ── Roles ─────────────────────────────────────────────────────────────────

  /** Provision the system roles for a tenant. Idempotent; safe on every boot. */
  async ensureSystemRoles(tenantId: string, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma;
    for (const def of ROLE_DEFINITIONS) {
      const role = await db.accessRole.upsert({
        where: { tenantId_code: { tenantId, code: def.code } },
        create: {
          tenantId,
          code: def.code,
          name: def.name,
          description: def.description,
          isSystem: true,
        },
        update: {
          name: def.name,
          description: def.description,
          isSystem: true,
        },
      });
      // System role permissions follow the release, so they are re-synchronised here.
      await db.rolePermission.deleteMany({
        where: { roleId: role.id, permissionCode: { notIn: def.permissions } },
      });
      await db.rolePermission.createMany({
        data: def.permissions.map((p) => ({
          roleId: role.id,
          permissionCode: p,
        })),
        skipDuplicates: true,
      });
    }
  }

  async overview(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'access_policy.read',
      this.access(tenantId),
    );
    await this.ensureSystemRoles(tenantId);
    const [
      roles,
      assignments,
      delegations,
      authorities,
      users,
      policies,
      branches,
      portfolios,
    ] = await Promise.all([
      this.prisma.accessRole.findMany({
        where: { tenantId },
        include: { permissions: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.roleAssignment.findMany({
        where: { tenantId },
        include: { role: { select: { code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.delegation.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.approvalAuthority.findMany({
        where: { tenantId },
        include: { role: { select: { code: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          email: true,
          role: true,
          branchId: true,
          isActive: true,
        },
      }),
      this.prisma.accessPolicy.findMany({
        where: { tenantId },
        include: { versions: { orderBy: { version: 'desc' } } },
      }),
      this.prisma.branch.findMany({
        where: { tenantId },
        select: { id: true, name: true, code: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.portfolio.findMany({
        where: { tenantId },
        select: {
          id: true,
          code: true,
          name: true,
          branchId: true,
          isActive: true,
        },
        orderBy: { code: 'asc' },
      }),
    ]);
    return {
      permissions: PERMISSIONS,
      roles: roles.map((r) => ({
        ...r,
        permissions: r.permissions.map((p) => p.permissionCode),
        sensitive: isSensitiveRole(r.permissions.map((p) => p.permissionCode)),
      })),
      assignments,
      delegations,
      authorities: authorities.map((a) => ({
        ...a,
        maxAmount: a.maxAmount.toString(),
      })),
      users,
      policies,
      /** Pickers for assignment scope; branch ids are never typed by hand. */
      branches,
      portfolios,
      /** The lender's limits the forms check before the API does. */
      limits: {
        maxDelegationDays: (await this.settings.get(tenantId)).access
          .maxDelegationDays,
      },
    };
  }

  // ── Branches ──────────────────────────────────────────────────────────────

  /**
   * The organisation's branches. Creating or renaming one widens nobody's
   * access by itself (scope is granted by approved assignments), so it needs
   * access_policy.manage but no second person; every change is audited.
   */
  async branches(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'access_policy.read',
      this.access(tenantId),
    );
    const rows = await this.prisma.branch.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ _count, ...b }) => ({ ...b, users: _count.users }));
  }

  async createBranch(
    actor: LendingActor,
    body: { name: string; code?: string },
  ) {
    const tenantId = requireTenant(actor);
    const name = (body.name ?? '').trim();
    const code = body.code?.trim().toUpperCase() || null;
    if (name.length < 2)
      throw new BadRequestException('A branch needs a name.');
    if (code && !/^[A-Z0-9_-]{2,12}$/.test(code))
      throw new BadRequestException(
        'Branch code must be 2–12 of A–Z, 0–9, - or _.',
      );
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'access_policy.manage',
        this.access(tenantId),
        tx,
      );
      await this.uniqueBranch(tx, tenantId, name, code, null);
      const b = await tx.branch.create({
        data: { tenantId, name: name.slice(0, 80), code },
        select: { id: true, name: true, code: true, isActive: true },
      });
      await this.audit.write(
        {
          actor,
          action: 'access_policy.branch_create',
          resourceType: 'Branch',
          resourceId: b.id,
          outcome: 'SUCCESS',
          details: { name: b.name, code: b.code },
        },
        tx,
      );
      return b;
    });
  }

  async updateBranch(
    actor: LendingActor,
    id: string,
    body: { name?: string; code?: string | null; isActive?: boolean },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'access_policy.manage',
        this.access(tenantId, [], id),
        tx,
      );
      const before = await tx.branch.findFirst({ where: { id, tenantId } });
      if (!before) throw new NotFoundException('Branch not found');
      const name = body.name === undefined ? before.name : body.name.trim();
      const code =
        body.code === undefined
          ? before.code
          : body.code?.trim().toUpperCase() || null;
      if (name.length < 2)
        throw new BadRequestException('A branch needs a name.');
      if (code && !/^[A-Z0-9_-]{2,12}$/.test(code))
        throw new BadRequestException(
          'Branch code must be 2–12 of A–Z, 0–9, - or _.',
        );
      await this.uniqueBranch(tx, tenantId, name, code, id);
      const res = await tx.branch.updateMany({
        where: { id, tenantId, updatedAt: before.updatedAt },
        data: {
          name: name.slice(0, 80),
          code,
          ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        },
      });
      if (res.count !== 1) throw concurrentModification('This branch');
      await this.audit.write(
        {
          actor,
          action: 'access_policy.branch_update',
          resourceType: 'Branch',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            before: {
              name: before.name,
              code: before.code,
              isActive: before.isActive,
            },
            after: { name, code, isActive: body.isActive ?? before.isActive },
          },
        },
        tx,
      );
      return tx.branch.findFirst({
        where: { id, tenantId },
        select: { id: true, name: true, code: true, isActive: true },
      });
    });
  }

  private async uniqueBranch(
    tx: Tx,
    tenantId: string,
    name: string,
    code: string | null,
    except: string | null,
  ) {
    const clash = await tx.branch.findFirst({
      where: {
        tenantId,
        ...(except ? { id: { not: except } } : {}),
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          ...(code ? [{ code }] : []),
        ],
      },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(
        'Another branch already has that name or code.',
      );
  }

  async createRole(
    actor: LendingActor,
    body: {
      code: string;
      name: string;
      description?: string;
      permissions: string[];
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'access_policy.manage',
        this.access(tenantId),
        tx,
      );
      if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(body.code ?? ''))
        throw new BadRequestException('Role code must be A–Z, 0–9 or _.');
      if (ROLE_DEFINITIONS.some((r) => r.code === body.code))
        throw new ConflictException('That code is reserved for a system role.');
      const unknown = (body.permissions ?? []).filter(
        (p) => !PERMISSION_CODES.has(p),
      );
      if (unknown.length || !body.permissions?.length)
        throw new BadRequestException(
          `Unknown or missing permissions: ${unknown.join(', ')}`,
        );
      // Roles are immutable once created: widening a role that is already assigned would bypass assignment approval.
      const role = await tx.accessRole.create({
        data: {
          tenantId,
          code: body.code,
          name: body.name.slice(0, 80),
          description: (body.description ?? '').slice(0, 300),
          permissions: {
            create: body.permissions.map((p) => ({ permissionCode: p })),
          },
        },
      });
      await this.policy.bumpVersion(tenantId, tx);
      await this.audit.write(
        {
          actor,
          action: 'access_policy.role_create',
          resourceType: 'AccessRole',
          resourceId: role.id,
          outcome: 'SUCCESS',
          details: { code: body.code, permissions: body.permissions },
        },
        tx,
      );
      return role;
    });
  }

  // ── Role assignments ──────────────────────────────────────────────────────

  async requestAssignment(
    actor: LendingActor,
    body: {
      userId: string;
      roleId: string;
      allBranches?: boolean;
      branchIds?: string[];
      portfolioIds?: string[];
      legalEntityIds?: string[];
      validTo?: string;
      reason?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'access_policy.manage',
        this.access(tenantId),
        tx,
      );
      const user = await tx.user.findFirst({
        where: { id: body.userId, tenantId },
      });
      if (!user) throw new NotFoundException('User not found');
      const role = await tx.accessRole.findFirst({
        where: { id: body.roleId, tenantId },
        include: { permissions: true },
      });
      if (!role) throw new NotFoundException('Role not found');
      const branchIds = body.branchIds ?? [];
      const portfolioIds = body.portfolioIds ?? [];
      const legalEntityIds = body.legalEntityIds ?? [];
      if (
        (await tx.branch.count({
          where: { tenantId, id: { in: branchIds } },
        })) !== branchIds.length
      )
        throw new BadRequestException('Unknown branch in scope.');
      if (
        (await tx.portfolio.count({
          where: { tenantId, id: { in: portfolioIds } },
        })) !== portfolioIds.length
      )
        throw new BadRequestException('Unknown portfolio in scope.');
      if (
        (await tx.legalEntity.count({
          where: { tenantId, id: { in: legalEntityIds } },
        })) !== legalEntityIds.length
      )
        throw new BadRequestException('Unknown legal entity in scope.');
      const sensitive = isSensitiveRole(
        role.permissions.map((p) => p.permissionCode),
      );
      const a = await tx.roleAssignment.create({
        data: {
          tenantId,
          userId: user.id,
          roleId: role.id,
          allBranches: !!body.allBranches,
          branchIds,
          portfolioIds,
          legalEntityIds,
          validTo: body.validTo ? new Date(body.validTo) : null,
          status: sensitive ? 'PENDING' : 'ACTIVE',
          requestedBy: actor.id,
          reason: (body.reason ?? '').slice(0, 300),
        },
      });
      if (!sensitive) await this.policy.bumpVersion(tenantId, tx);
      await this.audit.write(
        {
          actor,
          action: 'access_policy.assignment_request',
          resourceType: 'RoleAssignment',
          resourceId: a.id,
          outcome: 'SUCCESS',
          details: {
            user: user.id,
            role: role.code,
            sensitive,
            status: a.status,
          },
        },
        tx,
      );
      return a;
    });
  }

  async decideAssignment(actor: LendingActor, id: string, approve: boolean) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const a = await tx.roleAssignment.findFirst({ where: { id, tenantId } });
      if (!a) throw new NotFoundException('Assignment not found');
      // Neither the requester nor the person receiving the role may approve it.
      await this.policy.enforce(
        actor,
        'access_policy.approve',
        this.access(tenantId, [a.requestedBy, a.userId], id),
        tx,
      );
      const res = await tx.roleAssignment.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: { status: approve ? 'ACTIVE' : 'REJECTED', approvedBy: actor.id },
      });
      if (res.count !== 1) throw concurrentModification('This assignment');
      await this.policy.bumpVersion(tenantId, tx);
      await this.audit.write(
        {
          actor,
          action: 'access_policy.assignment_decide',
          resourceType: 'RoleAssignment',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { approve },
        },
        tx,
      );
      return tx.roleAssignment.findFirst({ where: { id, tenantId } });
    });
  }

  /** Revocation takes effect on the next request: the version bump invalidates cached subjects. */
  async revokeAssignment(actor: LendingActor, id: string, reason: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'access_policy.manage',
        this.access(tenantId),
        tx,
      );
      const res = await tx.roleAssignment.updateMany({
        where: { id, tenantId, status: { in: ['ACTIVE', 'PENDING'] } },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedBy: actor.id,
          reason: (reason ?? '').slice(0, 300),
        },
      });
      if (res.count !== 1)
        throw new NotFoundException('Active assignment not found');
      await this.policy.bumpVersion(tenantId, tx);
      await this.audit.write(
        {
          actor,
          action: 'access_policy.assignment_revoke',
          resourceType: 'RoleAssignment',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { reason },
        },
        tx,
      );
      return { revoked: true };
    });
  }

  // ── Delegations ───────────────────────────────────────────────────────────

  async requestDelegation(
    actor: LendingActor,
    body: {
      toUserId: string;
      permissions: string[];
      validFrom: string;
      validTo: string;
      maxAmount?: string;
      currency?: string;
      reason: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const from = new Date(body.validFrom);
      const to = new Date(body.validTo);
      // The lender's limit (lending settings access.maxDelegationDays, default 30).
      const maxDays = (await this.settings.get(tenantId, tx)).access
        .maxDelegationDays;
      if (!(to > from) || to.getTime() - from.getTime() > maxDays * 86_400_000)
        throw new BadRequestException(
          `A delegation must end after it starts and last at most ${maxDays} days.`,
        );
      if (body.toUserId === actor.id)
        throw new BadRequestException('You cannot delegate to yourself.');
      if (
        !(await tx.user.findFirst({
          where: { id: body.toUserId, tenantId, isActive: true },
        }))
      )
        throw new NotFoundException('Delegate not found');
      const subject = await this.policy.subject(actor, tx);
      const held = new Set(
        subject.grants
          .filter((g) => g.source === 'ROLE')
          .map((g) => g.permission),
      );
      const missing = (body.permissions ?? []).filter((p) => !held.has(p));
      if (!body.permissions?.length || missing.length)
        throw new BadRequestException(
          `You can only delegate permissions you hold through a role: ${missing.join(', ')}`,
        );
      if (body.maxAmount && !body.currency)
        throw new BadRequestException('A delegated amount needs a currency.');
      const d = await tx.delegation.create({
        data: {
          tenantId,
          fromUserId: actor.id,
          toUserId: body.toUserId,
          permissions: body.permissions,
          validFrom: from,
          validTo: to,
          maxAmount: body.maxAmount ?? null,
          currency: body.currency ?? null,
          reason: (body.reason ?? '').slice(0, 300),
          createdBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'access_policy.delegation_request',
          resourceType: 'Delegation',
          resourceId: d.id,
          outcome: 'SUCCESS',
          details: { to: body.toUserId, permissions: body.permissions },
        },
        tx,
      );
      return d;
    });
  }

  async decideDelegation(actor: LendingActor, id: string, approve: boolean) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const d = await tx.delegation.findFirst({ where: { id, tenantId } });
      if (!d) throw new NotFoundException('Delegation not found');
      await this.policy.enforce(
        actor,
        'access_policy.approve',
        this.access(tenantId, [d.fromUserId, d.toUserId, d.createdBy], id),
        tx,
      );
      const res = await tx.delegation.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: { status: approve ? 'ACTIVE' : 'REJECTED', approvedBy: actor.id },
      });
      if (res.count !== 1) throw concurrentModification('This delegation');
      await this.policy.bumpVersion(tenantId, tx);
      await this.audit.write(
        {
          actor,
          action: 'access_policy.delegation_decide',
          resourceType: 'Delegation',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { approve },
        },
        tx,
      );
      return tx.delegation.findFirst({ where: { id, tenantId } });
    });
  }

  async revokeDelegation(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const d = await tx.delegation.findFirst({ where: { id, tenantId } });
      if (!d) throw new NotFoundException('Delegation not found');
      if (d.fromUserId !== actor.id)
        await this.policy.enforce(
          actor,
          'access_policy.manage',
          this.access(tenantId),
          tx,
        );
      await tx.delegation.updateMany({
        where: { id, tenantId, status: { in: ['PENDING', 'ACTIVE'] } },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await this.policy.bumpVersion(tenantId, tx);
      await this.audit.write(
        {
          actor,
          action: 'access_policy.delegation_revoke',
          resourceType: 'Delegation',
          resourceId: id,
          outcome: 'SUCCESS',
        },
        tx,
      );
      return { revoked: true };
    });
  }

  // ── Approval authorities ──────────────────────────────────────────────────

  async requestAuthority(
    actor: LendingActor,
    body: {
      roleId?: string;
      userId?: string;
      permission: string;
      currency: string;
      maxAmount: string;
      familyCode?: string;
      validTo?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'access_policy.manage',
        this.access(tenantId),
        tx,
      );
      if (!!body.roleId === !!body.userId)
        throw new BadRequestException(
          'Give the authority to exactly one role or one user.',
        );
      if (
        !ACTION_BY_CODE[body.permission]?.approvalAuthority &&
        !Object.values(ACTION_BY_CODE).some(
          (a) => a.permission === body.permission && a.approvalAuthority,
        )
      ) {
        throw new BadRequestException(
          'That permission does not use approval authority.',
        );
      }
      lending.getCurrency(body.currency);
      const max = lending.parseMoney(
        body.maxAmount,
        body.currency,
        'maxAmount',
      );
      if (
        body.roleId &&
        !(await tx.accessRole.findFirst({
          where: { id: body.roleId, tenantId },
        }))
      )
        throw new NotFoundException('Role not found');
      if (
        body.userId &&
        !(await tx.user.findFirst({ where: { id: body.userId, tenantId } }))
      )
        throw new NotFoundException('User not found');
      const a = await tx.approvalAuthority.create({
        data: {
          tenantId,
          roleId: body.roleId,
          userId: body.userId,
          permission: body.permission,
          currency: body.currency,
          maxAmount: max.toString(),
          familyCode: body.familyCode,
          validTo: body.validTo ? new Date(body.validTo) : null,
          requestedBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'access_policy.authority_request',
          resourceType: 'ApprovalAuthority',
          resourceId: a.id,
          outcome: 'SUCCESS',
          details: {
            permission: body.permission,
            currency: body.currency,
            maxAmount: max.toString(),
          },
        },
        tx,
      );
      return a;
    });
  }

  async decideAuthority(actor: LendingActor, id: string, approve: boolean) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const a = await tx.approvalAuthority.findFirst({
        where: { id, tenantId },
      });
      if (!a) throw new NotFoundException('Authority not found');
      await this.policy.enforce(
        actor,
        'access_policy.approve',
        this.access(
          tenantId,
          [a.requestedBy, ...(a.userId ? [a.userId] : [])],
          id,
        ),
        tx,
      );
      const res = await tx.approvalAuthority.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: { status: approve ? 'ACTIVE' : 'REJECTED', approvedBy: actor.id },
      });
      if (res.count !== 1)
        throw concurrentModification('This approval authority');
      await this.policy.bumpVersion(tenantId, tx);
      await this.audit.write(
        {
          actor,
          action: 'access_policy.authority_decide',
          resourceType: 'ApprovalAuthority',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { approve },
        },
        tx,
      );
      return tx.approvalAuthority.findFirst({ where: { id, tenantId } });
    });
  }

  // ── ABAC policies ─────────────────────────────────────────────────────────

  async draftPolicy(
    actor: LendingActor,
    body: { code: string; name: string; description?: string; rules: unknown },
  ) {
    const tenantId = requireTenant(actor);
    const parsed = policyRulesSchema.safeParse(body.rules);
    if (!parsed.success)
      throw new BadRequestException({
        message: 'Policy rules are invalid.',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    for (const r of parsed.data)
      for (const a of r.actions)
        if (!a.endsWith('.*') && !ACTION_BY_CODE[a])
          throw new BadRequestException(`Unknown action ${a}`);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'access_policy.manage',
        this.access(tenantId),
        tx,
      );
      if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(body.code ?? ''))
        throw new BadRequestException('Policy code must be A–Z, 0–9 or _.');
      const policy = await tx.accessPolicy.upsert({
        where: { tenantId_code: { tenantId, code: body.code } },
        create: {
          tenantId,
          code: body.code,
          name: body.name.slice(0, 80),
          description: (body.description ?? '').slice(0, 500),
        },
        update: {},
      });
      const last = await tx.policyVersion.findFirst({
        where: { policyId: policy.id },
        orderBy: { version: 'desc' },
      });
      if (last && last.status === 'SUBMITTED')
        throw new ConflictException(
          'A version of this policy is already awaiting approval.',
        );
      const v = await tx.policyVersion.create({
        data: {
          tenantId,
          policyId: policy.id,
          version: (last?.version ?? 0) + 1,
          rules: parsed.data as unknown as Json,
          status: 'SUBMITTED',
          makerId: actor.id,
          submittedAt: new Date(),
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'access_policy.policy_submit',
          resourceType: 'PolicyVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: { code: body.code, version: v.version, rules: parsed.data },
        },
        tx,
      );
      return v;
    });
  }

  async decidePolicy(
    actor: LendingActor,
    versionId: string,
    approve: boolean,
    reason?: string,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const v = await tx.policyVersion.findFirst({
        where: { id: versionId, tenantId },
      });
      if (!v) throw new NotFoundException('Policy version not found');
      await this.policy.enforce(
        actor,
        'access_policy.approve',
        this.access(tenantId, [v.makerId], versionId),
        tx,
      );
      if (approve)
        await tx.policyVersion.updateMany({
          where: { tenantId, policyId: v.policyId, status: 'ACTIVE' },
          data: { status: 'RETIRED' },
        });
      const res = await tx.policyVersion.updateMany({
        where: { id: versionId, tenantId, status: 'SUBMITTED' },
        data: {
          status: approve ? 'ACTIVE' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
          rejectionReason: approve ? null : (reason ?? '').slice(0, 300),
        },
      });
      if (res.count !== 1) throw concurrentModification('This policy version');
      await this.policy.bumpVersion(tenantId, tx);
      await this.audit.write(
        {
          actor,
          action: 'access_policy.policy_decide',
          resourceType: 'PolicyVersion',
          resourceId: versionId,
          outcome: 'SUCCESS',
          details: { approve, reason },
        },
        tx,
      );
      return tx.policyVersion.findFirst({ where: { id: versionId, tenantId } });
    });
  }

  // ── Feature flags ─────────────────────────────────────────────────────────

  async flags(
    actor: LendingActor,
    ctx: {
      productCode?: string;
      branchId?: string;
      channel?: string;
      segment?: string;
      cohort?: string;
    },
  ) {
    const tenantId = actor.tenantId;
    await this.policy.enforce(
      actor,
      'feature_flag.read',
      tenantResource(tenantId, 'FLAG', 'flags'),
    );
    const context = await this.policy.context(tenantId);
    const [flags, tenantRules, platformRules, approvals] = await Promise.all([
      this.prisma.featureFlag.findMany({
        orderBy: [{ category: 'asc' }, { key: 'asc' }],
      }),
      tenantId
        ? this.prisma.flagRule.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      this.prisma.platformFlagRule.findMany({ orderBy: { createdAt: 'desc' } }),
      tenantId
        ? this.prisma.flagChangeApproval.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 100,
          })
        : Promise.resolve([]),
    ]);
    const evalCtx = {
      productCode: ctx.productCode,
      branchId: ctx.branchId,
      channel: ctx.channel ?? 'STAFF_PORTAL',
      segment: ctx.segment,
      cohorts: ctx.cohort ? [ctx.cohort] : [],
    };
    return {
      precedence: [
        'UNKNOWN_FLAG → off',
        'PLATFORM_EMERGENCY',
        'TENANT_EMERGENCY',
        ...Object.entries(SCOPE_SPECIFICITY)
          .sort((a, b) => b[1] - a[1])
          .map(([s]) => `TENANT_RULE:${s}`),
        'PLATFORM_RULE',
        'DEFAULT',
      ],
      flags: flags.map((f) => ({
        ...f,
        evaluation: evaluateFlag(f.key, evalCtx, context.flags),
      })),
      tenantRules,
      platformRules,
      approvals,
    };
  }

  async proposeFlagRule(
    actor: LendingActor,
    body: {
      flagKey: string;
      scopeType: string;
      scopeValue?: string;
      enabled: boolean;
      emergency?: boolean;
      priority?: number;
      effectiveFrom?: string;
      effectiveTo?: string;
      reason: string;
    },
  ) {
    if (!body.reason?.trim())
      throw new BadRequestException('A reason is required.');
    const flag = await this.prisma.featureFlag.findUnique({
      where: { key: body.flagKey },
    });
    if (!flag) throw new NotFoundException('Unknown flag');
    if (actor.type === 'PLATFORM') {
      await this.policy.enforce(
        actor,
        'feature_flag.manage',
        tenantResource(null, 'FLAG', body.flagKey),
      );
      if (body.scopeType !== 'PLATFORM')
        throw new BadRequestException('Platform rules use scope PLATFORM.');
      const rule = await this.prisma.platformFlagRule.create({
        data: {
          flagKey: body.flagKey,
          enabled: body.enabled,
          emergency: !!body.emergency,
          effectiveFrom: body.effectiveFrom
            ? new Date(body.effectiveFrom)
            : new Date(),
          effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
          reason: body.reason.slice(0, 300),
          makerId: actor.id,
        },
      });
      await this.audit.write({
        actor,
        action: 'feature_flag.manage',
        resourceType: 'PlatformFlagRule',
        resourceId: rule.id,
        outcome: 'SUCCESS',
        details: body,
      });
      return rule;
    }
    const tenantId = requireTenant(actor);
    if (!(body.scopeType in SCOPE_SPECIFICITY))
      throw new BadRequestException(
        `Scope must be one of ${Object.keys(SCOPE_SPECIFICITY).join(', ')}.`,
      );
    if (body.scopeType !== 'TENANT' && !body.scopeValue)
      throw new BadRequestException('Scoped rules need a scope value.');
    if (body.emergency && (body.enabled || body.scopeType !== 'TENANT'))
      throw new BadRequestException(
        'Emergency rules switch a flag off for the whole tenant.',
      );
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'feature_flag.manage',
        tenantResource(tenantId, 'FLAG', body.flagKey),
        tx,
      );
      // A rule may only target this tenant's own branches and products.
      if (body.scopeType === 'BRANCH' && body.scopeValue) {
        if (
          !(await tx.branch.findFirst({
            where: { id: body.scopeValue, tenantId },
          }))
        )
          throw new NotFoundException('Branch not found');
      }
      if (body.scopeType === 'PRODUCT' && body.scopeValue) {
        if (
          !(await tx.lendingProduct.findFirst({
            where: { code: body.scopeValue, tenantId },
          }))
        )
          throw new NotFoundException('Product not found');
      }
      const rule = await tx.flagRule.create({
        data: {
          tenantId,
          flagKey: body.flagKey,
          scopeType: body.scopeType,
          scopeValue: body.scopeType === 'TENANT' ? null : body.scopeValue,
          enabled: body.enabled,
          emergency: !!body.emergency,
          priority: body.priority ?? 100,
          effectiveFrom: body.effectiveFrom
            ? new Date(body.effectiveFrom)
            : new Date(),
          effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
        },
      });
      const approval = await tx.flagChangeApproval.create({
        data: {
          tenantId,
          ruleId: rule.id,
          action: 'ACTIVATE',
          reason: body.reason.slice(0, 300),
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'feature_flag.manage',
          resourceType: 'FlagRule',
          resourceId: rule.id,
          outcome: 'SUCCESS',
          details: body,
        },
        tx,
      );
      return { rule, approval };
    });
  }

  async proposeFlagRuleRemoval(
    actor: LendingActor,
    ruleId: string,
    reason: string,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'feature_flag.manage',
        tenantResource(tenantId, 'FLAG', ruleId),
        tx,
      );
      const rule = await tx.flagRule.findFirst({
        where: { id: ruleId, tenantId, status: 'ACTIVE' },
      });
      if (!rule) throw new NotFoundException('Active rule not found');
      return tx.flagChangeApproval.create({
        data: {
          tenantId,
          ruleId,
          action: 'DEACTIVATE',
          reason: (reason ?? '').slice(0, 300),
          makerId: actor.id,
        },
      });
    });
  }

  async decideFlagChange(
    actor: LendingActor,
    approvalId: string,
    approve: boolean,
  ) {
    if (actor.type === 'PLATFORM') {
      const rule = await this.prisma.platformFlagRule.findUnique({
        where: { id: approvalId },
      });
      if (!rule) throw new NotFoundException('Platform rule not found');
      await this.policy.enforce(
        actor,
        'feature_flag.approve',
        tenantResource(null, 'FLAG', rule.id, [rule.makerId]),
      );
      if (approve)
        await this.prisma.platformFlagRule.updateMany({
          where: {
            flagKey: rule.flagKey,
            status: 'ACTIVE',
            emergency: rule.emergency,
          },
          data: { status: 'SUPERSEDED' },
        });
      const res = await this.prisma.platformFlagRule.updateMany({
        where: { id: rule.id, status: 'PENDING_APPROVAL' },
        data: {
          status: approve ? 'ACTIVE' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
        },
      });
      if (res.count !== 1) throw concurrentModification('This platform rule');
      await this.policy.invalidateAll();
      await this.audit.write({
        actor,
        action: 'feature_flag.approve',
        resourceType: 'PlatformFlagRule',
        resourceId: rule.id,
        outcome: 'SUCCESS',
        details: { approve },
      });
      return { approved: approve };
    }
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const approval = await tx.flagChangeApproval.findFirst({
        where: { id: approvalId, tenantId },
        include: { rule: true },
      });
      if (!approval) throw new NotFoundException('Flag change not found');
      await this.policy.enforce(
        actor,
        'feature_flag.approve',
        tenantResource(tenantId, 'FLAG', approval.id, [approval.makerId]),
        tx,
      );
      const res = await tx.flagChangeApproval.updateMany({
        where: { id: approvalId, tenantId, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
        },
      });
      if (res.count !== 1) throw concurrentModification('This flag change');
      if (approve) {
        await tx.flagRule.update({
          where: { id: approval.ruleId },
          data: {
            status: approval.action === 'ACTIVATE' ? 'ACTIVE' : 'SUPERSEDED',
          },
        });
      } else if (approval.action === 'ACTIVATE') {
        await tx.flagRule.update({
          where: { id: approval.ruleId },
          data: { status: 'REJECTED' },
        });
      }
      await this.policy.bumpVersion(tenantId, tx);
      await this.audit.write(
        {
          actor,
          action: 'feature_flag.approve',
          resourceType: 'FlagRule',
          resourceId: approval.ruleId,
          outcome: 'SUCCESS',
          details: { approve, change: approval.action },
        },
        tx,
      );
      return { approved: approve };
    });
  }

  // ── Cohorts ───────────────────────────────────────────────────────────────

  /**
   * Cohort membership changes who a pilot flag applies to, so it is
   * maker-checker controlled like the flag rules themselves: one person
   * proposes the change (feature_flag.manage), a second person approves it
   * (feature_flag.approve), and only then is it applied.
   */
  async proposeCohortChange(
    actor: LendingActor,
    body: {
      cohortCode: string;
      subjectType: 'BRANCH' | 'USER' | 'BORROWER';
      subjectId: string;
      member: boolean;
      reason?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    if (!/^[A-Z0-9_]{2,40}$/.test(body.cohortCode ?? ''))
      throw new BadRequestException('Invalid cohort code.');
    if (!['BRANCH', 'USER', 'BORROWER'].includes(body.subjectType))
      throw new BadRequestException('Invalid subject type.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'feature_flag.manage',
        tenantResource(tenantId, 'FLAG', body.cohortCode),
        tx,
      );
      await this.cohortSubject(tx, tenantId, body.subjectType, body.subjectId);
      const open = await tx.approvalTask.findMany({
        where: {
          tenantId,
          subjectType: COHORT_SUBJECT,
          subjectId: body.cohortCode,
          status: 'PENDING',
        },
      });
      if (
        open.some((t) => {
          const p = t.payload as { subjectType?: string; subjectId?: string };
          return (
            p.subjectType === body.subjectType && p.subjectId === body.subjectId
          );
        })
      )
        throw new ConflictException(
          'A change for this cohort member is already awaiting approval.',
        );
      const payload = {
        cohortCode: body.cohortCode,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        member: !!body.member,
      };
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: COHORT_SUBJECT,
          subjectId: body.cohortCode,
          action: COHORT_ACTION,
          requiredPermission: 'feature_flag.approve',
          payload: payload as Json,
          makerId: actor.id,
          comment: (body.reason ?? '').slice(0, 300) || null,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'feature_flag.cohort_request',
          resourceType: 'Cohort',
          resourceId: body.cohortCode,
          outcome: 'SUCCESS',
          details: { ...payload, taskId: task.id },
        },
        tx,
      );
      return this.cohortChangeView(task);
    });
  }

  /** A second person applies or refuses a proposed cohort change. */
  async decideCohortChange(
    actor: LendingActor,
    taskId: string,
    approve: boolean,
    comment?: string,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectType: COHORT_SUBJECT },
      });
      if (!task) throw new NotFoundException('Cohort change not found');
      const p = task.payload as {
        cohortCode: string;
        subjectType: 'BRANCH' | 'USER' | 'BORROWER';
        subjectId: string;
        member: boolean;
      };
      // Neither the proposer nor a user being placed in the cohort may approve it.
      await this.policy.enforce(
        actor,
        'feature_flag.approve',
        tenantResource(tenantId, 'FLAG', task.id, [
          task.makerId,
          ...(p.subjectType === 'USER' ? [p.subjectId] : []),
        ]),
        tx,
      );
      const res = await tx.approvalTask.updateMany({
        where: { id: taskId, tenantId, status: 'PENDING' },
        data: {
          status: approve ? 'EXECUTED' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          ...(comment ? { comment: comment.slice(0, 300) } : {}),
        },
      });
      if (res.count !== 1) throw concurrentModification('This cohort change');
      if (approve) {
        await this.cohortSubject(tx, tenantId, p.subjectType, p.subjectId);
        const key = {
          tenantId,
          cohortCode: p.cohortCode,
          subjectType: p.subjectType,
          subjectId: p.subjectId,
        };
        if (p.member)
          await tx.cohortMembership.upsert({
            where: { tenantId_cohortCode_subjectType_subjectId: key },
            create: { ...key, addedBy: task.makerId },
            update: {},
          });
        else await tx.cohortMembership.deleteMany({ where: key });
        await this.policy.bumpVersion(tenantId, tx);
      }
      await this.audit.write(
        {
          actor,
          action: 'feature_flag.cohort',
          resourceType: 'Cohort',
          resourceId: p.cohortCode,
          outcome: 'SUCCESS',
          details: { ...p, approve, taskId, maker: task.makerId },
        },
        tx,
      );
      return tx.cohortMembership.findMany({
        where: { tenantId, cohortCode: p.cohortCode },
      });
    });
  }

  /** Cohort members and the changes proposed to them. */
  async cohorts(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'feature_flag.read',
      tenantResource(tenantId, 'FLAG', 'cohorts'),
    );
    const [members, changes] = await Promise.all([
      this.prisma.cohortMembership.findMany({
        where: { tenantId },
        orderBy: [{ cohortCode: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.approvalTask.findMany({
        where: { tenantId, subjectType: COHORT_SUBJECT },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return { members, changes: changes.map((t) => this.cohortChangeView(t)) };
  }

  private cohortChangeView(t: {
    id: string;
    status: string;
    payload: unknown;
    makerId: string;
    decidedBy: string | null;
    decidedAt: Date | null;
    comment: string | null;
    createdAt: Date;
  }) {
    return {
      id: t.id,
      status: t.status,
      ...(t.payload as {
        cohortCode: string;
        subjectType: string;
        subjectId: string;
        member: boolean;
      }),
      makerId: t.makerId,
      decidedBy: t.decidedBy,
      decidedAt: t.decidedAt,
      reason: t.comment,
      createdAt: t.createdAt,
    };
  }

  /** The subject must be one of this tenant's own branches, users or borrowers. */
  private async cohortSubject(
    tx: Tx,
    tenantId: string,
    type: 'BRANCH' | 'USER' | 'BORROWER',
    id: string,
  ) {
    const where = { id, tenantId };
    const subject =
      type === 'BRANCH'
        ? await tx.branch.findFirst({ where, select: { id: true } })
        : type === 'USER'
          ? await tx.user.findFirst({ where, select: { id: true } })
          : await tx.borrower.findFirst({ where, select: { id: true } });
    if (!subject)
      throw new NotFoundException(`${type.toLowerCase()} not found`);
  }

  // ── Service accounts ──────────────────────────────────────────────────────

  /**
   * Issuing a credential is maker-checker controlled: one person requests the
   * account (access_policy.manage), a second person approves it
   * (access_policy.approve), and then the requester collects the key once.
   * The key is generated at collection, shown once, and only its hash stored —
   * nothing secret exists while the request waits.
   */
  async requestServiceAccount(
    actor: LendingActor,
    body: { name: string; scopes: string[]; expiresInDays?: number },
  ) {
    const tenantId = requireTenant(actor);
    const allowed = new Set(
      ROLE_DEFINITIONS.find((r) => r.code === 'INTEGRATION_SERVICE')!
        .permissions,
    );
    const bad = (body.scopes ?? []).filter((s) => !allowed.has(s));
    if (!body.scopes?.length || bad.length)
      throw new BadRequestException(
        `Service accounts may only hold: ${[...allowed].join(', ')}.`,
      );
    const days = Math.min(365, Math.max(1, body.expiresInDays ?? 90));
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'access_policy.manage',
        this.access(tenantId),
        tx,
      );
      const payload = {
        name: body.name.slice(0, 80),
        scopes: [...new Set(body.scopes)],
        expiresInDays: days,
      };
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: SERVICE_ACCOUNT_SUBJECT,
          // The id the account will carry once its key is issued.
          subjectId: randomUUID(),
          action: SERVICE_ACCOUNT_ACTION,
          requiredPermission: 'access_policy.approve',
          payload: payload as Json,
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'access_policy.service_account_request',
          resourceType: 'ServiceAccount',
          resourceId: task.subjectId,
          outcome: 'SUCCESS',
          details: { ...payload, taskId: task.id },
        },
        tx,
      );
      return this.serviceAccountRequestView(task);
    });
  }

  async decideServiceAccountRequest(
    actor: LendingActor,
    taskId: string,
    approve: boolean,
    comment?: string,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectType: SERVICE_ACCOUNT_SUBJECT },
      });
      if (!task)
        throw new NotFoundException('Service account request not found');
      await this.policy.enforce(
        actor,
        'access_policy.approve',
        this.access(tenantId, [task.makerId], taskId),
        tx,
      );
      const res = await tx.approvalTask.updateMany({
        where: { id: taskId, tenantId, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          ...(comment ? { comment: comment.slice(0, 300) } : {}),
        },
      });
      if (res.count !== 1)
        throw concurrentModification('This service account request');
      await this.audit.write(
        {
          actor,
          action: 'access_policy.service_account_decide',
          resourceType: 'ServiceAccount',
          resourceId: task.subjectId,
          outcome: 'SUCCESS',
          details: { approve, taskId, maker: task.makerId },
        },
        tx,
      );
      return this.serviceAccountRequestView(
        (await tx.approvalTask.findFirst({ where: { id: taskId, tenantId } }))!,
      );
    });
  }

  /** The requester collects the key of an approved account, exactly once. */
  async issueServiceAccountKey(actor: LendingActor, taskId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectType: SERVICE_ACCOUNT_SUBJECT },
      });
      if (!task)
        throw new NotFoundException('Service account request not found');
      await this.policy.enforce(
        actor,
        'access_policy.manage',
        this.access(tenantId, [], taskId),
        tx,
      );
      if (task.makerId !== actor.id)
        throw new ForbiddenException(
          'Only the person who requested this service account can collect its key.',
        );
      if (task.status !== 'APPROVED')
        throw new ConflictException(
          task.status === 'EXECUTED'
            ? 'This key has already been collected; it cannot be shown again.'
            : 'This request has not been approved.',
        );
      const res = await tx.approvalTask.updateMany({
        where: { id: taskId, tenantId, status: 'APPROVED' },
        data: { status: 'EXECUTED' },
      });
      if (res.count !== 1)
        throw concurrentModification('This service account request');
      const p = task.payload as {
        name: string;
        scopes: string[];
        expiresInDays: number;
      };
      const prefix = randomBytes(8).toString('hex');
      const secret = randomBytes(32).toString('base64url');
      const sa = await tx.serviceAccount.create({
        data: {
          id: task.subjectId,
          tenantId,
          name: p.name,
          keyPrefix: prefix,
          keyHash: serviceKeyHash(secret),
          scopes: p.scopes,
          expiresAt: new Date(Date.now() + p.expiresInDays * 86_400_000),
          createdBy: task.makerId,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'access_policy.service_account_create',
          resourceType: 'ServiceAccount',
          resourceId: sa.id,
          outcome: 'SUCCESS',
          details: {
            name: sa.name,
            scopes: sa.scopes,
            expiresAt: sa.expiresAt,
            taskId,
            approvedBy: task.decidedBy,
          },
        },
        tx,
      );
      return {
        id: sa.id,
        name: sa.name,
        scopes: sa.scopes,
        expiresAt: sa.expiresAt,
        key: `${prefix}.${secret}`,
        warning: 'Store this key now; it cannot be shown again.',
      };
    });
  }

  async listServiceAccountRequests(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'access_policy.read',
      this.access(tenantId),
    );
    const tasks = await this.prisma.approvalTask.findMany({
      where: { tenantId, subjectType: SERVICE_ACCOUNT_SUBJECT },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const people = await this.prisma.user.findMany({
      where: {
        tenantId,
        id: {
          in: [
            ...new Set(
              tasks.flatMap((t) => [
                t.makerId,
                ...(t.decidedBy ? [t.decidedBy] : []),
              ]),
            ),
          ],
        },
      },
      select: { id: true, email: true },
    });
    const email = new Map(people.map((u) => [u.id, u.email]));
    return tasks.map((t) => ({
      ...this.serviceAccountRequestView(t),
      makerEmail: email.get(t.makerId) ?? null,
      decidedByEmail: t.decidedBy ? (email.get(t.decidedBy) ?? null) : null,
    }));
  }

  private serviceAccountRequestView(t: {
    id: string;
    subjectId: string;
    status: string;
    payload: unknown;
    makerId: string;
    decidedBy: string | null;
    decidedAt: Date | null;
    comment: string | null;
    createdAt: Date;
  }) {
    const p = t.payload as {
      name: string;
      scopes: string[];
      expiresInDays: number;
    };
    return {
      id: t.id,
      serviceAccountId: t.subjectId,
      name: p.name,
      scopes: p.scopes,
      expiresInDays: p.expiresInDays,
      /** PENDING → APPROVED (key not yet collected) → EXECUTED (key issued), or REJECTED. */
      status: t.status,
      makerId: t.makerId,
      decidedBy: t.decidedBy,
      decidedAt: t.decidedAt,
      comment: t.comment,
      createdAt: t.createdAt,
    };
  }

  async listServiceAccounts(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'access_policy.read',
      this.access(tenantId),
    );
    return this.prisma.serviceAccount.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        status: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  async disableServiceAccount(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'access_policy.manage',
      this.access(tenantId),
    );
    const res = await this.prisma.serviceAccount.updateMany({
      where: { id, tenantId },
      data: { status: 'DISABLED' },
    });
    if (res.count !== 1)
      throw new NotFoundException('Service account not found');
    await this.audit.write({
      actor,
      action: 'access_policy.service_account_disable',
      resourceType: 'ServiceAccount',
      resourceId: id,
      outcome: 'SUCCESS',
    });
    return { disabled: true };
  }

  // ── Access-policy simulator ───────────────────────────────────────────────

  /**
   * "Can this user perform this action on this loan, and why?"
   * Side-effect free: reads only, writes nothing (not even an audit row),
   * and evaluates with the same engine and inputs as a real request.
   */
  async simulate(
    actor: LendingActor,
    body: {
      userId: string;
      action: string;
      resourceType:
        | 'APPLICATION'
        | 'LOAN_ACCOUNT'
        | 'PRODUCT_VERSION'
        | 'TENANT';
      resourceId?: string;
      assurance?: 'MFA' | 'SINGLE_FACTOR';
      amount?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'policy.simulate', this.access(tenantId));
    const action = ACTION_BY_CODE[body.action];
    if (!action) throw new BadRequestException(`Unknown action ${body.action}`);
    const assurance = body.assurance ?? 'MFA';
    const subject = await this.policy.loadUserSubject(
      tenantId,
      body.userId,
      assurance,
    );
    const resource = await this.loadResource(
      tenantId,
      body.resourceType,
      body.resourceId,
      action.code,
      body.amount,
    );
    const ctx = await this.policy.context(tenantId);
    const d = decide({
      action,
      subject,
      resource,
      environment: {
        now: new Date(),
        channel: 'STAFF_PORTAL',
        assurance,
        emergencyAccess: false,
      },
      flags: ctx.flags,
      policies: ctx.policies,
      fx: (from, to) => ctx.fx.get(`${from}->${to}`) ?? null,
      policyVersion: ctx.version,
    });
    return {
      question: `Can ${body.userId} perform ${body.action} on ${body.resourceType} ${body.resourceId ?? ''}?`,
      answer: d.allowed ? 'YES' : 'NO',
      decision: d,
      subject: {
        roles: subject.roles,
        grants: subject.grants,
        authorities: subject.authorities,
        cohorts: subject.cohorts,
      },
    };
  }

  async loadResource(
    tenantId: string,
    type: string,
    id: string | undefined,
    actionCode: string,
    amount?: string,
  ): Promise<Resource> {
    if (type === 'TENANT') return tenantResource(tenantId);
    if (!id) throw new BadRequestException('resourceId is required');
    if (type === 'APPLICATION') {
      const app = await this.prisma.application.findFirst({
        where: { id, tenantId },
      });
      if (!app) throw new NotFoundException('Application not found');
      const [version, product, decisions] = await Promise.all([
        this.prisma.productVersion.findFirst({
          where: { id: app.productVersionId, tenantId },
        }),
        this.prisma.lendingProduct.findFirst({
          where: { id: app.productId, tenantId },
        }),
        this.prisma.creditDecision.findMany({
          where: { tenantId, applicationId: id },
        }),
      ]);
      const makers =
        actionCode === 'credit_decision.approve'
          ? decisions.filter((d) => d.type !== 'REJECT').map((d) => d.decidedBy)
          : [];
      return applicationResource(app, version, product, makers, amount);
    }
    if (type === 'LOAN_ACCOUNT') {
      const acct = await this.prisma.loanAccount.findFirst({
        where: { id, tenantId },
      });
      if (!acct) throw new NotFoundException('Loan account not found');
      const [product, version, agreement, tasks] = await Promise.all([
        this.prisma.lendingProduct.findFirst({
          where: { id: acct.productId, tenantId },
        }),
        this.prisma.productVersion.findFirst({
          where: { id: acct.productVersionId, tenantId },
        }),
        this.prisma.agreementVersion.findFirst({
          where: { tenantId, agreementId: acct.agreementId },
          orderBy: { version: 'desc' },
        }),
        this.prisma.approvalTask.findMany({
          where: {
            tenantId,
            subjectId: id,
            status: { in: ['PENDING', 'APPROVED'] },
          },
        }),
      ]);
      return loanAccountResource(
        acct,
        product?.code ?? null,
        version?.status ?? null,
        parseConfig(agreement?.productConfig).valid,
        tasks.map((t) => t.makerId),
        amount,
      );
    }
    if (type === 'PRODUCT_VERSION') {
      const v = await this.prisma.productVersion.findFirst({
        where: { id, tenantId },
        include: { product: true },
      });
      if (!v) throw new NotFoundException('Product version not found');
      return productVersionResource(v, v.product);
    }
    throw new BadRequestException('Unsupported resource type');
  }
}
