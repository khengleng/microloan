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
  requestHash,
  requireTenant,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { ServicingService } from '../servicing/servicing.service';
import { PostingLine } from '../accounting/posting.service';
import { LoanState, loadLoanState, resourceOf } from '../servicing/loan-state';

type Json = Prisma.InputJsonValue;
type Dec = InstanceType<typeof lending.D>;
type Syndicate = NonNullable<Awaited<ReturnType<Tx['syndicate']['findFirst']>>>;
type Participant = NonNullable<
  Awaited<ReturnType<Tx['syndicateParticipant']['findFirst']>>
>;
type Component = lending.CollectionComponent;

const PAYOUT = 'PARTICIPANT_PAYOUT';
/** Loan events whose collections are shared with the participants. */
const SHARED_TYPES = ['REPAYMENT', 'ADVANCE_APPLIED', 'SETTLEMENT'];
const EARNED_FIELD: Record<Component, keyof Participant> = {
  PRINCIPAL: 'principalReturned',
  INTEREST: 'interestEarned',
  PENALTY: 'penaltyEarned',
  FEE: 'feesEarned',
};

/**
 * Syndicated loans (LT-24).
 *
 * The loan itself is an ordinary term loan — booked, disbursed, accrued,
 * repaid, aged and reconciled by the servicing path, with fixed or floating
 * (benchmark + margin) pricing from its product. The syndicate sits beside
 * it: the tenant is the agent and lead lender, and each participant holds a
 * share.
 *
 * Accounting, from the agent's books: the borrower owes the agent the whole
 * loan, so the loan receivable stays gross and reconciles as any other loan.
 * The participants' money is a liability: their funding (Dr cash, Cr
 * participant funding) before disbursement; their share of each collection
 * moves into "due to participants" — principal out of their funding, and
 * interest, penalties and fees as the participants' share of loan income;
 * and a payout (maker-checker) settles what is due. A participant
 * sub-ledger records every one of those movements per lender.
 */
@Injectable()
export class SyndicationService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {
    // A syndicated loan is not disbursed before its participants have funded it.
    this.servicing.registerDisbursementGuard(async (tx, state) => {
      if (!state.config.syndication) return;
      const s = await tx.syndicate.findFirst({
        where: { tenantId: state.account.tenantId, loanAccountId: state.account.id },
        select: { status: true },
      });
      if (s?.status !== 'FUNDED')
        throw new ConflictException({
          message:
            'This is a syndicated loan: set up its participants, have the syndicate approved and record their funding before disbursing.',
          code: 'SYNDICATE_NOT_FUNDED',
        });
    });
    // Every collection is shared the same day it lands, at the latest.
    this.servicing.registerBatchHook(async (tx, state, businessDate, actor) => {
      if (!state.config.syndication) return;
      await this.distributeInTx(tx, state, businessDate, actor);
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async get(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'syndication.read', resourceOf(state), tx);
      const s = await tx.syndicate.findFirst({
        where: { tenantId, loanAccountId: loanId },
        include: { participants: { orderBy: [{ isAgent: 'desc' }, { lenderName: 'asc' }] } },
      });
      const entries = s
        ? await tx.participationEntry.findMany({
            where: { tenantId, loanAccountId: loanId },
            orderBy: { createdAt: 'asc' },
          })
        : [];
      const tasks = s
        ? await tx.approvalTask.findMany({
            where: {
              tenantId,
              subjectType: 'SYNDICATE_PARTICIPANT',
              subjectId: { in: s.participants.map((p) => p.id) },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      return {
        syndicated: !!state.config.syndication,
        loan: {
          id: state.account.id,
          reference: state.account.reference,
          status: state.account.status,
          currency: state.account.currency,
          bookedPrincipal: decStr(state.account.bookedPrincipal),
          principalOutstanding: decStr(state.account.principalOutstanding),
          rateType: state.config.attributes.rateType,
          floating: state.config.pricing.floating,
        },
        syndicate: s
          ? {
              ...plain(s),
              participants: s.participants.map((p) => participantView(p)),
            }
          : null,
        entries: entries.map((e) => plain(e)),
        payouts: tasks.map((t) => plain(t)),
      };
    });
  }

  // ── Composition (maker-checker) ───────────────────────────────────────────

  /** Set (or replace, while still a draft) the participants of a booked loan. */
  async setParticipants(
    actor: LendingActor,
    loanId: string,
    body: { participants: lending.ParticipantInput[] },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const cfg = syndicationConfig(state);
      await this.policy.enforce(actor, 'syndication.manage', resourceOf(state), tx);
      const principal = decStr(state.account.bookedPrincipal);
      const resolved = engineCall(() =>
        lending.resolveParticipations(principal, body.participants, state.config.pricing.rounding, cfg),
      );
      let s = await tx.syndicate.findFirst({ where: { tenantId, loanAccountId: loanId } });
      if (s && s.status !== 'DRAFT')
        throw new ConflictException(`The syndicate is already ${s.status.toLowerCase()}; it can no longer be changed.`);
      if (s) {
        await tx.syndicateParticipant.deleteMany({ where: { tenantId, syndicateId: s.id } });
        await this.cas(tx, s, 'DRAFT', { makerId: actor.id, principal });
      } else {
        s = await tx.syndicate.create({
          data: {
            tenantId,
            loanAccountId: loanId,
            branchId: state.account.branchId,
            currency: state.account.currency,
            principal,
            status: 'DRAFT',
            makerId: actor.id,
          },
        });
      }
      await tx.syndicateParticipant.createMany({
        data: resolved.map((p) => ({
          tenantId,
          syndicateId: s!.id,
          loanAccountId: loanId,
          lenderName: p.lenderName.slice(0, 160),
          isAgent: p.isAgent,
          share: p.share,
          feeShare: p.feeShare,
          commitment: p.commitment,
        })),
      });
      await this.writeAudit(actor, tx, loanId, 'syndication.manage', {
        syndicate: s.id,
        participants: resolved.map((p) => ({ lender: p.lenderName, share: p.share, commitment: p.commitment })),
      });
      return { id: s.id, status: 'DRAFT', participants: resolved };
    });
  }

  async approve(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      syndicationConfig(state);
      const s = await this.load(tx, tenantId, loanId);
      await this.policy.enforce(actor, 'syndication.approve', resourceOf(state, [s.makerId]), tx);
      // The loan may have been re-booked at another amount since the draft.
      if (!D(s.principal).eq(D(state.account.bookedPrincipal)))
        throw new ConflictException('The loan amount changed since the syndicate was drafted; set the participants again.');
      await this.cas(tx, s, 'DRAFT', { status: 'APPROVED', checkerId: actor.id, approvedAt: new Date() });
      await this.writeAudit(actor, tx, loanId, 'syndication.approve', { syndicate: s.id });
      return { id: s.id, status: 'APPROVED' };
    });
  }

  /**
   * Record that every other participant has paid its commitment to the
   * agent (Dr cash, Cr participant funding). The agent funds its own share
   * from its own cash at disbursement, so it posts nothing here.
   */
  async recordFunding(
    actor: LendingActor,
    loanId: string,
    body: { externalReference: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'syndicate.fund', loanId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const cfg = syndicationConfig(state);
      const s = await this.load(tx, tenantId, loanId);
      await this.policy.enforce(actor, 'syndication.fund', resourceOf(state, [], decStr(s.principal)), tx);
      if (s.status !== 'APPROVED')
        throw new ConflictException(
          s.status === 'FUNDED' ? 'Participant funding is already recorded.' : 'The syndicate must be approved before it is funded.',
        );
      const participants = await this.participants(tx, s);
      const others = participants.filter((p) => !p.isAgent);
      const total = others.reduce((t, p) => t.plus(D(p.commitment)), new lending.D(0));
      const businessDate = await this.businessDate.get(tenantId, tx);
      const event = await this.servicing.recordEvent(tx, state, {
        type: 'PARTICIPATION_FUNDING',
        amount: total,
        businessDate,
        valueDate: businessDate,
        components: {
          syndicateId: s.id,
          participants: others.map((p) => ({ id: p.id, lender: p.lenderName, amount: decStr(p.commitment) })),
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Participant funding of syndicated loan ${state.account.reference}`,
        externalReference: body.externalReference.trim().slice(0, 120),
        lines: [
          { accountCode: state.config.accounting.cash, debit: total.toString() },
          { accountCode: cfg.accounts.participantFunding, credit: total.toString() },
        ],
      });
      await tx.participationEntry.createMany({
        data: participants.map((p) => ({
          tenantId,
          participantId: p.id,
          loanAccountId: loanId,
          financialEventId: event.id,
          sourceEventId: event.id,
          kind: 'FUNDING',
          amount: decStr(p.commitment),
        })),
      });
      for (const p of participants)
        await tx.syndicateParticipant.updateMany({
          where: { id: p.id, tenantId },
          data: { funded: decStr(p.commitment) },
        });
      await this.cas(tx, s, 'APPROVED', { status: 'FUNDED', fundingEventId: event.id, fundedAt: new Date() });
      await this.writeAudit(actor, tx, loanId, 'syndication.fund', { event: event.id, amount: total.toString() });
      return { id: s.id, status: 'FUNDED', eventId: event.id, participantFunding: total.toString() };
    });
  }

  // ── Sharing collections ───────────────────────────────────────────────────

  /** Share every collection not yet shared. Safe to repeat; the batch runs it daily. */
  async distribute(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      syndicationConfig(state);
      await this.policy.enforce(actor, 'syndication.distribute', resourceOf(state), tx);
      const businessDate = await this.businessDate.get(tenantId, tx);
      return this.distributeInTx(tx, state, businessDate, actor);
    });
  }

  /**
   * For each collection on the loan (repayment, advance applied, early
   * settlement — and the reversal of any of them) that has not been shared,
   * split what it collected by component across the syndicate and post the
   * participants' part to "due to participants".
   *
   * What a collection collected is read from its own journal: credits to the
   * principal, interest, fee and penalty receivables (and fees taken straight
   * to income). Tax is the agent's to remit and is never shared.
   */
  private async distributeInTx(tx: Tx, state: LoanState, businessDate: string, actor: LendingActor) {
    const tenantId = state.account.tenantId;
    const s = await tx.syndicate.findFirst({ where: { tenantId, loanAccountId: state.account.id } });
    if (!s || s.status !== 'FUNDED') return { distributed: 0, skipped: [] as string[] };
    const cfg = syndicationConfig(state);
    const participants = await this.participants(tx, s);
    const done = new Set(
      (
        await tx.participationEntry.findMany({
          where: { tenantId, loanAccountId: state.account.id, kind: { notIn: ['FUNDING', 'PAYOUT'] } },
          select: { sourceEventId: true },
          distinct: ['sourceEventId'],
        })
      ).map((e) => e.sourceEventId),
    );
    // Shared-and-reversed collections are undone by sharing their reversal.
    const events = await tx.financialEvent.findMany({
      where: {
        tenantId,
        loanAccountId: state.account.id,
        OR: [{ type: { in: SHARED_TYPES } }, { type: 'REVERSAL' }],
      },
      include: { journal: { include: { lines: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const byId = new Map(events.map((e) => [e.id, e]));
    const acc = state.config.accounting;
    const mapped: Record<string, Component> = {
      [acc.loansReceivable]: 'PRINCIPAL',
      [acc.interestReceivable]: 'INTEREST',
      [acc.penaltyReceivable]: 'PENALTY',
      [acc.feesReceivable]: 'FEE',
      [acc.feeIncome]: 'FEE',
    };
    const skipped: string[] = [];
    let distributed = 0;
    for (const e of events) {
      if (done.has(e.id)) continue;
      let sign = 1;
      if (e.type === 'REVERSAL') {
        const original = e.reversalOfId ? byId.get(e.reversalOfId) : undefined;
        // Only the reversal of a collection that was shared is shared.
        if (!original || !SHARED_TYPES.includes(original.type) || !done.has(original.id)) continue;
        sign = -1;
      }
      if ((e.components as { negotiated?: boolean } | null)?.negotiated) {
        // A settlement for less carries a loss; its sharing is a credit
        // decision, not arithmetic (DECISIONS D-015).
        skipped.push(e.id);
        continue;
      }
      const collected: Partial<Record<Component, Dec>> = {};
      for (const l of e.journal?.lines ?? []) {
        const c = mapped[l.accountCode];
        if (!c) continue;
        // A collection credits a receivable; its reversal debits it back,
        // so a reversal's components come out negative and undo the share.
        const net = D(l.credit).minus(D(l.debit));
        collected[c] = (collected[c] ?? new lending.D(0)).plus(net);
      }
      const components = Object.fromEntries(
        Object.entries(collected).map(([k, v]) => [k, v.toString()]),
      ) as Partial<Record<Component, string>>;
      const parts = engineCall(() => lending.splitCollection(participants.map(shareOf), components, state.config.pricing.rounding));
      const lines: PostingLine[] = [];
      const entries: Prisma.ParticipationEntryCreateManyInput[] = [];
      let principal = new lending.D(0);
      let income = new lending.D(0);
      participants.forEach((p, i) => {
        if (p.isAgent) return;
        for (const c of Object.keys(parts[i]) as Component[]) {
          const v = D(parts[i][c]);
          if (v.isZero()) continue;
          if (c === 'PRINCIPAL') principal = principal.plus(v);
          else income = income.plus(v);
          entries.push({
            tenantId,
            participantId: p.id,
            loanAccountId: state.account.id,
            financialEventId: '',
            sourceEventId: e.id,
            kind: c,
            amount: v.toString(),
          });
        }
      });
      // Agent rows record its own share for the sub-ledger; no posting moves it.
      participants.forEach((p, i) => {
        if (!p.isAgent) return;
        for (const c of Object.keys(parts[i]) as Component[]) {
          const v = D(parts[i][c]);
          if (!v.isZero())
            entries.push({
              tenantId,
              participantId: p.id,
              loanAccountId: state.account.id,
              financialEventId: '',
              sourceEventId: e.id,
              kind: c,
              amount: v.toString(),
            });
        }
      });
      if (!entries.length) continue;
      const due = principal.plus(income);
      // A negative amount (a reversal) posts on the opposite side.
      const leg = (code: string, v: Dec, side: 'debit' | 'credit'): PostingLine[] => {
        if (v.isZero()) return [];
        const amount = v.abs().toString();
        return [(side === 'debit') === v.gt(0) ? { accountCode: code, debit: amount } : { accountCode: code, credit: amount }];
      };
      lines.push(
        ...leg(cfg.accounts.participantFunding, principal, 'debit'),
        ...leg(cfg.accounts.participantShareExpense, income, 'debit'),
        ...leg(cfg.accounts.participantsPayable, due, 'credit'),
      );
      const posted = await this.servicing.recordEvent(tx, state, {
        type: 'PARTICIPATION_SHARE',
        amount: due.abs(),
        businessDate,
        valueDate: businessDate,
        components: { syndicateId: s.id, sourceEventId: e.id, sourceType: e.type, sign, collected: components },
        idempotencyKey: `sys:syndicate-share:${e.id}`,
        requestHash: 'system',
        actor,
        narrative: `Participants' share of ${e.type.toLowerCase().replace(/_/g, ' ')} on ${state.account.reference}`,
        lines,
      });
      await tx.participationEntry.createMany({
        data: entries.map((x) => ({ ...x, financialEventId: posted.id })),
      });
      for (const p of participants) {
        const mine = entries.filter((x) => x.participantId === p.id);
        if (!mine.length) continue;
        const data: Record<string, string> = {};
        for (const x of mine) {
          const f = EARNED_FIELD[x.kind as Component] as string;
          data[f] = D((data[f] ?? (p as Record<string, unknown>)[f]) as string)
            .plus(D(x.amount as string))
            .toString();
        }
        await tx.syndicateParticipant.updateMany({ where: { id: p.id, tenantId }, data });
        Object.assign(p, data);
      }
      done.add(e.id);
      distributed++;
    }
    return { distributed, skipped };
  }

  // ── Payouts to participants (maker-checker) ───────────────────────────────

  async proposePayout(
    actor: LendingActor,
    loanId: string,
    participantId: string,
    body: { amount?: string; externalReference?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      syndicationConfig(state);
      const p = await this.participant(tx, tenantId, loanId, participantId);
      const due = payable(p);
      const amount = body.amount ? engineCall(() => lending.parseMoney(body.amount!, state.account.currency, 'amount')) : due;
      await this.policy.enforce(actor, 'syndication.payout.propose', resourceOf(state, [], amount.toString()), tx);
      if (p.isAgent) throw new BadRequestException('The agent does not pay itself.');
      if (amount.lte(0) || amount.gt(due))
        throw new BadRequestException(`A payout must be positive and at most the ${due} ${state.account.currency} due to ${p.lenderName}.`);
      const open = await tx.approvalTask.findFirst({
        where: { tenantId, subjectType: 'SYNDICATE_PARTICIPANT', subjectId: participantId, action: PAYOUT, status: 'PENDING' },
      });
      if (open) throw new ConflictException('A payout to this participant is already awaiting approval.');
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'SYNDICATE_PARTICIPANT',
          subjectId: participantId,
          action: PAYOUT,
          requiredPermission: 'loan.repayment.reverse',
          amount: amount.toString(),
          currency: state.account.currency,
          payload: { loanAccountId: loanId, externalReference: body.externalReference?.slice(0, 120) ?? null } as Json,
          makerId: actor.id,
        },
      });
      await this.writeAudit(actor, tx, loanId, 'syndication.payout.propose', {
        task: task.id,
        participant: p.lenderName,
        amount: amount.toString(),
      });
      return plain(task);
    });
  }

  async decidePayout(
    actor: LendingActor,
    loanId: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'syndicate.payout', loanId, taskId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const cfg = syndicationConfig(state);
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectType: 'SYNDICATE_PARTICIPANT', action: PAYOUT },
      });
      if (!task || (task.payload as { loanAccountId?: string }).loanAccountId !== loanId)
        throw new NotFoundException('Payout proposal not found');
      const p = await this.participant(tx, tenantId, loanId, task.subjectId);
      const amount = D(task.amount);
      const decision = await this.policy.enforce(
        actor,
        'syndication.payout.approve',
        resourceOf(state, [task.makerId], amount.toString()),
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
      if (res.count !== 1) throw concurrentModification('This payout proposal');
      if (!body.approve) return { rejected: true };
      if (amount.gt(payable(p)))
        throw new ConflictException(`Only ${payable(p)} is now due to ${p.lenderName}; a reversal reduced it.`);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const event = await this.servicing.recordEvent(tx, state, {
        type: 'PARTICIPATION_PAYOUT',
        amount,
        businessDate,
        valueDate: businessDate,
        components: { participantId: p.id, lender: p.lenderName, task: taskId },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Paid to participant ${p.lenderName} on ${state.account.reference}`,
        externalReference: (task.payload as { externalReference?: string | null }).externalReference ?? null,
        lines: [
          { accountCode: cfg.accounts.participantsPayable, debit: amount.toString() },
          { accountCode: state.config.accounting.cash, credit: amount.toString() },
        ],
      });
      await tx.participationEntry.create({
        data: {
          tenantId,
          participantId: p.id,
          loanAccountId: loanId,
          financialEventId: event.id,
          sourceEventId: event.id,
          kind: 'PAYOUT',
          amount: amount.toString(),
        },
      });
      await tx.syndicateParticipant.updateMany({
        where: { id: p.id, tenantId },
        data: { paidOut: D(p.paidOut).plus(amount).toString() },
      });
      await this.audit.write(
        {
          actor,
          action: 'syndication.payout.approve',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          decision,
          details: { event: event.id, participant: p.lenderName, amount: amount.toString() },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return event;
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async load(tx: Tx, tenantId: string, loanId: string) {
    const s = await tx.syndicate.findFirst({ where: { tenantId, loanAccountId: loanId } });
    if (!s) throw new NotFoundException('This loan has no syndicate yet.');
    return s;
  }

  private participants(tx: Tx, s: Syndicate) {
    return tx.syndicateParticipant.findMany({
      where: { tenantId: s.tenantId, syndicateId: s.id },
      orderBy: [{ isAgent: 'desc' }, { lenderName: 'asc' }],
    });
  }

  private async participant(tx: Tx, tenantId: string, loanId: string, participantId: string) {
    const p = await tx.syndicateParticipant.findFirst({ where: { id: participantId, tenantId, loanAccountId: loanId } });
    if (!p) throw new NotFoundException('Participant not found');
    return p;
  }

  private async cas(tx: Tx, s: Syndicate, fromStatus: string, data: Prisma.SyndicateUpdateManyMutationInput) {
    const res = await tx.syndicate.updateMany({
      where: { id: s.id, tenantId: s.tenantId, version: s.version, status: fromStatus },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This syndicate');
    s.version += 1;
  }

  private async writeAudit(actor: LendingActor, tx: Tx, loanId: string, action: string, details: Record<string, unknown>) {
    await this.audit.write(
      { actor, action, resourceType: 'LoanAccount', resourceId: loanId, outcome: 'SUCCESS', details },
      tx,
    );
  }
}

function syndicationConfig(state: LoanState) {
  const c = state.config.syndication;
  if (!c)
    throw new BadRequestException({ message: 'This loan is not under a syndicated product.', code: 'NOT_SYNDICATED' });
  return {
    minParticipants: c.minParticipants,
    maxParticipants: c.maxParticipants,
    accounts: {
      participantsPayable: c.accounts?.participantsPayable ?? '2320',
      participantFunding: c.accounts?.participantFunding ?? '2330',
      participantShareExpense: c.accounts?.participantShareExpense ?? '5300',
    },
  };
}

function shareOf(p: Participant) {
  return { isAgent: p.isAgent, share: decStr(p.share), feeShare: decStr(p.feeShare) };
}

/** What has been shared with a participant and not yet paid to it. */
function payable(p: Participant): Dec {
  return D(p.principalReturned).plus(D(p.interestEarned)).plus(D(p.penaltyEarned)).plus(D(p.feesEarned)).minus(D(p.paidOut));
}

function participantView(p: Participant) {
  return {
    ...plain(p),
    // Still funded by the participant: its funding less principal returned.
    outstanding: D(p.funded).minus(D(p.principalReturned)).toString(),
    payable: p.isAgent ? '0' : payable(p).toString(),
  };
}

function plain<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out))
    if (v && typeof v === 'object' && 'toFixed' in v && !(v instanceof Date))
      out[k] = (v as { toString(): string }).toString();
  return out;
}
