import { D, Dec, EngineError, ZERO, dec } from './decimal.js';
import { roundMoney, type RoundingRule } from './money.js';
import { compareDates, daysBetween, type LocalDate } from './dates.js';
import { dailyAccrual } from './servicing.js';

/**
 * Late-payment penalty on an instalment, accrued like interest (UC-55, UC-56,
 * DECISIONS D-133).
 *
 * A daily penalty rate on a small overdue amount earns a fraction of a minor
 * unit a day. Rounding each day's charge on its own overcharges (USD 10 at
 * 24% earns 0.0066 a day, rounded up to 0.01) or never charges at all (a KHR
 * product rounding to 100 riel). Instead the unrounded penalty is accumulated
 * per instalment, and each assessment posts the rounded cumulative amount
 * less what has already been posted — the same "expected to date − already
 * posted" rule the interest accrual follows.
 */
export interface PenaltyAccrualInput {
  /** Unrounded penalty accrued on the instalment before this period. */
  accruedToDate: string;
  /** Penalty already posted for the instalment (rounded amounts). */
  postedToDate: string;
  /** Accrued from (inclusive) to (exclusive). */
  from: LocalDate;
  to: LocalDate;
  /** What is overdue on the instalment over the period (principal + interest). */
  overdue: string;
  annualRate: string;
  rounding: RoundingRule;
}

export interface PenaltyAccrualResult {
  /** Unrounded penalty earned over the period. */
  periodAccrual: string;
  /** Unrounded penalty accrued to `to`. */
  accruedToDate: string;
  /** What to post now: rounded cumulative accrual less what was posted (never negative). */
  charge: string;
  /** Posted to date once `charge` is posted. */
  postedToDate: string;
  days: number;
}

/** Penalty interest is computed on an actual/365 basis. */
const PENALTY_DAY_COUNT = 'ACT_365_FIXED';

export function accruePenalty(i: PenaltyAccrualInput): PenaltyAccrualResult {
  const overdue = dec(i.overdue, 'overdue');
  if (overdue.isNegative()) throw new EngineError('INVALID_AMOUNT', 'The overdue amount cannot be negative.');
  if (compareDates(i.to, i.from) < 0) throw new EngineError('INVALID_PERIOD', `Penalty period ends before it starts (${i.from} → ${i.to}).`);
  const before = dec(i.accruedToDate, 'accruedToDate');
  const posted = dec(i.postedToDate, 'postedToDate');
  const period = overdue.isZero()
    ? { interest: '0', days: daysBetween(i.from, i.to) }
    : dailyAccrual([{ from: i.from, to: i.to, principal: overdue.toString(), annualRate: i.annualRate }], PENALTY_DAY_COUNT);
  const accrued = before.plus(period.interest);
  const target = roundMoney(accrued, i.rounding);
  const charge = D.max(ZERO, target.minus(posted));
  return {
    periodAccrual: new D(period.interest).toString(),
    accruedToDate: accrued.toString(),
    charge: charge.toString(),
    postedToDate: posted.plus(charge).toString(),
    days: period.days,
  };
}

/** One recorded penalty assessment on an instalment. */
export interface PenaltyAccrualRecord {
  /** DAILY: penalty interest over [from, to). ONCE: a one-off charge triggered after `from` (the end of grace). */
  kind: 'DAILY' | 'ONCE';
  from: LocalDate;
  to: LocalDate;
  /** Unrounded accrual (DAILY) or the charge (ONCE). */
  accrued: string;
}

/**
 * The part of a recorded accrual that a payment valued on `valueDate` would
 * have prevented (DECISIONS D-135). A daily accrual is apportioned by days:
 * the overdue amount it was computed on was constant over its period, so
 * the days on or after the value date carry their share exactly. A one-off
 * charge is prevented whole when the payment is valued on or before the last
 * day of grace, and not at all otherwise.
 */
export function penaltyPreventedBy(record: PenaltyAccrualRecord, valueDate: LocalDate): Dec {
  const accrued = dec(record.accrued, 'accrued');
  if (record.kind === 'ONCE') return compareDates(valueDate, record.from) <= 0 ? accrued : ZERO;
  if (compareDates(record.to, valueDate) <= 0) return ZERO;
  const total = daysBetween(record.from, record.to);
  if (total <= 0) return ZERO;
  const start = compareDates(record.from, valueDate) >= 0 ? record.from : valueDate;
  const after = daysBetween(start, record.to);
  return after >= total ? accrued : accrued.times(after).div(total);
}

export interface PenaltyRewindResult {
  /** Unrounded accrual left after the prevented part is removed. */
  accruedToDate: string;
  /** Posted to date after the reversal. */
  postedToDate: string;
  /** Penalty to reverse now (rounded). */
  reverse: string;
}

/**
 * Remove `prevented` from an instalment's unrounded accrual and work out the
 * posted penalty to reverse: posted to date less the rounded accrual that
 * remains, and never more than the penalty still unpaid on the instalment
 * (penalty already collected is not refunded here).
 */
export function rewindPenalty(i: {
  accruedToDate: string;
  postedToDate: string;
  prevented: string;
  /** Penalty still unpaid on the instalment. */
  unpaid: string;
  rounding: RoundingRule;
}): PenaltyRewindResult {
  const accrued = D.max(ZERO, dec(i.accruedToDate, 'accruedToDate').minus(dec(i.prevented, 'prevented')));
  const posted = dec(i.postedToDate, 'postedToDate');
  const target = roundMoney(accrued, i.rounding);
  const wanted = D.max(ZERO, posted.minus(target));
  const reverse: Dec = D.min(wanted, D.max(ZERO, dec(i.unpaid, 'unpaid')));
  return { accruedToDate: accrued.toString(), postedToDate: posted.minus(reverse).toString(), reverse: reverse.toString() };
}
