import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Role } from '@microloan/db';
import { AuditService } from '../audit/audit.service';
import { Permission } from './permission.enum';
import { canonicalRole, permissionsForRole } from './role-permissions';

export type Actor = {
  id?: string;
  sub?: string;
  email?: string;
  role: string;
  tenantId: string | null;
  branchId?: string | null;
  permissions?: Permission[];
};

export type TargetUser = {
  id: string;
  role: string;
  tenantId: string | null;
  branchId?: string | null;
};

@Injectable()
export class AuthzService {
  constructor(private readonly audit: AuditService) {}

  actorId(actor: Actor): string {
    return actor.id || actor.sub || 'unknown';
  }

  isPlatform(actor: Actor): boolean {
    return canonicalRole(actor.role) === 'SUPERADMIN';
  }

  assertPlatformOnly(actor: Actor) {
    if (!this.isPlatform(actor) || actor.tenantId !== null) {
      throw new ForbiddenException('This action is restricted to platform operators.');
    }
  }

  assertPermission(actor: Actor, permission: Permission) {
    const effective = new Set<Permission>([
      ...permissionsForRole(actor.role),
      ...(actor.permissions || []),
    ]);
    if (!effective.has(permission)) {
      throw new ForbiddenException(`Missing required permission: ${permission}`);
    }
  }

  assertTenantAccess(actor: Actor, resourceTenantId: string | null) {
    if (this.isPlatform(actor)) return;
    if (!actor.tenantId || !resourceTenantId || actor.tenantId !== resourceTenantId) {
      throw new ForbiddenException('Cross-tenant access is forbidden.');
    }
  }

  assertBranchAccess(actor: Actor, resourceBranchId?: string | null) {
    if (this.isPlatform(actor)) return;
    if (!resourceBranchId || !actor.branchId) return;
    const role = canonicalRole(actor.role);
    if (['BRANCH_MANAGER', 'LOAN_OFFICER', 'CUSTOMER_SUPPORT'].includes(role) && actor.branchId !== resourceBranchId) {
      throw new ForbiddenException('Cross-branch access is forbidden.');
    }
  }

  assertCanAssignRole(actor: Actor, targetRole: string) {
    const actorRole = canonicalRole(actor.role);
    const desired = canonicalRole(targetRole);
    if (desired === 'SUPERADMIN' && actorRole !== 'SUPERADMIN') {
      throw new ForbiddenException('Only SUPERADMIN can assign SUPERADMIN role.');
    }

    if (actorRole !== 'SUPERADMIN' && actorRole !== 'TENANT_ADMIN') {
      throw new ForbiddenException('You are not allowed to assign roles.');
    }
  }

  assertCanManageUser(
    actor: Actor,
    targetUser: TargetUser,
    requestedChanges: { role?: string; tenantId?: string | null; branchId?: string | null } = {},
  ) {
    this.assertTenantAccess(actor, targetUser.tenantId);

    const actorRole = canonicalRole(actor.role);
    const targetRole = canonicalRole(targetUser.role);
    const requestedRole = requestedChanges.role ? canonicalRole(requestedChanges.role) : undefined;

    if (targetRole === 'SUPERADMIN' && actorRole !== 'SUPERADMIN') {
      throw new ForbiddenException('Only SUPERADMIN can manage SUPERADMIN users.');
    }

    if (requestedRole) {
      this.assertCanAssignRole(actor, requestedRole);
    }

    if (actorRole !== 'SUPERADMIN' && requestedChanges.tenantId === null) {
      throw new ForbiddenException('Tenant users cannot clear tenant scope.');
    }

    const actorId = this.actorId(actor);
    if (targetUser.id === actorId && requestedRole === 'SUPERADMIN' && actorRole !== 'SUPERADMIN') {
      throw new ForbiddenException('Self-promotion to SUPERADMIN is forbidden.');
    }
  }

  assertMakerChecker(actor: Actor, resourceCreatorId: string | null | undefined, action: Permission) {
    if (!resourceCreatorId) return;
    const actorId = this.actorId(actor);
    if (actorId === resourceCreatorId) {
      throw new ForbiddenException(`Maker-checker violation for action ${action}`);
    }
  }

  scopeWhere<T extends Record<string, any>>(actor: Actor, baseWhere: T): T {
    if (this.isPlatform(actor)) {
      return baseWhere;
    }
    if (!actor.tenantId) {
      throw new ForbiddenException('Tenant scope missing for non-platform user.');
    }
    return {
      ...baseWhere,
      tenantId: actor.tenantId,
    };
  }

  async auditAuthzFailure(actor: Actor | null, action: string, targetType: string, targetId: string, reason: string) {
    await this.audit.logSecurityEvent({
      actorUserId: actor ? this.actorId(actor) : null,
      actorRole: actor?.role || null,
      actorTenantId: actor?.tenantId || null,
      targetType,
      targetId,
      action,
      reason,
      result: 'FAILURE',
    });
  }
}

