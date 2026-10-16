/**
 * Floating rates: resolving a benchmark, projecting a timeline, and applying
 * a contractual reset to a booked loan.
 *
 * A floating product prices at `benchmark + margin`, bounded by an optional
 * floor and cap, and re-prices on a fixed cycle. Two things are deliberately
 * kept apart:
 *
 *  • **Projection** — what the schedule looks like today if the benchmark
 *    never moved. Every point after the first is marked `projected`, so a
 *    quote can never be mistaken for a contractual commitment.
 *  • **Reset** — what the contract actually does on a reset date, using the
 *    benchmark observed on or before it. A reset is a real re-pricing: it
 *    produces a new schedule and a new agreement version.
 *
 * **A reset takes effect at the start of the first interest period that
 * begins on or after the reset date.** Interest already accrued in a part
 * period is never re-priced, so a reset can neither change interest the
 * borrower has been billed nor create a mid-period split to reconcile.
 */
import { Dec, dec, EngineError, ZERO } from './decimal.js';
import { RoundingRule } from './money.js';
import { LocalDate, addMonths, compareDates, parseDate } from './dates.js';
import {
  RatePoint,
  ScheduleInput,
  ScheduleLine,
  amortize,
  contractContext,
  finalizeLines,
} from './schedule.js';
import type { RemainingLine } from './servicing.js';

export const RESET_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'] as const;
export type ResetFrequency = (typeof RESET_FREQUENCIES)[number];

export const RESET_MONTHS: Record<ResetFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

export interface FloatingTerms {
  benchmarkCode: string;
  /** Added to the benchmark, as a decimal fraction. */
  margin: string;
  resetFrequency: ResetFrequency;
  /** Lower bound on the all-in rate, or null. */
  floor: string | null;
  /** Upper bound on the all-in rate, or null. */
  cap: string | null;
}

export interface BenchmarkObservation {
  benchmarkCode: string;
  observationDate: LocalDate;
  /** The benchmark itself, before the margin. */
  rate: string;
}

export type RateBound = 'BENCHMARK' | 'FLOOR' | 'CAP';

export interface ResolvedRate {
  /** The all-in annual rate the contract charges. */
  annualRate: string;
  /** Which of benchmark, floor or cap decided it. */
  bound: RateBound;
  /** The uncapped benchmark + margin, for the audit trail. */
  indicated: string;
  observation: BenchmarkObservation;
  /** Operator-readable derivation. */
  source: string;
}

/**
 * benchmark + margin, held within the floor and cap.
 *
 * The unbounded figure is returned alongside the charged one: when a floor or
 * cap binds, the audit trail has to show what the benchmark would otherwise
 * have produced.
 */
export function resolveFloatingRate(terms: FloatingTerms, observation: BenchmarkObservation): ResolvedRate {
  if (observation.benchmarkCode !== terms.benchmarkCode) {
    throw new EngineError(
      'BENCHMARK_MISMATCH',
      `This loan prices off ${terms.benchmarkCode}, but the observation is for ${observation.benchmarkCode}.`,
    );
  }
  const benchmark = dec(observation.rate, 'observation.rate');
  const margin = dec(terms.margin, 'margin');
  const indicated = benchmark.plus(margin);
  let annualRate = indicated;
  let bound: RateBound = 'BENCHMARK';
  if (terms.floor !== null && annualRate.lt(dec(terms.floor, 'floor'))) {
    annualRate = dec(terms.floor, 'floor');
    bound = 'FLOOR';
  }
  if (terms.cap !== null && annualRate.gt(dec(terms.cap, 'cap'))) {
    annualRate = dec(terms.cap, 'cap');
    bound = 'CAP';
  }
  if (annualRate.lt(0)) {
    throw new EngineError('NEGATIVE_RATE', `${terms.benchmarkCode} ${observation.rate} + margin ${terms.margin} is negative; set a floor.`);
  }
  const boundNote = bound === 'BENCHMARK' ? '' : ` (${bound.toLowerCase()} ${annualRate.toString()} applied)`;
  return {
    annualRate: annualRate.toString(),
    bound,
    indicated: indicated.toString(),
    observation,
    source: `${terms.benchmarkCode} ${observation.observationDate} (${observation.rate}) + ${terms.margin}${boundNote}`,
  };
}

/**
 * Every reset date over the life of the loan.
 *
 * The first reset falls one cycle after drawdown — the opening rate is fixed
 * at disbursement and holds for the first period. A reset falling on or after
 * maturity is dropped: there is nothing left to re-price.
 */
export function resetSchedule(disbursementDate: LocalDate, maturityDate: LocalDate, frequency: ResetFrequency): LocalDate[] {
  parseDate(disbursementDate, 'disbursementDate');
  parseDate(maturityDate, 'maturityDate');
  if (compareDates(maturityDate, disbursementDate) <= 0) {
    throw new EngineError('INVALID_PERIOD', `Maturity ${maturityDate} is not after disbursement ${disbursementDate}.`);
  }
  const months = RESET_MONTHS[frequency];
  if (!months) throw new EngineError('INVALID_RESET_FREQUENCY', `Unknown reset frequency ${String(frequency)}.`);
  const dates: LocalDate[] = [];
  for (let i = 1; ; i++) {
    const date = addMonths(disbursementDate, months * i);
    if (compareDates(date, maturityDate) >= 0) break;
    dates.push(date);
    // A cycle shorter than a month cannot exist, so this always terminates;
    // the guard is against a corrupted frequency reaching production.
    if (i > 1200) throw new EngineError('TOO_MANY_RESETS', 'A loan cannot carry more than 1,200 resets.');
  }
  return dates;
}

/**
 * Resets that fell due on or before `asOf` and have not been applied.
 *
 * Returned oldest first: a loan whose resets were missed for three months is
 * caught up one reset at a time, each at the benchmark that applied then,
 * never by jumping straight to today's rate.
 */
export function dueResets(resetDates: LocalDate[], appliedDates: LocalDate[], asOf: LocalDate): LocalDate[] {
  const applied = new Set(appliedDates);
  return resetDates
    .filter((d) => !applied.has(d) && compareDates(d, asOf) <= 0)
    .sort(compareDates);
}

/**
 * A projected rate timeline: today's all-in rate held flat across every
 * future reset.
 *
 * The first point is the rate the loan is actually priced at; the rest carry
 * `projected: true`, because nobody knows where the benchmark will be. Giving
 * a point per reset date rather than a single flat point makes the projection
 * self-describing — the schedule shows where re-pricing would occur.
 */
export function projectRateTimeline(
  terms: FloatingTerms,
  resolved: ResolvedRate,
  disbursementDate: LocalDate,
  maturityDate: LocalDate,
): RatePoint[] {
  const first: RatePoint = {
    effectiveFrom: disbursementDate,
    annualRate: resolved.annualRate,
    source: resolved.source,
  };
  const projected = resetSchedule(disbursementDate, maturityDate, terms.resetFrequency).map((effectiveFrom) => ({
    effectiveFrom,
    annualRate: resolved.annualRate,
    source: `${resolved.source} held flat to ${effectiveFrom}`,
    projected: true,
  }));
  return [first, ...projected];
}

// ── Applying a reset to a booked loan ───────────────────────────────────────

export interface RateResetResult {
  /** The rebuilt tail of the schedule, from `effectiveFrom` onwards. */
  lines: ScheduleLine[];
  /** The new level instalment, or null for methods that have none. */
  instalmentAmount: string | null;
  /** The period start the new rate takes effect from. */
  effectiveFrom: LocalDate;
  previousAnnualRate: string;
  newAnnualRate: string;
  /** Lines left untouched because they start before the reset. */
  unchangedLines: number;
  explanation: string[];
}

/**
 * Re-price the unpaid tail of a schedule at a new rate.
 *
 * The reset lands on the first remaining period that starts on or after
 * `resetDate`; everything before it is already earned and is left alone. The
 * outstanding balance does not change — only the rate does — so the remaining
 * term is kept and the instalment is recomputed. That is what a floating-rate
 * contract promises: the same number of payments, re-priced.
 */
export function applyRateReset(
  contract: ScheduleInput,
  remaining: RemainingLine[],
  resetDate: LocalDate,
  newAnnualRate: string,
  source: string,
): RateResetResult {
  if (!remaining.length) {
    throw new EngineError('NOTHING_TO_REPRICE', 'No unpaid instalments remain, so there is nothing to re-price.');
  }
  if (contract.interestMethod === 'FLAT') {
    throw new EngineError('REPRICING_UNSUPPORTED', 'Flat-rate interest is fixed when the loan is written and cannot be re-priced.');
  }
  const rate = dec(newAnnualRate, 'newAnnualRate');
  if (rate.lt(0)) throw new EngineError('NEGATIVE_RATE', 'A contractual rate cannot be negative.');

  const index = remaining.findIndex((l) => compareDates(l.periodStart, resetDate) >= 0);
  if (index < 0) {
    throw new EngineError(
      'RESET_AFTER_SCHEDULE',
      `No remaining period starts on or after ${resetDate}; the loan matures before this reset takes effect.`,
    );
  }
  const tail = remaining.slice(index);
  const effectiveFrom = tail[0].periodStart;
  const opening = dec(tail[0].openingPrincipal, 'openingPrincipal');
  if (opening.lte(0)) {
    throw new EngineError('NOTHING_TO_REPRICE', `The balance on ${effectiveFrom} is zero; there is nothing to re-price.`);
  }

  const { ctx, rates, rounding } = contractContext(contract);
  const previous = rateAtOrThrow(rates, effectiveFrom);
  // The new point wins from the reset forward; earlier points stay, so the
  // timeline remains a full history of what this loan was priced at.
  const repriced: RatePoint[] = [
    ...rates.filter((p) => compareDates(p.effectiveFrom, effectiveFrom) < 0),
    { effectiveFrom, annualRate: rate.toString(), source },
  ];

  const balloon = contract.balloonAmount ? dec(contract.balloonAmount) : ZERO;
  const { lines: raw, instalment } = amortize({
    method: contract.method === 'EXPLICIT' ? 'EXPLICIT' : contract.method,
    interestMethod: 'REDUCING_BALANCE',
    currency: contract.currency,
    rounding: rounding as RoundingRule,
    periods: tail.map((l) => ({ start: l.periodStart, end: l.periodEnd, dueDate: l.dueDate })),
    rates: repriced,
    rateContext: ctx,
    opening,
    principalGrace: 0,
    interestGrace: 0,
    balloon: balloon.gte(opening) ? ZERO : balloon,
    // An explicitly dated plan keeps its principal amounts: re-pricing moves
    // the interest, never the agreed principal dates.
    explicitPrincipal: contract.method === 'EXPLICIT' ? tail.map((l) => dec(l.principal)) : undefined,
  });
  const lines = finalizeLines(raw, ctx, tail[0].number);

  const direction = rate.gt(dec(previous.annualRate)) ? 'rises' : rate.lt(dec(previous.annualRate)) ? 'falls' : 'is unchanged';
  return {
    lines,
    instalmentAmount: instalment ? instalment.toString() : null,
    effectiveFrom,
    previousAnnualRate: previous.annualRate,
    newAnnualRate: rate.toString(),
    unchangedLines: index,
    explanation: [
      `Rate ${direction} from ${previous.annualRate} to ${rate.toString()} (${source}).`,
      `Effective from ${effectiveFrom}, the first period starting on or after the reset date ${resetDate}.`,
      `${index} instalment(s) before the reset are unchanged; ${lines.length} re-priced on a balance of ${opening.toString()}.`,
      instalment
        ? `New instalment ${instalment.toString()} over the same ${lines.length} remaining payment(s).`
        : 'The principal plan is unchanged; only the interest is re-priced.',
    ],
  };
}

function rateAtOrThrow(rates: RatePoint[], date: LocalDate): RatePoint {
  let current: RatePoint | undefined;
  for (const point of rates) {
    if (compareDates(point.effectiveFrom, date) <= 0) current = point;
  }
  if (!current) throw new EngineError('MISSING_RATE', `No interest rate is effective on ${date}.`);
  return current;
}

/** Total interest across a set of lines, for comparing before and after. */
export function totalInterest(lines: { interest: string }[]): string {
  return lines.reduce((t: Dec, l) => t.plus(dec(l.interest, 'interest')), ZERO).toString();
}
