import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, Role } from '@microloan/db';
import { lending } from '@microloan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { operationalConfig } from '../config/operational-config';
import { relationScopeFor } from '../prisma/tenant-guard';
import { assertFreshMfa, type MfaClaims } from '../auth/mfa-policy';
import { PlatformApprovalService } from '../platform-approvals/platform-approval.service';
import { DocumentStorageService } from '../lending/documents/document-storage';
import {
  addYears,
  retentionYearsFor,
  type RetentionRuleRow,
} from '../lending/documents/document-rules';

type PlatformActor = MfaClaims & { sub: string; role: string; tenantId: string | null };

/** Application states that keep a customer relationship open (mirrors the document library, DOC-7). */
const OPEN_APPLICATION = ['DRAFT', 'SUBMITTED', 'RECOMMENDED', 'APPROVED'];
/** Loan-account states that keep it open. */
const LIVE_LOAN = ['BOOKED', 'ACTIVE'];
/** Legacy loan-book states that keep it open (money is, or may become, owed). */
const LEGACY_OPEN = ['PENDING', 'APPROVED', 'DISBURSED', 'DEFAULTED'];

/** Columns never written to an archive: credentials, not records. */
const SECRET_FIELD = /(password|secret|token|keyhash|pepper|totp)/i;
/** Session and sign-in tables: credentials, not records. */
const SKIPPED_MODELS = new Set(['RefreshToken', 'PasswordResetToken', 'MfaChallenge']);

const ARCHIVE_FORMAT = 'microloan-tenant-archive/v1';

export interface PurgeBlockers {
  /** Customer documents under legal hold. */
  legalHolds: number;
  /** Customers with an open application or a live loan. */
  openRelationships: number;
  /** Customers, loans or documents still inside their retention period. */
  withinRetention: number;
  /** The last retention date among them (YYYY-MM-DD), or null. */
  retainUntil: string | null;
  /** A few examples, for the screen. */
  examples: { kind: string; id: string; reason: string }[];
}

/**
 * Tenant purge (D-131). The erasure request (TenantsService.remove) starts a
 * grace period; the purge itself is allowed only when
 *  1. the grace period (TENANT_ERASURE_GRACE_DAYS, default 30) has elapsed,
 *  2. an archive of the tenant's records was written to document storage
 *     after the request, with its SHA-256 recorded,
 *  3. nothing is under legal hold or inside its retention period (AML and
 *     the document retention rules, D-020), and
 *  4. a second super-administrator approved the purge request.
 * The purge deletes the tenant's stored files (S3 or disk), then its rows.
 */
@Injectable()
export class TenantPurgeService {
  private readonly logger = new Logger(TenantPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: PlatformApprovalService,
    private readonly storage: DocumentStorageService,
  ) {}

  private assertPlatform(actor: PlatformActor) {
    if (actor.role !== Role.SUPERADMIN || actor.tenantId !== null)
      throw new ForbiddenException('Only a platform super-administrator can do this.');
  }

  private async tenantOrThrow(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, deletedAt: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  private graceEndsAt(deletedAt: Date): Date {
    return new Date(deletedAt.getTime() + operationalConfig().tenantErasureGraceDays * 86_400_000);
  }

  private async latestArchive(tenantId: string, after: Date | null) {
    return this.prisma.tenantArchive.findFirst({
      where: { tenantId, ...(after ? { createdAt: { gte: after } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async status(actor: PlatformActor, tenantId: string) {
    this.assertPlatform(actor);
    const tenant = await this.tenantOrThrow(tenantId);
    const graceEndsAt = tenant.deletedAt ? this.graceEndsAt(tenant.deletedAt) : null;
    const [archives, blockers, request] = await Promise.all([
      this.prisma.tenantArchive.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.blockers(tenantId),
      this.approvals.findOpen('TENANT_PURGE', tenantId),
    ]);
    const currentArchive =
      tenant.deletedAt && archives.find((a) => a.createdAt >= tenant.deletedAt!);
    return {
      tenant,
      erasureRequested: !!tenant.deletedAt,
      graceDays: operationalConfig().tenantErasureGraceDays,
      graceEndsAt,
      graceElapsed: !!graceEndsAt && graceEndsAt.getTime() <= Date.now(),
      archives,
      archiveReady: !!currentArchive,
      blockers,
      request,
    };
  }

  // ── Retention and legal hold ──────────────────────────────────────────────

  /**
   * What stops the tenant from being purged: legal holds, open customer
   * relationships, and anything inside its retention period. Customers are
   * kept for the KYC retention period after the relationship ends (AML, 5
   * years by default), closed loans for the LOAN period, and each document
   * for its own rule (DOC-7, D-020) — the tenant's rules where it set them.
   */
  async blockers(tenantId: string): Promise<PurgeBlockers> {
    const today = new Date().toISOString().slice(0, 10);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

    const [rules, borrowers, openApps, accounts, legacyLoans, documents] = await Promise.all([
      this.prisma.documentRetentionRule.findMany({
        where: { tenantId },
        select: { scope: true, code: true, retentionYears: true },
      }) as Promise<RetentionRuleRow[]>,
      this.prisma.borrower.findMany({ where: { tenantId }, select: { id: true, createdAt: true } }),
      this.prisma.application.findMany({
        where: { tenantId, status: { in: OPEN_APPLICATION } },
        select: { borrowerId: true },
      }),
      this.prisma.loanAccount.findMany({
        where: { tenantId },
        select: { id: true, borrowerId: true, status: true, closedAt: true },
      }),
      this.prisma.loan.findMany({
        where: { tenantId },
        select: { id: true, borrowerId: true, status: true, updatedAt: true },
      }),
      this.prisma.customerDocument.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true, borrowerId: true, category: true, typeCode: true, createdAt: true, legalHold: true },
      }),
    ]);

    const examples: PurgeBlockers['examples'] = [];
    const note = (kind: string, id: string, reason: string) => {
      if (examples.length < 10) examples.push({ kind, id, reason });
    };

    // Relationship state per customer.
    const open = new Set<string>(openApps.map((a) => a.borrowerId));
    const ended = new Map<string, string>();
    for (const b of borrowers) ended.set(b.id, day(b.createdAt));
    const loanYears = retentionYearsFor({ category: 'LOAN', typeCode: '' }, rules).years;
    let withinRetention = 0;
    let retainUntil: string | null = null;

    for (const a of accounts) {
      if (LIVE_LOAN.includes(a.status) || !a.closedAt) {
        open.add(a.borrowerId);
        continue;
      }
      const closed = day(a.closedAt);
      ended.set(a.borrowerId, later(ended.get(a.borrowerId) ?? null, closed)!);
      const until = addYears(closed, loanYears);
      if (lending.compareDates(today, until) < 0) {
        withinRetention++;
        retainUntil = later(retainUntil, until);
        note('LoanAccount', a.id, `Loan records are kept until ${until}`);
      }
    }
    for (const l of legacyLoans) {
      if (LEGACY_OPEN.includes(l.status)) {
        open.add(l.borrowerId);
        continue;
      }
      const closed = day(l.updatedAt);
      ended.set(l.borrowerId, later(ended.get(l.borrowerId) ?? null, closed)!);
      const until = addYears(closed, loanYears);
      if (lending.compareDates(today, until) < 0) {
        withinRetention++;
        retainUntil = later(retainUntil, until);
        note('Loan', l.id, `Loan records are kept until ${until}`);
      }
    }

    for (const id of open) note('Borrower', id, 'The customer relationship is still open');

    // AML: customer records for the KYC period after the relationship ends.
    const amlYears = retentionYearsFor({ category: 'KYC', typeCode: '' }, rules).years;
    for (const b of borrowers) {
      if (open.has(b.id)) continue;
      const until = addYears(ended.get(b.id)!, amlYears);
      if (lending.compareDates(today, until) < 0) {
        withinRetention++;
        retainUntil = later(retainUntil, until);
        note('Borrower', b.id, `Customer records are kept until ${until} (AML)`);
      }
    }

    let legalHolds = 0;
    for (const d of documents) {
      if (d.legalHold) {
        legalHolds++;
        note('CustomerDocument', d.id, 'Under legal hold');
        continue;
      }
      if (open.has(d.borrowerId)) continue;
      const filed = day(d.createdAt);
      const end = ended.get(d.borrowerId) ?? filed;
      const until = addYears(end > filed ? end : filed, retentionYearsFor(d, rules).years);
      if (lending.compareDates(today, until) < 0) {
        withinRetention++;
        retainUntil = later(retainUntil, until);
        note('CustomerDocument', d.id, `Kept until ${until}`);
      }
    }

    return { legalHolds, openRelationships: open.size, withinRetention, retainUntil, examples };
  }

  private assertNoBlockers(b: PurgeBlockers) {
    if (b.legalHolds || b.openRelationships || b.withinRetention)
      throw new ConflictException({
        message:
          b.legalHolds > 0
            ? `${b.legalHolds} document(s) are under legal hold. Release the holds before purging.`
            : b.openRelationships > 0
              ? `${b.openRelationships} customer relationship(s) are still open. They must be closed and their retention period must pass first.`
              : `Records must be kept until ${b.retainUntil} (retention period).`,
        code: 'TENANT_PURGE_BLOCKED',
        blockers: b,
      });
  }

  private assertErasureAndGrace(tenant: { deletedAt: Date | null }) {
    if (!tenant.deletedAt)
      throw new BadRequestException(
        'Request erasure (move the organisation to the Trash) before purging it.',
      );
    const ends = this.graceEndsAt(tenant.deletedAt);
    if (ends.getTime() > Date.now())
      throw new ConflictException({
        message: `The erasure grace period ends on ${ends.toISOString().slice(0, 10)}; the organisation cannot be purged before then.`,
        code: 'TENANT_PURGE_GRACE',
        graceEndsAt: ends,
      });
  }

  // ── Archive ───────────────────────────────────────────────────────────────

  /**
   * Write the tenant's records — every table that carries its tenantId, and
   * the child tables reached through a parent — as one JSON bundle to
   * document storage, outside the tenant's own prefix so the purge leaves it,
   * and record its SHA-256. Credentials (password hashes, secrets, tokens)
   * are left out.
   */
  async archive(actor: PlatformActor, tenantId: string) {
    this.assertPlatform(actor);
    assertFreshMfa(actor);
    const tenant = await this.tenantOrThrow(tenantId);
    if (!tenant.deletedAt)
      throw new BadRequestException('Request erasure before archiving the organisation for a purge.');

    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    const strip = (row: Record<string, unknown>) => {
      for (const k of Object.keys(row)) if (SECRET_FIELD.test(k)) delete row[k];
      return row;
    };
    const tenantRow = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    tables.Tenant = [strip({ ...(tenantRow as Record<string, unknown>) })];
    counts.Tenant = 1;
    const client = this.prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<Record<string, unknown>[]> }>;
    for (const model of Prisma.dmmf.datamodel.models) {
      if (model.name === 'Tenant' || SKIPPED_MODELS.has(model.name)) continue;
      const delegate = client[model.name.charAt(0).toLowerCase() + model.name.slice(1)];
      if (!delegate) continue;
      let where: Record<string, unknown> | null = null;
      if (model.fields.some((f) => f.name === 'tenantId')) where = { tenantId };
      else {
        const rel = relationScopeFor(model.name);
        if (rel) where = { [rel.relation]: { tenantId } };
      }
      if (!where) continue;
      const rows = (await delegate.findMany({ where })).map(strip);
      if (rows.length) {
        tables[model.name] = rows;
        counts[model.name] = rows.length;
      }
    }

    const generatedAt = new Date();
    const body = Buffer.from(
      JSON.stringify(
        { format: ARCHIVE_FORMAT, tenant: { id: tenant.id, name: tenant.name }, generatedAt, generatedBy: actor.sub, counts, tables },
        (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
      ),
    );
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = `platform/tenant-archives/${tenant.id}/${generatedAt.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`;
    const store = this.storage.storage();
    await store.put(key, body, 'application/json');

    const row = await this.prisma.tenantArchive.create({
      data: {
        tenantId: tenant.id,
        tenantName: tenant.name,
        storageProvider: store.provider,
        storageKey: key,
        sha256,
        sizeBytes: body.length,
        recordCounts: counts,
        createdBy: actor.sub,
      },
    });
    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: null,
      subjectTenantId: tenant.id,
      targetType: 'Tenant',
      targetId: tenant.id,
      action: 'TENANT_ARCHIVE_CREATED',
      newValue: { archiveId: row.id, sha256, sizeBytes: body.length, storageProvider: store.provider },
      result: 'SUCCESS',
    });
    return row;
  }

  // ── Request, approve, purge ───────────────────────────────────────────────

  async requestPurge(actor: PlatformActor, tenantId: string, reason?: string) {
    this.assertPlatform(actor);
    assertFreshMfa(actor);
    const tenant = await this.tenantOrThrow(tenantId);
    this.assertErasureAndGrace(tenant);
    const archive = await this.latestArchive(tenantId, tenant.deletedAt);
    if (!archive)
      throw new ConflictException({
        message: 'Write the tenant archive first: a purge needs an archive made after the erasure request.',
        code: 'TENANT_PURGE_NO_ARCHIVE',
      });
    this.assertNoBlockers(await this.blockers(tenantId));
    if (!(await this.approvals.secondApproverAvailable(actor.sub)))
      throw new ConflictException(
        'A tenant purge needs a second super-administrator to approve it, and there is no other active super-administrator.',
      );
    const row = await this.approvals.open({
      action: 'TENANT_PURGE',
      subjectType: 'Tenant',
      subjectId: tenantId,
      makerId: actor.sub,
      payload: { tenantName: tenant.name, archiveId: archive.id, archiveSha256: archive.sha256, reason: reason?.slice(0, 500) ?? '' },
    });
    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: null,
      targetType: 'Tenant',
      targetId: tenantId,
      action: 'TENANT_PURGE_REQUESTED',
      newValue: { approvalId: row.id, archiveId: archive.id },
      reason,
      result: 'SUCCESS',
    });
    return row;
  }

  async listRequests(actor: PlatformActor, status?: string) {
    this.assertPlatform(actor);
    return this.approvals.list('TENANT_PURGE', status);
  }

  async decide(actor: PlatformActor, approvalId: string, approve: boolean, comment?: string) {
    this.assertPlatform(actor);
    if (approve) assertFreshMfa(actor);
    const row = await this.approvals.decide(approvalId, actor.sub, approve, comment);
    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: null,
      targetType: 'Tenant',
      targetId: row.subjectId,
      action: approve ? 'TENANT_PURGE_APPROVED' : 'TENANT_PURGE_REJECTED',
      newValue: { approvalId: row.id, requestedBy: row.makerId },
      reason: comment,
      result: 'SUCCESS',
    });
    return row;
  }

  /**
   * Carry out an approved purge. Every condition is checked again: time,
   * holds and archives can change between the approval and now.
   */
  async purge(actor: PlatformActor, tenantId: string) {
    this.assertPlatform(actor);
    assertFreshMfa(actor);
    const tenant = await this.tenantOrThrow(tenantId);
    this.assertErasureAndGrace(tenant);
    const request = await this.approvals.findOpen('TENANT_PURGE', tenantId);
    if (!request || request.status !== 'APPROVED')
      throw new ConflictException({
        message: 'A second super-administrator must approve a purge request for this organisation first.',
        code: 'TENANT_PURGE_NOT_APPROVED',
      });
    const archive = await this.latestArchive(tenantId, tenant.deletedAt);
    if (!archive)
      throw new ConflictException({
        message: 'Write the tenant archive first.',
        code: 'TENANT_PURGE_NO_ARCHIVE',
      });
    this.assertNoBlockers(await this.blockers(tenantId));

    // Files first: if storage refuses, nothing has been deleted from the
    // database and the purge can simply be retried.
    let filesDeleted: number;
    try {
      filesDeleted = await this.storage.deleteTenantFiles(tenantId);
    } catch (err) {
      this.logger.error(`Tenant purge ${tenantId}: stored files could not be deleted`, err as Error);
      throw new ServiceUnavailableException(
        'The organisation’s stored files could not be deleted. Nothing was purged; try again.',
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        // Lending financial and audit rows are immutable at the database
        // level; an approved purge is the one sanctioned exception and
        // declares itself for this transaction only.
        await tx.$executeRawUnsafe("SET LOCAL lending.purge = 'on'");
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.loanInteraction.deleteMany({ where: { loan: { tenantId } } });
        await tx.repayment.deleteMany({ where: { tenantId } });
        await tx.repaymentSchedule.deleteMany({ where: { loan: { tenantId } } });
        await tx.collateral.deleteMany({ where: { loan: { tenantId } } });
        await tx.guarantor.deleteMany({ where: { loan: { tenantId } } });
        await tx.document.deleteMany({ where: { tenantId } });
        await tx.loan.deleteMany({ where: { tenantId } });
        await tx.borrower.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
        await tx.loanPolicy.deleteMany({ where: { product: { tenantId } } });
        await tx.loanProduct.deleteMany({ where: { tenantId } });
        await tx.tenant.delete({ where: { id: tenantId } });
        await this.approvals.markExecuted(request.id, tx);
      },
      { timeout: operationalConfig().tenantPurgeTimeoutMs, maxWait: 10_000 },
    );

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: null,
      targetType: 'Tenant',
      targetId: tenantId,
      action: 'TENANT_HARD_DELETE',
      oldValue: { name: tenant.name },
      newValue: {
        approvalId: request.id,
        requestedBy: request.makerId,
        approvedBy: request.checkerId,
        archiveId: archive.id,
        archiveSha256: archive.sha256,
        filesDeleted,
      },
      result: 'SUCCESS',
    });
    return {
      success: true,
      filesDeleted,
      archive: { id: archive.id, sha256: archive.sha256, storageKey: archive.storageKey },
      message: `Tenant "${tenant.name}" and all associated data have been permanently destroyed. The archive is kept (SHA-256 ${archive.sha256}).`,
    };
  }
}
