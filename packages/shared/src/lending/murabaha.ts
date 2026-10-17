/**
 * Murabaha: a deferred-payment sale. The financier buys an asset from its
 * supplier and sells it to the customer at cost plus a profit disclosed and
 * fixed in the contract, payable in instalments. There is no interest: the
 * profit is part of the sale price, deferred at the sale and recognised as
 * it is earned over the term. On early settlement the financier may give up
 * part of the profit not yet earned (ibra').
 *
 * Pure: no I/O, no clock.
 */
import { D, dec, EngineError, ONE, ZERO, sum } from './decimal.js';
import { LocalDate, compareDates, daysBetween } from './dates.js';
import { RoundingRule, roundMoney } from './money.js';

export interface MurabahaScheduleLine {
  number: number;
  periodStart: LocalDate;
  periodEnd: LocalDate;
  dueDate: LocalDate;
  /** Cost share of the instalment. */
  principal: string;
  /** Profit share of the instalment. */
  interest: string;
}

export interface MurabahaContractTerms {
  /** What the financier paid the supplier for the asset. */
  cost: string;
  /** What the customer paid towards the price up front (not financed). */
  downPayment: string;
  /** The financed cost (cost − down payment). */
  financed: string;
  /** The disclosed, fixed profit. */
  profit: string;
  /** Cost + profit: the price the customer buys the asset at. */
  salePrice: string;
  /** Sale price still to pay after the down payment: the sum of the instalments. */
  deferredPrice: string;
  instalments: number;
  /** Profit ÷ financed cost, the disclosed mark-up over the whole term. */
  markUp: string;
  explanation: string;
}

/** The figures the contract discloses, from its schedule. */
export function murabahaContract(cost: string, downPayment: string, lines: MurabahaScheduleLine[]): MurabahaContractTerms {
  const c = dec(cost, 'cost');
  const down = dec(downPayment, 'downPayment');
  const financed = c.minus(down);
  if (financed.lte(0)) throw new EngineError('INVALID_PRINCIPAL', 'The financed cost must be positive.');
  const scheduled = sum(lines.map((l) => dec(l.principal)));
  if (!scheduled.eq(financed))
    throw new EngineError('INVALID_SCHEDULE', `The instalments repay ${scheduled} of cost but ${financed} is financed (cost ${c} less down payment ${down}).`);
  const profit = sum(lines.map((l) => dec(l.interest)));
  const salePrice = c.plus(profit);
  const markUp = profit.div(financed).toDecimalPlaces(6);
  return {
    cost: c.toString(),
    downPayment: down.toString(),
    financed: financed.toString(),
    profit: profit.toString(),
    salePrice: salePrice.toString(),
    deferredPrice: salePrice.minus(down).toString(),
    instalments: lines.length,
    markUp: markUp.toString(),
    explanation: `Bought for ${c}, sold for ${salePrice} (cost ${c} + profit ${profit}, a mark-up of ${markUp.times(100).toDecimalPlaces(2)}% on the ${financed} financed)${down.gt(0) ? `, of which ${down} paid up front` : ''}, payable in ${lines.length} instalment(s).`,
  };
}

export interface ProfitRecognitionRow {
  number: number;
  dueDate: LocalDate;
  profit: string;
  /** Profit recognised up to the end of this period. */
  cumulativeRecognised: string;
  /** Deferred profit left after this period. */
  deferredRemaining: string;
}

/**
 * How the deferred profit is recognised: each instalment's profit is earned
 * over its own period, so the deferred balance falls by that profit as each
 * period ends (and pro rata by days within a period, which `deferredProfitAt`
 * gives). Recognising profit with the time it is outstanding is the
 * effective-yield basis of AAOIFI FAS 28 / IFRS 9; a straight-line product
 * simply has level profit per period.
 */
export function murabahaProfitRecognition(lines: MurabahaScheduleLine[]): ProfitRecognitionRow[] {
  const total = sum(lines.map((l) => dec(l.interest)));
  let cumulative = ZERO;
  return lines.map((l) => {
    cumulative = cumulative.plus(dec(l.interest));
    return {
      number: l.number,
      dueDate: l.dueDate,
      profit: dec(l.interest).toString(),
      cumulativeRecognised: cumulative.toString(),
      deferredRemaining: total.minus(cumulative).toString(),
    };
  });
}

/** Deferred profit left on `asOf`: profit of later periods plus the unearned part of the current one. */
export function deferredProfitAt(lines: MurabahaScheduleLine[], asOf: LocalDate, rounding: RoundingRule): string {
  let deferred = ZERO;
  for (const l of lines) {
    const profit = dec(l.interest);
    if (compareDates(asOf, l.periodStart) <= 0) deferred = deferred.plus(profit);
    else if (compareDates(asOf, l.periodEnd) < 0) {
      const earned = roundMoney(profit.times(daysBetween(l.periodStart, asOf)).div(daysBetween(l.periodStart, l.periodEnd)), rounding);
      deferred = deferred.plus(profit.minus(earned));
    }
  }
  return deferred.toString();
}

export interface MurabahaSettlementInput {
  /** Profit on the contract not yet paid (due and future). */
  remainingProfit: string;
  /** Profit recognised (earned) and not yet paid. */
  earnedUnpaid: string;
  /** Share of the unearned profit rebated; null: no ibra'. */
  ibraShare: string | null;
  rounding: RoundingRule;
}

export interface MurabahaSettlement {
  unearnedProfit: string;
  /** The rebate given up (ibra'). */
  ibra: string;
  /** Profit the customer pays on settlement: everything earned plus the unearned part not rebated. */
  profitOwed: string;
  explanation: string;
}

/**
 * Profit owed on early settlement. The customer owes the sale price; the
 * financier may waive (ibra') a share of the profit it has not yet earned.
 * Without ibra' the full remaining profit is payable.
 */
export function murabahaEarlySettlement(i: MurabahaSettlementInput): MurabahaSettlement {
  const remaining = dec(i.remainingProfit, 'remainingProfit');
  const earned = dec(i.earnedUnpaid, 'earnedUnpaid');
  if (remaining.lt(0) || earned.lt(0)) throw new EngineError('INVALID_SETTLEMENT', 'Profit balances cannot be negative.');
  const unearned = D.max(ZERO, remaining.minus(earned));
  const share = i.ibraShare === null ? ZERO : dec(i.ibraShare, 'ibraShare');
  if (share.lt(0) || share.gt(ONE)) throw new EngineError('INVALID_SETTLEMENT', 'The ibra’ share is a fraction between 0 and 1.');
  const ibra = roundMoney(unearned.times(share), i.rounding);
  const owed = earned.plus(unearned).minus(ibra);
  return {
    unearnedProfit: unearned.toString(),
    ibra: ibra.toString(),
    profitOwed: owed.toString(),
    explanation:
      i.ibraShare === null
        ? `The contract grants no rebate: the remaining profit of ${earned.plus(unearned)} is payable in full.`
        : ibra.isZero()
          ? `No unearned profit is left to rebate; ${owed} of profit is payable.`
          : `${earned} of profit earned to date is payable; of the ${unearned} not yet earned, ${ibra} is waived (ibra’, ${share.times(100)}%)${unearned.minus(ibra).gt(0) ? ` and ${unearned.minus(ibra)} is payable` : ''}.`,
  };
}

/**
 * The deferred-profit memo the ledger should carry for a contract: the
 * profit not yet recognised while the contract is live, nothing once it has
 * ended (settled, closed or written off).
 */
export function deferredProfitTarget(totalProfit: string, recognised: string, live: boolean): string {
  if (!live) return '0';
  return D.max(ZERO, dec(totalProfit, 'totalProfit').minus(dec(recognised, 'recognised'))).toString();
}

