import { D, Dec, dec, EngineError, ZERO, sum } from './decimal.js';
import { Frequency } from './schedule.js';
import { LocalDate, compareDates, parseDate } from './dates.js';

/**
 * Affordability assessment for restructuring and hardship cases.
 *
 * Every threshold here is a policy setting passed in by the caller — the
 * engine hard-codes no universal buffer or DSCR. All money is per MONTH;
 * converting a monthly capacity to a loan's payment frequency is explicit.
 */

export interface AffordabilityPolicy {
  /** Safety buffer as a fraction of verified net income (individual / household). */
  bufferFractionOfIncome: string;
  /** Minimum monthly safety buffer per currency, e.g. { USD: '50', KHR: '200000' }. */
  bufferMinimum: Record<string, string>;
  /** Minimum debt-service coverage ratio for business borrowers. */
  minDscr: string;
  /** Buffer kept back from each month's seasonal surplus (fraction). */
  seasonalBufferFraction: string;
  /** Evidence older than this cannot support an approval. */
  evidenceMaxAgeDays: number;
  /** Self-declared figures alone cannot support an approval. */
  requireVerifiedEvidence: boolean;
}

export const DEFAULT_AFFORDABILITY_POLICY: AffordabilityPolicy = {
  bufferFractionOfIncome: '0.10',
  bufferMinimum: { USD: '50', KHR: '200000' },
  minDscr: '1.25',
  seasonalBufferFraction: '0.10',
  evidenceMaxAgeDays: 90,
  requireVerifiedEvidence: true,
};

export type EvidenceQuality = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'SELF_DECLARED';

export interface DebtObligation {
  description: string;
  monthlyPayment: string;
  /** The loan being restructured. Excluded from "other debts" so it is never counted twice. */
  isThisLoan?: boolean;
}

export interface IndividualInputs {
  template: 'INDIVIDUAL';
  verifiedNetIncome: string;
  essentialLivingExpenses: string;
  debts: DebtObligation[];
}

export interface HouseholdInputs {
  template: 'HOUSEHOLD';
  members: { name: string; verifiedNetIncome: string }[];
  essentialLivingExpenses: string;
  debts: DebtObligation[];
}

export interface BusinessInputs {
  template: 'BUSINESS';
  operatingCashInflows: string;
  operatingCashOutflows: string;
  taxes: string;
  essentialCapitalExpenditure: string;
  requiredWorkingCapitalIncrease: string;
  debts: DebtObligation[];
}

export interface SeasonalInputs {
  template: 'SEASONAL';
  /** Monthly forecast; month is the first day of the month (YYYY-MM-01). */
  forecast: { month: LocalDate; inflows: string; outflows: string }[];
  debts: DebtObligation[];
}

export type AffordabilityInputs = IndividualInputs | HouseholdInputs | BusinessInputs | SeasonalInputs;

export interface AffordabilityResult {
  template: AffordabilityInputs['template'];
  currency: string;
  /** Monthly amount available for this loan (non-seasonal templates). */
  availableForThisLoanMonthly: string | null;
  /** Per-month availability for seasonal borrowers. */
  seasonalCapacity: { month: LocalDate; surplus: string; available: string }[] | null;
  /** True when a normal repayment restructure can be sustained. */
  sustainable: boolean;
  /** Route to specialist review instead of producing a schedule. */
  specialistReview: boolean;
  lines: { label: string; amount: string }[];
  dscr: string | null;
  excludedDebts: string[];
  explanation: string[];
}

function otherDebts(debts: DebtObligation[]) {
  const counted = debts.filter((d) => !d.isThisLoan);
  return { total: sum(counted.map((d) => dec(d.monthlyPayment, 'monthlyPayment'))), excluded: debts.filter((d) => d.isThisLoan).map((d) => d.description) };
}

export function assessAffordability(inputs: AffordabilityInputs, currency: string, policy: AffordabilityPolicy = DEFAULT_AFFORDABILITY_POLICY): AffordabilityResult {
  const explanation: string[] = [];
  const lines: { label: string; amount: string }[] = [];
  const debts = otherDebts(inputs.debts ?? []);
  if (debts.excluded.length) explanation.push(`Excluded from other debts (this loan): ${debts.excluded.join(', ')}.`);

  if (inputs.template === 'INDIVIDUAL' || inputs.template === 'HOUSEHOLD') {
    const income = inputs.template === 'INDIVIDUAL' ? dec(inputs.verifiedNetIncome, 'verifiedNetIncome') : sum(inputs.members.map((m) => dec(m.verifiedNetIncome, 'member income')));
    const expenses = dec(inputs.essentialLivingExpenses, 'essentialLivingExpenses');
    const pctBuffer = income.times(policy.bufferFractionOfIncome);
    const minBuffer = new D(policy.bufferMinimum[currency] ?? '0');
    const buffer = pctBuffer.gt(minBuffer) ? pctBuffer : minBuffer;
    const available = income.minus(expenses).minus(debts.total).minus(buffer);
    lines.push({ label: 'Verified net income', amount: income.toString() }, { label: 'Essential living expenses', amount: expenses.negated().toString() }, { label: 'Other debt payments', amount: debts.total.negated().toString() }, { label: 'Safety buffer', amount: buffer.negated().toString() });
    explanation.push(`AvailableForThisLoan = ${income} − ${expenses} − ${debts.total} − ${buffer} = ${available} ${currency}/month (buffer = max(${policy.bufferFractionOfIncome} × income, ${minBuffer})).`);
    const sustainable = available.gt(0);
    if (!sustainable) explanation.push('No disposable income remains for this loan: a normal repayment restructure may not be sustainable. Route to specialist review.');
    return { template: inputs.template, currency, availableForThisLoanMonthly: available.toString(), seasonalCapacity: null, sustainable, specialistReview: !sustainable, lines, dscr: null, excludedDebts: debts.excluded, explanation };
  }

  if (inputs.template === 'BUSINESS') {
    const cfads = dec(inputs.operatingCashInflows)
      .minus(dec(inputs.operatingCashOutflows))
      .minus(dec(inputs.taxes))
      .minus(dec(inputs.essentialCapitalExpenditure))
      .minus(dec(inputs.requiredWorkingCapitalIncrease));
    lines.push(
      { label: 'Operating cash inflows', amount: inputs.operatingCashInflows },
      { label: 'Operating cash outflows', amount: `-${inputs.operatingCashOutflows}` },
      { label: 'Taxes', amount: `-${inputs.taxes}` },
      { label: 'Essential capital expenditure', amount: `-${inputs.essentialCapitalExpenditure}` },
      { label: 'Required working-capital increase', amount: `-${inputs.requiredWorkingCapitalIncrease}` },
    );
    // Capacity for this loan keeps total coverage at the policy DSCR: CFADS / (other + x) ≥ minDscr.
    const available = cfads.div(policy.minDscr).minus(debts.total);
    const dscrOther = debts.total.gt(0) ? cfads.div(debts.total) : null;
    explanation.push(`AvailableForDebtService (CFADS) = ${cfads} ${currency}/month; at a minimum DSCR of ${policy.minDscr}, capacity for this loan = ${cfads} ÷ ${policy.minDscr} − ${debts.total} other debt service = ${available.toDecimalPlaces(4)}.`);
    const sustainable = cfads.gt(0) && available.gt(0);
    if (!sustainable) explanation.push('Cash flow does not cover debt service at the policy DSCR. Route to specialist review.');
    return { template: 'BUSINESS', currency, availableForThisLoanMonthly: available.toDecimalPlaces(4).toString(), seasonalCapacity: null, sustainable, specialistReview: !sustainable, lines, dscr: dscrOther ? dscrOther.toDecimalPlaces(4).toString() : null, excludedDebts: debts.excluded, explanation };
  }

  // Seasonal: month by month, never an annual average.
  const capacity = inputs.forecast.map((m) => {
    parseDate(m.month, 'forecast.month');
    const surplus = dec(m.inflows).minus(dec(m.outflows)).minus(debts.total);
    const available = surplus.gt(0) ? surplus.times(new D(1).minus(policy.seasonalBufferFraction)) : surplus;
    return { month: m.month, surplus: surplus.toString(), available: available.toDecimalPlaces(4).toString() };
  });
  const total = sum(capacity.map((c) => dec(c.available)));
  const sustainable = total.gt(0);
  explanation.push(`Seasonal capacity over ${capacity.length} month(s): ${total.toDecimalPlaces(2)} ${currency} after other debts and a ${policy.seasonalBufferFraction} buffer on surplus months.`);
  if (!sustainable) explanation.push('The forecast shows no repayment capacity. Route to specialist review.');
  return { template: 'SEASONAL', currency, availableForThisLoanMonthly: null, seasonalCapacity: capacity, sustainable, specialistReview: !sustainable, lines, dscr: null, excludedDebts: debts.excluded, explanation };
}

/** DSCR with a proposed payment included in total debt service (matching monthly periods). */
export function dscrWith(cfadsMonthly: string, otherDebtMonthly: string, proposedMonthly: string): string {
  const total = dec(otherDebtMonthly).plus(dec(proposedMonthly));
  if (total.isZero()) throw new EngineError('DSCR_UNDEFINED', 'Total debt service is zero.');
  return dec(cfadsMonthly).div(total).toDecimalPlaces(4).toString();
}

const MONTHS_PER_PERIOD: Record<Exclude<Frequency, 'CUSTOM'>, string> = {
  WEEKLY: '0.2307692307692307692', // 12/52
  FORTNIGHTLY: '0.4615384615384615385', // 12/26
  MONTHLY: '1',
  QUARTERLY: '3',
  SEMI_ANNUAL: '6',
  ANNUAL: '12',
};

/** Convert a monthly capacity into the loan's payment frequency. */
export function capacityPerPeriod(monthly: string, frequency: Frequency): Dec {
  if (frequency === 'CUSTOM') throw new EngineError('UNSUPPORTED_FREQUENCY', 'Convert custom frequencies explicitly.');
  return dec(monthly).times(MONTHS_PER_PERIOD[frequency]);
}

/**
 * Seasonal check: by each due date, the cumulative payments must not exceed
 * the cumulative available capacity (surplus can be saved forward, deficits
 * are not ignored). Returns the first month that breaks, if any.
 */
export function seasonalScheduleFits(capacity: { month: LocalDate; available: string }[], payments: { dueDate: LocalDate; amount: string }[]): { fits: boolean; firstShortfall: { month: LocalDate; cumulativeCapacity: string; cumulativePayments: string } | null } {
  const months = [...capacity].sort((a, b) => compareDates(a.month, b.month));
  let cap = ZERO;
  let paid = ZERO;
  for (const m of months) {
    cap = cap.plus(m.available);
    const monthKey = m.month.slice(0, 7);
    for (const p of payments.filter((x) => x.dueDate.slice(0, 7) === monthKey)) paid = paid.plus(p.amount);
    // Deficit months reduce later capacity, but only a due payment can create a shortfall.
    if (paid.gt(0) && paid.gt(cap)) return { fits: false, firstShortfall: { month: m.month, cumulativeCapacity: cap.toString(), cumulativePayments: paid.toString() } };
  }
  return { fits: true, firstShortfall: null };
}
