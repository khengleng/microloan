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
  requestHash,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { PostingLine, PostingService } from '../accounting/posting.service';
import { ServicingService } from '../servicing/servicing.service';
import { ACCOUNT_CODES } from '../../ledger/chart-of-accounts';

type Json = Prisma.InputJsonValue;

type Channel =
  | 'BRANCH_CASH'
  | 'BANK_TRANSFER'
  | 'MOBILE'
  | 'AGENT'
  | 'PAYROLL'
  | 'OTHER';

/**
 * Unidentified payments (UC-28) and their refunds (UC-74).
 *
 * Money that arrives without a loan it can be tied to is posted to the
 * unidentified-payments suspense account instead of being refused, so cash
 * received is always on the books. It is then matched to one or more loans —
 * each match is an ordinary repayment funded from suspense rather than cash —
 * or returned to the payer under maker-checker. The aging report shows what
 * is still waiting and for how long.
 */
@Injectable()
export class SuspenseService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly posting: PostingService,
    private readonly servicing: ServicingService,
  ) {}

  /** Open and settled receipts, oldest first, with their age in days. */
  async list(actor: LendingActor, status?: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'payment.suspense.read',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const today = await this.businessDate.get(tenantId, tx);
      const rows = await tx.unidentifiedPayment.findMany({
        where: { tenantId, ...(status ? { status } : {}) },
        include: { matches: { orderBy: { createdAt: 'asc' } } },
        orderBy: { valueDate: 'asc' },
      });
      const open = rows.filter((r) => r.status === 'OPEN');
      // Refund proposals waiting for a checker, so any session can decide them.
      const pending = await tx.approvalTask.findMany({
        where: {
          tenantId,
          subjectType: 'UNIDENTIFIED_PAYMENT',
          action: 'SUSPENSE_REFUND',
          status: 'PENDING',
        },
      });
      const pendingFor = new Map(pending.map((t) => [t.subjectId, t]));
      return {
        businessDate: today,
        totals: {
          open: open.length,
          remaining: open
            .reduce((s, r) => s.plus(D(r.remaining)), D(0))
            .toString(),
        },
        payments: rows.map((r) => ({
          ...r,
          amount: r.amount.toString(),
          remaining: r.remaining.toString(),
          valueDate: toLocalDate(r.valueDate),
          ageDays: lending.daysBetween(toLocalDate(r.valueDate)!, today),
          matches: r.matches.map((m) => ({
            ...m,
            amount: m.amount.toString(),
          })),
          pendingRefund: (() => {
            const t = pendingFor.get(r.id);
            return t
              ? {
                  taskId: t.id,
                  amount: t.amount?.toString() ?? '0',
                  currency: t.currency ?? r.currency,
                  reason: (t.payload as { reason?: string }).reason ?? '',
                  makerId: t.makerId,
                }
              : null;
          })(),
        })),
      };
    });
  }

  /** Money received with no loan to apply it to: Dr cash, Cr suspense. */
  async receive(
    actor: LendingActor,
    body: {
      amount: string;
      currency: string;
      valueDate?: string;
      channel: Channel;
      externalReference: string;
      payerName?: string;
      narrative?: string;
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'suspense-receive', body });
    return this.servicing.money(tenantId, idempotencyKey, hash, (tx) =>
      this.receiveInTx(tx, actor, body, idempotencyKey, hash),
    );
  }

  /**
   * The receipt itself, inside the caller's transaction — used by channel
   * file imports and auto-debit for money that cannot be applied to a loan
   * (UC-16, UC-18, UC-19).
   */
  async receiveInTx(
    tx: Tx,
    actor: LendingActor,
    body: {
      amount: string;
      currency: string;
      valueDate?: string;
      channel: Channel;
      externalReference: string;
      payerName?: string;
      narrative?: string;
    },
    idempotencyKey: string,
    hash: string,
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'payment.suspense.receive',
      tenantResource(tenantId),
      tx,
    );
    const currency = lending.getCurrency(body.currency).code;
    const amount = lending.parseMoney(body.amount, currency, 'amount');
    if (amount.lte(0))
      throw new BadRequestException('Amount must be positive.');
    const businessDate = await this.businessDate.get(tenantId, tx);
    const valueDate = body.valueDate ?? businessDate;
    BusinessDateService.checkValueDate(valueDate, businessDate, 30);
    const event = await this.tenantEvent(tx, actor, {
      type: 'SUSPENSE_RECEIPT',
      amount,
      currency,
      businessDate,
      valueDate,
      idempotencyKey,
      hash,
      externalReference: body.externalReference,
      narrative: `Unidentified ${body.channel.toLowerCase().replace('_', ' ')} receipt ${body.externalReference}`,
      components: {
        channel: body.channel,
        payerName: body.payerName ?? null,
      },
      lines: [
        { accountCode: ACCOUNT_CODES.CASH, debit: amount.toString() },
        {
          accountCode: ACCOUNT_CODES.UNIDENTIFIED_SUSPENSE,
          credit: amount.toString(),
        },
      ],
    });
    const payment = await tx.unidentifiedPayment.create({
      data: {
        tenantId,
        reference: `UNID-${event.id.slice(0, 8).toUpperCase()}`,
        amount: amount.toString(),
        remaining: amount.toString(),
        currency,
        valueDate: fromLocalDate(valueDate),
        channel: body.channel,
        externalReference: body.externalReference.slice(0, 120),
        payerName: body.payerName?.slice(0, 120) ?? null,
        narrative: (body.narrative ?? '').slice(0, 500),
        receiptEventId: event.id,
        receivedBy: actor.id,
      },
    });
    await this.audit.write(
      {
        actor,
        action: 'payment.suspense.receive',
        resourceType: 'UnidentifiedPayment',
        resourceId: payment.id,
        outcome: 'SUCCESS',
        details: { amount: amount.toString(), currency },
        businessDate: fromLocalDate(businessDate),
      },
      tx,
    );
    return payment;
  }

  /**
   * Apply some or all of a held receipt to a loan. The repayment is the same
   * one a teller would post — allocation, advances, prepayment rules — except
   * that it is funded from suspense instead of cash.
   */
  async match(
    actor: LendingActor,
    id: string,
    body: {
      loanId: string;
      amount: string;
      prepaymentStrategy?: 'RECAST' | 'SHORTEN';
      applyExcessAs?: 'ADVANCE' | 'PREPAY';
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'suspense-match', id, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment.suspense.receive',
        tenantResource(tenantId),
        tx,
      );
      const p = await this.lockOpen(tx, tenantId, id);
      const amount = D(lending.parseMoney(body.amount, p.currency, 'amount'));
      if (amount.lte(0) || amount.gt(D(p.remaining)))
        throw new BadRequestException(
          `A match must be positive and at most the ${p.remaining.toString()} ${p.currency} still held.`,
        );
      const loan = await tx.loanAccount.findFirst({
        where: { id: body.loanId, tenantId },
        select: { currency: true },
      });
      if (!loan) throw new NotFoundException('Loan account not found');
      if (loan.currency !== p.currency)
        throw new BadRequestException(
          `The receipt is in ${p.currency}; the loan is in ${loan.currency}.`,
        );
      const event = await this.servicing.repayInTx(
        tx,
        actor,
        body.loanId,
        {
          amount: amount.toString(),
          valueDate: toLocalDate(p.valueDate)!,
          externalReference: `${p.reference} ${p.externalReference}`.slice(
            0,
            120,
          ),
          prepaymentStrategy: body.prepaymentStrategy,
          applyExcessAs: body.applyExcessAs,
        },
        idempotencyKey,
        hash,
        { fundingAccount: ACCOUNT_CODES.UNIDENTIFIED_SUSPENSE },
      );
      await this.settle(tx, p, amount, {
        kind: 'MATCH',
        loanAccountId: body.loanId,
        financialEventId: event.id,
        actorId: actor.id,
      });
      await this.audit.write(
        {
          actor,
          action: 'payment.suspense.match',
          resourceType: 'UnidentifiedPayment',
          resourceId: p.id,
          outcome: 'SUCCESS',
          details: {
            loanId: body.loanId,
            amount: amount.toString(),
            event: event.id,
          },
        },
        tx,
      );
      return event;
    });
  }

  /** Propose returning held money to the payer; a different person approves. */
  async proposeRefund(
    actor: LendingActor,
    id: string,
    body: { amount: string; reason: string },
  ) {
    const tenantId = requireTenant(actor);
    if (!body.reason?.trim())
      throw new BadRequestException('Record why the money is being returned.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment.refund.propose',
        tenantResource(tenantId),
        tx,
      );
      const p = await this.lockOpen(tx, tenantId, id);
      const amount = D(lending.parseMoney(body.amount, p.currency, 'amount'));
      if (amount.lte(0) || amount.gt(D(p.remaining)))
        throw new BadRequestException(
          `A refund must be positive and at most the ${p.remaining.toString()} ${p.currency} still held.`,
        );
      const pending = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectId: id,
          action: 'SUSPENSE_REFUND',
          status: 'PENDING',
        },
      });
      if (pending)
        throw new ConflictException(
          'A refund of this receipt is already awaiting approval.',
        );
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'UNIDENTIFIED_PAYMENT',
          subjectId: id,
          action: 'SUSPENSE_REFUND',
          requiredPermission: 'loan.repayment.reverse',
          amount: amount.toString(),
          currency: p.currency,
          payload: { reason: body.reason.slice(0, 500) } as Json,
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'payment.refund.propose',
          resourceType: 'UnidentifiedPayment',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { task: task.id, amount: amount.toString() },
        },
        tx,
      );
      return task;
    });
  }

  /** Approve (and pay out) or reject a proposed refund: Dr suspense, Cr cash. */
  async decideRefund(
    actor: LendingActor,
    id: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'suspense-refund', id, taskId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const task = await tx.approvalTask.findFirst({
        where: {
          id: taskId,
          tenantId,
          subjectId: id,
          action: 'SUSPENSE_REFUND',
        },
      });
      if (!task) throw new NotFoundException('Refund proposal not found');
      await this.policy.enforce(
        actor,
        'payment.refund.approve',
        tenantResource(tenantId, 'TENANT', tenantId, [task.makerId]),
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
      if (res.count !== 1) throw concurrentModification('This refund proposal');
      if (!body.approve) return { rejected: true };
      const p = await this.lockOpen(tx, tenantId, id);
      const amount = D(task.amount);
      if (amount.gt(D(p.remaining)))
        throw new ConflictException(
          'Less is now held than this refund; it was matched in the meantime.',
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const event = await this.tenantEvent(tx, actor, {
        type: 'SUSPENSE_REFUND',
        amount,
        currency: p.currency,
        businessDate,
        valueDate: businessDate,
        idempotencyKey,
        hash,
        externalReference: p.externalReference,
        narrative: `Refund of unidentified receipt ${p.reference}`,
        components: {
          payment: p.id,
          task: taskId,
          reason: (task.payload as { reason?: string }).reason ?? '',
        },
        lines: [
          {
            accountCode: ACCOUNT_CODES.UNIDENTIFIED_SUSPENSE,
            debit: amount.toString(),
          },
          { accountCode: ACCOUNT_CODES.CASH, credit: amount.toString() },
        ],
      });
      await this.settle(tx, p, amount, {
        kind: 'REFUND',
        loanAccountId: null,
        financialEventId: event.id,
        actorId: actor.id,
        reason: (task.payload as { reason?: string }).reason ?? '',
      });
      await this.audit.write(
        {
          actor,
          action: 'payment.refund.approve',
          resourceType: 'UnidentifiedPayment',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { task: taskId, event: event.id, amount: amount.toString() },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return event;
    });
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  private async lockOpen(tx: Tx, tenantId: string, id: string) {
    // Serialize matches and refunds of one receipt; scoped by tenant because
    // raw SQL bypasses the Prisma guard.
    await tx.$queryRaw`SELECT id FROM "UnidentifiedPayment" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const p = await tx.unidentifiedPayment.findFirst({
      where: { id, tenantId },
    });
    if (!p) throw new NotFoundException('Unidentified payment not found');
    if (p.status !== 'OPEN')
      throw new ConflictException(
        `This receipt is already ${p.status.toLowerCase()}.`,
      );
    return p;
  }

  private async settle(
    tx: Tx,
    p: { id: string; tenantId: string; remaining: Prisma.Decimal },
    amount: InstanceType<typeof lending.D>,
    m: {
      kind: 'MATCH' | 'REFUND';
      loanAccountId: string | null;
      financialEventId: string;
      actorId: string;
      reason?: string;
    },
  ) {
    await tx.unidentifiedPaymentMatch.create({
      data: {
        tenantId: p.tenantId,
        paymentId: p.id,
        amount: amount.toString(),
        ...m,
      },
    });
    const remaining = D(p.remaining).minus(amount);
    const finished = await tx.unidentifiedPaymentMatch.findMany({
      where: { tenantId: p.tenantId, paymentId: p.id },
      select: { kind: true },
    });
    await tx.unidentifiedPayment.updateMany({
      where: { id: p.id, tenantId: p.tenantId },
      data: {
        remaining: remaining.toString(),
        status: remaining.isZero()
          ? finished.some((f) => f.kind === 'MATCH')
            ? 'MATCHED'
            : 'REFUNDED'
          : 'OPEN',
      },
    });
  }

  /** A financial event that belongs to the tenant, not to any loan. */
  private async tenantEvent(
    tx: Tx,
    actor: LendingActor,
    e: {
      type: 'SUSPENSE_RECEIPT' | 'SUSPENSE_REFUND';
      amount: InstanceType<typeof lending.D>;
      currency: string;
      businessDate: string;
      valueDate: string;
      idempotencyKey: string;
      hash: string;
      externalReference: string;
      narrative: string;
      components: Record<string, unknown>;
      lines: PostingLine[];
    },
  ) {
    const tenantId = requireTenant(actor);
    const event = await tx.financialEvent.create({
      data: {
        tenantId,
        loanAccountId: null,
        type: e.type,
        businessDate: fromLocalDate(e.businessDate),
        valueDate: fromLocalDate(e.valueDate),
        amount: e.amount.toString(),
        currency: e.currency,
        components: e.components as Json,
        idempotencyKey: e.idempotencyKey,
        requestHash: e.hash,
        productVersionId: null,
        agreementVersion: null,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        actorId: actor.id,
        actorType: actor.type,
        externalReference: e.externalReference.slice(0, 120),
        narrative: e.narrative,
      },
    });
    await this.posting.post(tx, {
      tenantId,
      financialEventId: event.id,
      loanAccountId: null,
      entryDate: fromLocalDate(e.businessDate),
      currency: e.currency,
      description: e.narrative,
      lines: e.lines,
    });
    return event;
  }
}
