import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  concurrentModification,
  requestHash,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { LoanState, loadLoanState, resourceOf } from './loan-state';
import { CoolingOffTerms, ServicingService } from './servicing.service';

const TASK = 'COOLING_OFF_CANCEL';

/**
 * Cooling-off cancellation (D-125). Within the lender's cooling-off period
 * after disbursement, a customer may cancel the loan by repaying the cash
 * they received — with interest for the days they had it when the lender's
 * settings say so — and no penalty, settlement or lock-in charge; the
 * lender's upfront fees are refunded.
 *
 * Maker-checker: one person records the customer's request inside the
 * window, another approves it; the repayment then closes the loan through
 * the early-settlement machinery (ServicingService.settleInTx) in its
 * cooling-off mode.
 */
@Injectable()
export class CoolingOffService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly settings: TenantSettingsService,
    private readonly servicing: ServicingService,
  ) {}

  /** The window and pricing for one loan, from the settings and its contract. */
  private async termsOf(tx: Tx, state: LoanState) {
    const cp = (await this.settings.get(state.account.tenantId, tx))
      .consumerProtection;
    const disbursed = toLocalDate(state.account.disbursementDate);
    const windowEndsOn =
      disbursed && cp.coolingOffDays > 0
        ? lending.addDays(disbursed, cp.coolingOffDays)
        : null;
    let feeRefund = D('0');
    let feeRefundTax = D('0');
    if (cp.coolingOffRefundsLenderFees) {
      const booking = await tx.agreementVersion.findFirst({
        where: {
          tenantId: state.account.tenantId,
          agreementId: state.account.agreementId,
        },
        orderBy: { version: 'asc' },
        select: { calculation: true },
      });
      const lines =
        (
          booking?.calculation as {
            fees?: { lines?: lending.FeeLine[] };
          } | null
        )?.fees?.lines ?? [];
      for (const l of lines) {
        if (l.waived || l.payee === 'INSURER') continue;
        feeRefund = feeRefund.plus(D(l.amount));
        feeRefundTax = feeRefundTax.plus(D(l.tax));
      }
    }
    const terms: CoolingOffTerms = {
      chargeAccruedInterest: cp.coolingOffChargesAccruedInterest,
      feeRefund: feeRefund.toString(),
      feeRefundTax: feeRefundTax.toString(),
    };
    return { days: cp.coolingOffDays, disbursed, windowEndsOn, terms };
  }

  private within(windowEndsOn: string | null, date: string) {
    return !!windowEndsOn && lending.compareDates(date, windowEndsOn) <= 0;
  }

  /** The cooling-off position of a loan: the window, any request, and the amount to cancel today. */
  async status(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const today = await this.businessDate.get(tenantId, tx);
      const t = await this.termsOf(tx, state);
      const tasks = await tx.approvalTask.findMany({
        where: { tenantId, subjectId: loanId, action: TASK },
        orderBy: { createdAt: 'desc' },
      });
      const open = tasks.find((x) =>
        ['PENDING', 'APPROVED'].includes(x.status),
      );
      let quote: unknown = null;
      if (
        state.account.status === 'ACTIVE' &&
        (this.within(t.windowEndsOn, today) || open?.status === 'APPROVED')
      ) {
        try {
          quote = await this.servicing.quote(tx, state, today, t.terms);
        } catch (e) {
          quote = { error: (e as Error).message };
        }
      }
      return {
        businessDate: today,
        days: t.days,
        disbursementDate: t.disbursed,
        windowEndsOn: t.windowEndsOn,
        open:
          state.account.status === 'ACTIVE' &&
          this.within(t.windowEndsOn, today),
        terms: t.terms,
        quote,
        tasks,
      };
    });
  }

  /** Record the customer's request to cancel, inside the window (maker). */
  async request(
    actor: LendingActor,
    loanId: string,
    body: { reason: string; customerReference?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.cooling_off.request',
        resourceOf(state),
        tx,
      );
      if (!body.reason?.trim())
        throw new BadRequestException('Record why the customer is cancelling.');
      const today = await this.businessDate.get(tenantId, tx);
      const t = await this.termsOf(tx, state);
      if (t.days === 0)
        throw new ConflictException({
          message: 'This lender offers no cooling-off period.',
          code: 'COOLING_OFF_DISABLED',
        });
      if (!this.within(t.windowEndsOn, today))
        throw new ConflictException({
          message: `The cooling-off period ended on ${t.windowEndsOn}; the loan can only be settled early on its own terms.`,
          code: 'COOLING_OFF_EXPIRED',
        });
      const open = await tx.approvalTask.count({
        where: {
          tenantId,
          subjectId: loanId,
          action: TASK,
          status: { in: ['PENDING', 'APPROVED'] },
        },
      });
      if (open)
        throw new ConflictException(
          'A cooling-off cancellation is already pending or approved for this loan.',
        );
      const quote = await this.servicing.quote(tx, state, today, t.terms);
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: loanId,
          action: TASK,
          requiredPermission: 'loan.repayment.reverse',
          currency: state.account.currency,
          amount: quote.payable,
          payload: {
            reason: body.reason.slice(0, 500),
            customerReference: body.customerReference?.slice(0, 120) ?? null,
            requestedOn: today,
            windowEndsOn: t.windowEndsOn,
            terms: { ...t.terms },
          },
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.cooling_off.request',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            task: task.id,
            payable: quote.payable,
            windowEndsOn: t.windowEndsOn,
          },
        },
        tx,
      );
      return { task, quote };
    });
  }

  /** Approve or reject the request (checker ≠ maker). */
  async decide(
    actor: LendingActor,
    loanId: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectId: loanId, action: TASK },
      });
      if (!task) throw new NotFoundException('Cancellation request not found');
      const decision = await this.policy.enforce(
        actor,
        'loan.cooling_off.approve',
        resourceOf(state, [task.makerId]),
        tx,
      );
      const res = await tx.approvalTask.updateMany({
        where: { id: taskId, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'APPROVED' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          comment: body.comment?.slice(0, 500),
        },
      });
      if (res.count !== 1)
        throw concurrentModification('This cancellation request');
      await this.audit.write(
        {
          actor,
          action: body.approve
            ? 'loan.cooling_off.approve'
            : 'loan.cooling_off.reject',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          decision,
          details: { task: taskId },
        },
        tx,
      );
      return tx.approvalTask.findFirst({ where: { id: taskId, tenantId } });
    });
  }

  /**
   * Take the customer's repayment and close the loan as cancelled. The amount
   * must be exactly the cancellation amount on the value date. The request
   * was made inside the window, so a checker's or the customer's delay does
   * not take the right away; interest keeps running until the money comes in.
   */
  async execute(
    actor: LendingActor,
    loanId: string,
    taskId: string,
    body: { amount: string; valueDate?: string; externalReference?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'cooling-off', loanId, taskId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectId: loanId, action: TASK },
      });
      if (!task) throw new NotFoundException('Cancellation request not found');
      if (task.status !== 'APPROVED')
        throw new ConflictException(
          `The cancellation request is ${task.status.toLowerCase()}; it must be approved first.`,
        );
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      const { terms } = await this.termsOf(tx, state);
      const event = await this.servicing.settleInTx(
        tx,
        actor,
        loanId,
        {
          amount: body.amount,
          valueDate: body.valueDate,
          externalReference: body.externalReference,
        },
        idempotencyKey,
        hash,
        { coolingOff: terms },
      );
      const res = await tx.approvalTask.updateMany({
        where: { id: taskId, tenantId, status: 'APPROVED' },
        data: { status: 'EXECUTED', comment: `Cancelled by event ${event.id}` },
      });
      if (res.count !== 1)
        throw concurrentModification('This cancellation request');
      await this.audit.write(
        {
          actor,
          action: 'loan.cooling_off.cancel',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { task: taskId, event: event.id, amount: body.amount },
        },
        tx,
      );
      return event;
    });
  }
}
