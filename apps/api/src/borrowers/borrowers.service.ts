import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { maskBorrowerDto, maskBorrowerForAudit } from '../common/mask';
import {
  CreateBorrowerDto,
  UpdateBorrowerDto,
} from './dto/create-borrower.dto';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import { isCbcConfigured, CBC_NOT_READY_MESSAGE } from '../credit-bureau/cbc.provider';

@Injectable()
export class BorrowersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private authz: AuthzService,
  ) { }

  async create(actor: JwtPayload, dto: CreateBorrowerDto) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_CREATE);
    const b = await this.prisma.borrower.create({
      data: {
        tenantId: actor.tenantId!,
        branchId: actor.branchId || null,
        ...dto,
      },
    });
    await this.audit.logAction(
      actor.tenantId!,
      this.authz.actorId(actor),
      'CREATE',
      'Borrower',
      b.id,
      maskBorrowerDto(dto),   // ← PII masked
    );
    return b;
  }

  async findAll(actor: JwtPayload, search?: string, page = 1, limit = 50) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const where: any = this.authz.scopeWhere(actor, {});
    if (actor.branchId) where.branchId = actor.branchId;
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

  async findOne(actor: JwtPayload, id: string) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const b = await this.prisma.borrower.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
    });
    if (!b) throw new NotFoundException('Borrower not found');
    this.authz.assertBranchAccess(actor, b.branchId);
    return b;
  }

  async update(
    actor: JwtPayload,
    id: string,
    dto: UpdateBorrowerDto,
  ) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_UPDATE);
    const b = await this.prisma.borrower.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
    });
    if (!b) throw new NotFoundException('Borrower not found');
    this.authz.assertBranchAccess(actor, b.branchId);
    const updated = await this.prisma.borrower.update({
      where: { id },
      data: dto,
    });
    await this.audit.logAction(actor.tenantId!, this.authz.actorId(actor), 'UPDATE', 'Borrower', b.id, {
      before: maskBorrowerForAudit(b),      // ← masked
      after: maskBorrowerDto(dto),          // ← masked
    });
    return updated;
  }

  async remove(actor: JwtPayload, id: string) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_UPDATE);
    const b = await this.prisma.borrower.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
      include: { _count: { select: { loans: true } } },
    });
    if (!b) throw new NotFoundException('Borrower not found');
    this.authz.assertBranchAccess(actor, b.branchId);
    if (b._count.loans > 0) {
      throw new Error('Cannot delete borrower with associated loans');
    }

    await this.prisma.borrower.delete({ where: { id } });
    await this.audit.logAction(actor.tenantId!, this.authz.actorId(actor), 'DELETE', 'Borrower', id,
      maskBorrowerForAudit(b),   // ← masked, initials only
    );
    return { success: true };
  }

  /**
   * Borrower credit-history check. Scoped to the actor's OWN organization only.
   *
   * M5 fix: previously this searched EVERY tenant and returned the existence and
   * loan-count of matches at other lenders — a cross-tenant privacy leak (and a
   * data-protection problem, since independent lenders' borrower data was shared
   * without a bureau/consent framework). Cross-lender obligations must be checked
   * through the Credit Bureau (CBC), never by peeking into other tenants' data.
   */
  async checkCrossTenantCredit(actor: JwtPayload, query: { idNumber?: string; phone?: string }) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    if (!query.idNumber && !query.phone) {
      throw new BadRequestException('Provide at least an ID Number or Phone to search.');
    }
    if (!actor.tenantId) {
      throw new BadRequestException('Tenant scope is required for a credit check.');
    }

    await this.audit.logAction(actor.tenantId, this.authz.actorId(actor), 'SEARCH', 'Borrower', 'CREDIT_HISTORY_SEARCH', {
      event: 'OWN_ORG_CREDIT_CHECK',
      query: { idNumber: query.idNumber ? '***' : null, phone: query.phone ? '***' : null },
    });

    // Own-organization matches only.
    const borrowers = await this.prisma.borrower.findMany({
      where: {
        tenantId: actor.tenantId,
        OR: [
          query.idNumber ? { idNumber: query.idNumber } : {},
          query.phone ? { phone: query.phone } : {},
        ].filter((q) => Object.keys(q).length > 0),
      },
      include: { loans: { select: { status: true, createdAt: true } } },
    });

    const loans = borrowers.flatMap((b) => b.loans.map((l) => ({ status: l.status, date: l.createdAt })));

    return {
      scope: 'own-organization',
      found: loans.length > 0,
      loans,
      // Cross-lender exposure is only available via the official bureau.
      bureau: {
        available: isCbcConfigured(),
        message: isCbcConfigured()
          ? 'For obligations at other lenders, run a Credit Bureau (CBC) check on the borrower profile.'
          : `${CBC_NOT_READY_MESSAGE} Cross-lender obligations cannot be checked until it is enabled.`,
      },
    };
  }
}
