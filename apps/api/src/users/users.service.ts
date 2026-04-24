import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { User, Role } from '@microloan/db';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import { canonicalRole } from '../authz/role-permissions';

type UserActor = Pick<JwtPayload, 'sub' | 'role' | 'tenantId' | 'branchId' | 'permissions'>;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private authz: AuthzService,
  ) { }

  async findOneByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findAll(actor: UserActor): Promise<any[]> {
    this.authz.assertPermission(actor, Permission.USER_UPDATE);
    return this.prisma.user.findMany({
      where: this.authz.scopeWhere(actor, {}),
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

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        branchId,
        email: data.email,
        passwordHash: hash,
        role: requestedRole,
      },
      select: { id: true, email: true, role: true, tenantId: true, branchId: true },
    });

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      targetType: 'User',
      targetId: user.id,
      action: 'USER_CREATE',
      newValue: { role: user.role, tenantId: user.tenantId, branchId: user.branchId },
      result: 'SUCCESS',
    });

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
        targetType: 'User',
        targetId: id,
        action: 'USER_DELETE',
        oldValue: { role: user.role, tenantId: user.tenantId },
        result: 'SUCCESS',
      });
      return { success: true };
    }

    const result = await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
      targetType: 'User',
      targetId: id,
      action: 'USER_DISABLE',
      oldValue: { isActive: true, role: user.role },
      newValue: { isActive: false },
      result: 'SUCCESS',
    });

    return result;
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

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: targetRole },
      select: { id: true, email: true, role: true },
    });

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: actor.tenantId,
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
