import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import {
  DisbursementContext,
  ServicingService,
} from '../servicing/servicing.service';
import {
  Line,
  LoanState,
  loadLoanState,
  resourceOf,
} from '../servicing/loan-state';

type Json = Prisma.InputJsonValue;
type AssessmentRow = NonNullable<
  Awaited<ReturnType<Tx['incomeAssessment']['findFirst']>>
>;
const PERIODS_PER_YEAR = 12;

/**
 * Income-contingent repayment (education loans).
 *
 * The instalment is a share of the borrower's declared income above a
 * threshold. The income declared at origination sets the first schedule;
 * afterwards the income is reassessed — every year, or on a change of
 * circumstances — by one person with evidence and approved by another, and
 * approval rebuilds the rest of the schedule from the start of the next
 * period with the pure engine (`lending.incomeContingentSchedule`). Below the
 * threshold nothing is due, so nothing falls into arrears; interest the
 * payment does not cover is capitalised or not charged, per product. At the
 * end of the term, end of day forgives what is left.
 */
@Injectable()
export class IncomeContingentService {
  private readonly logger = new Logger(IncomeContingentService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {
    this.servicing.registerDisbursementHook((tx, ctx) =>
      this.onDisbursement(tx, ctx),
    );
    this.servicing.registerTenantBatchHook(
      (tenantId, businessDate, actor, scope) =>
        this.forgiveAtTermEnd(tenantId, businessDate, actor, scope),
    );
  }

  // ── Origination: the income declared with the application ─────────────────

  private async onDisbursement(tx: Tx, ctx: DisbursementContext) {
    const ic = ctx.state.config.incomeContingent;
    if (!ic) return;
    const tenantId = ctx.state.account.tenantId;
    const [app, approval, booked] = await Promise.all([
      tx.application.findFirst({
        where: { id: ctx.state.account.applicationId, tenantId },
        select: { reference: true, createdBy: true },
      }),
      tx.creditDecision.findFirst({
        where: {
          tenantId,
          applicationId: ctx.state.account.applicationId,
          type: 'APPROVE',
        },
        orderBy: { createdAt: 'desc' },
        select: { decidedBy: true },
      }),
      tx.agreementVersion.findFirst({
        where: {
          tenantId,
          agreementId: ctx.state.account.agreementId,
          version: 1,
        },
        select: { terms: true },
      }),
    ]);
    const income =
      (booked?.terms as lending.NegotiatedTerms | null)?.declaredAnnualIncome ??
      '0';
    const payment = engineCall(() =>
      lending.incomeContingentPayment(
        income,
        ic,
        PERIODS_PER_YEAR,
        ctx.state.config.pricing.rounding,
      ),
    );
    ctx.components.incomeContingent = {
      declaredAnnualIncome: payment.declaredAnnualIncome,
      periodicPayment: payment.periodicPayment,
    };
    return async () => {
      await tx.incomeAssessment.create({
        data: {
          tenantId,
          loanAccountId: ctx.state.account.id,
          sequence: 0,
          reason: 'ORIGINATION',
          declaredAnnualIncome: payment.declaredAnnualIncome,
          evidenceType: 'APPLICATION',
          evidenceReference:
            `Declared on application ${app?.reference ?? ''}`.trim(),
          annualRepayment: payment.annualRepayment,
          periodicPayment: payment.periodicPayment,
          status: 'APPROVED',
          effectiveDate: fromLocalDate(ctx.valueDate),
          nextReviewDate: fromLocalDate(
            lending.addMonths(ctx.valueDate, ic.reassessmentMonths),
          ),
          agreementVersion: Number(ctx.components.agreementVersion),
          proposedBy: app?.createdBy ?? ctx.actor.id,
          decidedBy: approval?.decidedBy ?? ctx.actor.id,
          decidedAt: new Date(),
        },
      });
    };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async plan(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const ic = this.terms(state);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const assessments = await tx.incomeAssessment.findMany({
        where: { tenantId, loanAccountId: loanId },
        orderBy: { sequence: 'desc' },
      });
      const current = assessments.find((a) => a.status === 'APPROVED') ?? null;
      const termEnd =
        state.account.status === 'BOOKED'
          ? null
          : lending.incomeContingentTermEnd(state.contract);
      const residual =
        termEnd &&
        state.lines.find((l) =>
          lending.isForgivenessLine(lineFields(l), termEnd),
        );
      const forgiven = await tx.financialEvent.findFirst({
        where: { tenantId, loanAccountId: loanId, type: 'ICL_FORGIVENESS' },
        select: { amount: true, valueDate: true },
      });
      const nextReview = current?.nextReviewDate
        ? toLocalDate(current.nextReviewDate)
        : null;
      return {
        terms: {
          ...ic,
          annualRate: state.contract.annualRate ?? null,
          termInstalments: state.contract.incomeContingent?.gridPeriods ?? null,
        },
        status: state.account.status,
        businessDate,
        termEnd,
        currentPayment: decStr(state.account.instalmentAmount),
        current: current && assessmentView(current),
        pending: assessments
          .filter((a) => a.status === 'PENDING')
          .map(assessmentView),
        assessments: assessments.map(assessmentView),
        nextReviewDate: nextReview,
        reviewDue:
          state.account.status === 'ACTIVE' &&
          !!nextReview &&
          lending.compareDates(nextReview, businessDate) <= 0,
        capitalisedToDate: capitalised(state.lines).toString(),
        projectedForgiveness: residual
          ? D(residual.principalDue).minus(D(residual.principalPaid)).toString()
          : '0',
        forgiven: forgiven
          ? {
              amount: decStr(forgiven.amount),
              on: toLocalDate(forgiven.valueDate),
            }
          : null,
      };
    });
  }

  /** What an income would make the instalment, and how the rest of the term would run, if approved today. */
  async preview(actor: LendingActor, loanId: string, income: string) {
    const tenantId = requireTenant(actor);
    if (!/^\d+(\.\d{1,4})?$/.test(income ?? ''))
      throw new BadRequestException('income must be a decimal amount.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const ic = this.terms(state);
      const payment = engineCall(() =>
        lending.incomeContingentPayment(
          income,
          ic,
          PERIODS_PER_YEAR,
          state.config.pricing.rounding,
        ),
      );
      if (state.account.status !== 'ACTIVE') return { payment, schedule: null };
      const businessDate = await this.businessDate.get(tenantId, tx);
      const r = this.rebuild(state, income, businessDate);
      return {
        payment,
        effectiveDate: r.effectiveDate,
        schedule: r.schedule && {
          lines: r.schedule.lines,
          totals: r.schedule.totals,
          maturityDate: r.schedule.maturityDate,
          explanation: r.schedule.explanation,
          forgivenAtTermEnd: forgivenOf(r.schedule),
        },
      };
    });
  }

  /** Loans whose annual reassessment is due, and assessments awaiting a checker. */
  async reviews(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    if (!scope) return { due: [], pending: [] };
    return this.lp.tenantTx(tenantId, async (tx) => {
      const businessDate = await this.businessDate.get(tenantId, tx);
      const loans = await tx.loanAccount.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          incomeAssessments: { some: {} },
          ...(scope as Prisma.LoanAccountWhereInput),
        },
        select: {
          id: true,
          reference: true,
          currency: true,
          instalmentAmount: true,
          incomeAssessments: { orderBy: { sequence: 'desc' } },
        },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      const due: {
        loanId: string;
        reference: string;
        currency: string;
        currentPayment: string;
        nextReviewDate: string;
        daysOverdue: number;
      }[] = [];
      const pending: (ReturnType<typeof assessmentView> & {
        loanId: string;
        reference: string;
        currency: string;
      })[] = [];
      for (const l of loans) {
        const current = l.incomeAssessments.find(
          (a) => a.status === 'APPROVED',
        );
        const next = current?.nextReviewDate
          ? toLocalDate(current.nextReviewDate)!
          : null;
        for (const p of l.incomeAssessments.filter(
          (a) => a.status === 'PENDING',
        ))
          pending.push({
            loanId: l.id,
            reference: l.reference,
            currency: l.currency,
            ...assessmentView(p),
          });
        if (next && lending.compareDates(next, businessDate) <= 0)
          due.push({
            loanId: l.id,
            reference: l.reference,
            currency: l.currency,
            currentPayment: decStr(l.instalmentAmount),
            nextReviewDate: next,
            daysOverdue: lending.daysBetween(next, businessDate),
          });
      }
      return { businessDate, due, pending };
    });
  }

  // ── Reassessment (maker-checker) ──────────────────────────────────────────

  async propose(
    actor: LendingActor,
    loanId: string,
    body: {
      declaredAnnualIncome: string;
      reason: 'ANNUAL' | 'CHANGE_OF_CIRCUMSTANCES';
      incomePeriod?: string;
      evidenceType: string;
      evidenceReference: string;
      documentId?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.income_assessment.propose',
        resourceOf(state),
        tx,
      );
      const ic = this.terms(state);
      if (
        ic.evidenceRequired &&
        body.evidenceType === 'OTHER' &&
        !body.documentId
      )
        throw new BadRequestException(
          'This product needs documentary evidence of income: attach the document or name a payslip, tax return, employer letter, benefits statement or a signed no-income declaration.',
        );
      if (body.documentId) {
        const doc = await tx.customerDocument.findFirst({
          where: {
            id: body.documentId,
            tenantId,
            borrowerId: state.account.borrowerId,
          },
          select: { id: true },
        });
        if (!doc)
          throw new BadRequestException(
            'The evidence document is not in this borrower’s library.',
          );
      }
      const open = await tx.incomeAssessment.findFirst({
        where: { tenantId, loanAccountId: loanId, status: 'PENDING' },
        select: { id: true },
      });
      if (open)
        throw new ConflictException(
          'An assessment is already awaiting approval; decide it first.',
        );
      const payment = engineCall(() =>
        lending.incomeContingentPayment(
          body.declaredAnnualIncome,
          ic,
          PERIODS_PER_YEAR,
          state.config.pricing.rounding,
        ),
      );
      const last = await tx.incomeAssessment.aggregate({
        where: { tenantId, loanAccountId: loanId },
        _max: { sequence: true },
      });
      const row = await tx.incomeAssessment.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          sequence: (last._max.sequence ?? 0) + 1,
          reason: body.reason,
          declaredAnnualIncome: payment.declaredAnnualIncome,
          incomePeriod: body.incomePeriod?.trim() ?? '',
          evidenceType: body.evidenceType,
          evidenceReference: body.evidenceReference.trim(),
          documentId: body.documentId ?? null,
          annualRepayment: payment.annualRepayment,
          periodicPayment: payment.periodicPayment,
          proposedBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.income_assessment.propose',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            assessment: row.id,
            reason: row.reason,
            evidenceType: row.evidenceType,
            periodicPayment: payment.periodicPayment,
          },
        },
        tx,
      );
      return { assessment: assessmentView(row), payment };
    });
  }

  /**
   * Approve (or reject) a proposed assessment. Approval rebuilds the rest of
   * the schedule from the start of the next period that has not begun: the
   * instalments already due — and any arrears on them — stay as they are.
   */
  async decide(
    actor: LendingActor,
    loanId: string,
    assessmentId: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const a = await tx.incomeAssessment.findFirst({
        where: { id: assessmentId, tenantId, loanAccountId: loanId },
      });
      if (!a) throw new NotFoundException('Income assessment not found');
      const decision = await this.policy.enforce(
        actor,
        'loan.income_assessment.approve',
        resourceOf(state, [a.proposedBy]),
        tx,
      );
      if (a.status !== 'PENDING')
        throw new ConflictException(
          `This assessment is ${a.status.toLowerCase()}.`,
        );
      const ic = this.terms(state);
      const businessDate = await this.businessDate.get(tenantId, tx);
      if (!body.approve) {
        const res = await tx.incomeAssessment.updateMany({
          where: { id: a.id, tenantId, status: 'PENDING', version: a.version },
          data: {
            status: 'REJECTED',
            decidedBy: actor.id,
            decidedAt: new Date(),
            comment: (body.comment ?? '').slice(0, 500),
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw concurrentModification('This assessment');
        await this.audit.write(
          {
            actor,
            action: 'loan.income_assessment.approve',
            resourceType: 'LoanAccount',
            resourceId: loanId,
            outcome: 'SUCCESS',
            decision,
            details: { assessment: a.id, approve: false },
          },
          tx,
        );
        return {
          assessment: assessmentView(
            (await tx.incomeAssessment.findFirst({
              where: { id: a.id, tenantId },
            }))!,
          ),
        };
      }

      const income = decStr(a.declaredAnnualIncome);
      const r = this.rebuild(state, income, businessDate);
      const newVersion = state.agreementVersion + 1;
      const latest = await tx.agreementVersion.findFirst({
        where: {
          tenantId,
          agreementId: state.account.agreementId,
          version: state.agreementVersion,
        },
      });
      await tx.scheduleInstalment.updateMany({
        where: { tenantId, id: { in: r.replaced.map((l) => l.id) } },
        data: { status: 'SUPERSEDED' },
      });
      await tx.agreementVersion.create({
        data: {
          tenantId,
          agreementId: state.account.agreementId,
          version: newVersion,
          reason: 'INCOME_ASSESSMENT',
          productConfig: latest!.productConfig as Json,
          policies: (latest!.policies ?? undefined) as Json | undefined,
          configHash: latest!.configHash,
          terms: {
            incomeAssessment: {
              id: a.id,
              declaredAnnualIncome: income,
              effectiveDate: r.effectiveDate,
            },
            previousTerms: latest!.terms,
          } as unknown as Json,
          scheduleInput: r.contract as unknown as Json,
          calculation: {
            schedule: r.schedule,
            openingBalance: r.openingBalance,
            capitalisedToDate: r.capitalisedToDate,
          } as unknown as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          effectiveDate: fromLocalDate(r.effectiveDate),
          createdBy: actor.id,
        },
      });
      if (r.schedule?.lines.length)
        await tx.scheduleInstalment.createMany({
          data: r.schedule.lines.map((l) => ({
            tenantId,
            loanAccountId: loanId,
            agreementVersion: newVersion,
            number: l.number,
            periodStart: fromLocalDate(l.periodStart),
            periodEnd: fromLocalDate(l.periodEnd),
            dueDate: fromLocalDate(l.dueDate),
            openingPrincipal: l.openingPrincipal,
            principalDue: l.principal,
            interestDue: l.interest,
            capitalizedInterest: l.capitalizedInterest,
            annualRate: l.annualRate,
          })),
        });
      const payment = engineCall(() =>
        lending.incomeContingentPayment(
          income,
          ic,
          PERIODS_PER_YEAR,
          state.config.pricing.rounding,
        ),
      );
      const event = await this.servicing.recordEvent(tx, state, {
        type: 'INCOME_ASSESSMENT',
        amount: D(payment.periodicPayment),
        businessDate,
        valueDate: businessDate,
        components: {
          assessment: a.id,
          declaredAnnualIncome: income,
          periodicPayment: payment.periodicPayment,
          effectiveDate: r.effectiveDate,
          agreementVersion: newVersion,
          supersededLineIds: r.replaced.map((l) => l.id),
          forgivenAtTermEnd: r.schedule ? forgivenOf(r.schedule) : '0',
        },
        idempotencyKey: `sys:income-assessment:${a.id}`,
        requestHash: 'system',
        actor,
        narrative: `Income reassessed: instalment ${payment.periodicPayment} ${state.account.currency} from ${r.effectiveDate}`,
        lines: [],
      });
      await this.servicing.casAccount(tx, state, 'ACTIVE', {
        instalmentAmount: payment.periodicPayment,
        ...(r.schedule?.lines.length
          ? { maturityDate: fromLocalDate(r.schedule.maturityDate) }
          : {}),
      });
      const res = await tx.incomeAssessment.updateMany({
        where: { id: a.id, tenantId, status: 'PENDING', version: a.version },
        data: {
          status: 'APPROVED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          comment: (body.comment ?? '').slice(0, 500),
          annualRepayment: payment.annualRepayment,
          periodicPayment: payment.periodicPayment,
          effectiveDate: fromLocalDate(r.effectiveDate),
          nextReviewDate: fromLocalDate(
            lending.addMonths(r.effectiveDate, ic.reassessmentMonths),
          ),
          agreementVersion: newVersion,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw concurrentModification('This assessment');
      await this.audit.write(
        {
          actor,
          action: 'loan.income_assessment.approve',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          decision,
          details: {
            assessment: a.id,
            approve: true,
            event: event.id,
            periodicPayment: payment.periodicPayment,
            effectiveDate: r.effectiveDate,
          },
          configVersions: {
            agreementVersion: newVersion,
            engine: lending.LENDING_ENGINE_VERSION,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return {
        assessment: assessmentView(
          (await tx.incomeAssessment.findFirst({
            where: { id: a.id, tenantId },
          }))!,
        ),
        effectiveDate: r.effectiveDate,
        payment,
        forgivenAtTermEnd: r.schedule ? forgivenOf(r.schedule) : '0',
      };
    });
  }

  /**
   * The rest of the term rebuilt at `income`: the lines that have not begun
   * are replaced; their principal (less interest they would capitalise) is
   * the opening balance of the new schedule.
   */
  private rebuild(state: LoanState, income: string, businessDate: string) {
    if (state.account.status !== 'ACTIVE')
      throw new ConflictException(`The loan is ${state.account.status}.`);
    const effectiveDate = engineCall(() =>
      lending.incomeContingentEffectiveDate(state.contract, businessDate),
    );
    if (!effectiveDate)
      throw new ConflictException(
        'The contract term has ended: there is no period left to reassess.',
      );
    const future = state.lines.filter(
      (l) =>
        l.number > 0 &&
        lending.compareDates(toLocalDate(l.periodStart)!, effectiveDate) >= 0,
    );
    if (future.some((l) => l.status !== 'DUE' || paidOn(l).gt(0)))
      throw new ConflictException(
        'An instalment after the effective date has already been paid; reassess from a later period.',
      );
    const openingBalance = future
      .reduce(
        (s, l) =>
          s
            .plus(D(l.principalDue))
            .minus(D(l.principalPaid))
            .minus(D(l.capitalizedInterest)),
        new lending.D(0),
      )
      .toString();
    const kept = state.lines.filter((l) => !future.includes(l));
    const capitalisedToDate = capitalised(kept).toString();
    const contract: lending.ScheduleInput = {
      ...state.contract,
      incomeContingent: {
        ...state.contract.incomeContingent!,
        declaredAnnualIncome: income,
      },
    };
    const maxNumber = Math.max(0, ...state.lines.map((l) => l.number));
    const schedule = D(openingBalance).gt(0)
      ? engineCall(() =>
          lending.incomeContingentSchedule(contract, {
            fromDate: effectiveDate,
            openingBalance,
            capitalisedToDate,
            firstNumber: maxNumber + 1,
          }),
        )
      : null;
    return {
      effectiveDate,
      replaced: future,
      openingBalance,
      capitalisedToDate,
      contract,
      schedule,
    };
  }

  // ── End of the term: forgiveness ──────────────────────────────────────────

  /**
   * At the start of end of day: for each income-contingent loan whose term
   * has ended, forgive the balance carried on its final line. Instalments
   * already due and unpaid are not forgiven — they stay owed and age as
   * arrears. Each loan is its own transaction.
   */
  private async forgiveAtTermEnd(
    tenantId: string,
    businessDate: string,
    actor: LendingActor,
    scope: Prisma.LoanAccountWhereInput,
  ) {
    const candidates = await this.prisma.loanAccount.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        incomeAssessments: { some: {} },
        maturityDate: { lte: fromLocalDate(businessDate) },
        ...scope,
      },
      select: { id: true },
    });
    for (const { id } of candidates) {
      try {
        await this.lp.tenantTx(tenantId, (tx) =>
          this.forgiveOne(tx, tenantId, id, businessDate, actor),
        );
      } catch (e) {
        // Tried again at the next end of day; the loan stays open meanwhile.
        this.logger.error(
          `Income-contingent forgiveness failed for loan ${id}: ${(e as Error).message}`,
        );
      }
    }
  }

  private async forgiveOne(
    tx: Tx,
    tenantId: string,
    loanId: string,
    businessDate: string,
    actor: LendingActor,
  ) {
    let state = await loadLoanState(tx, tenantId, loanId);
    if (state.account.status !== 'ACTIVE' || !state.config.incomeContingent)
      return;
    const termEnd = lending.incomeContingentTermEnd(state.contract);
    if (lending.compareDates(termEnd, businessDate) > 0) return;
    const line = state.lines.find(
      (l) =>
        l.status === 'DUE' && lending.isForgivenessLine(lineFields(l), termEnd),
    );
    if (!line) return;
    const amount = D(line.principalDue).minus(D(line.principalPaid));
    if (amount.lte(0)) return;
    state = await this.servicing.catchUp(
      tx,
      state,
      businessDate,
      businessDate,
      actor,
    );
    const acc = state.config.accounting;
    const event = await this.servicing.recordEvent(tx, state, {
      type: 'ICL_FORGIVENESS',
      amount,
      businessDate,
      valueDate: termEnd,
      components: {
        instalment: line.number,
        forgivenPrincipal: amount.toString(),
        termEnd,
      },
      idempotencyKey: `sys:icl-forgiveness:${loanId}`,
      requestHash: 'system',
      actor,
      narrative: `Balance of ${amount} ${state.account.currency} forgiven at the end of the income-contingent term (${termEnd})`,
      lines: [
        {
          accountCode: acc.principalForgivenessExpense,
          debit: amount.toString(),
        },
        { accountCode: acc.loansReceivable, credit: amount.toString() },
      ],
    });
    await tx.scheduleInstalment.update({
      where: { id: line.id },
      data: { principalDue: decStr(line.principalPaid), status: 'PAID' },
    });
    line.status = 'PAID';
    const a = state.account;
    const data: Prisma.LoanAccountUpdateManyMutationInput = {
      principalOutstanding: D(a.principalOutstanding).minus(amount).toString(),
      interestReceivable: decStr(a.interestReceivable),
      feesReceivable: decStr(a.feesReceivable),
      penaltyReceivable: decStr(a.penaltyReceivable),
      interestInSuspense: decStr(a.interestInSuspense),
      lastAccrualDate: a.lastAccrualDate,
    };
    await this.servicing.closeIfRepaid(tx, state, data, actor, businessDate);
    await this.servicing.casAccount(tx, state, 'ACTIVE', data);
    await this.audit.write(
      {
        actor,
        action: 'servicing.batch.run',
        resourceType: 'LoanAccount',
        resourceId: loanId,
        outcome: 'SUCCESS',
        details: {
          forgiveness: event.id,
          amount: amount.toString(),
          termEnd,
          closed: data.status === 'CLOSED',
        },
        businessDate: fromLocalDate(businessDate),
      },
      tx,
    );
  }

  private terms(state: LoanState) {
    const ic = state.config.incomeContingent;
    if (!ic)
      throw new BadRequestException({
        message: 'This loan is not an income-contingent loan.',
        code: 'NOT_INCOME_CONTINGENT',
      });
    return ic;
  }
}

function lineFields(l: Line) {
  return {
    periodStart: toLocalDate(l.periodStart)!,
    periodEnd: toLocalDate(l.periodEnd)!,
    dueDate: toLocalDate(l.dueDate)!,
    interest: decStr(l.interestDue),
    principal: decStr(l.principalDue),
  };
}

const paidOn = (l: Line) =>
  D(l.principalPaid)
    .plus(D(l.interestPaid))
    .plus(D(l.feePaid))
    .plus(D(l.penaltyPaid))
    .plus(D(l.taxPaid));

/** Interest capitalised (or scheduled to be) on these lines. */
function capitalised(lines: Line[]) {
  return lines.reduce(
    (s, l) => s.plus(D(l.capitalizedInterest)),
    new lending.D(0),
  );
}

function forgivenOf(s: lending.ScheduleResult): string {
  const last = s.lines[s.lines.length - 1];
  return last && last.kind === 'FINAL' && D(last.interest).isZero()
    ? last.principal
    : '0';
}

function assessmentView(a: AssessmentRow) {
  return {
    id: a.id,
    sequence: a.sequence,
    reason: a.reason,
    declaredAnnualIncome: decStr(a.declaredAnnualIncome),
    incomePeriod: a.incomePeriod,
    evidenceType: a.evidenceType,
    evidenceReference: a.evidenceReference,
    documentId: a.documentId,
    annualRepayment: decStr(a.annualRepayment),
    periodicPayment: decStr(a.periodicPayment),
    status: a.status,
    effectiveDate: toLocalDate(a.effectiveDate),
    nextReviewDate: toLocalDate(a.nextReviewDate),
    agreementVersion: a.agreementVersion,
    proposedBy: a.proposedBy,
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt,
    comment: a.comment,
    createdAt: a.createdAt,
  };
}
