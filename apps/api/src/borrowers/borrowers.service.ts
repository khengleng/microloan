import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

  async findAll(tenantId: string, search?: string, page = 1, limit = 50) {
    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { idNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.borrower.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.borrower.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
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

  async checkCrossTenantCredit(tenantId: string, userId: string, query: { idNumber?: string; phone?: string }) {
    // SECURITY: Reject empty queries to avoid unintentional full scans or privacy leaks
    if (!query.idNumber && !query.phone) {
      throw new BadRequestException('Provide at least an ID Number or Phone to search.');
    }

    // AUDIT: This is a privacy-sensitive cross-org check, so we log WHO did it and WHAT they looked for.
    await this.audit.logAction(tenantId, userId, 'SEARCH', 'Borrower', 'CROSS_ORG_SEARCH', {
      event: 'CROSS_TENANT_CHECK',
      query: { idNumber: query.idNumber ? '***' : null, phone: query.phone ? '***' : null },
      action: 'Search across all organizations for credit risk'
    });

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

    return borrowers.map(b => {
      const isOwnTenant = b.tenantId === tenantId;
      return {
        organization: isOwnTenant ? 'Your Organization' : 'Another Organization',
        // Never expose organization name or loan details for external tenants
        loans: isOwnTenant
          ? b.loans.map(l => ({ status: l.status, date: l.createdAt }))
          : [{ summary: `${b.loans.length} loan(s) found at another lender` }],
      };
    });
  }
}
