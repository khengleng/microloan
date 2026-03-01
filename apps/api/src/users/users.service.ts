import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { User, Role } from '@microloan/db';
import * as bcrypt from 'bcrypt';

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

  async findAll(tenantId: string): Promise<any[]> {
    return this.prisma.user.findMany({
      where: { tenantId },
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

  async create(tenantId: string, data: { email: string; passwordHash: string; role: Role }, actorId?: string) {
    const existing = await this.findOneByEmail(data.email);
    if (existing) {
      throw new ConflictException('User already exists');
    }

    const salt = await bcrypt.genSalt();
    const hash = await bcrypt.hash(data.passwordHash, salt);

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: data.email,
        passwordHash: hash,
        role: data.role,
      },
      select: { id: true, email: true, role: true },
    });

    await this.audit.logAction(tenantId, actorId || user.id, 'CREATE', 'User', user.id, {
      email: user.email,
      role: user.role,
      invitedBy: actorId,
    });

    return user;
  }

  async remove(tenantId: string, id: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id, tenantId } });
    if (!user) return null;

    // Suspend instead of hard delete
    const result = await this.prisma.user.update({
      where: { id, tenantId },
      data: { isActive: false },
    });

    await this.audit.logAction(tenantId, actorId || id, 'UPDATE', 'User', id, {
      event: 'USER_SUSPENDED',
      email: user?.email,
      role: user?.role,
    });

    return result;
  }

  async updateRole(tenantId: string, id: string, role: string, actorId?: string) {
    const before = await this.prisma.user.findUnique({ where: { id, tenantId }, select: { email: true, role: true } });
    const user = await this.prisma.user.update({
      where: { id, tenantId },
      data: { role: role as Role },
      select: { id: true, email: true, role: true },
    });

    await this.audit.logAction(tenantId, actorId || id, 'UPDATE', 'User', id, {
      email: user.email,
      previousRole: before?.role,
      newRole: role,
    });

    return user;
  }
}
