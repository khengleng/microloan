import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
import { PostingService, PostingLine } from '../accounting/posting.service';
import { ApplicationsService } from '../origination/applications.service';
import { GroupsService } from '../origination/groups.service';
import { ImpairmentService } from '../accounting/impairment.service';
import {
  Line,
  LoanState,
  contractualAccrual,
  engineLine,
  lineFullyPaid,
  loadLoanState,
  outstanding,
  resourceOf,
} from './loan-state';

type Json = Prisma.InputJsonValue;
type Dec = InstanceType<typeof lending.D>;
const ZERO = () => new lending.D(0);

interface EventInput {
  type: string;
  amount: Dec;
  businessDate: string;
  valueDate: string;
  components: Record<string, unknown>;
  idempotencyKey: string;
  requestHash: string;
  actor: LendingActor;
  narrative: string;
  externalReference?: string | null;
  reversalOfId?: string;
  lines: PostingLine[];
}

/**
 * Servicing of booked loans: disbursement, accrual, repayment, prepayment,
 * settlement, reversal, penalties, delinquency and write-off.
 *
 * Invariants:
 *  • every money movement is one immutable FinancialEvent with a balanced
 *    journal, written in the same transaction as the balance change;
 *  • every client money request carries an idempotency key — a retry with the
 *    same key and payload returns the original event, a different payload 409s;
 *  • every mutation ends with a compare-and-set on LoanAccount.version, so
 *    concurrent requests cannot double-disburse or double-apply a payment;
 *  • authorization is re-evaluated inside the transaction on committed state;
 *  • servicing depends on the agreement snapshot, never on the live product,
 *    so retiring a product or switching off origination does not stop it.
 */
@Injectable()
export class ServicingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly posting: PostingService,
    private readonly applications: ApplicationsService,
    private readonly groups: GroupsService,
    private readonly impairment: ImpairmentService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(
    actor: LendingActor,
    q: { status?: string; search?: string; page?: number },
  ) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    if (!scope) return { data: [], total: 0 };
    const where: Prisma.LoanAccountWhereInput = {
      tenantId,
      ...(scope as Prisma.LoanAccountWhereInput),
    };
    if (q.status) where.status = q.status;
    if (q.search) where.reference = { contains: q.search, mode: 'insensitive' };
    const take = 50;
    const skip = (Math.max(1, q.page ?? 1) - 1) * take;
    const [data, total] = await Promise.all([
      this.prisma.loanAccount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.loanAccount.count({ where }),
    ]);
    return { data: data.map(view), total };
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const [allLines, events, tasks, versions] = await Promise.all([
        tx.scheduleInstalment.findMany({
          where: { tenantId, loanAccountId: id },
          orderBy: [{ agreementVersion: 'asc' }, { number: 'asc' }],
        }),
        tx.financialEvent.findMany({
          where: { tenantId, loanAccountId: id },
          orderBy: { createdAt: 'asc' },
          include: { allocations: true, journal: { include: { lines: true } } },
        }),
        tx.approvalTask.findMany({
          where: { tenantId, subjectType: 'LOAN_ACCOUNT', subjectId: id },
          orderBy: { createdAt: 'desc' },
        }),
        tx.agreementVersion.findMany({
          where: { tenantId, agreementId: state.account.agreementId },
          orderBy: { version: 'asc' },
          select: {
            version: true,
            reason: true,
            effectiveDate: true,
            engineVersion: true,
            configHash: true,
            createdAt: true,
            createdBy: true,
            terms: true,
            policies: true,
          },
        }),
      ]);
      return {
        account: view(state.account),
        productCode: state.productCode,
        productVersionStatus: state.productVersionStatus,
        agreementVersion: state.agreementVersion,
        agreementVersions: versions.map((v) => ({
          ...v,
          effectiveDate: toLocalDate(v.effectiveDate),
        })),
        schedule: allLines.map(lineView),
        events,
        tasks,
      };
    });
  }

  // ── Disbursement (prepare → approve → execute) ────────────────────────────

  async prepareDisbursement(
    actor: LendingActor,
    id: string,
    body: { valueDate?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const v1 = await tx.agreementVersion.findFirst({
        where: { tenantId, agreementId: state.account.agreementId, version: 1 },
      });
      const fees = (
        v1!.calculation as unknown as { fees: lending.UpfrontFeeResult }
      ).fees;
      await this.policy.enforce(
        actor,
        'loan.disbursement.prepare',
        resourceOf(state, [], fees.netDisbursement),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = body.valueDate ?? businessDate;
      BusinessDateService.checkValueDate(
        valueDate,
        businessDate,
        state.config.repayment.maxBackdateDays,
      );
      const open = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: id,
          action: 'DISBURSEMENT',
          status: { in: ['PENDING', 'APPROVED'] },
        },
      });
      if (open)
        throw new ConflictException(
          'A disbursement is already in progress for this loan.',
        );
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: id,
          action: 'DISBURSEMENT',
          requiredPermission: 'loan.disbursement.approve',
          amount: fees.netDisbursement,
          currency: state.account.currency,
          payload: { valueDate, bookedPrincipal: fees.bookedPrincipal } as Json,
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.disbursement.prepare',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            task: task.id,
            netDisbursement: fees.netDisbursement,
            valueDate,
          },
        },
        tx,
      );
      return task;
    });
  }

  async approveDisbursement(
    actor: LendingActor,
    id: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectId: id, action: 'DISBURSEMENT' },
      });
      if (!task) throw new NotFoundException('Disbursement task not found');
      const decision = await this.policy.enforce(
        actor,
        'loan.disbursement.approve',
        resourceOf(state, [task.makerId], decStr(task.amount)),
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
        throw concurrentModification('This disbursement task');
      await this.audit.write(
        {
          actor,
          action: 'loan.disbursement.approve',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          decision,
          details: { task: taskId, approve: body.approve },
        },
        tx,
      );
      return tx.approvalTask.findFirst({ where: { id: taskId, tenantId } });
    });
  }

  async executeDisbursement(
    actor: LendingActor,
    id: string,
    body: { externalReference: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'disburse', id, body });
    return this.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const task = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: id,
          action: 'DISBURSEMENT',
          status: 'APPROVED',
        },
      });
      if (!task)
        throw new ConflictException(
          'There is no approved disbursement to execute.',
        );
      await this.policy.enforce(
        actor,
        'loan.disbursement.execute',
        resourceOf(state, [task.makerId], decStr(task.amount)),
        tx,
      );
      if (!body.externalReference?.trim())
        throw new BadRequestException(
          'Record the bank or cash reference of the payout.',
        );
      const outstandingCps = await tx.conditionPrecedent.findMany({
        where: {
          tenantId,
          applicationId: state.account.applicationId,
          status: 'OUTSTANDING',
        },
      });
      if (outstandingCps.length) {
        throw new BadRequestException({
          message: `Conditions precedent outstanding: ${outstandingCps.map((c) => c.label).join('; ')}.`,
          code: 'CONDITIONS_OUTSTANDING',
        });
      }
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = (task.payload as { valueDate: string }).valueDate;
      BusinessDateService.checkValueDate(
        valueDate,
        businessDate,
        state.config.repayment.maxBackdateDays,
      );

      // The booked agreement used a planned date; if the money moves on another day, re-derive the schedule as a new agreement version.
      const v1 = await tx.agreementVersion.findFirst({
        where: { tenantId, agreementId: state.account.agreementId, version: 1 },
      });
      const calc = v1!.calculation as unknown as {
        schedule: lending.ScheduleResult;
        fees: lending.UpfrontFeeResult;
      };
      let schedule = calc.schedule;
      let agreementVersion = state.agreementVersion;
      let contract = state.contract;
      if (state.contract.disbursementDate !== valueDate) {
        const terms = {
          ...(v1!.terms as unknown as lending.NegotiatedTerms),
          disbursementDate: valueDate,
        };
        const booking = await this.applications.bookingCalculation(
          tx,
          tenantId,
          state.config,
          terms,
          { reason: 'DISBURSEMENT_DATE' },
        );
        schedule = booking.schedule;
        contract = booking.input;
        agreementVersion = state.agreementVersion + 1;
        await tx.agreementVersion.create({
          data: {
            tenantId,
            agreementId: state.account.agreementId,
            version: agreementVersion,
            reason: 'DISBURSEMENT_DATE',
            productConfig: v1!.productConfig as Json,
            // The contract's policies carry forward unchanged.
            policies: (v1!.policies ?? undefined) as Json | undefined,
            configHash: v1!.configHash,
            terms: terms as unknown as Json,
            scheduleInput: booking.input as unknown as Json,
            calculation: {
              schedule: booking.schedule,
              fees: booking.fees,
              effectiveAnnualRate: booking.apr,
            } as unknown as Json,
            engineVersion: lending.LENDING_ENGINE_VERSION,
            effectiveDate: fromLocalDate(valueDate),
            createdBy: actor.id,
          },
        });
      }

      const fees = calc.fees;
      const separateFee = fees.lines.filter((f) => f.treatment === 'SEPARATE');
      const separateAmount = separateFee.reduce(
        (a, f) => a.plus(f.amount),
        ZERO(),
      );
      const separateTax = separateFee.reduce((a, f) => a.plus(f.tax), ZERO());
      if (separateAmount.plus(separateTax).gt(0)) {
        // Separately collected fees are due on the disbursement date as instalment 0.
        await tx.scheduleInstalment.create({
          data: {
            tenantId,
            loanAccountId: id,
            agreementVersion,
            number: 0,
            periodStart: fromLocalDate(valueDate),
            periodEnd: fromLocalDate(valueDate),
            dueDate: fromLocalDate(valueDate),
            openingPrincipal: '0',
            principalDue: '0',
            interestDue: '0',
            feeDue: separateAmount.toString(),
            taxDue: separateTax.toString(),
            annualRate: '0',
          },
        });
      }
      await tx.scheduleInstalment.createMany({
        data: schedule.lines.map((l) => ({
          tenantId,
          loanAccountId: id,
          agreementVersion,
          number: l.number,
          periodStart: fromLocalDate(l.periodStart),
          periodEnd: fromLocalDate(l.periodEnd),
          dueDate: fromLocalDate(l.dueDate),
          openingPrincipal: l.openingPrincipal,
          principalDue: l.principal,
          interestDue: l.interest,
          capitalizedInterest: l.capitalizedInterest,
          annualRate: l.annualRate,
          projected: l.projected,
        })),
      });

      const acc = state.config.accounting;
      // A refinance disburses into the loan it replaces rather than to the
      // borrower, and both legs must commit together: a disbursement that
      // landed without the payoff would leave the borrower owing twice.
      const refinance = await this.prepareRefinance(
        tx,
        state,
        fees.netDisbursement,
        valueDate,
      );
      const lines: PostingLine[] = [
        { accountCode: acc.loansReceivable, debit: fees.bookedPrincipal },
        { accountCode: acc.cash, credit: fees.netDisbursement },
      ];
      for (const f of fees.lines) {
        if (f.waived) continue;
        if (f.treatment === 'SEPARATE')
          lines.push({
            accountCode: acc.feesReceivable,
            debit: D(f.amount).plus(f.tax).toString(),
          });
        // A credit-insurance premium is the insurer's money, not income (UC-06).
        lines.push({
          accountCode:
            f.payee === 'INSURER' ? acc.insurerPayable : acc.feeIncome,
          credit: f.amount,
        });
        if (D(f.tax).gt(0))
          lines.push({ accountCode: acc.taxPayable, credit: f.tax });
      }
      const event = await this.recordEvent(tx, state, {
        type: 'DISBURSEMENT',
        amount: D(fees.bookedPrincipal),
        businessDate,
        valueDate,
        components: {
          bookedPrincipal: fees.bookedPrincipal,
          netDisbursement: fees.netDisbursement,
          fees: fees.lines,
          task: task.id,
          agreementVersion,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Disbursement of ${fees.netDisbursement} ${state.account.currency}`,
        externalReference: body.externalReference.trim(),
        lines,
      });
      const taskRes = await tx.approvalTask.updateMany({
        where: { id: task.id, tenantId, status: 'APPROVED' },
        data: { status: 'EXECUTED' },
      });
      if (taskRes.count !== 1)
        throw concurrentModification('This disbursement');
      await this.casAccount(tx, state, 'BOOKED', {
        status: 'ACTIVE',
        principalOutstanding: fees.bookedPrincipal,
        feesReceivable: separateAmount.plus(separateTax).toString(),
        disbursementDate: fromLocalDate(valueDate),
        maturityDate: fromLocalDate(schedule.maturityDate),
        instalmentAmount: schedule.instalmentAmount,
        lastAccrualDate: fromLocalDate(valueDate),
      });
      if (refinance) {
        await this.settleRefinancedLoan(tx, actor, state, refinance, event.id, {
          businessDate,
          valueDate,
          idempotencyKey,
          hash,
        });
      }
      await this.outbox(tx, tenantId, 'lending.disbursed', {
        loanAccountId: id,
        eventId: event.id,
        amount: fees.netDisbursement,
        currency: state.account.currency,
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.disbursement.execute',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            event: event.id,
            externalReference: body.externalReference,
          },
          configVersions: {
            agreementVersion,
            engine: lending.LENDING_ENGINE_VERSION,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      void contract;
      return event;
    });
  }

  // ── Accrual and capitalization ────────────────────────────────────────────

  /**
   * Post interest earned up to `asOf` that has not yet been posted. Idempotent:
   * the delta is (contractual accrual to date − already posted), and only a
   * positive delta is posted. Due capitalization lines convert their interest
   * into principal.
   */
  async catchUp(
    tx: Tx,
    state: LoanState,
    asOf: string,
    businessDate: string,
    actor: LendingActor,
  ): Promise<LoanState> {
    const acc = state.config.accounting;
    const posted = await tx.accrualEvent.aggregate({
      where: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
      },
      _sum: { amount: true },
    });
    const already = D(posted._sum.amount ?? '0');
    const expected = contractualAccrual(state, asOf);
    const delta = expected.minus(already);
    if (delta.gt(0)) {
      // UC-62: on non-accrual the interest is still owed, but it is held in
      // suspense rather than recognised as income (DECISIONS D-002).
      const suspended = state.account.nonAccrual;
      const event = await this.recordEvent(tx, state, {
        type: 'ACCRUAL',
        amount: delta,
        businessDate,
        valueDate: asOf,
        components: {
          interest: delta.toString(),
          contractualToDate: expected.toString(),
          previouslyPosted: already.toString(),
          suspended,
        },
        idempotencyKey: `sys:accrual:${state.account.id}:${randomUUID()}`,
        requestHash: 'system',
        actor,
        narrative: suspended
          ? `Interest accrued to ${asOf}, held in suspense (non-accrual)`
          : `Interest accrued to ${asOf}`,
        lines: [
          { accountCode: acc.interestReceivable, debit: delta.toString() },
          {
            accountCode: suspended ? acc.interestSuspense : acc.interestIncome,
            credit: delta.toString(),
          },
        ],
      });
      if (suspended) {
        state.account.interestInSuspense = D(state.account.interestInSuspense)
          .plus(delta)
          .toString() as never;
        // Written here, not left to the caller: every money operation catches
        // up first, and not all of them write the suspense balance back. The
        // version is untouched so the caller's compare-and-set still holds.
        await tx.loanAccount.updateMany({
          where: { id: state.account.id, tenantId: state.account.tenantId },
          data: { interestInSuspense: { increment: delta.toString() } },
        });
      }
      await tx.accrualEvent.create({
        data: {
          tenantId: state.account.tenantId,
          loanAccountId: state.account.id,
          financialEventId: event.id,
          accrualDate: fromLocalDate(asOf),
          amount: delta.toString(),
        },
      });
      state.account.interestReceivable = D(state.account.interestReceivable)
        .plus(delta)
        .toString() as never;
    }
    // Capitalize interest-grace lines whose period has ended.
    for (const l of state.lines) {
      if (
        l.status !== 'DUE' ||
        D(l.capitalizedInterest).isZero() ||
        lending.compareDates(toLocalDate(l.periodEnd)!, asOf) > 0
      )
        continue;
      const cap = D(l.capitalizedInterest);
      await this.recordEvent(tx, state, {
        type: 'CAPITALIZATION',
        amount: cap,
        businessDate,
        valueDate: toLocalDate(l.periodEnd)!,
        components: {
          instalment: l.number,
          capitalizedInterest: cap.toString(),
        },
        idempotencyKey: `sys:capitalization:${state.account.id}:${l.id}`,
        requestHash: 'system',
        actor,
        narrative: `Interest capitalized for instalment ${l.number}`,
        lines: [
          { accountCode: acc.loansReceivable, debit: cap.toString() },
          { accountCode: acc.interestReceivable, credit: cap.toString() },
        ],
      });
      await tx.scheduleInstalment.update({
        where: { id: l.id },
        data: { status: 'PAID' },
      });
      l.status = 'PAID';
      state.account.principalOutstanding = D(state.account.principalOutstanding)
        .plus(cap)
        .toString() as never;
      state.account.interestReceivable = D(state.account.interestReceivable)
        .minus(cap)
        .toString() as never;
    }
    state.account.lastAccrualDate = fromLocalDate(
      lending.compareDates(
        asOf,
        toLocalDate(state.account.lastAccrualDate) ?? asOf,
      ) > 0
        ? asOf
        : (toLocalDate(state.account.lastAccrualDate) ?? asOf),
    );
    return state;
  }

  // ── Advances and non-accrual ──────────────────────────────────────────────

  /**
   * Apply money held on advance to whatever has fallen due by `asOf` (UC-27,
   * DECISIONS D-001), in the product's allocation order. Runs before
   * penalties and days past due are assessed, so a borrower who paid early is
   * never late. Changes `state.account` only; the caller writes it.
   */
  async applyAdvance(
    tx: Tx,
    state: LoanState,
    asOf: string,
    businessDate: string,
    actor: LendingActor,
  ): Promise<LoanState> {
    const held = D(state.account.advanceBalance);
    if (held.lte(0)) return state;
    const dues = dueItems(state, asOf);
    if (!dues.length) return state;
    const cfg = state.config.repayment.allocation;
    const { allocations, unallocated } = lending.allocatePayment(
      held.toString(),
      dues,
      cfg.order,
      cfg.strategy,
    );
    const used = held.minus(D(unallocated));
    if (used.lte(0)) return state;
    await this.applyAllocations(tx, state, allocations);
    const sumOf = (c: string) =>
      allocations
        .filter((a) => a.component === c)
        .reduce((s, a) => s.plus(a.amount), ZERO());
    const comp = {
      PENALTY: sumOf('PENALTY'),
      FEE: sumOf('FEE').plus(sumOf('TAX')),
      INTEREST: sumOf('INTEREST'),
      PRINCIPAL: sumOf('PRINCIPAL'),
    };
    const acc = state.config.accounting;
    const released = suspenseRelease(state, comp.INTEREST);
    await this.recordEvent(
      tx,
      state,
      {
        type: 'ADVANCE_APPLIED',
        amount: used,
        businessDate,
        valueDate: asOf,
        components: {
          penalty: comp.PENALTY.toString(),
          fee: sumOf('FEE').toString(),
          tax: sumOf('TAX').toString(),
          interest: comp.INTEREST.toString(),
          principal: comp.PRINCIPAL.toString(),
          suspenseReleased: released.amount.toString(),
          advanceLeft: held.minus(used).toString(),
        },
        idempotencyKey: `sys:advance:${state.account.id}:${randomUUID()}`,
        requestHash: 'system',
        actor,
        narrative: `Advance applied to instalments due by ${asOf}`,
        lines: [
          { accountCode: acc.customerAdvances, debit: used.toString() },
          {
            accountCode: acc.penaltyReceivable,
            credit: comp.PENALTY.toString(),
          },
          { accountCode: acc.feesReceivable, credit: comp.FEE.toString() },
          {
            accountCode: acc.interestReceivable,
            credit: comp.INTEREST.toString(),
          },
          {
            accountCode: acc.loansReceivable,
            credit: comp.PRINCIPAL.toString(),
          },
          ...released.lines,
        ],
      },
      allocations,
    );
    const a = state.account;
    a.advanceBalance = held.minus(used).toString() as never;
    a.penaltyReceivable = D(a.penaltyReceivable)
      .minus(comp.PENALTY)
      .toString() as never;
    a.feesReceivable = D(a.feesReceivable).minus(comp.FEE).toString() as never;
    a.interestReceivable = D(a.interestReceivable)
      .minus(comp.INTEREST)
      .toString() as never;
    a.principalOutstanding = D(a.principalOutstanding)
      .minus(comp.PRINCIPAL)
      .toString() as never;
    a.interestInSuspense = D(a.interestInSuspense)
      .minus(released.amount)
      .toString() as never;
    return state;
  }

  /**
   * OPS-5: classify the loan and post the change in its loss allowance —
   * an expense when more is needed, a release when less is. Changes
   * `state.account` only; the caller writes it.
   */
  private async provision(
    tx: Tx,
    state: LoanState,
    dpd: number,
    policy: lending.ImpairmentPolicy,
    businessDate: string,
    actor: LendingActor,
  ) {
    const a = state.account;
    const principal = D(a.principalOutstanding);
    // Exposure: what the loan carries on the books (suspended interest is not income).
    const exposure = principal
      .plus(D(a.interestReceivable))
      .minus(D(a.interestInSuspense))
      .plus(D(a.feesReceivable))
      .plus(D(a.penaltyReceivable));
    const r = engineCall(() =>
      lending.assessImpairment(
        policy,
        {
          daysPastDue: dpd,
          principal: principal.toString(),
          exposure: lending.D.max(0, exposure).toString(),
          restructured: a.isRestructured,
          onProbation: a.probationRemaining > 0,
          nonAccrual: a.nonAccrual,
        },
        state.config.pricing.rounding,
      ),
    );
    const required = D(r.allowance);
    const delta = required.minus(D(a.allowance));
    a.classification = r.classification;
    a.impairmentStage = r.stage;
    if (delta.isZero()) return;
    const acc = state.config.accounting;
    const up = delta.gt(0);
    await this.recordEvent(tx, state, {
      type: 'PROVISION',
      amount: delta.abs(),
      businessDate,
      valueDate: businessDate,
      components: {
        classification: r.classification,
        stage: r.stage,
        required: required.toString(),
        previous: D(a.allowance).toString(),
        explanation: r.explanation,
      },
      idempotencyKey: `sys:provision:${a.id}:${randomUUID()}`,
      requestHash: 'system',
      actor,
      narrative: up
        ? `Loss allowance raised to ${required} (${r.classification})`
        : `Loss allowance released to ${required} (${r.classification})`,
      lines: up
        ? [
            { accountCode: acc.provisionExpense, debit: delta.toString() },
            { accountCode: acc.loanLossAllowance, credit: delta.toString() },
          ]
        : [
            {
              accountCode: acc.loanLossAllowance,
              debit: delta.abs().toString(),
            },
            {
              accountCode: acc.provisionExpense,
              credit: delta.abs().toString(),
            },
          ],
    });
    a.allowance = required.toString() as never;
  }

  /**
   * UC-62: move a loan onto non-accrual when it reaches the product's
   * days-past-due threshold, and back when it cures (DECISIONS D-002, D-006).
   * Changes `state.account` only; the caller writes it.
   */
  private async nonAccrualTransition(
    tx: Tx,
    state: LoanState,
    dpd: number,
    businessDate: string,
    actor: LendingActor,
  ) {
    const na = state.config.operations.nonAccrual;
    const a = state.account;
    const acc = state.config.accounting;
    if (!a.nonAccrual) {
      if (!na.enabled || na.fromDpd == null || dpd < na.fromDpd) return;
      // Interest recognised earlier but still unpaid leaves income too.
      const moved = na.reverseAccruedOnEntry
        ? lending.D.max(
            0,
            D(a.interestReceivable).minus(D(a.interestInSuspense)),
          )
        : ZERO();
      await this.recordEvent(tx, state, {
        type: 'NON_ACCRUAL',
        amount: moved,
        businessDate,
        valueDate: businessDate,
        components: {
          direction: 'ENTER',
          daysPastDue: dpd,
          fromDpd: na.fromDpd,
          reversedIncome: moved.toString(),
        },
        idempotencyKey: `sys:non-accrual:${a.id}:${randomUUID()}`,
        requestHash: 'system',
        actor,
        narrative: `Placed on non-accrual at ${dpd} days past due`,
        lines: [
          { accountCode: acc.interestIncome, debit: moved.toString() },
          { accountCode: acc.interestSuspense, credit: moved.toString() },
        ],
      });
      a.nonAccrual = true;
      a.nonAccrualSince = fromLocalDate(businessDate);
      a.interestInSuspense = D(a.interestInSuspense)
        .plus(moved)
        .toString() as never;
      return;
    }
    if (dpd > na.cureAtDpd) return;
    const released = D(a.interestInSuspense);
    await this.recordEvent(tx, state, {
      type: 'NON_ACCRUAL',
      amount: released,
      businessDate,
      valueDate: businessDate,
      components: {
        direction: 'CURE',
        daysPastDue: dpd,
        cureAtDpd: na.cureAtDpd,
        recognisedIncome: released.toString(),
        since: toLocalDate(a.nonAccrualSince),
      },
      idempotencyKey: `sys:non-accrual:${a.id}:${randomUUID()}`,
      requestHash: 'system',
      actor,
      narrative: `Returned to accrual at ${dpd} days past due`,
      lines: [
        { accountCode: acc.interestSuspense, debit: released.toString() },
        { accountCode: acc.interestIncome, credit: released.toString() },
      ],
    });
    a.nonAccrual = false;
    a.nonAccrualSince = null;
    a.interestInSuspense = '0' as never;
  }

  // ── Repayment and prepayment ──────────────────────────────────────────────

  async postRepayment(
    actor: LendingActor,
    id: string,
    body: {
      amount: string;
      valueDate?: string;
      externalReference?: string;
      prepaymentStrategy?: 'RECAST' | 'SHORTEN';
      /** Customer's choice for money beyond what is due, where the product allows it (UC-26). */
      applyExcessAs?: 'ADVANCE' | 'PREPAY';
      /** On a group loan: who paid how much of this repayment (UC-22). */
      contributions?: { borrowerId: string; amount: string }[];
      /** Someone other than the borrower paying (UC-20). */
      payer?: { name: string; relationship: string; reference?: string };
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'repay', id, body });
    return this.money(tenantId, idempotencyKey, hash, (tx) =>
      this.repayInTx(tx, actor, id, body, idempotencyKey, hash),
    );
  }

  /**
   * The repayment itself, inside the caller's transaction. `fundingAccount`
   * replaces cash when the money is already on the books elsewhere — matched
   * out of the unidentified-payments suspense account (UC-28).
   */
  async repayInTx(
    tx: Tx,
    actor: LendingActor,
    id: string,
    body: {
      amount: string;
      valueDate?: string;
      externalReference?: string;
      prepaymentStrategy?: 'RECAST' | 'SHORTEN';
      /** Customer's choice for money beyond what is due, where the product allows it (UC-26). */
      applyExcessAs?: 'ADVANCE' | 'PREPAY';
      /** On a group loan: who paid how much of this repayment (UC-22). */
      contributions?: { borrowerId: string; amount: string }[];
      /** Someone other than the borrower paying (UC-20). */
      payer?: { name: string; relationship: string; reference?: string };
    },
    idempotencyKey: string,
    hash: string,
    opts: { fundingAccount?: string } = {},
  ) {
    const tenantId = requireTenant(actor);
    let state = await loadLoanState(tx, tenantId, id);
    const amount = lending.parseMoney(
      String(body.amount ?? ''),
      state.account.currency,
      'amount',
    );
    if (amount.lte(0))
      throw new BadRequestException('Amount must be positive.');
    if (body.contributions?.length) {
      // UC-22: a group repayment split by member must add up to the payment.
      const split = body.contributions.reduce(
        (t, c) =>
          t.plus(
            lending.parseMoney(
              String(c.amount),
              state.account.currency,
              'contribution',
            ),
          ),
        ZERO(),
      );
      if (!split.eq(amount))
        throw new BadRequestException(
          `The members' contributions add up to ${split.toString()} ${state.account.currency}, not the ${amount.toString()} paid.`,
        );
    }
    await this.policy.enforce(
      actor,
      'loan.repayment.post',
      resourceOf(state, [], amount.toString()),
      tx,
    );
    const businessDate = await this.businessDate.get(tenantId, tx);
    const valueDate = body.valueDate ?? businessDate;
    BusinessDateService.checkValueDate(
      valueDate,
      businessDate,
      state.config.repayment.maxBackdateDays,
    );
    state = await this.catchUp(tx, state, valueDate, businessDate, actor);
    // Money already held as an advance pays what is due before new money does.
    state = await this.applyAdvance(tx, state, valueDate, businessDate, actor);

    const cfg = state.config.repayment;
    const { allocations, unallocated } = lending.allocatePayment(
      amount.toString(),
      dueItems(state, valueDate),
      cfg.allocation.order,
      cfg.allocation.strategy,
    );
    let excess = D(unallocated);
    const sumOf = (c: string) =>
      allocations
        .filter((a) => a.component === c)
        .reduce((s, a) => s.plus(a.amount), ZERO());
    const duePrincipalPaid = sumOf('PRINCIPAL');

    // UC-26: what happens to money beyond what is due is a product setting;
    // the customer may ask for the other treatment where the product allows it.
    const handling =
      cfg.allocation.excessHandling === 'REJECT'
        ? 'REJECT'
        : (body.applyExcessAs ?? cfg.allocation.excessHandling);
    let advanced = ZERO();
    let prepaid = ZERO();
    let prepaymentFee = ZERO();
    let prepaymentCharge: lending.EarlyRepaymentCharge | null = null;
    let prepaymentWaiver: { id: string } | null = null;
    let reschedule: lending.RescheduleResult | null = null;
    if (excess.gt(0) && handling === 'ADVANCE') {
      // UC-27: held for the borrower and applied as instalments fall due. It
      // can never exceed what the borrower owes today, so an advance is
      // always used up by the loan and never strands money on a closed one.
      const room = totalOutstanding(state)
        .minus(D(amount).minus(excess))
        .minus(D(state.account.advanceBalance));
      if (excess.gt(room))
        throw new BadRequestException(
          `This payment would leave ${excess.minus(room)} ${state.account.currency} more on advance than the loan owes. Request a settlement quote and use early settlement to repay in full.`,
        );
      advanced = excess;
      excess = ZERO();
    } else if (excess.gt(0)) {
      if (handling === 'REJECT' || !cfg.prepayment.allowed) {
        throw new BadRequestException(
          `The payment exceeds the ${D(amount).minus(excess)} ${state.account.currency} currently due, and this product does not take partial prepayments. Use early settlement to repay in full.`,
        );
      }
      const principalLeft = D(state.account.principalOutstanding).minus(
        duePrincipalPaid,
      );
      // UC-32: the charge is part of the payment. Lock-in tiers replace the
      // base fee while they apply (DECISIONS D-004, D-005); the charge is
      // fixed + rate × basis, so the prepaid principal solves
      // prepaid + charge(prepaid) = excess.
      const chargeFor = (repaid: Dec) =>
        engineCall(() =>
          lending.earlyRepaymentCharge(
            state.config,
            'PARTIAL_PREPAYMENT',
            toLocalDate(state.account.disbursementDate)!,
            valueDate,
            repaid.toString(),
            principalLeft.toString(),
          ),
        );
      const fixedPart = chargeFor(ZERO());
      if (fixedPart.refused)
        throw new BadRequestException({
          message: fixedPart.explanation,
          code: 'PREPAYMENT_LOCKED_IN',
        });
      // An approved waiver (maker-checker) removes the charge (UC-32).
      prepaymentWaiver = await this.approvedWaiver(
        tx,
        state,
        'PARTIAL_PREPAYMENT',
        valueDate,
      );
      const PROBE = new lending.D(1_000_000);
      const rate = prepaymentWaiver
        ? ZERO()
        : D(chargeFor(PROBE).charge).minus(fixedPart.charge).div(PROBE);
      const fixedCharge = prepaymentWaiver ? ZERO() : D(fixedPart.charge);
      prepaid = lending.roundMoney(
        excess.minus(fixedCharge).div(new lending.D(1).plus(rate)),
        state.config.pricing.rounding,
      );
      if (prepaid.lte(0))
        throw new BadRequestException(
          `The amount beyond what is due does not cover the ${fixedCharge.toString()} ${state.account.currency} early repayment charge.`,
        );
      prepaymentFee = excess.minus(prepaid);
      prepaymentCharge = chargeFor(prepaid);
      if (prepaid.gte(principalLeft)) {
        throw new BadRequestException(
          `This payment would repay the whole principal. Request a settlement quote and use early settlement instead.`,
        );
      }
      if (cfg.prepayment.minAmount && prepaid.lt(cfg.prepayment.minAmount)) {
        throw new BadRequestException(
          `The minimum prepayment is ${cfg.prepayment.minAmount} ${state.account.currency}.`,
        );
      }
      const strategy =
        body.prepaymentStrategy ?? cfg.prepayment.defaultStrategy;
      if (!cfg.prepayment.allowedStrategies.includes(strategy))
        throw new BadRequestException(
          `Prepayment strategy ${strategy} is not allowed for this product.`,
        );
      const future = state.lines.filter(
        (l) =>
          l.status === 'DUE' &&
          l.number > 0 &&
          lending.compareDates(toLocalDate(l.dueDate)!, valueDate) > 0,
      );
      if (!future.length)
        throw new BadRequestException(
          'There are no future instalments to prepay.',
        );
      try {
        reschedule = lending.rescheduleAfterPrepayment(
          state.contract,
          future.map(engineLine),
          valueDate,
          principalLeft.minus(prepaid).toString(),
          strategy,
          state.account.instalmentAmount?.toString() ?? null,
        );
      } catch (e) {
        if ((e as Error).name === 'EngineError')
          throw new BadRequestException({
            message: (e as Error).message,
            code: (e as { code?: string }).code,
          });
        throw e;
      }
      const newVersion = state.agreementVersion + 1;
      await tx.scheduleInstalment.updateMany({
        where: {
          tenantId,
          loanAccountId: id,
          id: { in: future.map((l) => l.id) },
          status: 'DUE',
        },
        data: { status: 'SUPERSEDED' },
      });
      await tx.scheduleInstalment.createMany({
        data: reschedule.lines.map((l) => ({
          tenantId,
          loanAccountId: id,
          agreementVersion: newVersion,
          number: l.number,
          periodStart: fromLocalDate(l.periodStart),
          periodEnd: fromLocalDate(l.periodEnd),
          dueDate: fromLocalDate(l.dueDate),
          openingPrincipal: l.openingPrincipal,
          principalDue: l.principal,
          interestDue: l.interest,
          annualRate: l.annualRate,
          projected: l.projected,
        })),
      });
      const latest = await tx.agreementVersion.findFirst({
        where: {
          tenantId,
          agreementId: state.account.agreementId,
          version: state.agreementVersion,
        },
      });
      await tx.agreementVersion.create({
        data: {
          tenantId,
          agreementId: state.account.agreementId,
          version: newVersion,
          reason:
            strategy === 'RECAST' ? 'PREPAYMENT_RECAST' : 'PREPAYMENT_SHORTEN',
          productConfig: latest!.productConfig as Json,
          // The contract's policies carry forward unchanged.
          policies: (latest!.policies ?? undefined) as Json | undefined,
          configHash: latest!.configHash,
          terms: latest!.terms as Json,
          scheduleInput: latest!.scheduleInput as Json,
          calculation: {
            reschedule,
            prepaidPrincipal: prepaid.toString(),
            valueDate,
          } as unknown as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          effectiveDate: fromLocalDate(valueDate),
          createdBy: actor.id,
        },
      });
      excess = ZERO();
    }

    await this.applyAllocations(tx, state, allocations);
    const comp = {
      PENALTY: sumOf('PENALTY'),
      FEE: sumOf('FEE'),
      TAX: sumOf('TAX'),
      INTEREST: sumOf('INTEREST'),
      PRINCIPAL: duePrincipalPaid,
    };
    const acc = state.config.accounting;
    const released = suspenseRelease(state, comp.INTEREST);
    const event = await this.recordEvent(
      tx,
      state,
      {
        type: 'REPAYMENT',
        amount,
        businessDate,
        valueDate,
        components: {
          penalty: comp.PENALTY.toString(),
          fee: comp.FEE.toString(),
          tax: comp.TAX.toString(),
          interest: comp.INTEREST.toString(),
          principal: comp.PRINCIPAL.toString(),
          prepaidPrincipal: prepaid.toString(),
          prepaymentFee: prepaymentFee.toString(),
          prepaymentCharge: prepaymentCharge
            ? {
                source: prepaymentCharge.source,
                monthsElapsed: prepaymentCharge.monthsElapsed,
                explanation: prepaymentWaiver
                  ? `Waived (approved waiver ${prepaymentWaiver.id.slice(0, 8)}).`
                  : prepaymentCharge.explanation,
                waiverTaskId: prepaymentWaiver?.id,
              }
            : undefined,
          advance: advanced.toString(),
          suspenseReleased: released.amount.toString(),
          payer: body.payer ?? null,
          rescheduled: !!reschedule,
          reschedule: reschedule?.explanation,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Repayment of ${amount} ${state.account.currency}`,
        externalReference: body.externalReference,
        lines: [
          {
            accountCode: opts.fundingAccount ?? acc.cash,
            debit: amount.toString(),
          },
          {
            accountCode: acc.penaltyReceivable,
            credit: comp.PENALTY.toString(),
          },
          {
            accountCode: acc.feesReceivable,
            credit: comp.FEE.plus(comp.TAX).toString(),
          },
          {
            accountCode: acc.interestReceivable,
            credit: comp.INTEREST.toString(),
          },
          {
            accountCode: acc.loansReceivable,
            credit: comp.PRINCIPAL.plus(prepaid).toString(),
          },
          { accountCode: acc.feeIncome, credit: prepaymentFee.toString() },
          { accountCode: acc.customerAdvances, credit: advanced.toString() },
          ...released.lines,
        ],
      },
      allocations,
    );
    if (prepaymentWaiver)
      await this.consumeWaiver(tx, tenantId, prepaymentWaiver.id, event.id);
    if (body.contributions?.length)
      await this.groups.recordContributions(
        tx,
        tenantId,
        id,
        event.id,
        body.contributions,
      );
    const principalOutstanding = D(state.account.principalOutstanding)
      .minus(comp.PRINCIPAL)
      .minus(prepaid);
    const data: Prisma.LoanAccountUpdateManyMutationInput = {
      advanceBalance: D(state.account.advanceBalance).plus(advanced).toString(),
      interestInSuspense: D(state.account.interestInSuspense)
        .minus(released.amount)
        .toString(),
      principalOutstanding: principalOutstanding.toString(),
      interestReceivable: D(state.account.interestReceivable)
        .minus(comp.INTEREST)
        .toString(),
      feesReceivable: D(state.account.feesReceivable)
        .minus(comp.FEE)
        .minus(comp.TAX)
        .toString(),
      penaltyReceivable: D(state.account.penaltyReceivable)
        .minus(comp.PENALTY)
        .toString(),
      lastAccrualDate: state.account.lastAccrualDate,
    };
    if (reschedule) {
      data.instalmentAmount =
        reschedule.instalmentAmount ?? state.account.instalmentAmount;
      data.maturityDate = fromLocalDate(
        reschedule.lines[reschedule.lines.length - 1].dueDate,
      );
    }
    await this.closeIfRepaid(tx, state, data, actor, businessDate);
    await this.casAccount(tx, state, 'ACTIVE', data);
    await this.outbox(tx, tenantId, 'lending.repayment', {
      loanAccountId: id,
      eventId: event.id,
      amount: amount.toString(),
      currency: state.account.currency,
    });
    await this.audit.write(
      {
        actor,
        action: 'loan.repayment.post',
        resourceType: 'LoanAccount',
        resourceId: id,
        outcome: 'SUCCESS',
        details: {
          event: event.id,
          amount: amount.toString(),
          prepaid: prepaid.toString(),
          advance: advanced.toString(),
        },
        businessDate: fromLocalDate(businessDate),
      },
      tx,
    );
    return event;
  }

  // ── Early settlement ──────────────────────────────────────────────────────

  async settlementQuote(actor: LendingActor, id: string, asOf?: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const businessDate = await this.businessDate.get(tenantId, tx);
      return {
        ...(await this.quote(tx, state, asOf ?? businessDate)),
        businessDate,
        note: 'Quote only — nothing has been posted.',
      };
    });
  }

  private async quote(tx: Tx, state: LoanState, asOf: string) {
    if (state.account.status !== 'ACTIVE')
      throw new ConflictException(`Loan is ${state.account.status}.`);
    if (!state.config.repayment.earlySettlement.allowed)
      throw new BadRequestException(
        'This product does not allow early settlement.',
      );
    const posted = await tx.accrualEvent.aggregate({
      where: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
      },
      _sum: { amount: true },
    });
    const pendingAccrual = lending.D.max(
      0,
      contractualAccrual(state, asOf).minus(D(posted._sum.amount ?? '0')),
    );
    const principal = D(state.account.principalOutstanding);
    // UC-33: precomputed (flat) interest may be rebated by Rule of 78 or the
    // actuarial method instead of charging what has accrued by day count.
    const rebate = precomputedRebate(state, asOf);
    const interest = rebate
      ? D(rebate.interestOwed)
      : D(state.account.interestReceivable).plus(pendingAccrual);
    const due = state.lines.filter(
      (l) =>
        l.status === 'DUE' &&
        lending.compareDates(toLocalDate(l.dueDate)!, asOf) <= 0,
    );
    const duePrincipal = due.reduce(
      (s, l) => s.plus(outstanding(l).PRINCIPAL),
      ZERO(),
    );
    // UC-32: lock-in tiers replace the base settlement fee while they apply.
    const charge = engineCall(() =>
      lending.earlyRepaymentCharge(
        state.config,
        'EARLY_SETTLEMENT',
        toLocalDate(state.account.disbursementDate)!,
        asOf,
        principal.minus(duePrincipal).toString(),
        principal.toString(),
      ),
    );
    if (charge.refused)
      throw new BadRequestException({
        message: charge.explanation,
        code: 'SETTLEMENT_LOCKED_IN',
      });
    // An approved fee waiver (maker-checker) sets the fee to zero (UC-32).
    const waiver = await this.approvedWaiver(
      tx,
      state,
      'EARLY_SETTLEMENT',
      asOf,
    );
    const fee = waiver ? ZERO() : D(charge.charge);
    // Money already held on advance goes towards the payoff (UC-27).
    const advance = D(state.account.advanceBalance);
    const total = principal
      .plus(interest)
      .plus(D(state.account.feesReceivable))
      .plus(D(state.account.penaltyReceivable))
      .plus(fee)
      .minus(advance);
    // Cash is tendered in the currency's settlement increment (100 riel for KHR); the difference goes to the rounding account.
    const payable = lending.roundMoney(total, state.config.pricing.rounding);
    return {
      asOf,
      currency: state.account.currency,
      principal: principal.toString(),
      interest: interest.toString(),
      fees: D(state.account.feesReceivable).toString(),
      penalties: D(state.account.penaltyReceivable).toString(),
      settlementFee: fee.toString(),
      settlementFeeExplanation: waiver
        ? `Waived (approved waiver ${waiver.id.slice(0, 8)}); would have been: ${charge.explanation}`
        : charge.explanation,
      feeWaiverTaskId: waiver?.id ?? null,
      interestRebate: rebate
        ? {
            method: rebate.method,
            rebate: rebate.rebate,
            explanation: rebate.explanation,
          }
        : undefined,
      advanceApplied: advance.toString(),
      total: total.toString(),
      payable: payable.toString(),
      roundingDifference: payable.minus(total).toString(),
    };
  }

  async settle(
    actor: LendingActor,
    id: string,
    body: { amount: string; valueDate?: string; externalReference?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'settle', id, body });
    return this.money(tenantId, idempotencyKey, hash, async (tx) => {
      let state = await loadLoanState(tx, tenantId, id);
      const amount = lending.parseMoney(
        String(body.amount ?? ''),
        state.account.currency,
        'amount',
      );
      await this.policy.enforce(
        actor,
        'loan.repayment.post',
        resourceOf(state, [], amount.toString()),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = body.valueDate ?? businessDate;
      BusinessDateService.checkValueDate(
        valueDate,
        businessDate,
        state.config.repayment.maxBackdateDays,
      );
      const q = await this.quote(tx, state, valueDate);
      if (!amount.eq(q.payable))
        throw new BadRequestException(
          `The settlement amount on ${valueDate} is ${q.payable} ${state.account.currency}.`,
        );
      state = await this.catchUp(tx, state, valueDate, businessDate, actor);

      // Allocate everything outstanding: due lines in full, then the remaining principal and interest to the first future line.
      const allocations: lending.AllocationLine[] = [];
      const live = state.lines.filter((l) => l.status === 'DUE');
      const due = live.filter(
        (l) => lending.compareDates(toLocalDate(l.dueDate)!, valueDate) <= 0,
      );
      const future = live.filter(
        (l) => lending.compareDates(toLocalDate(l.dueDate)!, valueDate) > 0,
      );
      for (const l of due)
        for (const [c, v] of Object.entries(outstanding(l)))
          if (v.gt(0))
            allocations.push({
              instalmentNumber: l.number,
              component: c as lending.DueComponent,
              amount: v.toString(),
            });
      const allocated = (c: string) =>
        allocations
          .filter((a) => a.component === c)
          .reduce((s, a) => s.plus(a.amount), ZERO());
      const futurePrincipal = D(state.account.principalOutstanding).minus(
        allocated('PRINCIPAL'),
      );
      const futureInterest = D(state.account.interestReceivable).minus(
        allocated('INTEREST'),
      );
      const futureFees = D(state.account.feesReceivable)
        .minus(allocated('FEE'))
        .minus(allocated('TAX'));
      if (future.length) {
        if (futurePrincipal.gt(0))
          allocations.push({
            instalmentNumber: future[0].number,
            component: 'PRINCIPAL',
            amount: futurePrincipal.toString(),
          });
        if (futureInterest.gt(0))
          allocations.push({
            instalmentNumber: future[0].number,
            component: 'INTEREST',
            amount: futureInterest.toString(),
          });
        if (futureFees.gt(0))
          allocations.push({
            instalmentNumber: future[0].number,
            component: 'FEE',
            amount: futureFees.toString(),
          });
      }
      await this.applyAllocations(
        tx,
        state,
        allocations.filter((a) =>
          due.some((l) => l.number === a.instalmentNumber),
        ),
      );
      if (future.length)
        await tx.scheduleInstalment.updateMany({
          where: { tenantId, id: { in: future.map((l) => l.id) } },
          data: { status: 'SUPERSEDED' },
        });

      const acc = state.config.accounting;
      const rounding = D(q.roundingDifference);
      // Every penny of interest is collected, so suspended interest is now income.
      const released = suspenseRelease(
        state,
        D(state.account.interestReceivable),
      );
      const event = await this.recordEvent(
        tx,
        state,
        {
          type: 'SETTLEMENT',
          amount,
          businessDate,
          valueDate,
          components: { ...q },
          idempotencyKey,
          requestHash: hash,
          actor,
          narrative: `Early settlement ${amount} ${state.account.currency}`,
          externalReference: body.externalReference,
          lines: [
            { accountCode: acc.cash, debit: amount.toString() },
            {
              accountCode: acc.customerAdvances,
              debit: D(state.account.advanceBalance).toString(),
            },
            {
              accountCode: acc.loansReceivable,
              credit: D(state.account.principalOutstanding).toString(),
            },
            {
              accountCode: acc.interestReceivable,
              credit: D(state.account.interestReceivable).toString(),
            },
            {
              accountCode: acc.feesReceivable,
              credit: D(state.account.feesReceivable).toString(),
            },
            {
              accountCode: acc.penaltyReceivable,
              credit: D(state.account.penaltyReceivable).toString(),
            },
            { accountCode: acc.feeIncome, credit: q.settlementFee },
            // Interest owed under the rebate method differs from what accrued
            // by day count; the difference is income (or gives some back).
            ...interestAdjustment(
              acc.interestIncome,
              D(q.interest).minus(D(state.account.interestReceivable)),
            ),
            ...released.lines,
            ...allowanceRelease(state).lines,
            rounding.gte(0)
              ? {
                  accountCode: acc.roundingDifferences,
                  credit: rounding.toString(),
                }
              : {
                  accountCode: acc.roundingDifferences,
                  debit: rounding.negated().toString(),
                },
          ],
        },
        allocations,
      );
      await this.casAccount(tx, state, 'ACTIVE', {
        status: 'CLOSED',
        closedAt: new Date(),
        principalOutstanding: '0',
        interestReceivable: '0',
        feesReceivable: '0',
        penaltyReceivable: '0',
        advanceBalance: '0',
        interestInSuspense: '0',
        allowance: '0',
        nonAccrual: false,
        nonAccrualSince: null,
        daysPastDue: 0,
        delinquencyBucket: 'CURRENT',
        collectionStage: null,
        lastAccrualDate: state.account.lastAccrualDate,
      });
      if (q.feeWaiverTaskId)
        await this.consumeWaiver(tx, tenantId, q.feeWaiverTaskId, event.id);
      await this.outbox(tx, tenantId, 'lending.settled', {
        loanAccountId: id,
        eventId: event.id,
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.settlement',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: q,
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return event;
    });
  }

  // ── Reversal ──────────────────────────────────────────────────────────────

  async reverse(
    actor: LendingActor,
    id: string,
    eventId: string,
    /** `returned`: the payment bounced or was returned, so the product's returned-payment fee applies (UC-23). */
    body: { reason: string; returned?: boolean },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'reverse', id, eventId, body });
    return this.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const original = await tx.financialEvent.findFirst({
        where: { id: eventId, tenantId, loanAccountId: id },
        include: { allocations: true, journal: { include: { lines: true } } },
      });
      if (!original) throw new NotFoundException('Event not found');
      await this.policy.enforce(
        actor,
        'loan.repayment.reverse',
        resourceOf(state, [original.actorId], original.amount.toString()),
        tx,
      );
      if (!body.reason?.trim())
        throw new BadRequestException('A reversal reason is required.');
      if (original.type !== 'REPAYMENT' && original.type !== 'ADVANCE_APPLIED')
        throw new ConflictException(
          'Only repayments and advance applications can be reversed.',
        );
      if (original.status !== 'POSTED')
        throw new ConflictException('This repayment is already reversed.');
      const components = original.components as {
        penalty: string;
        fee: string;
        tax: string;
        interest: string;
        principal: string;
        prepaidPrincipal?: string;
        advance?: string;
        suspenseReleased?: string;
        rescheduled?: boolean;
      };
      // A repayment's advance goes back out; an advance application puts the
      // money back on advance (UC-23, UC-27).
      const advanceChange =
        original.type === 'ADVANCE_APPLIED'
          ? D(original.amount)
          : D(components.advance ?? '0').negated();
      if (D(state.account.advanceBalance).plus(advanceChange).lt(0))
        throw new ConflictException(
          'Part of the advance from this repayment has already been applied to instalments; reverse those advance applications first (latest first).',
        );
      if (components.rescheduled)
        throw new ConflictException(
          'This repayment rescheduled the loan; reversing a prepayment is not supported in Phase 1.',
        );
      const later = await tx.financialEvent.count({
        where: {
          tenantId,
          loanAccountId: id,
          createdAt: { gt: original.createdAt },
          status: 'POSTED',
          type: {
            in: ['REPAYMENT', 'ADVANCE_APPLIED', 'SETTLEMENT', 'WRITE_OFF'],
          },
        },
      });
      if (later)
        throw new ConflictException(
          'Reverse later repayments first (latest first).',
        );
      const businessDate = await this.businessDate.get(tenantId, tx);

      // Undo the allocations on the schedule lines.
      for (const a of original.allocations) {
        const line = await tx.scheduleInstalment.findFirst({
          where: {
            tenantId,
            loanAccountId: id,
            number: a.instalmentNumber,
            status: { in: ['DUE', 'PAID'] },
          },
        });
        if (!line)
          throw new ConflictException(
            'The schedule has changed since this repayment; it cannot be reversed automatically.',
          );
        const field = (
          {
            PENALTY: 'penaltyPaid',
            FEE: 'feePaid',
            TAX: 'taxPaid',
            INTEREST: 'interestPaid',
            PRINCIPAL: 'principalPaid',
          } as const
        )[a.component as 'PENALTY'];
        await tx.scheduleInstalment.update({
          where: { id: line.id },
          data: {
            [field]: D(line[field]).minus(D(a.amount)).toString(),
            status: 'DUE',
          },
        });
      }
      // Interest the original released from suspense goes back into suspense,
      // unless the loan has since cured: then it is earned and stays income.
      const reSuspended = state.account.nonAccrual
        ? D(components.suspenseReleased ?? '0')
        : ZERO();
      const keptAsIncome = D(components.suspenseReleased ?? '0').minus(
        reSuspended,
      );
      const acc = state.config.accounting;
      const event = await this.recordEvent(tx, state, {
        type: 'REVERSAL',
        amount: D(original.amount),
        businessDate,
        valueDate: businessDate,
        components: {
          reversalOf: original.id,
          reason: body.reason.slice(0, 500),
          original: components,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Reversal of ${original.type === 'ADVANCE_APPLIED' ? 'advance application' : 'repayment'} ${original.id}`,
        reversalOfId: original.id,
        lines: [
          ...PostingService.reverseLines(original.journal!.lines),
          ...(keptAsIncome.gt(0)
            ? [
                {
                  accountCode: acc.interestSuspense,
                  debit: keptAsIncome.toString(),
                },
                {
                  accountCode: acc.interestIncome,
                  credit: keptAsIncome.toString(),
                },
              ]
            : []),
        ],
      });
      await tx.financialEvent.update({
        where: { id: original.id },
        data: { status: 'REVERSED' },
      });
      // UC-23: a bounced or returned payment carries the product's fee, due
      // with the earliest open instalment so it is collected like any fee.
      let returnedFee = ZERO();
      const feeAmount = state.config.pricing.returnedPaymentFee;
      if (body.returned && original.type === 'REPAYMENT' && feeAmount) {
        const target = await tx.scheduleInstalment.findFirst({
          where: { tenantId, loanAccountId: id, status: 'DUE' },
          orderBy: { number: 'asc' },
        });
        if (target) {
          returnedFee = D(feeAmount);
          await tx.scheduleInstalment.update({
            where: { id: target.id },
            data: { feeDue: D(target.feeDue).plus(returnedFee).toString() },
          });
          await this.recordEvent(tx, state, {
            type: 'FEE',
            amount: returnedFee,
            businessDate,
            valueDate: businessDate,
            components: {
              fee: returnedFee.toString(),
              code: 'RETURNED_PAYMENT',
              instalment: target.number,
              returnedEvent: original.id,
            },
            idempotencyKey: `${idempotencyKey}:returned-fee`,
            requestHash: hash,
            actor,
            narrative: `Returned payment fee for ${original.id}`,
            lines: [
              {
                accountCode: acc.feesReceivable,
                debit: returnedFee.toString(),
              },
              { accountCode: acc.feeIncome, credit: returnedFee.toString() },
            ],
          });
          await this.outbox(tx, tenantId, 'lending.payment_returned', {
            loanAccountId: id,
            eventId: original.id,
            fee: returnedFee.toString(),
          });
        }
      }
      await this.casAccount(tx, state, state.account.status, {
        status: 'ACTIVE',
        closedAt: null,
        principalOutstanding: D(state.account.principalOutstanding)
          .plus(components.principal)
          .plus(components.prepaidPrincipal ?? '0')
          .toString(),
        advanceBalance: D(state.account.advanceBalance)
          .plus(advanceChange)
          .toString(),
        interestInSuspense: D(state.account.interestInSuspense)
          .plus(reSuspended)
          .toString(),
        interestReceivable: D(state.account.interestReceivable)
          .plus(components.interest)
          .toString(),
        feesReceivable: D(state.account.feesReceivable)
          .plus(components.fee)
          .plus(components.tax)
          .plus(returnedFee)
          .toString(),
        penaltyReceivable: D(state.account.penaltyReceivable)
          .plus(components.penalty)
          .toString(),
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.repayment.reverse',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { reversed: original.id, reason: body.reason },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return event;
    });
  }

  // ── Write-off ─────────────────────────────────────────────────────────────

  // ── Negotiated settlement ─────────────────────────────────────────────────

  /** Price a negotiated settlement without writing anything. */
  async negotiatedSettlementQuote(
    actor: LendingActor,
    id: string,
    q: { agreedAmount: string; asOf?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const asOf = q.asOf ?? businessDate;
      const position = await this.settlementPosition(tx, state, asOf);
      return {
        position,
        settlement: engineCall(() =>
          lending.calculateNegotiatedSettlement(
            position,
            {
              agreedAmount: q.agreedAmount,
              allocationOrder:
                state.config.restructuring.settlementAllocationOrder,
              forgivable: forgivableComponents(state.config),
            },
            state.account.currency,
            state.config.pricing.rounding,
          ),
        ),
        businessDate,
        note: 'Quote only — nothing has been posted.',
      };
    });
  }

  /**
   * Close a loan for less than it owes.
   *
   * The concession is posted to its own expense account, separately from the
   * cash received, so the loss is visible in the ledger rather than implied by
   * a receivable that simply stopped existing. Forgiving principal is a
   * heavier concession than waiving charges, and the decision engine is told
   * which one this is through the action it is asked to authorize.
   */
  async negotiatedSettlement(
    actor: LendingActor,
    id: string,
    body: {
      agreedAmount: string;
      reason: string;
      valueDate?: string;
      externalReference?: string;
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    if (!body.reason?.trim()) {
      throw new BadRequestException(
        'A negotiated settlement gives up money owed; record why.',
      );
    }
    const hash = requestHash({ op: 'negotiated-settlement', id, body });
    return this.money(tenantId, idempotencyKey, hash, async (tx) => {
      let state = await loadLoanState(tx, tenantId, id);
      if (state.account.status !== 'ACTIVE') {
        throw new ConflictException(`Loan is ${state.account.status}.`);
      }
      if (!state.config.restructuring.allowNegotiatedSettlement) {
        throw new BadRequestException(
          'This product does not permit negotiated settlement.',
        );
      }
      refuseWhileAdvanceHeld(state, 'settle it for less than it owes');
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = body.valueDate ?? businessDate;
      BusinessDateService.checkValueDate(
        valueDate,
        businessDate,
        state.config.repayment.maxBackdateDays,
      );
      state = await this.catchUp(tx, state, valueDate, businessDate, actor);

      const position = await this.settlementPosition(tx, state, valueDate);
      const result = engineCall(() =>
        lending.calculateNegotiatedSettlement(
          position,
          {
            agreedAmount: body.agreedAmount,
            allocationOrder:
              state.config.restructuring.settlementAllocationOrder,
            forgivable: forgivableComponents(state.config),
          },
          state.account.currency,
          state.config.pricing.rounding,
        ),
      );
      // Forgiving principal is authorized separately from waiving charges:
      // they are different credit decisions with different authorities.
      await this.policy.enforce(
        actor,
        result.forgivesPrincipal
          ? 'loan.settlement.negotiate_principal'
          : 'loan.settlement.negotiate',
        resourceOf(state, [], result.concession),
        tx,
      );

      const amount = D(result.agreedAmount);
      const concession = D(result.concession);
      const acc = state.config.accounting;
      const a = state.account;
      const forgivenOf = (component: string) =>
        D(
          result.forgiven.find((x) => x.component === component)?.amount ?? '0',
        );
      const concessionAccount = forgivenOf('PRINCIPAL').gt(0)
        ? acc.principalForgivenessExpense
        : acc.concessionsExpense;
      // Suspended interest that is collected becomes income; what is forgiven
      // was never income, so it reduces the concession instead of inflating it.
      const released = suspenseRelease(
        state,
        D(
          result.allocations.find((x) => x.component === 'INTEREST')?.amount ??
            '0',
        ),
        concessionAccount,
      );

      await tx.scheduleInstalment.updateMany({
        where: { tenantId, loanAccountId: id, status: 'DUE' },
        data: { status: 'SUPERSEDED' },
      });
      const event = await this.recordEvent(tx, state, {
        type: 'SETTLEMENT',
        amount,
        businessDate,
        valueDate,
        components: {
          negotiated: true,
          fullAmount: result.fullAmount,
          concession: result.concession,
          concessionRate: result.concessionRate,
          allocations: result.allocations,
          forgiven: result.forgiven,
          reason: body.reason.slice(0, 500),
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Negotiated settlement at ${result.agreedAmount} against ${result.fullAmount} owed`,
        externalReference: body.externalReference?.slice(0, 120) ?? null,
        lines: [
          { accountCode: acc.cash, debit: amount.toString() },
          // The shortfall is an expense, not a vanished receivable.
          ...(concession.gt(0)
            ? [{ accountCode: concessionAccount, debit: concession.toString() }]
            : []),
          ...released.lines,
          ...allowanceRelease(state).lines,
          {
            accountCode: acc.loansReceivable,
            credit: decStr(a.principalOutstanding),
          },
          {
            accountCode: acc.interestReceivable,
            credit: decStr(a.interestReceivable),
          },
          { accountCode: acc.feesReceivable, credit: decStr(a.feesReceivable) },
          {
            accountCode: acc.penaltyReceivable,
            credit: decStr(a.penaltyReceivable),
          },
        ],
      });
      await this.casAccount(tx, state, 'ACTIVE', {
        status: 'CLOSED',
        closedAt: new Date(),
        principalOutstanding: '0',
        interestReceivable: '0',
        feesReceivable: '0',
        penaltyReceivable: '0',
        interestInSuspense: '0',
        allowance: '0',
        nonAccrual: false,
        nonAccrualSince: null,
      });
      await this.audit.write(
        {
          actor,
          action: result.forgivesPrincipal
            ? 'loan.settlement.negotiate_principal'
            : 'loan.settlement.negotiate',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            event: event.id,
            agreed: result.agreedAmount,
            full: result.fullAmount,
            concession: result.concession,
            concessionRate: result.concessionRate,
            forgivesPrincipal: result.forgivesPrincipal,
            reason: body.reason,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return { event, settlement: result };
    });
  }

  // ── Recovery after write-off ──────────────────────────────────────────────

  /**
   * Post money received on a loan already written off.
   *
   * A written-off loan has no balance, so a recovery cannot reduce one: the
   * cash is income, attributed against what was written off so that recovered
   * principal is distinguishable from recovered penalties. The loan stays
   * WRITTEN_OFF — recovering some of a loss does not make the loan perform
   * again.
   */
  async recordRecovery(
    actor: LendingActor,
    id: string,
    body: {
      amount: string;
      valueDate?: string;
      externalReference?: string;
      note?: string;
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'recovery', id, body });
    return this.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      if (state.account.status !== 'WRITTEN_OFF') {
        throw new ConflictException(
          `A recovery applies to a written-off loan; this one is ${state.account.status}.`,
        );
      }
      if (!state.config.restructuring.allowPostWriteOffRecovery) {
        throw new BadRequestException(
          'This product does not permit post-write-off recoveries.',
        );
      }
      await this.policy.enforce(
        actor,
        'loan.recovery.post',
        resourceOf(state, [], body.amount),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = body.valueDate ?? businessDate;
      BusinessDateService.checkValueDate(
        valueDate,
        businessDate,
        state.config.repayment.maxBackdateDays,
      );

      const { writtenOff, recovered } = await this.writeOffHistory(tx, state);
      const result = engineCall(() =>
        lending.allocateRecovery(
          writtenOff,
          recovered,
          body.amount,
          state.account.currency,
          state.config.pricing.rounding,
        ),
      );
      const amount = D(result.amount);
      const acc = state.config.accounting;
      const event = await this.recordEvent(tx, state, {
        type: 'RECOVERY',
        amount,
        businessDate,
        valueDate,
        components: {
          allocations: result.allocations,
          recoveredToDate: result.recoveredToDate,
          remainingWrittenOff: result.remainingWrittenOff,
          fullyRecovered: result.fullyRecovered,
          note: body.note?.slice(0, 500) ?? null,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Recovery on written-off loan (${result.remainingWrittenOff} still written off)`,
        externalReference: body.externalReference?.slice(0, 120) ?? null,
        lines: [
          { accountCode: acc.cash, debit: amount.toString() },
          { accountCode: acc.recoveryIncome, credit: amount.toString() },
        ],
      });
      // The loan stays WRITTEN_OFF; only the version moves, so a concurrent
      // recovery loses its compare-and-set rather than double-posting.
      await this.casAccount(tx, state, 'WRITTEN_OFF', {});
      await this.audit.write(
        {
          actor,
          action: 'loan.recovery.post',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            event: event.id,
            amount: result.amount,
            recoveredToDate: result.recoveredToDate,
            remainingWrittenOff: result.remainingWrittenOff,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return { event, recovery: result };
    });
  }

  /** What the loan owes right now, as the settlement engine expects it. */
  private async settlementPosition(
    tx: Tx,
    state: LoanState,
    asOf: string,
  ): Promise<lending.SettlementPosition> {
    const posted = await tx.accrualEvent.aggregate({
      where: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
      },
      _sum: { amount: true },
    });
    const pendingAccrual = lending.D.max(
      0,
      contractualAccrual(state, asOf).minus(D(posted._sum.amount ?? '0')),
    );
    return {
      principal: decStr(state.account.principalOutstanding),
      interest: D(state.account.interestReceivable)
        .plus(pendingAccrual)
        .toString(),
      fees: decStr(state.account.feesReceivable),
      penalties: decStr(state.account.penaltyReceivable),
    };
  }

  /** What was written off on this loan, and what has been recovered since. */
  private async writeOffHistory(tx: Tx, state: LoanState) {
    const writeOff = await tx.financialEvent.findFirst({
      where: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
        type: 'WRITE_OFF',
        status: 'POSTED',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!writeOff) {
      throw new ConflictException(
        'This loan has no posted write-off, so there is nothing to recover against.',
      );
    }
    const c = writeOff.components as {
      principal?: string;
      interest?: string;
      fees?: string;
      penalties?: string;
    };
    const recoveries = await tx.financialEvent.findMany({
      where: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
        type: 'RECOVERY',
        status: 'POSTED',
      },
    });
    const recovered: lending.ComponentAmount[] = [];
    for (const r of recoveries) {
      const allocations =
        (r.components as { allocations?: lending.ComponentAmount[] })
          .allocations ?? [];
      recovered.push(...allocations);
    }
    return {
      writtenOff: {
        principal: decStr(c.principal ?? '0'),
        interest: decStr(c.interest ?? '0'),
        fees: decStr(c.fees ?? '0'),
        penalties: decStr(c.penalties ?? '0'),
      },
      recovered,
    };
  }

  /**
   * Work out the refinance a disbursement is funding, if any.
   *
   * Returns null for an ordinary disbursement. Everything that could refuse
   * the refinance is checked here, before any money is posted.
   */
  private async prepareRefinance(
    tx: Tx,
    state: LoanState,
    netProceeds: string,
    valueDate: string,
  ) {
    const tenantId = state.account.tenantId;
    const application = await tx.application.findFirst({
      where: { id: state.account.applicationId, tenantId },
      select: { refinancesLoanId: true },
    });
    const previousId = application?.refinancesLoanId;
    if (!previousId) return null;

    const previous = await loadLoanState(tx, tenantId, previousId);
    if (previous.account.borrowerId !== state.account.borrowerId) {
      throw new BadRequestException(
        'A refinance must replace a loan of the same borrower.',
      );
    }
    if (previous.account.status !== 'ACTIVE') {
      throw new ConflictException(
        `The loan being refinanced is ${previous.account.status}; only an active loan can be replaced.`,
      );
    }
    refuseWhileAdvanceHeld(previous, 'refinance it');
    const overdue = previous.lines.filter(
      (l) =>
        l.status === 'DUE' &&
        lending.compareDates(toLocalDate(l.dueDate)!, valueDate) <= 0,
    );
    const overdueCharges = overdue.reduce(
      (t, l) =>
        t
          .plus(D(l.interestDue))
          .minus(D(l.interestPaid))
          .plus(D(l.feeDue))
          .minus(D(l.feePaid))
          .plus(D(l.penaltyDue))
          .minus(D(l.penaltyPaid)),
      ZERO(),
    );
    const paid = previous.lines.filter(
      (l) => l.status === 'PAID' && l.number > 0,
    ).length;

    const result = engineCall(() =>
      lending.calculateRefinance(
        {
          principal: decStr(previous.account.principalOutstanding),
          interest: decStr(previous.account.interestReceivable),
          fees: decStr(previous.account.feesReceivable),
          penalties: decStr(previous.account.penaltyReceivable),
          overdue: overdueCharges.toString(),
          daysPastDue: previous.account.daysPastDue,
        },
        {
          newPrincipal: netProceeds,
          // Fees are already out of the net proceeds at this point.
          allowBorrowerShortfallPayment:
            state.config.restructuring.allowRefinanceShortfall,
        },
        state.account.currency,
        state.config.pricing.rounding,
      ),
    );
    const issues = lending.checkRefinanceRules(
      {
        allowDelinquent: state.config.restructuring.refinanceAllowDelinquent,
        allowArrearsRollIn:
          state.config.restructuring.refinanceAllowArrearsRollIn,
        maxDaysPastDue: state.config.restructuring.refinanceMaxDaysPastDue,
        minInstalmentsPaid:
          state.config.restructuring.refinanceMinInstalmentsPaid,
        maxRefinanceCount: state.config.restructuring.maxRefinanceCount,
      },
      result,
      {
        daysPastDue: previous.account.daysPastDue,
        instalmentsPaid: paid,
        refinanceCount: previous.account.refinanceCount,
      },
    );
    if (issues.length) {
      throw new BadRequestException({
        message: issues.map((i) => i.message).join(' '),
        code: 'REFINANCE_REFUSED',
        issues,
      });
    }
    return { previous, result };
  }

  /**
   * Close the replaced loan from the new loan's proceeds.
   *
   * Posted as a SETTLEMENT on the old loan in the same transaction as the new
   * loan's disbursement, so the two can never diverge. The supervisory facts
   * — arrears, how much of them the new loan funded, whether the old loan was
   * delinquent — are written to RefinanceRecord, because once the old loan is
   * closed its balances no longer show them.
   */
  private async settleRefinancedLoan(
    tx: Tx,
    actor: LendingActor,
    state: LoanState,
    refinance: { previous: LoanState; result: lending.RefinanceResult },
    disbursementEventId: string,
    dates: {
      businessDate: string;
      valueDate: string;
      idempotencyKey: string;
      hash: string;
    },
  ) {
    const { previous, result } = refinance;
    const tenantId = state.account.tenantId;
    const acc = previous.config.accounting;
    const a = previous.account;
    const payoff = D(result.payoffAmount);
    refuseWhileAdvanceHeld(previous, 'refinance it');
    // The payoff clears all interest, so suspended interest is now income.
    const released = suspenseRelease(previous, D(a.interestReceivable));

    await tx.scheduleInstalment.updateMany({
      where: { tenantId, loanAccountId: a.id, status: 'DUE' },
      data: { status: 'SUPERSEDED' },
    });
    const settlement = await this.recordEvent(tx, previous, {
      type: 'SETTLEMENT',
      amount: payoff,
      businessDate: dates.businessDate,
      valueDate: dates.valueDate,
      components: {
        refinancedBy: state.account.id,
        disbursementEventId,
        ...result,
      },
      // The settlement is part of the same client request as the
      // disbursement, so it derives its key rather than inventing one.
      idempotencyKey: `${dates.idempotencyKey}:refi`,
      requestHash: dates.hash,
      actor,
      narrative: `Settled by refinance into ${state.account.reference}`,
      lines: [
        { accountCode: acc.cash, debit: payoff.toString() },
        {
          accountCode: acc.loansReceivable,
          credit: decStr(a.principalOutstanding),
        },
        {
          accountCode: acc.interestReceivable,
          credit: decStr(a.interestReceivable),
        },
        { accountCode: acc.feesReceivable, credit: decStr(a.feesReceivable) },
        {
          accountCode: acc.penaltyReceivable,
          credit: decStr(a.penaltyReceivable),
        },
        ...released.lines,
        ...allowanceRelease(previous).lines,
      ],
    });
    await this.casAccount(tx, previous, 'ACTIVE', {
      status: 'CLOSED',
      closedAt: new Date(),
      principalOutstanding: '0',
      interestReceivable: '0',
      feesReceivable: '0',
      penaltyReceivable: '0',
      interestInSuspense: '0',
      allowance: '0',
      nonAccrual: false,
      nonAccrualSince: null,
      refinancedByLoanId: state.account.id,
    });
    await tx.loanAccount.updateMany({
      where: { id: state.account.id, tenantId },
      data: {
        refinancedFromLoanId: a.id,
        refinanceCount: a.refinanceCount + 1,
      },
    });
    await tx.refinanceRecord.create({
      data: {
        tenantId,
        previousLoanId: a.id,
        newLoanId: state.account.id,
        borrowerId: a.borrowerId,
        payoffAmount: result.payoffAmount,
        appliedToPayoff: result.appliedToPayoff,
        topUpToBorrower: result.topUpToBorrower,
        shortfallPaid: result.shortfall,
        arrears: result.arrears,
        arrearsRolledIn: result.arrearsRolledIn,
        previousDaysPastDue: a.daysPastDue,
        evergreening: result.evergreening,
        calculation: result as unknown as Json,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        executedBy: actor.id,
      },
    });
    await this.audit.write(
      {
        actor,
        action: 'loan.refinance.execute',
        resourceType: 'LoanAccount',
        resourceId: state.account.id,
        outcome: 'SUCCESS',
        details: {
          previousLoan: a.reference,
          settlementEvent: settlement.id,
          payoff: result.payoffAmount,
          topUp: result.topUpToBorrower,
          arrearsRolledIn: result.arrearsRolledIn,
          evergreening: result.evergreening,
        },
        businessDate: fromLocalDate(dates.businessDate),
      },
      tx,
    );
  }

  // ── Fee waivers (UC-32) ───────────────────────────────────────────────────

  /** Propose waiving the early settlement or prepayment fee; a checker approves. */
  async proposeFeeWaiver(
    actor: LendingActor,
    id: string,
    body: {
      kind: 'EARLY_SETTLEMENT' | 'PARTIAL_PREPAYMENT';
      reason: string;
      expiresOn?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'loan.fee_waiver.propose',
        resourceOf(state),
        tx,
      );
      if (state.account.status !== 'ACTIVE')
        throw new ConflictException(`Loan is ${state.account.status}.`);
      if (!body.reason?.trim())
        throw new BadRequestException('A waiver needs a reason.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      if (
        body.expiresOn &&
        lending.compareDates(body.expiresOn, businessDate) < 0
      )
        throw new BadRequestException('A waiver cannot expire before today.');
      const open = await tx.approvalTask.findMany({
        where: {
          tenantId,
          subjectId: id,
          action: 'FEE_WAIVER',
          status: { in: ['PENDING', 'APPROVED'] },
        },
      });
      if (open.some((t) => (t.payload as { kind?: string }).kind === body.kind))
        throw new ConflictException(
          'A waiver of this fee is already pending or approved for this loan.',
        );
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: id,
          action: 'FEE_WAIVER',
          requiredPermission: 'loan.repayment.reverse',
          currency: state.account.currency,
          payload: {
            kind: body.kind,
            reason: body.reason.slice(0, 500),
            expiresOn: body.expiresOn ?? null,
          },
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.fee_waiver.propose',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { task: task.id, kind: body.kind },
        },
        tx,
      );
      return task;
    });
  }

  /** Approve or reject a waiver; an approved one waits for the payment that uses it. */
  async decideFeeWaiver(
    actor: LendingActor,
    id: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectId: id, action: 'FEE_WAIVER' },
      });
      if (!task) throw new NotFoundException('Waiver proposal not found');
      const decision = await this.policy.enforce(
        actor,
        'loan.fee_waiver.approve',
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
      if (res.count !== 1) throw concurrentModification('This waiver proposal');
      await this.audit.write(
        {
          actor,
          action: body.approve
            ? 'loan.fee_waiver.approve'
            : 'loan.fee_waiver.reject',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          decision,
          details: { task: taskId },
        },
        tx,
      );
      return tx.approvalTask.findFirst({ where: { id: taskId, tenantId } });
    });
  }

  private async approvedWaiver(
    tx: Tx,
    state: LoanState,
    kind: 'EARLY_SETTLEMENT' | 'PARTIAL_PREPAYMENT',
    asOf: string,
  ) {
    const tasks = await tx.approvalTask.findMany({
      where: {
        tenantId: state.account.tenantId,
        subjectId: state.account.id,
        action: 'FEE_WAIVER',
        status: 'APPROVED',
      },
      orderBy: { createdAt: 'asc' },
    });
    return (
      tasks.find((t) => {
        const p = t.payload as { kind?: string; expiresOn?: string | null };
        return (
          p.kind === kind &&
          (!p.expiresOn || lending.compareDates(asOf, p.expiresOn) <= 0)
        );
      }) ?? null
    );
  }

  private async consumeWaiver(
    tx: Tx,
    tenantId: string,
    taskId: string,
    eventId: string,
  ) {
    const res = await tx.approvalTask.updateMany({
      where: { id: taskId, tenantId, status: 'APPROVED' },
      data: { status: 'EXECUTED', comment: `Used by event ${eventId}` },
    });
    if (res.count !== 1) throw concurrentModification('This fee waiver');
  }

  // ── Refund of money held for the borrower (UC-74) ─────────────────────────

  /** Propose paying back (some of) the advance held on a loan. */
  async proposeAdvanceRefund(
    actor: LendingActor,
    id: string,
    body: { amount: string; reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const amount = lending.parseMoney(
        String(body.amount ?? ''),
        state.account.currency,
        'amount',
      );
      await this.policy.enforce(
        actor,
        'loan.advance_refund.propose',
        resourceOf(state, [], amount.toString()),
        tx,
      );
      if (!body.reason?.trim())
        throw new BadRequestException('Record why the advance is refunded.');
      const held = D(state.account.advanceBalance);
      if (amount.lte(0) || amount.gt(held))
        throw new BadRequestException(
          `A refund must be positive and at most the ${held} ${state.account.currency} held on advance.`,
        );
      const open = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectId: id,
          action: 'ADVANCE_REFUND',
          status: 'PENDING',
        },
      });
      if (open)
        throw new ConflictException('A refund is already awaiting approval.');
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: id,
          action: 'ADVANCE_REFUND',
          requiredPermission: 'loan.repayment.reverse',
          amount: amount.toString(),
          currency: state.account.currency,
          payload: { reason: body.reason.slice(0, 500) },
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.advance_refund.propose',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { task: task.id, amount: amount.toString() },
        },
        tx,
      );
      return task;
    });
  }

  /** Approve and pay out (Dr customer advances, Cr cash), or reject. */
  async decideAdvanceRefund(
    actor: LendingActor,
    id: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'advance-refund', id, taskId, body });
    return this.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const task = await tx.approvalTask.findFirst({
        where: {
          id: taskId,
          tenantId,
          subjectId: id,
          action: 'ADVANCE_REFUND',
        },
      });
      if (!task) throw new NotFoundException('Refund proposal not found');
      const amount = D(task.amount);
      const decision = await this.policy.enforce(
        actor,
        'loan.advance_refund.approve',
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
      if (res.count !== 1) throw concurrentModification('This refund proposal');
      if (!body.approve) return { rejected: true };
      if (amount.gt(D(state.account.advanceBalance)))
        throw new ConflictException(
          'Less is now held on advance than this refund; part of it was applied to instalments.',
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const acc = state.config.accounting;
      const event = await this.recordEvent(tx, state, {
        type: 'ADVANCE_REFUND',
        amount,
        businessDate,
        valueDate: businessDate,
        components: {
          task: taskId,
          reason: (task.payload as { reason?: string }).reason ?? '',
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Refund of ${amount} ${state.account.currency} held on advance`,
        lines: [
          { accountCode: acc.customerAdvances, debit: amount.toString() },
          { accountCode: acc.cash, credit: amount.toString() },
        ],
      });
      const data: Prisma.LoanAccountUpdateManyMutationInput = {
        advanceBalance: D(state.account.advanceBalance)
          .minus(amount)
          .toString(),
        principalOutstanding: D(state.account.principalOutstanding).toString(),
        interestReceivable: D(state.account.interestReceivable).toString(),
        feesReceivable: D(state.account.feesReceivable).toString(),
        penaltyReceivable: D(state.account.penaltyReceivable).toString(),
      };
      await this.closeIfRepaid(tx, state, data, actor, businessDate);
      await this.casAccount(tx, state, state.account.status, data);
      await this.audit.write(
        {
          actor,
          action: 'loan.advance_refund.approve',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          decision,
          details: { event: event.id, amount: amount.toString() },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return event;
    });
  }

  async proposeWriteOff(
    actor: LendingActor,
    id: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const total = totalOutstanding(state);
      await this.policy.enforce(
        actor,
        'loan.writeoff.propose',
        resourceOf(state, [], total.toString()),
        tx,
      );
      const min = state.config.operations.writeOffMinDpd;
      if (min === null)
        throw new BadRequestException('This product does not allow write-off.');
      if (state.account.daysPastDue < min)
        throw new BadRequestException(
          `Write-off needs at least ${min} days past due (currently ${state.account.daysPastDue}).`,
        );
      if (!body.reason?.trim())
        throw new BadRequestException('A reason is required.');
      refuseWhileAdvanceHeld(state, 'write it off');
      const open = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectId: id,
          action: 'WRITE_OFF',
          status: 'PENDING',
        },
      });
      if (open)
        throw new ConflictException('A write-off proposal is already pending.');
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: id,
          action: 'WRITE_OFF',
          requiredPermission: 'loan.writeoff.approve',
          amount: total.toString(),
          currency: state.account.currency,
          payload: { reason: body.reason.slice(0, 500) },
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.writeoff.propose',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { task: task.id, amount: total.toString() },
        },
        tx,
      );
      return task;
    });
  }

  async decideWriteOff(
    actor: LendingActor,
    id: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'writeoff', id, taskId, body });
    return this.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id);
      const task = await tx.approvalTask.findFirst({
        where: { id: taskId, tenantId, subjectId: id, action: 'WRITE_OFF' },
      });
      if (!task) throw new NotFoundException('Write-off proposal not found');
      const total = totalOutstanding(state);
      const decision = await this.policy.enforce(
        actor,
        'loan.writeoff.approve',
        resourceOf(state, [task.makerId], total.toString()),
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
        throw concurrentModification('This write-off proposal');
      if (!body.approve) {
        await this.audit.write(
          {
            actor,
            action: 'loan.writeoff.reject',
            resourceType: 'LoanAccount',
            resourceId: id,
            outcome: 'SUCCESS',
            details: { task: taskId },
          },
          tx,
        );
        return { rejected: true };
      }
      refuseWhileAdvanceHeld(state, 'write it off');
      const businessDate = await this.businessDate.get(tenantId, tx);
      const acc = state.config.accounting;
      const a = state.account;
      // Suspended interest was never income, so writing it off is not a loss.
      const released = suspenseRelease(state, ZERO(), acc.writeOffExpense);
      const event = await this.recordEvent(tx, state, {
        type: 'WRITE_OFF',
        amount: total,
        businessDate,
        valueDate: businessDate,
        components: {
          principal: a.principalOutstanding.toString(),
          interest: a.interestReceivable.toString(),
          fees: a.feesReceivable.toString(),
          penalties: a.penaltyReceivable.toString(),
          interestInSuspense: released.amount.toString(),
          task: taskId,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: 'Write-off',
        lines: [
          // The allowance absorbs the loss it was held for; the rest is expense,
          // and any allowance beyond the loss is released (OPS-5).
          ...writeOffAgainstAllowance(state, total),
          {
            accountCode: acc.loansReceivable,
            credit: a.principalOutstanding.toString(),
          },
          {
            accountCode: acc.interestReceivable,
            credit: a.interestReceivable.toString(),
          },
          {
            accountCode: acc.feesReceivable,
            credit: a.feesReceivable.toString(),
          },
          {
            accountCode: acc.penaltyReceivable,
            credit: a.penaltyReceivable.toString(),
          },
          ...released.lines,
        ],
      });
      await tx.scheduleInstalment.updateMany({
        where: { tenantId, loanAccountId: id, status: 'DUE' },
        data: { status: 'WRITTEN_OFF' },
      });
      await this.casAccount(tx, state, 'ACTIVE', {
        status: 'WRITTEN_OFF',
        writtenOffAt: new Date(),
        principalOutstanding: '0',
        interestReceivable: '0',
        feesReceivable: '0',
        penaltyReceivable: '0',
        interestInSuspense: '0',
        allowance: '0',
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.writeoff.approve',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          decision,
          details: { event: event.id, amount: total.toString() },
        },
        tx,
      );
      return event;
    });
  }

  private batchHooks: ((
    tx: Tx,
    state: LoanState,
    businessDate: string,
    actor: LendingActor,
  ) => Promise<void>)[] = [];
  /**
   * Lets other modules add work to the end-of-day batch without a circular
   * dependency. Hooks share the batch's loaded loan state, which the batch writes
   * once at the end with a compare-and-set: a hook may change fields on it for
   * that write (restructure monitoring does), and a hook that writes the
   * account itself must keep `state.account.version` in step.
   */
  registerBatchHook(
    hook: (
      tx: Tx,
      state: LoanState,
      businessDate: string,
      actor: LendingActor,
    ) => Promise<void>,
  ) {
    this.batchHooks.push(hook);
  }

  // ── End-of-day batch: accrual, penalties, delinquency ─────────────────────

  /**
   * Runs for the tenant business date over the accounts in the actor's scope
   * (a branch-scoped officer processes only their branch). Each account is its
   * own transaction, so one failure does not block the rest, and a concurrent
   * run of the same account loses its compare-and-set rather than doubling up.
   */
  async runBatch(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'servicing.batch.run', {
      type: 'TENANT',
      id: tenantId,
      tenantId,
      makerIds: [],
    });
    const scope = await this.policy.scopeFilter(actor, 'servicing.batch.run');
    if (!scope) return { processed: 0, failed: [] };
    const businessDate = await this.businessDate.get(tenantId);
    // The tenant's impairment policy in force, if any (OPS-5, D-010).
    const impairment = await this.impairment.active(tenantId);
    const accounts = await this.prisma.loanAccount.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        ...(scope as Prisma.LoanAccountWhereInput),
      },
      select: { id: true },
    });
    const failed: { id: string; error: string }[] = [];
    let processed = 0;
    for (const { id } of accounts) {
      try {
        await this.lp.tenantTx(tenantId, async (tx) => {
          let state = await loadLoanState(tx, tenantId, id);
          await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
          state = await this.catchUp(
            tx,
            state,
            businessDate,
            businessDate,
            actor,
          );
          // An advance pays today's instalment before it can be late.
          state = await this.applyAdvance(
            tx,
            state,
            businessDate,
            businessDate,
            actor,
          );
          const penalty = await this.assessPenalties(
            tx,
            state,
            businessDate,
            actor,
          );
          for (const hook of this.batchHooks)
            await hook(tx, state, businessDate, actor);
          const dq = delinquency(state, businessDate);
          await this.nonAccrualTransition(
            tx,
            state,
            dq.dpd,
            businessDate,
            actor,
          );
          if (impairment)
            await this.provision(
              tx,
              state,
              dq.dpd,
              impairment,
              businessDate,
              actor,
            );
          const a = state.account;
          const data: Prisma.LoanAccountUpdateManyMutationInput = {
            allowance: D(a.allowance).toString(),
            classification: a.classification,
            impairmentStage: a.impairmentStage,
            interestReceivable: D(a.interestReceivable).toString(),
            principalOutstanding: D(a.principalOutstanding).toString(),
            feesReceivable: D(a.feesReceivable).toString(),
            penaltyReceivable: D(a.penaltyReceivable).plus(penalty).toString(),
            advanceBalance: D(a.advanceBalance).toString(),
            interestInSuspense: D(a.interestInSuspense).toString(),
            nonAccrual: a.nonAccrual,
            nonAccrualSince: a.nonAccrualSince,
            lastAccrualDate: a.lastAccrualDate,
            daysPastDue: dq.dpd,
            delinquencyBucket: dq.bucket,
            collectionStage: dq.stage,
            probationRemaining: a.probationRemaining,
            delinquencyFloorBucket: a.delinquencyFloorBucket,
          };
          // The last instalment may have been paid from the advance.
          await this.closeIfRepaid(tx, state, data, actor, businessDate);
          await this.casAccount(tx, state, 'ACTIVE', data);
        });
        processed++;
      } catch (e) {
        failed.push({ id, error: (e as Error).message });
      }
    }
    await this.audit.write({
      actor,
      action: 'servicing.batch.run',
      resourceType: 'Tenant',
      resourceId: tenantId,
      outcome: failed.length ? 'FAILURE' : 'SUCCESS',
      details: { businessDate, processed, failed: failed.length },
    });
    return { businessDate, processed, failed };
  }

  private async assessPenalties(
    tx: Tx,
    state: LoanState,
    businessDate: string,
    actor: LendingActor,
  ): Promise<Dec> {
    const p = state.config.pricing.penalty;
    if (p.type === 'NONE') return ZERO();
    let total = ZERO();
    const chargedOnLoan = state.lines.reduce(
      (t, l) => t.plus(D(l.penaltyDue)),
      ZERO(),
    );
    for (const l of state.lines) {
      if (l.status !== 'DUE' || l.number === 0) continue;
      const o = outstanding(l);
      const overdue = o.PRINCIPAL.plus(o.INTEREST);
      const dueDate = toLocalDate(l.dueDate)!;
      const penaltyStart = lending.addDays(dueDate, p.graceDays);
      if (
        overdue.lte(0) ||
        lending.compareDates(businessDate, penaltyStart) <= 0
      )
        continue;
      let charge = ZERO();
      if (p.type === 'FLAT_PER_INSTALMENT') {
        if (l.penaltyAssessedThrough) continue;
        charge = D(p.flatAmount);
      } else if (p.type === 'PERCENT_PER_INSTALMENT') {
        // UC-55: a percentage of what is overdue on the instalment, once.
        if (l.penaltyAssessedThrough) continue;
        charge = lending.roundMoney(
          overdue.times(p.percentOfOverdue!),
          state.config.pricing.rounding,
        );
      } else {
        const from = l.penaltyAssessedThrough
          ? toLocalDate(l.penaltyAssessedThrough)!
          : penaltyStart;
        if (lending.compareDates(businessDate, from) <= 0) continue;
        charge = lending.roundMoney(
          D(
            lending.dailyAccrual(
              [
                {
                  from,
                  to: businessDate,
                  principal: overdue.toString(),
                  annualRate: p.annualRate!,
                },
              ],
              'ACT_365_FIXED',
            ).interest,
          ),
          state.config.pricing.rounding,
        );
      }
      if (p.capPerInstalment) {
        const room = D(p.capPerInstalment).minus(D(l.penaltyDue));
        if (charge.gt(room)) charge = lending.D.max(0, room);
      }
      if (p.capPerLoan) {
        // UC-55: late charges never total more than the cap on this loan.
        const room = D(p.capPerLoan).minus(chargedOnLoan).minus(total);
        if (charge.gt(room)) charge = lending.D.max(0, room);
      }
      await tx.scheduleInstalment.update({
        where: { id: l.id },
        data: {
          penaltyDue: D(l.penaltyDue).plus(charge).toString(),
          penaltyAssessedThrough: fromLocalDate(businessDate),
        },
      });
      total = total.plus(charge);
    }
    if (total.gt(0)) {
      const acc = state.config.accounting;
      await this.recordEvent(tx, state, {
        type: 'PENALTY',
        amount: total,
        businessDate,
        valueDate: businessDate,
        components: { penalty: total.toString(), basis: p.type },
        idempotencyKey: `sys:penalty:${state.account.id}:${randomUUID()}`,
        requestHash: 'system',
        actor,
        narrative: `Late penalty to ${businessDate}`,
        lines: [
          { accountCode: acc.penaltyReceivable, debit: total.toString() },
          { accountCode: acc.penaltyIncome, credit: total.toString() },
        ],
      });
    }
    return total;
  }

  // ── Export (scope-filtered) ───────────────────────────────────────────────

  async exportLoanBook(actor: LendingActor): Promise<string> {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'loan_data.export', {
      type: 'TENANT',
      id: tenantId,
      tenantId,
      makerIds: [],
    });
    // The export is limited to accounts the actor can read — exporting is not a way around scope.
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    const rows = scope
      ? await this.prisma.loanAccount.findMany({
          where: { tenantId, ...(scope as Prisma.LoanAccountWhereInput) },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    await this.audit.write({
      actor,
      action: 'loan_data.export',
      resourceType: 'Tenant',
      resourceId: tenantId,
      outcome: 'SUCCESS',
      details: { rows: rows.length },
    });
    const header = [
      'reference',
      'status',
      'familyCode',
      'currency',
      'bookedPrincipal',
      'principalOutstanding',
      'interestReceivable',
      'feesReceivable',
      'penaltyReceivable',
      'daysPastDue',
      'delinquencyBucket',
      'disbursementDate',
      'maturityDate',
      'branchId',
    ];
    const esc = (v: unknown) => {
      const s =
        v === null || v === undefined
          ? ''
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v as string | number | boolean);
      // Neutralise spreadsheet formula injection.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return [
      header.join(','),
      ...rows.map((r) => {
        const v = view(r);
        return header.map((h) => esc(v[h])).join(',');
      }),
    ].join('\n');
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  /**
   * Idempotent money operation: an existing event with this key is returned
   * if the payload matches, refused if it does not. The unique index on
   * (tenantId, idempotencyKey) settles concurrent first attempts.
   */
  async money<T>(
    tenantId: string,
    key: string,
    hash: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T | { replayed: true; event: unknown }> {
    if (!key || !/^[A-Za-z0-9_:.-]{8,100}$/.test(key))
      throw new BadRequestException(
        'An Idempotency-Key header (8–100 characters) is required for money operations.',
      );
    if (key.startsWith('sys:'))
      throw new BadRequestException(
        'Idempotency keys starting with "sys:" are reserved.',
      );
    const existing = await this.prisma.financialEvent.findFirst({
      where: { tenantId, idempotencyKey: key },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        throw new ConflictException(
          'This Idempotency-Key was already used with a different request.',
        );
      return { replayed: true, event: existing };
    }
    try {
      return await this.lp.tenantTx(tenantId, fn);
    } catch (e) {
      if (
        (e as { code?: string }).code === 'P2002' &&
        JSON.stringify(
          (e as { meta?: { target?: unknown } }).meta?.target ?? '',
        ).includes('idempotencyKey')
      ) {
        const winner = await this.prisma.financialEvent.findFirst({
          where: { tenantId, idempotencyKey: key },
        });
        if (winner && winner.requestHash === hash)
          return { replayed: true, event: winner };
        throw new ConflictException(
          'This Idempotency-Key was already used with a different request.',
        );
      }
      throw e;
    }
  }

  async recordEvent(
    tx: Tx,
    state: LoanState,
    e: EventInput,
    allocations: lending.AllocationLine[] = [],
  ) {
    const a = state.account;
    const event = await tx.financialEvent.create({
      data: {
        tenantId: a.tenantId,
        loanAccountId: a.id,
        type: e.type,
        businessDate: fromLocalDate(e.businessDate),
        valueDate: fromLocalDate(e.valueDate),
        amount: e.amount.toString(),
        currency: a.currency,
        components: e.components as Json,
        idempotencyKey: e.idempotencyKey,
        requestHash: e.requestHash,
        reversalOfId: e.reversalOfId,
        productVersionId: a.productVersionId,
        agreementVersion: state.agreementVersion,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        actorId: e.actor.id,
        actorType: e.actor.type,
        externalReference: e.externalReference ?? null,
        narrative: e.narrative,
      },
    });
    if (allocations.length) {
      await tx.paymentAllocation.createMany({
        data: allocations
          .filter((x) => D(x.amount).gt(0))
          .map((x) => ({
            tenantId: a.tenantId,
            financialEventId: event.id,
            loanAccountId: a.id,
            instalmentNumber: x.instalmentNumber,
            component: x.component,
            amount: x.amount,
          })),
      });
    }
    // An amendment that moves no value (a pure term extension) has nothing to post.
    if (
      e.lines.some((l) => D(l.debit ?? '0').gt(0) || D(l.credit ?? '0').gt(0))
    ) {
      await this.posting.post(tx, {
        tenantId: a.tenantId,
        financialEventId: event.id,
        loanAccountId: a.id,
        entryDate: fromLocalDate(e.businessDate),
        currency: a.currency,
        description: e.narrative,
        lines: e.lines,
      });
    }
    return event;
  }

  async applyAllocations(
    tx: Tx,
    state: LoanState,
    allocations: lending.AllocationLine[],
  ) {
    const field = {
      PENALTY: 'penaltyPaid',
      FEE: 'feePaid',
      TAX: 'taxPaid',
      INTEREST: 'interestPaid',
      PRINCIPAL: 'principalPaid',
    } as const;
    const byLine = new Map<number, lending.AllocationLine[]>();
    for (const a of allocations)
      byLine.set(a.instalmentNumber, [
        ...(byLine.get(a.instalmentNumber) ?? []),
        a,
      ]);
    for (const [number, list] of byLine) {
      const line = state.lines.find(
        (l) => l.number === number && l.status === 'DUE',
      );
      if (!line)
        throw new ConflictException(`Instalment ${number} is no longer open.`);
      const data: Record<string, string> = {};
      for (const a of list) {
        const f = field[a.component as keyof typeof field];
        const next = D(data[f] ?? line[f]).plus(a.amount);
        data[f] = next.toString();
        (line as Record<string, unknown>)[f] = next.toString();
      }
      const paid = lineFullyPaid(line);
      if (paid) line.status = 'PAID';
      await tx.scheduleInstalment.update({
        where: { id: line.id },
        data: { ...data, status: paid ? 'PAID' : 'DUE' },
      });
    }
  }

  private async closeIfRepaid(
    tx: Tx,
    state: LoanState,
    data: Prisma.LoanAccountUpdateManyMutationInput,
    actor: LendingActor,
    businessDate: string,
  ) {
    const open = await tx.scheduleInstalment.count({
      where: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
        status: 'DUE',
      },
    });
    const zero = [
      'principalOutstanding',
      'interestReceivable',
      'feesReceivable',
      'penaltyReceivable',
    ].every((k) => D(data[k as keyof typeof data] as string).isZero());
    // Money still held for the borrower keeps the account open until refunded.
    const held = D(
      (data.advanceBalance as string | undefined) ??
        state.account.advanceBalance,
    );
    if (open === 0 && zero && held.isZero()) {
      // A repaid loan needs no allowance: release what was held (OPS-5).
      const release = allowanceRelease(state);
      if (release.amount.gt(0)) {
        await this.recordEvent(tx, state, {
          type: 'PROVISION',
          amount: release.amount,
          businessDate,
          valueDate: businessDate,
          components: { released: release.amount.toString(), reason: 'CLOSED' },
          idempotencyKey: `sys:provision:${state.account.id}:${randomUUID()}`,
          requestHash: 'system',
          actor,
          narrative: 'Loss allowance released on closure',
          lines: release.lines,
        });
        data.allowance = '0';
      }
      Object.assign(data, {
        status: 'CLOSED',
        closedAt: new Date(),
        daysPastDue: 0,
        delinquencyBucket: 'CURRENT',
        collectionStage: null,
        nonAccrual: false,
        nonAccrualSince: null,
      });
    }
  }

  async casAccount(
    tx: Tx,
    state: LoanState,
    fromStatus: string,
    data: Prisma.LoanAccountUpdateManyMutationInput,
  ) {
    const res = await tx.loanAccount.updateMany({
      where: {
        id: state.account.id,
        tenantId: state.account.tenantId,
        version: state.account.version,
        status: fromStatus,
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This loan account');
  }

  async outbox(
    tx: Tx,
    tenantId: string,
    topic: string,
    payload: Record<string, unknown>,
  ) {
    await tx.outboxMessage.create({
      data: { tenantId, topic, payload: payload as Json },
    });
  }
}

export function totalOutstanding(state: LoanState): Dec {
  const a = state.account;
  return D(a.principalOutstanding)
    .plus(D(a.interestReceivable))
    .plus(D(a.feesReceivable))
    .plus(D(a.penaltyReceivable));
}

/**
 * Interest owed on early payoff of a flat-rate loan under the product's
 * rebate method (UC-33), or null when interest is simply what has accrued.
 */
function precomputedRebate(state: LoanState, asOf: string) {
  const method = state.config.repayment.earlySettlement.rebateMethod;
  if (method === 'ACCRUED' || state.config.pricing.interestMethod !== 'FLAT')
    return null;
  const lines = state.lines.filter((l) => l.number > 0);
  const totalInterest = lines.reduce(
    (s, l) => s.plus(D(l.interestDue)),
    ZERO(),
  );
  const interestPaid = lines.reduce(
    (s, l) => s.plus(D(l.interestPaid)),
    ZERO(),
  );
  const remaining = lines.filter(
    (l) => lending.compareDates(toLocalDate(l.dueDate)!, asOf) > 0,
  ).length;
  const r = engineCall(() =>
    lending.precomputedInterestRebate({
      method,
      totalInterest: totalInterest.toString(),
      principal: lines
        .reduce((s, l) => s.plus(D(l.principalDue)), ZERO())
        .toString(),
      instalments: lines.map((l) =>
        D(l.principalDue).plus(D(l.interestDue)).toString(),
      ),
      numberOfInstalments: lines.length,
      remainingInstalments: remaining,
      rounding: state.config.pricing.rounding,
    }),
  );
  const owed = lending.D.max(
    0,
    totalInterest.minus(D(r.rebate)).minus(interestPaid),
  );
  return { ...r, interestOwed: owed.toString() };
}

function interestAdjustment(account: string, delta: Dec) {
  if (delta.isZero()) return [];
  return [
    delta.gt(0)
      ? { accountCode: account, credit: delta.toString() }
      : { accountCode: account, debit: delta.negated().toString() },
  ];
}

/** What is owed on instalments due by `asOf`, in allocation-engine form. */
function dueItems(state: LoanState, asOf: string): lending.DueItem[] {
  return state.lines
    .filter(
      (l) =>
        l.status === 'DUE' &&
        lending.compareDates(toLocalDate(l.dueDate)!, asOf) <= 0,
    )
    .flatMap((l) =>
      Object.entries(outstanding(l))
        .filter(([, v]) => v.gt(0))
        .map(([component, v]) => ({
          instalmentNumber: l.number,
          dueDate: toLocalDate(l.dueDate)!,
          component: component as lending.DueComponent,
          outstanding: v.toString(),
        })),
    );
}

/**
 * Journal lines that take interest out of suspense when it stops being owed
 * (UC-62). Collected interest becomes income, up to what is in suspense; with
 * `rest` given, the remainder of the suspense balance is cleared to that
 * account too (a write-off or forgiveness, where it reduces the loss).
 */
export function suspenseRelease(
  state: LoanState,
  interestCollected: Dec,
  rest?: string,
): {
  amount: Dec;
  lines: { accountCode: string; debit?: string; credit?: string }[];
} {
  const held = D(state.account.interestInSuspense);
  if (held.lte(0)) return { amount: ZERO(), lines: [] };
  const toIncome = lending.D.min(held, lending.D.max(0, interestCollected));
  const cleared = rest ? held.minus(toIncome) : ZERO();
  const amount = toIncome.plus(cleared);
  if (amount.isZero()) return { amount, lines: [] };
  const acc = state.config.accounting;
  return {
    amount,
    lines: [
      { accountCode: acc.interestSuspense, debit: amount.toString() },
      { accountCode: acc.interestIncome, credit: toIncome.toString() },
      ...(cleared.gt(0)
        ? [{ accountCode: rest!, credit: cleared.toString() }]
        : []),
    ],
  };
}

/** Write-off lines: the allowance first, then expense; surplus allowance released. */
export function writeOffAgainstAllowance(state: LoanState, total: Dec) {
  const acc = state.config.accounting;
  const held = D(state.account.allowance);
  const used = lending.D.min(held, total);
  const surplus = held.minus(used);
  return [
    { accountCode: acc.loanLossAllowance, debit: used.toString() },
    { accountCode: acc.writeOffExpense, debit: total.minus(used).toString() },
    ...(surplus.gt(0)
      ? [
          { accountCode: acc.loanLossAllowance, debit: surplus.toString() },
          { accountCode: acc.provisionExpense, credit: surplus.toString() },
        ]
      : []),
  ];
}

/** Journal lines that release a loan's whole loss allowance, back to the provision expense or to `into`. */
export function allowanceRelease(state: LoanState, into?: string) {
  const amount = D(state.account.allowance);
  const acc = state.config.accounting;
  return {
    amount,
    lines: amount.gt(0)
      ? [
          { accountCode: acc.loanLossAllowance, debit: amount.toString() },
          {
            accountCode: into ?? acc.provisionExpense,
            credit: amount.toString(),
          },
        ]
      : [],
  };
}

/** An advance is the borrower's money; it is refunded or used before the loan is closed some other way. */
export function refuseWhileAdvanceHeld(state: LoanState, action: string) {
  const held = D(state.account.advanceBalance);
  if (held.gt(0))
    throw new ConflictException(
      `This loan holds ${held} ${state.account.currency} paid in advance. Refund the advance before you ${action}.`,
    );
}

/**
 * Days past due, bucket and collections stage. During restructure probation
 * the bucket cannot improve beyond the floor recorded at execution: executing
 * a restructure never, by itself, reclassifies a loan as performing.
 */
export function delinquency(
  state: LoanState,
  businessDate: string,
): { dpd: number; bucket: string; stage: string | null } {
  const overdue = state.lines.filter(
    (l) =>
      l.status === 'DUE' &&
      lending.compareDates(toLocalDate(l.dueDate)!, businessDate) < 0 &&
      Object.values(outstanding(l)).some((v) => v.gt(0)),
  );
  const oldest = overdue.sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
  )[0];
  const dpd = Math.max(
    oldest
      ? lending.daysBetween(toLocalDate(oldest.dueDate)!, businessDate)
      : 0,
    state.externalDpd ?? 0,
  );
  const buckets = [...state.config.operations.delinquencyBuckets].sort(
    (a, b) => a.minDpd - b.minDpd,
  );
  let bucket =
    buckets.find(
      (b) => dpd >= b.minDpd && (b.maxDpd === null || dpd <= b.maxDpd),
    )?.code ?? 'UNCLASSIFIED';
  const floor = state.account.delinquencyFloorBucket;
  if (floor && state.account.probationRemaining > 0) {
    const rank = (code: string) => buckets.findIndex((b) => b.code === code);
    if (rank(floor) > rank(bucket)) bucket = floor;
  }
  const stage =
    [...state.config.operations.collectionStages]
      .sort((a, b) => b.fromDpd - a.fromDpd)
      .find((s) => dpd >= s.fromDpd)?.code ?? null;
  return { dpd, bucket, stage };
}

function view<T extends Record<string, unknown>>(a: T) {
  const out: Record<string, unknown> = { ...a };
  for (const k of [
    'disbursementDate',
    'maturityDate',
    'lastAccrualDate',
    'nonAccrualSince',
  ])
    if (out[k] instanceof Date) out[k] = toLocalDate(out[k]);
  for (const [k, v] of Object.entries(out))
    if (v && typeof v === 'object' && 'toFixed' in v && !(v instanceof Date))
      out[k] = (v as { toString(): string }).toString();
  return out;
}

function lineView(l: Line) {
  return {
    ...view(l as unknown as Record<string, unknown>),
    periodStart: toLocalDate(l.periodStart),
    periodEnd: toLocalDate(l.periodEnd),
    dueDate: toLocalDate(l.dueDate),
    penaltyAssessedThrough: toLocalDate(l.penaltyAssessedThrough),
  };
}

/**
 * Components a product is willing to forgive in a settlement.
 *
 * Charge waiver and principal forgiveness are separate product permissions,
 * so a product that waives charges does not thereby permit a principal
 * haircut.
 */
function forgivableComponents(
  config: lending.ProductConfig,
): lending.DueComponent[] {
  const allowed: lending.DueComponent[] = [];
  if (config.restructuring.allowedOptions.includes('CHARGE_WAIVER')) {
    allowed.push('PENALTY', 'FEE', 'TAX', 'INTEREST');
  }
  if (config.restructuring.allowedOptions.includes('PRINCIPAL_FORGIVENESS')) {
    allowed.push('PRINCIPAL');
  }
  return allowed;
}
