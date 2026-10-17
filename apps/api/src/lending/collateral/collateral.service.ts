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
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { ServicingService } from '../servicing/servicing.service';
import { LoanState, loadLoanState, resourceOf } from '../servicing/loan-state';

type Json = Prisma.InputJsonValue;

interface Position {
  outstanding: InstanceType<typeof lending.D>;
  lendingValue: InstanceType<typeof lending.D>;
  priorLiens: InstanceType<typeof lending.D>;
  ltv: string | null;
  maxLtv: string | null;
  pledges: {
    pledgeId: string;
    collateralId: string;
    type: string;
    description: string;
    status: string;
    marketValue: string | null;
    valuationDate: string | null;
    haircut: string;
    priorLienAmount: string;
    releasedAt: Date | null;
    releaseReference: string | null;
  }[];
}

/**
 * Collateral on running loans: revaluation and margin calls (UC-51), more
 * collateral to cure one, and release once the loan is closed (UC-73).
 */
@Injectable()
export class CollateralService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {
    // End of day: a margin call is cured once the loan is back within its
    // maximum LTV (repayment or more collateral), and expires past its deadline.
    this.servicing.registerBatchHook(async (tx, state, businessDate) => {
      await this.reviewMarginCall(tx, state, businessDate);
    });
  }

  /** The loan's pledged collateral, its LTV and its margin calls. */
  async view(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const position = await this.position(tx, state);
      const marginCalls = await tx.marginCall.findMany({
        where: { tenantId, loanAccountId: loanId },
        orderBy: { createdAt: 'desc' },
      });
      const releases = await tx.approvalTask.findMany({
        where: {
          tenantId,
          subjectId: loanId,
          action: 'COLLATERAL_RELEASE',
          status: 'PENDING',
        },
      });
      return {
        ...position,
        outstanding: position.outstanding.toString(),
        lendingValue: position.lendingValue.toString(),
        priorLiens: position.priorLiens.toString(),
        marginCalls: marginCalls.map((m) => ({
          ...m,
          deadline: toLocalDate(m.deadline),
        })),
        pendingReleases: releases,
      };
    });
  }

  /**
   * Record a new valuation of a pledged asset. If the loan is now above its
   * maximum LTV, a margin call opens: repay or add collateral by the deadline.
   */
  async revalue(
    actor: LendingActor,
    loanId: string,
    collateralId: string,
    body: {
      marketValue: string;
      valuationDate: string;
      valuer: string;
      method: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.collateral.revalue',
        resourceOf(state),
        tx,
      );
      const pledge = await this.pledgeOf(tx, state, collateralId);
      if (pledge.status !== 'ACTIVE')
        throw new ConflictException('This collateral has been released.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      lending.parseDate(body.valuationDate, 'valuationDate');
      if (lending.compareDates(body.valuationDate, businessDate) > 0)
        throw new BadRequestException(
          'A valuation cannot be dated in the future.',
        );
      const value = lending.parseMoney(
        body.marketValue,
        state.account.currency,
        'marketValue',
      );
      const valuation = await tx.valuation.create({
        data: {
          tenantId,
          collateralId,
          valuationDate: fromLocalDate(body.valuationDate),
          marketValue: value.toString(),
          valuer: body.valuer.slice(0, 120),
          method: body.method.slice(0, 40),
          recordedBy: actor.id,
        },
      });
      const call = await this.testMargin(
        tx,
        state,
        valuation.id,
        businessDate,
        actor,
      );
      await this.audit.write(
        {
          actor,
          action: 'loan.collateral.revalue',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            collateralId,
            marketValue: value.toString(),
            marginCall: call?.id ?? null,
          },
        },
        tx,
      );
      return { valuation, marginCall: call };
    });
  }

  /** Pledge an additional asset to a running loan (often to cure a margin call). */
  async pledge(
    actor: LendingActor,
    loanId: string,
    body: {
      type: string;
      description: string;
      marketValue: string;
      valuationDate: string;
      valuer: string;
      method: string;
      priorLienAmount?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.collateral.revalue',
        resourceOf(state),
        tx,
      );
      if (!['ACTIVE', 'BOOKED'].includes(state.account.status))
        throw new ConflictException(`Loan is ${state.account.status}.`);
      const accepted = state.config.security.acceptedCollateralTypes;
      if (accepted.length && !accepted.includes(body.type))
        throw new BadRequestException(
          `This product accepts: ${accepted.join(', ')}.`,
        );
      const asset = await tx.collateralAsset.create({
        data: {
          tenantId,
          borrowerId: state.account.borrowerId,
          type: body.type,
          description: body.description.slice(0, 300),
          currency: state.account.currency,
          priorLienAmount: body.priorLienAmount
            ? lending
                .parseMoney(
                  body.priorLienAmount,
                  state.account.currency,
                  'priorLienAmount',
                )
                .toString()
            : '0',
          createdBy: actor.id,
        },
      });
      await tx.valuation.create({
        data: {
          tenantId,
          collateralId: asset.id,
          valuationDate: fromLocalDate(body.valuationDate),
          marketValue: lending
            .parseMoney(body.marketValue, state.account.currency, 'marketValue')
            .toString(),
          valuer: body.valuer.slice(0, 120),
          method: body.method.slice(0, 40),
          recordedBy: actor.id,
        },
      });
      await tx.collateralPledge.create({
        data: {
          tenantId,
          collateralId: asset.id,
          applicationId: state.account.applicationId,
        },
      });
      const businessDate = await this.businessDate.get(tenantId, tx);
      await this.reviewMarginCall(tx, state, businessDate);
      await this.audit.write(
        {
          actor,
          action: 'loan.collateral.revalue',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { pledged: asset.id, type: body.type },
        },
        tx,
      );
      return asset;
    });
  }

  /** UC-73: once the loan is closed, propose releasing a pledge; a different user signs it off. */
  async proposeRelease(
    actor: LendingActor,
    loanId: string,
    collateralId: string,
    body: { reference: string; note?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.collateral.release.propose',
        resourceOf(state),
        tx,
      );
      if (state.account.status !== 'CLOSED')
        throw new ConflictException(
          'Collateral is released only once the loan is closed.',
        );
      const pledge = await this.pledgeOf(tx, state, collateralId);
      if (pledge.status !== 'ACTIVE')
        throw new ConflictException('This collateral is already released.');
      const open = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectId: loanId,
          action: 'COLLATERAL_RELEASE',
          status: 'PENDING',
          payload: { path: ['collateralId'], equals: collateralId },
        },
      });
      if (open)
        throw new ConflictException(
          'A release of this collateral is already awaiting sign-off.',
        );
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: loanId,
          action: 'COLLATERAL_RELEASE',
          requiredPermission: 'loan.disbursement.approve',
          payload: {
            collateralId,
            reference: body.reference.slice(0, 120),
            note: (body.note ?? '').slice(0, 500),
          } as Json,
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.collateral.release.propose',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { task: task.id, collateralId },
        },
        tx,
      );
      return task;
    });
  }

  async decideRelease(
    actor: LendingActor,
    loanId: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const task = await tx.approvalTask.findFirst({
        where: {
          id: taskId,
          tenantId,
          subjectId: loanId,
          action: 'COLLATERAL_RELEASE',
        },
      });
      if (!task) throw new NotFoundException('Release proposal not found');
      const decision = await this.policy.enforce(
        actor,
        'loan.collateral.release.approve',
        resourceOf(state, [task.makerId]),
        tx,
      );
      const res = await tx.approvalTask.updateMany({
        where: { id: taskId, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'EXECUTED' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          comment: body.comment?.slice(0, 500),
        },
      });
      if (res.count !== 1)
        throw concurrentModification('This release proposal');
      const p = task.payload as { collateralId: string; reference: string };
      if (body.approve) {
        const pledge = await this.pledgeOf(tx, state, p.collateralId);
        const updated = await tx.collateralPledge.updateMany({
          where: { id: pledge.id, tenantId, status: 'ACTIVE' },
          data: {
            status: 'RELEASED',
            releasedAt: new Date(),
            releasedBy: actor.id,
            releaseReference: p.reference,
          },
        });
        if (updated.count !== 1) throw concurrentModification('This pledge');
        await this.servicing.outbox(
          tx,
          tenantId,
          'lending.collateral_released',
          {
            loanAccountId: loanId,
            collateralId: p.collateralId,
            reference: p.reference,
          },
        );
      }
      await this.audit.write(
        {
          actor,
          action: 'loan.collateral.release.approve',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          decision,
          details: {
            task: taskId,
            approve: body.approve,
            collateralId: p.collateralId,
          },
        },
        tx,
      );
      return { released: body.approve, collateralId: p.collateralId };
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async pledgeOf(tx: Tx, state: LoanState, collateralId: string) {
    const pledge = await tx.collateralPledge.findFirst({
      where: {
        tenantId: state.account.tenantId,
        collateralId,
        applicationId: state.account.applicationId,
      },
    });
    if (!pledge)
      throw new NotFoundException(
        'This collateral is not pledged to this loan.',
      );
    return pledge;
  }

  /** What the loan owes against what its active collateral will lend. */
  private async position(tx: Tx, state: LoanState): Promise<Position> {
    const a = state.account;
    const pledges = await tx.collateralPledge.findMany({
      where: { tenantId: a.tenantId, applicationId: a.applicationId },
      include: {
        collateral: {
          include: {
            valuations: {
              orderBy: [{ valuationDate: 'desc' }, { createdAt: 'desc' }],
              take: 1,
            },
          },
        },
      },
    });
    let lendingValue = D('0');
    let priorLiens = D('0');
    const rows: Position['pledges'] = [];
    for (const p of pledges) {
      const v = p.collateral.valuations[0];
      const haircut = state.config.security.haircuts[p.collateral.type] ?? '0';
      if (p.status === 'ACTIVE' && v) {
        lendingValue = lendingValue.plus(
          D(v.marketValue).times(new lending.D(1).minus(haircut)),
        );
        priorLiens = priorLiens.plus(D(p.collateral.priorLienAmount));
      }
      rows.push({
        pledgeId: p.id,
        collateralId: p.collateralId,
        type: p.collateral.type,
        description: p.collateral.description,
        status: p.status,
        marketValue: v ? D(v.marketValue).toString() : null,
        valuationDate: v ? toLocalDate(v.valuationDate) : null,
        haircut,
        priorLienAmount: D(p.collateral.priorLienAmount).toString(),
        releasedAt: p.releasedAt,
        releaseReference: p.releaseReference,
      });
    }
    // Lendable value net of loans ranking ahead (LT-04).
    const net = lending.D.max(0, lendingValue.minus(priorLiens));
    const outstanding = D(a.principalOutstanding)
      .plus(D(a.interestReceivable))
      .plus(D(a.feesReceivable))
      .plus(D(a.penaltyReceivable));
    return {
      outstanding,
      lendingValue: net,
      priorLiens,
      ltv: net.gt(0)
        ? outstanding.div(net).toDecimalPlaces(6).toString()
        : null,
      maxLtv: state.config.security.maxLtv,
      pledges: rows,
    };
  }

  private async testMargin(
    tx: Tx,
    state: LoanState,
    valuationId: string,
    businessDate: string,
    actor: LendingActor,
  ) {
    const maxLtv = state.config.security.maxLtv;
    if (!maxLtv || state.account.status !== 'ACTIVE') return null;
    const pos = await this.position(tx, state);
    const call = lending.marginCall(
      pos.outstanding.toString(),
      pos.lendingValue.toString(),
      maxLtv,
      state.config.pricing.rounding,
    );
    if (!call.breached) return null;
    const open = await tx.marginCall.findFirst({
      where: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
        status: 'OPEN',
      },
    });
    if (open) return open;
    const created = await tx.marginCall.create({
      data: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
        valuationId,
        ltv: call.ltv === 'Infinity' ? '999999' : call.ltv,
        maxLtv,
        outstanding: pos.outstanding.toString(),
        lendingValue: pos.lendingValue.toString(),
        requiredRepayment: call.requiredRepayment,
        requiredCollateral: call.requiredAdditionalCollateral,
        deadline: fromLocalDate(
          lending.addDays(
            businessDate,
            state.config.security.marginCallCureDays,
          ),
        ),
        createdBy: actor.id,
      },
    });
    await this.servicing.outbox(
      tx,
      state.account.tenantId,
      'lending.margin_call',
      {
        loanAccountId: state.account.id,
        marginCallId: created.id,
        requiredRepayment: call.requiredRepayment,
        requiredCollateral: call.requiredAdditionalCollateral,
        deadline: toLocalDate(created.deadline),
      },
    );
    return created;
  }

  private async reviewMarginCall(
    tx: Tx,
    state: LoanState,
    businessDate: string,
  ) {
    const open = await tx.marginCall.findFirst({
      where: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
        status: 'OPEN',
      },
    });
    if (!open) return;
    const pos = await this.position(tx, state);
    const within =
      pos.outstanding.lte(0) ||
      (pos.lendingValue.gt(0) &&
        pos.outstanding.div(pos.lendingValue).lte(D(open.maxLtv)));
    if (within) {
      await tx.marginCall.updateMany({
        where: {
          id: open.id,
          tenantId: state.account.tenantId,
          status: 'OPEN',
        },
        data: {
          status: 'CURED',
          resolvedAt: new Date(),
          resolution: 'Back within maximum LTV',
        },
      });
      return;
    }
    if (lending.compareDates(businessDate, toLocalDate(open.deadline)!) > 0) {
      await tx.marginCall.updateMany({
        where: {
          id: open.id,
          tenantId: state.account.tenantId,
          status: 'OPEN',
        },
        data: {
          status: 'EXPIRED',
          resolvedAt: new Date(),
          resolution: 'Not cured by the deadline',
        },
      });
      // Collections pick it up from here.
      await this.servicing.outbox(
        tx,
        state.account.tenantId,
        'lending.margin_call_expired',
        {
          loanAccountId: state.account.id,
          marginCallId: open.id,
        },
      );
    }
  }
}
