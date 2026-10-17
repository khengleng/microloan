/**
 * Income-contingent repayment (education loans).
 *
 * The instalment is not an annuity: it is a share of the borrower's declared
 * income above a threshold, set by an assessment and reassessed at least
 * annually. Below the threshold nothing is payable and nothing falls into
 * arrears. Interest accrues on the balance; what the payment does not cover
 * is either capitalised (up to an optional cap) or not charged (subsidised).
 * Whatever is left at the end of the contract term is forgiven.
 *
 * Pure: no I/O, no clock.
 */
import { D, Dec, dec, EngineError, ZERO, sum } from './decimal.js';
import { LocalDate, compareDates, daysBetween } from './dates.js';
import { RoundingRule, defaultRounding, getCurrency, parseMoney, roundMoney, validateRoundingRule } from './money.js';
import {
  LENDING_ENGINE_VERSION,
  type ScheduleInput,
  type ScheduleLine,
  type ScheduleResult,
  buildPeriods,
  periodFactor,
} from './schedule.js';

export interface IncomeContingentTerms {
  /** Share of annual income above the threshold repaid each year. */
  repaymentRate: string;
  /** Annual income below which nothing is payable. */
  incomeThreshold: string;
  unpaidInterest: 'CAPITALISE' | 'SUBSIDISE';
  /** Most interest ever capitalised, as a fraction of the amount financed. */
  capitalisationCap: string | null;
}

/** What a contract carries in its schedule input. */
export interface IncomeContingentContract extends IncomeContingentTerms {
  declaredAnnualIncome: string;
  /** The contract grid: payments fall on its period ends, whatever the assessment. */
  gridStart: LocalDate;
  gridPeriods: number;
  /** Amount financed, the base of the capitalisation cap. */
  originalPrincipal: string;
}

export interface IncomeContingentPayment {
  declaredAnnualIncome: string;
  incomeAboveThreshold: string;
  annualRepayment: string;
  periodicPayment: string;
  explanation: string;
}

/** The instalment an income supports: rate × (income − threshold) ÷ periods per year, never negative. */
export function incomeContingentPayment(income: string, terms: Pick<IncomeContingentTerms, 'repaymentRate' | 'incomeThreshold'>, periodsPerYear: number, rounding: RoundingRule): IncomeContingentPayment {
  const declared = dec(income, 'declaredAnnualIncome');
  if (declared.lt(0)) throw new EngineError('INVALID_INCOME', 'A declared income cannot be negative.');
  const threshold = dec(terms.incomeThreshold, 'incomeThreshold');
  const rate = dec(terms.repaymentRate, 'repaymentRate');
  const above = D.max(ZERO, declared.minus(threshold));
  const annual = above.times(rate);
  const periodic = roundMoney(annual.div(periodsPerYear), rounding);
  return {
    declaredAnnualIncome: declared.toString(),
    incomeAboveThreshold: above.toString(),
    annualRepayment: roundMoney(annual, rounding).toString(),
    periodicPayment: periodic.toString(),
    explanation: above.isZero()
      ? `An income of ${declared} is at or below the threshold of ${threshold}: nothing is payable, and nothing falls into arrears.`
      : `${rate.times(100)}% of the ${above} earned above the ${threshold} threshold is ${roundMoney(annual, rounding)} a year: ${periodic} per instalment.`,
  };
}

export interface IncomeContingentFrom {
  /** First period of the new schedule; must start a period of the contract grid. */
  fromDate: LocalDate;
  /** Principal the new schedule must repay (or leave to forgiveness). */
  openingBalance: string;
  /** Interest already capitalised on this contract, counted against the cap. */
  capitalisedToDate: string;
  firstNumber: number;
}

/**
 * Build (or rebuild from an assessment) the schedule of an income-contingent
 * contract.
 *
 * Each period's interest is charged on the balance at the contract rate. A
 * payment that covers it repays principal with the rest; one that does not
 * pays interest only, and the shortfall is capitalised — on a separate
 * capitalisation line in the same period, so the amount the borrower owes
 * is never more than the assessed payment — or, when subsidised or past the
 * cap, simply not charged. When the balance is repaid the schedule stops;
 * otherwise a final line at the end of the term carries the balance that
 * will be forgiven.
 */
export function incomeContingentSchedule(input: ScheduleInput, from?: IncomeContingentFrom): ScheduleResult {
  const ic = input.incomeContingent;
  if (!ic) throw new EngineError('INVALID_COMBINATION', 'Not an income-contingent contract.');
  const currency = getCurrency(input.currency).code;
  const rounding = input.rounding ?? defaultRounding(currency);
  validateRoundingRule(currency, rounding);
  const round = (x: Dec) => roundMoney(x, rounding);
  if (input.accrualBasis !== 'PERIODIC') throw new EngineError('INVALID_COMBINATION', 'Income-contingent schedules use PERIODIC accrual.');
  if (input.interestMethod !== 'REDUCING_BALANCE') throw new EngineError('INVALID_COMBINATION', 'Income-contingent interest accrues on the outstanding balance.');
  if (input.rates?.length) throw new EngineError('INVALID_COMBINATION', 'Income-contingent loans carry a fixed rate.');
  if (input.annualRate === undefined) throw new EngineError('MISSING_RATE', 'An annual rate is required (it may be zero).');
  const annualRate = dec(input.annualRate, 'annualRate');
  if (annualRate.lt(0)) throw new EngineError('INVALID_RATE', 'Interest rates cannot be negative.');

  const grid = buildPeriods({
    ...input,
    incomeContingent: undefined,
    method: 'EQUAL_INSTALMENT',
    disbursementDate: ic.gridStart,
    numberOfInstalments: ic.gridPeriods,
    firstDueDate: undefined,
    explicitSchedule: undefined,
  });
  if (!grid.ppy) throw new EngineError('INVALID_FREQUENCY', 'Income-contingent repayments need a regular frequency.');
  const ppy = grid.ppy.toNumber();
  const ctx = { convention: input.rateConvention, basis: 'PERIODIC' as const, dayCount: input.dayCount, ppy: grid.ppy, precision: input.ratePrecision ?? 12 };
  const start = from?.fromDate ?? ic.gridStart;
  const firstIdx = grid.periods.findIndex((p) => p.start === start);
  if (firstIdx < 0) throw new EngineError('ICL_EFFECTIVE_DATE', `${start} does not start a period of this contract; an assessment takes effect from the start of a period.`);
  const periods = grid.periods.slice(firstIdx);
  const termEnd = grid.periods[grid.periods.length - 1].dueDate;

  let balance = parseMoney(from?.openingBalance ?? input.principal, currency, 'openingBalance');
  if (balance.lt(0)) throw new EngineError('INVALID_PRINCIPAL', 'The balance cannot be negative.');
  let capitalised = dec(from?.capitalisedToDate ?? '0', 'capitalisedToDate');
  const capLimit = ic.capitalisationCap === null ? null : dec(ic.originalPrincipal, 'originalPrincipal').times(dec(ic.capitalisationCap));
  const pay = dec(incomeContingentPayment(ic.declaredAnnualIncome, ic, ppy, rounding).periodicPayment);

  const lines: ScheduleLine[] = [];
  let number = from?.firstNumber ?? 1;
  let relief = ZERO;
  const line = (p: (typeof periods)[number], opening: Dec, principal: Dec, interest: Dec, cap: Dec, factor: Dec, kind: ScheduleLine['kind']): ScheduleLine => ({
    number: number++,
    periodStart: p.start,
    periodEnd: p.end,
    dueDate: p.dueDate,
    accrualDays: daysBetween(p.start, p.end),
    annualRate: annualRate.toString(),
    periodicRate: factor.toString(),
    openingPrincipal: opening.toString(),
    principal: principal.toString(),
    interest: interest.toString(),
    capitalizedInterest: cap.toString(),
    total: principal.plus(interest).toString(),
    closingPrincipal: opening.plus(cap).minus(principal).toString(),
    kind,
    projected: false,
  });
  for (const p of periods) {
    if (balance.lte(0)) break;
    const factor = periodFactor(p, annualRate, ctx);
    const interest = round(balance.times(factor));
    if (pay.gte(interest)) {
      const principal = D.min(pay.minus(interest), balance);
      if (principal.gt(0) || interest.gt(0)) lines.push(line(p, balance, principal, interest, ZERO, factor, 'AMORTIZING'));
      balance = balance.minus(principal);
      continue;
    }
    const shortfall = interest.minus(pay);
    let cap = ZERO;
    if (ic.unpaidInterest === 'CAPITALISE') cap = capLimit === null ? shortfall : D.max(ZERO, D.min(shortfall, capLimit.minus(capitalised)));
    relief = relief.plus(shortfall.minus(cap));
    if (cap.gt(0)) {
      lines.push(line(p, balance, ZERO, ZERO, cap, factor, 'CAPITALIZATION'));
      capitalised = capitalised.plus(cap);
    }
    if (pay.gt(0)) lines.push(line(p, balance.plus(cap), ZERO, pay, ZERO, factor, 'INTEREST_ONLY'));
    balance = balance.plus(cap);
  }
  if (balance.gt(0)) {
    // Not repaid by the end of the term: the balance is forgiven then.
    lines.push({
      number: number++,
      periodStart: termEnd,
      periodEnd: termEnd,
      dueDate: termEnd,
      accrualDays: 0,
      annualRate: annualRate.toString(),
      periodicRate: '0',
      openingPrincipal: balance.toString(),
      principal: balance.toString(),
      interest: '0',
      capitalizedInterest: '0',
      total: balance.toString(),
      closingPrincipal: '0',
      kind: 'FINAL',
      projected: false,
    });
  }
  const forgiven = balance;
  const totalPrincipal = sum(lines.map((l) => dec(l.principal)));
  const totalInterest = sum(lines.map((l) => dec(l.interest)));
  const totalCap = sum(lines.map((l) => dec(l.capitalizedInterest)));
  const assessed = incomeContingentPayment(ic.declaredAnnualIncome, ic, ppy, rounding);
  return {
    engineVersion: LENDING_ENGINE_VERSION,
    currency,
    rounding,
    lines,
    totals: {
      principal: totalPrincipal.toString(),
      interest: totalInterest.toString(),
      capitalizedInterest: totalCap.toString(),
      payments: totalPrincipal.minus(forgiven).plus(totalInterest).toString(),
    },
    instalmentAmount: pay.toString(),
    finalResidual: null,
    maturityDate: lines.length ? lines[lines.length - 1].dueDate : start,
    periodicRateConvention: `annual rate ÷ ${ppy} per period`,
    explanation: [
      assessed.explanation,
      `Interest at ${annualRate.times(100)}% a year accrues on the balance; ${ic.unpaidInterest === 'CAPITALISE' ? `interest the payment does not cover is added to the balance${capLimit ? `, up to ${round(capLimit)} in total` : ''}` : 'interest the payment does not cover is not charged (subsidised)'}.`,
      forgiven.gt(0)
        ? `At this income the loan is not repaid by ${termEnd}: ${forgiven} would be forgiven then.`
        : `At this income the loan is repaid by ${lines.length ? lines[lines.length - 1].dueDate : start}.`,
      ...(relief.gt(0) ? [`Interest not charged over the term at this income: ${relief}.`] : []),
    ],
    hasProjectedAmounts: false,
  };
}

/** The final line of an income-contingent schedule that carries the balance to be forgiven. */
export function isForgivenessLine(l: { periodStart: string; periodEnd: string; dueDate: string; interest: string; principal: string }, termEnd: LocalDate): boolean {
  return l.periodStart === termEnd && l.periodEnd === termEnd && l.dueDate === termEnd && dec(l.interest).isZero() && dec(l.principal).gt(0);
}

/** Last due date of the contract grid: when what is left is forgiven. */
export function incomeContingentTermEnd(input: ScheduleInput): LocalDate {
  const ic = input.incomeContingent;
  if (!ic) throw new EngineError('INVALID_COMBINATION', 'Not an income-contingent contract.');
  const grid = buildPeriods({ ...input, incomeContingent: undefined, method: 'EQUAL_INSTALMENT', disbursementDate: ic.gridStart, numberOfInstalments: ic.gridPeriods, firstDueDate: undefined });
  return grid.periods[grid.periods.length - 1].dueDate;
}

/**
 * Where a reassessment approved on `asOf` takes effect: the start of the
 * first contract period that has not begun, so no period is split and no
 * interest already earned is re-cut.
 */
export function incomeContingentEffectiveDate(input: ScheduleInput, asOf: LocalDate): LocalDate | null {
  const ic = input.incomeContingent;
  if (!ic) throw new EngineError('INVALID_COMBINATION', 'Not an income-contingent contract.');
  const grid = buildPeriods({ ...input, incomeContingent: undefined, method: 'EQUAL_INSTALMENT', disbursementDate: ic.gridStart, numberOfInstalments: ic.gridPeriods, firstDueDate: undefined });
  return grid.periods.find((p) => compareDates(p.start, asOf) >= 0)?.start ?? null;
}
