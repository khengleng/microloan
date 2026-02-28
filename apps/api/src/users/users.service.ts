import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Role } from '@microloan/db';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

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
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async create(tenantId: string, data: { email: string; passwordHash: string; role: Role }) {
    const existing = await this.findOneByEmail(data.email);
    if (existing) {
      throw new ConflictException('User already exists');
    }

    const salt = await bcrypt.genSalt();
    const hash = await bcrypt.hash(data.passwordHash, salt);

    return this.prisma.user.create({
      data: {
        tenantId,
        email: data.email,
        passwordHash: hash,
        role: data.role,
      },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    return this.prisma.user.delete({
      where: { id, tenantId },
    });
  }
}
