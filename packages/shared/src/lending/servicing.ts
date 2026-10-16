import { Dec, dec, EngineError, ZERO, sum } from './decimal.js';
import { RoundingRule, roundMoney } from './money.js';
import { LocalDate, compareDates, daysBetween, isLeapYear, parseDate, toEpochDay, fromEpochDay, assertDayCount } from './dates.js';
import {
  ScheduleInput,
  ScheduleLine,
  Period,
  amortize,
  contractContext,
  finalizeLines,
  periodFactor,
  rateAt,
} from './schedule.js';

// ── Daily accrual (spec D) ──────────────────────────────────────────────────

export interface AccrualSegment {
  /** Inclusive start date of the segment. */
  from: LocalDate;
  /** Exclusive end date. */
  to: LocalDate;
  principal: string;
  annualRate: string;
}

/**
 * Interest = Σ over each day of (eligible outstanding principal × annual rate /
 * contractual day-count denominator). Segments group days with the same
 * principal and rate; ACT/ACT ISDA uses 366 for days in leap years. 30/360
 * conventions have no per-day denominator and are rejected here — they are
 * period conventions, so use period-based accrual for them.
 */
export function dailyAccrual(segments: AccrualSegment[], dayCount: string): { interest: string; days: number; lines: { from: LocalDate; to: LocalDate; days: number; denominator: number; interest: string }[] } {
  assertDayCount(dayCount);
  if (dayCount === 'THIRTY_360_ISDA' || dayCount === 'THIRTY_E_360') {
    throw new EngineError('UNSUPPORTED_DAY_COUNT', `${dayCount} is a period convention and has no daily accrual denominator.`);
  }
  const lines: { from: LocalDate; to: LocalDate; days: number; denominator: number; interest: string }[] = [];
  let total = ZERO;
  let days = 0;
  for (const seg of segments) {
    const p = dec(seg.principal, 'principal');
    const r = dec(seg.annualRate, 'annualRate');
    let cursor = toEpochDay(seg.from);
    const end = toEpochDay(seg.to);
    if (end < cursor) throw new EngineError('INVALID_PERIOD', `Accrual segment ends before it starts (${seg.from} → ${seg.to}).`);
    while (cursor < end) {
      const year = parseDate(fromEpochDay(cursor)).y;
      const denominator = dayCount === 'ACT_360' ? 360 : dayCount === 'ACT_ACT_ISDA' && isLeapYear(year) ? 366 : 365;
      const yearEnd = toEpochDay(`${String(year + 1).padStart(4, '0')}-01-01`);
      const segEnd = dayCount === 'ACT_ACT_ISDA' ? Math.min(yearEnd, end) : end;
      const n = segEnd - cursor;
      const interest = p.times(r).times(n).div(denominator);
      total = total.plus(interest);
      days += n;
      lines.push({ from: fromEpochDay(cursor), to: fromEpochDay(segEnd), days: n, denominator, interest: interest.toString() });
      cursor = segEnd;
    }
  }
  return { interest: total.toString(), days, lines };
}

// ── Contractual accrual on a schedule line ──────────────────────────────────

export interface AccruableLine {
  periodStart: LocalDate;
  periodEnd: LocalDate;
  openingPrincipal: string;
  interest: string;
  capitalizedInterest?: string;
}

/**
 * Interest earned on a schedule line up to (not including) `asOf`.
 *
 * Accounting accrual must reconcile to what the contract will bill: on the
 * period end the accrued amount equals the line's scheduled interest exactly.
 * DAILY-basis lines accrue opening × factor(start → asOf); PERIODIC-basis lines
 * accrue the scheduled interest straight-line by actual days, because their
 * periodic rate is not defined for a part period. Capitalized interest is
 * accrued the same way (it is earned, then added to principal).
 */
export function accruedOnLine(line: AccruableLine, asOf: LocalDate, contract: ScheduleInput): Dec {
  const scheduled = dec(line.interest).plus(dec(line.capitalizedInterest ?? '0'));
  if (compareDates(asOf, line.periodStart) <= 0) return ZERO;
  if (compareDates(asOf, line.periodEnd) >= 0) return scheduled;
  const { ctx, rates, rounding } = contractContext(contract);
  if (ctx.basis === 'DAILY') {
    const rate = dec(rateAt(rates, line.periodStart).annualRate);
    const factor = periodFactor({ start: line.periodStart, end: asOf, dueDate: asOf }, rate, ctx);
    const value = roundMoney(dec(line.openingPrincipal).times(factor), rounding);
    return value.gt(scheduled) ? scheduled : value;
  }
  const elapsed = daysBetween(line.periodStart, asOf);
  const total = daysBetween(line.periodStart, line.periodEnd);
  return roundMoney(scheduled.times(elapsed).div(total), rounding);
}

// ── Prepayment rescheduling ─────────────────────────────────────────────────

export type PrepaymentStrategy = 'RECAST' | 'SHORTEN';

export interface RemainingLine {
  number: number;
  periodStart: LocalDate;
  periodEnd: LocalDate;
  dueDate: LocalDate;
  openingPrincipal: string;
  principal: string;
  interest: string;
}

export interface RescheduleResult {
  lines: ScheduleLine[];
  instalmentAmount: string | null;
  currentPeriodInterest: string;
  explanation: string[];
}

/**
 * Rebuild the unpaid part of a schedule after an unscheduled principal
 * reduction on `asOf`, which falls inside the first remaining line's period.
 *
 * The current period's interest is split at the prepayment date: interest
 * already earned on the old balance up to `asOf`, plus interest on the new
 * balance for the rest of the period. RECAST keeps the remaining instalment
 * count and lowers the instalment; SHORTEN keeps the instalment (or principal
 * amounts) and drops instalments from the end.
 */
export function rescheduleAfterPrepayment(
  contract: ScheduleInput,
  remaining: RemainingLine[],
  asOf: LocalDate,
  newBalance: string,
  strategy: PrepaymentStrategy,
  currentInstalment: string | null,
): RescheduleResult {
  if (remaining.length === 0) throw new EngineError('NOTHING_TO_RESCHEDULE', 'No unpaid instalments remain.');
  const { ctx, rates, rounding } = contractContext(contract);
  const balance = dec(newBalance, 'newBalance');
  const first = remaining[0];
  if (compareDates(asOf, first.periodStart) < 0 || compareDates(asOf, first.periodEnd) > 0) {
    throw new EngineError('INVALID_PREPAYMENT_DATE', `Prepayment date ${asOf} must fall within the current period ${first.periodStart} – ${first.periodEnd}.`);
  }
  const periods: Period[] = remaining.map((l) => ({ start: l.periodStart, end: l.periodEnd, dueDate: l.dueDate }));
  const explanation: string[] = [];

  // Interest for the current period, split at asOf.
  const oldOpening = dec(first.openingPrincipal);
  const rate = dec(rateAt(rates, first.periodStart).annualRate);
  let currentInterest: Dec;
  if (ctx.basis === 'DAILY') {
    const before = periodFactor({ start: first.periodStart, end: asOf, dueDate: asOf }, rate, ctx);
    const after = periodFactor({ start: asOf, end: first.periodEnd, dueDate: first.dueDate }, rate, ctx);
    currentInterest = oldOpening.times(before).plus(balance.times(after));
  } else {
    const total = daysBetween(first.periodStart, first.periodEnd);
    const elapsed = daysBetween(first.periodStart, asOf);
    const full = periodFactor(periods[0], rate, ctx);
    currentInterest = oldOpening.times(full).times(elapsed).div(total).plus(balance.times(full).times(total - elapsed).div(total));
  }
  currentInterest = roundMoney(currentInterest, rounding);
  explanation.push(
    `Current period interest ${currentInterest.toString()} = interest on the previous balance ${oldOpening.toString()} to ${asOf} + interest on the new balance ${balance.toString()} for the rest of the period.`,
  );

  const method = contract.method;
  const oldPrincipals = remaining.map((l) => dec(l.principal));
  const oldRemaining = sum(oldPrincipals);
  let explicitPrincipal: Dec[] | undefined;
  let amortMethod = method;
  let fixedInstalment: Dec | undefined;
  let balloon = contract.balloonAmount ? dec(contract.balloonAmount) : ZERO;
  if (balloon.gte(balance)) {
    // The prepayment has eaten into the balloon: what is left is a bullet.
    amortMethod = 'INTEREST_ONLY';
    balloon = ZERO;
  }

  if (method === 'EXPLICIT' || (method === 'EQUAL_PRINCIPAL' && strategy === 'SHORTEN')) {
    amortMethod = 'EXPLICIT';
    explicitPrincipal = strategy === 'RECAST' ? scaleProRata(oldPrincipals, oldRemaining, balance, rounding) : trimFromEnd(oldPrincipals, balance);
  } else if ((method === 'EQUAL_INSTALMENT' || method === 'BALLOON') && strategy === 'SHORTEN' && amortMethod !== 'INTEREST_ONLY') {
    if (!currentInstalment) throw new EngineError('MISSING_INSTALMENT', 'Shortening the tenor needs the current instalment amount.');
    fixedInstalment = dec(currentInstalment);
    amortMethod = 'EQUAL_INSTALMENT';
    balloon = ZERO;
  }
  if (contract.interestMethod === 'FLAT') {
    throw new EngineError('PREPAYMENT_UNSUPPORTED', 'Partial prepayment of flat-rate loans is not supported; use early settlement.');
  }

  const { lines: raw, instalment } = amortize({
    method: amortMethod,
    interestMethod: 'REDUCING_BALANCE',
    currency: contract.currency,
    rounding,
    periods,
    rates,
    rateContext: ctx,
    opening: balance,
    principalGrace: 0,
    interestGrace: 0,
    balloon,
    explicitPrincipal,
    fixedInstalment,
    firstPeriodInterestOverride: currentInterest,
  });
  const lines = finalizeLines(raw, ctx, first.number);
  // The first line's opening is the post-prepayment balance; record it so the
  // line reconciles (opening − principal = closing).
  explanation.push(
    strategy === 'RECAST'
      ? `RECAST: ${lines.length} instalment(s) kept; new instalment ${instalment ? instalment.toString() : 'per principal plan'}.`
      : `SHORTEN: instalment kept at ${currentInstalment ?? 'the existing principal plan'}; ${remaining.length - lines.length} instalment(s) removed from the end.`,
  );
  return { lines, instalmentAmount: instalment ? instalment.toString() : null, currentPeriodInterest: currentInterest.toString(), explanation };
}

function scaleProRata(amounts: Dec[], oldTotal: Dec, newTotal: Dec, rounding: RoundingRule): Dec[] {
  if (oldTotal.isZero()) throw new EngineError('NOTHING_TO_RESCHEDULE', 'No principal remains to rescale.');
  const scaled = amounts.map((a) => roundMoney(a.times(newTotal).div(oldTotal), rounding));
  // Residual into the last non-zero instalment so the plan sums exactly.
  const residual = newTotal.minus(sum(scaled));
  let idx = scaled.length - 1;
  while (idx > 0 && amounts[idx].isZero()) idx--;
  scaled[idx] = scaled[idx].plus(residual);
  return scaled;
}

function trimFromEnd(amounts: Dec[], newTotal: Dec): Dec[] {
  let left = newTotal;
  return amounts.map((a) => {
    const take = a.lt(left) ? a : left;
    left = left.minus(take);
    return take;
  });
}

// ── Payment allocation ──────────────────────────────────────────────────────

export type DueComponent = 'PENALTY' | 'FEE' | 'TAX' | 'INTEREST' | 'PRINCIPAL';
export type AllocationStrategy = 'OLDEST_DUE_FIRST' | 'COMPONENT_FIRST';

export interface DueItem {
  instalmentNumber: number;
  dueDate: LocalDate;
  component: DueComponent;
  outstanding: string;
}

export interface AllocationLine {
  instalmentNumber: number;
  component: DueComponent;
  amount: string;
}

/**
 * Allocate a payment to outstanding dues.
 *
 * OLDEST_DUE_FIRST clears each instalment in component order before moving to
 * the next instalment; COMPONENT_FIRST clears a component across every
 * instalment (oldest first) before the next component. Whatever is left is
 * returned as `unallocated` for the caller's excess handling.
 */
export function allocatePayment(amount: string, dues: DueItem[], order: DueComponent[], strategy: AllocationStrategy): { allocations: AllocationLine[]; unallocated: string } {
  let left = dec(amount, 'amount');
  if (left.lte(0)) throw new EngineError('INVALID_AMOUNT', 'Payment amount must be positive.');
  const rank = (c: DueComponent) => {
    const i = order.indexOf(c);
    if (i < 0) throw new EngineError('INVALID_ALLOCATION_ORDER', `Allocation order does not include ${c}.`);
    return i;
  };
  const items = dues
    .filter((d) => dec(d.outstanding).gt(0))
    .sort((a, b) => {
      const byDate = compareDates(a.dueDate, b.dueDate) || a.instalmentNumber - b.instalmentNumber;
      const byComponent = rank(a.component) - rank(b.component);
      return strategy === 'OLDEST_DUE_FIRST' ? byDate || byComponent : byComponent || byDate;
    });
  const allocations: AllocationLine[] = [];
  for (const item of items) {
    if (left.lte(0)) break;
    const due = dec(item.outstanding);
    const take = due.lt(left) ? due : left;
    allocations.push({ instalmentNumber: item.instalmentNumber, component: item.component, amount: take.toString() });
    left = left.minus(take);
  }
  return { allocations, unallocated: left.toString() };
}

