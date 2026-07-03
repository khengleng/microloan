import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { KycReviewDto } from './dto/kyc-review.dto';
import { decryptField } from '../common/field-crypto';

// Staff-facing manual e-KYC review. Reads borrower-uploaded documents and
// flips the borrower's aggregate kycStatus. Tenant/branch scoped via authz.
@Injectable()
export class KycReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  private async ownedBorrower(actor: JwtPayload, borrowerId: string) {
    const borrower = await this.prisma.borrower.findFirst({
      where: this.authz.scopeWhere(actor as any, { id: borrowerId }),
      select: { id: true, branchId: true, kycStatus: true },
    });
    if (!borrower) throw new NotFoundException('Borrower not found');
    this.authz.assertBranchAccess(actor as any, borrower.branchId);
    return borrower;
  }

  async listDocuments(actor: JwtPayload, borrowerId: string) {
    this.authz.assertPermission(actor as any, Permission.CUSTOMER_VIEW);
    const borrower = await this.ownedBorrower(actor, borrowerId);
    const documents = await this.prisma.kycDocument.findMany({
      where: { borrowerId },
      orderBy: { createdAt: 'desc' },
    });
    // Decrypt the stored image content for staff review.
    const decrypted = documents.map((d) => ({ ...d, content: decryptField(d.content) }));
    return { kycStatus: borrower.kycStatus, documents: decrypted };
  }

  async setStatus(actor: JwtPayload, borrowerId: string, dto: KycReviewDto) {
    this.authz.assertPermission(actor as any, Permission.CUSTOMER_UPDATE);
    await this.ownedBorrower(actor, borrowerId);

    const updated = await this.prisma.borrower.update({
      where: { id: borrowerId },
      data: {
        kycStatus: dto.status,
        kycVerifiedAt: dto.status === 'VERIFIED' ? new Date() : null,
        kycVerifiedByUserId: dto.status === 'VERIFIED' ? actor.sub : null,
      },
      select: { id: true, kycStatus: true, kycVerifiedAt: true },
    });

    await this.audit.logAction(
      actor.tenantId as string,
      this.authz.actorId(actor as any),
      `KYC_${dto.status}`,
      'Borrower',
      borrowerId,
      dto.reason ? { reason: dto.reason } : undefined,
    );
    return updated;
  }
}
