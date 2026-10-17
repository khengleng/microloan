import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';
import { decryptField } from '../../common/field-crypto';
import { ownStorageKey } from '../../document-vault/document-vault.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  LendingActor,
  fromLocalDate,
  requireTenant,
  sha256,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import type { Resource } from '../policy/decision';
import { parseConfig, tenantResource } from '../policy/resources';
import { AdapterRegistry } from '../integrations/adapters';
import {
  ALLOWED_DOCUMENT_MIME,
  DocumentStorageService,
  GENERATED_DOCUMENT_MIME,
  MAX_DOCUMENT_BYTES,
  libraryKey,
  ownLibraryKey,
  safeFileName,
  sniffMatches,
} from './document-storage';
import {
  CHECKLIST_PRESENT,
  ChecklistStatus,
  DEFAULT_RETENTION_YEARS,
  DOCUMENT_CATEGORIES,
  addYears,
  checklistStatus,
  expiryReminderDays,
  retentionYearsFor,
} from './document-rules';

type Json = Prisma.InputJsonValue;
type Actorish = Pick<LendingActor, 'id' | 'type' | 'tenantId'>;

export interface FileInput {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export interface UploadInput extends FileInput {
  category: string;
  typeCode: string;
  title?: string;
  applicationId?: string;
  loanAccountId?: string;
  collateralId?: string;
  issuedOn?: string;
  expiresOn?: string;
  note?: string;
}

interface Decoded {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  sha: string;
}

interface NewDocument {
  tenantId: string;
  borrowerId: string;
  category: string;
  typeCode: string;
  title: string;
  origin: 'STAFF' | 'PORTAL' | 'GENERATED';
  customerVisible: boolean;
  reviewStatus: 'PENDING_REVIEW' | 'NOT_REQUIRED';
  applicationId?: string | null;
  loanAccountId?: string | null;
  collateralId?: string | null;
  requestId?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  note?: string;
  createdBy: string;
  uploaderType: 'USER' | 'CUSTOMER' | 'SYSTEM';
}

const OPEN_APPLICATION = [
  'DRAFT',
  'SUBMITTED',
  'RECOMMENDED',
  'APPROVED',
  'BOOKED',
];
const LIVE_LOAN = ['BOOKED', 'ACTIVE'];

/** System principal for filing, expiry and other unattended work. */
export function documentsSystemActor(tenantId: string): LendingActor {
  return {
    id: 'system:documents',
    type: 'SERVICE',
    tenantId,
    assurance: 'SERVICE_KEY',
    channel: 'SYSTEM',
    scopes: [],
  };
}

/**
 * The customer document library (DOC-1..10).
 *
 * One library per borrower covering KYC, application, loan, collateral,
 * agreement and generated documents. Files live in object storage under the
 * tenant's prefix; the database holds metadata, versions, review outcomes,
 * expiry, legal hold and retention. Older stores (`KycDocument`, the legacy
 * loan `Document` vault and `ApplicationDocument`) are linked into the library
 * when a customer's library is opened — their data is never moved or deleted.
 *
 * Every view and download is audited; downloads use short-lived links.
 */
@Injectable()
export class CustomerDocumentsService {
  private readonly logger = new Logger(CustomerDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly store: DocumentStorageService,
    private readonly adapters: AdapterRegistry,
  ) {}

  // ── Resources and scope ───────────────────────────────────────────────────

  private async borrowerOf(tx: Tx, tenantId: string, borrowerId: string) {
    const b = await tx.borrower.findFirst({
      where: { id: borrowerId, tenantId },
      select: { id: true, tenantId: true, branchId: true },
    });
    if (!b) throw new NotFoundException('Customer not found');
    return b;
  }

  /** The customer as the decision engine sees it: tenant, branch and owner. */
  private resource(
    b: { id: string; tenantId: string; branchId: string | null },
    makerIds: string[] = [],
    id?: string,
  ): Resource {
    return {
      type: 'CUSTOMER_DOCUMENT',
      id: id ?? b.id,
      tenantId: b.tenantId,
      branchId: b.branchId,
      ownerBorrowerId: b.id,
      dataClassification: 'CONFIDENTIAL',
      makerIds,
    };
  }

  private async documentOf(tx: Tx, tenantId: string, documentId: string) {
    const doc = await tx.customerDocument.findFirst({
      where: { id: documentId, tenantId },
      include: { versions: { orderBy: { version: 'asc' } } },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const borrower = await this.borrowerOf(tx, tenantId, doc.borrowerId);
    const current = doc.versions.find((v) => v.version === doc.currentVersion);
    if (!current) throw new NotFoundException('Document has no content');
    return { doc, borrower, current };
  }

  /**
   * Branches whose customers the actor may see for `permission`: 'ALL', a
   * list, or null for none. Portfolio- or legal-entity-only grants do not
   * reach customers, so they count as none.
   */
  private async branchScope(
    actor: LendingActor,
    permission: string,
  ): Promise<'ALL' | string[] | null> {
    const s = await this.policy.scopeFilter(actor, permission);
    if (!s) return null;
    const or = (s as { OR?: Record<string, unknown>[] }).OR;
    if (!or) return 'ALL';
    const ids = new Set<string>();
    for (const c of or) {
      const b = c.branchId as { in?: string[] } | undefined;
      if (b?.in && !c.legalEntityId) b.in.forEach((x) => ids.add(x));
    }
    return ids.size ? [...ids] : null;
  }

  private scopeWhere(
    scope: 'ALL' | string[],
  ): Prisma.CustomerDocumentWhereInput {
    return scope === 'ALL' ? {} : { borrower: { branchId: { in: scope } } };
  }

  // ── File handling ─────────────────────────────────────────────────────────

  decode(input: FileInput, allowed = ALLOWED_DOCUMENT_MIME): Decoded {
    if (!allowed.has(input.mimeType))
      throw new BadRequestException(
        'Accepted document types: PDF, JPEG, PNG, WebP.',
      );
    const raw = String(input.contentBase64 ?? '');
    if (!/^[A-Za-z0-9+/=\s]*$/.test(raw))
      throw new BadRequestException('contentBase64 is not base64.');
    const bytes = Buffer.from(raw, 'base64');
    if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES)
      throw new BadRequestException(
        'Documents must be between 1 byte and 3.5 MB.',
      );
    if (!sniffMatches(input.mimeType, bytes))
      throw new BadRequestException(
        `The file content is not a valid ${input.mimeType} file.`,
      );
    return {
      bytes,
      mimeType: input.mimeType,
      fileName: safeFileName(input.fileName),
      sha: sha256Bytes(bytes),
    };
  }

  /** Put the bytes in storage; the caller removes them if its transaction fails. */
  private async putObject(
    tenantId: string,
    borrowerId: string,
    documentId: string,
    version: number,
    file: Decoded,
  ) {
    const storage = this.store.storage();
    const key = libraryKey(tenantId, borrowerId, documentId, version);
    try {
      await storage.put(key, file.bytes, file.mimeType);
    } catch (e) {
      this.logger.error(`Document upload failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        'Document storage is unavailable. Please try again.',
      );
    }
    return { provider: storage.provider, key };
  }

  private async discard(provider: string, tenantId: string, key: string) {
    if (!['S3', 'LOCAL_DISK'].includes(provider)) return;
    const own = ownLibraryKey(tenantId, key);
    if (!own) return;
    await this.store
      .storage()
      .delete(own)
      .catch((e) =>
        this.logger.warn(`Could not remove ${own}: ${(e as Error).message}`),
      );
  }

  /**
   * Store a file and create its document (version 1) in one step. Runs the
   * database part in `tx`; on failure the stored object is removed.
   */
  private async createWithFile(tx: Tx, input: NewDocument, file: Decoded) {
    const id = randomUUID();
    const stored = await this.putObject(
      input.tenantId,
      input.borrowerId,
      id,
      1,
      file,
    );
    try {
      const doc = await tx.customerDocument.create({
        data: {
          id,
          tenantId: input.tenantId,
          borrowerId: input.borrowerId,
          category: input.category,
          typeCode: input.typeCode,
          title: input.title.slice(0, 160),
          applicationId: input.applicationId ?? null,
          loanAccountId: input.loanAccountId ?? null,
          collateralId: input.collateralId ?? null,
          requestId: input.requestId ?? null,
          origin: input.origin,
          customerVisible: input.customerVisible,
          reviewStatus: input.reviewStatus,
          issuedOn: input.issuedOn ? fromLocalDate(input.issuedOn) : null,
          expiresOn: input.expiresOn ? fromLocalDate(input.expiresOn) : null,
          createdBy: input.createdBy,
        },
      });
      const version = await tx.customerDocumentVersion.create({
        data: {
          tenantId: input.tenantId,
          documentId: id,
          version: 1,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.length,
          sha256: file.sha,
          storageProvider: stored.provider,
          storageKey: stored.key,
          uploadedBy: input.createdBy,
          uploaderType: input.uploaderType,
          note: (input.note ?? '').slice(0, 500),
          reviewStatus: input.reviewStatus,
        },
      });
      return { ...doc, versions: [version] };
    } catch (e) {
      await this.discard(stored.provider, input.tenantId, stored.key);
      throw e;
    }
  }

  private validateDates(issuedOn?: string | null, expiresOn?: string | null) {
    if (issuedOn) lending.parseDate(issuedOn, 'issuedOn');
    if (expiresOn) lending.parseDate(expiresOn, 'expiresOn');
    if (issuedOn && expiresOn && lending.compareDates(expiresOn, issuedOn) < 0)
      throw new BadRequestException(
        'A document cannot expire before it is issued.',
      );
  }

  private validateCategory(category: string, typeCode: string) {
    if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(category))
      throw new BadRequestException('Unknown document category.');
    if (!/^[A-Z0-9_]{2,40}$/.test(typeCode))
      throw new BadRequestException('Invalid document type code.');
  }

  /** Links must name the same customer's application, loan or collateral. */
  private async validateLinks(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
    links: {
      applicationId?: string | null;
      loanAccountId?: string | null;
      collateralId?: string | null;
    },
  ) {
    if (links.applicationId) {
      const a = await tx.application.findFirst({
        where: { id: links.applicationId, tenantId, borrowerId },
        select: { id: true },
      });
      if (!a)
        throw new BadRequestException(
          'The application does not belong to this customer.',
        );
    }
    if (links.loanAccountId) {
      const l = await tx.loanAccount.findFirst({
        where: { id: links.loanAccountId, tenantId, borrowerId },
        select: { id: true },
      });
      if (!l)
        throw new BadRequestException(
          'The loan does not belong to this customer.',
        );
    }
    if (links.collateralId) {
      const c = await tx.collateralAsset.findFirst({
        where: { id: links.collateralId, tenantId, borrowerId },
        select: { id: true },
      });
      if (!c)
        throw new BadRequestException(
          'The collateral does not belong to this customer.',
        );
    }
  }

  // ── Library (DOC-1) ───────────────────────────────────────────────────────

  /** The customer's library: documents, requests and the checklist. */
  async library(
    actor: LendingActor,
    borrowerId: string,
    q: { includeDeleted?: boolean } = {},
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const b = await this.borrowerOf(tx, tenantId, borrowerId);
      await this.policy.enforce(actor, 'document.read', this.resource(b), tx);
      await this.linkLegacy(tx, tenantId, borrowerId);
      const today = await this.businessDate.get(tenantId, tx);
      const docs = await tx.customerDocument.findMany({
        where: {
          tenantId,
          borrowerId,
          ...(q.includeDeleted ? {} : { status: 'ACTIVE' }),
        },
        include: { versions: { orderBy: { version: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      });
      const requests = await tx.documentRequest.findMany({
        where: { tenantId, borrowerId },
        orderBy: { createdAt: 'desc' },
      });
      const rules = await tx.documentRetentionRule.findMany({
        where: { tenantId },
      });
      const checklist = await this.customerChecklist(tx, tenantId, borrowerId);
      await this.audit.write(
        {
          actor,
          action: 'document.library.view',
          resourceType: 'Borrower',
          resourceId: borrowerId,
          outcome: 'SUCCESS',
          details: { documents: docs.length },
        },
        tx,
      );
      return {
        borrowerId,
        businessDate: today,
        documents: docs.map((d) => this.present(d, today, rules)),
        requests: requests.map(presentRequest),
        checklist,
      };
    });
  }

  /** One document with its version history and access trail. */
  async get(actor: LendingActor, documentId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { doc, borrower } = await this.documentOf(tx, tenantId, documentId);
      await this.policy.enforce(
        actor,
        'document.read',
        this.resource(borrower, [], doc.id),
        tx,
      );
      const today = await this.businessDate.get(tenantId, tx);
      const rules = await tx.documentRetentionRule.findMany({
        where: { tenantId },
      });
      const retention = await this.retention(tx, doc, rules, today);
      await this.audit.write(
        {
          actor,
          action: 'document.view',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: { version: doc.currentVersion },
        },
        tx,
      );
      const trail = await tx.auditEvent.findMany({
        where: {
          tenantId,
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
        },
        orderBy: { eventTime: 'desc' },
        take: 100,
        select: {
          id: true,
          actorId: true,
          actorType: true,
          action: true,
          outcome: true,
          eventTime: true,
          details: true,
        },
      });
      const request = doc.requestId
        ? await tx.documentRequest.findFirst({
            where: { id: doc.requestId, tenantId },
          })
        : null;
      return {
        ...this.present(
          { ...doc, versions: [...doc.versions].reverse() },
          today,
          rules,
        ),
        retention,
        request: request ? presentRequest(request) : null,
        accessLog: trail,
      };
    });
  }

  private present(
    d: Prisma.CustomerDocumentGetPayload<{ include: { versions: true } }>,
    today: string,
    rules: { scope: string; code: string; retentionYears: number }[],
  ) {
    const expires = toLocalDate(d.expiresOn);
    const daysToExpiry = expires ? lending.daysBetween(today, expires) : null;
    return {
      id: d.id,
      borrowerId: d.borrowerId,
      category: d.category,
      typeCode: d.typeCode,
      title: d.title,
      applicationId: d.applicationId,
      loanAccountId: d.loanAccountId,
      legacyLoanId: d.legacyLoanId,
      collateralId: d.collateralId,
      requestId: d.requestId,
      origin: d.origin,
      customerVisible: d.customerVisible,
      reviewStatus: d.reviewStatus,
      currentVersion: d.currentVersion,
      issuedOn: toLocalDate(d.issuedOn),
      expiresOn: expires,
      daysToExpiry,
      expired: daysToExpiry !== null && daysToExpiry < 0,
      expiryState: d.expiryState,
      legalHold: d.legalHold,
      legalHoldReason: d.legalHoldReason,
      status: d.status,
      deletedAt: d.deletedAt,
      deletionReason: d.deletionReason,
      legacySource: d.legacySource,
      retentionYears: retentionYearsFor(d, rules).years,
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      versions: d.versions.map((v) => ({
        id: v.id,
        version: v.version,
        fileName: v.fileName,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        sha256: v.sha256,
        storageProvider: v.storageProvider,
        uploadedBy: v.uploadedBy,
        uploaderType: v.uploaderType,
        note: v.note,
        reviewStatus: v.reviewStatus,
        reviewedBy: v.reviewedBy,
        reviewedAt: v.reviewedAt,
        rejectionReason: v.rejectionReason,
        purged: !!v.purgedAt,
        createdAt: v.createdAt,
      })),
    };
  }

  // ── Upload and versions (DOC-2, DOC-5) ────────────────────────────────────

  async upload(actor: LendingActor, borrowerId: string, body: UploadInput) {
    const tenantId = requireTenant(actor);
    this.validateCategory(body.category, body.typeCode);
    this.validateDates(body.issuedOn, body.expiresOn);
    const file = this.decode(body);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const b = await this.borrowerOf(tx, tenantId, borrowerId);
      await this.policy.enforce(actor, 'document.upload', this.resource(b), tx);
      await this.validateLinks(tx, tenantId, borrowerId, body);
      const doc = await this.createWithFile(
        tx,
        {
          tenantId,
          borrowerId,
          category: body.category,
          typeCode: body.typeCode,
          title: body.title || body.typeCode,
          origin: 'STAFF',
          customerVisible: false,
          reviewStatus: 'PENDING_REVIEW',
          applicationId: body.applicationId,
          loanAccountId: body.loanAccountId,
          collateralId: body.collateralId,
          issuedOn: body.issuedOn,
          expiresOn: body.expiresOn,
          note: body.note,
          createdBy: actor.id,
          uploaderType: 'USER',
        },
        file,
      );
      await this.audit.write(
        {
          actor,
          action: 'document.upload',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: {
            borrowerId,
            category: doc.category,
            typeCode: doc.typeCode,
            sizeBytes: file.bytes.length,
            sha256: file.sha,
            storage: doc.versions[0].storageProvider,
          },
        },
        tx,
      );
      return doc;
    });
  }

  /**
   * Write-through for `POST /lending/applications/:id/documents`: the file
   * goes to the library (linked to the application); the caller records the
   * `ApplicationDocument` row against the same stored object.
   */
  async fileForApplication(
    tx: Tx,
    actor: LendingActor,
    app: { id: string; tenantId: string; borrowerId: string },
    code: string,
    input: FileInput,
  ) {
    const file = this.decode(input);
    const doc = await this.createWithFile(
      tx,
      {
        tenantId: app.tenantId,
        borrowerId: app.borrowerId,
        category: 'APPLICATION',
        typeCode: code,
        title: code,
        origin: 'STAFF',
        customerVisible: false,
        reviewStatus: 'PENDING_REVIEW',
        applicationId: app.id,
        createdBy: actor.id,
        uploaderType: 'USER',
      },
      file,
    );
    const v = doc.versions[0];
    return {
      document: doc,
      file: {
        fileName: v.fileName,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        sha256: v.sha256,
        storageProvider: v.storageProvider,
        storageKey: v.storageKey,
      },
      /** Mark the ApplicationDocument row as this document so it is not linked twice. */
      bind: (applicationDocumentId: string) =>
        tx.customerDocument.update({
          where: { id: doc.id },
          data: {
            legacySource: 'APPLICATION_DOCUMENT',
            legacyId: applicationDocumentId,
          },
        }),
    };
  }

  /** Replace a document: a new version; earlier versions stay (DOC-5). */
  async replace(
    actor: LendingActor,
    documentId: string,
    body: FileInput & { note?: string; issuedOn?: string; expiresOn?: string },
  ) {
    const tenantId = requireTenant(actor);
    this.validateDates(body.issuedOn, body.expiresOn);
    const file = this.decode(body);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { doc, borrower } = await this.documentOf(tx, tenantId, documentId);
      await this.policy.enforce(
        actor,
        'document.upload',
        this.resource(borrower, [], doc.id),
        tx,
      );
      const updated = await this.addVersion(tx, doc, file, {
        uploadedBy: actor.id,
        uploaderType: 'USER',
        note: body.note,
        issuedOn: body.issuedOn,
        expiresOn: body.expiresOn,
      });
      await this.audit.write(
        {
          actor,
          action: 'document.replace',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: {
            version: updated.currentVersion,
            previous: doc.currentVersion,
            sizeBytes: file.bytes.length,
            sha256: file.sha,
          },
        },
        tx,
      );
      return updated;
    });
  }

  private async addVersion(
    tx: Tx,
    doc: {
      id: string;
      tenantId: string;
      borrowerId: string;
      currentVersion: number;
      status: string;
      expiresOn: Date | null;
    },
    file: Decoded,
    meta: {
      uploadedBy: string;
      uploaderType: 'USER' | 'CUSTOMER';
      note?: string;
      issuedOn?: string;
      expiresOn?: string;
    },
  ) {
    if (doc.status !== 'ACTIVE')
      throw new ConflictException('This document has been deleted.');
    const next = doc.currentVersion + 1;
    const stored = await this.putObject(
      doc.tenantId,
      doc.borrowerId,
      doc.id,
      next,
      file,
    );
    try {
      await tx.customerDocumentVersion.create({
        data: {
          tenantId: doc.tenantId,
          documentId: doc.id,
          version: next,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.length,
          sha256: file.sha,
          storageProvider: stored.provider,
          storageKey: stored.key,
          uploadedBy: meta.uploadedBy,
          uploaderType: meta.uploaderType,
          note: (meta.note ?? '').slice(0, 500),
        },
      });
      const newExpiry = meta.expiresOn !== undefined;
      // Compare-and-set on the version: two concurrent replacements cannot
      // both become version n+1 (the unique (documentId, version) also holds).
      const n = await tx.customerDocument.updateMany({
        where: {
          id: doc.id,
          tenantId: doc.tenantId,
          currentVersion: doc.currentVersion,
        },
        data: {
          currentVersion: next,
          reviewStatus: 'PENDING_REVIEW',
          ...(meta.issuedOn ? { issuedOn: fromLocalDate(meta.issuedOn) } : {}),
          ...(newExpiry
            ? {
                expiresOn: meta.expiresOn
                  ? fromLocalDate(meta.expiresOn)
                  : null,
                expiryState: 'NONE',
                reminderSentOn: null,
              }
            : {}),
        },
      });
      if (n.count !== 1)
        throw new ConflictException(
          'The document was changed by another request. Reload and try again.',
        );
    } catch (e) {
      await this.discard(stored.provider, doc.tenantId, stored.key);
      throw e;
    }
    return tx.customerDocument.findFirstOrThrow({
      where: { id: doc.id, tenantId: doc.tenantId },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
  }

  /** Correct the issue and expiry dates of a document (DOC-6). */
  async setExpiry(
    actor: LendingActor,
    documentId: string,
    body: { issuedOn?: string | null; expiresOn?: string | null },
  ) {
    const tenantId = requireTenant(actor);
    this.validateDates(body.issuedOn, body.expiresOn);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { doc, borrower } = await this.documentOf(tx, tenantId, documentId);
      await this.policy.enforce(
        actor,
        'document.upload',
        this.resource(borrower, [], doc.id),
        tx,
      );
      if (doc.status !== 'ACTIVE')
        throw new ConflictException('This document has been deleted.');
      const updated = await tx.customerDocument.update({
        where: { id: doc.id },
        data: {
          ...(body.issuedOn !== undefined
            ? { issuedOn: body.issuedOn ? fromLocalDate(body.issuedOn) : null }
            : {}),
          ...(body.expiresOn !== undefined
            ? {
                expiresOn: body.expiresOn
                  ? fromLocalDate(body.expiresOn)
                  : null,
                expiryState: 'NONE',
                reminderSentOn: null,
              }
            : {}),
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'document.expiry.set',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: {
            from: {
              issuedOn: toLocalDate(doc.issuedOn),
              expiresOn: toLocalDate(doc.expiresOn),
            },
            to: {
              issuedOn: toLocalDate(updated.issuedOn),
              expiresOn: toLocalDate(updated.expiresOn),
            },
          },
        },
        tx,
      );
      return updated;
    });
  }

  // ── Review (DOC-4) ────────────────────────────────────────────────────────

  /** Accept or reject the current version. The reviewer is never its uploader. */
  async review(
    actor: LendingActor,
    documentId: string,
    body: { decision: 'ACCEPT' | 'REJECT'; reason?: string },
  ) {
    const tenantId = requireTenant(actor);
    const reason = (body.reason ?? '').trim();
    if (body.decision === 'REJECT' && reason.length < 3)
      throw new BadRequestException('A rejection needs a reason.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { doc, borrower, current } = await this.documentOf(
        tx,
        tenantId,
        documentId,
      );
      await this.policy.enforce(
        actor,
        'document.review',
        this.resource(borrower, [current.uploadedBy], doc.id),
        tx,
      );
      if (doc.status !== 'ACTIVE')
        throw new ConflictException('This document has been deleted.');
      if (current.reviewStatus !== 'PENDING_REVIEW')
        throw new ConflictException(
          `Version ${current.version} is already ${current.reviewStatus.toLowerCase().replace('_', ' ')}.`,
        );
      const status = body.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
      const now = new Date();
      const n = await tx.customerDocumentVersion.updateMany({
        where: { id: current.id, tenantId, reviewStatus: 'PENDING_REVIEW' },
        data: {
          reviewStatus: status,
          reviewedBy: actor.id,
          reviewedAt: now,
          rejectionReason: status === 'REJECTED' ? reason.slice(0, 500) : null,
        },
      });
      if (n.count !== 1)
        throw new ConflictException(
          'This version was reviewed by someone else.',
        );
      await tx.customerDocument.update({
        where: { id: doc.id },
        data: { reviewStatus: status },
      });
      if (doc.requestId) {
        await tx.documentRequest.updateMany({
          where: {
            id: doc.requestId,
            tenantId,
            status: { in: ['OPEN', 'SUBMITTED'] },
          },
          data:
            status === 'ACCEPTED'
              ? { status: 'ACCEPTED', lastRejection: null }
              : { status: 'OPEN', lastRejection: reason.slice(0, 500) },
        });
      }
      if (status === 'REJECTED' && doc.customerVisible) {
        await tx.outboxMessage.create({
          data: {
            tenantId,
            topic: 'document.rejected',
            payload: {
              documentId: doc.id,
              borrowerId: doc.borrowerId,
              typeCode: doc.typeCode,
              reason: reason.slice(0, 500),
            },
          },
        });
      }
      await this.audit.write(
        {
          actor,
          action: 'document.review',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: {
            version: current.version,
            decision: status,
            reason: status === 'REJECTED' ? reason.slice(0, 500) : undefined,
            uploadedBy: current.uploadedBy,
          },
        },
        tx,
      );
      return { id: doc.id, version: current.version, reviewStatus: status };
    });
  }

  /** Documents awaiting review in the actor's scope (DOC-4). */
  async reviewQueue(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    const scope = await this.branchScope(actor, 'document.review');
    if (!scope) return { documents: [] };
    const docs = await this.prisma.customerDocument.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        reviewStatus: 'PENDING_REVIEW',
        ...this.scopeWhere(scope),
      },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
        borrower: {
          select: { firstName: true, lastName: true, branchId: true },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    return {
      documents: docs.map((d) => ({
        id: d.id,
        borrowerId: d.borrowerId,
        customer: `${d.borrower.firstName} ${d.borrower.lastName}`,
        branchId: d.borrower.branchId,
        category: d.category,
        typeCode: d.typeCode,
        title: d.title,
        origin: d.origin,
        version: d.currentVersion,
        fileName: d.versions[0]?.fileName,
        uploadedBy: d.versions[0]?.uploadedBy,
        uploadedAt: d.versions[0]?.createdAt,
        expiresOn: toLocalDate(d.expiresOn),
        /** You cannot review what you uploaded. */
        ownUpload: d.versions[0]?.uploadedBy === actor.id,
      })),
    };
  }

  // ── Access (DOC-8) ────────────────────────────────────────────────────────

  /**
   * A short-lived download link for one version. S3 objects get a pre-signed
   * URL; everything else an API link signed for this tenant and version.
   */
  async link(actor: LendingActor, documentId: string, version?: number) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { doc, borrower, current } = await this.documentOf(
        tx,
        tenantId,
        documentId,
      );
      await this.policy.enforce(
        actor,
        'document.read',
        this.resource(borrower, [], doc.id),
        tx,
      );
      const v = version
        ? doc.versions.find((x) => x.version === version)
        : current;
      if (!v) throw new NotFoundException('No such version');
      return this.issueLink(tx, actor, doc, v);
    });
  }

  private async issueLink(
    tx: Tx,
    actor: Actorish,
    doc: {
      id: string;
      tenantId: string;
      status: string;
      legacyLoanId: string | null;
    },
    v: {
      id: string;
      version: number;
      storageProvider: string;
      storageKey: string;
      fileName: string;
      purgedAt: Date | null;
    },
  ) {
    if (doc.status !== 'ACTIVE' || v.purgedAt)
      throw new GoneException(
        'This document has been deleted under the retention policy.',
      );
    const ttl = this.store.linkTtlSeconds();
    const expiresAt = Date.now() + ttl * 1000;
    let url: string | null = null;
    if (v.storageProvider === 'S3') {
      const key = ownLibraryKey(doc.tenantId, v.storageKey);
      if (!key)
        throw new NotFoundException(
          'This document is not held in the document store.',
        );
      url = await this.store.storage().presign(key, ttl, v.fileName);
    }
    const external = !!url;
    if (!url) {
      url = `/lending/document-links/${this.store.signLink({
        tenantId: doc.tenantId,
        versionId: v.id,
        actorId: actor.id,
        expiresAt,
      })}`;
    }
    await this.audit.write(
      {
        actor,
        action: 'document.download_link',
        resourceType: 'CustomerDocument',
        resourceId: doc.id,
        outcome: 'SUCCESS',
        details: { version: v.version, ttlSeconds: ttl, external },
      },
      tx,
    );
    return {
      url,
      external,
      expiresAt: new Date(expiresAt).toISOString(),
      fileName: v.fileName,
    };
  }

  /** Serve a signed link (public route: the token is the credential). */
  async serveLink(token: string) {
    const claims = this.store.verifyLink(token, Date.now());
    if (!claims)
      throw new NotFoundException('This link is invalid or has expired.');
    return this.lp.tenantTx(claims.tenantId, async (tx) => {
      const v = await tx.customerDocumentVersion.findFirst({
        where: { id: claims.versionId, tenantId: claims.tenantId },
        include: { document: true },
      });
      if (!v || v.document.status !== 'ACTIVE' || v.purgedAt)
        throw new NotFoundException('This link is invalid or has expired.');
      const bytes = await this.readVersion(tx, v.document, v);
      await this.audit.write(
        {
          actor: {
            id: claims.actorId,
            type: 'SERVICE',
            tenantId: claims.tenantId,
          },
          action: 'document.download',
          resourceType: 'CustomerDocument',
          resourceId: v.documentId,
          outcome: 'SUCCESS',
          details: { version: v.version, via: 'signed-link' },
        },
        tx,
      );
      return { bytes, mimeType: v.mimeType, fileName: v.fileName };
    });
  }

  /** Read a version's bytes from wherever it is held, inside the tenant wall. */
  private async readVersion(
    tx: Tx,
    doc: {
      tenantId: string;
      legacyLoanId: string | null;
      legacyId: string | null;
    },
    v: { storageProvider: string; storageKey: string },
  ): Promise<Buffer> {
    const tenantId = doc.tenantId;
    const missing = () =>
      new NotFoundException('This document is not held in the document store.');
    switch (v.storageProvider) {
      case 'S3':
      case 'LOCAL_DISK': {
        const key = ownLibraryKey(tenantId, v.storageKey);
        if (!key) throw missing();
        return this.store.storage().get(key);
      }
      case 'LEGACY_KYC': {
        const k = await tx.kycDocument.findFirst({
          where: { id: v.storageKey, tenantId },
          select: { content: true },
        });
        const data = k ? decodeDataUri(decryptField(k.content) ?? '') : null;
        if (!data) throw missing();
        return data;
      }
      case 'LEGACY_VAULT': {
        const d = await tx.document.findFirst({
          where: { id: doc.legacyId ?? '', tenantId },
          select: { tenantId: true, loanId: true, content: true },
        });
        if (!d) throw missing();
        const inline = decodeDataUri(d.content);
        if (inline) return inline;
        const key = ownStorageKey(d);
        if (!key) throw missing();
        return this.store.storage().provider === 'S3'
          ? this.store.storage().get(key)
          : Promise.reject(missing());
      }
      case 'LEGACY_APPLICATION': {
        const key = v.storageKey;
        // The application store's own tenant prefixes (S3 and local adapter).
        if (
          !(
            key.startsWith(`lending/${tenantId}/`) ||
            key.startsWith(`${tenantId}/`)
          ) ||
          key.includes('..')
        )
          throw missing();
        return this.adapters.documents().get(key);
      }
      default:
        throw missing();
    }
  }

  // ── Customer self-service (DOC-10) ────────────────────────────────────────

  /** What the bank has asked this customer for, with any rejection reason. */
  async ownRequests(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const b = await this.borrowerOf(tx, tenantId, actor.id);
      await this.policy.enforce(
        actor,
        'document.read_own',
        this.resource(b),
        tx,
      );
      const rows = await tx.documentRequest.findMany({
        where: { tenantId, borrowerId: b.id, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
      });
      return { requests: rows.map(presentRequest) };
    });
  }

  /** The customer's own documents visible to them (their uploads and letters). */
  async ownDocuments(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const b = await this.borrowerOf(tx, tenantId, actor.id);
      await this.policy.enforce(
        actor,
        'document.read_own',
        this.resource(b),
        tx,
      );
      const docs = await tx.customerDocument.findMany({
        where: {
          tenantId,
          borrowerId: b.id,
          status: 'ACTIVE',
          customerVisible: true,
        },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'desc' },
      });
      return {
        documents: docs.map((d) => ({
          id: d.id,
          category: d.category,
          typeCode: d.typeCode,
          title: d.title,
          reviewStatus: d.reviewStatus,
          rejectionReason: d.versions[0]?.rejectionReason ?? null,
          expiresOn: toLocalDate(d.expiresOn),
          fileName: d.versions[0]?.fileName,
          mimeType: d.versions[0]?.mimeType,
          createdAt: d.createdAt,
        })),
      };
    });
  }

  /** Stream one of the customer's own documents (audited). */
  async downloadOwn(actor: LendingActor, documentId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const doc = await tx.customerDocument.findFirst({
        where: {
          id: documentId,
          tenantId,
          borrowerId: actor.id,
          status: 'ACTIVE',
          customerVisible: true,
        },
        include: { versions: true },
      });
      if (!doc) throw new NotFoundException('Document not found');
      const b = await this.borrowerOf(tx, tenantId, doc.borrowerId);
      await this.policy.enforce(
        actor,
        'document.read_own',
        this.resource(b, [], doc.id),
        tx,
      );
      const v = doc.versions.find((x) => x.version === doc.currentVersion);
      if (!v || v.purgedAt)
        throw new GoneException('This document is no longer held.');
      const bytes = await this.readVersion(tx, doc, v);
      await this.audit.write(
        {
          actor,
          action: 'document.download',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: { version: v.version, via: 'portal' },
        },
        tx,
      );
      return { bytes, mimeType: v.mimeType, fileName: v.fileName };
    });
  }

  /** The customer uploads against a request; a re-upload is a new version. */
  async uploadAgainstRequest(
    actor: LendingActor,
    requestId: string,
    body: FileInput,
  ) {
    const tenantId = requireTenant(actor);
    const file = this.decode(body);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const req = await tx.documentRequest.findFirst({
        where: { id: requestId, tenantId, borrowerId: actor.id },
      });
      if (!req) throw new NotFoundException('Request not found');
      const b = await this.borrowerOf(tx, tenantId, req.borrowerId);
      await this.policy.enforce(
        actor,
        'document.upload_own',
        this.resource(b, [], req.id),
        tx,
      );
      if (!['OPEN', 'SUBMITTED'].includes(req.status))
        throw new ConflictException(
          req.status === 'ACCEPTED'
            ? 'This document has already been accepted.'
            : 'This request has been withdrawn.',
        );
      const existing = req.documentId
        ? await tx.customerDocument.findFirst({
            where: {
              id: req.documentId,
              tenantId,
              borrowerId: b.id,
              status: 'ACTIVE',
            },
          })
        : null;
      const doc = existing
        ? await this.addVersion(tx, existing, file, {
            uploadedBy: actor.id,
            uploaderType: 'CUSTOMER',
          })
        : await this.createWithFile(
            tx,
            {
              tenantId,
              borrowerId: b.id,
              category: req.category,
              typeCode: req.typeCode,
              title: req.label,
              origin: 'PORTAL',
              customerVisible: true,
              reviewStatus: 'PENDING_REVIEW',
              applicationId: req.applicationId,
              loanAccountId: req.loanAccountId,
              requestId: req.id,
              createdBy: actor.id,
              uploaderType: 'CUSTOMER',
            },
            file,
          );
      await tx.documentRequest.update({
        where: { id: req.id },
        data: {
          status: 'SUBMITTED',
          documentId: doc.id,
          fulfilledAt: new Date(),
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'document.upload',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: {
            requestId: req.id,
            version: doc.currentVersion,
            sizeBytes: file.bytes.length,
            sha256: file.sha,
            via: 'portal',
          },
        },
        tx,
      );
      return {
        requestId: req.id,
        documentId: doc.id,
        version: doc.currentVersion,
        status: 'SUBMITTED',
      };
    });
  }

  /**
   * Write-through for the portal e-KYC upload (`POST /borrower/kyc/documents`):
   * the file goes to the library and the `KycDocument` row points at it
   * instead of holding the image. Returns null when the content is not an
   * inline file the library accepts (e.g. a URL), so the caller keeps its
   * old behaviour.
   */
  async fileKycFromPortal(
    session: { borrowerId: string; tenantId: string },
    type: string,
    content: string,
    declaredMime?: string | null,
  ): Promise<{
    documentId: string;
    kycDocumentId: string;
    createdAt: Date;
  } | null> {
    const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(content);
    if (!m) return null;
    const mimeType =
      declaredMime && ALLOWED_DOCUMENT_MIME.has(declaredMime)
        ? declaredMime
        : m[1];
    const file = this.decode({
      fileName: `${type.toLowerCase()}`,
      mimeType,
      contentBase64: m[2],
    });
    const typeCode = /^[A-Z0-9_]{2,40}$/.test(type) ? type : 'OTHER';
    return this.lp.tenantTx(session.tenantId, async (tx) => {
      const b = await this.borrowerOf(tx, session.tenantId, session.borrowerId);
      const doc = await this.createWithFile(
        tx,
        {
          tenantId: b.tenantId,
          borrowerId: b.id,
          category: 'KYC',
          typeCode,
          title: typeCode.replace(/_/g, ' ').toLowerCase(),
          origin: 'PORTAL',
          customerVisible: true,
          reviewStatus: 'PENDING_REVIEW',
          createdBy: b.id,
          uploaderType: 'CUSTOMER',
        },
        file,
      );
      const kyc = await tx.kycDocument.create({
        data: {
          tenantId: b.tenantId,
          borrowerId: b.id,
          type,
          content: `library:${doc.id}`,
          mimeType,
        },
      });
      await tx.customerDocument.update({
        where: { id: doc.id },
        data: { legacySource: 'KYC_DOCUMENT', legacyId: kyc.id },
      });
      await this.audit.write(
        {
          actor: { id: b.id, type: 'CUSTOMER', tenantId: b.tenantId },
          action: 'document.upload',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: {
            category: 'KYC',
            typeCode,
            sizeBytes: file.bytes.length,
            sha256: file.sha,
            via: 'portal-kyc',
          },
        },
        tx,
      );
      return {
        documentId: doc.id,
        kycDocumentId: kyc.id,
        createdAt: kyc.createdAt,
      };
    });
  }

  /**
   * Staff KYC review screen: a short-lived link for a library-held KYC file
   * (the `KycDocument` row only points at it). Audited like any download.
   */
  async kycLink(
    actor: Actorish,
    tenantId: string,
    documentId: string,
  ): Promise<string | null> {
    return this.lp.tenantTx(tenantId, async (tx) => {
      const doc = await tx.customerDocument.findFirst({
        where: { id: documentId, tenantId },
        include: { versions: true },
      });
      const v = doc?.versions.find((x) => x.version === doc.currentVersion);
      if (!doc || !v || doc.status !== 'ACTIVE' || v.purgedAt) return null;
      const l = await this.issueLink(tx, actor, doc, v);
      return l.url;
    });
  }

  // ── Requests (DOC-10, staff side) ─────────────────────────────────────────

  async createRequest(
    actor: LendingActor,
    borrowerId: string,
    body: {
      category: string;
      typeCode: string;
      label: string;
      message?: string;
      applicationId?: string;
      loanAccountId?: string;
      dueOn?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    this.validateCategory(body.category, body.typeCode);
    if (body.dueOn) lending.parseDate(body.dueOn, 'dueOn');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const b = await this.borrowerOf(tx, tenantId, borrowerId);
      await this.policy.enforce(actor, 'document.upload', this.resource(b), tx);
      await this.validateLinks(tx, tenantId, borrowerId, body);
      const open = await tx.documentRequest.findFirst({
        where: {
          tenantId,
          borrowerId,
          typeCode: body.typeCode,
          applicationId: body.applicationId ?? null,
          status: { in: ['OPEN', 'SUBMITTED'] },
        },
      });
      if (open)
        throw new ConflictException(
          'This document has already been requested and is still open.',
        );
      const req = await tx.documentRequest.create({
        data: {
          tenantId,
          borrowerId,
          category: body.category,
          typeCode: body.typeCode,
          label: body.label.slice(0, 120),
          message: (body.message ?? '').slice(0, 1000),
          applicationId: body.applicationId ?? null,
          loanAccountId: body.loanAccountId ?? null,
          dueOn: body.dueOn ? fromLocalDate(body.dueOn) : null,
          requestedBy: actor.id,
        },
      });
      await tx.outboxMessage.create({
        data: {
          tenantId,
          topic: 'document.requested',
          payload: {
            requestId: req.id,
            borrowerId,
            typeCode: req.typeCode,
            label: req.label,
            dueOn: body.dueOn ?? null,
          },
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'document.request',
          resourceType: 'Borrower',
          resourceId: borrowerId,
          outcome: 'SUCCESS',
          details: { requestId: req.id, typeCode: req.typeCode },
        },
        tx,
      );
      return presentRequest(req);
    });
  }

  async cancelRequest(actor: LendingActor, requestId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const req = await tx.documentRequest.findFirst({
        where: { id: requestId, tenantId },
      });
      if (!req) throw new NotFoundException('Request not found');
      const b = await this.borrowerOf(tx, tenantId, req.borrowerId);
      await this.policy.enforce(
        actor,
        'document.upload',
        this.resource(b, [], req.id),
        tx,
      );
      if (!['OPEN', 'SUBMITTED'].includes(req.status))
        throw new ConflictException(
          `The request is already ${req.status.toLowerCase()}.`,
        );
      const updated = await tx.documentRequest.update({
        where: { id: req.id },
        data: { status: 'CANCELLED', cancelledBy: actor.id },
      });
      await this.audit.write(
        {
          actor,
          action: 'document.request.cancel',
          resourceType: 'Borrower',
          resourceId: req.borrowerId,
          outcome: 'SUCCESS',
          details: { requestId: req.id },
        },
        tx,
      );
      return presentRequest(updated);
    });
  }

  // ── Checklists (DOC-3) ────────────────────────────────────────────────────

  /**
   * The application's required documents (product configuration) and the
   * status of each from the customer's library. Items of `stages` that are
   * not present block the stage.
   */
  async applicationChecklist(
    tx: Tx,
    app: {
      id: string;
      tenantId: string;
      borrowerId: string;
      productVersionId?: string;
    },
    stages?: string[],
    productConfig?: lending.ProductConfig,
  ) {
    await this.linkLegacy(tx, app.tenantId, app.borrowerId);
    let config = productConfig ?? null;
    if (!config) {
      const version = await tx.productVersion.findFirst({
        where: { id: app.productVersionId ?? '', tenantId: app.tenantId },
        select: { config: true },
      });
      config = parseConfig(version?.config).config;
    }
    const required = (config?.operations.requiredDocuments ?? []).filter(
      (d) => !stages || stages.includes(d.stage),
    );
    const today = await this.businessDate.get(app.tenantId, tx);
    const docs = await tx.customerDocument.findMany({
      where: {
        tenantId: app.tenantId,
        borrowerId: app.borrowerId,
        status: 'ACTIVE',
        typeCode: { in: required.map((r) => r.code) },
        // Customer-level documents count for any application; documents
        // filed for another application do not.
        OR: [{ applicationId: app.id }, { applicationId: null }],
      },
      select: { id: true, typeCode: true, reviewStatus: true, expiresOn: true },
    });
    const requests = await tx.documentRequest.findMany({
      where: {
        tenantId: app.tenantId,
        borrowerId: app.borrowerId,
        status: 'OPEN',
        OR: [{ applicationId: app.id }, { applicationId: null }],
      },
      select: { typeCode: true },
    });
    const requested = new Set(requests.map((r) => r.typeCode));
    return required.map((r) => {
      const mine = docs.filter((d) => d.typeCode === r.code);
      const status: ChecklistStatus = checklistStatus(
        mine,
        today,
        requested.has(r.code),
      );
      return {
        code: r.code,
        label: r.label,
        stage: r.stage,
        mandatory: r.mandatory,
        status,
        present: CHECKLIST_PRESENT.includes(status),
        documentIds: mine.map((d) => d.id),
      };
    });
  }

  /** Checklist of every open application of the customer. */
  private async customerChecklist(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
  ) {
    const apps = await tx.application.findMany({
      where: { tenantId, borrowerId, status: { in: OPEN_APPLICATION } },
      select: {
        id: true,
        tenantId: true,
        borrowerId: true,
        productVersionId: true,
        reference: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const out: {
      applicationId: string;
      reference: string;
      status: string;
      items: Awaited<
        ReturnType<CustomerDocumentsService['applicationChecklist']>
      >;
    }[] = [];
    for (const a of apps)
      out.push({
        applicationId: a.id,
        reference: a.reference,
        status: a.status,
        items: await this.applicationChecklist(tx, a),
      });
    return out;
  }

  async checklistForApplication(actor: LendingActor, applicationId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await tx.application.findFirst({
        where: { id: applicationId, tenantId },
        select: {
          id: true,
          tenantId: true,
          borrowerId: true,
          productVersionId: true,
          reference: true,
          status: true,
        },
      });
      if (!app) throw new NotFoundException('Application not found');
      const b = await this.borrowerOf(tx, tenantId, app.borrowerId);
      await this.policy.enforce(actor, 'document.read', this.resource(b), tx);
      return {
        applicationId: app.id,
        reference: app.reference,
        status: app.status,
        items: await this.applicationChecklist(tx, app),
      };
    });
  }

  async checklistForCustomer(actor: LendingActor, borrowerId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const b = await this.borrowerOf(tx, tenantId, borrowerId);
      await this.policy.enforce(actor, 'document.read', this.resource(b), tx);
      return {
        borrowerId,
        applications: await this.customerChecklist(tx, tenantId, borrowerId),
      };
    });
  }

  // ── Expiry (DOC-6) ────────────────────────────────────────────────────────

  /** Documents expired or expiring within `withinDays` in the actor's scope. */
  async expiries(actor: LendingActor, withinDays = 60) {
    const tenantId = requireTenant(actor);
    const scope = await this.branchScope(actor, 'document.read');
    const today = await this.businessDate.get(tenantId);
    if (!scope) return { businessDate: today, documents: [] };
    const horizon = lending.addDays(
      today,
      Math.min(Math.max(withinDays, 0), 366),
    );
    const docs = await this.prisma.customerDocument.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        expiresOn: { not: null, lte: fromLocalDate(horizon) },
        ...this.scopeWhere(scope),
      },
      include: {
        borrower: {
          select: { firstName: true, lastName: true, branchId: true },
        },
      },
      orderBy: { expiresOn: 'asc' },
      take: 500,
    });
    return {
      businessDate: today,
      documents: docs.map((d) => {
        const exp = toLocalDate(d.expiresOn)!;
        const days = lending.daysBetween(today, exp);
        return {
          id: d.id,
          borrowerId: d.borrowerId,
          customer: `${d.borrower.firstName} ${d.borrower.lastName}`,
          category: d.category,
          typeCode: d.typeCode,
          title: d.title,
          expiresOn: exp,
          daysToExpiry: days,
          expired: days < 0,
          expiryState: d.expiryState,
          reminderSentOn: toLocalDate(d.reminderSentOn),
        };
      }),
    };
  }

  /**
   * End-of-day expiry pass for one tenant: flag expired documents and raise
   * one reminder notice (outbox) per document entering the reminder window.
   * Idempotent: a document is reminded once and flagged once.
   */
  async runExpiry(tenantId: string, today: string) {
    const days = expiryReminderDays();
    const horizon = lending.addDays(today, days);
    const actor = documentsSystemActor(tenantId);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const expired = await tx.customerDocument.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          expiryState: { not: 'EXPIRED' },
          expiresOn: { lt: fromLocalDate(today) },
        },
        select: {
          id: true,
          borrowerId: true,
          typeCode: true,
          expiresOn: true,
          customerVisible: true,
        },
      });
      for (const d of expired) {
        await tx.customerDocument.update({
          where: { id: d.id },
          data: { expiryState: 'EXPIRED' },
        });
        await tx.outboxMessage.create({
          data: {
            tenantId,
            topic: 'document.expired',
            payload: {
              documentId: d.id,
              borrowerId: d.borrowerId,
              typeCode: d.typeCode,
              expiresOn: toLocalDate(d.expiresOn),
            } as Json,
          },
        });
        await this.audit.write(
          {
            actor,
            action: 'document.expired',
            resourceType: 'CustomerDocument',
            resourceId: d.id,
            outcome: 'SUCCESS',
            details: { expiresOn: toLocalDate(d.expiresOn) },
            businessDate: fromLocalDate(today),
          },
          tx,
        );
      }
      const due = await tx.customerDocument.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          expiryState: 'NONE',
          expiresOn: { gte: fromLocalDate(today), lte: fromLocalDate(horizon) },
        },
        select: { id: true, borrowerId: true, typeCode: true, expiresOn: true },
      });
      for (const d of due) {
        const exp = toLocalDate(d.expiresOn)!;
        await tx.customerDocument.update({
          where: { id: d.id },
          data: {
            expiryState: 'REMINDED',
            reminderSentOn: fromLocalDate(today),
          },
        });
        await tx.outboxMessage.create({
          data: {
            tenantId,
            topic: 'document.expiry_reminder',
            payload: {
              documentId: d.id,
              borrowerId: d.borrowerId,
              typeCode: d.typeCode,
              expiresOn: exp,
              daysLeft: lending.daysBetween(today, exp),
            },
          },
        });
        await this.audit.write(
          {
            actor,
            action: 'document.expiry_reminder',
            resourceType: 'CustomerDocument',
            resourceId: d.id,
            outcome: 'SUCCESS',
            details: { expiresOn: exp },
            businessDate: fromLocalDate(today),
          },
          tx,
        );
      }
      return {
        tenantId,
        businessDate: today,
        expired: expired.length,
        reminded: due.length,
      };
    });
  }

  /** Run the expiry pass now for the caller's tenant, as of its business date. */
  async runExpiryNow(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'document.expiry.run',
      tenantResource(tenantId),
    );
    const today = await this.businessDate.get(tenantId);
    return this.runExpiry(tenantId, today);
  }

  /** Every tenant holding documents with an expiry date (the daily job). */
  async runExpiryAllTenants() {
    const tenants: { tenantId: string }[] = await runAsSystem(
      'document expiry: tenants',
      () =>
        this.prisma.customerDocument.findMany({
          where: { status: 'ACTIVE', expiresOn: { not: null } },
          distinct: ['tenantId'],
          select: { tenantId: true },
        }),
    );
    const results: Awaited<
      ReturnType<CustomerDocumentsService['runExpiry']>
    >[] = [];
    for (const { tenantId } of tenants) {
      try {
        const today = await this.businessDate.get(tenantId);
        results.push(await this.runExpiry(tenantId, today));
      } catch (e) {
        this.logger.error(
          `Document expiry failed for ${tenantId}: ${(e as Error).message}`,
        );
      }
    }
    return results;
  }

  // ── Retention and legal hold (DOC-7) ──────────────────────────────────────

  /**
   * When the document may be deleted: its retention period counted from the
   * later of its filing and the end of the customer relationship. While the
   * customer has an open application or a live loan the clock has not started.
   */
  private async retention(
    tx: Tx,
    doc: {
      tenantId: string;
      borrowerId: string;
      category: string;
      typeCode: string;
      createdAt: Date;
    },
    rules: { scope: string; code: string; retentionYears: number }[],
    today: string,
  ) {
    const { years, source } = retentionYearsFor(doc, rules);
    const [openApps, liveLoans, lastClosed] = await Promise.all([
      tx.application.count({
        where: {
          tenantId: doc.tenantId,
          borrowerId: doc.borrowerId,
          status: { in: OPEN_APPLICATION.filter((s) => s !== 'BOOKED') },
        },
      }),
      tx.loanAccount.count({
        where: {
          tenantId: doc.tenantId,
          borrowerId: doc.borrowerId,
          status: { in: LIVE_LOAN },
        },
      }),
      tx.loanAccount.findFirst({
        where: {
          tenantId: doc.tenantId,
          borrowerId: doc.borrowerId,
          closedAt: { not: null },
        },
        orderBy: { closedAt: 'desc' },
        select: { closedAt: true },
      }),
    ]);
    const filed = doc.createdAt.toISOString().slice(0, 10);
    if (openApps || liveLoans)
      return {
        years,
        source,
        relationshipOpen: true,
        retainUntil: null as string | null,
        eligibleForDeletion: false,
      };
    const closed = lastClosed?.closedAt?.toISOString().slice(0, 10);
    const from = closed && closed > filed ? closed : filed;
    const retainUntil = addYears(from, years);
    return {
      years,
      source,
      relationshipOpen: false,
      retainUntil,
      eligibleForDeletion: lending.compareDates(today, retainUntil) >= 0,
    };
  }

  async setLegalHold(
    actor: LendingActor,
    documentId: string,
    body: { hold: boolean; reason: string },
  ) {
    const tenantId = requireTenant(actor);
    const reason = (body.reason ?? '').trim();
    if (reason.length < 3)
      throw new BadRequestException('A reason is required.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { doc, borrower } = await this.documentOf(tx, tenantId, documentId);
      await this.policy.enforce(
        actor,
        'document.manage',
        this.resource(borrower, [], doc.id),
        tx,
      );
      if (doc.status !== 'ACTIVE')
        throw new ConflictException('This document has been deleted.');
      if (doc.legalHold === body.hold)
        throw new ConflictException(
          body.hold ? 'Already under legal hold.' : 'Not under legal hold.',
        );
      const updated = await tx.customerDocument.update({
        where: { id: doc.id },
        data: body.hold
          ? {
              legalHold: true,
              legalHoldReason: reason.slice(0, 500),
              legalHoldBy: actor.id,
              legalHoldAt: new Date(),
            }
          : {
              legalHold: false,
              legalHoldReason: null,
              legalHoldBy: null,
              legalHoldAt: null,
            },
      });
      await this.audit.write(
        {
          actor,
          action: body.hold
            ? 'document.legal_hold.place'
            : 'document.legal_hold.release',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: {
            reason: reason.slice(0, 500),
            previousReason: doc.legalHoldReason,
          },
        },
        tx,
      );
      return {
        id: updated.id,
        legalHold: updated.legalHold,
        legalHoldReason: updated.legalHoldReason,
      };
    });
  }

  /**
   * Delete a document after its retention period: never under legal hold,
   * never early. The row is kept (soft delete, with who and why) and the
   * stored files are removed. Older stores linked into the library are not
   * touched — their content stays where it was.
   */
  async delete(
    actor: LendingActor,
    documentId: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    const reason = (body.reason ?? '').trim();
    if (reason.length < 3)
      throw new BadRequestException('A reason is required.');
    const purge = await this.lp.tenantTx(tenantId, async (tx) => {
      const { doc, borrower } = await this.documentOf(tx, tenantId, documentId);
      await this.policy.enforce(
        actor,
        'document.manage',
        this.resource(borrower, [], doc.id),
        tx,
      );
      if (doc.status !== 'ACTIVE')
        throw new ConflictException('This document has already been deleted.');
      const deny = async (why: string, details: Record<string, unknown>) => {
        await runAsSystem('document audit: deletion refused', () =>
          this.audit.write({
            actor,
            action: 'document.delete',
            resourceType: 'CustomerDocument',
            resourceId: doc.id,
            outcome: 'DENY',
            details: { reason: why, ...details },
          }),
        );
        return new ConflictException({
          message: why,
          code: 'DOCUMENT_RETAINED',
          ...details,
        });
      };
      if (doc.legalHold)
        throw await deny(
          'This document is under legal hold and cannot be deleted.',
          {
            legalHoldReason: doc.legalHoldReason,
          },
        );
      const today = await this.businessDate.get(tenantId, tx);
      const rules = await tx.documentRetentionRule.findMany({
        where: { tenantId },
      });
      const r = await this.retention(tx, doc, rules, today);
      if (!r.eligibleForDeletion)
        throw await deny(
          r.relationshipOpen
            ? 'The customer relationship is still open; retention has not started.'
            : `This document must be kept until ${r.retainUntil}.`,
          { retainUntil: r.retainUntil, retentionYears: r.years },
        );
      const now = new Date();
      const owned = doc.versions.filter(
        (v) => ['S3', 'LOCAL_DISK'].includes(v.storageProvider) && !v.purgedAt,
      );
      await tx.customerDocument.update({
        where: { id: doc.id },
        data: {
          status: 'DELETED',
          deletedAt: now,
          deletedBy: actor.id,
          deletionReason: reason.slice(0, 500),
        },
      });
      for (const v of owned)
        await tx.customerDocumentVersion.update({
          where: { id: v.id },
          data: { purgedAt: now },
        });
      await tx.documentRequest.updateMany({
        where: {
          tenantId,
          documentId: doc.id,
          status: { in: ['OPEN', 'SUBMITTED'] },
        },
        data: { status: 'CANCELLED', cancelledBy: actor.id },
      });
      await this.audit.write(
        {
          actor,
          action: 'document.delete',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: {
            reason: reason.slice(0, 500),
            retainUntil: r.retainUntil,
            retentionYears: r.years,
            versionsPurged: owned.map((v) => v.version),
            legacyContentRetained: !!doc.legacySource,
          },
          businessDate: fromLocalDate(today),
        },
        tx,
      );
      return { doc, keys: owned.map((v) => v.storageKey) };
    });
    // After the soft delete commits, remove the files. A failure is recorded
    // for follow-up; the document is already unavailable.
    const failed: string[] = [];
    for (const key of purge.keys) {
      const own = ownLibraryKey(tenantId, key);
      if (!own) continue;
      try {
        await this.store.storage().delete(own);
      } catch (e) {
        failed.push(own);
        this.logger.error(`Could not delete ${own}: ${(e as Error).message}`);
      }
    }
    if (failed.length)
      await this.audit.write({
        actor,
        action: 'document.storage_delete',
        resourceType: 'CustomerDocument',
        resourceId: documentId,
        outcome: 'FAILURE',
        details: { keys: failed },
      });
    return {
      id: documentId,
      status: 'DELETED',
      storageDeleted: purge.keys.length - failed.length,
      storageFailed: failed.length,
    };
  }

  async retentionRules(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'document.retention.manage',
      tenantResource(tenantId),
    );
    const rules = await this.prisma.documentRetentionRule.findMany({
      where: { tenantId },
      orderBy: [{ scope: 'asc' }, { code: 'asc' }],
    });
    return { defaults: DEFAULT_RETENTION_YEARS, rules };
  }

  async setRetentionRules(
    actor: LendingActor,
    body: {
      rules: {
        scope: 'CATEGORY' | 'TYPE';
        code: string;
        retentionYears: number | null;
      }[];
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'document.retention.manage',
        tenantResource(tenantId),
        tx,
      );
      const before = await tx.documentRetentionRule.findMany({
        where: { tenantId },
      });
      for (const r of body.rules) {
        if (
          r.scope === 'CATEGORY' &&
          !(DOCUMENT_CATEGORIES as readonly string[]).includes(r.code)
        )
          throw new BadRequestException(`Unknown category ${r.code}.`);
        if (r.scope === 'TYPE' && !/^[A-Z0-9_]{2,40}$/.test(r.code))
          throw new BadRequestException(`Invalid document type ${r.code}.`);
        if (r.retentionYears === null) {
          await tx.documentRetentionRule.deleteMany({
            where: { tenantId, scope: r.scope, code: r.code },
          });
          continue;
        }
        await tx.documentRetentionRule.upsert({
          where: {
            tenantId_scope_code: { tenantId, scope: r.scope, code: r.code },
          },
          create: {
            tenantId,
            scope: r.scope,
            code: r.code,
            retentionYears: r.retentionYears,
            updatedBy: actor.id,
          },
          update: { retentionYears: r.retentionYears, updatedBy: actor.id },
        });
      }
      const after = await tx.documentRetentionRule.findMany({
        where: { tenantId },
      });
      await this.audit.write(
        {
          actor,
          action: 'document.retention.set',
          resourceType: 'Tenant',
          resourceId: tenantId,
          outcome: 'SUCCESS',
          details: {
            before: before.map(
              (r) => `${r.scope}:${r.code}=${r.retentionYears}`,
            ),
            after: after.map((r) => `${r.scope}:${r.code}=${r.retentionYears}`),
          },
        },
        tx,
      );
      return { defaults: DEFAULT_RETENTION_YEARS, rules: after };
    });
  }

  // ── Generated documents (DOC-9) ───────────────────────────────────────────

  /**
   * File a document the system generated (statement, key facts, settlement
   * quote, closure letter …) in the customer's library. Other modules call
   * this after their own authorization; it needs no review.
   */
  async fileGenerated(input: {
    tenantId: string;
    borrowerId: string;
    typeCode: string;
    title: string;
    mimeType: 'text/html' | 'application/pdf';
    body: Buffer;
    actorId: string;
    applicationId?: string | null;
    loanAccountId?: string | null;
    customerVisible?: boolean;
  }) {
    const file = this.decode(
      {
        fileName: `${input.typeCode.toLowerCase()}.${input.mimeType === 'text/html' ? 'html' : 'pdf'}`,
        mimeType: input.mimeType,
        contentBase64: input.body.toString('base64'),
      },
      GENERATED_DOCUMENT_MIME,
    );
    return this.lp.tenantTx(input.tenantId, async (tx) => {
      const b = await this.borrowerOf(tx, input.tenantId, input.borrowerId);
      const doc = await this.createWithFile(
        tx,
        {
          tenantId: b.tenantId,
          borrowerId: b.id,
          category: 'GENERATED',
          typeCode: input.typeCode,
          title: input.title,
          origin: 'GENERATED',
          customerVisible: input.customerVisible ?? true,
          reviewStatus: 'NOT_REQUIRED',
          applicationId: input.applicationId,
          loanAccountId: input.loanAccountId,
          createdBy: input.actorId,
          uploaderType: 'SYSTEM',
        },
        file,
      );
      await this.audit.write(
        {
          actor: { id: input.actorId, type: 'SERVICE', tenantId: b.tenantId },
          action: 'document.file_generated',
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
          outcome: 'SUCCESS',
          details: {
            typeCode: input.typeCode,
            loanAccountId: input.loanAccountId ?? null,
            sha256: file.sha,
          },
        },
        tx,
      );
      return doc;
    });
  }

  // ── Older stores (DOC-1 migration forward) ────────────────────────────────

  /**
   * Link the customer's records in the older stores into the library, once.
   * Nothing is copied or deleted: the library row points at the old record
   * and reads its content from there.
   */
  async linkLegacy(tx: Tx, tenantId: string, borrowerId: string) {
    // One linker per customer at a time.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`docs:${tenantId}:${borrowerId}`}))`;
    const linked = await tx.customerDocument.findMany({
      where: { tenantId, borrowerId, legacySource: { not: null } },
      select: { legacySource: true, legacyId: true },
    });
    const has = new Set(linked.map((l) => `${l.legacySource}:${l.legacyId}`));
    const borrower = await tx.borrower.findFirst({
      where: { id: borrowerId, tenantId },
      select: {
        kycStatus: true,
        kycVerifiedByUserId: true,
        kycVerifiedAt: true,
      },
    });
    const kyc = await tx.kycDocument.findMany({
      where: { tenantId, borrowerId },
    });
    for (const k of kyc) {
      if (has.has(`KYC_DOCUMENT:${k.id}`)) continue;
      const content = decryptField(k.content) ?? '';
      if (content.startsWith('library:')) continue;
      const bytes = decodeDataUri(content);
      const review =
        borrower?.kycStatus === 'VERIFIED'
          ? 'ACCEPTED'
          : borrower?.kycStatus === 'REJECTED'
            ? 'REJECTED'
            : 'PENDING_REVIEW';
      await this.createLink(tx, {
        tenantId,
        borrowerId,
        category: 'KYC',
        typeCode: /^[A-Z0-9_]{2,40}$/.test(k.type) ? k.type : 'OTHER',
        title: k.type.replace(/_/g, ' ').toLowerCase(),
        legacySource: 'KYC_DOCUMENT',
        legacyId: k.id,
        customerVisible: true,
        reviewStatus: review,
        reviewedBy:
          review === 'PENDING_REVIEW'
            ? null
            : (borrower?.kycVerifiedByUserId ?? 'legacy-kyc-review'),
        rejectionReason:
          review === 'REJECTED'
            ? 'KYC rejected before the document library'
            : null,
        createdAt: k.createdAt,
        version: {
          fileName: k.type.toLowerCase(),
          mimeType:
            k.mimeType ?? dataUriMime(content) ?? 'application/octet-stream',
          sizeBytes: bytes?.length ?? 0,
          sha256: bytes ? sha256Bytes(bytes) : '',
          storageProvider: 'LEGACY_KYC',
          storageKey: k.id,
          uploadedBy: borrowerId,
          uploaderType: 'CUSTOMER',
        },
      });
    }
    const vault = await tx.document.findMany({
      where: { tenantId, loan: { borrowerId } },
      select: {
        id: true,
        loanId: true,
        name: true,
        type: true,
        content: true,
        createdAt: true,
      },
    });
    for (const d of vault) {
      if (has.has(`LOAN_DOCUMENT:${d.id}`)) continue;
      const inline = decodeDataUri(d.content);
      await this.createLink(tx, {
        tenantId,
        borrowerId,
        category: 'LOAN',
        typeCode: 'LOAN_DOCUMENT',
        title: safeFileName(d.name),
        legacySource: 'LOAN_DOCUMENT',
        legacyId: d.id,
        legacyLoanId: d.loanId,
        customerVisible: false,
        reviewStatus: 'PENDING_REVIEW',
        createdAt: d.createdAt,
        version: {
          fileName: safeFileName(d.name),
          mimeType: d.type,
          sizeBytes: inline?.length ?? 0,
          sha256: inline ? sha256Bytes(inline) : '',
          storageProvider: 'LEGACY_VAULT',
          storageKey: d.id,
          uploadedBy: 'legacy',
          uploaderType: 'USER',
        },
      });
    }
    const appDocs = await tx.applicationDocument.findMany({
      where: { tenantId, application: { borrowerId } },
    });
    for (const a of appDocs) {
      if (has.has(`APPLICATION_DOCUMENT:${a.id}`)) continue;
      await this.createLink(tx, {
        tenantId,
        borrowerId,
        category: 'APPLICATION',
        typeCode: a.code,
        title: a.code,
        legacySource: 'APPLICATION_DOCUMENT',
        legacyId: a.id,
        applicationId: a.applicationId,
        customerVisible: false,
        reviewStatus: 'PENDING_REVIEW',
        createdAt: a.createdAt,
        version: {
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          sha256: a.sha256,
          storageProvider: 'LEGACY_APPLICATION',
          storageKey: a.storageKey,
          uploadedBy: a.uploadedBy,
          uploaderType: 'USER',
        },
      });
    }
  }

  private async createLink(
    tx: Tx,
    l: {
      tenantId: string;
      borrowerId: string;
      category: string;
      typeCode: string;
      title: string;
      legacySource: string;
      legacyId: string;
      legacyLoanId?: string;
      applicationId?: string;
      customerVisible: boolean;
      reviewStatus: string;
      reviewedBy?: string | null;
      rejectionReason?: string | null;
      createdAt: Date;
      version: {
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        sha256: string;
        storageProvider: string;
        storageKey: string;
        uploadedBy: string;
        uploaderType: string;
      };
    },
  ) {
    const doc = await tx.customerDocument.create({
      data: {
        tenantId: l.tenantId,
        borrowerId: l.borrowerId,
        category: l.category,
        typeCode: l.typeCode,
        title: l.title.slice(0, 160),
        applicationId: l.applicationId ?? null,
        legacyLoanId: l.legacyLoanId ?? null,
        origin: 'LEGACY',
        customerVisible: l.customerVisible,
        reviewStatus: l.reviewStatus,
        legacySource: l.legacySource,
        legacyId: l.legacyId,
        createdBy: l.version.uploadedBy,
        createdAt: l.createdAt,
      },
    });
    await tx.customerDocumentVersion.create({
      data: {
        tenantId: l.tenantId,
        documentId: doc.id,
        version: 1,
        ...l.version,
        reviewStatus: l.reviewStatus,
        reviewedBy: l.reviewedBy ?? null,
        reviewedAt: l.reviewedBy ? new Date() : null,
        rejectionReason: l.rejectionReason ?? null,
        note: 'Linked from an older document store',
        createdAt: l.createdAt,
      },
    });
  }

  /** Link every customer's older documents in the caller's tenant. */
  async linkAllLegacy(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'document.retention.manage',
      tenantResource(tenantId),
    );
    const [kyc, vault, apps] = await Promise.all([
      this.prisma.kycDocument.findMany({
        where: { tenantId },
        distinct: ['borrowerId'],
        select: { borrowerId: true },
      }),
      this.prisma.document.findMany({
        where: { tenantId },
        select: { loan: { select: { borrowerId: true } } },
      }),
      this.prisma.applicationDocument.findMany({
        where: { tenantId },
        select: { application: { select: { borrowerId: true } } },
      }),
    ]);
    const ids = new Set<string>([
      ...kyc.map((k) => k.borrowerId),
      ...vault.map((v) => v.loan.borrowerId),
      ...apps.map((a) => a.application.borrowerId),
    ]);
    for (const borrowerId of ids)
      await this.lp.tenantTx(tenantId, (tx) =>
        this.linkLegacy(tx, tenantId, borrowerId),
      );
    await this.audit.write({
      actor,
      action: 'document.legacy_link',
      resourceType: 'Tenant',
      resourceId: tenantId,
      outcome: 'SUCCESS',
      details: { customers: ids.size },
    });
    return { customers: ids.size };
  }
}

function sha256Bytes(b: Buffer): string {
  return sha256(b.toString('binary'));
}

function dataUriMime(s: string): string | null {
  return /^data:([\w/+.-]+);base64,/.exec(s)?.[1] ?? null;
}

function decodeDataUri(s: string): Buffer | null {
  const m = /^data:[\w/+.-]+;base64,(.*)$/s.exec(s);
  if (!m) return null;
  const b = Buffer.from(m[1], 'base64');
  return b.length ? b : null;
}

function presentRequest(r: {
  id: string;
  borrowerId: string;
  category: string;
  typeCode: string;
  label: string;
  message: string;
  applicationId: string | null;
  loanAccountId: string | null;
  dueOn: Date | null;
  status: string;
  documentId: string | null;
  lastRejection: string | null;
  requestedBy: string;
  fulfilledAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    borrowerId: r.borrowerId,
    category: r.category,
    typeCode: r.typeCode,
    label: r.label,
    message: r.message,
    applicationId: r.applicationId,
    loanAccountId: r.loanAccountId,
    dueOn: toLocalDate(r.dueOn),
    status: r.status,
    documentId: r.documentId,
    lastRejection: r.lastRejection,
    requestedBy: r.requestedBy,
    fulfilledAt: r.fulfilledAt,
    createdAt: r.createdAt,
  };
}
