import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  LendingActor,
  concurrentModification,
  engineCall,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import type { Resource } from '../policy/decision';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';

type Json = Prisma.InputJsonValue;

const DAY_MS = 86_400_000;

/**
 * Alternative data for thin-file borrowers (DECISIONS D-078):
 *
 *  - consent per borrower and source, append-only — a withdrawal is a new
 *    row, and from that moment nothing from the source is fetched or used;
 *  - document-backed data an officer captures (utility bills, telco
 *    statement, rent, observed business cash flow), which counts towards a
 *    score only once a second person has verified it.
 *
 * The customer is the resource (branch-scoped), as for customer documents.
 */
@Injectable()
export class AlternativeDataService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly settings: TenantSettingsService,
  ) {}

  // ── Resources ─────────────────────────────────────────────────────────────

  /** The customer as a policy resource (branch-scoped); also used by credit reports. */
  async customer(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
    makerIds: string[] = [],
    id?: string,
  ): Promise<Resource> {
    const b = await tx.borrower.findFirst({
      where: { id: borrowerId, tenantId },
      select: { id: true, branchId: true },
    });
    if (!b) throw new NotFoundException('Customer not found');
    let branchId = b.branchId;
    if (!branchId) {
      // As for documents (D-023): a customer without a branch is scoped by
      // the branch of their latest application.
      const app = await tx.application.findFirst({
        where: { tenantId, borrowerId },
        orderBy: { createdAt: 'desc' },
        select: { branchId: true },
      });
      branchId = app?.branchId ?? null;
    }
    return {
      type: 'CUSTOMER_DOCUMENT',
      id: id ?? b.id,
      tenantId,
      branchId,
      ownerBorrowerId: b.id,
      dataClassification: 'CONFIDENTIAL',
      makerIds,
    } as Resource;
  }

  /** Every consent event of a borrower, as the engine reads them. */
  async consentEvents(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
  ): Promise<lending.ConsentEvent[]> {
    const rows = await tx.altDataConsent.findMany({
      where: { tenantId, borrowerId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action as 'GRANT' | 'REVOKE',
      source: r.source,
      grantId: r.grantId,
      effectiveAt: r.effectiveAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
    }));
  }

  /** The grant in force now for a source, or null. */
  async consentInForce(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
    source: lending.AltDataSource,
  ) {
    return lending.consentInForce(
      await this.consentEvents(tx, tenantId, borrowerId),
      source,
      new Date().toISOString(),
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async overview(actor: LendingActor, borrowerId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'alt_data.read',
        await this.customer(tx, tenantId, borrowerId),
        tx,
      );
      const [consents, records] = await Promise.all([
        tx.altDataConsent.findMany({
          where: { tenantId, borrowerId },
          orderBy: { createdAt: 'desc' },
        }),
        tx.altDataRecord.findMany({
          where: { tenantId, borrowerId },
          orderBy: { createdAt: 'desc' },
          include: {
            document: { select: { id: true, title: true, typeCode: true } },
          },
        }),
      ]);
      const events = await this.consentEvents(tx, tenantId, borrowerId);
      const now = new Date().toISOString();
      const inForce = lending.ALT_DATA_SOURCES.map((source) => {
        const g = lending.consentInForce(events, source, now);
        return {
          source,
          grantId: g?.id ?? null,
          expiresAt: g?.expiresAt ?? null,
        };
      });
      const revoked = new Set(
        consents.filter((c) => c.action === 'REVOKE').map((c) => c.grantId),
      );
      return {
        sources: lending.ALT_DATA_SOURCES,
        kinds: lending.OFFICER_DATA_KINDS,
        inForce,
        consents: consents.map((c) => ({
          ...c,
          revoked: c.action === 'GRANT' && revoked.has(c.id),
        })),
        records: records.map((r) => ({
          ...r,
          periodFrom: toLocalDate(r.periodFrom),
          periodTo: toLocalDate(r.periodTo),
        })),
      };
    });
  }

  // ── Consent ───────────────────────────────────────────────────────────────

  async grant(
    actor: LendingActor,
    borrowerId: string,
    body: {
      source: lending.AltDataSource;
      purpose: string;
      scope?: string;
      method: 'SIGNED_FORM' | 'RECORDED_VERBAL' | 'BORROWER_PORTAL';
      documentId?: string;
      effectiveAt?: string;
      expiresAt: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'alt_data.consent.manage',
        await this.customer(tx, tenantId, borrowerId),
        tx,
      );
      const now = new Date();
      const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : now;
      const expiresAt = new Date(body.expiresAt);
      if (Number.isNaN(effectiveAt.getTime()) || effectiveAt > now)
        throw new BadRequestException(
          'Consent can only be recorded once it has been given (effectiveAt not in the future).',
        );
      if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now)
        throw new BadRequestException('expiresAt must be in the future.');
      const s = await this.settings.get(tenantId, tx);
      const max = s.scoring.consent.maxValidityDays;
      if (expiresAt.getTime() - effectiveAt.getTime() > max * DAY_MS)
        throw new BadRequestException(
          `Consent may run at most ${max} days; ask the customer to renew it after that.`,
        );
      if (body.method === 'SIGNED_FORM' && !body.documentId)
        throw new BadRequestException(
          'A signed consent form must be filed in the customer’s documents first; give its documentId.',
        );
      if (body.documentId)
        await this.ownDocument(tx, tenantId, borrowerId, body.documentId);
      const row = await tx.altDataConsent.create({
        data: {
          tenantId,
          borrowerId,
          action: 'GRANT',
          source: body.source,
          purpose: body.purpose.trim().slice(0, 500),
          scope: (body.scope ?? '').trim().slice(0, 500),
          method: body.method,
          documentId: body.documentId ?? null,
          effectiveAt,
          expiresAt,
          recordedBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'alt_data.consent.grant',
          resourceType: 'AltDataConsent',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: {
            borrowerId,
            source: body.source,
            method: body.method,
            expiresAt: expiresAt.toISOString(),
          },
        },
        tx,
      );
      return row;
    });
  }

  async revoke(
    actor: LendingActor,
    consentId: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const g = await tx.altDataConsent.findFirst({
        where: { id: consentId, tenantId },
      });
      if (!g) throw new NotFoundException('Consent not found');
      await this.policy.enforce(
        actor,
        'alt_data.consent.manage',
        await this.customer(tx, tenantId, g.borrowerId),
        tx,
      );
      if (g.action !== 'GRANT')
        throw new BadRequestException('Only a grant can be withdrawn.');
      const already = await tx.altDataConsent.findFirst({
        where: { tenantId, grantId: g.id, action: 'REVOKE' },
      });
      if (already)
        throw new ConflictException('This consent was already withdrawn.');
      const row = await tx.altDataConsent.create({
        data: {
          tenantId,
          borrowerId: g.borrowerId,
          action: 'REVOKE',
          source: g.source,
          grantId: g.id,
          method: g.method,
          effectiveAt: new Date(),
          reason: body.reason.trim().slice(0, 500),
          recordedBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'alt_data.consent.revoke',
          resourceType: 'AltDataConsent',
          resourceId: g.id,
          outcome: 'SUCCESS',
          details: { borrowerId: g.borrowerId, source: g.source },
        },
        tx,
      );
      return row;
    });
  }

  // ── Officer-captured data ─────────────────────────────────────────────────

  async record(
    actor: LendingActor,
    borrowerId: string,
    body: {
      kind: lending.OfficerDataKind;
      data: Record<string, unknown>;
      periodFrom: string;
      periodTo: string;
      documentId: string;
      note?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    const parsed = lending.OFFICER_DATA_SCHEMAS[body.kind].safeParse(body.data);
    if (!parsed.success)
      throw new BadRequestException({
        message: 'The data does not match its kind.',
        code: 'VALIDATION_FAILED',
        issues: parsed.error.issues.map((i) => ({
          path: `data.${i.path.join('.')}`,
          message: i.message,
        })),
      });
    const data = parsed.data as Record<string, unknown>;
    if (body.kind === 'BUSINESS_CASH_FLOW')
      engineCall(() => lending.getCurrency(String(data.currency)));
    lending.parseDate(body.periodFrom, 'periodFrom');
    lending.parseDate(body.periodTo, 'periodTo');
    if (lending.compareDates(body.periodFrom, body.periodTo) > 0)
      throw new BadRequestException('periodFrom must not be after periodTo.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'alt_data.record',
        await this.customer(tx, tenantId, borrowerId),
        tx,
      );
      const today = await this.businessDate.get(tenantId, tx);
      if (lending.compareDates(body.periodTo, today) > 0)
        throw new BadRequestException(
          'The observed period cannot end after today.',
        );
      const consent = await this.consentInForce(
        tx,
        tenantId,
        borrowerId,
        lending.OFFICER_DATA_CONSENT[body.kind],
      );
      if (!consent)
        throw new BadRequestException({
          message: `The customer has not consented to the use of ${body.kind.toLowerCase().replace(/_/g, ' ')} data (or the consent was withdrawn or has expired).`,
          code: 'CONSENT_REQUIRED',
        });
      await this.ownDocument(tx, tenantId, borrowerId, body.documentId);
      const row = await tx.altDataRecord.create({
        data: {
          tenantId,
          borrowerId,
          kind: body.kind,
          data: data as Json,
          periodFrom: fromLocalDate(body.periodFrom),
          periodTo: fromLocalDate(body.periodTo),
          documentId: body.documentId,
          consentId: consent.id,
          note: (body.note ?? '').slice(0, 500),
          recordedBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'alt_data.record',
          resourceType: 'AltDataRecord',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { borrowerId, kind: body.kind, documentId: body.documentId },
        },
        tx,
      );
      return row;
    });
  }

  async decide(
    actor: LendingActor,
    recordId: string,
    body: { approve: boolean; reason?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const r = await tx.altDataRecord.findFirst({
        where: { id: recordId, tenantId },
      });
      if (!r) throw new NotFoundException('Record not found');
      await this.policy.enforce(
        actor,
        'alt_data.verify',
        await this.customer(tx, tenantId, r.borrowerId, [r.recordedBy], r.id),
        tx,
      );
      if (r.status !== 'PENDING')
        throw new ConflictException(
          `This record is already ${r.status.toLowerCase()}.`,
        );
      if (!body.approve && !body.reason?.trim())
        throw new BadRequestException('A reason is required to reject.');
      if (body.approve) {
        const consent = await this.consentInForce(
          tx,
          tenantId,
          r.borrowerId,
          lending.OFFICER_DATA_CONSENT[r.kind as lending.OfficerDataKind],
        );
        if (!consent)
          throw new BadRequestException({
            message:
              'The customer’s consent for this data is no longer in force; it cannot be verified.',
            code: 'CONSENT_REQUIRED',
          });
      }
      const res = await tx.altDataRecord.updateMany({
        where: { id: r.id, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'VERIFIED' : 'REJECTED',
          verifiedBy: actor.id,
          verifiedAt: new Date(),
          rejectionReason: body.approve
            ? null
            : body.reason!.trim().slice(0, 500),
        },
      });
      if (res.count !== 1) throw concurrentModification('This record');
      await this.audit.write(
        {
          actor,
          action: 'alt_data.verify',
          resourceType: 'AltDataRecord',
          resourceId: r.id,
          outcome: 'SUCCESS',
          details: { approve: body.approve, kind: r.kind },
        },
        tx,
      );
      return tx.altDataRecord.findFirst({ where: { id: r.id, tenantId } });
    });
  }

  private async ownDocument(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
    documentId: string,
  ) {
    const doc = await tx.customerDocument.findFirst({
      where: { id: documentId, tenantId, borrowerId },
      select: { id: true, status: true, reviewStatus: true },
    });
    if (!doc)
      throw new BadRequestException(
        'The supporting document must be one of this customer’s documents.',
      );
    if (doc.status !== 'ACTIVE' || doc.reviewStatus === 'REJECTED')
      throw new BadRequestException(
        'The supporting document is deleted or was rejected.',
      );
  }
}
