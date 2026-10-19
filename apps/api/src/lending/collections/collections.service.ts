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
  fromLocalDate,
  requestHash,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { LoanState, loadLoanState, resourceOf } from '../servicing/loan-state';
import { ServicingService, delinquency } from '../servicing/servicing.service';

const D = (v: Prisma.Decimal | string | number | null | undefined) =>
  new lending.D(v === null || v === undefined ? 0 : v.toString());

type Line = LoanState['lines'][number];
const owed = (l: Line) =>
  D(l.principalDue)
    .plus(D(l.interestDue))
    .plus(D(l.feeDue))
    .plus(D(l.taxDue))
    .plus(D(l.penaltyDue))
    .minus(D(l.principalPaid))
    .minus(D(l.interestPaid))
    .minus(D(l.feePaid))
    .minus(D(l.taxPaid))
    .minus(D(l.penaltyPaid));

export const TASK_OUTCOMES = [
  'CONTACTED',
  'NO_ANSWER',
  'PROMISE_TO_PAY',
  'VISITED',
  'NOT_FOUND',
  'REFUSED',
  'NOTICE_SENT',
  'REFER_LEGAL',
] as const;

/**
 * Working loans in arrears beyond the end-of-day figures:
 * - UC-58 the collections ladder: end of day raises one task per stage per
 *   arrears episode; SMS and notices go out at once, calls, visits and legal
 *   reviews wait in work queues for collectors to claim and complete;
 * - UC-60 demands on guarantors and the payments they make;
 * - UC-61 applying the borrower's deposits under the right of set-off,
 *   maker-checker.
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {
    this.servicing.registerBatchHook(async (tx, state, businessDate) => {
      await this.escalate(tx, state, businessDate);
    });
  }

  private overdue(state: LoanState, asOf: string) {
    return state.lines
      .filter(
        (l) =>
          l.status === 'DUE' &&
          lending.compareDates(toLocalDate(l.dueDate)!, asOf) < 0,
      )
      .reduce((s, l) => s.plus(owed(l)), D(0));
  }

  // ── UC-58: escalation ladder and work queues ──────────────────────────────

  async escalate(tx: Tx, state: LoanState, businessDate: string) {
    const a = state.account;
    if (a.status !== 'ACTIVE') return;
    const tenantId = a.tenantId;
    const dq = delinquency(state, businessDate);
    if (dq.dpd <= 0 || !dq.stage) {
      // Cured: nothing left to chase.
      await tx.collectionTask.updateMany({
        where: { tenantId, loanAccountId: a.id, status: 'OPEN' },
        data: {
          status: 'CANCELLED',
          outcome: 'CURED',
          completedAt: new Date(),
        },
      });
      return;
    }
    const stage = state.config.operations.collectionStages.find(
      (s) => s.code === dq.stage,
    );
    if (!stage || stage.action === 'NONE') return;
    const episodeFrom = lending.addDays(businessDate, -dq.dpd);
    const exists = await tx.collectionTask.findFirst({
      where: {
        tenantId,
        loanAccountId: a.id,
        stage: stage.code,
        episodeFrom: fromLocalDate(episodeFrom),
      },
      select: { id: true },
    });
    if (exists) return;
    // A later stage supersedes the earlier one's open work.
    await tx.collectionTask.updateMany({
      where: { tenantId, loanAccountId: a.id, status: 'OPEN' },
      data: {
        status: 'CANCELLED',
        outcome: 'ESCALATED',
        completedAt: new Date(),
      },
    });
    const amountOverdue = this.overdue(state, businessDate);
    const automatic = stage.action === 'SMS' || stage.action === 'NOTICE';
    const task = await tx.collectionTask.create({
      data: {
        tenantId,
        loanAccountId: a.id,
        stage: stage.code,
        action: stage.action,
        queue: stage.queue || stage.code,
        episodeFrom: fromLocalDate(episodeFrom),
        daysPastDue: dq.dpd,
        amountOverdue: amountOverdue.toString(),
        dueOn: fromLocalDate(businessDate),
        status: automatic ? 'DONE' : 'OPEN',
        outcome: automatic ? 'NOTICE_SENT' : '',
        completedAt: automatic ? new Date() : null,
        note: automatic
          ? `${stage.action === 'SMS' ? 'SMS' : 'Arrears notice'} sent: ${amountOverdue.toString()} ${a.currency} overdue, ${dq.dpd} days past due.`
          : '',
      },
    });
    if (automatic)
      await this.servicing.outbox(tx, tenantId, 'lending.collection.notice', {
        loanAccountId: a.id,
        taskId: task.id,
        channel: stage.action,
        stage: stage.code,
        daysPastDue: dq.dpd,
        amountOverdue: amountOverdue.toString(),
        currency: a.currency,
      });
  }

  async tasks(
    actor: LendingActor,
    q: { queue?: string; status?: string; loanAccountId?: string },
  ) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    if (!scope) return [];
    return this.lp.tenantTx(tenantId, async (tx) => {
      const rows = await tx.collectionTask.findMany({
        where: {
          tenantId,
          ...(q.queue ? { queue: q.queue } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.loanAccountId ? { loanAccountId: q.loanAccountId } : {}),
          loanAccount: scope as Prisma.LoanAccountWhereInput,
        },
        include: {
          loanAccount: {
            select: { reference: true, currency: true, borrowerId: true },
          },
        },
        orderBy: [{ daysPastDue: 'desc' }, { createdAt: 'asc' }],
        take: 500,
      });
      const borrowers = await tx.borrower.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.loanAccount.borrowerId))] },
        },
        select: { id: true, firstName: true, lastName: true, phone: true },
      });
      const byId = new Map(borrowers.map((b) => [b.id, b]));
      return rows.map(({ loanAccount, ...t }) => {
        const b = byId.get(loanAccount.borrowerId);
        return {
          ...t,
          reference: loanAccount.reference,
          currency: loanAccount.currency,
          borrower: `${b?.firstName ?? ''} ${b?.lastName ?? ''}`.trim(),
          phone: b?.phone ?? null,
          amountOverdue: t.amountOverdue.toString(),
          episodeFrom: toLocalDate(t.episodeFrom),
          dueOn: toLocalDate(t.dueOn),
        };
      });
    });
  }

  private async taskFor(tx: Tx, actor: LendingActor, taskId: string) {
    const tenantId = requireTenant(actor);
    const task = await tx.collectionTask.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!task) throw new NotFoundException('Collection task not found');
    const state = await loadLoanState(tx, tenantId, task.loanAccountId, {
      lock: false,
    });
    await this.policy.enforce(
      actor,
      'collection.task.work',
      resourceOf(state),
      tx,
    );
    return task;
  }

  /** A collector takes the task from the queue. */
  async claim(actor: LendingActor, taskId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.taskFor(tx, actor, taskId);
      const res = await tx.collectionTask.updateMany({
        where: { id: taskId, tenantId, status: 'OPEN', assignedTo: null },
        data: { assignedTo: actor.id },
      });
      if (res.count !== 1)
        throw new ConflictException(
          'This task is closed or already claimed by someone else.',
        );
      return tx.collectionTask.findFirst({ where: { id: taskId, tenantId } });
    });
  }

  async complete(
    actor: LendingActor,
    taskId: string,
    body: { outcome: (typeof TASK_OUTCOMES)[number]; note?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const task = await this.taskFor(tx, actor, taskId);
      if (task.assignedTo && task.assignedTo !== actor.id)
        throw new ConflictException('Another collector holds this task.');
      const res = await tx.collectionTask.updateMany({
        where: { id: taskId, tenantId, status: 'OPEN' },
        data: {
          status: 'DONE',
          outcome: body.outcome,
          note: (body.note ?? '').slice(0, 1000),
          assignedTo: task.assignedTo ?? actor.id,
          completedBy: actor.id,
          completedAt: new Date(),
        },
      });
      if (res.count !== 1) throw concurrentModification('This task');
      await this.audit.write(
        {
          actor,
          action: 'collection.task.work',
          resourceType: 'LoanAccount',
          resourceId: task.loanAccountId,
          outcome: 'SUCCESS',
          details: { task: taskId, stage: task.stage, outcome: body.outcome },
        },
        tx,
      );
      return tx.collectionTask.findFirst({ where: { id: taskId, tenantId } });
    });
  }

  // ── UC-60: demand on a guarantor ──────────────────────────────────────────

  async demands(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const [rows, guarantees] = await Promise.all([
        tx.guarantorDemand.findMany({
          where: { tenantId, loanAccountId: id },
          orderBy: { createdAt: 'desc' },
        }),
        tx.guarantee.findMany({
          where: { tenantId, applicationId: state.account.applicationId },
        }),
      ]);
      return {
        guarantees: guarantees.map((g) => ({
          id: g.id,
          guarantorName: g.guarantorName,
          type: g.type,
          amount: g.amount.toString(),
          currency: g.currency,
        })),
        demands: rows.map((r) => this.demandView(r)),
      };
    });
  }

  private demandView(r: {
    amount: Prisma.Decimal;
    paid: Prisma.Decimal;
    issuedOn: Date;
    payBy: Date;
  }) {
    return {
      ...r,
      amount: r.amount.toString(),
      paid: r.paid.toString(),
      issuedOn: toLocalDate(r.issuedOn),
      payBy: toLocalDate(r.payBy),
    };
  }

  async issueDemand(
    actor: LendingActor,
    id: string,
    body: { guaranteeId: string; amount?: string; payWithinDays?: number },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'loan.guarantor_demand.issue',
        resourceOf(state),
        tx,
      );
      const a = state.account;
      if (a.status !== 'ACTIVE')
        throw new ConflictException(`Loan is ${a.status}.`);
      if (a.daysPastDue <= 0)
        throw new BadRequestException({
          message:
            'A guarantor is called only once the borrower is in arrears.',
          code: 'NOT_IN_ARREARS',
        });
      const g = await tx.guarantee.findFirst({
        where: {
          id: body.guaranteeId,
          tenantId,
          applicationId: a.applicationId,
        },
      });
      if (!g)
        throw new BadRequestException(
          'That guarantee does not secure this loan.',
        );
      const demanded = await tx.guarantorDemand.aggregate({
        where: {
          tenantId,
          loanAccountId: id,
          guaranteeId: g.id,
          status: { not: 'WITHDRAWN' },
        },
        _sum: { amount: true },
      });
      const room = D(g.amount).minus(D(demanded._sum.amount ?? 0));
      const outstanding = D(a.principalOutstanding)
        .plus(D(a.interestReceivable))
        .plus(D(a.feesReceivable))
        .plus(D(a.penaltyReceivable))
        .minus(D(a.advanceBalance));
      const cap = lending.D.min(room, outstanding);
      const amount = body.amount
        ? lending.parseMoney(body.amount, a.currency, 'amount')
        : cap;
      if (amount.lte(0) || amount.gt(cap))
        throw new BadRequestException(
          `The demand can be at most ${cap.toString()} ${a.currency}: what the guarantee still covers (${room.toString()}) and what the loan owes (${outstanding.toString()}).`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const payBy = lending.addDays(businessDate, body.payWithinDays ?? 14);
      const count = await tx.guarantorDemand.count({
        where: { tenantId, loanAccountId: id },
      });
      const reference = `GD-${a.reference}-${count + 1}`;
      const letter = [
        `Demand under guarantee — ${reference}`,
        `To: ${g.guarantorName}`,
        '',
        `You guaranteed loan ${a.reference} up to ${g.currency} ${g.amount.toString()}. The borrower is ${a.daysPastDue} days in arrears and the loan is in default of its terms.`,
        `Under your guarantee we demand payment of ${a.currency} ${amount.toString()} by ${payBy}.`,
        `Quote ${reference} with your payment. Payment reduces the borrower's debt; your rights against the borrower for what you pay are preserved.`,
      ].join('\n');
      const row = await tx.guarantorDemand.create({
        data: {
          tenantId,
          loanAccountId: id,
          guaranteeId: g.id,
          guarantorName: g.guarantorName,
          reference,
          amount: amount.toString(),
          currency: a.currency,
          issuedOn: fromLocalDate(businessDate),
          payBy: fromLocalDate(payBy),
          letter,
          createdBy: actor.id,
        },
      });
      await this.servicing.outbox(tx, tenantId, 'lending.guarantor.demand', {
        loanAccountId: id,
        demandId: row.id,
        amount: amount.toString(),
        currency: a.currency,
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.guarantor_demand.issue',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            demand: reference,
            guarantee: g.id,
            amount: amount.toString(),
          },
        },
        tx,
      );
      return this.demandView(row);
    });
  }

  /** A guarantor's payment under a demand, applied to the loan like any repayment. */
  async guarantorPayment(
    actor: LendingActor,
    id: string,
    demandId: string,
    body: { amount: string; externalReference?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'guarantor-payment', id, demandId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const demand = await tx.guarantorDemand.findFirst({
        where: { id: demandId, tenantId, loanAccountId: id },
      });
      if (!demand) throw new NotFoundException('Demand not found');
      if (demand.status !== 'OPEN')
        throw new ConflictException(`This demand is ${demand.status}.`);
      const amount = lending.parseMoney(body.amount, demand.currency, 'amount');
      const left = D(demand.amount).minus(D(demand.paid));
      if (amount.lte(0) || amount.gt(left))
        throw new BadRequestException(
          `At most ${left.toString()} ${demand.currency} remains due under ${demand.reference}.`,
        );
      const event = await this.servicing.repayInTx(
        tx,
        actor,
        id,
        {
          amount: amount.toString(),
          externalReference: body.externalReference ?? demand.reference,
          payer: {
            name: demand.guarantorName,
            relationship: 'GUARANTOR',
            reference: demand.reference,
          },
        },
        idempotencyKey,
        hash,
      );
      const paid = D(demand.paid).plus(amount);
      const res = await tx.guarantorDemand.updateMany({
        where: { id: demandId, tenantId, status: 'OPEN', paid: demand.paid },
        data: {
          paid: paid.toString(),
          status: paid.gte(D(demand.amount)) ? 'PAID' : 'OPEN',
        },
      });
      if (res.count !== 1) throw concurrentModification('This demand');
      return event;
    });
  }

  async withdrawDemand(actor: LendingActor, id: string, demandId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(
        actor,
        'loan.guarantor_demand.issue',
        resourceOf(state),
        tx,
      );
      const res = await tx.guarantorDemand.updateMany({
        where: { id: demandId, tenantId, loanAccountId: id, status: 'OPEN' },
        data: { status: 'WITHDRAWN' },
      });
      if (res.count !== 1)
        throw new ConflictException('Only an open demand can be withdrawn.');
      return { withdrawn: demandId };
    });
  }

  // ── UC-61: right of set-off ───────────────────────────────────────────────

  async proposeSetOff(
    actor: LendingActor,
    id: string,
    body: { amount: string; sourceAccount: string; reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const a = state.account;
      const amount = lending.parseMoney(body.amount, a.currency, 'amount');
      await this.policy.enforce(
        actor,
        'loan.set_off.propose',
        resourceOf(state, [], amount.toString()),
        tx,
      );
      if (a.status !== 'ACTIVE')
        throw new ConflictException(`Loan is ${a.status}.`);
      if (a.daysPastDue <= 0)
        throw new BadRequestException({
          message: 'Set-off applies only to a debt in arrears.',
          code: 'NOT_IN_ARREARS',
        });
      const businessDate = await this.businessDate.get(tenantId, tx);
      const overdue = this.overdue(state, businessDate);
      if (amount.lte(0) || amount.gt(overdue))
        throw new BadRequestException(
          `Set-off is limited to what is overdue: ${overdue.toString()} ${a.currency}.`,
        );
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: id,
          action: 'SET_OFF',
          requiredPermission: 'loan.repayment.reverse',
          amount: amount.toString(),
          currency: a.currency,
          payload: {
            sourceAccount: body.sourceAccount,
            reason: body.reason.slice(0, 500),
          },
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.set_off.propose',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            task: task.id,
            amount: amount.toString(),
            sourceAccount: body.sourceAccount,
          },
        },
        tx,
      );
      return task;
    });
  }

  /** The checker approves (and the deposit is applied) or rejects. */
  async decideSetOff(
    actor: LendingActor,
    id: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'set-off', id, taskId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectId: id, action: 'SET_OFF' },
      });
      if (!task) throw new NotFoundException('Set-off proposal not found');
      const decision = await this.policy.enforce(
        actor,
        'loan.set_off.approve',
        resourceOf(state, [task.makerId], task.amount?.toString()),
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
      if (res.count !== 1) throw concurrentModification('This set-off');
      await this.audit.write(
        {
          actor,
          action: body.approve ? 'loan.set_off.approve' : 'loan.set_off.reject',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          decision,
          details: { task: taskId },
        },
        tx,
      );
      if (!body.approve) return { rejected: taskId };
      const p = task.payload as { sourceAccount: string };
      return this.servicing.repayInTx(
        tx,
        actor,
        id,
        {
          amount: task.amount!.toString(),
          externalReference: `Set-off from deposit ${p.sourceAccount}`,
          payer: {
            name: 'Set-off',
            relationship: 'SELF',
            reference: p.sourceAccount,
          },
        },
        idempotencyKey,
        hash,
        {
          fundingAccount: state.config.accounting.setOffClearing,
          authorizedByApproval: true,
        },
      );
    });
  }
}
