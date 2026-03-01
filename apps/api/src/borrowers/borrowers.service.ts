import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { maskBorrowerDto, maskBorrowerForAudit } from '../common/mask';
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
      maskBorrowerDto(dto),   // ← PII masked
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
      where: { id, tenantId },
      data: dto,
    });
    await this.audit.logAction(tenantId, userId, 'UPDATE', 'Borrower', b.id, {
      before: maskBorrowerForAudit(b),      // ← masked
      after: maskBorrowerDto(dto),          // ← masked
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

    await this.prisma.borrower.delete({ where: { id, tenantId } });
    await this.audit.logAction(tenantId, userId, 'DELETE', 'Borrower', id,
      maskBorrowerForAudit(b),   // ← masked, initials only
    );
    return { success: true };
  }

  async checkCrossTenantCredit(tenantId: string, query: { idNumber?: string; phone?: string }) {
    // We search across ALL tenants but only return status summaries for privacy
    const borrowers = await this.prisma.borrower.findMany({
      where: {
        OR: [
          query.idNumber ? { idNumber: query.idNumber } : {},
          query.phone ? { phone: query.phone } : {},
        ].filter(q => Object.keys(q).length > 0)
      },
      include: {
        tenant: { select: { name: true } },
        loans: {
          select: { status: true, principal: true, createdAt: true }
        }
      }
    });

    return borrowers.map(b => ({
      organization: b.tenantId === tenantId ? 'Your Organization' : 'Another Organization',
      organizationName: b.tenantId === tenantId ? b.tenant.name : '***', // Mask name for external tenants if necessary, but user asked for "cross check"
      loans: b.loans.map(l => ({
        status: l.status,
        date: l.createdAt
      }))
    }));
  }
}
