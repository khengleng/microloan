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
  D,
  LendingActor,
  concurrentModification,
  decStr,
  engineCall,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { ServicingService } from '../servicing/servicing.service';
import { FacilityState, loadFacilityState, resourceOf } from './facility-state';

type Json = Prisma.InputJsonValue;
type CertificateRow = NonNullable<
  Awaited<ReturnType<Tx['borrowingBaseCertificate']['findFirst']>>
>;

export interface CertificateLineInput {
  classCode: string;
  description: string;
  counterparty?: string;
  grossValue: string;
  ineligibleAmount?: string;
  ineligibleReason?: string;
  ageDays?: number;
}

/** The certificate currently governing drawings: the latest accepted one. */
export async function acceptedCertificate(
  tx: Tx,
  tenantId: string,
  facilityId: string,
) {
  return tx.borrowingBaseCertificate.findFirst({
    where: { tenantId, facilityId, status: 'ACCEPTED' },
    orderBy: { sequence: 'desc' },
  });
}

/**
 * What a borrowing-base line may draw on `date` (LT-14): the lower of the
 * limit and the accepted certificate's base, less what is drawn — nothing
 * without an accepted certificate or once it is stale.
 */
export async function borrowingBaseAvailabilityFor(
  tx: Tx,
  state: FacilityState,
  date: string,
): Promise<lending.BorrowingBaseAvailability> {
  const bb = state.config.borrowingBase!;
  const cert = await acceptedCertificate(
    tx,
    state.facility.tenantId,
    state.facility.id,
  );
  const position = engineCall(() =>
    lending.facilityPosition(state.terms, state.movements, date),
  );
  return lending.borrowingBaseAvailability({
    limit: state.terms.limitAmount,
    outstanding: position.outstanding,
    date,
    maxAgeDays: bb.certificateMaxAgeDays,
    certificate: cert
      ? {
          asOfDate: toLocalDate(cert.asOfDate)!,
          borrowingBase: decStr(cert.borrowingBase),
        }
      : null,
  });
}

/** Refuse a drawing the borrowing base does not support. */
export async function assertWithinBorrowingBase(
  tx: Tx,
  state: FacilityState,
  req: { date: string; amount: string },
) {
  if (!state.config.borrowingBase) return;
  const a = await borrowingBaseAvailabilityFor(tx, state, req.date);
  if (a.stale)
    throw new BadRequestException({
      message: a.reason,
      code: 'BORROWING_BASE_STALE',
      availability: a,
    });
  if (D(req.amount).gt(D(a.available)))
    throw new BadRequestException({
      message: `Drawing ${req.amount} would exceed what the borrowing base allows: ${a.available} available (the lower of the limit ${a.limit} and the base ${a.borrowingBase}, less ${a.outstanding} drawn).`,
      code: 'BORROWING_BASE_EXCEEDED',
      availability: a,
    });
}

/**
 * Borrowing-base certificates (LT-14): operations enter the borrower's
 * certificate; a second person accepts or rejects it. Acceptance supersedes
 * the previous certificate and sets what can be drawn.
 */
@Injectable()
export class BorrowingBaseService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {}

  private requireBase(state: FacilityState) {
    const bb = state.config.borrowingBase;
    if (!bb)
      throw new BadRequestException({
        message: 'This facility is not drawn against a borrowing base.',
        code: 'NO_BORROWING_BASE',
      });
    return bb;
  }

  private compute(state: FacilityState, lines: CertificateLineInput[]) {
    const bb = this.requireBase(state);
    return engineCall(() =>
      lending.computeBorrowingBase(
        bb.classes,
        lines,
        state.facility.currency,
        state.config.pricing.rounding,
      ),
    );
  }

  async overview(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'facility.read', resourceOf(state), tx);
      const bb = this.requireBase(state);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const [availability, current, certificates] = await Promise.all([
        borrowingBaseAvailabilityFor(tx, state, businessDate),
        acceptedCertificate(tx, tenantId, id),
        tx.borrowingBaseCertificate.findMany({
          where: { tenantId, facilityId: id },
          orderBy: { sequence: 'desc' },
          take: 24,
        }),
      ]);
      return {
        businessDate,
        currency: state.facility.currency,
        classes: bb.classes,
        certificateMaxAgeDays: bb.certificateMaxAgeDays,
        availability,
        current: current ? certificateView(current, true) : null,
        certificates: certificates.map((c) => certificateView(c, false)),
      };
    });
  }

  async preview(
    actor: LendingActor,
    id: string,
    body: { lines: CertificateLineInput[] },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'facility.read', resourceOf(state), tx);
      return this.compute(state, body.lines);
    });
  }

  async submit(
    actor: LendingActor,
    id: string,
    body: { asOfDate: string; lines: CertificateLineInput[]; notes?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'facility.borrowing_base.submit',
        resourceOf(state),
        tx,
      );
      const bb = this.requireBase(state);
      const businessDate = await this.businessDate.get(tenantId, tx);
      if (lending.compareDates(body.asOfDate, businessDate) > 0)
        throw new BadRequestException(
          'A certificate reports a date already passed, not a future one.',
        );
      if (
        lending.compareDates(
          lending.addDays(body.asOfDate, bb.certificateMaxAgeDays),
          businessDate,
        ) < 0
      )
        throw new BadRequestException({
          message: `A certificate as of ${body.asOfDate} is already more than ${bb.certificateMaxAgeDays} days old and could not support a drawing.`,
          code: 'BORROWING_BASE_STALE',
        });
      const pending = await tx.borrowingBaseCertificate.count({
        where: { tenantId, facilityId: id, status: 'SUBMITTED' },
      });
      if (pending)
        throw new ConflictException(
          'A certificate is already awaiting a decision on this facility.',
        );
      const calc = this.compute(state, body.lines);
      const sequence =
        ((
          await tx.borrowingBaseCertificate.aggregate({
            where: { tenantId, facilityId: id },
            _max: { sequence: true },
          })
        )._max.sequence ?? 0) + 1;
      const row = await tx.borrowingBaseCertificate.create({
        data: {
          tenantId,
          facilityId: id,
          sequence,
          asOfDate: fromLocalDate(body.asOfDate),
          currency: state.facility.currency,
          grossValue: calc.gross,
          ineligibleValue: calc.ineligible,
          eligibleValue: calc.eligible,
          borrowingBase: calc.borrowingBase,
          lines: calc.lines as unknown as Json,
          calculation: {
            classes: calc.classes,
            explanation: calc.explanation,
          } as unknown as Json,
          notes: (body.notes ?? '').slice(0, 500),
          engineVersion: lending.LENDING_ENGINE_VERSION,
          submittedBy: actor.id,
        },
      });
      await this.writeAudit(
        actor,
        tx,
        state,
        'facility.borrowing_base.submit',
        {
          certificate: row.id,
          asOfDate: body.asOfDate,
          borrowingBase: calc.borrowingBase,
        },
      );
      return certificateView(row, true);
    });
  }

  async decide(
    actor: LendingActor,
    id: string,
    certificateId: string,
    body: { outcome: 'ACCEPT' | 'REJECT'; reason?: string },
  ) {
    const tenantId = requireTenant(actor);
    if (body.outcome === 'REJECT' && !body.reason?.trim())
      throw new BadRequestException(
        'Give a reason for rejecting a certificate.',
      );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      const cert = await tx.borrowingBaseCertificate.findFirst({
        where: { id: certificateId, tenantId, facilityId: id },
      });
      if (!cert) throw new NotFoundException('Certificate not found');
      await this.policy.enforce(
        actor,
        'facility.borrowing_base.decide',
        resourceOf(state, [cert.submittedBy], {
          workflowState: cert.status,
          amount: decStr(cert.borrowingBase),
        }),
        tx,
      );
      const bb = this.requireBase(state);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const previous = await acceptedCertificate(tx, tenantId, id);
      if (body.outcome === 'ACCEPT') {
        if (
          previous &&
          lending.compareDates(
            toLocalDate(cert.asOfDate)!,
            toLocalDate(previous.asOfDate)!,
          ) < 0
        )
          throw new ConflictException(
            `A certificate as of ${toLocalDate(previous.asOfDate)} is already accepted; an older one cannot replace it.`,
          );
        if (previous) {
          const r = await tx.borrowingBaseCertificate.updateMany({
            where: {
              id: previous.id,
              tenantId,
              status: 'ACCEPTED',
              version: previous.version,
            },
            data: { status: 'SUPERSEDED', version: { increment: 1 } },
          });
          if (r.count !== 1) throw concurrentModification('The certificate');
        }
      }
      const res = await tx.borrowingBaseCertificate.updateMany({
        where: {
          id: cert.id,
          tenantId,
          status: 'SUBMITTED',
          version: cert.version,
        },
        data: {
          status: body.outcome === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          decisionReason: body.reason?.slice(0, 500) ?? null,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw concurrentModification('The certificate');
      // Touch the facility so a drawdown racing this decision re-reads it.
      const f = await tx.facility.updateMany({
        where: {
          id,
          tenantId,
          version: state.facility.version,
        },
        data: { version: { increment: 1 } },
      });
      if (f.count !== 1) throw concurrentModification('This facility');
      let availability: lending.BorrowingBaseAvailability | null = null;
      let overAdvance = '0';
      if (body.outcome === 'ACCEPT') {
        availability = lending.borrowingBaseAvailability({
          limit: state.terms.limitAmount,
          outstanding: engineCall(() =>
            lending.facilityPosition(
              state.terms,
              state.movements,
              businessDate,
            ),
          ).outstanding,
          date: businessDate,
          maxAgeDays: bb.certificateMaxAgeDays,
          certificate: {
            asOfDate: toLocalDate(cert.asOfDate)!,
            borrowingBase: decStr(cert.borrowingBase),
          },
        });
        const over = D(availability.outstanding).minus(
          D(availability.drawingCap),
        );
        if (over.gt(0)) {
          overAdvance = over.toString();
          // The line is drawn beyond its base: collections must reduce it.
          await this.servicing.outbox(
            tx,
            tenantId,
            'lending.borrowing_base.shortfall',
            {
              facilityId: id,
              certificateId: cert.id,
              outstanding: availability.outstanding,
              drawingCap: availability.drawingCap,
              overAdvance,
            },
          );
        }
      }
      await this.writeAudit(
        actor,
        tx,
        state,
        'facility.borrowing_base.decide',
        {
          certificate: cert.id,
          outcome: body.outcome,
          reason: body.reason,
          superseded: body.outcome === 'ACCEPT' ? (previous?.id ?? null) : null,
          overAdvance,
        },
      );
      return {
        id: cert.id,
        status: body.outcome === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
        availability,
        overAdvance,
      };
    });
  }

  private async writeAudit(
    actor: LendingActor,
    tx: Tx,
    state: FacilityState,
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.write(
      {
        actor,
        action,
        resourceType: 'Facility',
        resourceId: state.facility.id,
        outcome: 'SUCCESS',
        details: { facility: state.facility.reference, ...details },
        configVersions: {
          productVersionId: state.facility.productVersionId,
          engine: lending.LENDING_ENGINE_VERSION,
        },
      },
      tx,
    );
  }
}

function certificateView(c: CertificateRow, withLines: boolean) {
  return {
    id: c.id,
    sequence: c.sequence,
    asOfDate: toLocalDate(c.asOfDate),
    status: c.status,
    currency: c.currency,
    grossValue: decStr(c.grossValue),
    ineligibleValue: decStr(c.ineligibleValue),
    eligibleValue: decStr(c.eligibleValue),
    borrowingBase: decStr(c.borrowingBase),
    notes: c.notes,
    submittedBy: c.submittedBy,
    submittedAt: c.submittedAt,
    decidedBy: c.decidedBy,
    decidedAt: c.decidedAt,
    decisionReason: c.decisionReason,
    classes: (c.calculation as { classes?: unknown }).classes ?? [],
    ...(withLines ? { lines: c.lines } : {}),
  };
}
