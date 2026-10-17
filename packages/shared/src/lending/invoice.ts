/**
 * Invoice financing (LT-18, UC-67). Pure: no I/O, no clock.
 */
import { dec, EngineError } from './decimal.js';
import { roundMoney, RoundingRule } from './money.js';

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
