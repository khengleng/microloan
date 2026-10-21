import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem, runAsTenant } from '../../prisma/tenant-context';
import { JobClaimService } from '../../prisma/job-claim.service';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  LendingActor,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { LoanState, loadLoanState, resourceOf } from '../servicing/loan-state';
import { delinquency } from '../servicing/servicing.service';
import { RECEIPT_EVENTS } from '../reporting/reports.service';

const D = (v: Prisma.Decimal | string | number | null | undefined) =>
  new lending.D(v === null || v === undefined ? 0 : v.toString());

/** Job name of the daily review's run-once claims (ScheduledJobClaim). */
export const PROMISE_REVIEW_JOB = 'collections.promise-review';

/**
 * Stage code of the work-queue task a broken promise raises. Not a ladder
 * stage, so it never takes the ladder's one-task-per-stage-per-episode slot;
 * the task carries the queue and action of the ladder stage it escalates to.
 */
export const PROMISE_BROKEN_STAGE = 'PROMISE_BROKEN';

/** Actions a person performs; an automatic stage (SMS, notice) escalates to a call. */
const HUMAN_ACTIONS = new Set(['CALL', 'VISIT', 'LEGAL_REVIEW']);

export interface PromiseInput {
  amount: string;
  payBy: string;
  note?: string;
}

export interface PromiseReviewResult {
  tenantId: string;
  businessDate: string;
  reviewed: number;
  kept: number;
  broken: number;
  cancelled: number;
  tasksRaised: number;
}

/** The system principal the daily review acts as. */
export function promiseReviewActor(tenantId: string): LendingActor {
  return {
    id: 'system:promise-review',
    type: 'SERVICE',
    tenantId,
    assurance: 'SERVICE_KEY',
    channel: 'SYSTEM',
    scopes: ['collection.task.work', 'loan.read'],
  };
}

type PromiseRow = Prisma.CollectionPromiseGetPayload<object>;

/**
 * Promises to pay on lending loans (UC-59; DECISIONS D-168).
 *
 * A collector records a promise — an amount and a date — on a loan in
 * arrears, either as the outcome of a work-queue task or on its own. Every day
 * after end of day each pending promise is reviewed:
 *
 * - KEPT as soon as the money received on the loan (repayments, prepayments,
 *   settlements, recoveries; reversed ones excluded) value-dated from the day
 *   of the promise up to the promised date plus the grace days covers the
 *   promised amount;
 * - BROKEN once the business date is past the promised date plus the grace
 *   days without that: a task is raised in the work queue of the next stage
 *   of the product's collections ladder (a call when that stage is automatic)
 *   for a collector to follow up;
 * - CANCELLED when the loan stops being active first, or when a newer promise
 *   on the same loan replaces it.
 *
 * Grace days and how far ahead a promise may run are tenant lending settings
 * (`collections.promiseToPay`); the grace days are frozen on the promise when
 * it is recorded.
 */
@Injectable()
export class PromisesService {
  private readonly logger = new Logger(PromisesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly settings: TenantSettingsService,
    private readonly claims: JobClaimService,
  ) {}

  static view(p: PromiseRow) {
    const deadline = lending.addDays(toLocalDate(p.payBy)!, p.graceDays);
    return {
      ...p,
      amount: p.amount.toString(),
      received: p.received.toString(),
      promisedOn: toLocalDate(p.promisedOn),
      payBy: toLocalDate(p.payBy),
      reviewedOn: toLocalDate(p.reviewedOn),
      countsUntil: deadline,
    };
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  /**
   * Record a promise inside the caller's transaction (the loan's row is
   * already locked by the caller when it loaded the state). A pending
   * promise on the same loan is replaced.
   */
  async recordInTx(
    tx: Tx,
    actor: LendingActor,
    state: LoanState,
    input: PromiseInput,
    taskId: string | null,
  ) {
    const a = state.account;
    const tenantId = a.tenantId;
    if (a.status !== 'ACTIVE')
      throw new ConflictException(`Loan is ${a.status}.`);
    const settings = (await this.settings.get(tenantId, tx)).collections
      .promiseToPay;
    const businessDate = await this.businessDate.get(tenantId, tx);
    const amount = lending.parseMoney(input.amount, a.currency, 'amount');
    if (amount.lte(0))
      throw new BadRequestException(
        'The promised amount must be more than zero.',
      );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.payBy))
      throw new BadRequestException('payBy must be a date (YYYY-MM-DD).');
    const latest = lending.addDays(businessDate, settings.maxDaysAhead);
    if (
      lending.compareDates(input.payBy, businessDate) < 0 ||
      lending.compareDates(input.payBy, latest) > 0
    )
      throw new BadRequestException({
        message: `The promised date must be between ${businessDate} and ${latest} (at most ${settings.maxDaysAhead} days ahead).`,
        code: 'PROMISE_DATE_OUT_OF_RANGE',
      });
    const replaced = await tx.collectionPromise.updateMany({
      where: { tenantId, loanAccountId: a.id, status: 'PENDING' },
      data: {
        status: 'CANCELLED',
        reviewedOn: fromLocalDate(businessDate),
        note: 'Replaced by a newer promise.',
      },
    });
    const row = await tx.collectionPromise.create({
      data: {
        tenantId,
        loanAccountId: a.id,
        taskId,
        amount: amount.toString(),
        currency: a.currency,
        promisedOn: fromLocalDate(businessDate),
        payBy: fromLocalDate(input.payBy),
        graceDays: settings.graceDays,
        note: (input.note ?? '').slice(0, 1000),
        createdBy: actor.id,
      },
    });
    await this.audit.write(
      {
        actor,
        action: 'collection.task.work',
        resourceType: 'LoanAccount',
        resourceId: a.id,
        outcome: 'SUCCESS',
        details: {
          promise: row.id,
          amount: amount.toString(),
          payBy: input.payBy,
          graceDays: settings.graceDays,
          task: taskId,
          replaced: replaced.count,
        },
        businessDate: fromLocalDate(businessDate),
      },
      tx,
    );
    return PromisesService.view(row);
  }

  /** A promise taken outside a work-queue task (the customer called in). */
  async record(
    actor: LendingActor,
    loanAccountId: string,
    input: PromiseInput,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanAccountId);
      await this.policy.enforce(
        actor,
        'collection.task.work',
        resourceOf(state),
        tx,
      );
      return this.recordInTx(tx, actor, state, input, null);
    });
  }

  async forLoan(actor: LendingActor, loanAccountId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanAccountId, {
        lock: false,
      });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const rows = await tx.collectionPromise.findMany({
        where: { tenantId, loanAccountId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map((r) => PromisesService.view(r));
    });
  }

  /** Promises across the loans the reader may see, for the collections screen. */
  async list(actor: LendingActor, q: { status?: string }) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    if (!scope) return [];
    return this.lp.tenantTx(tenantId, async (tx) => {
      const rows = await tx.collectionPromise.findMany({
        where: {
          tenantId,
          ...(q.status ? { status: q.status } : {}),
          loanAccount: scope as Prisma.LoanAccountWhereInput,
        },
        include: { loanAccount: { select: { reference: true } } },
        orderBy: [{ payBy: 'asc' }, { createdAt: 'asc' }],
        take: 500,
      });
      return rows.map(({ loanAccount, ...r }) => ({
        ...PromisesService.view(r),
        reference: loanAccount.reference,
      }));
    });
  }

  async cancel(
    actor: LendingActor,
    promiseId: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const p = await tx.collectionPromise.findFirst({
        where: { id: promiseId, tenantId },
      });
      if (!p) throw new NotFoundException('Promise not found');
      const state = await loadLoanState(tx, tenantId, p.loanAccountId, {
        lock: false,
      });
      await this.policy.enforce(
        actor,
        'collection.task.work',
        resourceOf(state),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const res = await tx.collectionPromise.updateMany({
        where: { id: promiseId, tenantId, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          reviewedOn: fromLocalDate(businessDate),
          note: `Withdrawn: ${body.reason}`.slice(0, 1000),
        },
      });
      if (res.count !== 1)
        throw new ConflictException('Only a pending promise can be withdrawn.');
      await this.audit.write(
        {
          actor,
          action: 'collection.task.work',
          resourceType: 'LoanAccount',
          resourceId: p.loanAccountId,
          outcome: 'SUCCESS',
          details: { promise: promiseId, withdrawn: true, reason: body.reason },
        },
        tx,
      );
      const row = await tx.collectionPromise.findFirst({
        where: { id: promiseId, tenantId },
      });
      return PromisesService.view(row!);
    });
  }

  // ── The daily review ──────────────────────────────────────────────────────

  /**
   * After end of day, every tenant with a pending promise is reviewed once
   * for its business date (PROMISE_REVIEW_CRON, default 01:30 in
   * LENDING_EOD_TZ — after the end-of-day run at 00:15; PROMISE_REVIEW_DISABLED
   * turns it off). End of day also reviews right after each day it processes;
   * the claim (tenant, business date) makes whichever comes first do the work.
   */
  @Cron(process.env.PROMISE_REVIEW_CRON || '30 1 * * *', {
    name: 'collections-promise-review',
    timeZone: process.env.LENDING_EOD_TZ || 'Asia/Phnom_Penh',
  })
  async scheduled(): Promise<void> {
    if (process.env.PROMISE_REVIEW_DISABLED === 'true') return;
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.runAll();
    } catch (e) {
      this.logger.error(`Promise review failed: ${(e as Error).message}`);
    }
  }

  /** Review every tenant that has a pending promise, as of its business date. */
  async runAll(): Promise<PromiseReviewResult[]> {
    const tenants = await runAsSystem('promise review: tenants', () =>
      this.prisma.collectionPromise.findMany({
        where: { status: 'PENDING' },
        distinct: ['tenantId'],
        select: { tenantId: true },
      }),
    );
    const out: PromiseReviewResult[] = [];
    for (const { tenantId } of tenants) {
      const day = await runAsTenant(tenantId, () =>
        this.businessDate.get(tenantId),
      );
      const r = await this.afterEndOfDay(tenantId, day);
      if (r) out.push(r);
    }
    return out;
  }

  /**
   * The review for one tenant's business day, run once across instances.
   * Never throws: a failure is logged and written to the tenant's audit trail
   * (an operational alert picks it up), and the next day's review covers the
   * same promises again.
   */
  async afterEndOfDay(
    tenantId: string,
    businessDate: string,
  ): Promise<PromiseReviewResult | null> {
    try {
      if (!(await this.claims.once(tenantId, PROMISE_REVIEW_JOB, businessDate)))
        return null;
      return await this.review(tenantId, businessDate);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.error(`Promise review ${tenantId} ${businessDate}: ${error}`);
      await runAsTenant(tenantId, () =>
        this.audit.write({
          actor: promiseReviewActor(tenantId),
          action: 'collection.promise.review',
          resourceType: 'Tenant',
          resourceId: tenantId,
          outcome: 'FAILURE',
          details: { businessDate, error: error.slice(0, 500) },
        }),
      ).catch(() => undefined);
      return null;
    }
  }

  /** Staff run of the review now (permission servicing.batch.run). */
  async reviewNow(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'servicing.batch.run', {
      type: 'TENANT',
      id: tenantId,
      tenantId,
      makerIds: [],
    });
    const businessDate = await this.businessDate.get(tenantId);
    return this.review(tenantId, businessDate, actor);
  }

  /**
   * Review every pending promise of a tenant as of `businessDate`. Each
   * promise is decided in its own transaction with a conditional update, so
   * two reviews at once cannot decide one promise twice.
   */
  async review(
    tenantId: string,
    businessDate: string,
    actor: LendingActor = promiseReviewActor(tenantId),
  ): Promise<PromiseReviewResult> {
    const result: PromiseReviewResult = {
      tenantId,
      businessDate,
      reviewed: 0,
      kept: 0,
      broken: 0,
      cancelled: 0,
      tasksRaised: 0,
    };
    const pending = await this.lp.tenantTx(tenantId, (tx) =>
      tx.collectionPromise.findMany({
        where: { tenantId, status: 'PENDING' },
        select: { id: true },
        orderBy: { payBy: 'asc' },
      }),
    );
    for (const { id } of pending) {
      let outcome: { status: string; taskRaised: boolean } | null;
      try {
        outcome = await this.lp.tenantTx(tenantId, (tx) =>
          this.reviewOne(tx, actor, tenantId, id, businessDate),
        );
      } catch (e) {
        // Decided by a concurrent review: that review counts it.
        if (e instanceof ConflictException) continue;
        throw e;
      }
      if (!outcome) continue;
      result.reviewed++;
      if (outcome.status === 'KEPT') result.kept++;
      if (outcome.status === 'BROKEN') result.broken++;
      if (outcome.status === 'CANCELLED') result.cancelled++;
      if (outcome.taskRaised) result.tasksRaised++;
    }
    if (result.reviewed)
      this.logger.log(
        `Promises ${tenantId} ${businessDate}: ${result.kept} kept, ${result.broken} broken, ${result.cancelled} cancelled`,
      );
    return result;
  }

  private async reviewOne(
    tx: Tx,
    actor: LendingActor,
    tenantId: string,
    id: string,
    businessDate: string,
  ): Promise<{ status: string; taskRaised: boolean } | null> {
    const p = await tx.collectionPromise.findFirst({
      where: { id, tenantId, status: 'PENDING' },
    });
    if (!p) return null;
    const from = toLocalDate(p.promisedOn)!;
    const deadline = lending.addDays(toLocalDate(p.payBy)!, p.graceDays);
    const received = await tx.financialEvent.aggregate({
      where: {
        tenantId,
        loanAccountId: p.loanAccountId,
        status: 'POSTED',
        type: { in: RECEIPT_EVENTS },
        valueDate: { gte: fromLocalDate(from), lte: fromLocalDate(deadline) },
      },
      _sum: { amount: true },
    });
    const got = D(received._sum.amount ?? 0);
    const account = await tx.loanAccount.findFirst({
      where: { id: p.loanAccountId, tenantId },
      select: { status: true },
    });
    let status: 'KEPT' | 'BROKEN' | 'CANCELLED' | null = null;
    let note = p.note;
    if (got.gte(D(p.amount))) status = 'KEPT';
    else if (account?.status !== 'ACTIVE') {
      status = 'CANCELLED';
      note = `${note ? `${note} · ` : ''}Loan ${account?.status ?? 'removed'} before the promise was met.`;
    } else if (lending.compareDates(businessDate, deadline) > 0)
      status = 'BROKEN';
    if (!status) return null;

    let followUpTaskId: string | null = null;
    if (status === 'BROKEN')
      followUpTaskId = await this.raiseFollowUp(
        tx,
        p,
        got,
        deadline,
        businessDate,
      );
    const res = await tx.collectionPromise.updateMany({
      where: { id, tenantId, status: 'PENDING' },
      data: {
        status,
        received: got.toString(),
        reviewedOn: fromLocalDate(businessDate),
        followUpTaskId,
        note: note.slice(0, 1000),
      },
    });
    // Decided meanwhile by another review: this transaction's task goes too.
    if (res.count !== 1)
      throw new ConflictException('Promise already reviewed');
    await this.audit.write(
      {
        actor,
        action: 'collection.promise.review',
        resourceType: 'LoanAccount',
        resourceId: p.loanAccountId,
        outcome: 'SUCCESS',
        details: {
          promise: id,
          status,
          promised: p.amount.toString(),
          received: got.toString(),
          countsUntil: deadline,
          followUpTask: followUpTaskId,
        },
        businessDate: fromLocalDate(businessDate),
      },
      tx,
    );
    return { status, taskRaised: !!followUpTaskId };
  }

  /**
   * The work-queue task for a broken promise, in the queue of the next stage
   * of the loan's collections ladder after the stage the loan is in. None
   * when the loan is no longer in arrears (nothing left to chase).
   */
  private async raiseFollowUp(
    tx: Tx,
    p: PromiseRow,
    got: InstanceType<typeof lending.D>,
    deadline: string,
    businessDate: string,
  ): Promise<string | null> {
    const state = await loadLoanState(tx, p.tenantId, p.loanAccountId, {
      lock: false,
    });
    const dq = delinquency(state, businessDate);
    if (dq.dpd <= 0) return null;
    const ladder = [...state.config.operations.collectionStages]
      .filter((s) => s.action !== 'NONE')
      .sort((a, b) => a.fromDpd - b.fromDpd);
    if (!ladder.length) return null;
    const at = ladder.findIndex((s) => s.code === dq.stage);
    const target = ladder[Math.min(at + 1, ladder.length - 1)] ?? ladder[0];
    const message = `Promise to pay broken: ${p.amount.toString()} ${p.currency} promised by ${toLocalDate(p.payBy)} (payments counted to ${deadline}); ${got.toString()} received. Raised to ${target.label}.`;
    // Two promises on one loan broken the same day share one task.
    const existing = await tx.collectionTask.findFirst({
      where: {
        tenantId: p.tenantId,
        loanAccountId: p.loanAccountId,
        stage: PROMISE_BROKEN_STAGE,
        episodeFrom: fromLocalDate(businessDate),
      },
    });
    if (existing) {
      await tx.collectionTask.update({
        where: { id: existing.id },
        data: { note: `${existing.note}\n${message}`.slice(0, 1000) },
      });
      return existing.id;
    }
    const overdue = state.lines
      .filter(
        (l) =>
          l.status === 'DUE' &&
          lending.compareDates(toLocalDate(l.dueDate)!, businessDate) < 0,
      )
      .reduce(
        (s, l) =>
          s
            .plus(D(l.principalDue).minus(D(l.principalPaid)))
            .plus(D(l.interestDue).minus(D(l.interestPaid)))
            .plus(D(l.feeDue).minus(D(l.feePaid)))
            .plus(D(l.taxDue).minus(D(l.taxPaid)))
            .plus(D(l.penaltyDue).minus(D(l.penaltyPaid))),
        D(0),
      );
    const task = await tx.collectionTask.create({
      data: {
        tenantId: p.tenantId,
        loanAccountId: p.loanAccountId,
        stage: PROMISE_BROKEN_STAGE,
        action: HUMAN_ACTIONS.has(target.action) ? target.action : 'CALL',
        queue: target.queue || target.code,
        // The day the promise was found broken: a broken-promise task never
        // takes a ladder stage's slot for the arrears episode.
        episodeFrom: fromLocalDate(businessDate),
        daysPastDue: dq.dpd,
        amountOverdue: overdue.toString(),
        dueOn: fromLocalDate(businessDate),
        status: 'OPEN',
        note: message.slice(0, 1000),
      },
    });
    return task.id;
  }
}
