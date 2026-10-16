/**
 * Refinancing: replacing a loan with a new one whose proceeds settle it.
 *
 * The arithmetic is simple — net proceeds against the payoff — but the thing
 * that matters supervisorily is not the arithmetic. A refinance can be used
 * to make an arrears problem disappear: roll the overdue interest and
 * penalties of a struggling loan into a fresh facility, and the old loan
 * closes "paid" while the borrower is no better off. That is evergreening,
 * and this module's job is to name it rather than let it pass as origination.
 *
 * So the result reports, separately from the money: how much of the payoff
 * was arrears, whether those arrears were funded by the new loan, and whether
 * the loan being replaced was delinquent. A caller may still proceed — there
 * are legitimate refinances of delinquent loans — but it cannot do so without
 * the fact being on the record.
 */
import { Dec, dec, EngineError, ZERO } from './decimal.js';
import { RoundingRule, parseMoney, roundMoney } from './money.js';

export interface RefinancePayoff {
  /** Principal outstanding on the loan being replaced. */
  principal: string;
  /** Interest due or accrued but unpaid. */
  interest: string;
  fees: string;
  penalties: string;
  /** A settlement fee the old product charges to close early. */
  settlementFee?: string;
  /**
   * The part of interest, fees and penalties that is already overdue — the
   * arrears a refinance could bury.
   */
  overdue?: string;
  /** Days past due on the loan being replaced. */
  daysPastDue?: number;
}

export interface RefinanceTerms {
  /** Gross principal of the new loan. */
  newPrincipal: string;
  /** Upfront fees deducted from the new loan's proceeds. */
  deductedFees?: string;
  /**
   * Whether the borrower may fund a shortfall in cash. When false, a new loan
   * that does not cover the payoff is refused rather than leaving the old
   * loan partly settled.
   */
  allowBorrowerShortfallPayment?: boolean;
}

export interface RefinanceResult {
  /** Everything needed to close the old loan. */
  payoffAmount: string;
  /** New principal less its deducted fees. */
  netProceeds: string;
  /** Of the proceeds, what settles the old loan. */
  appliedToPayoff: string;
  /** Proceeds left over, paid to the borrower. */
  topUpToBorrower: string;
  /** What the borrower must add in cash for the payoff to complete. */
  shortfall: string;
  /** Arrears on the old loan at the moment it is replaced. */
  arrears: string;
  /**
   * Arrears funded by the new loan rather than by the borrower. Non-zero
   * means the new loan is carrying the old loan's missed payments.
   */
  arrearsRolledIn: string;
  /** The old loan was behind when it was replaced. */
  replacingDelinquentLoan: boolean;
  /**
   * The refinance both replaces a delinquent loan and funds its arrears —
   * the pattern a supervisor would call evergreening.
   */
  evergreening: boolean;
  explanation: string[];
}

/**
 * Work out what a refinance actually does.
 *
 * Throws only when the result would be incoherent: nothing to repay, or a
 * shortfall the caller has not said the borrower will fund. Everything a
 * credit officer should think twice about is reported, not thrown — refusing
 * it here would push callers into working around the engine.
 */
export function calculateRefinance(
  payoff: RefinancePayoff,
  terms: RefinanceTerms,
  currency: string,
  rounding: RoundingRule,
): RefinanceResult {
  const read = (v: string | undefined, field: string) => parseMoney(v ?? '0', currency, field);
  const principal = read(payoff.principal, 'payoff.principal');
  const interest = read(payoff.interest, 'payoff.interest');
  const fees = read(payoff.fees, 'payoff.fees');
  const penalties = read(payoff.penalties, 'payoff.penalties');
  const settlementFee = read(payoff.settlementFee, 'payoff.settlementFee');
  for (const [name, value] of Object.entries({ principal, interest, fees, penalties, settlementFee })) {
    if (value.lt(0)) throw new EngineError('INVALID_PAYOFF', `payoff.${name} is negative.`);
  }

  const payoffAmount = roundMoney(
    principal.plus(interest).plus(fees).plus(penalties).plus(settlementFee),
    rounding,
  );
  if (payoffAmount.lte(0)) {
    throw new EngineError('NOTHING_TO_REFINANCE', 'The loan being replaced owes nothing.');
  }

  const newPrincipal = parseMoney(terms.newPrincipal, currency, 'newPrincipal');
  if (newPrincipal.lte(0)) {
    throw new EngineError('INVALID_PRINCIPAL', 'The refinancing loan must have a principal greater than zero.');
  }
  const deductedFees = read(terms.deductedFees, 'deductedFees');
  if (deductedFees.gte(newPrincipal)) {
    throw new EngineError(
      'FEES_EXCEED_PRINCIPAL',
      `Deducted fees of ${deductedFees.toString()} leave nothing of a ${newPrincipal.toString()} loan.`,
    );
  }
  const netProceeds = newPrincipal.minus(deductedFees);

  const appliedToPayoff = netProceeds.lt(payoffAmount) ? netProceeds : payoffAmount;
  const topUp = netProceeds.minus(appliedToPayoff);
  const shortfall = payoffAmount.minus(appliedToPayoff);
  if (shortfall.gt(0) && !terms.allowBorrowerShortfallPayment) {
    throw new EngineError(
      'REFINANCE_SHORTFALL',
      `The new loan nets ${netProceeds.toString()}, which is ${shortfall.toString()} short of the ${payoffAmount.toString()} payoff.`,
    );
  }

  // Arrears default to the whole of interest, fees and penalties when the
  // caller has not separated out what is overdue: assuming none is overdue
  // would understate the risk, and understating it is the failure mode that
  // matters here.
  const arrears =
    payoff.overdue === undefined
      ? roundMoney(interest.plus(fees).plus(penalties), rounding)
      : read(payoff.overdue, 'payoff.overdue');
  if (arrears.gt(payoffAmount)) {
    throw new EngineError('INVALID_PAYOFF', `Arrears of ${arrears.toString()} exceed the payoff of ${payoffAmount.toString()}.`);
  }
  // The payoff clears principal first, so arrears are the last thing the
  // proceeds reach: whatever of them the proceeds cover is rolled in.
  const coveredBeyondPrincipal = appliedToPayoff.minus(principal);
  const arrearsRolledIn = arrearsFunded(coveredBeyondPrincipal, arrears);
  const delinquent = (payoff.daysPastDue ?? 0) > 0;
  const evergreening = delinquent && arrearsRolledIn.gt(0);

  const explanation = [
    `Payoff ${payoffAmount.toString()}; the new loan nets ${netProceeds.toString()} after ${deductedFees.toString()} of fees.`,
    shortfall.gt(0)
      ? `The borrower funds the remaining ${shortfall.toString()}.`
      : topUp.gt(0)
        ? `${topUp.toString()} is paid to the borrower as a top-up.`
        : 'The proceeds exactly settle the loan being replaced.',
  ];
  if (arrears.gt(0)) {
    explanation.push(
      arrearsRolledIn.gt(0)
        ? `${arrearsRolledIn.toString()} of ${arrears.toString()} arrears is funded by the new loan, not repaid by the borrower.`
        : `${arrears.toString()} of arrears is settled by the borrower, not rolled into the new loan.`,
    );
  }
  if (evergreening) {
    explanation.push(
      `This replaces a loan ${payoff.daysPastDue} day(s) past due and funds its arrears; it conceals delinquency rather than resolving it.`,
    );
  }

  return {
    payoffAmount: payoffAmount.toString(),
    netProceeds: netProceeds.toString(),
    appliedToPayoff: appliedToPayoff.toString(),
    topUpToBorrower: topUp.toString(),
    shortfall: shortfall.toString(),
    arrears: arrears.toString(),
    arrearsRolledIn: arrearsRolledIn.toString(),
    replacingDelinquentLoan: delinquent,
    evergreening,
    explanation,
  };
}

function arrearsFunded(coveredBeyondPrincipal: Dec, arrears: Dec): Dec {
  if (coveredBeyondPrincipal.lte(0)) return ZERO;
  return coveredBeyondPrincipal.lt(arrears) ? coveredBeyondPrincipal : arrears;
}

/**
 * Whether a refinance may proceed under the product's rules.
 *
 * Separated from the arithmetic so a product can forbid what the engine can
 * nonetheless compute: a quote may legitimately show an evergreening
 * refinance in order to explain why it is being refused.
 */
export interface RefinanceRules {
  /** Replacing a loan that is behind at all. */
  allowDelinquent: boolean;
  /** Funding the old loan's arrears from the new loan. */
  allowArrearsRollIn: boolean;
  /** Days past due beyond which a refinance is refused outright. */
  maxDaysPastDue: number | null;
  /** Minimum instalments the old loan must have paid first. */
  minInstalmentsPaid: number;
  /** How many times one borrowing may be refinanced. */
  maxRefinanceCount: number;
}

export interface RefinanceIssue {
  code: string;
  message: string;
}

export function checkRefinanceRules(
  rules: RefinanceRules,
  result: RefinanceResult,
  loan: { daysPastDue: number; instalmentsPaid: number; refinanceCount: number },
): RefinanceIssue[] {
  const issues: RefinanceIssue[] = [];
  if (result.replacingDelinquentLoan && !rules.allowDelinquent) {
    issues.push({
      code: 'DELINQUENT',
      message: `The loan is ${loan.daysPastDue} day(s) past due and this product does not refinance loans in arrears.`,
    });
  }
  if (rules.maxDaysPastDue !== null && loan.daysPastDue > rules.maxDaysPastDue) {
    issues.push({
      code: 'DPD',
      message: `The loan is ${loan.daysPastDue} day(s) past due; the product allows at most ${rules.maxDaysPastDue}.`,
    });
  }
  if (dec(result.arrearsRolledIn).gt(0) && !rules.allowArrearsRollIn) {
    issues.push({
      code: 'ARREARS_ROLL_IN',
      message: `${result.arrearsRolledIn} of arrears would be funded by the new loan, which this product does not permit.`,
    });
  }
  if (loan.instalmentsPaid < rules.minInstalmentsPaid) {
    issues.push({
      code: 'SEASONING',
      message: `${loan.instalmentsPaid} instalment(s) have been paid; the product requires ${rules.minInstalmentsPaid} before refinancing.`,
    });
  }
  if (loan.refinanceCount >= rules.maxRefinanceCount) {
    issues.push({
      code: 'REFINANCE_LIMIT',
      message: `This borrowing has already been refinanced ${loan.refinanceCount} time(s); the product allows ${rules.maxRefinanceCount}.`,
    });
  }
  return issues;
}
