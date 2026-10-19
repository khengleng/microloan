/**
 * Credit cards (LT-07): a revolving line whose balance is split by what it
 * was spent on, because each part prices differently.
 *
 * | Balance  | Interest                                   | Grace period |
 * |----------|--------------------------------------------|--------------|
 * | PURCHASE | purchase rate, from the transaction date   | yes (UC-39)  |
 * | CASH     | cash-advance rate, from the transaction    | never (UC-40)|
 * | PLAN     | none while unbilled — the plan's own rate  | n/a (UC-44)  |
 *
 * A grace period is a conditional waiver, not a lower rate: purchase interest
 * is always computed day by day from each purchase's date, then waived for the
 * cycle when the previous statement was paid in full by its due date. When it
 * was not, the computed interest stands — including on the days before the
 * late payment arrived ("trailing" interest), which is what the cardholder
 * gave up by revolving.
 *
 * Instalment-plan principal is billed one instalment per statement: the
 * billed principal moves into the PURCHASE balance, so it is part of the
 * statement balance, of the minimum payment, and — if left unpaid — revolves
 * at the purchase rate like anything else on the statement.
 *
 * Every amount crossing this module's boundary is a decimal string.
 */
import { Dec, dec, EngineError, ZERO } from './decimal.js';
import { RoundingRule, roundMoney } from './money.js';
import { LocalDate, compareDates, addDays, daysBetween } from './dates.js';
import { AccrualSegment, dailyAccrual } from './servicing.js';

export const CARD_BUCKETS = ['PURCHASE', 'CASH', 'PLAN'] as const;
export type CardBucket = (typeof CARD_BUCKETS)[number];

export interface CardTerms {
  currency: string;
  dayCount: string;
  rounding: RoundingRule;
  purchaseAnnualRate: string;
  cashAdvanceAnnualRate: string;
  /** Fee on each cash advance: the greater of rate × amount and the minimum. */
  cashAdvanceFeeRate: string | null;
  cashAdvanceFeeMinimum: string | null;
  /** Share of the limit that may be outstanding as cash advances. */
  cashAdvanceLimitShare: string;
  minimumPaymentRate: string;
  minimumPaymentFloor: string;
  /** Days from the statement date to the payment due date. */
  paymentDueDays: number;
}

/** One balance change: positive raises the bucket, negative lowers it. */
export interface CardMovement {
  date: LocalDate;
  bucket: CardBucket;
  amount: string;
}

export interface CardSegment {
  from: LocalDate;
  /** Exclusive. */
  to: LocalDate;
  balance: string;
}

/** A bucket's balance over `[from, to)`, one segment per constant-balance run. */
export function cardBalanceTimeline(movements: CardMovement[], bucket: CardBucket, from: LocalDate, to: LocalDate): CardSegment[] {
  if (compareDates(to, from) < 0) throw new EngineError('INVALID_PERIOD', `The period ends (${to}) before it starts (${from}).`);
  const own = movements
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.bucket === bucket)
    .sort((a, b) => compareDates(a.m.date, b.m.date) || a.i - b.i)
    .map(({ m }) => m);
  let balance = ZERO;
  for (const m of own) if (compareDates(m.date, from) < 0) balance = balance.plus(dec(m.amount, 'movement.amount'));
  const out: CardSegment[] = [];
  let cursor = from;
  for (const m of own) {
    if (compareDates(m.date, from) < 0) continue;
    if (compareDates(m.date, to) >= 0) break;
    if (compareDates(m.date, cursor) > 0) {
      out.push({ from: cursor, to: m.date, balance: balance.toString() });
      cursor = m.date;
    }
    balance = balance.plus(dec(m.amount, 'movement.amount'));
  }
  if (compareDates(cursor, to) < 0) out.push({ from: cursor, to, balance: balance.toString() });
  return out;
}

/** A bucket's balance at the end of `asOf` (movements on that date included). */
export function cardBalanceAt(movements: CardMovement[], bucket: CardBucket, asOf: LocalDate): string {
  return movements
    .filter((m) => m.bucket === bucket && compareDates(m.date, asOf) <= 0)
    .reduce((t, m) => t.plus(dec(m.amount, 'movement.amount')), ZERO)
    .toString();
}

function interestOn(movements: CardMovement[], bucket: CardBucket, rate: string, from: LocalDate, to: LocalDate, dayCount: string): Dec {
  const segments: AccrualSegment[] = cardBalanceTimeline(movements, bucket, from, to).map((s) => ({
    from: s.from,
    to: s.to,
    // A credit balance earns nothing.
    principal: dec(s.balance).lt(0) ? '0' : s.balance,
    annualRate: rate,
  }));
  return segments.length ? dec(dailyAccrual(segments, dayCount).interest) : ZERO;
}

export interface PreviousStatement {
  statementBalance: string;
  dueDate: LocalDate;
}

/**
 * UC-39: whether this cycle's purchase interest is waived.
 *
 * The grace period holds when there was nothing to pay — no previous
 * statement, or one with nothing owing — or when the payments received
 * between that statement's date and its due date covered its whole balance.
 * Paying the minimum, or paying in full a day late, loses it.
 */
export function cardGraceApplies(previous: PreviousStatement | null, paidByDueDate: string): boolean {
  if (!previous) return true;
  const owed = dec(previous.statementBalance, 'statementBalance');
  if (owed.lte(0)) return true;
  return dec(paidByDueDate, 'paidByDueDate').gte(owed);
}

export interface CardCycleCharges {
  /** Purchase interest charged (zero when the grace period applies). */
  purchaseInterest: string;
  /** Purchase interest computed and then waived by the grace period. */
  purchaseInterestWaived: string;
  /** Cash-advance interest, from each advance's date; never waived (UC-40). */
  cashInterest: string;
  graceApplied: boolean;
  days: number;
  purchaseSegments: CardSegment[];
  cashSegments: CardSegment[];
}

/** Interest for the cycle `[periodStart, periodEnd)`. */
export function cardCycleCharges(terms: CardTerms, movements: CardMovement[], periodStart: LocalDate, periodEnd: LocalDate, graceApplies: boolean): CardCycleCharges {
  if (compareDates(periodEnd, periodStart) <= 0) throw new EngineError('INVALID_PERIOD', `A statement period must end after it starts (${periodStart} → ${periodEnd}).`);
  const purchase = roundMoney(interestOn(movements, 'PURCHASE', terms.purchaseAnnualRate, periodStart, periodEnd, terms.dayCount), terms.rounding);
  const cash = roundMoney(interestOn(movements, 'CASH', terms.cashAdvanceAnnualRate, periodStart, periodEnd, terms.dayCount), terms.rounding);
  return {
    purchaseInterest: graceApplies ? '0' : purchase.toString(),
    purchaseInterestWaived: graceApplies ? purchase.toString() : '0',
    cashInterest: cash.toString(),
    graceApplied: graceApplies,
    days: daysBetween(periodStart, periodEnd),
    purchaseSegments: cardBalanceTimeline(movements, 'PURCHASE', periodStart, periodEnd),
    cashSegments: cardBalanceTimeline(movements, 'CASH', periodStart, periodEnd),
  };
}

/** UC-40: the fee charged on a cash advance at the moment it is taken. */
export function cashAdvanceFee(terms: CardTerms, amount: string): string {
  const a = dec(amount, 'amount');
  const byRate = terms.cashAdvanceFeeRate ? roundMoney(a.times(dec(terms.cashAdvanceFeeRate)), terms.rounding) : ZERO;
  const min = terms.cashAdvanceFeeMinimum ? dec(terms.cashAdvanceFeeMinimum) : ZERO;
  return (byRate.gt(min) ? byRate : min).toString();
}

export interface CardMinimumPayment {
  amount: string;
  dueDate: LocalDate;
  /** Charges + billed plan instalment + max(rate × revolving principal, floor), capped. */
  components: { charges: string; planInstalment: string; principalShare: string };
}

/**
 * The statement's minimum payment.
 *
 * All of the cycle's charges and the billed plan instalment are due in full —
 * a minimum that does not even cover interest would let the balance grow
 * while the cardholder "pays". On top comes a share of the revolving
 * principal, floored, and the total is capped at the statement balance.
 */
export function cardMinimumPayment(
  terms: CardTerms,
  input: { statementDate: LocalDate; statementBalance: string; charges: string; planInstalment: string; revolvingPrincipal: string },
): CardMinimumPayment {
  const balance = dec(input.statementBalance, 'statementBalance');
  const dueDate = addDays(input.statementDate, terms.paymentDueDays);
  if (balance.lte(0)) return { amount: '0', dueDate, components: { charges: '0', planInstalment: '0', principalShare: '0' } };
  const revolving = nonNegative(dec(input.revolvingPrincipal, 'revolvingPrincipal'));
  const share = roundMoney(revolving.times(dec(terms.minimumPaymentRate)), terms.rounding);
  const floor = dec(terms.minimumPaymentFloor);
  const principalShare = revolving.gt(0) ? minOf(revolving, share.gt(floor) ? share : floor) : ZERO;
  const raw = dec(input.charges).plus(dec(input.planInstalment)).plus(principalShare);
  return {
    amount: minOf(raw, balance).toString(),
    dueDate,
    components: { charges: input.charges, planInstalment: input.planInstalment, principalShare: principalShare.toString() },
  };
}

function nonNegative(v: Dec): Dec {
  return v.lt(0) ? ZERO : v;
}
function minOf(a: Dec, b: Dec): Dec {
  return a.lt(b) ? a : b;
}

export const CARD_PAYMENT_ORDER = ['PENALTY', 'FEE', 'INTEREST', 'CASH', 'PURCHASE', 'PLAN'] as const;
export type CardPaymentComponent = (typeof CARD_PAYMENT_ORDER)[number];

/**
 * Apply a card payment. Charges first, then principal from the most expensive
 * balance to the cheapest — cash advances before purchases — and only then
 * the unbilled instalment-plan principal, which is a prepayment of the plan.
 * Paying more than is owed is refused by the caller, as everywhere else.
 */
export function allocateCardPayment(amount: string, owed: Record<CardPaymentComponent, string>): { applied: Record<CardPaymentComponent, string>; unapplied: string } {
  let left = dec(amount, 'amount');
  if (left.lte(0)) throw new EngineError('INVALID_AMOUNT', 'A payment must be positive.');
  const applied = {} as Record<CardPaymentComponent, string>;
  for (const c of CARD_PAYMENT_ORDER) {
    const due = nonNegative(dec(owed[c] ?? '0', c));
    const take = minOf(due, left);
    applied[c] = take.toString();
    left = left.minus(take);
  }
  return { applied, unapplied: left.toString() };
}

export interface InstalmentPlanLine {
  number: number;
  principal: string;
  interest: string;
  total: string;
}

export interface InstalmentPlanResult {
  instalmentAmount: string;
  totalInterest: string;
  lines: InstalmentPlanLine[];
}

/**
 * UC-44: convert a purchase into a fixed monthly instalment plan.
 *
 * Level instalments at the plan's monthly rate (annual / 12) on the reducing
 * balance; the last instalment absorbs rounding so principal sums exactly.
 * A zero rate splits the principal evenly.
 */
export function instalmentPlan(principal: string, annualRate: string, months: number, rounding: RoundingRule): InstalmentPlanResult {
  const p = dec(principal, 'principal');
  if (p.lte(0)) throw new EngineError('INVALID_AMOUNT', 'An instalment plan needs a positive principal.');
  if (!Number.isInteger(months) || months < 1 || months > 60) throw new EngineError('INVALID_TERM', 'An instalment plan runs 1 to 60 months.');
  const r = dec(annualRate, 'annualRate').div(12);
  const level = r.isZero() ? p.div(months) : p.times(r).div(dec(1).minus(dec(1).plus(r).pow(-months)));
  const instalment = roundMoney(level, rounding);
  const lines: InstalmentPlanLine[] = [];
  let balance = p;
  let totalInterest = ZERO;
  for (let n = 1; n <= months; n++) {
    const interest = roundMoney(balance.times(r), rounding);
    const principalPart = n === months ? balance : minOf(balance, instalment.minus(interest));
    balance = balance.minus(principalPart);
    totalInterest = totalInterest.plus(interest);
    lines.push({ number: n, principal: principalPart.toString(), interest: interest.toString(), total: principalPart.plus(interest).toString() });
  }
  return { instalmentAmount: instalment.toString(), totalInterest: totalInterest.toString(), lines };
}
