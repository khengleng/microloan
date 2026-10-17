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
import {
  loadLoanState,
  resourceOf as loanResourceOf,
} from '../servicing/loan-state';
import { FacilityState, loadFacilityState, resourceOf } from './facility-state';
import {
  assertWithinBorrowingBase,
  borrowingBaseAvailabilityFor,
} from './borrowing-base.service';

type Json = Prisma.InputJsonValue;
type Dec = InstanceType<typeof lending.D>;

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
  ) {
    // UC-38: a line with no schedule still has payments due — each
    // statement's minimum payment — and arrears on them age like any other.
    this.servicing.registerBatchHook(async (tx, state, businessDate) => {
      // A card ages its own minimum payments (CardsService); leave it alone.
      if (state.config.card) return;
      state.externalDpd = await this.minimumPaymentArrears(
        tx,
        state.account.tenantId,
        state.account.agreementId,
        state.account.id,
        businessDate,
      );
    });
  }

  /**
   * Days past due on a facility's minimum payments. Repayments since the
   * first statement are applied to the statements' minimum payments oldest
   * first; the oldest one still not covered after its due date sets the
   * days past due. A late payment therefore cures the arrears it covers, and
   * a repaid line is never past due.
   */
  async minimumPaymentArrears(
    tx: Tx,
    tenantId: string,
    agreementId: string,
    loanAccountId: string,
    businessDate: string,
  ): Promise<number> {
    const facility = await tx.facility.findFirst({
      where: { tenantId, agreementId },
      select: { id: true, status: true },
    });
    // A termed-out line is an instalment loan: its schedule governs.
    if (!facility || facility.status === 'TERMED_OUT') return 0;
    const statements = await tx.facilityStatement.findMany({
      where: {
        tenantId,
        facilityId: facility.id,
        minimumPayment: { gt: 0 },
        minimumPaymentDue: { not: null },
      },
      orderBy: { sequence: 'asc' },
    });
    if (!statements.length) return 0;
    const account = await tx.loanAccount.findFirst({
      where: { id: loanAccountId, tenantId },
      select: { principalOutstanding: true },
    });
    if (!account || D(account.principalOutstanding).lte(0)) return 0;
    const paid = await tx.financialEvent.aggregate({
      where: {
        tenantId,
        loanAccountId,
        type: 'REPAYMENT',
        status: 'POSTED',
        valueDate: { gte: statements[0].periodEnd },
      },
      _sum: { amount: true },
    });
    let pool = D(paid._sum.amount ?? '0');
    for (const st of statements) {
      const due = D(st.minimumPayment);
      if (pool.gte(due)) {
        pool = pool.minus(due);
        continue;
      }
      const dueDate = toLocalDate(st.minimumPaymentDue)!;
      return lending.compareDates(dueDate, businessDate) < 0
        ? lending.daysBetween(dueDate, businessDate)
        : 0;
    }
    return 0;
  }

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
      const card = await tx.cardAccount.findFirst({
        where: { tenantId, facilityId: id },
        select: { id: true, reference: true, status: true },
      });
      const borrowingBase = state.config.borrowingBase
        ? await borrowingBaseAvailabilityFor(tx, state, asOf)
        : null;
      const project = state.config.projectFinance
        ? await tx.projectFinance.findFirst({
            where: { tenantId, loanAccountId: state.account.id },
            select: { id: true, status: true },
          })
        : null;
      return {
        facility: view(state.facility),
        card,
        borrowingBase,
        project: project
          ? {
              ...project,
              capitalizeConstructionInterest:
                state.config.projectFinance!.capitalizeConstructionInterest,
              targetDscr: state.config.projectFinance!.targetDscr,
            }
          : null,
        terms: state.terms,
        position,
        loanAccountId: state.account.id,
        drawdowns: drawdowns.map(drawdownView),
        conditions,
        statements: statements.map(statementView),
        limitChanges: limitChanges.map(limitChangeView),
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
      assertNotInvoiceFacility(state, 'drawn');
      refuseCard(state, 'drawdowns');
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
      return drawdownView(drawdown);
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
        // The maker-checker boundary is request vs approve, as it is for a
        // loan disbursement: the requester may not release their own payout,
        // the approver may.
        resourceOf(state, [drawdown.requestedBy], {
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
      refuseCard(state, 'statements');
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
      // UC-41: a flat fee for a period in which the balance went over the limit.
      const wentOver =
        D(statement.overlimitInterest).gt(0) ||
        (state.facility.facilityType !== 'STAGED_DRAWDOWN' &&
          D(statement.closingBalance).gt(D(state.facility.limitAmount)));
      const overlimitFee =
        wentOver && state.config.facility.overlimitFee
          ? D(state.config.facility.overlimitFee)
          : D(0);
      const fee = D(statement.commitmentFee).plus(overlimitFee);
      const charges = interest.plus(fee);

      const loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      const acct = state.config.accounting;
      // LT-17: during construction a project's interest is added to principal
      // rather than billed — the sponsor pays nothing until the project earns.
      const capitalized =
        state.config.projectFinance?.capitalizeConstructionInterest &&
        state.facility.status !== 'TERMED_OUT'
          ? interest
          : D(0);
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
            overlimitFee: overlimitFee.toString(),
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
        if (capitalized.gt(0)) {
          await this.servicing.recordEvent(tx, loanState, {
            type: 'CAPITALIZATION',
            amount: capitalized,
            businessDate,
            valueDate: periodEnd,
            components: {
              facilityId: id,
              capitalizedInterest: capitalized.toString(),
              periodStart,
              periodEnd,
              reason: 'CONSTRUCTION_INTEREST',
            },
            idempotencyKey: `${idempotencyKey}:capitalize`,
            requestHash: hash,
            actor,
            narrative: `Construction interest capitalized ${periodStart} → ${periodEnd} on ${state.facility.reference}`,
            lines: [
              {
                accountCode: acct.loansReceivable,
                debit: capitalized.toString(),
              },
              {
                accountCode: acct.interestReceivable,
                credit: capitalized.toString(),
              },
            ],
          });
        }
        await this.servicing.casAccount(
          tx,
          loanState,
          loanState.account.status,
          {
            principalOutstanding: D(loanState.account.principalOutstanding)
              .plus(capitalized)
              .toString(),
            interestReceivable: D(loanState.account.interestReceivable)
              .plus(interest)
              .minus(capitalized)
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
          calculation: {
            ...statement,
            overlimitFee: overlimitFee.toString(),
          } as unknown as Json,
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
      return {
        statement: statementView(row),
        detail: {
          ...statement,
          overlimitFee: overlimitFee.toString(),
          capitalizedInterest: capitalized.toString(),
        },
      };
    });
  }

  /**
   * Post a repayment against a facility.
   *
   * A facility has no instalments, so there is nothing to allocate a payment
   * to line by line: it has *balances*. The payment clears penalties, fees,
   * interest and then principal, in the product's configured component order,
   * straight off the account's receivables. Paying more than is owed is
   * refused, as everywhere else on the platform — there is no suspense
   * account.
   */
  async postRepayment(
    actor: LendingActor,
    id: string,
    body: { amount: string; valueDate?: string; externalReference?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'facility.repay', id, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      refuseCard(state, 'payments');
      const amount = lending.parseMoney(
        String(body.amount ?? ''),
        state.facility.currency,
        'amount',
      );
      if (amount.lte(0))
        throw new BadRequestException('Amount must be positive.');
      assertNotInvoiceFacility(state, 'repaid');
      if (state.facility.status === 'TERMED_OUT')
        throw new BadRequestException({
          message: `This facility has termed out into an instalment loan; post repayments on loan ${state.account.reference}.`,
          code: 'FACILITY_TERMED_OUT',
          loanAccountId: state.account.id,
        });

      const loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      await this.policy.enforce(
        actor,
        'loan.repayment.post',
        loanResourceOf(loanState, [], amount.toString()),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = body.valueDate ?? businessDate;
      BusinessDateService.checkValueDate(
        valueDate,
        businessDate,
        state.config.repayment.maxBackdateDays,
      );

      const a = loanState.account;
      const balances: Record<string, Dec> = {
        PENALTY: D(a.penaltyReceivable),
        FEE: D(a.feesReceivable),
        TAX: new lending.D(0),
        INTEREST: D(a.interestReceivable),
        PRINCIPAL: D(a.principalOutstanding),
      };
      const owed = Object.values(balances).reduce(
        (t, v) => t.plus(v),
        new lending.D(0),
      );
      if (amount.gt(owed)) {
        throw new BadRequestException(
          `The payment exceeds the ${owed.toString()} ${state.facility.currency} owed on this facility.`,
        );
      }

      let left = amount;
      const applied: Record<string, Dec> = {};
      for (const component of state.config.repayment.allocation.order) {
        if (left.lte(0)) break;
        const available = balances[component] ?? new lending.D(0);
        const take = available.lt(left) ? available : left;
        if (take.gt(0)) {
          applied[component] = take;
          left = left.minus(take);
        }
      }
      const took = (c: string) => applied[c] ?? new lending.D(0);
      const acct = state.config.accounting;
      const credits: { accountCode: string; credit: string }[] = [];
      const add = (accountCode: string, v: Dec) => {
        if (v.gt(0)) credits.push({ accountCode, credit: v.toString() });
      };
      add(acct.penaltyReceivable, took('PENALTY'));
      add(acct.feesReceivable, took('FEE'));
      add(acct.taxPayable, took('TAX'));
      add(acct.interestReceivable, took('INTEREST'));
      add(acct.loansReceivable, took('PRINCIPAL'));

      const event = await this.servicing.recordEvent(tx, loanState, {
        type: 'REPAYMENT',
        amount,
        businessDate,
        valueDate,
        components: Object.fromEntries(
          Object.entries(applied).map(([k, v]) => [k, v.toString()]),
        ),
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Facility repayment on ${state.facility.reference}`,
        externalReference: body.externalReference?.slice(0, 120) ?? null,
        lines: [
          { accountCode: acct.cash, debit: amount.toString() },
          ...credits,
        ],
      });
      await this.servicing.casAccount(tx, loanState, a.status, {
        principalOutstanding: D(a.principalOutstanding)
          .minus(took('PRINCIPAL'))
          .toString(),
        interestReceivable: D(a.interestReceivable)
          .minus(took('INTEREST'))
          .toString(),
        feesReceivable: D(a.feesReceivable).minus(took('FEE')).toString(),
        penaltyReceivable: D(a.penaltyReceivable)
          .minus(took('PENALTY'))
          .toString(),
      });
      await this.writeAudit(actor, tx, state, 'loan.repayment.post', {
        event: event.id,
        amount: amount.toString(),
        valueDate,
      });
      return {
        eventId: event.id,
        applied: Object.fromEntries(
          Object.entries(applied).map(([k, v]) => [k, v.toString()]),
        ),
      };
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
      /** RENEWAL (UC-42): months to extend availability and maturity by. */
      renewalMonths?: number;
    },
  ) {
    const tenantId = requireTenant(actor);
    const types = [
      'INCREASE',
      'DECREASE',
      'EXTENSION',
      'SUSPENSION',
      'REINSTATEMENT',
      'RENEWAL',
    ];
    if (body.changeType === 'RENEWAL' && !body.renewalMonths)
      throw new BadRequestException(
        'A renewal says how many months to extend the facility by.',
      );
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
          renewalMonths:
            body.changeType === 'RENEWAL' ? body.renewalMonths : null,
        },
      });
      await this.writeAudit(actor, tx, state, 'facility.limit.request', {
        change: change.id,
        from: decStr(state.facility.limitAmount),
        to: newLimit.toString(),
      });
      return limitChangeView(change);
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
        // UC-42: a renewal also extends availability and maturity, and
        // brings an expired line back into use.
        const months = change.renewalMonths ?? 0;
        if (
          months &&
          !['ACTIVE', 'SUSPENDED', 'EXPIRED'].includes(state.facility.status)
        )
          throw new ConflictException(
            `A ${state.facility.status.toLowerCase()} facility cannot be renewed.`,
          );
        await this.casFacility(tx, state, {
          limitAmount: decStr(change.newLimit),
          ...(months
            ? {
                availabilityTo: fromLocalDate(
                  lending.addMonths(
                    toLocalDate(state.facility.availabilityTo)!,
                    months,
                  ),
                ),
                maturityDate: fromLocalDate(
                  lending.addMonths(
                    toLocalDate(state.facility.maturityDate)!,
                    months,
                  ),
                ),
                ...(state.facility.status === 'EXPIRED'
                  ? { status: 'ACTIVE' }
                  : {}),
              }
            : {}),
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
  /**
   * LT-17: the repayment profile a project would term out on — sculpted to
   * the projected CFADS at the product's target DSCR — without writing
   * anything. `principal` sizes a what-if; by default it is the balance
   * drawn (construction interest included).
   */
  async sculptPreview(
    actor: LendingActor,
    id: string,
    body: {
      cfads: lending.CfadsProjection[];
      balloonAmount?: string;
      principal?: string;
      startDate?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'facility.read', resourceOf(state), tx);
      const pf = state.config.projectFinance;
      if (!pf)
        throw new BadRequestException({
          message:
            'Only a project-finance facility terms out on a sculpted profile.',
          code: 'NOT_PROJECT_FINANCE',
        });
      const businessDate = await this.businessDate.get(tenantId, tx);
      const start =
        body.startDate ??
        (lending.compareDates(
          businessDate,
          toLocalDate(state.facility.availabilityTo)!,
        ) > 0
          ? businessDate
          : toLocalDate(state.facility.availabilityTo)!);
      const principal =
        body.principal ?? D(state.account.principalOutstanding).toString();
      if (D(principal).lte(0))
        throw new BadRequestException(
          'Nothing is drawn yet; give a principal to size the profile.',
        );
      const result = this.sculpt(state, principal, start, body);
      return {
        ...result,
        startDate: start,
        maturityDate: state.terms.maturityDate,
      };
    });
  }

  private sculpt(
    state: FacilityState,
    principal: string,
    startDate: string,
    body: { cfads: lending.CfadsProjection[]; balloonAmount?: string },
  ) {
    const pf = state.config.projectFinance!;
    const last = body.cfads[body.cfads.length - 1]?.dueDate;
    if (last && lending.compareDates(last, state.terms.maturityDate) > 0)
      throw new BadRequestException({
        message: `The projection runs to ${last}, beyond the facility's maturity ${state.terms.maturityDate}.`,
        code: 'SCULPT_BEYOND_MATURITY',
      });
    return engineCall(() =>
      lending.sculptRepayment({
        principal,
        currency: state.facility.currency,
        rounding: state.config.pricing.rounding,
        startDate,
        annualRate: state.terms.annualRate,
        dayCount: state.config.pricing.dayCount,
        rateConvention: state.config.pricing.rateConvention,
        ratePrecision: state.config.pricing.ratePrecision,
        periods: body.cfads,
        targetDscr: pf.targetDscr,
        balloonAmount: body.balloonAmount ?? null,
      }),
    );
  }

  async termOut(
    actor: LendingActor,
    id: string,
    body: { cfads?: lending.CfadsProjection[]; balloonAmount?: string } = {},
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'facility.manage',
        resourceOf(state),
        tx,
      );
      refuseCard(state, 'term-out');
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
      // Charges to the term-out date are posted by a statement first, so the
      // schedule's own accrual starts exactly where the facility's stopped.
      const statedTo = toLocalDate(state.facility.lastStatementTo);
      if (!statedTo || lending.compareDates(statedTo, businessDate) !== 0)
        throw new ConflictException({
          message: `Generate a statement up to ${businessDate} first, so interest to the term-out date is charged.`,
          code: 'STATEMENT_REQUIRED',
        });
      // The engine checks there is a balance and at least a month to maturity.
      engineCall(() => lending.termOut(state.terms, state.movements));
      const loanState = await loadLoanState(tx, tenantId, state.account.id);
      const principal = D(loanState.account.principalOutstanding);
      if (principal.lte(0))
        throw new ConflictException(
          'Nothing is drawn; there is nothing to term out.',
        );
      const maturity = state.terms.maturityDate;
      const months = lending.wholeMonthsBetween(businessDate, maturity);
      if (months < 1)
        throw new ConflictException(
          `There is less than a month between today and maturity (${maturity}); repay the facility instead.`,
        );

      // UC-43: the drawn balance becomes an amortizing loan on the same
      // account, so repayment, delinquency, penalties and accrual follow the
      // ordinary loan path from here.
      const cfg = state.config;
      // LT-17: a project terms out on a profile sculpted to its projected
      // cash flow instead of level monthly instalments.
      const pf = cfg.projectFinance;
      if (pf && !body.cfads?.length)
        throw new BadRequestException({
          message:
            'A project terms out on a repayment profile sculpted to its projected CFADS; give the projection.',
          code: 'SCULPTING_REQUIRED',
        });
      if (!pf && body.cfads?.length)
        throw new BadRequestException({
          message:
            'Only a project-finance facility terms out on a sculpted profile.',
          code: 'NOT_PROJECT_FINANCE',
        });
      const sculpted = pf
        ? this.sculpt(state, principal.toString(), businessDate, {
            cfads: body.cfads!,
            balloonAmount: body.balloonAmount,
          })
        : null;
      const input: lending.ScheduleInput = sculpted
        ? sculpted.scheduleInput
        : {
            principal: principal.toString(),
            currency: loanState.account.currency,
            rounding: cfg.pricing.rounding,
            disbursementDate: businessDate,
            annualRate: state.terms.annualRate,
            rateConvention: cfg.pricing.rateConvention,
            interestMethod: 'REDUCING_BALANCE',
            accrualBasis: cfg.pricing.accrualBasis,
            dayCount: cfg.pricing.dayCount,
            ratePrecision: cfg.pricing.ratePrecision,
            method: 'EQUAL_INSTALMENT',
            frequency: 'MONTHLY',
            numberOfInstalments: months,
          };
      const schedule = sculpted
        ? sculpted.schedule
        : engineCall(() => lending.generateSchedule(input));
      const version = loanState.agreementVersion + 1;
      const latest = await tx.agreementVersion.findFirst({
        where: {
          tenantId,
          agreementId: loanState.account.agreementId,
          version: loanState.agreementVersion,
        },
      });
      await tx.agreementVersion.create({
        data: {
          tenantId,
          agreementId: loanState.account.agreementId,
          version,
          reason: 'TERM_OUT',
          productConfig: latest!.productConfig as Prisma.InputJsonValue,
          policies: (latest!.policies ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          configHash: latest!.configHash,
          terms: {
            termOutOf: state.facility.reference,
          } as Prisma.InputJsonValue,
          scheduleInput: input as unknown as Prisma.InputJsonValue,
          calculation: { schedule } as unknown as Prisma.InputJsonValue,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          effectiveDate: fromLocalDate(businessDate),
          createdBy: actor.id,
        },
      });
      // Charges already stated but unpaid fall due with the first instalment,
      // so they are collected and aged like any other arrears.
      const carriedInterest = D(loanState.account.interestReceivable);
      const carriedFees = D(loanState.account.feesReceivable);
      await tx.scheduleInstalment.createMany({
        data: schedule.lines.map((l, i) => ({
          tenantId,
          loanAccountId: loanState.account.id,
          agreementVersion: version,
          number: l.number,
          periodStart: fromLocalDate(l.periodStart),
          periodEnd: fromLocalDate(l.periodEnd),
          dueDate: fromLocalDate(l.dueDate),
          openingPrincipal: l.openingPrincipal,
          principalDue: l.principal,
          interestDue: l.interest,
          deferredInterestDue: i === 0 ? carriedInterest.toString() : '0',
          feeDue: i === 0 ? carriedFees.toString() : '0',
          capitalizedInterest: l.capitalizedInterest,
          annualRate: l.annualRate,
          projected: l.projected,
        })),
      });
      await this.servicing.casAccount(tx, loanState, loanState.account.status, {
        instalmentAmount: schedule.instalmentAmount,
        maturityDate: fromLocalDate(
          schedule.lines[schedule.lines.length - 1].dueDate,
        ),
        lastAccrualDate: fromLocalDate(businessDate),
      });
      await this.casFacility(tx, state, {
        status: 'TERMED_OUT',
        termedOutAt: new Date(),
      });
      if (sculpted) {
        const res = await tx.projectFinance.updateMany({
          where: {
            tenantId,
            loanAccountId: loanState.account.id,
            status: 'CONSTRUCTION',
          },
          data: {
            status: 'OPERATIONS',
            termedOutOn: fromLocalDate(businessDate),
            sculpting: {
              cfads: body.cfads,
              balloonAmount: body.balloonAmount ?? null,
              targetDscr: sculpted.targetDscr,
              sculptedDscr: sculpted.sculptedDscr,
              minDscr: sculpted.minDscr,
              averageDscr: sculpted.averageDscr,
              maxDebt: sculpted.maxDebt,
              lines: sculpted.lines,
              explanation: sculpted.explanation,
            } as unknown as Json,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw concurrentModification('The project');
      }
      await this.writeAudit(actor, tx, state, 'facility.manage', {
        action: 'TERM_OUT',
        principal: principal.toString(),
        months: schedule.lines.length,
        agreementVersion: version,
        sculptedDscr: sculpted?.sculptedDscr ?? null,
      });
      return {
        principal: principal.toString(),
        effectiveDate: businessDate,
        months: sculpted ? schedule.lines.length : months,
        sculpting: sculpted
          ? {
              sculptedDscr: sculpted.sculptedDscr,
              minDscr: sculpted.minDscr,
              maxDebt: sculpted.maxDebt,
              lines: sculpted.lines,
            }
          : null,
        instalmentAmount: schedule.instalmentAmount,
        maturityDate: schedule.lines[schedule.lines.length - 1].dueDate,
        carriedInterest: carriedInterest.toString(),
        carriedFees: carriedFees.toString(),
        loanAccountId: loanState.account.id,
      };
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
    // LT-14: a borrowing-base line draws only up to its certified base.
    await assertWithinBorrowingBase(tx, state, req);
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

/**
 * A card's facility carries the limit, but its balance is split into
 * purchases, cash advances and plans that price differently; moving it
 * through the generic facility path would bypass that split. Card money
 * moves through /lending/cards (CardsService) only.
 */
function refuseCard(state: FacilityState, what: string) {
  if (state.config.card)
    throw new ConflictException({
      message: `This facility is a credit card: post ${what} through the card, not the facility.`,
      code: 'CARD_FACILITY',
    });
}

/**
 * `@db.Date` columns come back from Prisma as UTC-midnight `Date`s, which
 * serialize as full timestamps. Business dates leave this API as plain
 * `YYYY-MM-DD`, as they do everywhere else on the platform.
 */
function drawdownView(d: {
  valueDate: Date;
  approvedAt: Date | null;
  releasedAt: Date | null;
  rejectedAt: Date | null;
  amount: unknown;
}) {
  return {
    ...d,
    amount: decStr(d.amount as string),
    valueDate: toLocalDate(d.valueDate),
  };
}

function statementView(st: {
  periodStart: Date;
  periodEnd: Date;
  minimumPaymentDue: Date | null;
}) {
  return {
    ...st,
    periodStart: toLocalDate(st.periodStart),
    periodEnd: toLocalDate(st.periodEnd),
    minimumPaymentDue: toLocalDate(st.minimumPaymentDue),
  };
}

function limitChangeView(c: { effectiveDate: Date }) {
  return { ...c, effectiveDate: toLocalDate(c.effectiveDate) };
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

/**
 * An invoice-finance facility moves only through its invoices (LT-18): an
 * advance is drawn against one approved invoice, and money in is applied to
 * the invoice it pays. A plain drawdown or repayment would leave the invoice
 * register and the balance telling different stories.
 */
function assertNotInvoiceFacility(state: FacilityState, verb: string) {
  if (state.config.trade?.invoice)
    throw new BadRequestException({
      message: `This is an invoice-finance facility; it is ${verb} through its invoices.`,
      code: 'INVOICE_FACILITY',
    });
}
