import {
  Injectable,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { User, Role } from '@microloan/db';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from '../auth/jwt.strategy';

type UserActor = Pick<JwtPayload, 'sub' | 'role' | 'tenantId'>;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) { }

  async findOneByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findAll(actor: UserActor): Promise<any[]> {
    this.assertManagementActor(actor);
    return this.prisma.user.findMany({
      where: { tenantId: actor.tenantId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        twoFactorEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(actor: UserActor, data: { email: string; plainPassword: string; role: Role }) {
    this.assertManagementActor(actor);
    const requestedRole = this.parseRole(data.role);

    // Critical: tenant admins can never mint global privilege.
    if (requestedRole === Role.SUPERADMIN && actor.role !== Role.SUPERADMIN) {
      throw new ForbiddenException('Only SUPERADMIN can assign SUPERADMIN role.');
    }

    const existing = await this.findOneByEmail(data.email);
    if (existing) {
      throw new ConflictException('User already exists');
    }

    const salt = await bcrypt.genSalt();
    const hash = await bcrypt.hash(data.plainPassword, salt);

    const user = await this.prisma.user.create({
      data: {
        // All creates are tenant-scoped to the actor's tenant in this controller flow.
        tenantId: actor.tenantId,
        email: data.email,
        passwordHash: hash,
        role: requestedRole,
      },
      select: { id: true, email: true, role: true },
    });

    await this.audit.logAction(actor.tenantId, actor.sub, 'CREATE', 'User', user.id, {
      email: user.email,
      role: user.role,
      invitedBy: actor.sub,
    });

    return user;
  }

  async remove(actor: UserActor, id: string) {
    this.assertManagementActor(actor);
    const scopeTenantId = actor.role === Role.SUPERADMIN ? undefined : actor.tenantId;

    const user = await this.prisma.user.findFirst({
      where: {
        id,
        ...(scopeTenantId ? { tenantId: scopeTenantId } : {}),
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Non-superadmin actors cannot touch SUPERADMIN identities.
    if (actor.role !== Role.SUPERADMIN && user.role === Role.SUPERADMIN) {
      throw new ForbiddenException('Only SUPERADMIN can manage SUPERADMIN users.');
    }

    // Hard delete for TRUE purge if Superadmin is doing it
    if (actor.role === Role.SUPERADMIN) {
      await this.prisma.user.delete({ where: { id } });
      await this.audit.logAction(user.tenantId, actor.sub, 'DELETE', 'User', id, {
        event: 'USER_PURGED',
        email: user.email,
      });
      return { success: true };
    }

    const result = await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    await this.audit.logAction(actor.tenantId, actor.sub, 'UPDATE', 'User', id, {
      event: 'USER_SUSPENDED',
      email: user.email,
      role: user.role,
    });

    return result;
  }

  async updateRole(actor: UserActor, id: string, role: string) {
    this.assertManagementActor(actor);
    const targetRole = this.parseRole(role);
    const scopeTenantId = actor.role === Role.SUPERADMIN ? undefined : actor.tenantId;

    const user = await this.prisma.user.findFirst({
      where: {
        id,
        ...(scopeTenantId ? { tenantId: scopeTenantId } : {}),
      },
      select: { id: true, email: true, role: true, isActive: true, tenantId: true }
    });

    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) {
      throw new BadRequestException('Cannot update role for suspended users. You must reactivate the account first to update its logic permissions.');
    }

    // Critical: only SUPERADMIN can assign SUPERADMIN role (service-enforced).
    if (targetRole === Role.SUPERADMIN && actor.role !== Role.SUPERADMIN) {
      throw new ForbiddenException('Only SUPERADMIN can assign SUPERADMIN role.');
    }

    // Defense-in-depth: tenant admins cannot manage existing SUPERADMIN accounts.
    if (actor.role !== Role.SUPERADMIN && user.role === Role.SUPERADMIN) {
      throw new ForbiddenException('Only SUPERADMIN can manage SUPERADMIN users.');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: targetRole },
      select: { id: true, email: true, role: true },
    });

    await this.audit.logAction(user.tenantId, actor.sub, 'UPDATE', 'User', id, {
      email: user.email,
      previousRole: user.role,
      newRole: targetRole,
      event: 'USER_ROLE_UPDATED',
    });

    return updated;
  }

  private assertManagementActor(actor: UserActor) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.SUPERADMIN) {
      throw new ForbiddenException('Only ADMIN or SUPERADMIN can manage users.');
    }
  }

  private parseRole(role: string): Role {
    if (!Object.values(Role).includes(role as Role)) {
      throw new BadRequestException('Invalid role');
    }
    return role as Role;
  }
}
