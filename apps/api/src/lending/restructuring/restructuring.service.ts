import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  concurrentModification,
  fromLocalDate,
  newReference,
  requestHash,
  requireTenant,
  sha256,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import type { Resource } from '../policy/decision';
import { PostingLine } from '../accounting/posting.service';
import { ServicingService } from '../servicing/servicing.service';
import {
  LoanState,
  contractualAccrual,
  engineLine,
  loadLoanState,
  outstanding,
} from '../servicing/loan-state';

type Json = Prisma.InputJsonValue;
type Dec = InstanceType<typeof lending.D>;
const OPEN_STATUSES = [
  'REQUESTED',
  'MORE_INFO_REQUIRED',
  'AFFORDABILITY_ASSESSED',
  'SPECIALIST_REVIEW',
  'OPTIONS_PROPOSED',
  'APPROVED',
  'CUSTOMER_ACCEPTED',
  'CONDITIONS_SATISFIED',
];

/** Tenant restructuring policy: affordability thresholds plus monitoring rules. All configurable. */
export interface RestructurePolicySettings extends lending.AffordabilityPolicy {
  /** Days past due at which the batch opens a system referral (never a term change). */
  referralDpd: number;
}
export const DEFAULT_RESTRUCTURE_POLICY: RestructurePolicySettings = {
  ...lending.DEFAULT_AFFORDABILITY_POLICY,
  referralDpd: 30,
};

export interface RequestBody {
  trigger?: 'STAFF_ON_CUSTOMER_REQUEST' | 'COLLECTIONS' | 'CREDIT_REVIEW';
  hardshipCategory: string;
  difficultyType: 'TEMPORARY' | 'PERSISTENT';
  customerStatement?: string;
  requestedRelief: Record<string, unknown>;
  consentRecorded?: boolean;
  consentReference?: string;
  expectedRecoveryDate?: string;
}

/**
 * Restructuring and hardship management.
 *
 * A request opens a review; nothing here changes contractual terms until an
 * approved proposal that the customer accepted is executed. Execution creates
 * a linked amendment and a new agreement version: the original agreement,
 * every earlier schedule line and the arrears history are retained, and the
 * delinquency classification is held by a probation floor rather than reset.
 */
@Injectable()
export class RestructuringService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {}

  onModuleInit() {
    this.servicing.registerBatchHook((tx, state, businessDate, actor) =>
      this.monitor(tx, state, businessDate, actor),
    );
  }

  // ── Policy ────────────────────────────────────────────────────────────────

  async policySettings(
    tenantId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<{ settings: RestructurePolicySettings; version: string }> {
    const active = await db.affordabilityPolicy.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    if (!active)
      return { settings: DEFAULT_RESTRUCTURE_POLICY, version: 'default' };
    return {
      settings: {
        ...DEFAULT_RESTRUCTURE_POLICY,
        ...(active.settings as object),
      } as RestructurePolicySettings,
      version: String(active.version),
    };
  }

  async proposePolicy(
    actor: LendingActor,
    settings: Partial<RestructurePolicySettings>,
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'access_policy.manage', {
      type: 'ACCESS',
      id: 'restructure-policy',
      tenantId,
      makerIds: [],
    });
    const merged = { ...DEFAULT_RESTRUCTURE_POLICY, ...settings };
    for (const k of [
      'bufferFractionOfIncome',
      'minDscr',
      'seasonalBufferFraction',
    ] as const)
      lending.dec(merged[k], k);
    const last = await this.prisma.affordabilityPolicy.findFirst({
      where: { tenantId },
      orderBy: { version: 'desc' },
    });
    const row = await this.prisma.affordabilityPolicy.create({
      data: {
        tenantId,
        version: (last?.version ?? 0) + 1,
        settings: merged as unknown as Json,
        makerId: actor.id,
      },
    });
    await this.audit.write({
      actor,
      action: 'restructure.policy_submit',
      resourceType: 'AffordabilityPolicy',
      resourceId: row.id,
      outcome: 'SUCCESS',
      details: merged,
    });
    return row;
  }

  async decidePolicy(actor: LendingActor, id: string, approve: boolean) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.affordabilityPolicy.findFirst({
        where: { id, tenantId },
      });
      if (!row) throw new NotFoundException('Policy not found');
      await this.policy.enforce(
        actor,
        'access_policy.approve',
        { type: 'ACCESS', id, tenantId, makerIds: [row.makerId] },
        tx,
      );
      if (approve)
        await tx.affordabilityPolicy.updateMany({
          where: { tenantId, status: 'ACTIVE' },
          data: { status: 'RETIRED' },
        });
      const res = await tx.affordabilityPolicy.updateMany({
        where: { id, tenantId, status: 'SUBMITTED' },
        data: {
          status: approve ? 'ACTIVE' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
        },
      });
      if (res.count !== 1) throw concurrentModification('This policy');
      await this.audit.write(
        {
          actor,
          action: 'restructure.policy_decide',
          resourceType: 'AffordabilityPolicy',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { approve },
        },
        tx,
      );
      return tx.affordabilityPolicy.findFirst({ where: { id, tenantId } });
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(
    actor: LendingActor,
    q: { status?: string; loanAccountId?: string },
  ) {
    const tenantId = requireTenant(actor);
    if (actor.type === 'CUSTOMER') {
      return this.prisma.restructureCase.findMany({
        where: {
          tenantId,
          borrowerId: actor.id,
          ...(q.loanAccountId ? { loanAccountId: q.loanAccountId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    if (!scope) return [];
    return this.prisma.restructureCase.findMany({
      where: {
        tenantId,
        ...(scope as Prisma.RestructureCaseWhereInput),
        ...(q.status ? { status: q.status } : {}),
        ...(q.loanAccountId ? { loanAccountId: q.loanAccountId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async get(actor: LendingActor, caseId: string) {
    const tenantId = requireTenant(actor);
    const c = await this.loadCase(this.prisma, tenantId, caseId);
    const acct = await this.account(this.prisma, tenantId, c.loanAccountId);
    await this.policy.enforce(
      actor,
      actor.type === 'CUSTOMER' ? 'restructure.read_own' : 'restructure.read',
      this.caseResource(c, acct),
    );
    const [evidence, assessments, proposals, conditions, tasks, amendments] =
      await Promise.all([
        this.prisma.restructureEvidence.findMany({
          where: { tenantId, caseId },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.affordabilityAssessment.findMany({
          where: { tenantId, caseId },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.restructureProposal.findMany({
          where: { tenantId, caseId },
          orderBy: { version: 'asc' },
          include: { approvals: true, acceptances: true },
        }),
        this.prisma.restructureCondition.findMany({
          where: { tenantId, caseId },
        }),
        this.prisma.restructureReviewTask.findMany({
          where: { tenantId, caseId },
          orderBy: { dueDate: 'asc' },
        }),
        this.prisma.loanAmendment.findMany({ where: { tenantId, caseId } }),
      ]);
    const view = {
      ...c,
      expectedRecoveryDate: toLocalDate(c.expectedRecoveryDate),
      evidence,
      assessments,
      proposals: proposals.map((p) => ({
        ...p,
        effectiveDate: toLocalDate(p.effectiveDate),
      })),
      conditions,
      tasks: tasks.map((t) => ({ ...t, dueDate: toLocalDate(t.dueDate) })),
      amendments,
    };
    if (actor.type === 'CUSTOMER') {
      // Customers see their request, the proposals offered to them and the outcome — not internal assessments.
      return {
        id: c.id,
        reference: c.reference,
        status: c.status,
        loanAccountId: c.loanAccountId,
        requestedRelief: c.requestedRelief,
        proposals: view.proposals
          .filter((p) =>
            ['APPROVED', 'ACCEPTED', 'EXECUTED'].includes(p.status),
          )
          .map((p) => ({
            id: p.id,
            version: p.version,
            status: p.status,
            effectiveDate: p.effectiveDate,
            comparison: p.comparison,
            proposalHash: p.proposalHash,
            expiresAt: p.expiresAt,
            schedule: (p.calculation as { lines: unknown[] }).lines,
          })),
      };
    }
    return view;
  }

  // ── Initiation ────────────────────────────────────────────────────────────

  async request(actor: LendingActor, loanAccountId: string, body: RequestBody) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const acct = await this.account(tx, tenantId, loanAccountId);
      await this.policy.enforce(
        actor,
        'restructure.request',
        this.loanResource(acct),
        tx,
      );
      const trigger =
        actor.type === 'CUSTOMER'
          ? 'CUSTOMER_REQUEST'
          : (body.trigger ?? 'STAFF_ON_CUSTOMER_REQUEST');
      if (
        actor.type !== 'CUSTOMER' &&
        trigger === 'STAFF_ON_CUSTOMER_REQUEST' &&
        (!body.consentRecorded || !body.consentReference?.trim())
      ) {
        throw new BadRequestException(
          'A staff-initiated request on the customer’s behalf needs a recorded customer request / consent reference.',
        );
      }
      if (!['TEMPORARY', 'PERSISTENT'].includes(body.difficultyType))
        throw new BadRequestException(
          'difficultyType must be TEMPORARY or PERSISTENT.',
        );
      const open = await tx.restructureCase.findFirst({
        where: { tenantId, loanAccountId, status: { in: OPEN_STATUSES } },
      });
      if (open)
        throw new ConflictException(
          `Restructure case ${open.reference} is already open for this loan.`,
        );
      const c = await tx.restructureCase.create({
        data: {
          tenantId,
          reference: newReference('RST'),
          loanAccountId,
          borrowerId: acct.borrowerId,
          branchId: acct.branchId,
          portfolioId: acct.portfolioId,
          trigger,
          initiatorType: actor.type,
          initiatorId: actor.id,
          channel: actor.channel,
          hardshipCategory: String(body.hardshipCategory ?? 'OTHER').slice(
            0,
            40,
          ),
          difficultyType: body.difficultyType,
          customerStatement: (body.customerStatement ?? '').slice(0, 2000),
          requestedRelief: (body.requestedRelief ?? {}) as Json,
          consentRecorded:
            actor.type === 'CUSTOMER' ? true : !!body.consentRecorded,
          consentReference:
            actor.type === 'CUSTOMER'
              ? `PORTAL:${actor.id}`
              : body.consentReference,
          expectedRecoveryDate: body.expectedRecoveryDate
            ? fromLocalDate(body.expectedRecoveryDate)
            : null,
          previousRestructures: acct.restructureCount,
        },
      });
      if (acct.restructureCount > 0) {
        await this.task(
          tx,
          c.id,
          tenantId,
          'REPEAT_REQUEST',
          await this.businessDate.get(tenantId, tx),
          { previousRestructures: acct.restructureCount },
          `repeat:${c.id}`,
        );
      }
      await this.audit.write(
        {
          actor,
          action: 'restructure.request',
          resourceType: 'RestructureCase',
          resourceId: c.id,
          outcome: 'SUCCESS',
          details: {
            loanAccountId,
            trigger,
            hardshipCategory: c.hardshipCategory,
            previousRestructures: acct.restructureCount,
          },
        },
        tx,
      );
      return c;
    });
  }

  async withdraw(actor: LendingActor, caseId: string, reason: string) {
    return this.transitionCase(
      actor,
      caseId,
      'restructure.withdraw',
      'WITHDRAWN',
      reason,
    );
  }

  async requestMoreInfo(actor: LendingActor, caseId: string, note: string) {
    return this.transitionCase(
      actor,
      caseId,
      'restructure.assess',
      'MORE_INFO_REQUIRED',
      note,
    );
  }

  async addEvidence(
    actor: LendingActor,
    caseId: string,
    body: {
      type: string;
      description: string;
      quality: lending.EvidenceQuality;
      documentRef?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const acct = await this.account(tx, tenantId, c.loanAccountId);
      await this.policy.enforce(
        actor,
        'restructure.assess',
        this.caseResource(c, acct),
        tx,
      );
      const verified =
        body.quality === 'VERIFIED' || body.quality === 'PARTIALLY_VERIFIED';
      const ev = await tx.restructureEvidence.create({
        data: {
          tenantId,
          caseId,
          type: body.type.slice(0, 40),
          description: body.description.slice(0, 500),
          quality: body.quality,
          documentRef: body.documentRef?.slice(0, 200),
          providedBy: actor.id,
          verifiedBy: verified ? actor.id : null,
          verifiedAt: verified ? new Date() : null,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'restructure.evidence',
          resourceType: 'RestructureCase',
          resourceId: caseId,
          outcome: 'SUCCESS',
          details: { type: body.type, quality: body.quality },
        },
        tx,
      );
      return ev;
    });
  }

  // ── Affordability ─────────────────────────────────────────────────────────

  /**
   * Record an affordability assessment. Only staff with restructure.assess can
   * enter verified figures; customers cannot set their own verified income.
   */
  async assess(
    actor: LendingActor,
    caseId: string,
    body: {
      inputs: lending.AffordabilityInputs;
      evidenceQuality: lending.EvidenceQuality;
      assumptions: string;
      verificationDate: string;
      comments?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const acct = await this.account(tx, tenantId, c.loanAccountId);
      await this.policy.enforce(
        actor,
        'restructure.assess',
        this.caseResource(c, acct),
        tx,
      );
      const { settings, version } = await this.policySettings(tenantId, tx);
      const businessDate = await this.businessDate.get(tenantId, tx);
      lending.parseDate(body.verificationDate, 'verificationDate');
      const age = lending.daysBetween(body.verificationDate, businessDate);
      if (age < 0)
        throw new BadRequestException(
          'The verification date cannot be in the future.',
        );
      if (age > settings.evidenceMaxAgeDays)
        throw new BadRequestException(
          `Evidence verified ${age} days ago is older than the policy limit of ${settings.evidenceMaxAgeDays} days.`,
        );
      if (!body.assumptions?.trim())
        throw new BadRequestException(
          'Record the assumptions behind the assessment.',
        );
      let result: lending.AffordabilityResult;
      try {
        result = lending.assessAffordability(
          body.inputs,
          acct.currency,
          settings,
        );
      } catch (e) {
        if ((e as Error).name === 'EngineError')
          throw new BadRequestException((e as Error).message);
        throw e;
      }
      const a = await tx.affordabilityAssessment.create({
        data: {
          tenantId,
          caseId,
          template: body.inputs.template,
          inputs: body.inputs as unknown as Json,
          result: result as unknown as Json,
          policySettings: settings as unknown as Json,
          policyVersion: version,
          evidenceQuality: body.evidenceQuality,
          assumptions: body.assumptions.slice(0, 1000),
          verificationDate: fromLocalDate(body.verificationDate),
          assessorId: actor.id,
          comments: (body.comments ?? '').slice(0, 1000),
          sustainable: result.sustainable,
        },
      });
      // Insufficient capacity routes to specialist review instead of producing a schedule.
      const next = result.sustainable
        ? 'AFFORDABILITY_ASSESSED'
        : 'SPECIALIST_REVIEW';
      const res = await tx.restructureCase.updateMany({
        where: { id: caseId, tenantId, version: c.version },
        data: {
          status: next,
          specialistReview: !result.sustainable,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw concurrentModification('This case');
      await this.audit.write(
        {
          actor,
          action: 'restructure.assess',
          resourceType: 'RestructureCase',
          resourceId: caseId,
          outcome: 'SUCCESS',
          details: {
            template: body.inputs.template,
            sustainable: result.sustainable,
            available: result.availableForThisLoanMonthly,
          },
          configVersions: { affordabilityPolicy: version },
        },
        tx,
      );
      return { assessment: a, result, status: next };
    });
  }

  // ── Simulation and proposals ──────────────────────────────────────────────

  /** Side-effect free: no proposal, no balance change, no audit row. */
  async simulate(
    actor: LendingActor,
    caseId: string,
    options: lending.RestructureOptions,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const state = await loadLoanState(tx, tenantId, c.loanAccountId, {
        lock: false,
      });
      const built = await this.build(tx, state, c, options);
      await this.policy.enforce(
        actor,
        'restructure.simulate',
        this.caseResource(c, state.account, {
          requiredFlags: built.requiredFlags,
        }),
        tx,
      );
      return {
        simulation: true,
        note: 'Simulation only — nothing has been proposed, approved or posted.',
        ...built,
      };
    });
  }

  async propose(
    actor: LendingActor,
    caseId: string,
    body: {
      options: lending.RestructureOptions;
      conditions?: { code: string; label: string }[];
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const state = await loadLoanState(tx, tenantId, c.loanAccountId, {
        lock: false,
      });
      const built = await this.build(tx, state, c, body.options);
      await this.policy.enforce(
        actor,
        'restructure.propose',
        this.caseResource(c, state.account, {
          requiredFlags: built.requiredFlags,
        }),
        tx,
      );
      const assessment = await tx.affordabilityAssessment.findFirst({
        where: { tenantId, caseId },
        orderBy: { createdAt: 'desc' },
      });
      if (!assessment)
        throw new BadRequestException(
          'Record an affordability assessment before proposing options.',
        );
      const cfg = state.config.restructuring;
      const { settings } = await this.policySettings(tenantId, tx);
      const exceptions = [...built.policyExceptions];
      if (
        settings.requireVerifiedEvidence &&
        assessment.evidenceQuality === 'SELF_DECLARED'
      )
        exceptions.push('Affordability rests on self-declared evidence only.');
      if (c.specialistReview)
        exceptions.push(
          'Specialist review: the assessment found no sustainable capacity for a normal restructure.',
        );
      // Escalation: repeated restructures, policy exceptions and concessions need more independent approvers.
      let approvalsRequired = 1;
      if (state.account.restructureCount >= cfg.escalateAfterRestructures)
        approvalsRequired++;
      if (exceptions.length) approvalsRequired++;
      approvalsRequired = Math.min(3, approvalsRequired);
      const last = await tx.restructureProposal.findFirst({
        where: { tenantId, caseId },
        orderBy: { version: 'desc' },
      });
      // A changed proposal supersedes earlier ones, including approved or accepted versions.
      await tx.restructureProposal.updateMany({
        where: {
          tenantId,
          caseId,
          status: { in: ['PROPOSED', 'APPROVED', 'ACCEPTED'] },
        },
        data: { status: 'SUPERSEDED' },
      });
      const businessDate = await this.businessDate.get(tenantId, tx);
      const proposalBody = {
        options: body.options,
        snapshot: built.snapshot,
        calculation: built.calculation,
        comparison: built.comparison,
      };
      const p = await tx.restructureProposal.create({
        data: {
          tenantId,
          caseId,
          version: (last?.version ?? 0) + 1,
          effectiveDate: fromLocalDate(body.options.effectiveDate),
          options: body.options as unknown as Json,
          snapshot: built.snapshot as unknown as Json,
          calculation: built.calculation as unknown as Json,
          comparison: built.comparison as unknown as Json,
          concessions: built.concessions as unknown as Json,
          policyExceptions: exceptions as unknown as Json,
          requiredFlags: built.requiredFlags,
          approvalsRequired,
          proposalHash: sha256(lending.canonicalJson(proposalBody)),
          assessmentId: assessment.id,
          proposedBy: actor.id,
          expiresAt: fromLocalDate(
            lending.addDays(businessDate, cfg.proposalValidityDays),
          ),
        },
      });
      await tx.restructureCondition.deleteMany({
        where: { tenantId, caseId, status: 'OUTSTANDING' },
      });
      for (const cond of body.conditions ?? []) {
        await tx.restructureCondition.upsert({
          where: { caseId_code: { caseId, code: cond.code } },
          create: {
            tenantId,
            caseId,
            code: cond.code,
            label: cond.label.slice(0, 160),
          },
          update: {
            label: cond.label.slice(0, 160),
            status: 'OUTSTANDING',
            resolvedAt: null,
            resolvedBy: null,
          },
        });
      }
      const res = await tx.restructureCase.updateMany({
        where: { id: caseId, tenantId, version: c.version },
        data: { status: 'OPTIONS_PROPOSED', version: { increment: 1 } },
      });
      if (res.count !== 1) throw concurrentModification('This case');
      await this.audit.write(
        {
          actor,
          action: 'restructure.propose',
          resourceType: 'RestructureCase',
          resourceId: caseId,
          outcome: 'SUCCESS',
          details: {
            proposal: p.id,
            version: p.version,
            approvalsRequired,
            exceptions,
            newPrincipal: built.calculation.newPrincipal,
          },
        },
        tx,
      );
      return p;
    });
  }

  async approve(
    actor: LendingActor,
    caseId: string,
    proposalId: string,
    comment: string,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const acct = await this.account(tx, tenantId, c.loanAccountId);
      const p = await tx.restructureProposal.findFirst({
        where: { id: proposalId, tenantId, caseId },
        include: { approvals: true },
      });
      if (!p || p.status !== 'PROPOSED')
        throw new ConflictException('This proposal is not awaiting approval.');
      // Validity runs on the business date (the accounting calendar), not the wall clock.
      if (
        toLocalDate(p.expiresAt)! < (await this.businessDate.get(tenantId, tx))
      )
        throw new ConflictException(
          'This proposal has expired; propose again.',
        );
      const calc = p.calculation as unknown as lending.RestructureCalculation;
      const concessions = p.concessions as unknown as {
        chargeConcession: string;
        forgiveness: string;
      };
      const makers = [
        p.proposedBy,
        ...(c.initiatorType === 'USER' ? [c.initiatorId] : []),
        ...p.approvals.map((a) => a.approverId),
      ];
      const base = this.caseResource(c, acct, {
        requiredFlags: p.requiredFlags,
        makerIds: makers,
      });
      // Exposure authority on the new principal; separate authority for each concession.
      const decision = await this.policy.enforce(
        actor,
        'restructure.approve',
        { ...base, amount: calc.newPrincipal },
        tx,
      );
      if (D(concessions.chargeConcession).gt(0))
        await this.policy.enforce(
          actor,
          'restructure.waive_charges',
          { ...base, amount: concessions.chargeConcession },
          tx,
        );
      if (D(concessions.forgiveness).gt(0))
        await this.policy.enforce(
          actor,
          'restructure.forgive_principal',
          { ...base, amount: concessions.forgiveness },
          tx,
        );
      if (!comment?.trim())
        throw new BadRequestException('An approval comment is required.');
      await tx.restructureApproval.create({
        data: {
          tenantId,
          proposalId,
          approverId: actor.id,
          decision: 'APPROVE',
          comment: comment.slice(0, 1000),
          policy: decision as unknown as Json,
        },
      });
      const count =
        p.approvals.filter((a) => a.decision === 'APPROVE').length + 1;
      if (count >= p.approvalsRequired) {
        const res = await tx.restructureProposal.updateMany({
          where: { id: proposalId, tenantId, status: 'PROPOSED' },
          data: { status: 'APPROVED' },
        });
        if (res.count !== 1) throw concurrentModification('This proposal');
        await this.casCase(tx, c, 'OPTIONS_PROPOSED', 'APPROVED');
      } else {
        await this.casCase(tx, c, 'OPTIONS_PROPOSED', 'OPTIONS_PROPOSED');
      }
      await this.audit.write(
        {
          actor,
          action: 'restructure.approve',
          resourceType: 'RestructureCase',
          resourceId: caseId,
          outcome: 'SUCCESS',
          decision,
          details: {
            proposal: proposalId,
            approvals: count,
            required: p.approvalsRequired,
          },
        },
        tx,
      );
      return {
        approvalsRecorded: count,
        approvalsRequired: p.approvalsRequired,
        status: count >= p.approvalsRequired ? 'APPROVED' : 'OPTIONS_PROPOSED',
      };
    });
  }

  async reject(actor: LendingActor, caseId: string, reason: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const acct = await this.account(tx, tenantId, c.loanAccountId);
      const proposals = await tx.restructureProposal.findMany({
        where: { tenantId, caseId, status: 'PROPOSED' },
      });
      await this.policy.enforce(
        actor,
        'restructure.reject',
        this.caseResource(c, acct, {
          makerIds: [c.initiatorId, ...proposals.map((p) => p.proposedBy)],
        }),
        tx,
      );
      if (!reason?.trim())
        throw new BadRequestException('A reason is required.');
      for (const p of proposals)
        await tx.restructureApproval.create({
          data: {
            tenantId,
            proposalId: p.id,
            approverId: actor.id,
            decision: 'REJECT',
            comment: reason.slice(0, 1000),
            policy: {},
          },
        });
      await tx.restructureProposal.updateMany({
        where: { tenantId, caseId, status: 'PROPOSED' },
        data: { status: 'REJECTED' },
      });
      await this.casCase(tx, c, c.status, 'REJECTED', {
        outcomeNote: reason.slice(0, 500),
      });
      await this.audit.write(
        {
          actor,
          action: 'restructure.reject',
          resourceType: 'RestructureCase',
          resourceId: caseId,
          outcome: 'SUCCESS',
          details: { reason },
        },
        tx,
      );
      return { status: 'REJECTED' };
    });
  }

  // ── Customer acceptance and conditions ────────────────────────────────────

  /**
   * Acceptance is recorded separately from approval and binds the exact
   * proposal version through its hash, so a changed proposal cannot inherit it.
   */
  async accept(
    actor: LendingActor,
    caseId: string,
    proposalId: string,
    body: {
      proposalHash: string;
      method?: 'PORTAL_CONFIRMATION' | 'SIGNED_FORM' | 'WITNESSED_VERBAL';
      evidence?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const acct = await this.account(tx, tenantId, c.loanAccountId);
      const p = await tx.restructureProposal.findFirst({
        where: { id: proposalId, tenantId, caseId },
      });
      if (!p) throw new NotFoundException('Proposal not found');
      const customer = actor.type === 'CUSTOMER';
      await this.policy.enforce(
        actor,
        customer ? 'restructure.accept_own' : 'restructure.record_acceptance',
        this.caseResource(c, acct, { requiredFlags: p.requiredFlags }),
        tx,
      );
      if (p.status !== 'APPROVED')
        throw new ConflictException(
          'Only an approved proposal can be accepted.',
        );
      if (
        toLocalDate(p.expiresAt)! < (await this.businessDate.get(tenantId, tx))
      )
        throw new ConflictException('This proposal has expired.');
      if (body.proposalHash !== p.proposalHash)
        throw new ConflictException(
          'The proposal changed since it was shown; review the current version.',
        );
      const method = customer ? 'PORTAL_CONFIRMATION' : body.method;
      if (!method || (!customer && !body.evidence?.trim()))
        throw new BadRequestException(
          'Record how the customer accepted and the evidence (form reference or witness).',
        );
      await tx.restructureAcceptance.create({
        data: {
          tenantId,
          proposalId,
          acceptedByType: customer ? 'CUSTOMER' : 'STAFF_ON_BEHALF',
          acceptedById: actor.id,
          method,
          evidence: (body.evidence ?? `Accepted in the borrower portal`).slice(
            0,
            500,
          ),
          proposalHash: p.proposalHash,
        },
      });
      const res = await tx.restructureProposal.updateMany({
        where: { id: proposalId, tenantId, status: 'APPROVED' },
        data: { status: 'ACCEPTED' },
      });
      if (res.count !== 1) throw concurrentModification('This proposal');
      const outstanding = await tx.restructureCondition.count({
        where: { tenantId, caseId, mandatory: true, status: 'OUTSTANDING' },
      });
      await this.casCase(
        tx,
        c,
        'APPROVED',
        outstanding ? 'CUSTOMER_ACCEPTED' : 'CONDITIONS_SATISFIED',
      );
      await this.audit.write(
        {
          actor,
          action: customer
            ? 'restructure.accept_own'
            : 'restructure.record_acceptance',
          resourceType: 'RestructureCase',
          resourceId: caseId,
          outcome: 'SUCCESS',
          details: { proposal: proposalId, method },
        },
        tx,
      );
      return {
        status: outstanding ? 'CUSTOMER_ACCEPTED' : 'CONDITIONS_SATISFIED',
      };
    });
  }

  async satisfyCondition(
    actor: LendingActor,
    caseId: string,
    code: string,
    evidence: string,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const acct = await this.account(tx, tenantId, c.loanAccountId);
      await this.policy.enforce(
        actor,
        'restructure.satisfy_condition',
        this.caseResource(c, acct),
        tx,
      );
      if (!evidence?.trim())
        throw new BadRequestException('Evidence is required.');
      const res = await tx.restructureCondition.updateMany({
        where: { tenantId, caseId, code, status: 'OUTSTANDING' },
        data: {
          status: 'SATISFIED',
          evidence: evidence.slice(0, 500),
          resolvedBy: actor.id,
          resolvedAt: new Date(),
        },
      });
      if (res.count !== 1)
        throw new NotFoundException('Outstanding condition not found');
      const left = await tx.restructureCondition.count({
        where: { tenantId, caseId, mandatory: true, status: 'OUTSTANDING' },
      });
      if (!left && c.status === 'CUSTOMER_ACCEPTED')
        await this.casCase(tx, c, 'CUSTOMER_ACCEPTED', 'CONDITIONS_SATISFIED');
      await this.audit.write(
        {
          actor,
          action: 'restructure.condition',
          resourceType: 'RestructureCase',
          resourceId: caseId,
          outcome: 'SUCCESS',
          details: { code },
        },
        tx,
      );
      return tx.restructureCondition.findMany({ where: { tenantId, caseId } });
    });
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async execute(
    actor: LendingActor,
    caseId: string,
    body: { externalReference?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'restructure.execute', caseId, body });
    let stale = null as { proposalId: string; differences: unknown } | null;
    const result = await this.servicing
      .money(tenantId, idempotencyKey, hash, async (tx) => {
        const c = await this.loadCase(tx, tenantId, caseId);
        let state = await loadLoanState(tx, tenantId, c.loanAccountId);
        const p = await tx.restructureProposal.findFirst({
          where: { tenantId, caseId, status: 'ACCEPTED' },
          include: { approvals: true, acceptances: true },
        });
        if (!p)
          throw new ConflictException(
            'There is no accepted proposal to execute.',
          );
        const makers = [p.proposedBy];
        await this.policy.enforce(
          actor,
          'restructure.execute',
          this.caseResource(c, state.account, {
            requiredFlags: p.requiredFlags,
            makerIds: makers,
          }),
          tx,
        );
        if (
          !p.approvals.some((a) => a.decision === 'APPROVE') ||
          !p.acceptances.some((a) => a.proposalHash === p.proposalHash)
        ) {
          throw new ConflictException(
            'Mandatory approval and acceptance records are missing.',
          );
        }
        const outstandingConditions = await tx.restructureCondition.count({
          where: { tenantId, caseId, mandatory: true, status: 'OUTSTANDING' },
        });
        if (outstandingConditions)
          throw new ConflictException('Conditions are outstanding.');
        if (state.account.status !== 'ACTIVE')
          throw new ConflictException(`The loan is ${state.account.status}.`);

        const options = p.options as unknown as lending.RestructureOptions;
        const effectiveDate = options.effectiveDate;
        const businessDate = await this.businessDate.get(tenantId, tx);
        BusinessDateService.checkValueDate(
          effectiveDate,
          businessDate,
          state.config.repayment.maxBackdateDays,
        );
        const later = await tx.financialEvent.count({
          where: {
            tenantId,
            loanAccountId: state.account.id,
            status: 'POSTED',
            type: {
              in: ['REPAYMENT', 'SETTLEMENT', 'DISBURSEMENT', 'RESTRUCTURE'],
            },
            valueDate: { gt: fromLocalDate(effectiveDate) },
          },
        });
        if (later)
          throw new ConflictException(
            'Money moved after the proposed effective date; propose again with a current date.',
          );

        // Revalidate balances at the effective date against the proposal snapshot.
        state = await this.servicing.catchUp(
          tx,
          state,
          effectiveDate,
          businessDate,
          actor,
        );
        const snapshot = this.snapshot(state, effectiveDate);
        const drift = lending.snapshotDrift(
          p.snapshot as unknown as lending.BalanceSnapshot,
          snapshot,
          state.config.restructuring.materialityTolerance,
        );
        if (drift.material) {
          stale = { proposalId: p.id, differences: drift.differences };
          throw new ConflictException('PROPOSAL_STALE');
        }
        const rules = this.rules(state);
        const calc = lending.calculateRestructure(
          state.contract,
          snapshot,
          options,
          rules,
        );
        return this.applyAmendment(
          tx,
          actor,
          c,
          p.id,
          state,
          snapshot,
          calc,
          options,
          businessDate,
          body.externalReference ?? null,
          idempotencyKey,
          hash,
          drift.differences.length > 0,
        );
      })
      .catch(async (e) => {
        if (stale) {
          // Balances changed materially: the accepted proposal can no longer be executed as approved.
          await this.lp.tenantTx(tenantId, async (tx) => {
            await tx.restructureProposal.updateMany({
              where: { id: stale!.proposalId, tenantId, status: 'ACCEPTED' },
              data: { status: 'SUPERSEDED' },
            });
            const c = await this.loadCase(tx, tenantId, caseId);
            await tx.restructureCase.updateMany({
              where: { id: caseId, tenantId },
              data: { status: 'OPTIONS_PROPOSED', version: c.version + 1 },
            });
            await this.audit.write(
              {
                actor,
                action: 'restructure.execute',
                resourceType: 'RestructureCase',
                resourceId: caseId,
                outcome: 'FAILURE',
                details: {
                  reason: 'PROPOSAL_STALE',
                  differences: stale!.differences,
                },
              },
              tx,
            );
          });
          throw new ConflictException({
            message:
              'Balances changed since the proposal was accepted. A new proposal needs renewed approval and acceptance.',
            code: 'PROPOSAL_STALE',
            differences: stale.differences,
          });
        }
        throw e;
      });
    return result;
  }

  private async applyAmendment(
    tx: Tx,
    actor: LendingActor,
    c: {
      id: string;
      version: number;
      status: string;
      expectedRecoveryDate: Date | null;
    },
    proposalId: string,
    state: LoanState,
    snapshot: lending.BalanceSnapshot,
    calc: lending.RestructureCalculation,
    options: lending.RestructureOptions,
    businessDate: string,
    externalReference: string | null,
    idempotencyKey: string,
    hash: string,
    recalculated: boolean,
  ) {
    const tenantId = state.account.tenantId;
    const a = state.account;
    const acc = state.config.accounting;
    const k = calc.components;
    const before = {
      snapshot,
      account: {
        principalOutstanding: a.principalOutstanding.toString(),
        interestReceivable: a.interestReceivable.toString(),
        feesReceivable: a.feesReceivable.toString(),
        penaltyReceivable: a.penaltyReceivable.toString(),
        instalmentAmount: a.instalmentAmount?.toString() ?? null,
        maturityDate: toLocalDate(a.maturityDate),
        daysPastDue: a.daysPastDue,
        delinquencyBucket: a.delinquencyBucket,
        restructureCount: a.restructureCount,
        delinquencyFloorBucket: a.delinquencyFloorBucket,
        delinquencyFloorDpd: a.delinquencyFloorDpd,
        probationRemaining: a.probationRemaining,
      },
      agreementVersion: state.agreementVersion,
    };

    // 1. Close the live schedule without erasing it: unpaid lines keep their arrears and the interest they had earned.
    const closedLineIds: string[] = [];
    for (const l of state.lines.filter((x) => x.status === 'DUE')) {
      const e = engineLine(l);
      const earned =
        l.number === 0
          ? new lending.D(0)
          : lending.compareDates(e.dueDate, snapshot.asOf) <= 0
            ? D(l.interestDue).plus(D(l.capitalizedInterest))
            : lending.accruedOnLine(e, snapshot.asOf, state.contract);
      await tx.scheduleInstalment.update({
        where: { id: l.id },
        data: { status: 'RESTRUCTURED', accruedAtClose: earned.toString() },
      });
      closedLineIds.push(l.id);
    }

    // 2. New agreement version and schedule.
    const newVersion = state.agreementVersion + 1;
    const latest = await tx.agreementVersion.findFirst({
      where: {
        tenantId,
        agreementId: a.agreementId,
        version: state.agreementVersion,
      },
    });
    await tx.agreementVersion.create({
      data: {
        tenantId,
        agreementId: a.agreementId,
        version: newVersion,
        reason: 'RESTRUCTURE',
        productConfig: latest!.productConfig as Json,
        // The contract's policies carry forward unchanged.
        policies: (latest!.policies ?? undefined) as Json | undefined,
        configHash: latest!.configHash,
        terms: {
          restructure: options,
          previousTerms: latest!.terms,
        } as unknown as Json,
        scheduleInput: calc.scheduleInput as unknown as Json,
        calculation: calc as unknown as Json,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        effectiveDate: fromLocalDate(snapshot.asOf),
        createdBy: actor.id,
      },
    });
    const maxNumber = await tx.scheduleInstalment.aggregate({
      where: { tenantId, loanAccountId: a.id },
      _max: { number: true },
    });
    let next = (maxNumber._max.number ?? 0) + 1;
    const payNow = k.payableAtEffectiveDate;
    if (Object.values(payNow).some((v) => D(v).gt(0))) {
      // Arrears kept payable on the effective date: an explicit instalment, not erased.
      await tx.scheduleInstalment.create({
        data: {
          tenantId,
          loanAccountId: a.id,
          agreementVersion: newVersion,
          number: next++,
          periodStart: fromLocalDate(snapshot.asOf),
          periodEnd: fromLocalDate(snapshot.asOf),
          dueDate: fromLocalDate(snapshot.asOf),
          openingPrincipal: calc.newPrincipal,
          principalDue: '0',
          interestDue: '0',
          deferredInterestDue: payNow.interest,
          feeDue: payNow.fees,
          penaltyDue: payNow.penalties,
          taxDue: payNow.taxes,
          annualRate: '0',
        },
      });
    }
    const newLines = calc.lines.map((l) => ({
      tenantId,
      loanAccountId: a.id,
      agreementVersion: newVersion,
      number: next + l.number - 1,
      periodStart: fromLocalDate(l.periodStart),
      periodEnd: fromLocalDate(l.periodEnd),
      dueDate: fromLocalDate(l.dueDate),
      openingPrincipal: l.openingPrincipal,
      principalDue: l.principal,
      interestDue: l.interest,
      capitalizedInterest: l.capitalizedInterest,
      deferredInterestDue: l.deferred.interest,
      feeDue: l.deferred.fees,
      penaltyDue: l.deferred.penalties,
      taxDue: l.deferred.taxes,
      annualRate: l.annualRate,
    }));
    await tx.scheduleInstalment.createMany({ data: newLines });

    // 3. Accounting: capitalization, waivers, forgiveness, principal paid now.
    const capTotal = D(k.capitalized.interest)
      .plus(k.capitalized.fees)
      .plus(k.capitalized.penalties);
    const waivedTotal = D(k.waived.interest)
      .plus(k.waived.fees)
      .plus(k.waived.penalties);
    const lines: PostingLine[] = [
      { accountCode: acc.loansReceivable, debit: capTotal.toString() },
      { accountCode: acc.interestReceivable, credit: k.capitalized.interest },
      { accountCode: acc.feesReceivable, credit: k.capitalized.fees },
      { accountCode: acc.penaltyReceivable, credit: k.capitalized.penalties },
      { accountCode: acc.concessionsExpense, debit: waivedTotal.toString() },
      { accountCode: acc.interestReceivable, credit: k.waived.interest },
      { accountCode: acc.feesReceivable, credit: k.waived.fees },
      { accountCode: acc.penaltyReceivable, credit: k.waived.penalties },
      { accountCode: acc.principalForgivenessExpense, debit: k.forgiven },
      { accountCode: acc.loansReceivable, credit: k.forgiven },
      { accountCode: acc.cash, debit: k.principalPaidAtRestructure },
      {
        accountCode: acc.loansReceivable,
        credit: k.principalPaidAtRestructure,
      },
    ];
    if (D(k.principalPaidAtRestructure).gt(0) && !externalReference)
      throw new BadRequestException(
        'Record the payment reference for the principal paid at restructure.',
      );
    const event = await this.servicing.recordEvent(tx, state, {
      type: 'RESTRUCTURE',
      amount: capTotal
        .plus(waivedTotal)
        .plus(k.forgiven)
        .plus(k.principalPaidAtRestructure),
      businessDate,
      valueDate: snapshot.asOf,
      components: {
        components: k,
        newPrincipal: calc.newPrincipal,
        proposal: proposalId,
        case: c.id,
        recalculatedWithinTolerance: recalculated,
      },
      idempotencyKey,
      requestHash: hash,
      actor,
      narrative: `Restructure ${c.id.slice(0, 8)} effective ${snapshot.asOf}`,
      externalReference,
      lines,
    });

    // 4. Balances. Delinquency is NOT reset: the current bucket becomes a floor held through probation.
    const cfg = state.config.restructuring;
    const after = {
      principalOutstanding: calc.newPrincipal,
      interestReceivable: D(a.interestReceivable)
        .minus(k.capitalized.interest)
        .minus(k.waived.interest)
        .toString(),
      feesReceivable: D(a.feesReceivable)
        .minus(k.capitalized.fees)
        .minus(k.waived.fees)
        .toString(),
      penaltyReceivable: D(a.penaltyReceivable)
        .minus(k.capitalized.penalties)
        .minus(k.waived.penalties)
        .toString(),
    };
    const worse = (x: string | null, y: string | null) => {
      const order = [...state.config.operations.delinquencyBuckets]
        .sort((p, q) => p.minDpd - q.minDpd)
        .map((b) => b.code);
      if (!x) return y;
      if (!y) return x;
      return order.indexOf(x) >= order.indexOf(y) ? x : y;
    };
    await this.servicing.casAccount(tx, state, 'ACTIVE', {
      ...after,
      instalmentAmount: calc.schedule.instalmentAmount,
      maturityDate: fromLocalDate(calc.schedule.maturityDate),
      isRestructured: true,
      restructureCount: { increment: 1 },
      lastRestructuredAt: new Date(),
      delinquencyFloorBucket: worse(
        a.delinquencyFloorBucket,
        a.delinquencyBucket,
      ),
      delinquencyFloorDpd: Math.max(a.delinquencyFloorDpd ?? 0, a.daysPastDue),
      probationRemaining: cfg.probationInstalments,
      lastAccrualDate: a.lastAccrualDate,
    });

    const amendment = await tx.loanAmendment.create({
      data: {
        tenantId,
        loanAccountId: a.id,
        caseId: c.id,
        proposalId,
        fromAgreementVersion: state.agreementVersion,
        toAgreementVersion: newVersion,
        effectiveDate: fromLocalDate(snapshot.asOf),
        beforeSnapshot: before as unknown as Json,
        afterSnapshot: {
          ...after,
          newLinesFrom: next,
          closedLineIds,
          instalmentAmount: calc.schedule.instalmentAmount,
          maturityDate: calc.schedule.maturityDate,
        } as unknown as Json,
        financialEventId: event.id,
        executedBy: actor.id,
      },
    });
    await tx.restructureProposal.updateMany({
      where: { id: proposalId, tenantId, status: 'ACCEPTED' },
      data: { status: 'EXECUTED' },
    });
    await tx.restructureCase.updateMany({
      where: { id: c.id, tenantId },
      data: { status: 'MONITORING', version: { increment: 1 } },
    });

    // 5. Monitoring tasks: relief expiry, probation review, balloon maturity, affordability refresh.
    const temp = Math.max(
      options.paymentDeferralInstalments ?? 0,
      (options.paymentDeferralInstalments ?? 0) +
        (options.interestOnlyInstalments ?? 0),
      options.temporaryRate?.instalments ?? 0,
    );
    if (temp > 0 && calc.lines[temp - 1])
      await this.task(
        tx,
        c.id,
        tenantId,
        'RELIEF_EXPIRY',
        calc.lines[temp - 1].dueDate,
        { instalments: temp },
        `relief:${amendment.id}`,
      );
    const probationLine =
      calc.lines[
        Math.min(calc.lines.length, Math.max(1, cfg.probationInstalments)) - 1
      ];
    if (cfg.probationInstalments > 0 && probationLine)
      await this.task(
        tx,
        c.id,
        tenantId,
        'PROBATION_REVIEW',
        probationLine.dueDate,
        { probationInstalments: cfg.probationInstalments },
        `probation:${amendment.id}`,
      );
    if (options.balloonAmount)
      await this.task(
        tx,
        c.id,
        tenantId,
        'BALLOON_MATURITY',
        lending.addDays(calc.schedule.maturityDate, -30),
        { balloon: options.balloonAmount },
        `balloon:${amendment.id}`,
      );
    if (c.expectedRecoveryDate)
      await this.task(
        tx,
        c.id,
        tenantId,
        'AFFORDABILITY_REFRESH',
        toLocalDate(c.expectedRecoveryDate)!,
        {},
        `refresh:${amendment.id}`,
      );

    await this.servicing.outbox(tx, tenantId, 'lending.restructured', {
      loanAccountId: a.id,
      eventId: event.id,
      amendmentId: amendment.id,
    });
    await this.audit.write(
      {
        actor,
        action: 'restructure.execute',
        resourceType: 'LoanAccount',
        resourceId: a.id,
        outcome: 'SUCCESS',
        details: {
          case: c.id,
          amendment: amendment.id,
          newPrincipal: calc.newPrincipal,
          components: k,
        },
        configVersions: {
          agreementVersion: newVersion,
          engine: lending.LENDING_ENGINE_VERSION,
        },
        businessDate: fromLocalDate(businessDate),
      },
      tx,
    );
    return { event, amendment };
  }

  /**
   * Reverse an executed amendment by contra entry. Allowed only before any
   * later financial activity on the loan, so the restored schedule is exact.
   */
  async reverse(
    actor: LendingActor,
    caseId: string,
    reason: string,
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'restructure.reverse', caseId, reason });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const state = await loadLoanState(tx, tenantId, c.loanAccountId);
      const amendment = await tx.loanAmendment.findFirst({
        where: { tenantId, caseId, status: 'EXECUTED' },
      });
      if (!amendment)
        throw new NotFoundException('No executed amendment on this case.');
      await this.policy.enforce(
        actor,
        'restructure.reverse',
        this.caseResource(c, state.account, {
          makerIds: [amendment.executedBy],
        }),
        tx,
      );
      if (!reason?.trim())
        throw new BadRequestException('A reason is required.');
      const original = await tx.financialEvent.findFirst({
        where: { id: amendment.financialEventId, tenantId },
        include: { journal: { include: { lines: true } } },
      });
      const after = await tx.financialEvent.count({
        where: {
          tenantId,
          loanAccountId: state.account.id,
          status: 'POSTED',
          createdAt: { gt: original!.createdAt },
        },
      });
      if (after)
        throw new ConflictException(
          'Financial activity followed this amendment; it can no longer be reversed automatically.',
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const before = amendment.beforeSnapshot as unknown as {
        account: Record<string, unknown>;
        agreementVersion: number;
      };
      const afterSnap = amendment.afterSnapshot as unknown as {
        closedLineIds: string[];
      };

      await tx.scheduleInstalment.updateMany({
        where: {
          tenantId,
          loanAccountId: state.account.id,
          agreementVersion: amendment.toAgreementVersion,
        },
        data: { status: 'SUPERSEDED' },
      });
      await tx.scheduleInstalment.updateMany({
        where: { tenantId, id: { in: afterSnap.closedLineIds } },
        data: { status: 'DUE', accruedAtClose: null },
      });
      const prior = await tx.agreementVersion.findFirst({
        where: {
          tenantId,
          agreementId: state.account.agreementId,
          version: before.agreementVersion,
        },
      });
      await tx.agreementVersion.create({
        data: {
          tenantId,
          agreementId: state.account.agreementId,
          version: state.agreementVersion + 1,
          reason: 'RESTRUCTURE_REVERSAL',
          productConfig: prior!.productConfig as Json,
          // The contract's policies carry forward unchanged.
          policies: (prior!.policies ?? undefined) as Json | undefined,
          configHash: prior!.configHash,
          terms: prior!.terms as Json,
          scheduleInput: prior!.scheduleInput as Json,
          calculation: { reversalOf: amendment.id } as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          effectiveDate: amendment.effectiveDate,
          createdBy: actor.id,
        },
      });
      let event: { id: string } | null = null;
      if (original!.journal) {
        event = await this.servicing.recordEvent(tx, state, {
          type: 'REVERSAL',
          amount: D(original!.amount),
          businessDate,
          valueDate: businessDate,
          components: {
            reversalOf: original!.id,
            amendment: amendment.id,
            reason: reason.slice(0, 500),
          },
          idempotencyKey,
          requestHash: hash,
          actor,
          narrative: `Reversal of restructure ${amendment.id.slice(0, 8)}`,
          reversalOfId: original!.id,
          lines: original!.journal.lines.map((l) => ({
            accountCode: l.accountCode,
            debit: l.credit.toString(),
            credit: l.debit.toString(),
          })),
        });
      }
      await tx.financialEvent.update({
        where: { id: original!.id },
        data: { status: 'REVERSED' },
      });
      const b = before.account;
      await this.servicing.casAccount(tx, state, 'ACTIVE', {
        principalOutstanding: b.principalOutstanding as string,
        interestReceivable: b.interestReceivable as string,
        feesReceivable: b.feesReceivable as string,
        penaltyReceivable: b.penaltyReceivable as string,
        instalmentAmount: (b.instalmentAmount as string | null) ?? null,
        maturityDate: b.maturityDate
          ? fromLocalDate(b.maturityDate as string)
          : null,
        restructureCount: b.restructureCount as number,
        isRestructured: (b.restructureCount as number) > 0,
        delinquencyFloorBucket:
          (b.delinquencyFloorBucket as string | null) ?? null,
        delinquencyFloorDpd: (b.delinquencyFloorDpd as number | null) ?? null,
        probationRemaining: b.probationRemaining as number,
      });
      await tx.loanAmendment.update({
        where: { id: amendment.id },
        data: { status: 'REVERSED', reversalEventId: event?.id ?? null },
      });
      await tx.restructureCase.updateMany({
        where: { id: caseId, tenantId },
        data: {
          status: 'REVERSED',
          outcomeNote: reason.slice(0, 500),
          version: { increment: 1 },
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'restructure.reverse',
          resourceType: 'RestructureCase',
          resourceId: caseId,
          outcome: 'SUCCESS',
          details: { amendment: amendment.id, reason },
        },
        tx,
      );
      return { reversed: true, event };
    });
  }

  // ── Monitoring (end-of-day batch hook) ────────────────────────────────────

  async monitor(
    tx: Tx,
    state: LoanState,
    businessDate: string,
    actor: LendingActor,
  ): Promise<void> {
    const tenantId = state.account.tenantId;
    const { settings } = await this.policySettings(tenantId, tx);
    // System referral on approved monitoring rules: opens a review, never changes terms.
    if (state.account.daysPastDue >= settings.referralDpd) {
      const open = await tx.restructureCase.findFirst({
        where: {
          tenantId,
          loanAccountId: state.account.id,
          status: { in: [...OPEN_STATUSES, 'MONITORING'] },
        },
      });
      if (!open) {
        await tx.restructureCase.create({
          data: {
            tenantId,
            reference: newReference('RST'),
            loanAccountId: state.account.id,
            borrowerId: state.account.borrowerId,
            branchId: state.account.branchId,
            portfolioId: state.account.portfolioId,
            trigger: 'SYSTEM_REFERRAL',
            initiatorType: 'SYSTEM',
            initiatorId: `rule:referralDpd>=${settings.referralDpd}`,
            channel: 'SYSTEM',
            hardshipCategory: 'ARREARS',
            difficultyType: 'TEMPORARY',
            requestedRelief: {},
            previousRestructures: state.account.restructureCount,
          },
        });
      }
    }
    if (!state.account.isRestructured) return;
    const amendment = await tx.loanAmendment.findFirst({
      where: { tenantId, loanAccountId: state.account.id, status: 'EXECUTED' },
      orderBy: { createdAt: 'desc' },
    });
    if (!amendment) return;
    const revised = state.lines
      .filter((l) => l.agreementVersion >= amendment.toAgreementVersion)
      .sort((a, b) => a.number - b.number);
    let onTime = 0;
    let broken = false;
    for (const l of revised) {
      const due = toLocalDate(l.dueDate)!;
      if (lending.compareDates(due, businessDate) >= 0) break;
      const unpaid = Object.values(outstanding(l)).some((v) => v.gt(0));
      if (unpaid) {
        broken = true;
        await this.task(
          tx,
          amendment.caseId,
          tenantId,
          'MISSED_REVISED_PAYMENT',
          businessDate,
          { instalment: l.number, dueDate: due },
          `missed:${l.id}`,
        );
        break;
      }
      const lastPayment = await tx.paymentAllocation.findFirst({
        where: {
          tenantId,
          loanAccountId: state.account.id,
          instalmentNumber: l.number,
          event: { status: 'POSTED' },
        },
        orderBy: { event: { valueDate: 'desc' } },
        include: { event: { select: { valueDate: true } } },
      });
      if (
        lastPayment &&
        lending.compareDates(toLocalDate(lastPayment.event.valueDate)!, due) <=
          0
      )
        onTime++;
      else onTime = 0;
    }
    const required = state.config.restructuring.probationInstalments;
    const remaining = broken ? required : Math.max(0, required - onTime);
    if (remaining !== state.account.probationRemaining) {
      state.account.probationRemaining = remaining;
      if (remaining === 0) {
        // Probation passed on observed performance — not because of the restructure itself.
        state.account.delinquencyFloorBucket = null;
        await tx.restructureCase.updateMany({
          where: { id: amendment.caseId, tenantId, status: 'MONITORING' },
          data: {
            status: 'COMPLETED',
            outcomeNote: `Probation completed with ${onTime} on-time revised instalments.`,
          },
        });
      }
    }
    void actor;
  }

  async tasks(actor: LendingActor, q: { status?: string }) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'restructure.monitor');
    if (!scope) return [];
    const cases = await this.prisma.restructureCase.findMany({
      where: { tenantId, ...(scope as Prisma.RestructureCaseWhereInput) },
      select: { id: true },
    });
    const rows = await this.prisma.restructureReviewTask.findMany({
      where: {
        tenantId,
        caseId: { in: cases.map((c) => c.id) },
        ...(q.status ? { status: q.status } : {}),
      },
      orderBy: { dueDate: 'asc' },
      include: {
        case: {
          select: { reference: true, loanAccountId: true, status: true },
        },
      },
    });
    return rows.map((t) => ({ ...t, dueDate: toLocalDate(t.dueDate) }));
  }

  async closeTask(actor: LendingActor, taskId: string, note: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const t = await tx.restructureReviewTask.findFirst({
        where: { id: taskId, tenantId },
      });
      if (!t) throw new NotFoundException('Task not found');
      const c = await this.loadCase(tx, tenantId, t.caseId);
      const acct = await this.account(tx, tenantId, c.loanAccountId);
      await this.policy.enforce(
        actor,
        'restructure.monitor',
        this.caseResource(c, acct, { workflowState: 'MONITORING' }),
        tx,
      );
      await tx.restructureReviewTask.update({
        where: { id: taskId },
        data: {
          status: 'CLOSED',
          closedBy: actor.id,
          closedAt: new Date(),
          detail: { ...(t.detail as object), note: note.slice(0, 500) } as Json,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'restructure.monitor',
          resourceType: 'RestructureCase',
          resourceId: c.id,
          outcome: 'SUCCESS',
          details: { task: taskId, note },
        },
        tx,
      );
      return { closed: true };
    });
  }

  // ── Building blocks ───────────────────────────────────────────────────────

  /** Immutable balance snapshot at `asOf`, including interest earned but not yet posted. */
  snapshot(
    state: LoanState,
    asOf: string,
    postedAccrual?: Dec,
  ): lending.BalanceSnapshot {
    const due = state.lines.filter(
      (l) =>
        l.status === 'DUE' &&
        lending.compareDates(toLocalDate(l.dueDate)!, asOf) <= 0,
    );
    const live = state.lines.filter((l) => l.status === 'DUE');
    const sumC = (
      ls: typeof live,
      c: 'PRINCIPAL' | 'INTEREST' | 'FEE' | 'TAX' | 'PENALTY',
    ) => ls.reduce((s, l) => s.plus(outstanding(l)[c]), new lending.D(0));
    const overdueInterest = sumC(due, 'INTEREST');
    const pending = postedAccrual
      ? lending.D.max(0, contractualAccrual(state, asOf).minus(postedAccrual))
      : new lending.D(0);
    const interestReceivable = D(state.account.interestReceivable).plus(
      pending,
    );
    return {
      asOf,
      currency: state.account.currency,
      principal: D(state.account.principalOutstanding).toString(),
      overduePrincipal: sumC(due, 'PRINCIPAL').toString(),
      overdueInterest: overdueInterest.toString(),
      accruedInterestNotDue: lending.D.max(
        0,
        interestReceivable.minus(overdueInterest),
      ).toString(),
      fees: sumC(live, 'FEE').toString(),
      penalties: sumC(live, 'PENALTY').toString(),
      taxes: sumC(live, 'TAX').toString(),
      unallocatedPayments: '0',
    };
  }

  rules(state: LoanState): lending.RestructureRules {
    const cfg = state.config.restructuring;
    const remaining = state.lines.filter(
      (l) => l.status === 'DUE' && l.number > 0,
    ).length;
    return {
      allowInterestCapitalization: cfg.allowInterestCapitalization,
      allowFeeCapitalization: cfg.allowFeeCapitalization,
      allowPenaltyCapitalization: cfg.allowPenaltyCapitalization,
      maxTotalInstalments: Math.min(
        1200,
        remaining + cfg.maxExtensionInstalments,
      ),
      minAnnualRate: state.config.pricing.fixed?.minAnnualRate ?? null,
      maxAnnualRate: state.config.pricing.fixed?.maxAnnualRate ?? null,
      maxBalloonFraction: state.config.repayment.maxBalloonFraction,
    };
  }

  /** Which restructure options a proposal uses, as product options and availability flags. */
  usedOptions(
    state: LoanState,
    o: lending.RestructureOptions,
  ): { options: lending.RestructureOption[]; flags: string[] } {
    const used = new Set<lending.RestructureOption>();
    const flags = new Set<string>();
    const remaining = state.lines.filter(
      (l) => l.status === 'DUE' && l.number > 0,
    ).length;
    const currentRate =
      state.contract.annualRate ??
      state.contract.rates?.[state.contract.rates.length - 1]?.annualRate ??
      '0';
    if (
      (o.numberOfInstalments && o.numberOfInstalments > remaining) ||
      o.targetInstalment
    ) {
      used.add('TERM_EXTENSION').add('INSTALMENT_REDUCTION');
      flags.add('lending.restructure.term_extension');
    }
    if (o.paymentDeferralInstalments) {
      used.add('PAYMENT_DEFERRAL');
      flags.add('lending.restructure.payment_deferral');
    }
    if (o.interestOnlyInstalments) {
      used.add('INTEREST_ONLY').add('PRINCIPAL_GRACE');
      flags.add('lending.restructure.interest_only');
    }
    if ((o.annualRate && D(o.annualRate).lt(currentRate)) || o.temporaryRate) {
      used.add('RATE_REDUCTION');
      flags.add('lending.restructure.rate_reduction');
    }
    const cap = o.capitalize ?? {};
    if (
      cap.overdueInterest ||
      cap.accruedInterest ||
      cap.fees ||
      cap.penalties ||
      o.deferredInterestTreatment === 'CAPITALIZE'
    ) {
      used.add('CAPITALIZATION');
      flags.add('lending.restructure.capitalization');
    }
    if (
      o.waive?.interest ||
      o.waive?.fees ||
      o.waive?.penalties ||
      o.deferredInterestTreatment === 'WAIVE'
    ) {
      used.add('CHARGE_WAIVER');
      flags.add('lending.restructure.charge_waiver');
    }
    if (o.principalForgiveness && D(o.principalForgiveness).gt(0)) {
      used.add('PRINCIPAL_FORGIVENESS');
      flags.add('lending.restructure.principal_forgiveness');
    }
    if (o.explicitSchedule?.length) used.add('SEASONAL_ALIGNMENT');
    if (o.firstDueDate) used.add('DUE_DATE_CHANGE');
    if (o.balloonAmount) used.add('BALLOON_ADJUSTMENT');
    if (o.arrearsTreatment === 'SPREAD_OVER_TERM')
      used.add('ARREARS_RESCHEDULING');
    return { options: [...used], flags: [...flags] };
  }

  private async build(
    tx: Tx,
    state: LoanState,
    c: { id: string; tenantId: string },
    options: lending.RestructureOptions,
  ) {
    if (state.account.status !== 'ACTIVE')
      throw new ConflictException(`The loan is ${state.account.status}.`);
    if (!state.config.operations.restructureAllowed)
      throw new BadRequestException(
        'This product does not allow restructuring.',
      );
    const businessDate = await this.businessDate.get(c.tenantId, tx);
    const effectiveDate = options.effectiveDate ?? businessDate;
    BusinessDateService.checkValueDate(
      effectiveDate,
      businessDate,
      state.config.repayment.maxBackdateDays,
    );
    const cfg = state.config.restructuring;
    const used = this.usedOptions(state, { ...options, effectiveDate });
    const disallowed = used.options.filter(
      (o) => !cfg.allowedOptions.includes(o),
    );
    if (disallowed.length)
      throw new BadRequestException(
        `This product does not allow: ${disallowed.join(', ')}.`,
      );
    if (
      options.deferredInterestTreatment &&
      !cfg.allowedDeferredInterestTreatments.includes(
        options.deferredInterestTreatment,
      )
    ) {
      throw new BadRequestException(
        `Deferred interest treatment ${options.deferredInterestTreatment} is not allowed for this product.`,
      );
    }
    if ((options.paymentDeferralInstalments ?? 0) > cfg.maxDeferralInstalments)
      throw new BadRequestException(
        `At most ${cfg.maxDeferralInstalments} instalments may be deferred.`,
      );
    const posted = await tx.accrualEvent.aggregate({
      where: { tenantId: c.tenantId, loanAccountId: state.account.id },
      _sum: { amount: true },
    });
    const snapshot = this.snapshot(
      state,
      effectiveDate,
      D(posted._sum.amount ?? '0'),
    );
    let calculation: lending.RestructureCalculation;
    try {
      calculation = lending.calculateRestructure(
        state.contract,
        snapshot,
        { ...options, effectiveDate },
        this.rules(state),
      );
    } catch (e) {
      if ((e as Error).name === 'EngineError')
        throw new BadRequestException({
          message: (e as Error).message,
          code: (e as { code?: string }).code,
        });
      throw e;
    }
    const live = state.lines.filter((l) => l.status === 'DUE');
    const comparison = lending.compareRestructure(
      {
        instalmentAmount: state.account.instalmentAmount?.toString() ?? null,
        maturityDate: toLocalDate(state.account.maturityDate),
        lines: live.map((l) => {
          const o = outstanding(l);
          return {
            dueDate: toLocalDate(l.dueDate)!,
            principal: o.PRINCIPAL.toString(),
            interest: o.INTEREST.toString(),
            charges: o.FEE.plus(o.TAX).plus(o.PENALTY).toString(),
          };
        }),
      },
      calculation,
    );
    // Affordability check against the latest assessment (capacity converted to the payment frequency).
    const assessment = await tx.affordabilityAssessment.findFirst({
      where: { tenantId: c.tenantId, caseId: c.id },
      orderBy: { createdAt: 'desc' },
    });
    const affordability = this.affordabilityCheck(
      assessment?.result as unknown as lending.AffordabilityResult | undefined,
      calculation,
      state,
    );
    const policyExceptions = [
      ...calculation.policyExceptions,
      ...(affordability.fits === false ? [affordability.message] : []),
    ];
    const chargeConcession = D(calculation.concessionValue.total).minus(
      calculation.components.forgiven,
    );
    return {
      snapshot,
      calculation,
      comparison,
      affordability,
      usedOptions: used.options,
      requiredFlags: used.flags,
      policyExceptions,
      concessions: {
        chargeConcession: chargeConcession.toString(),
        forgiveness: calculation.components.forgiven,
        rateReduction: calculation.concessionValue.rateReduction,
        futureInterestWaived: calculation.concessionValue.futureInterestWaived,
      },
    };
  }

  private affordabilityCheck(
    result: lending.AffordabilityResult | undefined,
    calc: lending.RestructureCalculation,
    state: LoanState,
  ): { fits: boolean | null; message: string } {
    if (!result)
      return {
        fits: null,
        message: 'No affordability assessment recorded yet.',
      };
    if (result.seasonalCapacity) {
      const r = lending.seasonalScheduleFits(
        result.seasonalCapacity,
        calc.lines.map((l) => ({ dueDate: l.dueDate, amount: l.total })),
      );
      return {
        fits: r.fits,
        message: r.fits
          ? 'The proposed schedule fits the seasonal cash-flow forecast.'
          : `Cumulative payments exceed seasonal capacity by ${r.firstShortfall!.month}.`,
      };
    }
    const monthly = result.availableForThisLoanMonthly
      ? D(result.availableForThisLoanMonthly)
      : null;
    if (!monthly || monthly.lte(0))
      return {
        fits: false,
        message: 'The assessment shows no capacity for this loan.',
      };
    const frequency =
      calc.scheduleInput.frequency ?? state.contract.frequency ?? 'MONTHLY';
    const perPeriod =
      frequency === 'CUSTOM'
        ? monthly
        : lending.capacityPerPeriod(monthly.toString(), frequency);
    const peak = calc.lines.reduce(
      (m, l) => (D(l.total).gt(m) ? D(l.total) : m),
      new lending.D(0),
    );
    const fits = peak.lte(perPeriod);
    return {
      fits,
      message: fits
        ? `The highest instalment ${peak} is within the assessed capacity of ${perPeriod.toDecimalPlaces(2)} per instalment.`
        : `The highest instalment ${peak} exceeds the assessed capacity of ${perPeriod.toDecimalPlaces(2)} per instalment.`,
    };
  }

  private loanResource(acct: {
    id: string;
    tenantId: string;
    branchId: string;
    portfolioId: string | null;
    legalEntityId: string | null;
    status: string;
    principalOutstanding: unknown;
    currency: string;
    familyCode: string;
    borrowerId: string;
  }): Resource {
    return {
      type: 'LOAN_ACCOUNT',
      id: acct.id,
      tenantId: acct.tenantId,
      branchId: acct.branchId,
      portfolioId: acct.portfolioId,
      legalEntityId: acct.legalEntityId,
      familyCode: acct.familyCode,
      amount: D(acct.principalOutstanding as string).toString(),
      currency: acct.currency,
      workflowState: acct.status,
      makerIds: [],
      ownerBorrowerId: acct.borrowerId,
      productConfigValid: true,
    };
  }

  private caseResource(
    c: { id: string; tenantId: string; status: string; borrowerId: string },
    acct: {
      branchId: string;
      portfolioId: string | null;
      legalEntityId: string | null;
      principalOutstanding: unknown;
      currency: string;
      familyCode: string;
    },
    extra: {
      makerIds?: string[];
      requiredFlags?: string[];
      workflowState?: string;
    } = {},
  ): Resource {
    return {
      type: 'RESTRUCTURE_CASE',
      id: c.id,
      tenantId: c.tenantId,
      branchId: acct.branchId,
      portfolioId: acct.portfolioId,
      legalEntityId: acct.legalEntityId,
      familyCode: acct.familyCode,
      amount: D(acct.principalOutstanding as string).toString(),
      currency: acct.currency,
      workflowState: extra.workflowState ?? c.status,
      makerIds: extra.makerIds ?? [],
      ownerBorrowerId: c.borrowerId,
      requiredFlags: extra.requiredFlags ?? [],
      productConfigValid: true,
    };
  }

  private async loadCase(db: Tx | PrismaService, tenantId: string, id: string) {
    const c = await db.restructureCase.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Restructure case not found');
    return c;
  }

  private async account(db: Tx | PrismaService, tenantId: string, id: string) {
    const a = await db.loanAccount.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('Loan account not found');
    return a;
  }

  private async casCase(
    tx: Tx,
    c: { id: string; tenantId: string; version: number },
    from: string,
    to: string,
    extra: Prisma.RestructureCaseUpdateManyMutationInput = {},
  ) {
    const res = await tx.restructureCase.updateMany({
      where: {
        id: c.id,
        tenantId: c.tenantId,
        status: from,
        version: c.version,
      },
      data: { ...extra, status: to, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This restructure case');
  }

  private async transitionCase(
    actor: LendingActor,
    caseId: string,
    action: string,
    to: string,
    note: string,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const acct = await this.account(tx, tenantId, c.loanAccountId);
      await this.policy.enforce(actor, action, this.caseResource(c, acct), tx);
      if (!note?.trim()) throw new BadRequestException('A note is required.');
      await this.casCase(tx, c, c.status, to, {
        outcomeNote: note.slice(0, 500),
      });
      if (to === 'WITHDRAWN')
        await tx.restructureProposal.updateMany({
          where: { tenantId, caseId, status: { in: ['PROPOSED', 'APPROVED'] } },
          data: { status: 'SUPERSEDED' },
        });
      await this.audit.write(
        {
          actor,
          action,
          resourceType: 'RestructureCase',
          resourceId: caseId,
          outcome: 'SUCCESS',
          details: { to, note },
        },
        tx,
      );
      return { status: to };
    });
  }

  private async task(
    tx: Tx,
    caseId: string,
    tenantId: string,
    type: string,
    dueDate: string,
    detail: Record<string, unknown>,
    dedupeKey: string,
  ) {
    await tx.restructureReviewTask.upsert({
      where: { tenantId_dedupeKey: { tenantId, dedupeKey } },
      create: {
        tenantId,
        caseId,
        type,
        dueDate: fromLocalDate(dueDate),
        detail: detail as Json,
        dedupeKey,
      },
      update: {},
    });
  }
}
