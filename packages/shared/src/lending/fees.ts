import { Dec, dec, EngineError, ZERO, sum } from './decimal.js';
import { RoundingRule, roundMoney, parseMoney } from './money.js';

export type FeeTreatment = 'DEDUCTED' | 'FINANCED' | 'SEPARATE';

export interface FeeDefinition {
  code: string;
  name: string;
  calculation: 'PERCENT_OF_PRINCIPAL' | 'FIXED';
  /** Fraction of principal for PERCENT_OF_PRINCIPAL (0.015 = 1.5%). */
  rate?: string;
  /** Amount for FIXED fees. */
  amount?: string;
  minAmount?: string;
  maxAmount?: string;
  treatment: FeeTreatment;
  /** Tax on the fee as a fraction (0.10 = 10% VAT). */
  taxRate?: string;
  waivable: boolean;
}

export interface FeeLine {
  code: string;
  name: string;
  treatment: FeeTreatment;
  amount: string;
  tax: string;
  waived: boolean;
}

export interface UpfrontFeeResult {
  lines: FeeLine[];
  /** Fee + tax added to the booked principal. */
  financed: string;
  /** Fee + tax withheld from the cash paid out. */
  deducted: string;
  /** Fee + tax receivable from the borrower at disbursement. */
  separate: string;
  /** Principal the schedule amortizes: requested principal + financed fees. */
  bookedPrincipal: string;
  /** Cash paid to the borrower: requested principal − deducted fees. */
  netDisbursement: string;
}

/**
 * Upfront fees and their tax, by treatment. Every amount is rounded with the
 * loan's business rounding; caps and floors apply before tax.
 */
export function computeUpfrontFees(
  requestedPrincipal: string,
  currency: string,
  rounding: RoundingRule,
  fees: FeeDefinition[],
  waivedCodes: string[] = [],
): UpfrontFeeResult {
  const principal = parseMoney(requestedPrincipal, currency, 'principal');
  const lines: FeeLine[] = [];
  const by: Record<FeeTreatment, Dec[]> = { DEDUCTED: [], FINANCED: [], SEPARATE: [] };
  for (const fee of fees) {
    const waived = waivedCodes.includes(fee.code);
    if (waived && !fee.waivable) {
      throw new EngineError('FEE_NOT_WAIVABLE', `Fee ${fee.code} cannot be waived.`);
    }
    let amount: Dec;
    if (fee.calculation === 'PERCENT_OF_PRINCIPAL') {
      amount = principal.times(dec(fee.rate ?? '0', `${fee.code}.rate`));
    } else {
      amount = dec(fee.amount ?? '0', `${fee.code}.amount`);
    }
    if (fee.minAmount && amount.lt(dec(fee.minAmount))) amount = dec(fee.minAmount);
    if (fee.maxAmount && amount.gt(dec(fee.maxAmount))) amount = dec(fee.maxAmount);
    amount = waived ? ZERO : roundMoney(amount, rounding);
    const tax = waived ? ZERO : roundMoney(amount.times(dec(fee.taxRate ?? '0', `${fee.code}.taxRate`)), rounding);
    by[fee.treatment].push(amount.plus(tax));
    lines.push({ code: fee.code, name: fee.name, treatment: fee.treatment, amount: amount.toString(), tax: tax.toString(), waived });
  }
  const financed = sum(by.FINANCED);
  const deducted = sum(by.DEDUCTED);
  if (deducted.gte(principal)) {
    throw new EngineError('FEES_EXCEED_PRINCIPAL', 'Deducted fees would consume the entire disbursement.');
  }
  return {
    lines,
    financed: financed.toString(),
    deducted: deducted.toString(),
    separate: sum(by.SEPARATE).toString(),
    bookedPrincipal: principal.plus(financed).toString(),
    netDisbursement: principal.minus(deducted).toString(),
  };
}
