import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { User, Role } from '@microloan/db';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import { canonicalRole } from '../authz/role-permissions';
import { PlanTierService } from '../plan-tiers/plan-tier.service';
import { SuperadminGrantService } from '../platform-approvals/superadmin-grant.service';
import { mfaIsFresh, stepUpRequired } from '../auth/mfa-policy';

type UserActor = Pick<JwtPayload, 'sub' | 'role' | 'tenantId' | 'branchId' | 'permissions'> &
  Partial<Pick<JwtPayload, 'amr' | 'mfaAt' | 'tenantPlan'>>;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private authz: AuthzService,
    private planTiers: PlanTierService,
    private superadminGrants: SuperadminGrantService,
  ) { }

  async findOneByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findAll(actor: UserActor): Promise<any[]> {
    this.authz.assertPermission(actor, Permission.USER_UPDATE);
    // The platform team is the platform's own operators (tenantId null), not
    // every organisation's staff; those are listed per organisation.
    const where = this.authz.isPlatform(actor) && !actor.tenantId
      ? { tenantId: null }
      : this.authz.scopeWhere(actor, {});
    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        branchId: true,
        isActive: true,
        twoFactorEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(actor: UserActor, data: { email: string; plainPassword: string; role: Role; tenantId?: string; branchId?: string }) {
    this.authz.assertPermission(actor, Permission.USER_CREATE);
    const requestedRole = this.parseRole(data.role);
    this.authz.assertCanAssignRole(actor, requestedRole);

    const existing = await this.findOneByEmail(data.email);
    if (existing) {
      throw new ConflictException('User already exists');
    }

    const salt = await bcrypt.genSalt();
    const hash = await bcrypt.hash(data.plainPassword, salt);

    const actorIsPlatform = this.authz.isPlatform(actor);
    const tenantId = actorIsPlatform ? (data.tenantId ?? null) : actor.tenantId;
    const branchId = actorIsPlatform ? (data.branchId ?? null) : (data.branchId ?? actor.branchId ?? null);

    if (!actorIsPlatform && tenantId === null) {
      await this.authz.auditAuthzFailure(actor, 'USER_CREATE', 'User', data.email, 'Tenant admin tried to set tenantId=null');
      throw new BadRequestException('Tenant users cannot set tenantId to null.');
    }
    if (requestedRole === Role.SUPERADMIN && tenantId !== null) {
      throw new BadRequestException('SUPERADMIN must be created with tenantId=null.');
    }
    if (requestedRole !== Role.SUPERADMIN && !tenantId) {
      throw new BadRequestException('Non-SUPERADMIN users must have a tenantId.');
    }

    if (branchId && tenantId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId } });
      if (!branch) throw new BadRequestException('Invalid branch assignment');
    }

    // A new super-administrator needs a second super-administrator's approval
    // (D-130): the account is created inactive and activated by the approval.
    const grantsSuperadmin = requestedRole === Role.SUPERADMIN;
    if (grantsSuperadmin && !mfaIsFresh(actor)) throw stepUpRequired();

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        branchId,
        email: data.email,
        passwordHash: hash,
        role: requestedRole,
        ...(grantsSuperadmin ? { isActive: false } : {}),
      },
      select: { id: true, email: true, role: true, tenantId: true, branchId: true },
    });

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      targetType: 'User',
      targetId: user.id,
      subjectTenantId: user.tenantId,
      action: 'USER_CREATE',
      newValue: { role: user.role, tenantId: user.tenantId, branchId: user.branchId },
      result: 'SUCCESS',
    });

    if (grantsSuperadmin) {
      const grant = await this.superadminGrants.requestForNewAccount(
        { ...actor, tenantId: actor.tenantId ?? null },
        user,
      );
      return { ...user, superadminGrant: grant };
    }
    return user;
  }

  async remove(actor: UserActor, id: string) {
    this.authz.assertPermission(actor, Permission.USER_DELETE);

    const user = await this.prisma.user.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
    });
    if (!user) throw new NotFoundException('User not found');
    this.authz.assertCanManageUser(actor, user);

    // Self-delete lockout protection.
    if (this.authz.actorId(actor) === user.id) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    // Hard delete for TRUE purge if Superadmin is doing it
    if (this.authz.isPlatform(actor)) {
      await this.prisma.user.delete({ where: { id } });
      await this.audit.logSecurityEvent({
        actorUserId: actor.sub,
        actorRole: actor.role,
        actorTenantId: actor.tenantId,
        subjectTenantId: user.tenantId,
        targetType: 'User',
        targetId: id,
        action: 'USER_DELETE',
        oldValue: { role: user.role, tenantId: user.tenantId },
        result: 'SUCCESS',
      });
      return { success: true };
    }

    const [result] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isActive: false },
      }),
      // A suspended account's sessions must not quietly resume if it is
      // reactivated later: end them now.
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      subjectTenantId: user.tenantId,
      targetType: 'User',
      targetId: id,
      action: 'USER_DISABLE',
      oldValue: { isActive: true, role: user.role },
      newValue: { isActive: false },
      result: 'SUCCESS',
    });

    return result;
  }

  /**
   * Admin-initiated password reset. A tenant admin can reset users within their
   * org; a platform superadmin can reset any user (scoping enforced by
   * scopeWhere + assertCanManageUser). Resets the lockout and revokes all active
   * refresh tokens so the old password/session can no longer be used.
   *
   * Note: this is the account-recovery path for a stack with no email delivery —
   * self-service email reset requires an email provider to be configured.
   */
  async resetPassword(actor: UserActor, id: string, plainPassword: string) {
    this.authz.assertPermission(actor, Permission.USER_UPDATE);
    if (!plainPassword || plainPassword.length < 12) {
      throw new BadRequestException('Password must be at least 12 characters.');
    }

    const user = await this.prisma.user.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
      select: { id: true, email: true, role: true, tenantId: true, branchId: true },
    });
    if (!user) throw new NotFoundException('User not found');
    this.authz.assertCanManageUser(actor, user);

    const hash = await bcrypt.hash(plainPassword, await bcrypt.genSalt());

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash: hash, loginAttempts: 0, lockedUntil: null },
      }),
      // Force re-login everywhere by revoking active refresh tokens.
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      subjectTenantId: user.tenantId,
      targetType: 'User',
      targetId: id,
      action: 'USER_PASSWORD_RESET',
      result: 'SUCCESS',
    });

    return { success: true };
  }

  /**
   * Undo a suspension (DELETE /users/:id). Same permission and the same
   * who-may-manage-whom rules as suspending. A suspended account still counts
   * toward the plan's seat ceiling (QuotaGuard counts every user row), but its
   * seat is not in use: reactivation is refused only when the active seats are
   * already full, which can happen after a downgrade.
   */
  async reactivate(actor: UserActor, id: string) {
    this.authz.assertPermission(actor, Permission.USER_DISABLE);

    const user = await this.prisma.user.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
      select: { id: true, email: true, role: true, isActive: true, tenantId: true, branchId: true },
    });
    if (!user) throw new NotFoundException('User not found');
    this.authz.assertCanManageUser(actor, user);
    if (this.authz.actorId(actor) === user.id) {
      throw new BadRequestException('You cannot reactivate your own account.');
    }
    if (user.isActive) throw new ConflictException('This account is already active.');

    if (!this.authz.isPlatform(actor) && user.tenantId) {
      const { maxUsers } = await this.planTiers.ceilingsFor(actor.tenantPlan);
      if (maxUsers !== null) {
        const active = await this.prisma.user.count({
          where: { tenantId: user.tenantId, isActive: true },
        });
        if (active >= maxUsers) {
          throw new ForbiddenException(
            `Your organization already has ${active} active team members, the most the ${actor.tenantPlan || 'current'} plan allows. Suspend someone else or upgrade the plan first.`,
          );
        }
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        // A fresh start: clear any lockout left over from before the suspension.
        data: { isActive: true, loginAttempts: 0, lockedUntil: null },
        select: { id: true, email: true, role: true, isActive: true },
      }),
      // Sessions issued before the suspension stay dead; the person signs in again.
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      subjectTenantId: user.tenantId,
      targetType: 'User',
      targetId: id,
      action: 'USER_REACTIVATE',
      oldValue: { isActive: false, role: user.role },
      newValue: { isActive: true },
      result: 'SUCCESS',
    });

    return updated;
  }

  /**
   * Lost phone: remove a team member's authenticator so they can enrol a new
   * one. The actor must have signed in with their own authenticator code
   * (step-up), cannot reset their own factor (that would let a stolen password
   * strip the second factor), and the target is signed out everywhere.
   */
  async resetMfa(actor: UserActor, id: string) {
    this.authz.assertPermission(actor, Permission.USER_UPDATE);

    const user = await this.prisma.user.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
      select: { id: true, email: true, role: true, tenantId: true, branchId: true, twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!user) throw new NotFoundException('User not found');
    this.authz.assertCanManageUser(actor, user);

    if (this.authz.actorId(actor) === user.id) {
      throw new BadRequestException(
        'You cannot reset your own authenticator. Ask another administrator.',
      );
    }
    if (!mfaIsFresh(actor)) {
      await this.authz.auditAuthzFailure(actor, 'USER_MFA_RESET', 'User', id, 'Actor authenticator code is not recent');
      throw stepUpRequired(
        'Resetting an authenticator needs a recent code from your own authenticator app.',
      );
    }
    if (!user.twoFactorEnabled && !user.twoFactorSecret) {
      throw new ConflictException('This team member has no authenticator to reset.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      subjectTenantId: user.tenantId,
      targetType: 'User',
      targetId: id,
      action: 'USER_MFA_RESET',
      oldValue: { twoFactorEnabled: user.twoFactorEnabled },
      newValue: { twoFactorEnabled: false },
      result: 'SUCCESS',
    });

    return { success: true };
  }

  async updateRole(actor: UserActor, id: string, role: string) {
    this.authz.assertPermission(actor, Permission.USER_UPDATE_ROLE);
    const targetRole = this.parseRole(role);

    const user = await this.prisma.user.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
      select: { id: true, email: true, role: true, isActive: true, tenantId: true }
    });

    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) {
      throw new BadRequestException('Cannot update role for suspended users. You must reactivate the account first to update its logic permissions.');
    }
    this.authz.assertCanManageUser(actor, user, { role: targetRole });

    // Prevent self-promotion to platform role and self-demotion lockout.
    if (this.authz.actorId(actor) === user.id && canonicalRole(targetRole) === 'SUPERADMIN' && !this.authz.isPlatform(actor)) {
      throw new BadRequestException('Self-promotion to SUPERADMIN is forbidden.');
    }
    if (this.authz.actorId(actor) === user.id && canonicalRole(user.role) === 'SUPERADMIN' && canonicalRole(targetRole) !== 'SUPERADMIN') {
      throw new BadRequestException('SUPERADMIN cannot self-demote.');
    }
    // Granting SUPERADMIN goes through Promote to super-administrator, which
    // needs a second super-administrator's approval (D-130).
    if (canonicalRole(targetRole) === 'SUPERADMIN' && canonicalRole(user.role) !== 'SUPERADMIN') {
      throw new BadRequestException(
        'Use "Promote to super-administrator": it needs a second super-administrator\'s approval.',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: targetRole },
      select: { id: true, email: true, role: true },
    });

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      subjectTenantId: user.tenantId,
      targetType: 'User',
      targetId: id,
      action: 'USER_UPDATE_ROLE',
      oldValue: { role: user.role },
      newValue: { role: targetRole },
      result: 'SUCCESS',
    });

    return updated;
  }

  private parseRole(role: string): Role {
    if (!Object.values(Role).includes(role as Role)) {
      throw new BadRequestException('Invalid role');
    }
    return role as Role;
  }
}
