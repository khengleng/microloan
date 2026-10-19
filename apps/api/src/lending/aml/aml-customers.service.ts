import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import type { ResourceType } from '../policy/actions';
import { ServicingService } from '../servicing/servicing.service';
import { AmlGateService } from './aml-gate.service';
import { AmlRiskService } from './aml-risk.service';
import {
  AML_ACTION,
  AML_SUBJECT,
  AmlScreeningService,
  type StoredHit,
} from './aml-screening.service';

/** Capability codes the AML gate can block, by resource type. */
const GATED_ACTIONS: Partial<Record<ResourceType, string[]>> = {
  APPLICATION: [
    'loan_application.submit',
    'credit_decision.approve',
    'loan.agreement.book',
  ],
  LOAN_ACCOUNT: [
    'loan.disbursement.prepare',
    'loan.disbursement.approve',
    'loan.disbursement.execute',
  ],
};

/**
 * A customer's AML/CFT standing (DECISIONS D-118, D-120):
 *
 *  - AML status: FLAGGED is set by one person; CLEAR — including clearing a
 *    FLAGGED customer — is proposed by one person (after a fresh screening
 *    finds nothing undisposed) and approved by another (ApprovalTask
 *    AML_CLEAR). A confirmed sanctions match cannot be cleared.
 *  - Enhanced due diligence for a HIGH-risk or politically exposed customer:
 *    source of funds and wealth with a document reference, recorded by one
 *    person and approved by another.
 *  - The lending gate, at disbursement (registered here) and in the
 *    capability map the UI's "Blocked by" reads.
 */
@Injectable()
export class AmlCustomersService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly gate: AmlGateService,
    private readonly risk: AmlRiskService,
    private readonly screening: AmlScreeningService,
    servicing: ServicingService,
  ) {
    servicing.registerDisbursementGuard(async (tx, state) =>
      this.gate.assertClear(
        tx,
        state.account.tenantId,
        await this.gate.loanParties(tx, state.account.tenantId, state.account),
        'disbursed',
      ),
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async summary(actor: LendingActor, borrowerId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const resource = await this.screening.customerResource(
        tx,
        tenantId,
        borrowerId,
      );
      await this.policy.enforce(actor, 'aml.read', resource, tx);
      const b = await tx.borrower.findFirst({
        where: { id: borrowerId, tenantId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          kycStatus: true,
          amlStatus: true,
          amlStatusChangedAt: true,
          amlStatusChangedBy: true,
          pep: true,
          nationality: true,
          occupation: true,
          amlRiskRating: true,
          amlRiskScore: true,
          amlRiskFactors: true,
          amlRiskRatedAt: true,
          amlNextReviewOn: true,
          amlScreenedAt: true,
        },
      });
      if (!b) throw new NotFoundException('Customer not found');
      const [cases, clearance, edd, blocks] = await Promise.all([
        tx.amlScreeningCase.findMany({
          where: { tenantId, borrowerId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            reference: true,
            status: true,
            topType: true,
            topScore: true,
            disposition: true,
            trigger: true,
            createdAt: true,
            decidedAt: true,
          },
        }),
        this.pendingClearance(tx, tenantId, borrowerId),
        tx.amlEddRecord.findMany({
          where: { tenantId, borrowerId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.gate.blockers(tx, tenantId, new Map([[borrowerId, 'BORROWER']])),
      ]);
      const asOf = new Date().toISOString().slice(0, 10);
      const nextReview = toLocalDate(b.amlNextReviewOn);
      const can = async (action: string, makers: string[] = []) =>
        (
          await this.policy.decide(
            actor,
            action,
            { ...resource, makerIds: makers },
            tx,
          )
        ).allowed;
      return {
        ...b,
        amlNextReviewOn: nextReview,
        reviewDue: !!nextReview && nextReview <= asOf,
        eddRequired: b.amlRiskRating === 'HIGH' || b.pep,
        cases,
        openCase:
          cases.find(
            (c) => c.status === 'OPEN' || c.status === 'PENDING_APPROVAL',
          ) ?? null,
        pendingClearance: clearance
          ? {
              taskId: clearance.id,
              proposedBy: clearance.makerId,
              proposedAt: clearance.createdAt,
              reason:
                (clearance.payload as { reason?: string } | null)?.reason ??
                null,
            }
          : null,
        edd,
        gate: { clear: blocks.length === 0, reasons: blocks[0]?.reasons ?? [] },
        you: {
          mayScreen: await can('aml.screen'),
          mayApproveClearance: clearance
            ? await can('aml.status.approve', [clearance.makerId])
            : false,
          mayApproveEdd: await can(
            'aml.edd.approve',
            edd.filter((e) => e.status === 'PENDING').map((e) => e.makerId),
          ),
          mayDisposition: await can('aml.case.propose'),
          mayRaiseStr: await can('aml.str.raise'),
        },
      };
    });
  }

  // ── AML status ────────────────────────────────────────────────────────────

  /**
   * FLAGGED takes effect at once. CLEAR is screened afresh, then recorded
   * for a second person to approve; the customer keeps their status until
   * then.
   */
  async setStatus(
    actor: LendingActor,
    borrowerId: string,
    body: { status: 'CLEAR' | 'FLAGGED'; reason: string },
  ) {
    const tenantId = requireTenant(actor);
    const reason = body.reason?.trim() ?? '';
    if (reason.length < 5)
      throw new BadRequestException(
        'Record the reason for the AML status change.',
      );
    if (body.status === 'FLAGGED')
      return this.flag(actor, tenantId, borrowerId, reason);

    // A fresh screening, committed whatever comes next: a hit it finds must
    // stay on record even though the clearance is refused.
    await this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'aml.screen',
        await this.screening.customerResource(tx, tenantId, borrowerId),
        tx,
      );
      await this.screening.screenInTx(
        tx,
        tenantId,
        borrowerId,
        'STATUS_CLEARANCE',
        actor,
      );
    });
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'aml.screen',
        await this.screening.customerResource(tx, tenantId, borrowerId),
        tx,
      );
      const b = await tx.borrower.findFirst({
        where: { id: borrowerId, tenantId },
        select: { amlStatus: true },
      });
      if (!b) throw new NotFoundException('Customer not found');
      if (b.amlStatus === 'CLEAR')
        throw new ConflictException('This customer is already AML-cleared.');
      await this.assertClearable(tx, tenantId, borrowerId);
      if (await this.pendingClearance(tx, tenantId, borrowerId))
        throw new ConflictException(
          'A clearance of this customer is already awaiting approval.',
        );
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: AML_SUBJECT.CUSTOMER,
          subjectId: borrowerId,
          action: AML_ACTION.CLEAR,
          requiredPermission: 'aml.disposition',
          payload: { reason: reason.slice(0, 1000), from: b.amlStatus },
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'aml.status.propose',
          resourceType: 'Borrower',
          resourceId: borrowerId,
          outcome: 'SUCCESS',
          details: { status: 'CLEAR', from: b.amlStatus, task: task.id },
        },
        tx,
      );
      return {
        id: borrowerId,
        amlStatus: b.amlStatus,
        pendingClearance: {
          taskId: task.id,
          proposedBy: actor.id,
          proposedAt: task.createdAt,
          reason,
        },
      };
    });
  }

  private async flag(
    actor: LendingActor,
    tenantId: string,
    borrowerId: string,
    reason: string,
  ) {
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'aml.screen',
        await this.screening.customerResource(tx, tenantId, borrowerId),
        tx,
      );
      const b = await tx.borrower.findFirst({
        where: { id: borrowerId, tenantId },
        select: { amlStatus: true },
      });
      if (!b) throw new NotFoundException('Customer not found');
      await tx.approvalTask.updateMany({
        where: {
          tenantId,
          subjectType: AML_SUBJECT.CUSTOMER,
          subjectId: borrowerId,
          action: AML_ACTION.CLEAR,
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          comment: 'Superseded: customer flagged',
        },
      });
      const updated = await tx.borrower.update({
        where: { id: borrowerId },
        data: {
          amlStatus: 'FLAGGED',
          amlStatusChangedAt: new Date(),
          amlStatusChangedBy: actor.id,
        },
        select: { id: true, amlStatus: true, amlStatusChangedAt: true },
      });
      await this.audit.write(
        {
          actor,
          action: 'aml.status.flag',
          resourceType: 'Borrower',
          resourceId: borrowerId,
          outcome: 'SUCCESS',
          details: { from: b.amlStatus, reason: reason.slice(0, 500) },
        },
        tx,
      );
      return { ...updated, pendingClearance: null };
    });
  }

  /** The checker approves (or refuses) a recorded clearance. */
  async decideClearance(
    actor: LendingActor,
    borrowerId: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const task = await this.pendingClearance(tx, tenantId, borrowerId);
      if (!task)
        throw new ConflictException(
          'No clearance of this customer is awaiting approval.',
        );
      await this.policy.enforce(
        actor,
        'aml.status.approve',
        await this.screening.customerResource(tx, tenantId, borrowerId, [
          task.makerId,
        ]),
        tx,
      );
      if (!body.approve && !body.comment?.trim())
        throw new BadRequestException('Say why the clearance is refused.');
      if (body.approve) await this.assertClearable(tx, tenantId, borrowerId);
      const done = await tx.approvalTask.updateMany({
        where: {
          id: task.id,
          tenantId,
          status: 'PENDING',
          makerId: { not: actor.id },
        },
        data: {
          status: body.approve ? 'EXECUTED' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          comment: body.comment?.trim().slice(0, 500),
        },
      });
      if (done.count !== 1) throw concurrentModification('This clearance');
      if (body.approve) {
        await tx.borrower.update({
          where: { id: borrowerId },
          data: {
            amlStatus: 'CLEAR',
            amlStatusChangedAt: new Date(),
            amlStatusChangedBy: actor.id,
          },
        });
        await this.risk.rateInTx(tx, tenantId, borrowerId, actor);
      }
      await this.audit.write(
        {
          actor,
          action: 'aml.status.approve',
          resourceType: 'Borrower',
          resourceId: borrowerId,
          outcome: 'SUCCESS',
          details: {
            approve: body.approve,
            task: task.id,
            proposedBy: task.makerId,
          },
        },
        tx,
      );
      const b = await tx.borrower.findFirst({
        where: { id: borrowerId, tenantId },
        select: {
          id: true,
          amlStatus: true,
          amlStatusChangedAt: true,
          amlRiskRating: true,
        },
      });
      return { ...b, pendingClearance: null };
    });
  }

  /** Nothing undisposed, and no confirmed sanctions match, stands in the way. */
  private async assertClearable(tx: Tx, tenantId: string, borrowerId: string) {
    const open = await tx.amlScreeningCase.findFirst({
      where: {
        tenantId,
        borrowerId,
        status: { in: ['OPEN', 'PENDING_APPROVAL'] },
      },
      select: { reference: true },
    });
    if (open)
      throw new ConflictException({
        message: `Screening case ${open.reference} must be dispositioned before this customer can be cleared.`,
        code: 'AML_CASE_OPEN',
      });
    const confirmed = await tx.amlScreeningCase.findMany({
      where: { tenantId, borrowerId, status: 'TRUE_MATCH' },
      select: { reference: true, hits: true },
    });
    const sanction = confirmed.find((c) =>
      (c.hits as unknown as StoredHit[]).some(
        (h) => h.entryType === 'SANCTION',
      ),
    );
    if (sanction)
      throw new ConflictException({
        message: `This customer is a confirmed sanctions match (${sanction.reference}); they cannot be cleared.`,
        code: 'AML_SANCTIONED',
      });
  }

  private pendingClearance(tx: Tx, tenantId: string, borrowerId: string) {
    return tx.approvalTask.findFirst({
      where: {
        tenantId,
        subjectType: AML_SUBJECT.CUSTOMER,
        subjectId: borrowerId,
        action: AML_ACTION.CLEAR,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Risk rating ───────────────────────────────────────────────────────────

  async rate(actor: LendingActor, borrowerId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'aml.screen',
        await this.screening.customerResource(tx, tenantId, borrowerId),
        tx,
      );
      return this.risk.rateInTx(tx, tenantId, borrowerId, actor);
    });
  }

  /** Customers by rating and review date, for the compliance review list. */
  async ratings(actor: LendingActor, q: { rating?: string; due?: boolean }) {
    const tenantId = requireTenant(actor);
    const scope = await this.screening.borrowerScope(actor, 'aml.read');
    if (!scope) return { data: [] };
    return this.lp.tenantTx(tenantId, async (tx) => {
      const today = new Date();
      const rows = await tx.borrower.findMany({
        where: {
          tenantId,
          ...scope,
          ...(q.rating
            ? { amlRiskRating: q.rating }
            : { amlRiskRating: { not: null } }),
          ...(q.due ? { amlNextReviewOn: { lte: today } } : {}),
        },
        orderBy: [{ amlNextReviewOn: 'asc' }],
        take: 200,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          branchId: true,
          amlStatus: true,
          amlRiskRating: true,
          amlRiskScore: true,
          pep: true,
          amlNextReviewOn: true,
          amlEddRecords: {
            where: { status: { in: ['APPROVED', 'PENDING'] } },
            select: { id: true, status: true },
          },
        },
      });
      return {
        data: rows.map((r) => ({
          ...r,
          amlNextReviewOn: toLocalDate(r.amlNextReviewOn),
          eddRequired: r.amlRiskRating === 'HIGH' || r.pep,
          eddStatus: r.amlEddRecords.some((e) => e.status === 'APPROVED')
            ? 'APPROVED'
            : r.amlEddRecords.some((e) => e.status === 'PENDING')
              ? 'PENDING'
              : 'NONE',
        })),
      };
    });
  }

  // ── Enhanced due diligence ────────────────────────────────────────────────

  async recordEdd(
    actor: LendingActor,
    borrowerId: string,
    body: {
      sourceOfFunds: string;
      sourceOfWealth: string;
      documentReference: string;
      documentId?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'aml.screen',
        await this.screening.customerResource(tx, tenantId, borrowerId),
        tx,
      );
      const b = await tx.borrower.findFirst({
        where: { id: borrowerId, tenantId },
        select: { pep: true },
      });
      if (!b) throw new NotFoundException('Customer not found');
      if (body.documentId) {
        const doc = await tx.customerDocument.findFirst({
          where: {
            id: body.documentId,
            tenantId,
            borrowerId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        if (!doc)
          throw new BadRequestException(
            'The evidence must be one of this customer’s documents.',
          );
      }
      const pending = await tx.amlEddRecord.findFirst({
        where: { tenantId, borrowerId, status: 'PENDING' },
        select: { id: true },
      });
      if (pending)
        throw new ConflictException(
          'Enhanced due diligence for this customer is already awaiting approval.',
        );
      const row = await tx.amlEddRecord.create({
        data: {
          tenantId,
          borrowerId,
          reason: b.pep ? 'PEP' : 'HIGH_RISK',
          sourceOfFunds: body.sourceOfFunds.trim(),
          sourceOfWealth: body.sourceOfWealth.trim(),
          documentReference: body.documentReference.trim(),
          documentId: body.documentId ?? null,
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'aml.edd.record',
          resourceType: 'AmlEddRecord',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { borrowerId, reason: row.reason },
        },
        tx,
      );
      return row;
    });
  }

  async decideEdd(
    actor: LendingActor,
    eddId: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const e = await tx.amlEddRecord.findFirst({
        where: { id: eddId, tenantId },
      });
      if (!e) throw new NotFoundException('EDD record not found');
      await this.policy.enforce(
        actor,
        'aml.edd.approve',
        await this.screening.customerResource(
          tx,
          tenantId,
          e.borrowerId,
          [e.makerId],
          e.id,
        ),
        tx,
      );
      if (e.status !== 'PENDING')
        throw new ConflictException(
          `This record is already ${e.status.toLowerCase()}.`,
        );
      if (!body.approve && !body.comment?.trim())
        throw new BadRequestException(
          'Say why the due diligence is not accepted.',
        );
      if (body.approve)
        await tx.amlEddRecord.updateMany({
          where: { tenantId, borrowerId: e.borrowerId, status: 'APPROVED' },
          data: { status: 'SUPERSEDED' },
        });
      const res = await tx.amlEddRecord.updateMany({
        where: { id: e.id, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'APPROVED' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
          comment: (body.comment ?? '').trim().slice(0, 500),
        },
      });
      if (res.count !== 1) throw concurrentModification('This EDD record');
      await this.audit.write(
        {
          actor,
          action: 'aml.edd.approve',
          resourceType: 'AmlEddRecord',
          resourceId: e.id,
          outcome: 'SUCCESS',
          details: { approve: body.approve, borrowerId: e.borrowerId },
        },
        tx,
      );
      return tx.amlEddRecord.findFirst({ where: { id: e.id, tenantId } });
    });
  }

  // ── The gate in the capability map ────────────────────────────────────────

  /**
   * Adds the AML gate to a capability map (GET /lending/capabilities/…), so
   * "Why can't I…" names the customer and what is missing before anyone
   * presses the button. Server enforcement is in the services.
   */
  async withGate(
    tenantId: string,
    type: ResourceType,
    id: string,
    caps: Record<
      string,
      { allowed: boolean; blockedBy: { layer: string; message: string }[] }
    >,
  ) {
    const gated = GATED_ACTIONS[type];
    if (!gated) return caps;
    const blockedBy = await this.lp.tenantTx(tenantId, async (tx) => {
      let parties: Map<string, string> | null = null;
      if (type === 'APPLICATION') {
        const app = await tx.application.findFirst({
          where: { id, tenantId },
          select: { id: true, borrowerId: true, groupId: true },
        });
        if (app)
          parties = await this.gate.applicationParties(tx, tenantId, app);
      } else {
        const account = await tx.loanAccount.findFirst({
          where: { id, tenantId },
          select: { id: true, borrowerId: true, applicationId: true },
        });
        if (account)
          parties = await this.gate.loanParties(tx, tenantId, account);
      }
      return parties
        ? AmlGateService.explain(
            await this.gate.blockers(tx, tenantId, parties),
          )
        : [];
    });
    if (!blockedBy.length) return caps;
    const out = { ...caps };
    for (const code of gated)
      if (out[code])
        out[code] = {
          allowed: false,
          blockedBy: [...out[code].blockedBy, ...blockedBy],
        };
    return out;
  }
}
