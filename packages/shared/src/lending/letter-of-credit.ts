/**
 * Letters of credit (LT-19, UC-53). Pure: no I/O, no clock.
 *
 * An issued letter of credit is a contingent commitment, not a loan: the bank
 * earns a fee and records the commitment off balance sheet. Only when the
 * bank pays the beneficiary does the importer owe money, and that debt is
 * booked as an ordinary loan.
 */
import { dec, EngineError } from './decimal.js';
import { roundMoney, RoundingRule } from './money.js';
import { compareDates, daysBetween } from './dates.js';

export interface LetterOfCreditFeeTerms {
  /** Fee as a fraction of the LC amount per fee period, e.g. '0.005'. */
  feeRatePerPeriod: string;
  /** Days in one fee period, e.g. 90 (a quarter). */
  feePeriodDays: number;
  /** The smallest fee charged, whatever the amount and tenor. */
  minimumFee: string;
  /** Longest validity the product allows, in days. */
  maxTenorDays: number;
}

/**
 * The issuance fee: the rate for every started period between issue and
 * expiry, never below the minimum. A part period counts as a whole one.
 */
export function letterOfCreditFee(t: LetterOfCreditFeeTerms, amount: string, issueDate: string, expiryDate: string, rounding: RoundingRule) {
  const a = dec(amount, 'amount');
  if (a.lte(0)) throw new EngineError('LC_INPUT', 'The letter of credit amount must be positive.');
  if (compareDates(expiryDate, issueDate) <= 0) throw new EngineError('LC_INPUT', 'The expiry date must be after the issue date.');
  if (!Number.isInteger(t.feePeriodDays) || t.feePeriodDays < 1) throw new EngineError('LC_INPUT', 'The fee period must be at least one day.');
  const days = daysBetween(issueDate, expiryDate);
  if (days > t.maxTenorDays) throw new EngineError('LC_TENOR', `A letter of credit under this product may run at most ${t.maxTenorDays} days; this one runs ${days}.`);
  const periods = Math.ceil(days / t.feePeriodDays);
  const byRate = roundMoney(a.times(dec(t.feeRatePerPeriod, 'feeRatePerPeriod')).times(periods), rounding);
  const min = dec(t.minimumFee, 'minimumFee');
  const fee = byRate.lt(min) ? min : byRate;
  return {
    days,
    periods,
    fee: fee.toString(),
    explanation: `${t.feeRatePerPeriod} × ${a} × ${periods} period(s) of ${t.feePeriodDays} days = ${byRate}${byRate.lt(min) ? `; minimum fee ${min} applies` : ''}.`,
  };
}

/**
 * Whether the bank may pay `amount` under the credit on `date`: the credit
 * must be live (issued, not past expiry) and the amount within what remains
 * undrawn.
 */
export function checkLetterOfCreditDrawing(lc: { amount: string; drawn: string; expiryDate: string }, drawing: { amount: string; date: string }) {
  const amount = dec(drawing.amount, 'amount');
  const available = dec(lc.amount, 'amount').minus(dec(lc.drawn, 'drawn'));
  const issues: { code: string; message: string }[] = [];
  if (amount.lte(0)) issues.push({ code: 'LC_AMOUNT', message: 'A drawing must be positive.' });
  if (amount.gt(available)) issues.push({ code: 'LC_EXCEEDED', message: `Only ${available} remains undrawn on this letter of credit.` });
  if (compareDates(drawing.date, lc.expiryDate) > 0) issues.push({ code: 'LC_EXPIRED', message: `The letter of credit expired on ${lc.expiryDate}.` });
  return { ok: issues.length === 0, available: available.toString(), remainingAfter: available.minus(amount.gt(0) ? amount : 0).toString(), issues };
}
