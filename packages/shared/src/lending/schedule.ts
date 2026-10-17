import { D, Dec, dec, EngineError, ONE, ZERO, sum } from './decimal.js';
import { RoundingRule, defaultRounding, getCurrency, roundMoney, validateRoundingRule, parseMoney } from './money.js';
import {
  BusinessDayConvention,
  HolidayCalendar,
  LocalDate,
  addDays,
  addMonths,
  adjustBusinessDay,
  assertDayCount,
  compareDates,
  dayCountDays,
  parseDate,
  yearFraction,
} from './dates.js';
import { incomeContingentSchedule, type IncomeContingentContract } from './income-contingent.js';

/** Bumped whenever a change could alter any computed schedule. Recorded on every calculation. */
export const LENDING_ENGINE_VERSION = '1.0.0';

export type RepaymentMethod = 'EQUAL_INSTALMENT' | 'EQUAL_PRINCIPAL' | 'INTEREST_ONLY' | 'BALLOON' | 'EXPLICIT';
export type InterestMethod = 'REDUCING_BALANCE' | 'FLAT';
export type RateConvention = 'NOMINAL' | 'EFFECTIVE';
/**
 * PERIODIC: one periodic rate per equal period (r/12 for monthly nominal).
 * DAILY: interest over the actual accrual interval under the day-count convention.
 */
export type AccrualBasis = 'PERIODIC' | 'DAILY';
export type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | 'CUSTOM';

export interface CustomFrequency {
  unit: 'DAY' | 'WEEK' | 'MONTH';
  every: number;
}

export interface RatePoint {
  effectiveFrom: LocalDate;
  /** Annual rate as a decimal fraction string, e.g. '0.12' for 12%. */
  annualRate: string;
  source: string;
  /** True when the rate is a projection (e.g. a floating benchmark held flat). */
  projected?: boolean;
}

export interface ExplicitInstalment {
  dueDate: LocalDate;
  principal: string;
}

export interface ScheduleInput {
  principal: string;
  currency: string;
  rounding?: RoundingRule;
  disbursementDate: LocalDate;
  /** Annual rate as a decimal fraction. Ignored when `rates` is supplied. */
  annualRate?: string;
  /** Rate timeline for floating or stepped pricing. The first point must apply at disbursement. */
  rates?: RatePoint[];
  rateConvention: RateConvention;
  interestMethod: InterestMethod;
  accrualBasis: AccrualBasis;
  dayCount: string;
  /** Decimal places the periodic rate is rounded to before use. Recorded for audit. */
  ratePrecision?: number;
  method: RepaymentMethod;
  frequency?: Frequency;
  customFrequency?: CustomFrequency;
  numberOfInstalments?: number;
  /** Irregular first due date. Requires DAILY accrual unless it equals one regular period. */
  firstDueDate?: LocalDate;
  /** Instalments at the start in which no principal is due (interest is paid). */
  principalGraceInstalments?: number;
  /** Instalments at the start in which nothing is paid and interest is capitalized. */
  interestGraceInstalments?: number;
  /**
   * How interest is capitalized during that grace: COMPOUND (default) charges
   * each period on the balance including interest already capitalized;
   * SIMPLE charges every grace period on the principal at the start, so no
   * interest is charged on interest (TV-13, TV-16).
   */
  graceCapitalization?: 'COMPOUND' | 'SIMPLE';
  balloonAmount?: string;
  explicitSchedule?: ExplicitInstalment[];
  businessDayConvention?: BusinessDayConvention;
  calendar?: HolidayCalendar;
  /** Whether interest accrues to the unadjusted or the business-day-adjusted date. */
  accrualDateBasis?: 'UNADJUSTED' | 'ADJUSTED';
  /**
   * Stepped instalments (UC-15): consecutive runs of repayment instalments,
   * each paying `multiplier` × a base instalment solved so the loan closes.
   * Instalments after the listed runs pay the base (multiplier 1).
   */
  instalmentSteps?: InstalmentStep[];
  /**
   * Income-contingent repayment: the instalment is a share of the declared
   * income above a threshold, not an annuity (income-contingent.ts).
   */
  incomeContingent?: IncomeContingentContract;
}

export interface InstalmentStep {
  instalments: number;
  /** Relative size of these instalments, e.g. '0.5' for half, '1.5' for half again. */
  multiplier: string;
}

export type LineKind = 'CAPITALIZATION' | 'INTEREST_ONLY' | 'AMORTIZING' | 'FINAL';

export interface ScheduleLine {
  number: number;
  periodStart: LocalDate;
  periodEnd: LocalDate;
  dueDate: LocalDate;
  accrualDays: number;
  annualRate: string;
  periodicRate: string;
  openingPrincipal: string;
  principal: string;
  interest: string;
  capitalizedInterest: string;
  total: string;
  closingPrincipal: string;
  kind: LineKind;
  /** True when the amount depends on a projected (not contractually fixed) rate. */
  projected: boolean;
}

export interface ScheduleResult {
  engineVersion: string;
  currency: string;
  rounding: RoundingRule;
  lines: ScheduleLine[];
  totals: {
    principal: string;
    interest: string;
    capitalizedInterest: string;
    payments: string;
  };
  /** The level instalment where the method has one (before the final residual). */
  instalmentAmount: string | null;
  /** Final instalment minus the level instalment: the absorbed rounding residual. */
  finalResidual: string | null;
  maturityDate: LocalDate;
  periodicRateConvention: string;
  explanation: string[];
  hasProjectedAmounts: boolean;
}

// ── Periods ─────────────────────────────────────────────────────────────────

export interface Period {
  start: LocalDate;
  end: LocalDate;
  dueDate: LocalDate;
}

const PERIODS_PER_YEAR: Record<Exclude<Frequency, 'CUSTOM'>, number> = {
  WEEKLY: 52,
  FORTNIGHTLY: 26,
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMI_ANNUAL: 2,
  ANNUAL: 1,
};

function stepper(frequency: Frequency, custom?: CustomFrequency): { step: (anchor: LocalDate, k: number, anchorDay: number) => LocalDate; ppy: Dec | null; label: string } {
  const months = (n: number) => (anchor: LocalDate, k: number, anchorDay: number) => addMonths(anchor, n * k, anchorDay);
  const days = (n: number) => (anchor: LocalDate, k: number) => addDays(anchor, n * k);
  switch (frequency) {
    case 'WEEKLY':
      return { step: days(7), ppy: new D(52), label: 'weekly' };
    case 'FORTNIGHTLY':
      return { step: days(14), ppy: new D(26), label: 'fortnightly' };
    case 'MONTHLY':
      return { step: months(1), ppy: new D(12), label: 'monthly' };
    case 'QUARTERLY':
      return { step: months(3), ppy: new D(4), label: 'quarterly' };
    case 'SEMI_ANNUAL':
      return { step: months(6), ppy: new D(2), label: 'semi-annual' };
    case 'ANNUAL':
      return { step: months(12), ppy: new D(1), label: 'annual' };
    case 'CUSTOM': {
      if (!custom || !Number.isInteger(custom.every) || custom.every < 1) {
        throw new EngineError('INVALID_FREQUENCY', 'A custom frequency needs a unit and a positive whole "every".');
      }
      if (custom.unit === 'MONTH') return { step: months(custom.every), ppy: new D(12).div(custom.every), label: `every ${custom.every} month(s)` };
      if (custom.unit === 'WEEK') return { step: days(7 * custom.every), ppy: new D(52).div(custom.every), label: `every ${custom.every} week(s)` };
      // A day-based period has no exact periodic rate; it is only valid with DAILY accrual.
      return { step: days(custom.every), ppy: null, label: `every ${custom.every} day(s)` };
    }
  }
}

interface BuiltPeriods {
  periods: Period[];
  regular: boolean;
  ppy: Dec | null;
  frequencyLabel: string;
}

export function buildPeriods(input: ScheduleInput): BuiltPeriods {
  const bdc = input.businessDayConvention ?? 'NONE';
  const accrueAdjusted = input.accrualDateBasis === 'ADJUSTED';
  const adjust = (d: LocalDate) => adjustBusinessDay(d, bdc, input.calendar);

  if (input.method === 'EXPLICIT') {
    const rows = input.explicitSchedule ?? [];
    if (rows.length === 0) throw new EngineError('INVALID_SCHEDULE', 'An explicit schedule needs at least one dated instalment.');
    const periods: Period[] = [];
    let start = input.disbursementDate;
    for (const row of rows) {
      parseDate(row.dueDate, 'explicitSchedule.dueDate');
      if (compareDates(row.dueDate, start) <= 0) {
        throw new EngineError('INVALID_SCHEDULE', `Explicit due date ${row.dueDate} must fall after ${start}.`);
      }
      const dueDate = adjust(row.dueDate);
      const end = accrueAdjusted ? dueDate : row.dueDate;
      periods.push({ start, end, dueDate });
      start = end;
    }
    return { periods, regular: false, ppy: null, frequencyLabel: 'explicitly dated' };
  }

  const n = input.numberOfInstalments;
  if (!n || !Number.isInteger(n) || n < 1 || n > 1200) {
    throw new EngineError('INVALID_TERM', 'numberOfInstalments must be a whole number between 1 and 1200.');
  }
  const frequency = input.frequency ?? 'MONTHLY';
  const { step, ppy, label } = stepper(frequency, input.customFrequency);

  const disb = input.disbursementDate;
  parseDate(disb, 'disbursementDate');
  const regularFirst = step(disb, 1, parseDate(disb).d);
  let anchor = disb;
  let offset = 0;
  let regular = true;
  if (input.firstDueDate) {
    parseDate(input.firstDueDate, 'firstDueDate');
    if (compareDates(input.firstDueDate, disb) <= 0) throw new EngineError('INVALID_SCHEDULE', 'firstDueDate must fall after disbursementDate.');
    if (input.firstDueDate !== regularFirst) {
      regular = false;
      anchor = input.firstDueDate;
      offset = -1; // k=1 → firstDueDate
    }
  }
  const anchorDay = parseDate(anchor).d;
  const periods: Period[] = [];
  let start = disb;
  for (let k = 1; k <= n; k++) {
    const unadjusted = step(anchor, k + offset, anchorDay);
    const dueDate = adjust(unadjusted);
    const end = accrueAdjusted ? dueDate : unadjusted;
    periods.push({ start, end, dueDate });
    start = end;
  }
  if (accrueAdjusted && bdc !== 'NONE') regular = false;
  return { periods, regular, ppy, frequencyLabel: label };
}

// ── Rates and factors ───────────────────────────────────────────────────────

interface RateContext {
  convention: RateConvention;
  basis: AccrualBasis;
  dayCount: string;
  ppy: Dec | null;
  precision: number;
}

/** The interest factor i for one period at an annual rate. Interest = opening × i. */
export function periodFactor(period: Period, annualRate: Dec, ctx: RateContext): Dec {
  let factor: Dec;
  if (ctx.basis === 'PERIODIC') {
    if (!ctx.ppy) throw new EngineError('INVALID_FREQUENCY', 'PERIODIC accrual needs a frequency with a whole number of periods per year.');
    factor =
      ctx.convention === 'NOMINAL'
        ? annualRate.div(ctx.ppy)
        : // (1 + r)^(1/ppy) − 1
          ONE.plus(annualRate).pow(ONE.div(ctx.ppy)).minus(ONE);
  } else {
    const yf = yearFraction(period.start, period.end, ctx.dayCount);
    factor = ctx.convention === 'NOMINAL' ? annualRate.times(yf) : ONE.plus(annualRate).pow(yf).minus(ONE);
  }
  return factor.toDecimalPlaces(ctx.precision);
}

export function rateAt(rates: RatePoint[], date: LocalDate): RatePoint {
  let current: RatePoint | undefined;
  for (const point of rates) {
    if (compareDates(point.effectiveFrom, date) <= 0) current = point;
  }
  if (!current) throw new EngineError('MISSING_RATE', `No interest rate is effective on ${date}.`);
  return current;
}

function normalizeRates(input: ScheduleInput): RatePoint[] {
  const points = input.rates?.length
    ? [...input.rates]
    : input.annualRate !== undefined
      ? [{ effectiveFrom: input.disbursementDate, annualRate: input.annualRate, source: 'CONTRACT_FIXED' }]
      : [];
  if (points.length === 0) throw new EngineError('MISSING_RATE', 'An annual rate or a rate timeline is required.');
  for (const p of points) {
    parseDate(p.effectiveFrom, 'rates.effectiveFrom');
    const r = dec(p.annualRate, 'annualRate');
    if (r.lt(0)) throw new EngineError('INVALID_RATE', 'Interest rates cannot be negative.');
    if (r.gt(10)) throw new EngineError('INVALID_RATE', `Annual rate ${p.annualRate} looks like a percentage; pass a decimal fraction (0.12 for 12%).`);
  }
  points.sort((a, b) => compareDates(a.effectiveFrom, b.effectiveFrom));
  if (compareDates(points[0].effectiveFrom, input.disbursementDate) > 0) {
    throw new EngineError('MISSING_RATE', 'The rate timeline must start on or before the disbursement date.');
  }
  return points;
}

// ── Amortization core ───────────────────────────────────────────────────────

export interface AmortizeRequest {
  method: RepaymentMethod;
  interestMethod: InterestMethod;
  currency: string;
  rounding: RoundingRule;
  periods: Period[];
  rates: RatePoint[];
  rateContext: RateContext;
  opening: Dec;
  principalGrace: number;
  interestGrace: number;
  graceCapitalization?: 'COMPOUND' | 'SIMPLE';
  balloon: Dec;
  explicitPrincipal?: Dec[];
  /** Keep this level instalment instead of solving for one (prepayment "shorten tenor"). */
  fixedInstalment?: Dec;
  /** Interest for the first period supplied by the caller (mid-period prepayment). */
  firstPeriodInterestOverride?: Dec;
  /** Per-period weight of a level instalment (stepped instalments); 1 when absent. */
  stepMultipliers?: Dec[];
  firstLineNumber?: number;
}

/**
 * Level payment over periods with arbitrary per-period factors, leaving
 * `residual` (a balloon) outstanding after the last payment:
 *
 *   A = (B·Π(1+iₖ) − F) / Σₖ Π_{j>k}(1+iⱼ)
 *
 * With equal factors this is exactly A = [P − F/(1+i)ⁿ]·i / [1 − (1+i)⁻ⁿ],
 * and with F = 0 the standard annuity. It needs no equal-period assumption,
 * which is why irregular dated periods use it instead of the textbook formula.
 */
export function levelPayment(balance: Dec, factors: Dec[], residual: Dec, weights?: Dec[]): Dec {
  // With weights wₖ the k-th payment is wₖ·A, so the denominator weights each term.
  const w = (k: number) => weights?.[k] ?? ONE;
  let growth = ONE;
  for (const f of factors) growth = growth.times(ONE.plus(f));
  let denominator = ZERO;
  let tail = ONE;
  for (let k = factors.length - 1; k >= 0; k--) {
    denominator = denominator.plus(tail.times(w(k)));
    tail = tail.times(ONE.plus(factors[k]));
  }
  if (factors.every((f) => f.isZero())) {
    return balance.minus(residual).div(factors.reduce((acc, _f, k) => acc.plus(w(k)), ZERO));
  }
  return balance.times(growth).minus(residual).div(denominator);
}

/** Per-period weights for stepped instalments; grace periods weigh 1 and are never paid as level instalments. */
export function stepWeights(steps: InstalmentStep[] | undefined, periods: number, amortStart: number): Dec[] | undefined {
  if (!steps?.length) return undefined;
  const out: Dec[] = Array.from({ length: periods }, () => ONE);
  let k = amortStart;
  for (const [i, st] of steps.entries()) {
    if (!Number.isInteger(st.instalments) || st.instalments < 1) throw new EngineError('INVALID_STEPS', `instalmentSteps[${i}].instalments must be a positive whole number.`);
    const m = dec(st.multiplier, `instalmentSteps[${i}].multiplier`);
    if (m.lte(0)) throw new EngineError('INVALID_STEPS', `instalmentSteps[${i}].multiplier must be positive.`);
    for (let j = 0; j < st.instalments; j++, k++) {
      if (k >= periods) throw new EngineError('INVALID_STEPS', 'The instalment steps run past the last instalment.');
      out[k] = m;
    }
  }
  return out;
}

interface RawLine {
  period: Period;
  opening: Dec;
  principal: Dec;
  interest: Dec;
  capitalized: Dec;
  annualRate: Dec;
  factor: Dec;
  kind: LineKind;
  projected: boolean;
}

export function amortize(req: AmortizeRequest): { lines: RawLine[]; instalment: Dec | null } {
  const { periods, rounding } = req;
  const n = periods.length;
  const round = (x: Dec) => roundMoney(x, rounding);
  if (req.principalGrace < 0 || req.interestGrace < 0 || req.interestGrace > req.principalGrace) {
    throw new EngineError('INVALID_GRACE', 'Interest grace cannot exceed principal grace, and neither can be negative.');
  }
  if (req.principalGrace >= n) {
    throw new EngineError('INVALID_GRACE', 'Grace periods must leave at least one repayment instalment.');
  }

  const rateFor = (p: Period) => rateAt(req.rates, p.start);
  const factorFor = (p: Period, rate: Dec) => periodFactor(p, rate, req.rateContext);

  const lines: RawLine[] = [];
  let balance = req.opening;
  let instalment: Dec | null = req.fixedInstalment ?? null;
  let instalmentRate: Dec | null = null;
  const amortStart = req.principalGrace;
  const amortCount = n - amortStart;

  // Flat interest: total interest fixed up front on the original principal.
  let flatInterestPerLine: Dec | null = null;
  let flatPrincipalPerLine: Dec | null = null;
  let flatTotalInterest: Dec | null = null;
  if (req.interestMethod === 'FLAT') {
    if (req.method !== 'EQUAL_INSTALMENT' || req.principalGrace > 0 || !req.balloon.isZero()) {
      throw new EngineError('INVALID_COMBINATION', 'Flat interest supports level instalments only, without grace or balloon.');
    }
    if (req.rateContext.basis !== 'PERIODIC' || !req.rateContext.ppy) {
      throw new EngineError('INVALID_COMBINATION', 'Flat interest needs regular periods with a periodic basis.');
    }
    if (req.rates.length > 1) throw new EngineError('INVALID_COMBINATION', 'Flat interest cannot follow a changing rate.');
    const r = dec(req.rates[0].annualRate);
    const termYears = new D(n).div(req.rateContext.ppy);
    flatTotalInterest = round(req.opening.times(r).times(termYears)); // TotalInterest = P × r × years
    flatInterestPerLine = round(flatTotalInterest.div(n));
    flatPrincipalPerLine = round(req.opening.div(n));
  }

  let interestPaidFlat = ZERO;
  let equalPrincipalPer: Dec | null = null;
  for (let k = 0; k < n; k++) {
    const period = periods[k];
    const point = rateFor(period);
    const rate = dec(point.annualRate);
    const factor = factorFor(period, rate);
    const isLast = k === n - 1;
    const opening = balance;
    let interest =
      k === 0 && req.firstPeriodInterestOverride !== undefined ? round(req.firstPeriodInterestOverride) : round(opening.times(factor));

    if (req.interestMethod === 'FLAT') {
      interest = isLast ? flatTotalInterest!.minus(interestPaidFlat) : flatInterestPerLine!;
      interestPaidFlat = interestPaidFlat.plus(interest);
      const principal = isLast ? balance : flatPrincipalPerLine!;
      balance = balance.minus(principal);
      lines.push({ period, opening, principal, interest, capitalized: ZERO, annualRate: rate, factor, kind: isLast ? 'FINAL' : 'AMORTIZING', projected: !!point.projected });
      continue;
    }

    if (k < req.interestGrace) {
      // Nothing is paid; the period's interest is added to principal. Simple
      // capitalization charges it on the principal at the start of the grace.
      if (req.graceCapitalization === 'SIMPLE') interest = round(req.opening.times(factor));
      balance = balance.plus(interest);
      lines.push({ period, opening, principal: ZERO, interest: ZERO, capitalized: interest, annualRate: rate, factor, kind: 'CAPITALIZATION', projected: !!point.projected });
      continue;
    }
    if (k < amortStart) {
      lines.push({ period, opening, principal: ZERO, interest, capitalized: ZERO, annualRate: rate, factor, kind: 'INTEREST_ONLY', projected: !!point.projected });
      continue;
    }

    let principal: Dec;
    const remainingPeriods = periods.slice(k);
    switch (req.method) {
      case 'EQUAL_INSTALMENT':
      case 'BALLOON': {
        // (Re)solve the level instalment at the start of amortization and
        // whenever the rate changes — the projection assumes the new rate
        // holds for the remaining term, as a contractual reset would.
        if (req.fixedInstalment === undefined && (instalment === null || instalmentRate === null || !instalmentRate.eq(rate))) {
          const factors = remainingPeriods.map((p) => factorFor(p, rate));
          if (k === 0 && req.firstPeriodInterestOverride !== undefined) {
            factors[0] = opening.isZero() ? ZERO : req.firstPeriodInterestOverride.div(opening);
          }
          instalment = round(levelPayment(opening, factors, req.balloon, req.stepMultipliers?.slice(k)));
          instalmentRate = rate;
        }
        const due = req.stepMultipliers ? round(instalment!.times(req.stepMultipliers[k])) : instalment!;
        principal = isLast ? balance : due.minus(interest);
        if (principal.lt(0)) {
          throw new EngineError('NEGATIVE_AMORTIZATION', `Instalment ${due.toString()} does not cover interest ${interest.toString()} in period ${k + 1}.`);
        }
        if (req.fixedInstalment !== undefined && principal.gte(balance)) {
          principal = balance; // shortened tenor finishes early
        }
        break;
      }
      case 'EQUAL_PRINCIPAL': {
        // Fixed on the balance at the start of amortization, so capitalized
        // grace interest is repaid with the principal.
        if (equalPrincipalPer === null) equalPrincipalPer = round(opening.div(amortCount));
        principal = isLast ? balance : equalPrincipalPer;
        break;
      }
      case 'INTEREST_ONLY':
        principal = isLast ? balance : ZERO;
        break;
      case 'EXPLICIT': {
        principal = isLast ? balance : req.explicitPrincipal![k];
        break;
      }
    }
    if (principal.gt(balance)) principal = balance;
    balance = balance.minus(principal);
    const finishedEarly = balance.isZero() && !isLast;
    lines.push({
      period,
      opening,
      principal,
      interest,
      capitalized: ZERO,
      annualRate: rate,
      factor,
      kind: isLast || finishedEarly ? 'FINAL' : principal.isZero() ? 'INTEREST_ONLY' : 'AMORTIZING',
      projected: !!point.projected,
    });
    if (finishedEarly) break;
  }
  if (!balance.isZero()) {
    throw new EngineError('SCHEDULE_NOT_CLOSED', `Schedule leaves ${balance.toString()} outstanding at maturity.`);
  }
  return { lines, instalment: req.interestMethod === 'FLAT' ? flatPrincipalPerLine!.plus(flatInterestPerLine!) : instalment };
}

// ── Public entry point ──────────────────────────────────────────────────────

function toLine(raw: RawLine, number: number, ctx: RateContext): ScheduleLine {
  const total = raw.principal.plus(raw.interest);
  return {
    number,
    periodStart: raw.period.start,
    periodEnd: raw.period.end,
    dueDate: raw.period.dueDate,
    accrualDays: dayCountDays(raw.period.start, raw.period.end, ctx.dayCount),
    annualRate: raw.annualRate.toString(),
    periodicRate: raw.factor.toString(),
    openingPrincipal: raw.opening.toString(),
    principal: raw.principal.toString(),
    interest: raw.interest.toString(),
    capitalizedInterest: raw.capitalized.toString(),
    total: total.toString(),
    closingPrincipal: raw.opening.plus(raw.capitalized).minus(raw.principal).toString(),
    kind: raw.kind,
    projected: raw.projected,
  };
}

export function finalizeLines(raw: RawLine[], ctx: RateContext, firstNumber = 1): ScheduleLine[] {
  return raw.map((r, i) => toLine(r, firstNumber + i, ctx));
}

/** Rate context, rate timeline and rounding for a contract, for servicing recalculations. */
export function contractContext(input: ScheduleInput): { ctx: RateContext; rates: RatePoint[]; rounding: RoundingRule; ppy: Dec | null } {
  const rounding = input.rounding ?? defaultRounding(input.currency);
  assertDayCount(input.dayCount);
  const rates = normalizeRates(input);
  const ppy = input.method === 'EXPLICIT' ? null : stepper(input.frequency ?? 'MONTHLY', input.customFrequency).ppy;
  return {
    ctx: { convention: input.rateConvention, basis: input.accrualBasis, dayCount: input.dayCount, ppy, precision: input.ratePrecision ?? 12 },
    rates,
    rounding,
    ppy,
  };
}

export type { RateContext };

export function generateSchedule(input: ScheduleInput): ScheduleResult {
  if (input.incomeContingent) return incomeContingentSchedule(input);
  const currency = getCurrency(input.currency).code;
  const rounding = input.rounding ?? defaultRounding(currency);
  validateRoundingRule(currency, rounding);
  assertDayCount(input.dayCount);
  const principal = parseMoney(input.principal, currency, 'principal');
  if (principal.lte(0)) throw new EngineError('INVALID_PRINCIPAL', 'Principal must be positive.');
  if (!roundMoney(principal, rounding).eq(principal)) {
    throw new EngineError('INVALID_PRINCIPAL', `Principal ${input.principal} is not a multiple of the rounding increment ${rounding.increment}.`);
  }
  if (input.interestMethod === 'FLAT' && input.rateConvention === 'EFFECTIVE') {
    throw new EngineError('INVALID_COMBINATION', 'A flat rate is a nominal convention; an effective annual flat rate is undefined.');
  }

  const rates = normalizeRates(input);
  const built = buildPeriods(input);
  const ctx: RateContext = {
    convention: input.rateConvention,
    basis: input.accrualBasis,
    dayCount: input.dayCount,
    ppy: built.ppy,
    precision: input.ratePrecision ?? 12,
  };
  if (input.accrualBasis === 'PERIODIC' && !built.regular) {
    // Refuse to apply an equal-period formula to unequal periods.
    throw new EngineError(
      'IRREGULAR_PERIOD_REQUIRES_DAILY',
      'This schedule has an irregular period (irregular first due date, explicit dates or adjusted accrual dates). Use DAILY accrual so interest follows the actual accrual interval.',
    );
  }

  const balloon = input.balloonAmount ? parseMoney(input.balloonAmount, currency, 'balloonAmount') : ZERO;
  if (input.method === 'BALLOON' && balloon.lte(0)) throw new EngineError('INVALID_BALLOON', 'A balloon schedule needs a positive balloonAmount.');
  if (input.method !== 'BALLOON' && !balloon.isZero()) throw new EngineError('INVALID_BALLOON', 'balloonAmount is only valid with the BALLOON method.');
  if (balloon.gte(principal)) throw new EngineError('INVALID_BALLOON', 'The balloon must be smaller than the principal.');

  let explicitPrincipal: Dec[] | undefined;
  if (input.method === 'EXPLICIT') {
    explicitPrincipal = input.explicitSchedule!.map((r, i) => parseMoney(r.principal, currency, `explicitSchedule[${i}].principal`));
    if (explicitPrincipal.some((p) => p.lt(0))) throw new EngineError('INVALID_SCHEDULE', 'Explicit principal amounts cannot be negative.');
    const scheduled = sum(explicitPrincipal);
    if (!scheduled.eq(principal)) {
      throw new EngineError('INVALID_SCHEDULE', `Explicit principal totals ${scheduled.toString()} but the loan principal is ${principal.toString()}.`);
    }
  }

  const { lines: raw, instalment } = amortize({
    method: input.method,
    interestMethod: input.interestMethod,
    currency,
    rounding,
    periods: built.periods,
    rates,
    rateContext: ctx,
    opening: principal,
    principalGrace: input.principalGraceInstalments ?? 0,
    interestGrace: input.interestGraceInstalments ?? 0,
    graceCapitalization: input.graceCapitalization,
    balloon,
    explicitPrincipal,
    stepMultipliers: (() => {
      if (!input.instalmentSteps?.length) return undefined;
      if (input.method !== 'EQUAL_INSTALMENT' || input.interestMethod !== 'REDUCING_BALANCE') {
        throw new EngineError('INVALID_COMBINATION', 'Stepped instalments need level instalments on a reducing balance.');
      }
      return stepWeights(input.instalmentSteps, built.periods.length, input.principalGraceInstalments ?? 0);
    })(),
  });
  const lines = finalizeLines(raw, ctx);

  const totalPrincipal = sum(raw.map((l) => l.principal));
  const totalInterest = sum(raw.map((l) => l.interest));
  const totalCapitalized = sum(raw.map((l) => l.capitalized));
  const last = lines[lines.length - 1];
  const lastWeight = input.instalmentSteps?.length ? stepWeights(input.instalmentSteps, built.periods.length, input.principalGraceInstalments ?? 0)![lines.length - 1] : ONE;
  const finalResidual =
    instalment && input.method !== 'BALLOON' && input.method !== 'EXPLICIT' ? dec(last.total).minus(roundMoney(instalment.times(lastWeight), rounding)) : null;

  const explanation = explain(input, built, ctx, rounding, instalment, finalResidual, totalCapitalized);
  return {
    engineVersion: LENDING_ENGINE_VERSION,
    currency,
    rounding,
    lines,
    totals: {
      principal: totalPrincipal.toString(),
      interest: totalInterest.toString(),
      capitalizedInterest: totalCapitalized.toString(),
      payments: totalPrincipal.plus(totalInterest).toString(),
    },
    instalmentAmount: instalment ? instalment.toString() : null,
    finalResidual: finalResidual ? finalResidual.toString() : null,
    maturityDate: last.dueDate,
    periodicRateConvention: describeConvention(ctx),
    explanation,
    hasProjectedAmounts: lines.some((l) => l.projected),
  };
}

function describeConvention(ctx: RateContext): string {
  if (ctx.basis === 'DAILY') {
    return ctx.convention === 'NOMINAL'
      ? `annual rate × year fraction (${ctx.dayCount}) per accrual period`
      : `(1 + annual rate)^(year fraction, ${ctx.dayCount}) − 1 per accrual period`;
  }
  return ctx.convention === 'NOMINAL'
    ? `annual rate ÷ ${ctx.ppy!.toString()} per period`
    : `(1 + annual rate)^(1/${ctx.ppy!.toString()}) − 1 per period`;
}

function explain(
  input: ScheduleInput,
  built: BuiltPeriods,
  ctx: RateContext,
  rounding: RoundingRule,
  instalment: Dec | null,
  residual: Dec | null,
  capitalized: Dec,
): string[] {
  const out: string[] = [];
  const methodText: Record<RepaymentMethod, string> = {
    EQUAL_INSTALMENT: input.interestMethod === 'FLAT' ? 'flat-rate level instalments' : 'equal instalments (annuity)',
    EQUAL_PRINCIPAL: 'equal principal with interest on the reducing balance',
    INTEREST_ONLY: 'interest-only with the principal repaid at maturity (bullet)',
    BALLOON: `equal instalments leaving a balloon of ${input.balloonAmount} ${input.currency} at maturity`,
    EXPLICIT: 'explicitly dated principal repayments (seasonal/irregular)',
  };
  out.push(`${input.principal} ${input.currency} repaid by ${methodText[input.method]}, ${built.frequencyLabel}, over ${built.periods.length} instalment(s).`);
  out.push(`Interest: ${input.interestMethod === 'FLAT' ? 'flat on the original principal (P × r × years)' : 'on the outstanding principal'}; periodic rate = ${describeConvention(ctx)}; rate convention ${input.rateConvention}; periodic rates rounded to ${ctx.precision} d.p.`);
  if (!built.regular) out.push('Periods are irregular, so interest is calculated over each actual accrual interval rather than with an equal-period formula.');
  if ((input.interestGraceInstalments ?? 0) > 0) {
    out.push(`First ${input.interestGraceInstalments} instalment(s): no payment; ${capitalized.toString()} ${input.currency} of interest is capitalized into principal.`);
  }
  if ((input.principalGraceInstalments ?? 0) > (input.interestGraceInstalments ?? 0)) {
    out.push(`Instalments ${(input.interestGraceInstalments ?? 0) + 1}–${input.principalGraceInstalments}: interest only (principal grace).`);
  }
  if (instalment) out.push(`Level instalment ${instalment.toString()} ${input.currency}, rounded to ${rounding.increment} (${rounding.mode}).`);
  if (residual && !residual.isZero()) out.push(`The final instalment absorbs a rounding residual of ${residual.toString()} ${input.currency} so the principal closes exactly at zero.`);
  if ((input.businessDayConvention ?? 'NONE') !== 'NONE') {
    out.push(`Due dates falling on non-business days move ${input.businessDayConvention} (calendar ${input.calendar?.code ?? 'none'}); interest accrues to the ${input.accrualDateBasis === 'ADJUSTED' ? 'adjusted' : 'unadjusted'} date.`);
  }
  if (input.rates && input.rates.some((r) => r.projected)) {
    out.push('Amounts after a projected rate point are projections, not contractually fixed payments.');
  }
  return out;
}

