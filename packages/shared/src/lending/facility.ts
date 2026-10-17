/**
 * Facilities: revolving lines, overdrafts and staged (construction) drawdowns.
 *
 * A facility is a limit a borrower may draw against over an availability
 * period, not a disbursed principal with a schedule. Three behaviours differ
 * in exactly one respect each, so they share one implementation:
 *
 * | Type             | Limit reinstates | Drawdowns | Scheduled principal |
 * |------------------|------------------|-----------|---------------------|
 * | REVOLVING        | yes              | repeated  | no (revolves)       |
 * | OVERDRAFT        | yes              | continuous| no (minimum payment)|
 * | STAGED_DRAWDOWN  | no               | tranches  | term-out at expiry  |
 *
 * Interest is charged on the *drawn* balance day by day, never on the limit,
 * so the engine works from a movement history rather than a schedule. The
 * per-day arithmetic is delegated to `dailyAccrual`, which already implements
 * the contractual day-count denominators, so a facility and a term loan accrue
 * interest through exactly the same code path.
 *
 * Every amount crossing this module's boundary is a decimal string.
 */
import { Dec, dec, EngineError, ZERO, sum } from './decimal.js';
import { RoundingRule, roundMoney, parseMoney, isRepresentable } from './money.js';
import { LocalDate, compareDates, parseDate, assertDayCount } from './dates.js';
import { AccrualSegment, dailyAccrual } from './servicing.js';

export const FACILITY_TYPES = ['REVOLVING', 'OVERDRAFT', 'STAGED_DRAWDOWN'] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

/**
 * Whether repaying restores headroom.
 *
 * A revolving line and an overdraft are limits on the *outstanding* balance:
 * repaying frees the limit again. A staged drawdown is a limit on the *total
 * advanced*: repaying a construction loan does not entitle the borrower to
 * draw the money a second time.
 */
export function limitReinstates(type: FacilityType): boolean {
  return type !== 'STAGED_DRAWDOWN';
}

export interface FacilityTranche {
  code: string;
  amount: string;
  /** The tranche cannot be released before this date. */
  availableFrom: LocalDate;
  /** Condition codes that must be satisfied before release. */
  conditions: string[];
}

export interface FacilityTerms {
  type: FacilityType;
  currency: string;
  /** The committed limit. */
  limitAmount: string;
  /** Drawdowns are permitted from this date (inclusive). */
  availabilityStart: LocalDate;
  /** Drawdowns are permitted up to this date (inclusive); the line terms out after it. */
  availabilityEnd: LocalDate;
  /** Everything outstanding is repayable by this date. */
  maturityDate: LocalDate;
  /** Annual rate on the drawn balance, as a decimal fraction (0.12 = 12%). */
  annualRate: string;
  dayCount: string;
  rounding: RoundingRule;
  /** Smallest single drawdown, or null for no floor. */
  minimumDrawdown: string | null;
  /** Largest single drawdown, or null for no cap beyond the available limit. */
  maximumDrawdown: string | null;
  /** Annual fee on the *undrawn* commitment, or null if none is charged. */
  commitmentFeeRate: string | null;
  /** OVERDRAFT: minimum payment as a fraction of the debit balance. */
  minimumPaymentRate: string | null;
  /** OVERDRAFT: absolute floor under the minimum payment. */
  minimumPaymentFloor: string | null;
  /**
   * Annual rate charged on any balance *above* the limit. Null refuses
   * over-limit balances outright; a rate prices them instead.
   */
  overlimitRate: string | null;
  /**
   * How far above the limit a drawdown may take the balance, as a fraction
   * of the limit (UC-41). Needs an over-limit rate; null or 0: none.
   */
  overlimitTolerance?: string | null;
  /** STAGED_DRAWDOWN: the agreed tranches. Empty for the other types. */
  tranches: FacilityTranche[];
}

export type FacilityMovementType = 'DRAWDOWN' | 'REPAYMENT' | 'CAPITALIZATION';

export interface FacilityMovement {
  /** Value date the movement changes the balance on. */
  date: LocalDate;
  type: FacilityMovementType;
  /** Always positive; the type decides the direction. */
  amount: string;
  /** STAGED_DRAWDOWN: which tranche a drawdown released. */
  trancheCode?: string;
}

// ── Terms validation ────────────────────────────────────────────────────────

export interface FacilityIssue {
  path: string;
  message: string;
}

/**
 * Validate the terms themselves, independently of any movement history.
 *
 * Called when a facility is created and again before it is activated, so a
 * contradictory limit or availability window can never reach the servicing
 * path where a drawdown would be priced against it.
 */
export function validateFacilityTerms(t: FacilityTerms): FacilityIssue[] {
  const issues: FacilityIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!FACILITY_TYPES.includes(t.type)) {
    add('type', `Unknown facility type ${JSON.stringify(t.type)}.`);
    return issues;
  }
  try {
    assertDayCount(t.dayCount);
  } catch {
    add('dayCount', `Unsupported day count ${JSON.stringify(t.dayCount)}.`);
  }
  if (t.dayCount === 'THIRTY_360_ISDA' || t.dayCount === 'THIRTY_E_360') {
    add('dayCount', `${t.dayCount} is a period convention; a facility accrues daily on a fluctuating balance and needs an actual-days convention.`);
  }

  let limit = ZERO;
  try {
    limit = parseMoney(t.limitAmount, t.currency, 'limitAmount');
    if (limit.lte(0)) add('limitAmount', 'The facility limit must be greater than zero.');
  } catch (e) {
    add('limitAmount', (e as Error).message);
  }

  if (compareDates(t.availabilityEnd, t.availabilityStart) < 0) {
    add('availabilityEnd', `The availability period ends (${t.availabilityEnd}) before it starts (${t.availabilityStart}).`);
  }
  if (compareDates(t.maturityDate, t.availabilityEnd) < 0) {
    add('maturityDate', `Maturity (${t.maturityDate}) is before the end of availability (${t.availabilityEnd}); the borrower could not repay what they are entitled to draw.`);
  }

  const rate = safeRate(t.annualRate, 'annualRate', add);
  if (rate && rate.lt(0)) add('annualRate', 'The facility rate cannot be negative.');

  if (t.commitmentFeeRate !== null) {
    const c = safeRate(t.commitmentFeeRate, 'commitmentFeeRate', add);
    if (c && c.lt(0)) add('commitmentFeeRate', 'The commitment fee rate cannot be negative.');
  }
  if (t.overlimitRate !== null) {
    const o = safeRate(t.overlimitRate, 'overlimitRate', add);
    if (o && o.lt(0)) add('overlimitRate', 'The over-limit rate cannot be negative.');
  }

  const min = t.minimumDrawdown === null ? null : safeMoney(t.minimumDrawdown, t.currency, 'minimumDrawdown', add);
  const max = t.maximumDrawdown === null ? null : safeMoney(t.maximumDrawdown, t.currency, 'maximumDrawdown', add);
  if (min && max && min.gt(max)) {
    add('minimumDrawdown', `The minimum drawdown (${t.minimumDrawdown}) exceeds the maximum (${t.maximumDrawdown}).`);
  }
  if (max && limit.gt(0) && max.gt(limit)) {
    add('maximumDrawdown', `The maximum drawdown (${t.maximumDrawdown}) exceeds the facility limit (${t.limitAmount}).`);
  }

  // Overdraft-only and staged-only terms must not leak across types.
  if (t.type === 'OVERDRAFT') {
    if (t.minimumPaymentRate === null && t.minimumPaymentFloor === null) {
      add('minimumPaymentRate', 'An overdraft needs a minimum payment rate or floor; otherwise nothing is ever due.');
    }
    if (t.minimumPaymentRate !== null) {
      const r = safeRate(t.minimumPaymentRate, 'minimumPaymentRate', add);
      if (r && (r.lte(0) || r.gt(1))) add('minimumPaymentRate', 'The minimum payment rate must be greater than 0 and at most 1.');
    }
    if (t.minimumPaymentFloor !== null) safeMoney(t.minimumPaymentFloor, t.currency, 'minimumPaymentFloor', add);
  } else if (t.minimumPaymentRate !== null || t.minimumPaymentFloor !== null) {
    add('minimumPaymentRate', `Minimum payment terms apply to an overdraft, not to a ${t.type} facility.`);
  }

  if (t.type === 'STAGED_DRAWDOWN') {
    if (!t.tranches.length) add('tranches', 'A staged drawdown facility must define at least one tranche.');
    const seen = new Set<string>();
    let total = ZERO;
    t.tranches.forEach((tr, i) => {
      if (seen.has(tr.code)) add(`tranches[${i}].code`, `Duplicate tranche code ${tr.code}.`);
      seen.add(tr.code);
      const amount = safeMoney(tr.amount, t.currency, `tranches[${i}].amount`, add);
      if (amount) {
        if (amount.lte(0)) add(`tranches[${i}].amount`, 'A tranche must be greater than zero.');
        total = total.plus(amount);
      }
      if (compareDates(tr.availableFrom, t.availabilityEnd) > 0) {
        add(`tranches[${i}].availableFrom`, `Tranche ${tr.code} becomes available (${tr.availableFrom}) after the facility stops being available (${t.availabilityEnd}).`);
      }
    });
    if (limit.gt(0) && total.gt(limit)) {
      add('tranches', `The tranches total ${total.toString()}, which exceeds the facility limit of ${t.limitAmount}.`);
    }
  } else if (t.tranches.length) {
    add('tranches', `Tranches apply to a staged drawdown facility, not to a ${t.type} facility.`);
  }

  return issues;
}

function safeRate(value: string, path: string, add: (p: string, m: string) => void): Dec | null {
  try {
    return dec(value, path);
  } catch (e) {
    add(path, (e as Error).message);
    return null;
  }
}

function safeMoney(value: string, currency: string, path: string, add: (p: string, m: string) => void): Dec | null {
  try {
    return parseMoney(value, currency, path);
  } catch (e) {
    add(path, (e as Error).message);
    return null;
  }
}

// ── Position ────────────────────────────────────────────────────────────────

export interface FacilityPosition {
  /** Outstanding balance the borrower owes in principal terms. */
  outstanding: string;
  /** Everything ever advanced, regardless of repayment. */
  totalDrawn: string;
  /** Everything ever repaid against principal. */
  totalRepaid: string;
  /** Headroom still drawable today, floored at zero. */
  available: string;
  /** Outstanding ÷ limit, as a decimal fraction. */
  utilization: string;
  /** Balance in excess of the limit, floored at zero. */
  overlimit: string;
  /** Tranche codes already released (staged drawdowns). */
  releasedTranches: string[];
}

/** Movements in value-date order; ties keep their given order (stable sort). */
function ordered(movements: FacilityMovement[]): FacilityMovement[] {
  return movements
    .map((m, i) => ({ m, i }))
    .sort((a, b) => compareDates(a.m.date, b.m.date) || a.i - b.i)
    .map((x) => x.m);
}

/**
 * The facility's state as at `asOf` (inclusive of movements on that date).
 *
 * `available` is where the three types diverge: a reinstating limit measures
 * headroom against the outstanding balance, a staged drawdown against the
 * cumulative amount advanced.
 */
export function facilityPosition(terms: FacilityTerms, movements: FacilityMovement[], asOf: LocalDate): FacilityPosition {
  parseDate(asOf, 'asOf');
  const limit = parseMoney(terms.limitAmount, terms.currency, 'limitAmount');
  let outstanding = ZERO;
  let totalDrawn = ZERO;
  let totalRepaid = ZERO;
  const releasedTranches: string[] = [];

  for (const m of ordered(movements)) {
    if (compareDates(m.date, asOf) > 0) break;
    const amount = parseMoney(m.amount, terms.currency, 'movement.amount');
    if (amount.lt(0)) throw new EngineError('INVALID_MOVEMENT', `A ${m.type} movement on ${m.date} has a negative amount; the type carries the direction.`);
    if (m.type === 'DRAWDOWN') {
      outstanding = outstanding.plus(amount);
      totalDrawn = totalDrawn.plus(amount);
      if (m.trancheCode) releasedTranches.push(m.trancheCode);
    } else if (m.type === 'REPAYMENT') {
      outstanding = outstanding.minus(amount);
      totalRepaid = totalRepaid.plus(amount);
    } else {
      // Capitalized interest or fees become principal: they consume headroom
      // but are not an advance of new money, so they do not count as drawn.
      outstanding = outstanding.plus(amount);
    }
  }

  const consumed = limitReinstates(terms.type) ? outstanding : totalDrawn;
  const available = limit.minus(consumed);
  // A staged limit caps what is advanced; capitalized interest on top of it
  // (a project's construction interest) is not an over-limit drawing.
  const overlimit = consumed.minus(limit);

  return {
    outstanding: outstanding.toString(),
    totalDrawn: totalDrawn.toString(),
    totalRepaid: totalRepaid.toString(),
    available: (available.lt(0) ? ZERO : available).toString(),
    utilization: limit.isZero() ? '0' : outstanding.div(limit).toString(),
    overlimit: (overlimit.lt(0) ? ZERO : overlimit).toString(),
    releasedTranches,
  };
}

// ── Drawdown eligibility ────────────────────────────────────────────────────

export interface DrawdownRequest {
  date: LocalDate;
  amount: string;
  trancheCode?: string;
  /** Condition codes satisfied so far (staged drawdowns). */
  satisfiedConditions?: string[];
}

export interface DrawdownCheck {
  ok: boolean;
  issues: FacilityIssue[];
  /** The position the drawdown would leave behind, when it is permitted. */
  resulting: FacilityPosition | null;
}

/**
 * Decide whether a drawdown may be released.
 *
 * Every refusal is reported rather than thrown, and all of them are collected,
 * so an operator sees every reason at once instead of fixing them one at a
 * time. A facility that is not available, exhausted or past maturity simply
 * accumulates issues here; nothing else in the servicing path re-checks them.
 */
export function checkDrawdown(terms: FacilityTerms, movements: FacilityMovement[], req: DrawdownRequest): DrawdownCheck {
  const issues: FacilityIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  let amount: Dec;
  try {
    amount = parseMoney(req.amount, terms.currency, 'amount');
  } catch (e) {
    return { ok: false, issues: [{ path: 'amount', message: (e as Error).message }], resulting: null };
  }
  if (amount.lte(0)) add('amount', 'A drawdown must be greater than zero.');
  if (!isRepresentable(amount, terms.currency)) {
    add('amount', `${amount.toString()} is finer than ${terms.currency} can settle.`);
  }

  if (compareDates(req.date, terms.availabilityStart) < 0) {
    add('date', `The facility is not available until ${terms.availabilityStart}.`);
  }
  if (compareDates(req.date, terms.availabilityEnd) > 0) {
    add('date', `The availability period ended on ${terms.availabilityEnd}; no further drawdowns are permitted.`);
  }

  const position = facilityPosition(terms, movements, req.date);
  const available = dec(position.available, 'available');
  // UC-41: a priced over-limit allowance lets a drawdown run past the limit, up to the tolerance.
  const tolerance =
    terms.overlimitRate !== null && terms.overlimitTolerance && terms.type !== 'STAGED_DRAWDOWN'
      ? roundMoney(dec(terms.limitAmount, 'limitAmount').times(dec(terms.overlimitTolerance, 'overlimitTolerance')), terms.rounding)
      : ZERO;
  if (amount.gt(available.plus(tolerance))) {
    add(
      'amount',
      tolerance.gt(0)
        ? `Drawing ${amount.toString()} would exceed the available limit of ${position.available} plus the over-limit allowance of ${tolerance.toString()}.`
        : `Drawing ${amount.toString()} would exceed the available limit of ${position.available}.`,
    );
  }
  if (terms.minimumDrawdown !== null) {
    const min = dec(terms.minimumDrawdown, 'minimumDrawdown');
    // The final drawdown of a line may legitimately be smaller than the floor.
    if (amount.lt(min) && amount.lt(available)) {
      add('amount', `The minimum drawdown is ${terms.minimumDrawdown}.`);
    }
  }
  if (terms.maximumDrawdown !== null && amount.gt(dec(terms.maximumDrawdown, 'maximumDrawdown'))) {
    add('amount', `The maximum single drawdown is ${terms.maximumDrawdown}.`);
  }

  if (terms.type === 'STAGED_DRAWDOWN') {
    checkTranche(terms, position, req, amount, add);
  } else if (req.trancheCode) {
    add('trancheCode', `A ${terms.type} facility has no tranches.`);
  }

  if (issues.length) return { ok: false, issues, resulting: null };
  const resulting = facilityPosition(terms, [...movements, { date: req.date, type: 'DRAWDOWN', amount: req.amount, trancheCode: req.trancheCode }], req.date);
  return { ok: true, issues, resulting };
}

function checkTranche(
  terms: FacilityTerms,
  position: FacilityPosition,
  req: DrawdownRequest,
  amount: Dec,
  add: (p: string, m: string) => void,
): void {
  if (!req.trancheCode) {
    add('trancheCode', 'A staged drawdown must name the tranche it releases.');
    return;
  }
  const tranche = terms.tranches.find((t) => t.code === req.trancheCode);
  if (!tranche) {
    add('trancheCode', `Unknown tranche ${req.trancheCode}.`);
    return;
  }
  if (position.releasedTranches.includes(tranche.code)) {
    add('trancheCode', `Tranche ${tranche.code} has already been released.`);
  }
  if (compareDates(req.date, tranche.availableFrom) < 0) {
    add('date', `Tranche ${tranche.code} is not available until ${tranche.availableFrom}.`);
  }
  if (!amount.eq(dec(tranche.amount, 'tranche.amount'))) {
    add('amount', `Tranche ${tranche.code} releases exactly ${tranche.amount}; staged drawdowns are not partially released.`);
  }
  const satisfied = new Set(req.satisfiedConditions ?? []);
  const outstandingConditions = tranche.conditions.filter((c) => !satisfied.has(c));
  if (outstandingConditions.length) {
    add('conditions', `Tranche ${tranche.code} has unsatisfied conditions: ${outstandingConditions.join(', ')}.`);
  }
}

// ── Balance timeline and interest ───────────────────────────────────────────

export interface BalanceSegment {
  from: LocalDate;
  /** Exclusive. */
  to: LocalDate;
  balance: string;
}

/**
 * The drawn balance over `[from, to)`, as one segment per constant-balance run.
 *
 * Movements dated on or after `to` are ignored; movements before `from` are
 * folded into the opening balance. A movement dated exactly on a segment
 * boundary changes the balance from that day inclusive, so interest is charged
 * on a drawdown from its value date and stops on a repayment's value date.
 */
export function balanceTimeline(terms: FacilityTerms, movements: FacilityMovement[], from: LocalDate, to: LocalDate): BalanceSegment[] {
  if (compareDates(to, from) < 0) throw new EngineError('INVALID_PERIOD', `The period ends (${to}) before it starts (${from}).`);
  if (compareDates(to, from) === 0) return [];

  const sorted = ordered(movements);
  let balance = ZERO;
  for (const m of sorted) {
    if (compareDates(m.date, from) >= 0) break;
    balance = applyMovement(balance, m, terms.currency);
  }

  const segments: BalanceSegment[] = [];
  let cursor = from;
  for (const m of sorted) {
    if (compareDates(m.date, from) < 0) continue;
    if (compareDates(m.date, to) >= 0) break;
    if (compareDates(m.date, cursor) > 0) {
      segments.push({ from: cursor, to: m.date, balance: balance.toString() });
      cursor = m.date;
    }
    balance = applyMovement(balance, m, terms.currency);
  }
  if (compareDates(cursor, to) < 0) {
    segments.push({ from: cursor, to, balance: balance.toString() });
  }
  return segments;
}

function applyMovement(balance: Dec, m: FacilityMovement, currency: string): Dec {
  const amount = parseMoney(m.amount, currency, 'movement.amount');
  return m.type === 'REPAYMENT' ? balance.minus(amount) : balance.plus(amount);
}

export interface FacilityInterest {
  /** Interest on the balance up to the limit, rounded. */
  interest: string;
  /** Interest on any balance above the limit, rounded. Zero when none. */
  overlimitInterest: string;
  total: string;
  days: number;
  segments: { from: LocalDate; to: LocalDate; balance: string; interest: string }[];
}

/**
 * Interest on the drawn balance over `[from, to)`.
 *
 * A balance above the limit is split out and priced at `overlimitRate`, so the
 * penalty element is visible on the statement and postable to its own account
 * rather than buried in ordinary interest. A negative balance (an overdraft in
 * credit) earns nothing — the engine does not pay credit interest.
 */
export function accrueFacilityInterest(terms: FacilityTerms, movements: FacilityMovement[], from: LocalDate, to: LocalDate): FacilityInterest {
  const limit = parseMoney(terms.limitAmount, terms.currency, 'limitAmount');
  const timeline = balanceTimeline(terms, movements, from, to);

  const within: AccrualSegment[] = [];
  const above: AccrualSegment[] = [];
  for (const seg of timeline) {
    const balance = dec(seg.balance, 'balance');
    const charged = balance.lt(0) ? ZERO : balance;
    // On a staged limit only advances count against it; a balance above it
    // is capitalized interest and is priced as ordinary interest.
    const overlimit = terms.type !== 'STAGED_DRAWDOWN' && charged.gt(limit) ? charged.minus(limit) : ZERO;
    const base = charged.minus(overlimit);
    within.push({ from: seg.from, to: seg.to, principal: base.toString(), annualRate: terms.annualRate });
    if (overlimit.gt(0)) {
      if (terms.overlimitRate === null) {
        throw new EngineError('OVERLIMIT_NOT_PRICED', `The balance between ${seg.from} and ${seg.to} exceeds the limit but the facility has no over-limit rate.`);
      }
      above.push({ from: seg.from, to: seg.to, principal: overlimit.toString(), annualRate: terms.overlimitRate });
    }
  }

  const base = dailyAccrual(within, terms.dayCount);
  const over = above.length ? dailyAccrual(above, terms.dayCount) : { interest: '0', days: 0, lines: [] };
  const interest = roundMoney(dec(base.interest, 'interest'), terms.rounding);
  const overlimitInterest = roundMoney(dec(over.interest, 'overlimitInterest'), terms.rounding);

  const byIndex = above.length ? indexByPeriod(over.lines) : new Map<string, Dec>();
  const segments = timeline.map((seg, i) => {
    const baseLine = sumLines(base.lines, seg.from, seg.to);
    const overLine = byIndex.get(`${seg.from}|${seg.to}`) ?? ZERO;
    void i;
    return { from: seg.from, to: seg.to, balance: seg.balance, interest: baseLine.plus(overLine).toString() };
  });

  return {
    interest: interest.toString(),
    overlimitInterest: overlimitInterest.toString(),
    total: interest.plus(overlimitInterest).toString(),
    days: base.days,
    segments,
  };
}

/**
 * `dailyAccrual` splits ACT/ACT ISDA segments at the year boundary, so one
 * balance segment can produce several accrual lines. Regroup by the enclosing
 * period rather than assuming a line-per-segment correspondence.
 */
function sumLines(lines: { from: LocalDate; to: LocalDate; interest: string }[], from: LocalDate, to: LocalDate): Dec {
  return sum(
    lines
      .filter((l) => compareDates(l.from, from) >= 0 && compareDates(l.to, to) <= 0)
      .map((l) => dec(l.interest, 'interest')),
  );
}

function indexByPeriod(lines: { from: LocalDate; to: LocalDate; interest: string }[]): Map<string, Dec> {
  const map = new Map<string, Dec>();
  for (const l of lines) {
    const key = `${l.from}|${l.to}`;
    map.set(key, (map.get(key) ?? ZERO).plus(dec(l.interest, 'interest')));
  }
  return map;
}

// ── Commitment fee ──────────────────────────────────────────────────────────

/**
 * Fee on the undrawn commitment over `[from, to)`.
 *
 * Priced exactly like interest — on the daily undrawn amount, at the facility's
 * day count — because a commitment fee is the price of holding capital against
 * money the borrower has not taken. A balance over the limit leaves nothing
 * undrawn, so the undrawn amount is floored at zero.
 */
export function commitmentFee(terms: FacilityTerms, movements: FacilityMovement[], from: LocalDate, to: LocalDate): { fee: string; days: number } {
  if (terms.commitmentFeeRate === null) return { fee: '0', days: 0 };
  const limit = parseMoney(terms.limitAmount, terms.currency, 'limitAmount');
  const segments: AccrualSegment[] = balanceTimeline(terms, movements, from, to).map((seg) => {
    const balance = dec(seg.balance, 'balance');
    const drawn = balance.lt(0) ? ZERO : balance;
    const undrawn = limit.minus(drawn);
    return {
      from: seg.from,
      to: seg.to,
      principal: (undrawn.lt(0) ? ZERO : undrawn).toString(),
      annualRate: terms.commitmentFeeRate as string,
    };
  });
  if (!segments.length) return { fee: '0', days: 0 };
  const accrued = dailyAccrual(segments, terms.dayCount);
  return { fee: roundMoney(dec(accrued.interest, 'fee'), terms.rounding).toString(), days: accrued.days };
}

// ── Overdraft minimum payment ───────────────────────────────────────────────

export interface MinimumPayment {
  /** What the borrower must pay to stay current. */
  amount: string;
  /** Why that figure: the binding constraint. */
  basis: 'RATE' | 'FLOOR' | 'FULL_BALANCE' | 'OVERLIMIT' | 'NONE';
  components: { balanceComponent: string; chargesComponent: string; overlimitComponent: string };
}

/**
 * The minimum an overdraft holder must pay for the period.
 *
 * The figure is the greater of the configured percentage of the debit balance
 * and the absolute floor, plus the period's charges, plus the whole of any
 * over-limit excess — a facility cannot be brought back within its limit by
 * paying a percentage of the overage. It is capped at the full amount owed,
 * because a minimum payment must never exceed the balance.
 */
export function overdraftMinimumPayment(terms: FacilityTerms, outstanding: string, periodCharges: string): MinimumPayment {
  if (terms.type !== 'OVERDRAFT') {
    throw new EngineError('NOT_AN_OVERDRAFT', `A minimum payment is an overdraft term; this facility is ${terms.type}.`);
  }
  const balance = parseMoney(outstanding, terms.currency, 'outstanding');
  const charges = parseMoney(periodCharges, terms.currency, 'periodCharges');
  if (balance.lte(0)) {
    return { amount: '0', basis: 'NONE', components: { balanceComponent: '0', chargesComponent: '0', overlimitComponent: '0' } };
  }

  const limit = parseMoney(terms.limitAmount, terms.currency, 'limitAmount');
  const overlimit = balance.gt(limit) ? balance.minus(limit) : ZERO;
  const withinLimit = balance.minus(overlimit);

  const byRate = terms.minimumPaymentRate === null ? ZERO : withinLimit.times(dec(terms.minimumPaymentRate, 'minimumPaymentRate'));
  const floor = terms.minimumPaymentFloor === null ? ZERO : dec(terms.minimumPaymentFloor, 'minimumPaymentFloor');
  const balanceComponent = byRate.gte(floor) ? byRate : floor;

  let basis: MinimumPayment['basis'] = byRate.gte(floor) ? 'RATE' : 'FLOOR';
  let amount = roundMoney(balanceComponent.plus(charges).plus(overlimit), terms.rounding);
  if (overlimit.gt(0)) basis = 'OVERLIMIT';

  const owed = roundMoney(balance.plus(charges), terms.rounding);
  if (amount.gt(owed)) {
    amount = owed;
    basis = 'FULL_BALANCE';
  }

  return {
    amount: amount.toString(),
    basis,
    components: {
      balanceComponent: roundMoney(balanceComponent, terms.rounding).toString(),
      chargesComponent: charges.toString(),
      overlimitComponent: overlimit.toString(),
    },
  };
}

// ── Statement ───────────────────────────────────────────────────────────────

export interface FacilityStatement {
  periodStart: LocalDate;
  /** Exclusive. */
  periodEnd: LocalDate;
  openingBalance: string;
  drawdowns: string;
  repayments: string;
  interest: string;
  overlimitInterest: string;
  commitmentFee: string;
  /** Opening + drawdowns − repayments, before charges are capitalized. */
  closingBalance: string;
  /** Charges raised for the period: interest + over-limit interest + fee. */
  chargesRaised: string;
  position: FacilityPosition;
  minimumPayment: MinimumPayment | null;
}

/**
 * A period statement: what moved, what was charged and what is now due.
 *
 * Charges are reported separately from the closing balance rather than folded
 * into it. Whether they capitalize is a posting decision for the servicing
 * layer — the engine states the amounts and leaves that choice to the caller.
 */
export function facilityStatement(terms: FacilityTerms, movements: FacilityMovement[], periodStart: LocalDate, periodEnd: LocalDate): FacilityStatement {
  const opening = balanceAt(terms, movements, periodStart);
  const inPeriod = ordered(movements).filter((m) => compareDates(m.date, periodStart) >= 0 && compareDates(m.date, periodEnd) < 0);
  const drawdowns = sum(inPeriod.filter((m) => m.type === 'DRAWDOWN').map((m) => parseMoney(m.amount, terms.currency, 'amount')));
  const repayments = sum(inPeriod.filter((m) => m.type === 'REPAYMENT').map((m) => parseMoney(m.amount, terms.currency, 'amount')));
  const capitalized = sum(inPeriod.filter((m) => m.type === 'CAPITALIZATION').map((m) => parseMoney(m.amount, terms.currency, 'amount')));

  const interest = accrueFacilityInterest(terms, movements, periodStart, periodEnd);
  const fee = commitmentFee(terms, movements, periodStart, periodEnd);
  const chargesRaised = dec(interest.total, 'interest').plus(dec(fee.fee, 'fee'));

  const closing = opening.plus(drawdowns).plus(capitalized).minus(repayments);
  // The closing position is the state on the last day the period covers.
  const position = facilityPosition(terms, movements, periodEnd);

  return {
    periodStart,
    periodEnd,
    openingBalance: opening.toString(),
    drawdowns: drawdowns.toString(),
    repayments: repayments.toString(),
    interest: interest.interest,
    overlimitInterest: interest.overlimitInterest,
    commitmentFee: fee.fee,
    closingBalance: closing.toString(),
    chargesRaised: chargesRaised.toString(),
    position,
    minimumPayment: terms.type === 'OVERDRAFT' ? overdraftMinimumPayment(terms, closing.toString(), chargesRaised.toString()) : null,
  };
}

function balanceAt(terms: FacilityTerms, movements: FacilityMovement[], date: LocalDate): Dec {
  let balance = ZERO;
  for (const m of ordered(movements)) {
    if (compareDates(m.date, date) >= 0) break;
    balance = applyMovement(balance, m, terms.currency);
  }
  return balance;
}

// ── Term-out ────────────────────────────────────────────────────────────────

export interface TermOut {
  /** Balance to amortize from the end of availability. */
  principal: string;
  /** First date the term loan is governed by its own schedule. */
  effectiveDate: LocalDate;
  /** Whole months between term-out and maturity. */
  months: number;
}

/**
 * What a facility converts into when its availability period ends.
 *
 * A staged drawdown is built to term out: construction finishes and the drawn
 * balance amortizes over the remaining life. A revolving line that is not
 * renewed terms out the same way. The engine returns the inputs; building the
 * schedule is `generateSchedule`'s job, so there is still exactly one
 * amortization implementation.
 */
export function termOut(terms: FacilityTerms, movements: FacilityMovement[]): TermOut {
  const effectiveDate = terms.availabilityEnd;
  const principal = balanceAt(terms, movements, effectiveDate);
  if (principal.lte(0)) {
    throw new EngineError('NOTHING_TO_TERM_OUT', `The facility has no balance on ${effectiveDate}; there is nothing to amortize.`);
  }
  const start = parseDate(effectiveDate);
  const end = parseDate(terms.maturityDate);
  let months = (end.y - start.y) * 12 + (end.m - start.m);
  if (end.d < start.d) months -= 1;
  if (months < 1) {
    throw new EngineError('TERM_OUT_TOO_SHORT', `There is less than a month between the end of availability (${effectiveDate}) and maturity (${terms.maturityDate}).`);
  }
  return { principal: principal.toString(), effectiveDate, months };
}
