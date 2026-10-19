import { D, Dec, dec, EngineError, ZERO } from './decimal.js';
import { LocalDate, daysBetween } from './dates.js';
import { effectiveAnnualRate, periodicRateFromPayments } from './apr.js';
import { buildPeriods, generateSchedule, type ScheduleInput, type ScheduleResult } from './schedule.js';
import { computeUpfrontFees, type UpfrontFeeResult } from './fees.js';
import { feesOf, toScheduleInput, type NegotiatedTerms, type ProductConfig } from './config.js';
import type { TenantLendingSettings } from './tenant-settings.js';

/**
 * The interest-rate cap (NBC Prakas B7-017-109 for Cambodian MFIs: a ceiling
 * on the annual interest rate, restructured and refinanced loans included).
 *
 * Nothing here knows the number. The cap in force is the lowest of up to
 * three configured values — the deployment's regulatory ceiling
 * (REGULATORY_MAX_ANNUAL_RATE_PCT), the lender's own cap (Tenant
 * .maxAnnualInterestRatePct) and the product's `pricing.regulatoryCapAnnualRate`
 * — and the API passes them in.
 *
 * Every rate is compared on one basis: a nominal annual rate on a reducing
 * balance (DECISIONS D-105). A reducing-balance contract rate is that already;
 * a flat rate is converted to the reducing-balance rate its actual schedule
 * charges (the IRR of the instalments, annualised on the payment frequency);
 * the effective rate including fees is the same IRR measured on the cash the
 * borrower actually receives (D-107).
 */

export type RateCapSource = 'REGULATOR' | 'TENANT' | 'PRODUCT';

/** How each cap is named in a refusal, so the reader knows which one bit. */
export const RATE_CAP_SOURCE_LABELS: Record<RateCapSource, string> = {
  REGULATOR: 'the regulatory ceiling (REGULATORY_MAX_ANNUAL_RATE_PCT)',
  TENANT: "the lender's interest-rate cap",
  PRODUCT: "the product's regulatory rate cap",
};

export interface RateCapCandidates {
  /** Deployment ceiling, decimal fraction (0.18 = 18%). */
  regulatorCeiling?: string | null;
  /** The lender's cap, decimal fraction. */
  tenantCap?: string | null;
  /** The product version's `pricing.regulatoryCapAnnualRate`. */
  productCap?: string | null;
}

export interface ResolvedRateCap {
  /** The cap in force (decimal fraction), or null when none is configured. */
  annualRate: string | null;
  /** Which configured cap is the binding one (the regulator's when several are equal). */
  source: RateCapSource | null;
  /** e.g. "the regulatory ceiling (REGULATORY_MAX_ANNUAL_RATE_PCT) of 18.00%". */
  description: string;
  candidates: { source: RateCapSource; annualRate: string }[];
}

/** How the cap treats fees and penalty interest — tenant lending settings `rateCap` (D-108, D-109). */
export interface RateCapPolicy {
  includeFeesInEffectiveRate: boolean;
  penaltyRateMustFitCap: boolean;
}

export function rateCapPolicyOf(settings: Pick<TenantLendingSettings, 'rateCap'>): RateCapPolicy {
  return { ...settings.rateCap };
}

/** A rate as a percentage with two decimals, for messages. */
export function formatRatePct(rate: string | Dec): string {
  return `${dec(rate).times(100).toDecimalPlaces(2).toFixed(2)}%`;
}

/** A percent figure (18 = 18%) as a decimal fraction string; null for an absent or non-positive value. */
export function pctToFraction(pct: string | number | null | undefined): string | null {
  if (pct === null || pct === undefined || pct === '') return null;
  const v = new D(String(pct));
  if (!v.isFinite() || v.lte(0)) return null;
  return v.div(100).toString();
}

/**
 * The cap in force: the lowest configured candidate. Ties name the regulator
 * first, then the lender, then the product — the most authoritative source.
 */
export function resolveRateCap(c: RateCapCandidates): ResolvedRateCap {
  const order: [RateCapSource, string | null | undefined][] = [
    ['REGULATOR', c.regulatorCeiling],
    ['TENANT', c.tenantCap],
    ['PRODUCT', c.productCap],
  ];
  const candidates = order
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && dec(v).gt(0))
    .map(([source, v]) => ({ source, annualRate: dec(v!).toString() }));
  if (!candidates.length) return { annualRate: null, source: null, description: 'no interest-rate cap', candidates };
  let best = candidates[0];
  for (const cand of candidates.slice(1)) if (dec(cand.annualRate).lt(dec(best.annualRate))) best = cand;
  return {
    annualRate: best.annualRate,
    source: best.source,
    description: `${RATE_CAP_SOURCE_LABELS[best.source]} of ${formatRatePct(best.annualRate)}`,
    candidates,
  };
}

export type RateCapCheckCode =
  | 'CONTRACT_RATE'
  | 'FLAT_EQUIVALENT_RATE'
  | 'EFFECTIVE_RATE'
  | 'PROMOTION_RATE'
  | 'FLOATING_CAP'
  | 'FLOATING_FLOOR'
  | 'FLOATING_RATE'
  | 'PENALTY_RATE'
  | 'OVERLIMIT_RATE'
  | 'CARD_CASH_ADVANCE_RATE'
  | 'CARD_PLAN_RATE'
  | 'RESTRUCTURE_RATE'
  | 'TEMPORARY_RATE';

export interface RateCapFinding {
  code: RateCapCheckCode;
  /** Where the offending rate lives (a config path or a terms field). */
  path: string;
  /** The rate compared, decimal fraction. */
  rate: string;
  cap: string;
  capSource: RateCapSource;
  message: string;
}

/**
 * Computed rates (IRRs) are compared at 0.01% precision so that instalment
 * rounding alone cannot tip a loan priced exactly at the cap over it (D-106).
 * Configured and negotiated rates are compared exactly.
 */
export const COMPUTED_RATE_COMPARISON_DP = 4;

function over(rate: string, cap: ResolvedRateCap, computed: boolean): boolean {
  if (cap.annualRate === null) return false;
  const r = computed ? dec(rate).toDecimalPlaces(COMPUTED_RATE_COMPARISON_DP, D.ROUND_HALF_UP) : dec(rate);
  return r.gt(dec(cap.annualRate));
}

/**
 * One rate against the cap; null when it fits. `what` names the rate and
 * begins the message: "The penalty interest rate (24.00%) exceeds the
 * regulatory ceiling (REGULATORY_MAX_ANNUAL_RATE_PCT) of 18.00%."
 */
export function checkRateAgainstCap(
  code: RateCapCheckCode,
  path: string,
  what: string,
  rate: string,
  cap: ResolvedRateCap,
  computed = false,
): RateCapFinding | null {
  if (!over(rate, cap, computed)) return null;
  return {
    code,
    path,
    rate: dec(rate).toString(),
    cap: cap.annualRate!,
    capSource: cap.source!,
    message: `${what} (${formatRatePct(rate)}${computed ? ', computed' : ''}) exceeds ${cap.description}.`,
  };
}

// ── Schedule rates ──────────────────────────────────────────────────────────

/**
 * The nominal annual reducing-balance rate a schedule charges on
 * `amountFinanced`: the periodic IRR of the instalments annualised on the
 * payment frequency. A schedule on regular periods uses the engine's
 * equal-period IRR (periodicRateFromPayments); one on irregular dates uses
 * the dated IRR (effectiveAnnualRate) converted to a nominal rate compounded
 * as often as the schedule actually pays.
 */
export function scheduleEquivalentRate(
  amountFinanced: string,
  lines: { dueDate: LocalDate; total: string }[],
  disbursementDate: LocalDate,
  periods: { regular: boolean; periodsPerYear: string | null },
): string {
  if (!lines.length) throw new EngineError('RATE_CAP_INPUT', 'A schedule with at least one instalment is needed.');
  if (dec(amountFinanced).lte(0)) throw new EngineError('RATE_CAP_INPUT', 'The amount the borrower receives must be positive.');
  if (periods.regular && periods.periodsPerYear) {
    return periodicRateFromPayments(amountFinanced, lines.map((l) => l.total), periods.periodsPerYear).nominalAnnualRate;
  }
  const ear = dec(
    effectiveAnnualRate([
      { date: disbursementDate, amount: amountFinanced },
      ...lines.map((l) => ({ date: l.dueDate, amount: dec(l.total).negated().toString() })),
    ]),
  );
  const span = Math.max(1, daysBetween(disbursementDate, lines[lines.length - 1].dueDate));
  const m = new D(365).times(lines.length).div(span);
  return m.times(ear.plus(1).pow(new D(1).div(m)).minus(1)).toDecimalPlaces(8).toString();
}

export interface ScheduleRates {
  /** Highest contractual annual rate anywhere in the rate timeline. */
  contractRate: string;
  /** The rate compared with the cap: the contract rate, or a flat rate's reducing-balance equivalent. */
  comparableRate: string;
  basis: 'CONTRACT' | 'FLAT_EQUIVALENT';
  /** Reducing-balance equivalent on the cash the borrower receives, upfront fees included. */
  effectiveRate: string;
}

function periodsOf(input: ScheduleInput): { regular: boolean; periodsPerYear: string | null } {
  const built = buildPeriods(input);
  return { regular: built.regular, periodsPerYear: built.ppy ? built.ppy.toString() : null };
}

/** The rates a booked (or about to be booked) schedule charges, on the cap's basis. */
export function scheduleRates(input: ScheduleInput, schedule: Pick<ScheduleResult, 'lines'>, fees: UpfrontFeeResult | null): ScheduleRates {
  const timeline = input.rates?.length ? input.rates.map((r) => r.annualRate) : [input.annualRate ?? '0'];
  const contractRate = timeline.reduce((m, r) => (dec(r).gt(dec(m)) ? r : m), timeline[0]);
  const periods = periodsOf(input);
  const flat = input.interestMethod === 'FLAT';
  const comparableRate = flat ? scheduleEquivalentRate(input.principal, schedule.lines, input.disbursementDate, periods) : dec(contractRate).toString();
  const charged = fees ? dec(fees.financed).plus(fees.deducted).plus(fees.separate) : ZERO;
  // What the fees add: the IRR on the cash received less the IRR on the
  // principal booked, over the same instalments. Measuring the difference
  // cancels the schedule's own interest rounding, so a loan without fees is
  // exactly its contract rate and one with fees is that rate plus their cost.
  let effectiveRate = comparableRate;
  // Income-contingent instalments follow declared income, not the principal
  // (they may never repay it), so they have no IRR to measure fees by.
  if (charged.gt(0) && !input.incomeContingent) {
    const withFees = scheduleEquivalentRate(dec(fees!.netDisbursement).minus(fees!.separate).toString(), schedule.lines, input.disbursementDate, periods);
    const gross = flat ? comparableRate : scheduleEquivalentRate(input.principal, schedule.lines, input.disbursementDate, periods);
    effectiveRate = dec(comparableRate).plus(dec(withFees).minus(dec(gross))).toDecimalPlaces(8).toString();
  }
  return { contractRate: dec(contractRate).toString(), comparableRate, basis: flat ? 'FLAT_EQUIVALENT' : 'CONTRACT', effectiveRate };
}

/** A schedule's rates against the cap. */
export function checkScheduleRates(rates: ScheduleRates, cap: ResolvedRateCap, policy: RateCapPolicy, label = 'The annual interest rate'): RateCapFinding[] {
  const out: (RateCapFinding | null)[] = [
    rates.basis === 'FLAT_EQUIVALENT'
      ? checkRateAgainstCap('FLAT_EQUIVALENT_RATE', 'annualRate', `The reducing-balance equivalent of the flat rate ${formatRatePct(rates.contractRate)}`, rates.comparableRate, cap, true)
      : checkRateAgainstCap('CONTRACT_RATE', 'annualRate', `${label}`, rates.comparableRate, cap),
  ];
  if (policy.includeFeesInEffectiveRate && rates.effectiveRate !== rates.comparableRate)
    out.push(checkRateAgainstCap('EFFECTIVE_RATE', 'fees', 'The effective annual rate including fees', rates.effectiveRate, cap, true));
  return out.filter((f): f is RateCapFinding => !!f);
}

// ── Product version ─────────────────────────────────────────────────────────

export interface ProductRateCapReport {
  cap: ResolvedRateCap;
  policy: RateCapPolicy;
  /** Highest comparable contractual rate over the representative terms (null when none could be priced). */
  worstComparableRate: string | null;
  /** Highest effective rate including fees over the representative terms. */
  worstEffectiveRate: string | null;
  /** Configured rates above the cap: the version cannot be submitted, approved or activated. */
  findings: RateCapFinding[];
  /**
   * Terms within the product's limits whose effective rate including fees
   * would exceed the cap. Not a rate bound, so not blocking here: booking
   * refuses such terms (D-110).
   */
  advisories: RateCapFinding[];
  /** What could not be checked here and is left to booking. */
  notes: string[];
}

/** The rate a floating product would charge, bounded by its own floor and cap; null without a benchmark. */
function floatingRateOf(c: ProductConfig, benchmarkRate: string | null | undefined): string | null {
  const fl = c.pricing.floating;
  if (!fl) return null;
  if (benchmarkRate === null || benchmarkRate === undefined) return fl.cap;
  let r = dec(benchmarkRate).plus(dec(fl.margin));
  if (fl.floor && r.lt(dec(fl.floor))) r = dec(fl.floor);
  if (fl.cap && r.gt(dec(fl.cap))) r = dec(fl.cap);
  return r.toString();
}

/**
 * Every rate a product version can charge, against the cap (D-110).
 *
 * Configured rates — the fixed maximum, the promotional rate, a floating
 * product's own cap and its current benchmark + margin, card cash-advance and
 * instalment-plan rates, the over-limit rate and (when the policy says so)
 * penalty interest — are compared directly. A flat rate and the effective rate
 * including fees depend on the terms, so they are measured on the actual
 * engine schedule at the corners of the product's limits (smallest and largest
 * amount × shortest and longest term) at the highest rate: a flat rate's
 * reducing-balance equivalent rises with the term, and fees weigh most on the
 * smallest, shortest loan, so a corner is always the worst case.
 */
export function productRateCapReport(
  c: ProductConfig,
  cap: ResolvedRateCap,
  policy: RateCapPolicy,
  opts: { asOf: LocalDate; benchmarkRate?: string | null },
): ProductRateCapReport {
  const findings: (RateCapFinding | null)[] = [];
  const advisories: (RateCapFinding | null)[] = [];
  const notes: string[] = [];
  const p = c.pricing;
  if (p.fixed) findings.push(checkRateAgainstCap('CONTRACT_RATE', 'pricing.fixed.maxAnnualRate', 'The maximum annual rate', p.fixed.maxAnnualRate, cap));
  if (p.promotion) findings.push(checkRateAgainstCap('PROMOTION_RATE', 'pricing.promotion.annualRate', 'The promotional rate', p.promotion.annualRate, cap));
  if (p.floating) {
    const fl = p.floating;
    if (fl.floor) findings.push(checkRateAgainstCap('FLOATING_FLOOR', 'pricing.floating.floor', 'The floating-rate floor', fl.floor, cap));
    if (fl.cap) findings.push(checkRateAgainstCap('FLOATING_CAP', 'pricing.floating.cap', "The floating rate's own cap", fl.cap, cap));
    else if (opts.benchmarkRate !== null && opts.benchmarkRate !== undefined) {
      const current = floatingRateOf(c, opts.benchmarkRate)!;
      findings.push(checkRateAgainstCap('FLOATING_RATE', 'pricing.floating.margin', `${fl.benchmarkCode} ${formatRatePct(opts.benchmarkRate)} + margin ${formatRatePct(fl.margin)} =`, current, cap));
    } else {
      findings.push(checkRateAgainstCap('FLOATING_RATE', 'pricing.floating.margin', 'The floating margin alone', fl.margin, cap));
      notes.push(`No ${fl.benchmarkCode} observation yet: benchmark + margin is checked at booking, and a reset above the cap is held at the cap.`);
    }
  }
  findings.push(...chargeRateFindings(c, cap, policy));

  // Representative schedules: term loans with a dated grid only. The worst
  // corner is reported, once per kind.
  let worstFlat: { rate: Dec; where: string } | null = null;
  let worstComparable: Dec | null = null;
  let worstEffective: { rate: Dec; where: string } | null = null;
  const rate = p.fixed ? p.fixed.maxAnnualRate : floatingRateOf(c, opts.benchmarkRate);
  const capped = rate !== null && cap.annualRate !== null && p.floating && dec(rate).gt(dec(cap.annualRate)) ? cap.annualRate : rate;
  if (c.facility.type !== 'TERM') notes.push('Drawn balances of a credit line are priced at the negotiated rate; upfront fees are not annualised for a line.');
  else if (c.repayment.method === 'EXPLICIT') notes.push('Explicitly dated schedules are measured on the actual dates at booking.');
  else if (c.incomeContingent) notes.push('Income-contingent instalments depend on income; only the contract rate is checked.');
  else if (capped === null) notes.push('No rate to price the representative schedules with yet.');
  else {
    const amounts = [...new Set([c.limits.minAmount, c.limits.maxAmount])];
    const terms = [...new Set([c.limits.minInstalments, c.limits.maxInstalments])];
    for (const principal of amounts) {
      for (const n of terms) {
        const where = `${principal} ${c.identity.currency} over ${n} instalment(s)`;
        try {
          const t: NegotiatedTerms = {
            principal,
            numberOfInstalments: n,
            annualRate: p.fixed ? capped : undefined,
            disbursementDate: opts.asOf,
            // The smallest balloon amortizes the most, where fees weigh most.
            balloonAmount: c.repayment.method === 'BALLOON' ? p.rounding.increment : undefined,
          };
          const fees = computeUpfrontFees(principal, c.identity.currency, p.rounding, feesOf(c), []);
          const calendar = c.repayment.businessDayConvention !== 'NONE' ? { code: c.repayment.holidayCalendarCode ?? 'NONE', weekendDays: [], holidays: [] } : undefined;
          const rates = p.fixed ? undefined : [{ effectiveFrom: opts.asOf, annualRate: capped, source: 'RATE_CAP_CHECK' }];
          const input = toScheduleInput(c, t, fees.bookedPrincipal, calendar, rates);
          const r = scheduleRates(input, generateSchedule(input), fees);
          const comparable = dec(r.comparableRate);
          if (!worstComparable || comparable.gt(worstComparable)) worstComparable = comparable;
          if (r.basis === 'FLAT_EQUIVALENT' && (!worstFlat || comparable.gt(worstFlat.rate))) worstFlat = { rate: comparable, where };
          if (!worstEffective || dec(r.effectiveRate).gt(worstEffective.rate)) worstEffective = { rate: dec(r.effectiveRate), where };
        } catch (e) {
          notes.push(`Could not price ${where}: ${(e as Error).message}`);
        }
      }
    }
  }
  const flat = worstFlat as { rate: Dec; where: string } | null;
  const eff = worstEffective as { rate: Dec; where: string } | null;
  if (flat)
    findings.push(
      checkRateAgainstCap(
        'FLAT_EQUIVALENT_RATE',
        'pricing.fixed.maxAnnualRate',
        `At ${flat.where}, the reducing-balance equivalent of the maximum flat rate ${formatRatePct(capped!)}`,
        flat.rate.toString(),
        cap,
        true,
      ),
    );
  if (eff && policy.includeFeesInEffectiveRate && (!worstComparable || !eff.rate.eq(worstComparable as Dec)))
    advisories.push(
      checkRateAgainstCap('EFFECTIVE_RATE', 'pricing.fees', `At ${eff.where} and the highest rate, the effective annual rate including fees`, eff.rate.toString(), cap, true),
    );
  const present = (xs: (RateCapFinding | null)[]) => xs.filter((f): f is RateCapFinding => !!f);
  return {
    cap,
    policy,
    worstComparableRate: worstComparable ? (worstComparable as Dec).toString() : null,
    worstEffectiveRate: eff ? eff.rate.toString() : null,
    findings: present(findings),
    advisories: present(advisories),
    notes,
  };
}

/**
 * The rates a contract charges besides its contract rate — penalty interest
 * and the over-limit rate (when the policy counts them) and a card's
 * cash-advance and instalment-plan rates. Checked on the product version and again when a
 * contract is booked, since the cap may have been lowered in between.
 */
export function chargeRateFindings(c: Pick<ProductConfig, 'pricing' | 'facility' | 'card'>, cap: ResolvedRateCap, policy: RateCapPolicy): RateCapFinding[] {
  const out: (RateCapFinding | null)[] = [];
  const p = c.pricing;
  // Penalty interest, and the over-limit rate — what a line charges for
  // going past its limit, a charge for a breach like penalty interest (D-109).
  if (policy.penaltyRateMustFitCap && p.penalty.type === 'RATE_ON_OVERDUE' && p.penalty.annualRate)
    out.push(checkRateAgainstCap('PENALTY_RATE', 'pricing.penalty.annualRate', 'The penalty interest rate', p.penalty.annualRate, cap));
  if (policy.penaltyRateMustFitCap && c.facility.overlimitRate)
    out.push(checkRateAgainstCap('OVERLIMIT_RATE', 'facility.overlimitRate', 'The over-limit rate', c.facility.overlimitRate, cap));
  if (c.card) {
    out.push(checkRateAgainstCap('CARD_CASH_ADVANCE_RATE', 'card.cashAdvanceAnnualRate', 'The cash-advance rate', c.card.cashAdvanceAnnualRate, cap));
    if (c.card.instalmentPlan)
      out.push(checkRateAgainstCap('CARD_PLAN_RATE', 'card.instalmentPlan.annualRate', 'The instalment-plan rate', c.card.instalmentPlan.annualRate, cap));
  }
  return out.filter((f): f is RateCapFinding => !!f);
}

// ── Restructure ─────────────────────────────────────────────────────────────

/** The permanent and temporary rates of a restructure proposal against the cap (D-112). */
export function restructureRateFindings(
  permanentRate: string,
  temporaryRate: string | null | undefined,
  cap: ResolvedRateCap,
): RateCapFinding[] {
  return [
    checkRateAgainstCap('RESTRUCTURE_RATE', 'options.annualRate', 'The restructured annual rate', permanentRate, cap),
    temporaryRate ? checkRateAgainstCap('TEMPORARY_RATE', 'options.temporaryRate.annualRate', 'The temporary restructure rate', temporaryRate, cap) : null,
  ].filter((f): f is RateCapFinding => !!f);
}

/** Thrown by callers that refuse; carries the findings for the API's error body. */
export function rateCapError(findings: RateCapFinding[]): EngineError {
  return new EngineError('RATE_CAP_EXCEEDED', findings.map((f) => f.message).join(' '));
}
