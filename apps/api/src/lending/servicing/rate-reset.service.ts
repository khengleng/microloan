import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  LendingActor,
  decStr,
  engineCall,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { ServicingService } from './servicing.service';
import { LoanState, engineLine, loadLoanState, resourceOf } from './loan-state';

type Json = Prisma.InputJsonValue;

/**
 * Contractual floating-rate resets on booked loans.
 *
 * A floating loan is priced at `benchmark + margin` and re-prices on a fixed
 * cycle. On each reset date the benchmark observed on or before that date is
 * read, bounded by the product's floor and cap, and the unpaid tail of the
 * schedule is rebuilt at the new rate as a new `AgreementVersion`.
 *
 * Invariants:
 *  • a reset date re-prices a loan exactly once — enforced by a unique index
 *    on `(loanAccountId, resetDate)`, so a batch re-run or two concurrent
 *    callers cannot double-apply it;
 *  • missed resets are caught up oldest first, each at the benchmark that
 *    applied then, never by jumping the loan to today's rate;
 *  • the reset takes effect from the first period starting on or after the
 *    reset date, so interest already earned is never re-priced;
 *  • nothing is posted: a reset moves no money. It changes what future
 *    interest will be, and accrual follows the new schedule from there.
 */
@Injectable()
export class RateResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {
    // Resets are a daily contractual event, so they belong in the end-of-day
    // batch rather than waiting for someone to remember to run them.
    this.servicing.registerBatchHook(async (tx, state, businessDate, actor) => {
      if (!this.isFloating(state)) return;
      const applied = await this.catchUpResets(tx, state, businessDate, actor);
      if (!applied.length) return;
      // Each reset compare-and-sets the account. The batch writes this same
      // state afterwards, so carry the new version (and the re-priced
      // instalment) across, or its write fails and rolls the reset back.
      const latest = await tx.loanAccount.findFirstOrThrow({
        where: { id: state.account.id, tenantId: state.account.tenantId },
        select: { version: true, instalmentAmount: true },
      });
      state.account.version = latest.version;
      state.account.instalmentAmount = latest.instalmentAmount;
    });
  }

  private isFloating(state: LoanState): boolean {
    return (
      state.config.attributes.rateType === 'FLOATING' &&
      !!state.config.pricing.floating
    );
  }

  private floatingTerms(state: LoanState): lending.FloatingTerms {
    const fl = state.config.pricing.floating!;
    return {
      benchmarkCode: fl.benchmarkCode,
      margin: fl.margin,
      resetFrequency: fl.resetFrequency,
      floor: fl.floor,
      cap: fl.cap,
    };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** The reset history and what is still due, without changing anything. */
  async history(actor: LendingActor, loanAccountId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanAccountId, {
        lock: false,
      });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      if (!this.isFloating(state)) {
        return { floating: false, resets: [], due: [], schedule: [] };
      }
      const asOf = await this.businessDate.get(tenantId, tx);
      const applied = await tx.rateReset.findMany({
        where: { tenantId, loanAccountId },
        orderBy: { resetDate: 'asc' },
      });
      const { resetDates } = this.plan(state);
      return {
        floating: true,
        terms: this.floatingTerms(state),
        schedule: resetDates,
        resets: applied.map(resetView),
        due: lending.dueResets(
          resetDates,
          applied.map((r) => toLocalDate(r.resetDate)!),
          asOf,
        ),
      };
    });
  }

  /** Every reset date over the life of this loan. */
  private plan(state: LoanState): { resetDates: string[] } {
    const disbursement = state.contract.disbursementDate;
    const maturity =
      toLocalDate(state.account.maturityDate) ??
      state.lines[state.lines.length - 1]?.dueDate;
    if (!maturity) {
      throw new ConflictException(
        'This loan has no maturity date, so its reset dates cannot be derived.',
      );
    }
    return {
      resetDates: engineCall(() =>
        lending.resetSchedule(
          disbursement,
          typeof maturity === 'string' ? maturity : toLocalDate(maturity)!,
          this.floatingTerms(state).resetFrequency,
        ),
      ),
    };
  }

  // ── Applying ──────────────────────────────────────────────────────────────

  /** Apply every reset that has fallen due on this loan, oldest first. */
  async applyDue(actor: LendingActor, loanAccountId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanAccountId);
      await this.policy.enforce(
        actor,
        'loan.rate_reset.apply',
        resourceOf(state),
        tx,
      );
      if (!this.isFloating(state)) {
        throw new BadRequestException(
          'This loan is priced at a fixed rate; there is nothing to reset.',
        );
      }
      const businessDate = await this.businessDate.get(tenantId, tx);
      const applied = await this.catchUpResets(tx, state, businessDate, actor);
      if (!applied.length) {
        return {
          applied: [],
          message: 'No reset has fallen due on this loan.',
        };
      }
      return { applied };
    });
  }

  /**
   * Apply all outstanding resets up to `asOf`, oldest first.
   *
   * Shared by the batch hook and the explicit endpoint, so a reset behaves
   * identically however it is triggered. Returns what it actually applied.
   */
  async catchUpResets(
    tx: Tx,
    state: LoanState,
    asOf: string,
    actor: LendingActor,
  ): Promise<Record<string, unknown>[]> {
    const tenantId = state.account.tenantId;
    const loanAccountId = state.account.id;
    const alreadyApplied = await tx.rateReset.findMany({
      where: { tenantId, loanAccountId },
      select: { resetDate: true },
    });
    const { resetDates } = this.plan(state);
    const due = lending.dueResets(
      resetDates,
      alreadyApplied.map((r) => toLocalDate(r.resetDate)!),
      asOf,
    );

    const results: Record<string, unknown>[] = [];
    let current = state;
    for (const resetDate of due) {
      const outcome = await this.applyOne(tx, current, resetDate, actor);
      if (!outcome) break; // nothing left to re-price; later resets are moot
      results.push(outcome.summary);
      current = outcome.state;
    }
    return results;
  }

  /**
   * Apply one reset. Returns null when the loan has nothing left to re-price,
   * which ends the catch-up rather than failing it.
   */
  private async applyOne(
    tx: Tx,
    state: LoanState,
    resetDate: string,
    actor: LendingActor,
  ): Promise<{ summary: Record<string, unknown>; state: LoanState } | null> {
    const tenantId = state.account.tenantId;
    const terms = this.floatingTerms(state);
    const observation = await tx.rateObservation.findFirst({
      where: {
        tenantId,
        benchmarkCode: terms.benchmarkCode,
        observationDate: { lte: fromLocalDate(resetDate) },
      },
      orderBy: { observationDate: 'desc' },
    });
    if (!observation) {
      // Re-pricing off a stale or absent benchmark would invent a rate the
      // contract never agreed to, so the reset waits for the observation.
      throw new ConflictException({
        message: `No ${terms.benchmarkCode} observation on or before ${resetDate}; record the benchmark before re-pricing.`,
        code: 'BENCHMARK_MISSING',
        resetDate,
      });
    }
    const resolved = engineCall(() =>
      lending.resolveFloatingRate(terms, {
        benchmarkCode: observation.benchmarkCode,
        observationDate: toLocalDate(observation.observationDate)!,
        rate: decStr(observation.rate),
      }),
    );

    // Only unpaid lines are re-priced; a line already settled keeps its terms.
    const remaining = state.lines
      .filter((l) => l.status === 'DUE' && l.number > 0)
      .map(engineLine);
    if (!remaining.length) return null;
    if (
      lending.compareDates(
        remaining[remaining.length - 1].periodEnd,
        resetDate,
      ) <= 0
    ) {
      return null;
    }

    const result = engineCall(() =>
      lending.applyRateReset(
        state.contract,
        remaining,
        resetDate,
        resolved.annualRate,
        resolved.source,
      ),
    );

    const agreementVersion = state.agreementVersion + 1;
    const effectiveFrom = result.effectiveFrom;
    const repricedNumbers = new Set(result.lines.map((l) => l.number));
    const superseded = state.lines.filter(
      (l) => l.status === 'DUE' && repricedNumbers.has(l.number),
    );
    await tx.scheduleInstalment.updateMany({
      where: {
        tenantId,
        loanAccountId: state.account.id,
        id: { in: superseded.map((l) => l.id) },
        status: 'DUE',
      },
      data: { status: 'SUPERSEDED' },
    });
    await tx.scheduleInstalment.createMany({
      data: result.lines.map((l) => ({
        tenantId,
        loanAccountId: state.account.id,
        agreementVersion,
        number: l.number,
        periodStart: fromLocalDate(l.periodStart),
        periodEnd: fromLocalDate(l.periodEnd),
        dueDate: fromLocalDate(l.dueDate),
        openingPrincipal: l.openingPrincipal,
        principalDue: l.principal,
        interestDue: l.interest,
        annualRate: l.annualRate,
        projected: false,
        // Amounts already paid on a superseded line carry over: a reset does
        // not un-pay anything the borrower has settled.
        ...carriedPayments(superseded.find((s) => s.number === l.number)),
      })),
    });

    const previousVersion = await tx.agreementVersion.findFirst({
      where: {
        tenantId,
        agreementId: state.account.agreementId,
        version: state.agreementVersion,
      },
    });
    const contract = {
      ...state.contract,
      annualRate: undefined,
      rates: [
        ...(state.contract.rates ?? [
          {
            effectiveFrom: state.contract.disbursementDate,
            annualRate: state.contract.annualRate!,
            source: 'CONTRACT_OPENING',
          },
        ]),
        {
          effectiveFrom,
          annualRate: resolved.annualRate,
          source: resolved.source,
        },
      ],
    };
    await tx.agreementVersion.create({
      data: {
        tenantId,
        agreementId: state.account.agreementId,
        version: agreementVersion,
        reason: 'RATE_RESET',
        productConfig: previousVersion!.productConfig as Json,
        configHash: previousVersion!.configHash,
        terms: previousVersion!.terms as Json,
        scheduleInput: contract as unknown as Json,
        calculation: {
          reset: { resetDate, ...result },
          rate: resolved,
        } as unknown as Json,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        effectiveDate: fromLocalDate(effectiveFrom),
        createdBy: actor.id,
      },
    });

    const row = await tx.rateReset.create({
      data: {
        tenantId,
        loanAccountId: state.account.id,
        agreementId: state.account.agreementId,
        resetDate: fromLocalDate(resetDate),
        effectiveFrom: fromLocalDate(effectiveFrom),
        benchmarkCode: terms.benchmarkCode,
        observationDate: resolved.observation.observationDate
          ? fromLocalDate(resolved.observation.observationDate)
          : fromLocalDate(resetDate),
        observedRate: resolved.observation.rate,
        margin: terms.margin,
        indicatedRate: resolved.indicated,
        bound: resolved.bound,
        previousAnnualRate: result.previousAnnualRate,
        newAnnualRate: result.newAnnualRate,
        agreementVersion,
        instalmentAmount: result.instalmentAmount,
        calculation: {
          lines: result.lines,
          explanation: result.explanation,
        } as unknown as Json,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        appliedBy: actor.id,
      },
    });

    await this.servicing.casAccount(tx, state, state.account.status, {
      instalmentAmount: result.instalmentAmount,
    });
    await this.audit.write(
      {
        actor,
        action: 'loan.rate_reset.apply',
        resourceType: 'LoanAccount',
        resourceId: state.account.id,
        outcome: 'SUCCESS',
        details: {
          loan: state.account.reference,
          resetDate,
          effectiveFrom,
          from: result.previousAnnualRate,
          to: result.newAnnualRate,
          bound: resolved.bound,
          benchmark: resolved.source,
        },
        configVersions: {
          agreementVersion,
          engine: lending.LENDING_ENGINE_VERSION,
        },
        businessDate: fromLocalDate(resetDate),
      },
      tx,
    );

    // Re-read so a following reset in the same catch-up sees committed state.
    const next = await loadLoanState(tx, tenantId, state.account.id, {
      lock: false,
    });
    return {
      summary: { ...resetView(row), explanation: result.explanation },
      state: next,
    };
  }
}

/** Payments already made on a line survive its re-pricing. */
function carriedPayments(prior?: {
  principalPaid: unknown;
  interestPaid: unknown;
  feeDue: unknown;
  feePaid: unknown;
  taxDue: unknown;
  taxPaid: unknown;
  penaltyDue: unknown;
  penaltyPaid: unknown;
}) {
  if (!prior) return {};
  return {
    principalPaid: decStr(prior.principalPaid as string),
    interestPaid: decStr(prior.interestPaid as string),
    feeDue: decStr(prior.feeDue as string),
    feePaid: decStr(prior.feePaid as string),
    taxDue: decStr(prior.taxDue as string),
    taxPaid: decStr(prior.taxPaid as string),
    penaltyDue: decStr(prior.penaltyDue as string),
    penaltyPaid: decStr(prior.penaltyPaid as string),
  };
}

function resetView(r: {
  id: string;
  resetDate: Date;
  effectiveFrom: Date;
  observationDate: Date;
  benchmarkCode: string;
  observedRate: unknown;
  margin: unknown;
  indicatedRate: unknown;
  bound: string;
  previousAnnualRate: unknown;
  newAnnualRate: unknown;
  agreementVersion: number;
  instalmentAmount: unknown;
}) {
  return {
    id: r.id,
    resetDate: toLocalDate(r.resetDate),
    effectiveFrom: toLocalDate(r.effectiveFrom),
    observationDate: toLocalDate(r.observationDate),
    benchmarkCode: r.benchmarkCode,
    observedRate: decStr(r.observedRate as string),
    margin: decStr(r.margin as string),
    indicatedRate: decStr(r.indicatedRate as string),
    bound: r.bound,
    previousAnnualRate: decStr(r.previousAnnualRate as string),
    newAnnualRate: decStr(r.newAnnualRate as string),
    agreementVersion: r.agreementVersion,
    instalmentAmount:
      r.instalmentAmount === null ? null : decStr(r.instalmentAmount as string),
  };
}
