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
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { ServicingService } from '../servicing/servicing.service';
import {
  LoanState,
  engineLine,
  loadLoanState,
  resourceOf,
} from '../servicing/loan-state';

type Json = Prisma.InputJsonValue;
type ProgrammeRow = NonNullable<
  Awaited<ReturnType<Tx['paymentHolidayProgramme']['findFirst']>>
>;

/**
 * Payment holidays offered as a programme.
 *
 * A hardship restructure assesses one borrower's circumstances; a programme
 * is a published offer the lender must apply the same way to everyone who
 * qualifies. That is why eligibility here is evaluated from recorded loan
 * state — instalments paid, days past due, holidays already taken — and never
 * from a free-text justification, and why every refusal returns its reasons.
 *
 * The holiday itself is an ordinary restructure: it goes through the same
 * schedule engine, produces an `AgreementVersion`, and supersedes the
 * instalments it replaces, so nothing about accounting or audit is special.
 */
@Injectable()
export class PaymentHolidayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {}

  // ── Programmes ────────────────────────────────────────────────────────────

  async listProgrammes(actor: LendingActor, q: { status?: string } = {}) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'payment_holiday.read',
      tenantResource(tenantId),
    );
    const rows = await this.prisma.paymentHolidayProgramme.findMany({
      where: { tenantId, ...(q.status ? { status: q.status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(programmeView);
  }

  async createProgramme(
    actor: LendingActor,
    body: {
      code: string;
      name: string;
      maxInstalments: number;
      interestTreatment: lending.DeferredInterestTreatment;
      termTreatment: 'EXTEND_TERM' | 'KEEP_MATURITY';
      opensOn: string;
      closesOn: string;
      minInstalmentsPaid?: number;
      maxDaysPastDue?: number;
      minInstalmentsRemaining?: number;
      maxHolidaysPerLoan?: number;
      allowRestructured?: boolean;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'payment_holiday.manage',
        tenantResource(tenantId),
        tx,
      );
      if (lending.compareDates(body.closesOn, body.opensOn) < 0) {
        throw new BadRequestException(
          `The programme closes on ${body.closesOn}, before it opens on ${body.opensOn}.`,
        );
      }
      const row = await tx.paymentHolidayProgramme.create({
        data: {
          tenantId,
          code: body.code,
          name: body.name.slice(0, 120),
          status: 'DRAFT',
          maxInstalments: body.maxInstalments,
          interestTreatment: body.interestTreatment,
          termTreatment: body.termTreatment,
          opensOn: fromLocalDate(body.opensOn),
          closesOn: fromLocalDate(body.closesOn),
          minInstalmentsPaid: body.minInstalmentsPaid ?? 0,
          maxDaysPastDue: body.maxDaysPastDue ?? 30,
          minInstalmentsRemaining: body.minInstalmentsRemaining ?? 1,
          maxHolidaysPerLoan: body.maxHolidaysPerLoan ?? 1,
          allowRestructured: body.allowRestructured ?? false,
          createdBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'payment_holiday.manage',
          resourceType: 'PaymentHolidayProgramme',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { action: 'CREATE', code: row.code },
        },
        tx,
      );
      return programmeView(row);
    });
  }

  /**
   * Open or close a programme.
   *
   * A programme is opened by someone other than its author: publishing an
   * offer to a whole book is a decision with the same weight as approving a
   * product, so it carries the same maker-checker split.
   */
  async setProgrammeStatus(
    actor: LendingActor,
    id: string,
    body: { status: 'OPEN' | 'CLOSED' },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const programme = await this.loadProgramme(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'payment_holiday.approve',
        {
          ...tenantResource(tenantId),
          workflowState: programme.status,
          makerIds: [programme.createdBy],
        },
        tx,
      );
      if (programme.status === body.status) {
        throw new ConflictException(
          `This programme is already ${body.status.toLowerCase()}.`,
        );
      }
      if (programme.status === 'CLOSED') {
        throw new ConflictException(
          'A closed programme cannot be reopened; publish a new one.',
        );
      }
      const res = await tx.paymentHolidayProgramme.updateMany({
        where: { id, tenantId, version: programme.version },
        data: { status: body.status, version: { increment: 1 } },
      });
      if (res.count !== 1) throw concurrentModification('This programme');
      await this.audit.write(
        {
          actor,
          action: 'payment_holiday.approve',
          resourceType: 'PaymentHolidayProgramme',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            action: 'STATUS',
            status: body.status,
            code: programme.code,
          },
        },
        tx,
      );
      return { id, status: body.status };
    });
  }

  // ── Eligibility and enrolment ─────────────────────────────────────────────

  /** Whether this loan qualifies, and what the holiday would cost. */
  async checkEligibility(
    actor: LendingActor,
    programmeId: string,
    loanAccountId: string,
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const programme = await this.loadProgramme(tx, tenantId, programmeId);
      const state = await loadLoanState(tx, tenantId, loanAccountId, {
        lock: false,
      });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const asOf = await this.businessDate.get(tenantId, tx);
      const candidate = await this.candidate(tx, state, programmeId);
      const eligibility = engineCall(() =>
        lending.checkHolidayEligibility(
          engineProgramme(programme),
          candidate,
          asOf,
        ),
      );
      return {
        programme: programmeView(programme),
        candidate,
        ...eligibility,
        cost: lending.describeHolidayCost(
          programme.interestTreatment as lending.DeferredInterestTreatment,
          '0',
        ).summary,
      };
    });
  }

  /**
   * Grant a holiday.
   *
   * Eligibility is re-evaluated here against committed state, not trusted
   * from an earlier check, because a loan can fall past due between the offer
   * and the grant.
   */
  async enrol(
    actor: LendingActor,
    programmeId: string,
    loanAccountId: string,
    body: { instalments: number; effectiveDate?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const programme = await this.loadProgramme(tx, tenantId, programmeId);
      const state = await loadLoanState(tx, tenantId, loanAccountId);
      await this.policy.enforce(
        actor,
        'payment_holiday.grant',
        resourceOf(state),
        tx,
      );
      if (programme.status !== 'OPEN') {
        throw new ConflictException(
          `The ${programme.code} programme is ${programme.status.toLowerCase()}; it is not accepting enrolments.`,
        );
      }
      const businessDate = await this.businessDate.get(tenantId, tx);
      const candidate = await this.candidate(tx, state, programmeId);
      const eligibility = engineCall(() =>
        lending.checkHolidayEligibility(
          engineProgramme(programme),
          candidate,
          businessDate,
        ),
      );
      if (!eligibility.eligible) {
        throw new BadRequestException({
          message: eligibility.reasons.map((r) => r.message).join(' '),
          code: 'HOLIDAY_NOT_ELIGIBLE',
          reasons: eligibility.reasons,
        });
      }
      if (body.instalments > eligibility.maxInstalments) {
        throw new BadRequestException(
          `This loan qualifies for at most ${eligibility.maxInstalments} instalment(s).`,
        );
      }

      // The holiday starts at the next unpaid period, so interest already
      // earned is untouched — the same rule a rate reset follows.
      const remaining = state.lines
        .filter((l) => l.status === 'DUE' && l.number > 0)
        .map(engineLine);
      if (!remaining.length) {
        throw new ConflictException('This loan has no remaining instalments.');
      }
      const effectiveDate = body.effectiveDate ?? remaining[0].periodStart;
      const options = {
        ...engineCall(() =>
          lending.holidayRestructureOptions(
            engineProgramme(programme),
            body.instalments,
            effectiveDate,
            remaining.length,
          ),
        ),
        // A capitalizing holiday is grace capitalization: it follows the
        // product's basis, so a SIMPLE product never charges interest on
        // interest (TV-13, DECISIONS D-009).
        capitalizationBasis: state.config.pricing.capitalization.basis,
      };
      const snapshot = await this.snapshot(tx, state, effectiveDate);
      const calc = engineCall(() =>
        lending.calculateRestructure(state.contract, snapshot, options, {
          allowInterestCapitalization:
            state.config.restructuring.allowInterestCapitalization,
          allowFeeCapitalization:
            state.config.restructuring.allowFeeCapitalization,
          allowPenaltyCapitalization:
            state.config.restructuring.allowPenaltyCapitalization,
          maxTotalInstalments:
            state.config.limits.maxInstalments +
            state.config.restructuring.maxExtensionInstalments,
        }),
      );

      const agreementVersion = state.agreementVersion + 1;
      // Read from where the treatment actually keeps it: summing the
      // deferred lines gives zero, because the engine zeroes their interest.
      const deferredInterest = D(
        lending.holidayDeferredInterest(
          calc,
          programme.interestTreatment as lending.DeferredInterestTreatment,
          body.instalments,
        ),
      );
      const resumesOn =
        calc.lines[body.instalments]?.dueDate ??
        calc.lines[calc.lines.length - 1].dueDate;

      await tx.scheduleInstalment.updateMany({
        where: {
          tenantId,
          loanAccountId,
          status: 'DUE',
          number: { in: remaining.map((l) => l.number) },
        },
        data: { status: 'SUPERSEDED' },
      });
      await tx.scheduleInstalment.createMany({
        data: calc.lines.map((l) => ({
          tenantId,
          loanAccountId,
          agreementVersion,
          number: l.number,
          periodStart: fromLocalDate(l.periodStart),
          periodEnd: fromLocalDate(l.periodEnd),
          dueDate: fromLocalDate(l.dueDate),
          openingPrincipal: l.openingPrincipal,
          principalDue: l.principal,
          interestDue: l.interest,
          // Without it a capitalizing holiday never accrued or capitalized
          // the deferred interest, and the schedule's principal drifted
          // from the ledger's.
          capitalizedInterest: l.capitalizedInterest,
          // A deferral without capitalization: the holiday's interest is
          // earned over the holiday and collected on the later instalments
          // (D-QA-05) — never silently dropped.
          deferredAccrual: l.deferredAccrual,
          deferredInterestDue: l.deferred.interest,
          feeDue: l.deferred.fees,
          penaltyDue: l.deferred.penalties,
          taxDue: l.deferred.taxes,
          annualRate: l.annualRate,
          projected: false,
        })),
      });

      const previous = await tx.agreementVersion.findFirst({
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
          version: agreementVersion,
          reason: 'PAYMENT_HOLIDAY',
          productConfig: previous!.productConfig as Json,
          // The contract's policies carry forward unchanged.
          policies: (previous!.policies ?? undefined) as Json | undefined,
          configHash: previous!.configHash,
          terms: previous!.terms as Json,
          scheduleInput: previous!.scheduleInput as Json,
          calculation: {
            holiday: { programme: programme.code, ...calc },
          } as unknown as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          effectiveDate: fromLocalDate(effectiveDate),
          createdBy: actor.id,
        },
      });

      const enrolment = await tx.paymentHolidayEnrolment.create({
        data: {
          tenantId,
          programmeId,
          loanAccountId,
          borrowerId: state.account.borrowerId,
          instalments: body.instalments,
          effectiveDate: fromLocalDate(effectiveDate),
          resumesOn: fromLocalDate(resumesOn),
          deferredInterest: deferredInterest.toString(),
          interestTreatment: programme.interestTreatment,
          termTreatment: programme.termTreatment,
          agreementVersion,
          calculation: {
            lines: calc.lines,
            explanation: calc.explanation,
          } as unknown as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          grantedBy: actor.id,
        },
      });

      await this.servicing.casAccount(tx, state, state.account.status, {
        instalmentAmount: calc.schedule.instalmentAmount,
        maturityDate: fromLocalDate(calc.lines[calc.lines.length - 1].dueDate),
      });
      const cost = lending.describeHolidayCost(
        programme.interestTreatment as lending.DeferredInterestTreatment,
        deferredInterest.toString(),
      );
      await this.audit.write(
        {
          actor,
          action: 'payment_holiday.grant',
          resourceType: 'LoanAccount',
          resourceId: loanAccountId,
          outcome: 'SUCCESS',
          details: {
            programme: programme.code,
            instalments: body.instalments,
            effectiveDate,
            resumesOn,
            deferredInterest: deferredInterest.toString(),
            costsBorrower: cost.costsBorrower,
          },
          configVersions: {
            agreementVersion,
            engine: lending.LENDING_ENGINE_VERSION,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return { enrolment: enrolmentView(enrolment), cost, calculation: calc };
    });
  }

  /** Holidays granted on a loan. */
  async history(actor: LendingActor, loanAccountId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanAccountId, {
        lock: false,
      });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const rows = await tx.paymentHolidayEnrolment.findMany({
        where: { tenantId, loanAccountId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(enrolmentView);
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async loadProgramme(tx: Tx, tenantId: string, id: string) {
    const row = await tx.paymentHolidayProgramme.findFirst({
      where: { id, tenantId },
    });
    if (!row)
      throw new NotFoundException('Payment holiday programme not found');
    return row;
  }

  /** The loan as the eligibility rules see it, from recorded state only. */
  private async candidate(
    tx: Tx,
    state: LoanState,
    programmeId: string,
  ): Promise<lending.HolidayCandidate> {
    const tenantId = state.account.tenantId;
    const [paid, remaining, priorHolidays, running] = await Promise.all([
      tx.scheduleInstalment.count({
        where: {
          tenantId,
          loanAccountId: state.account.id,
          status: 'PAID',
          number: { gt: 0 },
        },
      }),
      tx.scheduleInstalment.count({
        where: {
          tenantId,
          loanAccountId: state.account.id,
          status: 'DUE',
          number: { gt: 0 },
        },
      }),
      tx.paymentHolidayEnrolment.count({
        where: { tenantId, loanAccountId: state.account.id, programmeId },
      }),
      tx.paymentHolidayEnrolment.findFirst({
        where: { tenantId, loanAccountId: state.account.id },
        orderBy: { resumesOn: 'desc' },
      }),
    ]);
    const businessDate = await this.businessDate.get(tenantId, tx);
    return {
      status: state.account.status,
      instalmentsPaid: paid,
      instalmentsRemaining: remaining,
      daysPastDue: state.account.daysPastDue,
      priorHolidays,
      isRestructured: state.account.isRestructured,
      holidayInProgress:
        !!running &&
        lending.compareDates(toLocalDate(running.resumesOn)!, businessDate) > 0,
    };
  }

  private async snapshot(
    tx: Tx,
    state: LoanState,
    asOf: string,
  ): Promise<lending.BalanceSnapshot> {
    const posted = await tx.accrualEvent.aggregate({
      where: {
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
      },
      _sum: { amount: true },
    });
    void posted;
    const overdue = state.lines.filter(
      (l) =>
        l.status === 'DUE' &&
        lending.compareDates(toLocalDate(l.dueDate)!, asOf) <= 0,
    );
    const sumOf = (pick: (l: (typeof overdue)[number]) => unknown) =>
      overdue.reduce((t, l) => t.plus(D(pick(l) as string)), D('0'));
    return {
      asOf,
      currency: state.account.currency,
      principal: decStr(state.account.principalOutstanding),
      overduePrincipal: sumOf((l) => l.principalDue)
        .minus(sumOf((l) => l.principalPaid))
        .toString(),
      overdueInterest: sumOf((l) => l.interestDue)
        .minus(sumOf((l) => l.interestPaid))
        .toString(),
      accruedInterestNotDue: '0',
      fees: decStr(state.account.feesReceivable),
      penalties: decStr(state.account.penaltyReceivable),
      taxes: '0',
      unallocatedPayments: '0',
    };
  }
}

function engineProgramme(p: ProgrammeRow): lending.HolidayProgramme {
  return {
    code: p.code,
    name: p.name,
    maxInstalments: p.maxInstalments,
    interestTreatment: p.interestTreatment as lending.DeferredInterestTreatment,
    termTreatment: p.termTreatment as 'EXTEND_TERM' | 'KEEP_MATURITY',
    opensOn: toLocalDate(p.opensOn)!,
    closesOn: toLocalDate(p.closesOn)!,
    minInstalmentsPaid: p.minInstalmentsPaid,
    maxDaysPastDue: p.maxDaysPastDue,
    minInstalmentsRemaining: p.minInstalmentsRemaining,
    maxHolidaysPerLoan: p.maxHolidaysPerLoan,
    allowRestructured: p.allowRestructured,
  };
}

function programmeView(p: ProgrammeRow) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    maxInstalments: p.maxInstalments,
    interestTreatment: p.interestTreatment,
    termTreatment: p.termTreatment,
    opensOn: toLocalDate(p.opensOn),
    closesOn: toLocalDate(p.closesOn),
    minInstalmentsPaid: p.minInstalmentsPaid,
    maxDaysPastDue: p.maxDaysPastDue,
    minInstalmentsRemaining: p.minInstalmentsRemaining,
    maxHolidaysPerLoan: p.maxHolidaysPerLoan,
    allowRestructured: p.allowRestructured,
  };
}

function enrolmentView(e: {
  id: string;
  programmeId: string;
  loanAccountId: string;
  instalments: number;
  effectiveDate: Date;
  resumesOn: Date;
  deferredInterest: unknown;
  interestTreatment: string;
  termTreatment: string;
  agreementVersion: number;
}) {
  return {
    id: e.id,
    programmeId: e.programmeId,
    loanAccountId: e.loanAccountId,
    instalments: e.instalments,
    effectiveDate: toLocalDate(e.effectiveDate),
    resumesOn: toLocalDate(e.resumesOn),
    deferredInterest: decStr(e.deferredInterest as string),
    interestTreatment: e.interestTreatment,
    termTreatment: e.termTreatment,
    agreementVersion: e.agreementVersion,
  };
}
