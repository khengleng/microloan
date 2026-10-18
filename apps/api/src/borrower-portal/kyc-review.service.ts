import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { KycReviewDto } from './dto/kyc-review.dto';
import { decryptField } from '../common/field-crypto';
import { CustomerDocumentsService } from '../lending/documents/customer-documents.service';

/** ApprovalTask action for a pending identity verification (maker-checker). */
export const KYC_VERIFY_ACTION = 'KYC_VERIFY';
const SUBJECT = 'BORROWER';

// Staff-facing manual e-KYC review. Reads the identity documents - uploaded by
// the borrower in the portal or filed by staff in the customer document
// library - and moves the borrower's aggregate kycStatus. Tenant/branch scoped
// via authz.
//
// Verification takes two people: one records it (an ApprovalTask, the generic
// maker-checker record), a different person confirms it, and nobody who filed
// one of the customer's identity documents may do either. Rejection is a
// single step: it only ever makes the customer less trusted.
@Injectable()
export class KycReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly library: CustomerDocumentsService,
  ) {}

  private async ownedBorrower(actor: JwtPayload, borrowerId: string) {
    const borrower = await this.prisma.borrower.findFirst({
      where: this.authz.scopeWhere(actor as any, { id: borrowerId }),
      select: { id: true, tenantId: true, branchId: true, kycStatus: true, kycVerifiedAt: true, kycVerifiedByUserId: true },
    });
    if (!borrower) throw new NotFoundException('Borrower not found');
    this.authz.assertBranchAccess(actor as any, borrower.branchId);
    return borrower;
  }

  async listDocuments(actor: JwtPayload, borrowerId: string) {
    this.authz.assertPermission(actor as any, Permission.CUSTOMER_VIEW);
    const borrower = await this.ownedBorrower(actor, borrowerId);
    const tenantId = borrower.tenantId;
    const me = this.authz.actorId(actor as any);
    const documents = await this.prisma.kycDocument.findMany({
      where: { tenantId, borrowerId },
      orderBy: { createdAt: 'desc' },
    });
    // Decrypt the stored image content for staff review. Files held in the
    // customer document library are served through a short-lived, audited link.
    const decrypted: Record<string, unknown>[] = [];
    for (const d of documents) {
      const content = decryptField(d.content) ?? '';
      if (!content.startsWith('library:')) {
        decrypted.push({ ...d, content, origin: 'PORTAL' });
        continue;
      }
      const link = await this.library.kycLink(
        { id: me, type: 'USER', tenantId: actor.tenantId ?? null },
        d.tenantId,
        content.slice('library:'.length),
      );
      decrypted.push({ ...d, content: '', libraryDocumentId: content.slice('library:'.length), link, origin: 'PORTAL' });
    }
    // Identity documents staff filed in the customer document library.
    const staffDocs = await this.staffKycDocuments(tenantId, borrowerId);
    for (const d of staffDocs) {
      const v = d.versions.find((x) => x.version === d.currentVersion);
      const link = await this.library.kycLink(
        { id: me, type: 'USER', tenantId: actor.tenantId ?? null },
        tenantId,
        d.id,
      );
      decrypted.push({
        id: d.id,
        type: d.typeCode,
        title: d.title,
        content: '',
        mimeType: v?.mimeType ?? null,
        createdAt: d.createdAt,
        libraryDocumentId: d.id,
        link,
        origin: 'STAFF',
        uploadedBy: v?.uploadedBy ?? d.createdBy,
      });
    }

    const uploaders = this.uploaders(staffDocs);
    const pending = await this.pendingTask(tenantId, borrowerId);
    const people = await this.userNames(tenantId, [
      ...(pending ? [pending.makerId] : []),
      ...(borrower.kycVerifiedByUserId ? [borrower.kycVerifiedByUserId] : []),
      ...uploaders,
    ]);
    const isUploader = uploaders.includes(me);
    const isMaker = pending?.makerId === me;
    return {
      kycStatus: borrower.kycStatus,
      verifiedAt: borrower.kycVerifiedAt,
      verifiedBy: borrower.kycVerifiedByUserId
        ? { id: borrower.kycVerifiedByUserId, name: people.get(borrower.kycVerifiedByUserId) ?? null }
        : null,
      pendingVerification: pending
        ? {
            id: pending.id,
            recordedBy: { id: pending.makerId, name: people.get(pending.makerId) ?? null },
            recordedAt: pending.createdAt,
            reason: (pending.payload as { reason?: string } | null)?.reason ?? null,
          }
        : null,
      // What the signed-in reviewer may do next, and why not.
      you: {
        uploadedDocuments: isUploader,
        recordedVerification: isMaker,
        mayRecord: !pending && !isUploader && borrower.kycStatus !== 'VERIFIED',
        mayConfirm: !!pending && !isMaker && !isUploader,
      },
      documents: decrypted,
    };
  }

  async setStatus(actor: JwtPayload, borrowerId: string, dto: KycReviewDto) {
    this.authz.assertPermission(actor as any, Permission.CUSTOMER_UPDATE);
    const borrower = await this.ownedBorrower(actor, borrowerId);
    const tenantId = borrower.tenantId;
    const me = this.authz.actorId(actor as any);
    const reason = dto.reason?.trim() || undefined;

    if (dto.status === 'VERIFIED') {
      if (borrower.kycStatus === 'VERIFIED')
        throw new ConflictException('This customer’s identity is already verified.');
      const staffDocs = await this.staffKycDocuments(tenantId, borrowerId);
      if (this.uploaders(staffDocs).includes(me))
        throw new ConflictException(
          'You filed one of this customer’s identity documents, so someone else must verify their identity.',
        );
      const pending = await this.pendingTask(tenantId, borrowerId);
      if (!pending) return this.recordVerification(actor, tenantId, borrowerId, reason);
      if (pending.makerId === me)
        throw new ConflictException(
          'You recorded this verification; a second person must confirm it.',
        );
      return this.confirmVerification(actor, tenantId, borrowerId, pending.id, reason);
    }

    // REJECTED or back to PENDING: one step, and any verification awaiting
    // confirmation is withdrawn with it.
    if (dto.status === 'REJECTED' && !reason)
      throw new BadRequestException('Give a reason for rejecting the verification.');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.approvalTask.updateMany({
        where: { tenantId, subjectType: SUBJECT, subjectId: borrowerId, action: KYC_VERIFY_ACTION, status: 'PENDING' },
        data: { status: 'CANCELLED', decidedBy: me, decidedAt: new Date(), comment: `Superseded: ${dto.status}` },
      });
      return tx.borrower.update({
        where: { id: borrowerId },
        data: { kycStatus: dto.status, kycVerifiedAt: null, kycVerifiedByUserId: null },
        select: { id: true, kycStatus: true, kycVerifiedAt: true },
      });
    });
    await this.audit.logAction(tenantId, me, `KYC_${dto.status}`, 'Borrower', borrowerId, reason ? { reason } : undefined);
    return { ...updated, pendingVerification: null };
  }

  /** Step 1: record the verification; the customer stays PENDING until confirmed. */
  private async recordVerification(actor: JwtPayload, tenantId: string, borrowerId: string, reason?: string) {
    const me = this.authz.actorId(actor as any);
    const task = await this.prisma.$transaction(async (tx) => {
      const open = await tx.approvalTask.findFirst({
        where: { tenantId, subjectType: SUBJECT, subjectId: borrowerId, action: KYC_VERIFY_ACTION, status: 'PENDING' },
      });
      if (open) throw new ConflictException('A verification of this customer is already awaiting confirmation.');
      return tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: SUBJECT,
          subjectId: borrowerId,
          action: KYC_VERIFY_ACTION,
          requiredPermission: Permission.CUSTOMER_UPDATE,
          payload: reason ? { reason: reason.slice(0, 500) } : {},
          makerId: me,
        },
      });
    });
    await this.audit.logAction(tenantId, me, 'KYC_VERIFICATION_RECORDED', 'Borrower', borrowerId, {
      task: task.id,
      ...(reason ? { reason } : {}),
    });
    return {
      id: borrowerId,
      kycStatus: 'PENDING' as const,
      kycVerifiedAt: null,
      pendingVerification: { id: task.id, recordedBy: { id: me }, recordedAt: task.createdAt },
    };
  }

  /** Step 2: a different person confirms; the customer becomes VERIFIED. */
  private async confirmVerification(actor: JwtPayload, tenantId: string, borrowerId: string, taskId: string, reason?: string) {
    const me = this.authz.actorId(actor as any);
    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.approvalTask.updateMany({
        where: { id: taskId, tenantId, status: 'PENDING', makerId: { not: me } },
        data: { status: 'EXECUTED', decidedBy: me, decidedAt: new Date(), comment: reason?.slice(0, 500) },
      });
      if (done.count !== 1)
        throw new ConflictException('This verification was changed by someone else; reload and try again.');
      return tx.borrower.update({
        where: { id: borrowerId },
        data: { kycStatus: 'VERIFIED', kycVerifiedAt: new Date(), kycVerifiedByUserId: me },
        select: { id: true, kycStatus: true, kycVerifiedAt: true },
      });
    });
    await this.audit.logAction(tenantId, me, 'KYC_VERIFIED', 'Borrower', borrowerId, {
      task: taskId,
      ...(reason ? { reason } : {}),
    });
    return { ...updated, pendingVerification: null };
  }

  private staffKycDocuments(tenantId: string, borrowerId: string) {
    return this.prisma.customerDocument.findMany({
      where: {
        tenantId,
        borrowerId,
        category: 'KYC',
        status: 'ACTIVE',
        // Portal uploads are listed through their KycDocument row.
        OR: [{ legacySource: null }, { legacySource: { not: 'KYC_DOCUMENT' } }],
      },
      include: { versions: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Staff who filed any version of the customer's identity documents. */
  private uploaders(docs: { createdBy: string; origin: string; versions: { uploadedBy: string; uploaderType: string }[] }[]) {
    const ids = new Set<string>();
    for (const d of docs) {
      if (d.origin === 'STAFF') ids.add(d.createdBy);
      for (const v of d.versions) if (v.uploaderType === 'USER') ids.add(v.uploadedBy);
    }
    return [...ids];
  }

  private pendingTask(tenantId: string, borrowerId: string) {
    return this.prisma.approvalTask.findFirst({
      where: { tenantId, subjectType: SUBJECT, subjectId: borrowerId, action: KYC_VERIFY_ACTION, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async userNames(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.user.findMany({
      where: { tenantId, id: { in: unique } },
      select: { id: true, email: true },
    });
    return new Map(rows.map((r) => [r.id, r.email]));
  }
}
