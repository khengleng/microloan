/**
 * Institutional lending — interbank, municipal, sovereign and development
 * (concessional) loans: counterparty ratings, exposure limits per
 * counterparty and per country, and the grant element that measures how
 * concessional a loan is. Pure: no I/O, no clock.
 */
import { D, Dec, dec, EngineError, ONE, ZERO, sum } from './decimal.js';
import { LocalDate, compareDates, parseDate, yearFraction } from './dates.js';
import { RoundingRule, roundMoney } from './money.js';

/** Who an institutional loan may be made to. */
export const COUNTERPARTY_TYPES = ['BANK', 'MUNICIPALITY', 'SOVEREIGN', 'DEVELOPMENT_INSTITUTION'] as const;
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

/**
 * Long-term rating scale, best first, in S&P / Fitch notation. A Moody's
 * rating is entered at its usual equivalent (Aa2 → AA, Baa3 → BBB-).
 */
export const RATING_SCALE = [
  'AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-',
  'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D',
] as const;
export type Rating = (typeof RATING_SCALE)[number];

/** Position on the scale: 0 is the best (AAA). */
export function ratingRank(rating: string): number {
  const i = (RATING_SCALE as readonly string[]).indexOf(rating);
  if (i < 0) throw new EngineError('INVALID_RATING', `Unknown rating ${rating}; use ${RATING_SCALE[0]} … ${RATING_SCALE[RATING_SCALE.length - 1]}.`);
  return i;
}

export function isInvestmentGrade(rating: string): boolean {
  return ratingRank(rating) <= ratingRank('BBB-');
}

/** Whether a counterparty's rating satisfies a product's minimum. Unrated fails any minimum. */
export function meetsMinimumRating(rating: string | null, minimum: string | null): { ok: boolean; reason: string | null } {
  if (!minimum) return { ok: true, reason: null };
  if (!rating) return { ok: false, reason: `The counterparty is unrated; this product lends only to counterparties rated ${minimum} or better.` };
  if (ratingRank(rating) > ratingRank(minimum))
    return { ok: false, reason: `The counterparty is rated ${rating}; this product lends only to counterparties rated ${minimum} or better.` };
  return { ok: true, reason: null };
}

export interface ExposureLimitTerms {
  amount: string;
  currency: string;
  /** The limit must be reviewed (and re-approved) by this date; after it, it no longer applies. */
  reviewOn: LocalDate;
}

export interface LimitCheckInput {
  /** What is limited, for the message: "Counterparty Bank of X", "Country KH". */
  label: string;
  /** The approved limit in force, or null when there is none. */
  limit: ExposureLimitTerms | null;
  /** Exposure already taken against the limit, excluding the request. */
  utilised: string;
  /** The new exposure being asked for. */
  requested: string;
  /** Currency of the request. */
  currency: string;
  asOf: LocalDate;
}

export type LimitCheckCode = 'OK' | 'NO_LIMIT' | 'LIMIT_REVIEW_PASSED' | 'LIMIT_CURRENCY' | 'LIMIT_EXCEEDED';

export interface LimitCheck {
  ok: boolean;
  code: LimitCheckCode;
  label: string;
  limit: string | null;
  utilised: string;
  requested: string;
  /** Limit − utilised, before the request; null without a usable limit. */
  headroom: string | null;
  /** (utilised + requested) ÷ limit, 4 d.p. */
  utilisationAfter: string | null;
  message: string;
}

/**
 * Is there room under an approved limit for a new exposure? A limit whose
 * review date has passed, or that is in another currency, does not count:
 * the exposure is refused rather than measured against a stale or
 * unconverted figure.
 */
export function checkLimitHeadroom(i: LimitCheckInput): LimitCheck {
  const utilised = dec(i.utilised, 'utilised');
  const requested = dec(i.requested, 'requested');
  if (requested.lt(0) || utilised.lt(0)) throw new EngineError('INVALID_EXPOSURE', 'Exposures cannot be negative.');
  parseDate(i.asOf, 'asOf');
  const base = { label: i.label, utilised: utilised.toString(), requested: requested.toString() };
  if (!i.limit)
    return { ...base, ok: false, code: 'NO_LIMIT', limit: null, headroom: null, utilisationAfter: null, message: `${i.label} has no approved exposure limit.` };
  const limit = dec(i.limit.amount, 'limit');
  if (compareDates(i.limit.reviewOn, i.asOf) < 0)
    return {
      ...base,
      ok: false,
      code: 'LIMIT_REVIEW_PASSED',
      limit: limit.toString(),
      headroom: null,
      utilisationAfter: null,
      message: `${i.label}: the exposure limit was due for review on ${i.limit.reviewOn} and has not been renewed.`,
    };
  if (i.limit.currency !== i.currency)
    return {
      ...base,
      ok: false,
      code: 'LIMIT_CURRENCY',
      limit: limit.toString(),
      headroom: null,
      utilisationAfter: null,
      message: `${i.label}: the exposure limit is in ${i.limit.currency}, the loan is in ${i.currency}; approve a ${i.currency} limit.`,
    };
  const headroom = limit.minus(utilised);
  const after = utilised.plus(requested);
  const utilisationAfter = limit.isZero() ? null : after.div(limit).toDecimalPlaces(4).toString();
  if (after.gt(limit))
    return {
      ...base,
      ok: false,
      code: 'LIMIT_EXCEEDED',
      limit: limit.toString(),
      headroom: headroom.toString(),
      utilisationAfter,
      message: `${i.label}: ${requested} ${i.currency} would take exposure to ${after} against a limit of ${limit} (${D.max(headroom, 0)} available).`,
    };
  return { ...base, ok: true, code: 'OK', limit: limit.toString(), headroom: headroom.toString(), utilisationAfter, message: `${i.label}: within limit (${headroom.minus(requested)} left after this loan).` };
}

export interface GrantElementInput {
  /** Face value of the loan. */
  principal: string;
  disbursementDate: LocalDate;
  /** Debt service (principal + interest) on its due dates. */
  payments: { date: LocalDate; amount: string }[];
  /** Annual discount rate; the IMF / World Bank convention is 5%. */
  discountRate?: string;
  rounding?: RoundingRule;
}

export interface GrantElement {
  /** (face − present value of debt service) ÷ face, 4 d.p. */
  grantElement: string;
  presentValue: string;
  discountRate: string;
  explanation: string;
}

/**
 * The grant element of a loan: how much of its face value is, in effect, a
 * gift. Debt service is discounted at the reference rate with annual
 * compounding over actual/365 year fractions from disbursement. A loan at
 * the reference rate has a grant element of about zero; IDA-style lending is
 * concessional when it reaches 35%.
 */
export function grantElement(i: GrantElementInput): GrantElement {
  const face = dec(i.principal, 'principal');
  if (face.lte(0)) throw new EngineError('INVALID_PRINCIPAL', 'The face value must be positive.');
  const r = dec(i.discountRate ?? '0.05', 'discountRate');
  if (r.lte(-1)) throw new EngineError('INVALID_RATE', 'The discount rate must exceed −100%.');
  const pv = sum(
    i.payments.map((p) => {
      const t = yearFraction(i.disbursementDate, p.date, 'ACT_365_FIXED');
      return dec(p.amount, 'payment').div(ONE.plus(r).pow(t));
    }),
  );
  const ge = face.minus(pv).div(face);
  const presentValue = i.rounding ? roundMoney(pv, i.rounding) : pv.toDecimalPlaces(2);
  return {
    grantElement: ge.toDecimalPlaces(4).toString(),
    presentValue: presentValue.toString(),
    discountRate: r.toString(),
    explanation: `Debt service of ${sum(i.payments.map((p) => dec(p.amount))).toString()} discounted at ${r.times(100)}% is worth ${presentValue} today against a face value of ${face}: a grant element of ${ge.times(100).toDecimalPlaces(2)}%.`,
  };
}

/** Exposure counted against a limit, by what stage the lending is at. */
export interface ExposureItem {
  stage: 'OUTSTANDING' | 'BOOKED' | 'APPROVED';
  amount: string;
}

/**
 * Total exposure: principal outstanding on active loans, plus loans booked
 * but not yet disbursed, plus approvals not yet booked — committed lending
 * counts from the moment it is approved, so two approvals cannot each use
 * the same headroom.
 */
export function totalExposure(items: ExposureItem[]): { total: string; byStage: Record<ExposureItem['stage'], string> } {
  const byStage: Record<ExposureItem['stage'], Dec> = { OUTSTANDING: ZERO, BOOKED: ZERO, APPROVED: ZERO };
  for (const it of items) byStage[it.stage] = byStage[it.stage].plus(dec(it.amount, 'exposure'));
  const total = byStage.OUTSTANDING.plus(byStage.BOOKED).plus(byStage.APPROVED);
  return {
    total: total.toString(),
    byStage: { OUTSTANDING: byStage.OUTSTANDING.toString(), BOOKED: byStage.BOOKED.toString(), APPROVED: byStage.APPROVED.toString() },
  };
}
