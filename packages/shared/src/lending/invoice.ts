/**
 * Invoice financing (LT-18, UC-67). Pure: no I/O, no clock.
 */
import { dec, EngineError } from './decimal.js';
import { roundMoney, RoundingRule } from './money.js';
import { addDays, compareDates, daysBetween } from './dates.js';

export interface InvoiceTerms {
  invoiceAmount: string;
  /** Fraction of the invoice advanced, e.g. '0.80'. */
  advanceRate: string;
  /** Fee as a fraction of the invoice per fee period, e.g. '0.02'. */
  feeRatePerPeriod: string;
  /** Days in one fee period, e.g. 30. */
  feePeriodDays: number;
  /** Charge whole periods (a part period counts as one) or pro rata by days. */
  feeBasis: 'WHOLE_PERIODS' | 'PRO_RATA';
}

export function invoiceAdvance(t: InvoiceTerms, rounding: RoundingRule) {
  const invoice = dec(t.invoiceAmount, 'invoiceAmount');
  const rate = dec(t.advanceRate, 'advanceRate');
  if (invoice.lte(0) || rate.lte(0) || rate.gt(1)) throw new EngineError('INVOICE_INPUT', 'The invoice must be positive and the advance rate between 0 and 1.');
  const advance = roundMoney(invoice.times(rate), rounding);
  return { advance: advance.toString(), reserve: invoice.minus(advance).toString() };
}

/**
 * Settlement when the customer pays the invoice (TV-20): the fee for the
 * days outstanding is deducted from the reserve, and the rest is paid to the
 * borrower. If the customer pays less than advance + fee, the shortfall is
 * owed by the borrower (recourse, UC-67).
 */
export function invoiceSettlement(t: InvoiceTerms, daysOutstanding: number, customerPaid: string, rounding: RoundingRule) {
  if (!Number.isInteger(daysOutstanding) || daysOutstanding < 0) throw new EngineError('INVOICE_INPUT', 'Days outstanding must be a whole number ≥ 0.');
  const invoice = dec(t.invoiceAmount, 'invoiceAmount');
  const { advance } = invoiceAdvance(t, rounding);
  const periods =
    t.feeBasis === 'WHOLE_PERIODS'
      ? Math.max(1, Math.ceil(daysOutstanding / t.feePeriodDays))
      : daysOutstanding / t.feePeriodDays;
  const fee = roundMoney(invoice.times(dec(t.feeRatePerPeriod, 'feeRatePerPeriod')).times(periods), rounding);
  const paid = dec(customerPaid, 'customerPaid');
  const owedToLender = dec(advance).plus(fee);
  const toBorrower = paid.minus(owedToLender);
  return {
    advance,
    fee: fee.toString(),
    paidToBorrower: (toBorrower.gt(0) ? toBorrower : dec(0)).toString(),
    recourseOwedByBorrower: (toBorrower.lt(0) ? toBorrower.negated() : dec(0)).toString(),
    explanation: `Fee ${t.feeRatePerPeriod} × ${invoice} × ${periods} period(s) = ${fee}; customer paid ${paid} against ${owedToLender} (advance + fee).`,
  };
}

// ── Servicing an invoice advance (LT-18, UC-67) ─────────────────────────────

/** The fee for `days` outstanding, exactly as `invoiceSettlement` charges it (TV-20). */
export function invoiceFee(t: InvoiceTerms, days: number, rounding: RoundingRule): string {
  if (!Number.isInteger(days) || days < 0) throw new EngineError('INVOICE_INPUT', 'Days outstanding must be a whole number ≥ 0.');
  if (!Number.isInteger(t.feePeriodDays) || t.feePeriodDays < 1) throw new EngineError('INVOICE_INPUT', 'The fee period must be at least one day.');
  const periods = t.feeBasis === 'WHOLE_PERIODS' ? Math.max(1, Math.ceil(days / t.feePeriodDays)) : days / t.feePeriodDays;
  return roundMoney(dec(t.invoiceAmount, 'invoiceAmount').times(dec(t.feeRatePerPeriod, 'feeRatePerPeriod')).times(periods), rounding).toString();
}

/**
 * The last day the debtor may pay before the borrower becomes liable for the
 * advance (UC-67): the invoice due date plus the product's grace days.
 * Recourse applies from the day after it.
 */
export function invoiceRecourseDate(dueDate: string, graceDays: number): string {
  if (!Number.isInteger(graceDays) || graceDays < 0) throw new EngineError('INVOICE_INPUT', 'Grace days must be a whole number ≥ 0.');
  return addDays(dueDate, graceDays);
}

export interface InvoicePosition {
  terms: InvoiceTerms;
  advanceDate: string;
  /** Advance still owed by the debtor or, after recourse, by the borrower. */
  advanceOutstanding: string;
  /** Fee raised so far (receivable posted) and the part of it collected. */
  feeRaised: string;
  feePaid: string;
  /** Set once recourse applies: the fee stops growing at this date. */
  recourseDate: string | null;
}

/** The fee owed to `asOf` without collecting anything: what a quote shows. */
export function invoiceFeeToDate(p: InvoicePosition, asOf: string, rounding: RoundingRule): string {
  const to = p.recourseDate && compareDates(p.recourseDate, asOf) < 0 ? p.recourseDate : asOf;
  if (compareDates(to, p.advanceDate) < 0) return dec(p.feeRaised, 'feeRaised').toString();
  const fee = dec(invoiceFee(p.terms, daysBetween(p.advanceDate, to), rounding));
  const raised = dec(p.feeRaised, 'feeRaised');
  return (fee.gt(raised) ? fee : raised).toString();
}

/**
 * Apply one collection against a financed invoice.
 *
 * The fee is charged for the days from the advance to the payment (or to the
 * recourse date, once recourse applies), and only the part not already raised
 * is raised now. The money then clears the fee, then the advance; whatever is
 * left belongs to the borrower and is held as their reserve. A borrower
 * (recourse) payment may never exceed what is owed — only the debtor's
 * payment can produce a reserve.
 */
export function allocateInvoiceCollection(
  p: InvoicePosition,
  collection: { amount: string; valueDate: string; source: 'DEBTOR' | 'BORROWER' },
  rounding: RoundingRule,
) {
  const amount = dec(collection.amount, 'amount');
  if (amount.lte(0)) throw new EngineError('INVOICE_INPUT', 'A collection must be positive.');
  if (compareDates(collection.valueDate, p.advanceDate) < 0)
    throw new EngineError('INVOICE_INPUT', `A collection cannot be dated before the advance (${p.advanceDate}).`);
  const raised = dec(p.feeRaised, 'feeRaised');
  const feeToDate = dec(invoiceFeeToDate(p, collection.valueDate, rounding));
  const feeRaise = feeToDate.minus(raised);
  const feeOwed = feeToDate.minus(dec(p.feePaid, 'feePaid'));
  const advanceOwed = dec(p.advanceOutstanding, 'advanceOutstanding');
  const toFee = amount.lt(feeOwed) ? amount : feeOwed;
  const afterFee = amount.minus(toFee);
  const toAdvance = afterFee.lt(advanceOwed) ? afterFee : advanceOwed;
  const toReserve = afterFee.minus(toAdvance);
  if (collection.source === 'BORROWER' && toReserve.gt(0))
    throw new EngineError('INVOICE_OVERPAYMENT', `The borrower owes ${feeOwed.plus(advanceOwed)} on this invoice; a recourse payment cannot exceed it.`);
  const owedAfter = feeOwed.minus(toFee).plus(advanceOwed.minus(toAdvance));
  return {
    feeToDate: feeToDate.toString(),
    feeRaise: feeRaise.toString(),
    toFee: toFee.toString(),
    toAdvance: toAdvance.toString(),
    toReserve: toReserve.toString(),
    owedAfter: owedAfter.toString(),
    settled: owedAfter.isZero(),
    explanation: `Fee to date ${feeToDate} (${p.terms.feeRatePerPeriod} of ${p.terms.invoiceAmount} per ${p.terms.feePeriodDays} days from ${p.advanceDate}); ${amount} applied ${toFee} to the fee, ${toAdvance} to the advance and ${toReserve} to the borrower's reserve.`,
  };
}
