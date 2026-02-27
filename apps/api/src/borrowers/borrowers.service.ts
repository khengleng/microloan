import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateBorrowerDto,
  UpdateBorrowerDto,
} from './dto/create-borrower.dto';

@Injectable()
export class BorrowersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) { }

  async create(tenantId: string, userId: string, dto: CreateBorrowerDto) {
    const b = await this.prisma.borrower.create({ data: { tenantId, ...dto } });
    await this.audit.logAction(
      tenantId,
      userId,
      'CREATE',
      'Borrower',
      b.id,
      dto,
    );
    return b;
  }

  async findAll(tenantId: string) {
    return this.prisma.borrower.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const b = await this.prisma.borrower.findUnique({
      where: { id, tenantId },
    });
    if (!b) throw new NotFoundException('Borrower not found');
    return b;
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateBorrowerDto,
  ) {
    const b = await this.prisma.borrower.findUnique({
      where: { id, tenantId },
    });
    if (!b) throw new NotFoundException('Borrower not found');
    const updated = await this.prisma.borrower.update({
      where: { id },
      data: dto,
    });
    await this.audit.logAction(tenantId, userId, 'UPDATE', 'Borrower', b.id, {
      old: b,
      new: updated,
    });
    return updated;
  }

  async remove(tenantId: string, userId: string, id: string) {
    const b = await this.prisma.borrower.findUnique({
      where: { id, tenantId },
      include: { _count: { select: { loans: true } } },
    });
    if (!b) throw new NotFoundException('Borrower not found');
    if (b._count.loans > 0) {
      throw new Error('Cannot delete borrower with associated loans');
    }

    await this.prisma.borrower.delete({ where: { id } });
    await this.audit.logAction(tenantId, userId, 'DELETE', 'Borrower', id, b);
    return { success: true };
  }
}
