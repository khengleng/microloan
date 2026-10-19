/**
 * Receivables purchase and trade-cycle finance (LT-18 family). Pure: no I/O,
 * no clock.
 *
 *  • Factoring: the lender buys the seller's invoice, pays an advance net of
 *    a service fee, notifies the debtor and collects; recourse to the seller
 *    is FULL, LIMITED (to a share of the invoice) or NONE.
 *  • Forfaiting and supply-chain finance: the lender buys a bill, note or
 *    buyer-approved invoice at a discount for the days to maturity and
 *    collects the face value at maturity.
 *  • Documentary (import / export) loans: a term loan whose amount, tenor and
 *    disbursement are tied to one trade transaction and its documents.
 */
import { D, dec, EngineError } from './decimal.js';
import { roundMoney, RoundingRule } from './money.js';
import { addDays, compareDates, daysBetween } from './dates.js';

type Dec = InstanceType<typeof D>;

export type ReceivablesKind = 'INVOICE_FINANCE' | 'FACTORING' | 'SUPPLY_CHAIN' | 'FORFAITING';
export type RecourseType = 'FULL' | 'LIMITED' | 'NONE';
export type DiscountMethod = 'STRAIGHT' | 'YIELD';

/** Which receivables product a configuration describes, if any. */
export function receivablesKind(c: {
  trade?: { invoice?: unknown; factoring?: unknown; supplyChain?: unknown; forfaiting?: unknown } | null;
} | null | undefined): ReceivablesKind | null {
  const t = c?.trade;
  if (!t) return null;
  if (t.invoice) return 'INVOICE_FINANCE';
  if (t.factoring) return 'FACTORING';
  if (t.supplyChain) return 'SUPPLY_CHAIN';
  if (t.forfaiting) return 'FORFAITING';
  return null;
}

// ── Discounting (forfaiting, supply-chain finance) ──────────────────────────

export interface DiscountTerms {
  faceAmount: string;
  /** Annual discount rate, e.g. '0.08'. */
  annualRate: string;
  dayCountBasis: 360 | 365;
  /** STRAIGHT: face × rate × days / basis. YIELD: face − face / (1 + rate × days / basis). */
  method: DiscountMethod;
}

/**
 * The discount withheld when a receivable of `faceAmount` maturing in `days`
 * is bought today. The purchase price is the face value less the discount.
 */
export function discountForDays(t: DiscountTerms, days: number, rounding: RoundingRule) {
  const face = dec(t.faceAmount, 'faceAmount');
  const rate = dec(t.annualRate, 'annualRate');
  if (face.lte(0)) throw new EngineError('DISCOUNT_INPUT', 'The face amount must be positive.');
  if (rate.lt(0) || rate.gte(1)) throw new EngineError('DISCOUNT_INPUT', 'The discount rate must be at least 0 and below 1.');
  if (!Number.isInteger(days) || days < 0) throw new EngineError('DISCOUNT_INPUT', 'The discount period must be a whole number of days ≥ 0.');
  if (t.dayCountBasis !== 360 && t.dayCountBasis !== 365) throw new EngineError('DISCOUNT_INPUT', 'The day-count basis is 360 or 365.');
  const fraction = rate.times(days).div(t.dayCountBasis);
  const raw = t.method === 'YIELD' ? face.minus(face.div(fraction.plus(1))) : face.times(fraction);
  const discount = roundMoney(raw, rounding);
  if (discount.gte(face)) throw new EngineError('DISCOUNT_INPUT', 'The discount would consume the whole face value.');
  return {
    days,
    discount: discount.toString(),
    purchasePrice: face.minus(discount).toString(),
    explanation:
      t.method === 'YIELD'
        ? `${face} − ${face} / (1 + ${rate} × ${days}/${t.dayCountBasis}) = ${discount} discount (discount to yield).`
        : `${face} × ${rate} × ${days}/${t.dayCountBasis} = ${discount} discount (straight discount).`,
  };
}

/**
 * The part of a discount earned by `asOf`, straight-line over the days from
 * purchase to maturity. All of it is earned at maturity; none before the
 * purchase. Earlier recognition is never reversed: the caller posts only the
 * increase over what it has already earned.
 */
export function discountEarnedToDate(discount: string, purchaseDate: string, maturityDate: string, asOf: string, rounding: RoundingRule): string {
  const total = dec(discount, 'discount');
  if (total.lt(0)) throw new EngineError('DISCOUNT_INPUT', 'A discount cannot be negative.');
  const span = daysBetween(purchaseDate, maturityDate);
  if (span <= 0 || compareDates(asOf, maturityDate) >= 0) return total.toString();
  const elapsed = daysBetween(purchaseDate, asOf);
  if (elapsed <= 0) return '0';
  return roundMoney(total.times(elapsed).div(span), rounding).toString();
}

// ── Factoring ───────────────────────────────────────────────────────────────

export interface FactoringPurchaseTerms {
  invoiceAmount: string;
  advanceRate: string;
  /** Service (commission) fee as a fraction of the invoice, deducted from the advance. */
  serviceFeeRate: string;
}

/** What buying a factored invoice pays the seller, and what is kept. */
export function factoringPurchase(t: FactoringPurchaseTerms, rounding: RoundingRule) {
  const invoice = dec(t.invoiceAmount, 'invoiceAmount');
  const rate = dec(t.advanceRate, 'advanceRate');
  const feeRate = dec(t.serviceFeeRate, 'serviceFeeRate');
  if (invoice.lte(0) || rate.lte(0) || rate.gt(1)) throw new EngineError('FACTORING_INPUT', 'The invoice must be positive and the advance rate between 0 and 1.');
  if (feeRate.lt(0)) throw new EngineError('FACTORING_INPUT', 'The service fee rate cannot be negative.');
  const advance = roundMoney(invoice.times(rate), rounding);
  const serviceFee = roundMoney(invoice.times(feeRate), rounding);
  const net = advance.minus(serviceFee);
  if (net.lte(0)) throw new EngineError('FACTORING_INPUT', `The service fee ${serviceFee} would consume the whole advance ${advance}.`);
  return {
    advance: advance.toString(),
    serviceFee: serviceFee.toString(),
    paidToSeller: net.toString(),
    reserve: invoice.minus(advance).toString(),
    explanation: `Advance ${rate} × ${invoice} = ${advance}; service fee ${feeRate} × ${invoice} = ${serviceFee}; ${net} paid to the seller.`,
  };
}

/**
 * How much of what is still owed on a purchased receivable the seller must
 * make good once the debtor has defaulted, and how much the lender bears.
 * Under LIMITED recourse the seller is liable up to `cap` in total; what it
 * has already paid under recourse counts towards the cap.
 */
export function recourseSplit(recourse: RecourseType, owed: string, cap: string | null, alreadyPaidByBorrower = '0') {
  const o = dec(owed, 'owed');
  if (o.lt(0)) throw new EngineError('RECOURSE_INPUT', 'What is owed cannot be negative.');
  let borrower: Dec;
  if (recourse === 'FULL') borrower = o;
  else if (recourse === 'NONE') borrower = new D(0);
  else {
    if (cap === null) throw new EngineError('RECOURSE_INPUT', 'Limited recourse needs a cap.');
    const left = D.max(0, dec(cap, 'cap').minus(dec(alreadyPaidByBorrower, 'alreadyPaidByBorrower')));
    borrower = D.min(o, left);
  }
  return { borrowerOwes: borrower.toString(), lenderBears: o.minus(borrower).toString() };
}

/**
 * Concentration on one debtor: what the lender would have outstanding on
 * that debtor after this advance, as a share of the facility limit.
 */
export function debtorConcentration(input: { limit: string; debtorOutstanding: string; newAdvance: string; maxShare: string | null }) {
  const limit = dec(input.limit, 'limit');
  const after = dec(input.debtorOutstanding, 'debtorOutstanding').plus(dec(input.newAdvance, 'newAdvance'));
  const share = limit.gt(0) ? after.div(limit) : new D(0);
  const max = input.maxShare === null ? null : dec(input.maxShare, 'maxShare');
  const ok = max === null || share.lte(max);
  return {
    ok,
    exposureAfter: after.toString(),
    share: share.toDecimalPlaces(6).toString(),
    message: ok ? null : `Exposure to this debtor would reach ${after} (${share.times(100).toDecimalPlaces(2)}% of the limit); the product allows at most ${max!.times(100)}%.`,
  };
}

// ── Documentary trade loans (import / export) ───────────────────────────────

export interface TradeCycleTerms {
  /** Longest trade cycle financed: from shipment (or the contract) to the proceeds. */
  maxTradeCycleDays: number;
  /** Days the loan may run beyond the expected proceeds date. */
  proceedsGraceDays: number;
  /** Largest share of the transaction value lent, e.g. '0.9'. */
  maxFinancingRatio: string;
}

export interface TradeCycleInput {
  transactionValue: string;
  principal: string;
  /** Shipment date (import) or contract / order date (export): the start of the cycle. */
  cycleStartDate: string;
  expectedProceedsDate: string;
  /** The loan's disbursement date and final due date. */
  financeDate: string;
  maturityDate: string;
}

/**
 * Whether a loan fits the trade it finances: the amount within the
 * financing ratio of the transaction, the trade cycle within the product's
 * maximum, and the loan repaid from the proceeds — maturing no later than
 * the expected proceeds date plus grace.
 */
export function checkTradeCycle(t: TradeCycleTerms, x: TradeCycleInput) {
  const issues: { code: string; message: string }[] = [];
  const value = dec(x.transactionValue, 'transactionValue');
  const principal = dec(x.principal, 'principal');
  const ratio = dec(t.maxFinancingRatio, 'maxFinancingRatio');
  if (value.lte(0)) issues.push({ code: 'TRADE_VALUE', message: 'The transaction value must be positive.' });
  const maxFinanceable = value.times(ratio);
  if (principal.gt(maxFinanceable))
    issues.push({ code: 'TRADE_FINANCING_RATIO', message: `At most ${ratio.times(100)}% of the ${value} transaction (${maxFinanceable}) may be lent; this loan is ${principal}.` });
  const cycle = daysBetween(x.cycleStartDate, x.expectedProceedsDate);
  if (cycle < 0) issues.push({ code: 'TRADE_DATES', message: 'The proceeds cannot be expected before the cycle starts.' });
  else if (cycle > t.maxTradeCycleDays)
    issues.push({ code: 'TRADE_CYCLE', message: `The trade cycle runs ${cycle} days; this product finances cycles of at most ${t.maxTradeCycleDays}.` });
  if (compareDates(x.expectedProceedsDate, x.financeDate) < 0)
    issues.push({ code: 'TRADE_PROCEEDS_PAST', message: `The proceeds were expected on ${x.expectedProceedsDate}, before the loan would be paid out (${x.financeDate}).` });
  const latestMaturity = addDays(x.expectedProceedsDate, t.proceedsGraceDays);
  if (compareDates(x.maturityDate, latestMaturity) > 0)
    issues.push({ code: 'TRADE_TENOR', message: `The loan matures on ${x.maturityDate}, after the expected proceeds date plus ${t.proceedsGraceDays} days (${latestMaturity}); shorten the tenor so the proceeds repay it.` });
  return { ok: issues.length === 0, issues, maxFinanceable: maxFinanceable.toString(), latestMaturity, cycleDays: cycle };
}

/** Which required documents are still missing or not yet verified. */
export function documentChecklist(required: string[], documents: { code: string; status: string }[]) {
  const by = new Map(documents.map((d) => [d.code, d.status]));
  const missing = required.filter((c) => !by.has(c) || by.get(c) === 'PENDING' || by.get(c) === 'REJECTED');
  const unverified = required.filter((c) => by.get(c) === 'RECEIVED');
  return { complete: missing.length === 0 && unverified.length === 0, missing, unverified };
}

/**
 * Trade proceeds received for a financed transaction: what repays the loan
 * and what is passed on to the customer. Proceeds at or above the payoff
 * settle the loan; anything less is a repayment.
 */
export function proceedsApplication(proceeds: string, payoff: string) {
  const p = dec(proceeds, 'proceeds');
  const owed = dec(payoff, 'payoff');
  if (p.lte(0)) throw new EngineError('PROCEEDS_INPUT', 'Proceeds must be positive.');
  const applied = D.min(p, owed);
  return { applied: applied.toString(), remitted: p.minus(applied).toString(), settles: p.gte(owed) && owed.gt(0) };
}
