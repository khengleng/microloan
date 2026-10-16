import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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
  decStr,
  engineCall,
  fromLocalDate,
  requestHash,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { ServicingService } from '../servicing/servicing.service';
import { loadLoanState } from '../servicing/loan-state';
import { FacilityState, loadFacilityState, resourceOf } from './facility-state';

type Json = Prisma.InputJsonValue;

/**
 * Facilities: revolving lines, overdrafts and staged drawdowns.
 *
 * A facility owns a limit and the governance around drawing against it. The
 * drawn balance itself lives on the facility's LoanAccount and moves through
 * the ordinary servicing path, so repayment, reversal, delinquency,
 * reconciliation and the GL work on a facility exactly as on a term loan and
 * are not reimplemented here.
 *
 * Invariants, matching the rest of the platform:
 *  • releasing a drawdown is one immutable FinancialEvent with a balanced
 *    journal, written in the same transaction as the balance change;
 *  • releasing requires an Idempotency-Key; a retry replays, a reused key with
 *    a different payload 409s;
 *  • every mutation ends with a compare-and-set on Facility.version (and on
 *    Drawdown.version for drawdown transitions), so two requests cannot both
 *    draw the last of a limit;
 *  • the limit is re-checked inside the transaction against committed
 *    movements — never against a figure the client sent or a stale read;
 *  • authorization is re-evaluated inside the transaction.
 */
@Injectable()
export class FacilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(
    actor: LendingActor,
    q: { status?: string; type?: string; search?: string; page?: number },
  ) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'facility.read');
    if (!scope) return { data: [], total: 0 };
    const where: Prisma.FacilityWhereInput = {
      tenantId,
      ...(scope as Prisma.FacilityWhereInput),
    };
    if (q.status) where.status = q.status;
    if (q.type) where.facilityType = q.type;
    if (q.search) where.reference = { contains: q.search, mode: 'insensitive' };
    const take = 50;
    const skip = (Math.max(1, q.page ?? 1) - 1) * take;
    const [data, total] = await Promise.all([
      this.prisma.facility.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.facility.count({ where }),
    ]);
    return { data: data.map(view), total };
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'facility.read', resourceOf(state), tx);
      const asOf = await this.businessDate.get(tenantId, tx);
      const [drawdowns, conditions, statements, limitChanges] =
        await Promise.all([
          tx.drawdown.findMany({
            where: { tenantId, facilityId: id },
            orderBy: { sequence: 'desc' },
          }),
          tx.facilityCondition.findMany({
            where: { tenantId, facilityId: id },
            orderBy: [{ trancheCode: 'asc' }, { code: 'asc' }],
          }),
          tx.facilityStatement.findMany({
            where: { tenantId, facilityId: id },
            orderBy: { sequence: 'desc' },
            take: 24,
          }),
          tx.facilityLimitChange.findMany({
            where: { tenantId, facilityId: id },
            orderBy: { createdAt: 'desc' },
            take: 24,
          }),
        ]);
      const position = engineCall(() =>
        lending.facilityPosition(state.terms, state.movements, asOf),
      );
      return {
        facility: view(state.facility),
        terms: state.terms,
        position,
        loanAccountId: state.account.id,
        drawdowns,
        conditions,
        statements,
        limitChanges,
      };
    });
  }

  /** Price a hypothetical drawdown without writing anything. */
  async simulateDrawdown(
    actor: LendingActor,
    id: string,
    q: { amount: string; valueDate?: string; trancheCode?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'facility.read', resourceOf(state), tx);
      const date = q.valueDate ?? (await this.businessDate.get(tenantId, tx));
      const satisfied = await this.satisfiedConditions(
        tx,
        tenantId,
        id,
        q.trancheCode,
      );
      return engineCall(() =>
        lending.checkDrawdown(state.terms, state.movements, {
          date,
          amount: q.amount,
          trancheCode: q.trancheCode,
          satisfiedConditions: satisfied,
        }),
      );
    });
  }

  // ── Drawdown lifecycle ────────────────────────────────────────────────────

  async requestDrawdown(
    actor: LendingActor,
    id: string,
    body: {
      amount: string;
      valueDate?: string;
      trancheCode?: string;
      purpose?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'facility.drawdown.request',
        resourceOf(state, [], { amount: body.amount }),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = body.valueDate ?? businessDate;
      BusinessDateService.checkValueDate(
        valueDate,
        businessDate,
        state.config.repayment.maxBackdateDays,
      );
      await this.assertNoPendingDrawdown(tx, tenantId, id);
      await this.assertDrawable(tx, state, {
        date: valueDate,
        amount: body.amount,
        trancheCode: body.trancheCode,
      });

      const sequence = await this.nextSequence(tx, tenantId, id);
      const drawdown = await tx.drawdown.create({
        data: {
          tenantId,
          facilityId: id,
          sequence,
          amount: body.amount,
          currency: state.facility.currency,
          valueDate: fromLocalDate(valueDate),
          trancheCode: body.trancheCode ?? null,
          purpose: (body.purpose ?? '').slice(0, 200),
          status: 'REQUESTED',
          requestedBy: actor.id,
        },
      });
      await this.casFacility(tx, state, {});
      await this.writeAudit(actor, tx, state, 'facility.drawdown.request', {
        drawdown: drawdown.id,
        amount: body.amount,
        valueDate,
        tranche: body.trancheCode ?? null,
      });
      return drawdown;
    });
  }

  async approveDrawdown(actor: LendingActor, id: string, drawdownId: string) {
    return this.decideDrawdown(actor, id, drawdownId, 'APPROVE');
  }

  async rejectDrawdown(
    actor: LendingActor,
    id: string,
    drawdownId: string,
    body: { reason: string },
  ) {
    return this.decideDrawdown(actor, id, drawdownId, 'REJECT', body.reason);
  }

  private async decideDrawdown(
    actor: LendingActor,
    id: string,
    drawdownId: string,
    decision: 'APPROVE' | 'REJECT',
    reason?: string,
  ) {
    const tenantId = requireTenant(actor);
    if (decision === 'REJECT' && !reason?.trim()) {
      throw new BadRequestException('Give a reason for rejecting a drawdown.');
    }
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      const drawdown = await this.loadDrawdown(tx, tenantId, id, drawdownId);
      await this.policy.enforce(
        actor,
        decision === 'APPROVE'
          ? 'facility.drawdown.approve'
          : 'facility.drawdown.reject',
        resourceOf(state, [drawdown.requestedBy], {
          workflowState: drawdown.status,
          amount: decStr(drawdown.amount),
        }),
        tx,
      );
      // Re-check against committed movements: another drawdown may have
      // consumed the limit between the request and this approval.
      if (decision === 'APPROVE') {
        await this.assertDrawable(tx, state, {
          date: toLocalDate(drawdown.valueDate)!,
          amount: decStr(drawdown.amount),
          trancheCode: drawdown.trancheCode ?? undefined,
        });
      }
      await this.casDrawdown(tx, drawdown, 'REQUESTED', {
        status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        ...(decision === 'APPROVE'
          ? { approvedBy: actor.id, approvedAt: new Date() }
          : {
              rejectedBy: actor.id,
              rejectedAt: new Date(),
              rejectionReason: reason!.slice(0, 500),
            }),
      });
      await this.writeAudit(
        actor,
        tx,
        state,
        decision === 'APPROVE'
          ? 'facility.drawdown.approve'
          : 'facility.drawdown.reject',
        { drawdown: drawdownId, amount: decStr(drawdown.amount), reason },
      );
      return {
        id: drawdownId,
        status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      };
    });
  }

  async cancelDrawdown(actor: LendingActor, id: string, drawdownId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      const drawdown = await this.loadDrawdown(tx, tenantId, id, drawdownId);
      await this.policy.enforce(
        actor,
        'facility.drawdown.cancel',
        resourceOf(state, [], {
          workflowState: drawdown.status,
          amount: decStr(drawdown.amount),
        }),
        tx,
      );
      await this.casDrawdown(tx, drawdown, 'REQUESTED', {
        status: 'CANCELLED',
      });
      await this.writeAudit(actor, tx, state, 'facility.drawdown.cancel', {
        drawdown: drawdownId,
      });
      return { id: drawdownId, status: 'CANCELLED' };
    });
  }

  /**
   * Release an approved drawdown: money out.
   *
   * Posts a DISBURSEMENT on the facility's loan account — the same event type,
   * journal and balance update a term loan's disbursement uses — and moves the
   * loan account to ACTIVE on the first release.
   */
  async releaseDrawdown(
    actor: LendingActor,
    id: string,
    drawdownId: string,
    body: { externalReference: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'facility.release', id, drawdownId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      const drawdown = await this.loadDrawdown(tx, tenantId, id, drawdownId);
      await this.policy.enforce(
        actor,
        'facility.drawdown.release',
        resourceOf(state, [drawdown.approvedBy ?? ''], {
          workflowState: drawdown.status,
          amount: decStr(drawdown.amount),
        }),
        tx,
      );
      if (!body.externalReference?.trim()) {
        throw new BadRequestException(
          'Record the bank or cash reference of the payout.',
        );
      }
      const valueDate = toLocalDate(drawdown.valueDate)!;
      const amount = D(drawdown.amount);
      // Final check on committed state: approval may be minutes or days old.
      await this.assertDrawable(tx, state, {
        date: valueDate,
        amount: amount.toString(),
        trancheCode: drawdown.trancheCode ?? undefined,
      });

      const businessDate = await this.businessDate.get(tenantId, tx);
      const loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      const acct = state.config.accounting;
      const event = await this.servicing.recordEvent(tx, loanState, {
        type: 'DISBURSEMENT',
        amount,
        businessDate,
        valueDate,
        components: {
          facilityId: id,
          drawdownId,
          trancheCode: drawdown.trancheCode,
          facilityType: state.facility.facilityType,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Facility drawdown ${drawdown.sequence} on ${state.facility.reference}`,
        externalReference: body.externalReference.slice(0, 120),
        lines: [
          { accountCode: acct.loansReceivable, debit: amount.toString() },
          { accountCode: acct.cash, credit: amount.toString() },
        ],
      });

      await this.casDrawdown(tx, drawdown, 'APPROVED', {
        status: 'RELEASED',
        releasedBy: actor.id,
        releasedAt: new Date(),
        eventId: event.id,
        idempotencyKey,
      });
      await this.servicing.casAccount(tx, loanState, loanState.account.status, {
        principalOutstanding: D(loanState.account.principalOutstanding)
          .plus(amount)
          .toString(),
        status: 'ACTIVE',
        ...(loanState.account.disbursementDate
          ? {}
          : { disbursementDate: fromLocalDate(valueDate) }),
      });
      await this.casFacility(tx, state, {
        totalDrawn: D(state.facility.totalDrawn).plus(amount).toString(),
        status: 'ACTIVE',
      });
      await this.writeAudit(actor, tx, state, 'facility.drawdown.release', {
        drawdown: drawdownId,
        event: event.id,
        amount: amount.toString(),
        valueDate,
      });
      return { id: drawdownId, status: 'RELEASED', eventId: event.id };
    });
  }

  // ── Tranche conditions ────────────────────────────────────────────────────

  async decideCondition(
    actor: LendingActor,
    id: string,
    conditionId: string,
    body: { outcome: 'SATISFY' | 'WAIVE'; evidence?: string; reason?: string },
  ) {
    const tenantId = requireTenant(actor);
    const waiving = body.outcome === 'WAIVE';
    if (waiving && !body.reason?.trim()) {
      throw new BadRequestException(
        'Waiving a condition is a credit concession; give a reason.',
      );
    }
    if (!waiving && !body.evidence?.trim()) {
      throw new BadRequestException(
        'Record the evidence that satisfies this condition.',
      );
    }
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      const condition = await tx.facilityCondition.findFirst({
        where: { id: conditionId, tenantId, facilityId: id },
      });
      if (!condition) throw new NotFoundException('Condition not found');
      if (condition.status !== 'PENDING') {
        throw new ConflictException(
          `This condition is already ${condition.status.toLowerCase()}.`,
        );
      }
      await this.policy.enforce(
        actor,
        waiving ? 'facility.condition.waive' : 'facility.condition.manage',
        resourceOf(state),
        tx,
      );
      const updated = await tx.facilityCondition.updateMany({
        where: { id: conditionId, tenantId, status: 'PENDING' },
        data: waiving
          ? {
              status: 'WAIVED',
              waivedBy: actor.id,
              waivedAt: new Date(),
              waiverReason: body.reason!.slice(0, 500),
            }
          : {
              status: 'SATISFIED',
              satisfiedBy: actor.id,
              satisfiedAt: new Date(),
              evidence: body.evidence!.slice(0, 500),
            },
      });
      if (updated.count !== 1) throw concurrentModification('This condition');
      await this.writeAudit(
        actor,
        tx,
        state,
        waiving ? 'facility.condition.waive' : 'facility.condition.manage',
        {
          condition: condition.code,
          tranche: condition.trancheCode,
          reason: body.reason,
        },
      );
      return { id: conditionId, status: waiving ? 'WAIVED' : 'SATISFIED' };
    });
  }

  // ── Charges and statements ────────────────────────────────────────────────

  /**
   * Raise the period's interest, over-limit interest and commitment fee, and
   * record the statement.
   *
   * Charges are posted as receivables against income, exactly as scheduled
   * interest is on a term loan; the statement is the operator-readable record
   * of how the figures were reached. Periods never overlap: the next one
   * starts where the last ended.
   */
  async generateStatement(
    actor: LendingActor,
    id: string,
    body: { periodEnd: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'facility.statement', id, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'facility.statement.generate',
        resourceOf(state),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const periodEnd = body.periodEnd;
      if (lending.compareDates(periodEnd, businessDate) > 0) {
        throw new BadRequestException(
          `A statement cannot close on ${periodEnd}, which is after the business date ${businessDate}.`,
        );
      }
      const periodStart =
        toLocalDate(state.facility.lastStatementTo) ??
        toLocalDate(state.facility.availabilityFrom)!;
      if (lending.compareDates(periodEnd, periodStart) <= 0) {
        throw new ConflictException(
          `The facility is already stated to ${periodStart}.`,
        );
      }

      const statement = engineCall(() =>
        lending.facilityStatement(
          state.terms,
          state.movements,
          periodStart,
          periodEnd,
        ),
      );
      const interest = D(statement.interest).plus(statement.overlimitInterest);
      const fee = D(statement.commitmentFee);
      const charges = interest.plus(fee);

      const loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      const acct = state.config.accounting;
      if (charges.gt(0)) {
        await this.servicing.recordEvent(tx, loanState, {
          type: 'ACCRUAL',
          amount: charges,
          businessDate,
          valueDate: periodEnd,
          components: {
            facilityId: id,
            interest: statement.interest,
            overlimitInterest: statement.overlimitInterest,
            commitmentFee: statement.commitmentFee,
            periodStart,
            periodEnd,
          },
          idempotencyKey,
          requestHash: hash,
          actor,
          narrative: `Facility charges ${periodStart} → ${periodEnd} on ${state.facility.reference}`,
          lines: [
            ...(interest.gt(0)
              ? [
                  {
                    accountCode: acct.interestReceivable,
                    debit: interest.toString(),
                  },
                  {
                    accountCode: acct.interestIncome,
                    credit: interest.toString(),
                  },
                ]
              : []),
            ...(fee.gt(0)
              ? [
                  { accountCode: acct.feesReceivable, debit: fee.toString() },
                  { accountCode: acct.feeIncome, credit: fee.toString() },
                ]
              : []),
          ],
        });
        await this.servicing.casAccount(
          tx,
          loanState,
          loanState.account.status,
          {
            interestReceivable: D(loanState.account.interestReceivable)
              .plus(interest)
              .toString(),
            feesReceivable: D(loanState.account.feesReceivable)
              .plus(fee)
              .toString(),
            lastAccrualDate: fromLocalDate(periodEnd),
          },
        );
      }

      const sequence =
        ((
          await tx.facilityStatement.aggregate({
            where: { tenantId, facilityId: id },
            _max: { sequence: true },
          })
        )._max.sequence ?? 0) + 1;
      const row = await tx.facilityStatement.create({
        data: {
          tenantId,
          facilityId: id,
          sequence,
          periodStart: fromLocalDate(periodStart),
          periodEnd: fromLocalDate(periodEnd),
          openingBalance: statement.openingBalance,
          drawdowns: statement.drawdowns,
          repayments: statement.repayments,
          interest: statement.interest,
          overlimitInterest: statement.overlimitInterest,
          commitmentFee: statement.commitmentFee,
          closingBalance: statement.closingBalance,
          chargesRaised: statement.chargesRaised,
          minimumPayment: statement.minimumPayment?.amount ?? null,
          minimumPaymentDue: statement.minimumPayment
            ? fromLocalDate(lending.addDays(periodEnd, 21))
            : null,
          calculation: statement as unknown as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          createdBy: actor.id,
        },
      });
      await this.casFacility(tx, state, {
        lastStatementTo: fromLocalDate(periodEnd),
        lastAccrualDate: fromLocalDate(periodEnd),
        chargesRaised: D(state.facility.chargesRaised).plus(charges).toString(),
      });
      await this.writeAudit(actor, tx, state, 'facility.statement.generate', {
        statement: row.id,
        periodStart,
        periodEnd,
        charges: charges.toString(),
      });
      return { statement: row, detail: statement };
    });
  }

  // ── Limit changes ─────────────────────────────────────────────────────────

  async requestLimitChange(
    actor: LendingActor,
    id: string,
    body: {
      newLimit: string;
      changeType: string;
      reason: string;
      effectiveDate?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    const types = [
      'INCREASE',
      'DECREASE',
      'EXTENSION',
      'SUSPENSION',
      'REINSTATEMENT',
    ];
    if (!types.includes(body.changeType)) {
      throw new BadRequestException(
        `changeType must be one of ${types.join(', ')}.`,
      );
    }
    if (!body.reason?.trim()) {
      throw new BadRequestException('Give a reason for the limit change.');
    }
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'facility.limit.request',
        resourceOf(state, [], { amount: body.newLimit }),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const effectiveDate = body.effectiveDate ?? businessDate;
      const newLimit = lending.parseMoney(
        body.newLimit,
        state.facility.currency,
        'newLimit',
      );
      if (newLimit.lte(0)) {
        throw new BadRequestException('A facility limit must be positive.');
      }
      // A limit cannot be cut below money already advanced and outstanding.
      const position = engineCall(() =>
        lending.facilityPosition(state.terms, state.movements, businessDate),
      );
      const floor = state.facility.limitReinstates
        ? D(position.outstanding)
        : D(position.totalDrawn);
      if (newLimit.lt(floor)) {
        throw new BadRequestException(
          `The limit cannot be reduced to ${newLimit.toString()}: ${floor.toString()} is already drawn.`,
        );
      }
      const pending = await tx.facilityLimitChange.count({
        where: { tenantId, facilityId: id, status: 'REQUESTED' },
      });
      if (pending) {
        throw new ConflictException(
          'A limit change is already awaiting a decision on this facility.',
        );
      }
      const change = await tx.facilityLimitChange.create({
        data: {
          tenantId,
          facilityId: id,
          previousLimit: decStr(state.facility.limitAmount),
          newLimit: newLimit.toString(),
          changeType: body.changeType,
          reason: body.reason.slice(0, 500),
          effectiveDate: fromLocalDate(effectiveDate),
          status: 'REQUESTED',
          requestedBy: actor.id,
        },
      });
      await this.writeAudit(actor, tx, state, 'facility.limit.request', {
        change: change.id,
        from: decStr(state.facility.limitAmount),
        to: newLimit.toString(),
      });
      return change;
    });
  }

  async decideLimitChange(
    actor: LendingActor,
    id: string,
    changeId: string,
    body: { outcome: 'APPROVE' | 'REJECT' },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      const change = await tx.facilityLimitChange.findFirst({
        where: { id: changeId, tenantId, facilityId: id },
      });
      if (!change) throw new NotFoundException('Limit change not found');
      await this.policy.enforce(
        actor,
        body.outcome === 'APPROVE'
          ? 'facility.limit.approve'
          : 'facility.limit.reject',
        resourceOf(state, [change.requestedBy], {
          workflowState: change.status,
          amount: decStr(change.newLimit),
        }),
        tx,
      );
      const decided = await tx.facilityLimitChange.updateMany({
        where: { id: changeId, tenantId, status: 'REQUESTED' },
        data:
          body.outcome === 'APPROVE'
            ? {
                status: 'APPROVED',
                approvedBy: actor.id,
                approvedAt: new Date(),
              }
            : {
                status: 'REJECTED',
                rejectedBy: actor.id,
                rejectedAt: new Date(),
              },
      });
      if (decided.count !== 1)
        throw concurrentModification('This limit change');
      if (body.outcome === 'APPROVE') {
        await this.casFacility(tx, state, {
          limitAmount: decStr(change.newLimit),
        });
      }
      await this.writeAudit(
        actor,
        tx,
        state,
        body.outcome === 'APPROVE'
          ? 'facility.limit.approve'
          : 'facility.limit.reject',
        { change: changeId, to: decStr(change.newLimit) },
      );
      return {
        id: changeId,
        status: body.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      };
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async changeStatus(
    actor: LendingActor,
    id: string,
    body: { action: 'SUSPEND' | 'REINSTATE' | 'EXPIRE'; reason?: string },
  ) {
    const tenantId = requireTenant(actor);
    const allowed: Record<string, { from: string[]; to: string }> = {
      SUSPEND: { from: ['PENDING', 'ACTIVE'], to: 'SUSPENDED' },
      REINSTATE: { from: ['SUSPENDED'], to: 'ACTIVE' },
      EXPIRE: { from: ['ACTIVE', 'SUSPENDED'], to: 'EXPIRED' },
    };
    const move = allowed[body.action];
    if (!move) throw new BadRequestException('Unknown facility action.');
    if (body.action === 'SUSPEND' && !body.reason?.trim()) {
      throw new BadRequestException('Give a reason for suspending a facility.');
    }
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'facility.manage',
        resourceOf(state),
        tx,
      );
      if (!move.from.includes(state.facility.status)) {
        throw new ConflictException(
          `A ${state.facility.status.toLowerCase()} facility cannot be ${body.action.toLowerCase()}d.`,
        );
      }
      await this.casFacility(tx, state, {
        status: move.to,
        ...(body.action === 'SUSPEND'
          ? {
              suspendedAt: new Date(),
              suspendedReason: body.reason!.slice(0, 500),
            }
          : {}),
        ...(body.action === 'REINSTATE'
          ? { suspendedAt: null, suspendedReason: null }
          : {}),
      });
      await this.writeAudit(actor, tx, state, 'facility.manage', {
        action: body.action,
        reason: body.reason,
      });
      return { id, status: move.to };
    });
  }

  /**
   * Amortize the drawn balance once availability ends.
   *
   * The engine supplies the principal and the remaining months; the schedule
   * itself is built by `generateSchedule`, so a termed-out facility is
   * serviced by exactly the code that services a term loan from then on.
   */
  async termOut(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'facility.manage',
        resourceOf(state),
        tx,
      );
      if (!state.config.facility.termOutOnExpiry) {
        throw new BadRequestException(
          'This facility is repayable on demand; it does not term out.',
        );
      }
      if (!['ACTIVE', 'EXPIRED'].includes(state.facility.status)) {
        throw new ConflictException(
          `A ${state.facility.status.toLowerCase()} facility cannot be termed out.`,
        );
      }
      const businessDate = await this.businessDate.get(tenantId, tx);
      const availabilityEnd = toLocalDate(state.facility.availabilityTo)!;
      if (lending.compareDates(businessDate, availabilityEnd) < 0) {
        throw new ConflictException(
          `Availability runs to ${availabilityEnd}; the facility cannot term out before then.`,
        );
      }
      const open = await tx.drawdown.count({
        where: {
          tenantId,
          facilityId: id,
          status: { in: ['REQUESTED', 'APPROVED'] },
        },
      });
      if (open) {
        throw new ConflictException(
          'Settle the outstanding drawdown requests before terming out.',
        );
      }
      const plan = engineCall(() =>
        lending.termOut(state.terms, state.movements),
      );
      await this.casFacility(tx, state, {
        status: 'TERMED_OUT',
        termedOutAt: new Date(),
      });
      await this.writeAudit(actor, tx, state, 'facility.manage', {
        action: 'TERM_OUT',
        principal: plan.principal,
        months: plan.months,
      });
      return plan;
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Refuse the drawdown unless the engine permits it on committed state.
   *
   * Every caller — request, approval and release — runs this, because the
   * limit can be consumed between any two of them.
   */
  private async assertDrawable(
    tx: Tx,
    state: FacilityState,
    req: { date: string; amount: string; trancheCode?: string },
  ) {
    if (
      state.facility.status !== 'ACTIVE' &&
      state.facility.status !== 'PENDING'
    ) {
      throw new ConflictException(
        `This facility is ${state.facility.status.toLowerCase()}; no drawdown is possible.`,
      );
    }
    const satisfied = await this.satisfiedConditions(
      tx,
      state.facility.tenantId,
      state.facility.id,
      req.trancheCode,
    );
    const check = engineCall(() =>
      lending.checkDrawdown(state.terms, state.movements, {
        ...req,
        satisfiedConditions: satisfied,
      }),
    );
    if (!check.ok) {
      throw new BadRequestException({
        message: check.issues.map((i) => i.message).join(' '),
        code: 'DRAWDOWN_REFUSED',
        issues: check.issues,
      });
    }
  }

  /** Condition codes satisfied or waived for a tranche. */
  private async satisfiedConditions(
    tx: Tx,
    tenantId: string,
    facilityId: string,
    trancheCode?: string,
  ): Promise<string[]> {
    if (!trancheCode) return [];
    const rows = await tx.facilityCondition.findMany({
      where: {
        tenantId,
        facilityId,
        trancheCode,
        status: { in: ['SATISFIED', 'WAIVED'] },
      },
      select: { code: true },
    });
    return rows.map((r) => r.code);
  }

  /** One drawdown decision at a time, so two cannot be approved against one limit. */
  private async assertNoPendingDrawdown(
    tx: Tx,
    tenantId: string,
    facilityId: string,
  ) {
    const pending = await tx.drawdown.count({
      where: {
        tenantId,
        facilityId,
        status: { in: ['REQUESTED', 'APPROVED'] },
      },
    });
    if (pending) {
      throw new ConflictException(
        'A drawdown is already awaiting approval or release on this facility.',
      );
    }
  }

  private async loadDrawdown(
    tx: Tx,
    tenantId: string,
    facilityId: string,
    drawdownId: string,
  ) {
    const drawdown = await tx.drawdown.findFirst({
      where: { id: drawdownId, tenantId, facilityId },
    });
    if (!drawdown) throw new NotFoundException('Drawdown not found');
    return drawdown;
  }

  private async nextSequence(tx: Tx, tenantId: string, facilityId: string) {
    const max = await tx.drawdown.aggregate({
      where: { tenantId, facilityId },
      _max: { sequence: true },
    });
    return (max._max.sequence ?? 0) + 1;
  }

  private async casFacility(
    tx: Tx,
    state: FacilityState,
    data: Prisma.FacilityUpdateManyMutationInput,
  ) {
    const res = await tx.facility.updateMany({
      where: {
        id: state.facility.id,
        tenantId: state.facility.tenantId,
        version: state.facility.version,
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This facility');
  }

  private async casDrawdown(
    tx: Tx,
    drawdown: { id: string; tenantId: string; version: number },
    fromStatus: string,
    data: Prisma.DrawdownUpdateManyMutationInput,
  ) {
    const res = await tx.drawdown.updateMany({
      where: {
        id: drawdown.id,
        tenantId: drawdown.tenantId,
        version: drawdown.version,
        status: fromStatus,
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This drawdown');
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

function view(f: {
  id: string;
  reference: string;
  borrowerId: string;
  facilityType: string;
  currency: string;
  limitAmount: unknown;
  totalDrawn: unknown;
  chargesRaised: unknown;
  status: string;
  availabilityFrom: Date;
  availabilityTo: Date;
  maturityDate: Date;
  createdAt: Date;
}) {
  return {
    id: f.id,
    reference: f.reference,
    borrowerId: f.borrowerId,
    facilityType: f.facilityType,
    currency: f.currency,
    limitAmount: decStr(f.limitAmount as string),
    totalDrawn: decStr(f.totalDrawn as string),
    chargesRaised: decStr(f.chargesRaised as string),
    status: f.status,
    availabilityFrom: toLocalDate(f.availabilityFrom),
    availabilityTo: toLocalDate(f.availabilityTo),
    maturityDate: toLocalDate(f.maturityDate),
    createdAt: f.createdAt,
  };
}
