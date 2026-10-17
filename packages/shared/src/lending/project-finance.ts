/**
 * Project finance (LT-17). Pure: no I/O, no clock.
 *
 * Three calculations a project loan needs beyond an ordinary term loan:
 *
 *  • sculpting — principal per period sized so that the projected cash flow
 *    available for debt service (CFADS) covers debt service by the same ratio
 *    in every period, closing the loan to exactly zero;
 *  • the debt service reserve target — the scheduled debt service of the
 *    months ahead;
 *  • the cash waterfall — project receipts applied in a fixed order, with the
 *    cash that would be distributed held back (lock-up) when cover is thin.
 */
import { D, Dec, dec, EngineError, ONE, ZERO, sum } from './decimal.js';
import { defaultRounding, parseMoney, roundMoney, RoundingRule } from './money.js';
import { addMonths, compareDates, LocalDate, parseDate } from './dates.js';
import { buildPeriods, generateSchedule, periodFactor, RateConvention, ScheduleInput, ScheduleResult } from './schedule.js';

// ── Sculpted repayment ──────────────────────────────────────────────────────

export interface CfadsProjection {
  dueDate: LocalDate;
  /** Projected cash flow available for debt service in the period ending on dueDate. */
  cfads: string;
}

export interface SculptInput {
  principal: string;
  currency: string;
  rounding?: RoundingRule;
  /** The day the sculpted schedule starts (the term-out date); interest runs from here. */
  startDate: LocalDate;
  annualRate: string;
  dayCount: string;
  rateConvention?: RateConvention;
  ratePrecision?: number;
  periods: CfadsProjection[];
  /** CFADS ÷ debt service must be at least this in every period. */
  targetDscr: string;
  /** Principal left to the final date on top of the sculpted profile (optional balloon). */
  balloonAmount?: string | null;
}

export interface SculptedLine {
  number: number;
  dueDate: LocalDate;
  cfads: string;
  openingBalance: string;
  interest: string;
  principal: string;
  debtService: string;
  /** CFADS ÷ debt service, to 4 places; null when nothing is due. */
  dscr: string | null;
  closingBalance: string;
}

export interface SculptResult {
  targetDscr: string;
  /** The single cover ratio the profile achieves (≥ target): PV(CFADS) ÷ amortized principal. */
  sculptedDscr: string;
  minDscr: string | null;
  averageDscr: string | null;
  /** The largest principal the projection supports at the target DSCR (debt sizing). */
  maxDebt: string;
  balloon: string;
  explicitSchedule: { dueDate: LocalDate; principal: string }[];
  scheduleInput: ScheduleInput;
  schedule: ScheduleResult;
  lines: SculptedLine[];
  explanation: string[];
}

const DSCR_DP = 4;

/**
 * Sculpt the repayment profile to the projected CFADS.
 *
 * With interest on the opening balance, a loan is repaid exactly when the
 * present value of its debt service — discounted at the loan's own period
 * factors — equals the principal. Setting debt service to CFADS ÷ k in every
 * period therefore closes the loan when k = PV(CFADS) ÷ principal, so k is
 * solved directly rather than searched for. Principal is debt service less
 * the period's interest, rounded to the currency; the last period takes what
 * is left so the balance closes to exactly zero.
 *
 * Refused when the projection cannot carry the principal at the target cover
 * (k below target) or when some period's CFADS ÷ k does not even cover that
 * period's interest — sculpting never capitalizes interest.
 */
export function sculptRepayment(input: SculptInput): SculptResult {
  const currency = input.currency;
  const rounding = input.rounding ?? defaultRounding(currency);
  const principal = parseMoney(input.principal, currency, 'principal');
  if (principal.lte(0)) throw new EngineError('INVALID_PRINCIPAL', 'There is no principal to sculpt.');
  const target = dec(input.targetDscr, 'targetDscr');
  if (target.lte(0)) throw new EngineError('INVALID_DSCR', 'The target DSCR must be above 0.');
  if (!input.periods.length) throw new EngineError('INVALID_SCHEDULE', 'Give at least one projected period.');
  parseDate(input.startDate, 'startDate');
  let prev = input.startDate;
  const cfads = input.periods.map((p, i) => {
    parseDate(p.dueDate, `periods[${i}].dueDate`);
    if (compareDates(p.dueDate, prev) <= 0) throw new EngineError('INVALID_SCHEDULE', `Period ${i + 1} (${p.dueDate}) must fall after ${prev}.`);
    prev = p.dueDate;
    const v = parseMoney(p.cfads, currency, `periods[${i}].cfads`);
    if (v.lt(0)) throw new EngineError('INVALID_CFADS', `Projected CFADS for ${p.dueDate} is negative; a period that needs sponsor support cannot carry debt service.`);
    return v;
  });
  const balloon = input.balloonAmount ? parseMoney(input.balloonAmount, currency, 'balloonAmount') : ZERO;
  if (balloon.lt(0) || balloon.gte(principal)) throw new EngineError('INVALID_BALLOON', 'The balloon must be at least 0 and below the principal.');

  const base: ScheduleInput = {
    principal: principal.toString(),
    currency,
    rounding,
    disbursementDate: input.startDate,
    annualRate: input.annualRate,
    rateConvention: input.rateConvention ?? 'NOMINAL',
    interestMethod: 'REDUCING_BALANCE',
    accrualBasis: 'DAILY',
    dayCount: input.dayCount,
    ratePrecision: input.ratePrecision ?? 12,
    method: 'EXPLICIT',
    explicitSchedule: input.periods.map((p) => ({ dueDate: p.dueDate, principal: '0' })),
  };
  const rate = dec(input.annualRate, 'annualRate');
  const ctx = { convention: base.rateConvention, basis: 'DAILY' as const, dayCount: input.dayCount, ppy: null, precision: base.ratePrecision! };
  const periods = buildPeriods(base).periods;
  const factors = periods.map((p) => periodFactor(p, rate, ctx));

  // Discount factor to the start for each due date, at the loan's own rate.
  const discount: Dec[] = [];
  let df = ONE;
  for (const f of factors) {
    df = df.div(ONE.plus(f));
    discount.push(df);
  }
  const pvCfads = sum(cfads.map((c, i) => c.times(discount[i])));
  const amortized = principal.minus(balloon.times(discount[discount.length - 1]));
  const maxDebt = roundMoney(pvCfads.div(target).plus(balloon.times(discount[discount.length - 1])), { ...rounding, mode: 'DOWN' });
  if (pvCfads.lte(0)) throw new EngineError('SCULPT_INFEASIBLE', 'The projection has no cash flow to repay the loan from.');
  const k = pvCfads.div(amortized);
  if (k.lt(target)) {
    throw new EngineError(
      'SCULPT_INFEASIBLE',
      `The projected CFADS supports at most ${maxDebt.toString()} ${currency} at a DSCR of ${target.toString()}; ${principal.toString()} would be covered only ${k.toDecimalPlaces(DSCR_DP).toString()} times.`,
    );
  }

  const round = (x: Dec) => roundMoney(x, rounding);
  const explicit: Dec[] = [];
  let balance = principal;
  for (let i = 0; i < periods.length; i++) {
    const interest = round(balance.times(factors[i]));
    const isLast = i === periods.length - 1;
    let p = isLast ? balance : round(cfads[i].div(k).minus(interest));
    if (p.lt(0)) {
      throw new EngineError(
        'SCULPT_INFEASIBLE',
        `CFADS of ${cfads[i].toString()} on ${input.periods[i].dueDate} does not cover that period's interest of ${interest.toString()} at a DSCR of ${k.toDecimalPlaces(DSCR_DP).toString()}; drop the period or extend the projection.`,
      );
    }
    if (p.gt(balance)) p = balance;
    explicit.push(p);
    balance = balance.minus(p);
  }

  const scheduleInput: ScheduleInput = {
    ...base,
    explicitSchedule: input.periods.map((p, i) => ({ dueDate: p.dueDate, principal: explicit[i].toString() })),
  };
  const schedule = generateSchedule(scheduleInput);
  const lines: SculptedLine[] = schedule.lines.map((l, i) => {
    const ds = dec(l.principal).plus(dec(l.interest));
    return {
      number: l.number,
      dueDate: l.dueDate,
      cfads: cfads[i].toString(),
      openingBalance: l.openingPrincipal,
      interest: l.interest,
      principal: l.principal,
      debtService: ds.toString(),
      dscr: ds.gt(0) ? cfads[i].div(ds).toDecimalPlaces(DSCR_DP).toString() : null,
      closingBalance: l.closingPrincipal,
    };
  });
  const covers = lines.filter((l) => l.dscr !== null).map((l) => dec(l.dscr!));
  const minDscr = covers.length ? covers.reduce((a, b) => (b.lt(a) ? b : a)) : null;
  const totalDs = sum(lines.map((l) => dec(l.debtService)));
  const averageDscr = totalDs.gt(0) ? sum(cfads).div(totalDs).toDecimalPlaces(DSCR_DP) : null;
  return {
    targetDscr: target.toString(),
    sculptedDscr: k.toDecimalPlaces(DSCR_DP).toString(),
    minDscr: minDscr?.toString() ?? null,
    averageDscr: averageDscr?.toString() ?? null,
    maxDebt: maxDebt.toString(),
    balloon: balloon.toString(),
    explicitSchedule: scheduleInput.explicitSchedule!,
    scheduleInput,
    schedule,
    lines,
    explanation: [
      `Present value of the projected CFADS at the loan's own rate: ${roundMoney(pvCfads, rounding).toString()} ${currency}.`,
      `At the target DSCR of ${target.toString()} it supports ${maxDebt.toString()} ${currency} of debt; the ${principal.toString()} ${currency} drawn is covered ${k.toDecimalPlaces(DSCR_DP).toString()} times.`,
      `Debt service in each period = CFADS ÷ ${k.toDecimalPlaces(DSCR_DP).toString()}; principal = debt service − interest on the opening balance, and the last period repays what is left${balloon.gt(0) ? `, including the ${balloon.toString()} ${currency} balloon` : ''}.`,
    ],
  };
}

// ── Debt service reserve ────────────────────────────────────────────────────

export interface DebtServiceLine {
  dueDate: LocalDate;
  principal: string;
  interest: string;
}

/**
 * The debt service reserve target: scheduled principal and interest falling
 * due after `asOf` and within the next `months` months.
 */
export function dsraTarget(lines: DebtServiceLine[], asOf: LocalDate, months: number): string {
  if (months <= 0) return '0';
  const until = addMonths(asOf, months);
  return sum(
    lines
      .filter((l) => compareDates(l.dueDate, asOf) > 0 && compareDates(l.dueDate, until) <= 0)
      .map((l) => dec(l.principal).plus(dec(l.interest))),
  ).toString();
}

// ── Cash waterfall ──────────────────────────────────────────────────────────

export type WaterfallStepCode =
  | 'OPERATING_COSTS'
  | 'TAXES'
  | 'SENIOR_DEBT_SERVICE'
  | 'DSRA_DRAW'
  | 'DSRA_TOP_UP'
  | 'CASH_SWEEP'
  | 'LOCK_UP'
  | 'LOCK_UP_RELEASE'
  | 'DISTRIBUTION';

export interface WaterfallStep {
  order: number;
  code: WaterfallStepCode;
  label: string;
  amount: string;
  /** Shown for completeness, paid by the project itself — nothing is posted. */
  informational: boolean;
  note?: string;
}

export interface WaterfallInput {
  currency: string;
  rounding?: RoundingRule;
  /** Project revenue received in the period. */
  revenue: string;
  operatingCosts: string;
  taxes: string;
  /** Everything due and unpaid on the loan at the date of the run. */
  debtServiceDue: string;
  /** Scheduled debt service of the period the run covers, for the cover test. */
  periodDebtService: string;
  dsraBalance: string;
  dsraTarget: string;
  lockUpBalance: string;
  lockUpDscr: string | null;
  sweepRate: string | null;
  /** Principal not yet due that a sweep may prepay. */
  sweepCap: string;
}

export interface WaterfallResult {
  cfads: string;
  /** CFADS ÷ the period's scheduled debt service; null when nothing was scheduled. */
  dscr: string | null;
  lockedUp: boolean;
  lockUpReasons: string[];
  /** Senior debt service paid from the period's cash. */
  seniorFromCash: string;
  /** Senior debt service paid from the reserve. */
  dsraDraw: string;
  /** Debt service still unpaid after the reserve. */
  shortfall: string;
  dsraTopUp: string;
  cashSweep: string;
  lockUpRetained: string;
  lockUpReleased: string;
  distribution: string;
  dsraBalanceAfter: string;
  lockUpBalanceAfter: string;
  steps: WaterfallStep[];
}

/**
 * Apply one period's project receipts through the waterfall:
 *
 *   1–2. operating costs and taxes (information: the project pays them, so
 *        what reaches the lender is CFADS = revenue − costs − taxes);
 *   3.   senior debt service — everything due on the loan — from CFADS, and
 *        from the reserve for any shortfall;
 *   4.   the reserve topped up to its target;
 *   5.   a share of what is left swept to prepay principal;
 *   6.   the rest distributed to the sponsor — or held in lock-up when the
 *        period's DSCR is below the lock-up ratio, the reserve is short or
 *        debt service went unpaid. Cash locked up earlier is released with
 *        the first distribution after the project passes again.
 */
export function applyWaterfall(input: WaterfallInput): WaterfallResult {
  const cur = input.currency;
  const rounding = input.rounding ?? defaultRounding(cur);
  const m = (v: string, f: string) => {
    const x = parseMoney(v, cur, f);
    if (x.lt(0)) throw new EngineError('INVALID_AMOUNT', `${f} cannot be negative.`);
    return x;
  };
  const revenue = m(input.revenue, 'revenue');
  const opex = m(input.operatingCosts, 'operatingCosts');
  const taxes = m(input.taxes, 'taxes');
  const due = m(input.debtServiceDue, 'debtServiceDue');
  const periodDs = dec(input.periodDebtService, 'periodDebtService');
  const dsra = m(input.dsraBalance, 'dsraBalance');
  const target = dec(input.dsraTarget, 'dsraTarget');
  const lockUp = m(input.lockUpBalance, 'lockUpBalance');
  const sweepCap = dec(input.sweepCap, 'sweepCap');

  const cfads = revenue.minus(opex).minus(taxes);
  const available = D.max(cfads, ZERO);
  const fromCash = D.min(available, due);
  let left = available.minus(fromCash);
  const draw = D.min(due.minus(fromCash), dsra);
  const shortfall = due.minus(fromCash).minus(draw);
  const dsraAfterDraw = dsra.minus(draw);
  const topUp = D.min(left, D.max(target.minus(dsraAfterDraw), ZERO));
  left = left.minus(topUp);
  const dsraAfter = dsraAfterDraw.plus(topUp);

  const dscr = periodDs.gt(0) ? cfads.div(periodDs).toDecimalPlaces(DSCR_DP) : null;
  const reasons: string[] = [];
  if (input.lockUpDscr !== null && dscr !== null && dscr.lt(dec(input.lockUpDscr, 'lockUpDscr')))
    reasons.push(`DSCR ${dscr.toString()} is below the lock-up ratio ${input.lockUpDscr}`);
  if (dsraAfter.lt(target)) reasons.push(`the reserve holds ${dsraAfter.toString()} of its ${target.toString()} target`);
  if (shortfall.gt(0)) reasons.push(`${shortfall.toString()} of debt service went unpaid`);
  const lockedUp = reasons.length > 0;

  const sweepRate = input.sweepRate ? dec(input.sweepRate, 'sweepRate') : ZERO;
  const sweep = D.min(roundMoney(left.times(sweepRate), { ...rounding, mode: 'DOWN' }), D.max(sweepCap, ZERO));
  left = left.minus(sweep);

  const retained = lockedUp ? left : ZERO;
  const released = lockedUp ? ZERO : lockUp;
  const distribution = lockedUp ? ZERO : left.plus(lockUp);
  const lockUpAfter = lockedUp ? lockUp.plus(retained) : ZERO;

  let order = 0;
  const step = (code: WaterfallStepCode, label: string, amount: Dec, informational = false, note?: string): WaterfallStep => ({
    order: ++order,
    code,
    label,
    amount: amount.toString(),
    informational,
    ...(note ? { note } : {}),
  });
  const steps: WaterfallStep[] = [
    step('OPERATING_COSTS', 'Operating costs', opex, true, 'Paid by the project before cash reaches the lender'),
    step('TAXES', 'Taxes', taxes, true, 'Paid by the project before cash reaches the lender'),
    step('SENIOR_DEBT_SERVICE', 'Senior debt service', fromCash),
    step('DSRA_DRAW', 'Debt service paid from the reserve', draw),
    step('DSRA_TOP_UP', 'Reserve top-up', topUp, false, `Target ${target.toString()}`),
    step('CASH_SWEEP', 'Cash sweep (prepayment)', sweep),
    step('LOCK_UP', 'Held in lock-up', retained, false, lockedUp ? reasons.join('; ') : undefined),
    step('LOCK_UP_RELEASE', 'Released from lock-up', released),
    step('DISTRIBUTION', 'Distribution to the sponsor', distribution),
  ];
  return {
    cfads: cfads.toString(),
    dscr: dscr?.toString() ?? null,
    lockedUp,
    lockUpReasons: reasons,
    seniorFromCash: fromCash.toString(),
    dsraDraw: draw.toString(),
    shortfall: shortfall.toString(),
    dsraTopUp: topUp.toString(),
    cashSweep: sweep.toString(),
    lockUpRetained: retained.toString(),
    lockUpReleased: released.toString(),
    distribution: distribution.toString(),
    dsraBalanceAfter: dsraAfter.toString(),
    lockUpBalanceAfter: lockUpAfter.toString(),
    steps,
  };
}
