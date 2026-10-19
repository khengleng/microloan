/**
 * The pre-contract key facts statement (DECISIONS D-123): every figure the
 * customer is shown before they accept a loan, computed from the approved
 * terms exactly as the booking would compute them.
 *
 * Pure: no I/O, no clock. Rates are decimal fractions in and percentages with
 * two decimals out; money is in the loan's currency at its rounding.
 */
import { dec, ZERO } from './decimal.js';
import type { ProductConfig } from './config.js';
import type { UpfrontFeeResult } from './fees.js';
import type { ScheduleResult } from './schedule.js';

/** A decimal fraction as a percentage with two decimals, without the sign (0.18 → "18.00"). */
export function ratePct(rate: string | null | undefined): string | null {
  if (rate === null || rate === undefined || rate === '') return null;
  return dec(rate, 'rate').times(100).toDecimalPlaces(2).toFixed(2);
}

export interface KeyFactsInput {
  currency: string;
  /** The amount the customer asked to borrow. */
  principal: string;
  disbursementDate: string;
  /** Contract (nominal) annual rate, a fraction; null on a facility priced off a benchmark. */
  nominalAnnualRate: string | null;
  /** Effective annual rate on the cash received, upfront fees included (apr.ts); null when there is no schedule. */
  effectiveAnnualRate: string | null;
  fees: UpfrontFeeResult;
  /** Null for a facility (a limit drawn as needed, no fixed schedule). */
  schedule: Pick<ScheduleResult, 'lines' | 'totals' | 'instalmentAmount' | 'maturityDate' | 'hasProjectedAmounts'> | null;
  config: Pick<ProductConfig, 'pricing' | 'repayment' | 'facility' | 'attributes'>;
}

export interface KeyFactsFee {
  code: string;
  name: string;
  treatment: 'DEDUCTED' | 'FINANCED' | 'SEPARATE';
  amount: string;
  tax: string;
  total: string;
  waived: boolean;
  payee: 'LENDER' | 'INSURER';
}

export interface KeyFacts {
  currency: string;
  principal: string;
  /** Cash paid to the customer: principal less deducted fees. */
  netDisbursement: string;
  /** Principal the schedule repays: principal plus financed fees. */
  bookedPrincipal: string;
  disbursementDate: string;
  facility: {
    type: string;
    limit: string;
    commitmentFeePct: string | null;
    overlimitRatePct: string | null;
    minimumPaymentPct: string | null;
    minimumPaymentFloor: string | null;
  } | null;
  rates: {
    nominalAnnualRatePct: string | null;
    effectiveAnnualRatePct: string | null;
    interestMethod: 'REDUCING_BALANCE' | 'FLAT';
    rateType: 'FIXED' | 'FLOATING';
    floating: { benchmarkCode: string; marginPct: string; resetFrequency: string } | null;
  };
  fees: KeyFactsFee[];
  totals: {
    /** Every upfront fee and its tax, whichever way it is paid. */
    fees: string;
    interest: string | null;
    /** Instalments plus fees paid separately: everything the customer pays. */
    repayable: string | null;
    /** Repayable less the cash received: interest plus every fee. */
    costOfCredit: string | null;
  };
  schedule: {
    numberOfInstalments: number;
    frequency: string | null;
    firstDueDate: string;
    firstInstalment: string;
    regularInstalment: string;
    lastDueDate: string;
    lastInstalment: string;
    projected: boolean;
  } | null;
  latePayment: {
    type: 'NONE' | 'FLAT_PER_INSTALMENT' | 'PERCENT_PER_INSTALMENT' | 'RATE_ON_OVERDUE';
    flatAmount: string | null;
    percentOfOverduePct: string | null;
    annualRatePct: string | null;
    graceDays: number;
    capPerInstalment: string | null;
    capPerLoan: string | null;
    returnedPaymentFee: string | null;
  };
  prepayment: {
    partialAllowed: boolean;
    partialMinAmount: string | null;
    partialFeePct: string | null;
    settlementAllowed: boolean;
    settlementFeePct: string | null;
    settlementFeeFixed: string | null;
    rebateMethod: 'ACCRUED' | 'RULE_OF_78' | 'ACTUARIAL';
  };
  /** Early-repayment lock-in tiers (D-004), in months since disbursement. */
  lockIn: {
    appliesTo: ('PARTIAL_PREPAYMENT' | 'EARLY_SETTLEMENT')[];
    basis: 'AMOUNT_REPAID' | 'OUTSTANDING_PRINCIPAL';
    tiers: { untilMonth: number; action: 'CHARGE' | 'REFUSE'; ratePct: string | null; fixed: string | null }[];
  };
}

/** Build the statement's figures. Totals reconcile: repayable − netDisbursement = interest + fees. */
export function buildKeyFacts(input: KeyFactsInput): KeyFacts {
  const { fees, schedule, config } = input;
  const feeLines: KeyFactsFee[] = fees.lines.map((l) => ({
    code: l.code,
    name: l.name,
    treatment: l.treatment,
    amount: l.amount,
    tax: l.tax,
    total: dec(l.amount).plus(l.tax).toString(),
    waived: l.waived,
    payee: l.payee === 'INSURER' ? 'INSURER' : 'LENDER',
  }));
  const totalFees = feeLines.reduce((s, f) => s.plus(f.total), ZERO);
  let totals: KeyFacts['totals'] = { fees: totalFees.toString(), interest: null, repayable: null, costOfCredit: null };
  let summary: KeyFacts['schedule'] = null;
  if (schedule && schedule.lines.length) {
    const repayable = dec(schedule.totals.payments).plus(fees.separate);
    totals = {
      fees: totalFees.toString(),
      interest: dec(schedule.totals.interest).toString(),
      repayable: repayable.toString(),
      costOfCredit: repayable.minus(fees.netDisbursement).toString(),
    };
    const lines = schedule.lines;
    const first = lines[0];
    const last = lines[lines.length - 1];
    summary = {
      numberOfInstalments: lines.length,
      frequency: config.repayment.frequency,
      firstDueDate: first.dueDate,
      firstInstalment: dec(first.total).toString(),
      regularInstalment: schedule.instalmentAmount ? dec(schedule.instalmentAmount).toString() : mostCommon(lines.map((l) => dec(l.total).toString())),
      lastDueDate: last.dueDate,
      lastInstalment: dec(last.total).toString(),
      projected: schedule.hasProjectedAmounts,
    };
  }
  const p = config.pricing.penalty;
  const es = config.repayment.earlySettlement;
  const pp = config.repayment.prepayment;
  const erc = config.repayment.earlyRepaymentCharges;
  const fl = config.pricing.floating;
  return {
    currency: input.currency,
    principal: dec(input.principal).toString(),
    netDisbursement: dec(fees.netDisbursement).toString(),
    bookedPrincipal: dec(fees.bookedPrincipal).toString(),
    disbursementDate: input.disbursementDate,
    facility:
      config.facility.type === 'TERM'
        ? null
        : {
            type: config.facility.type,
            limit: dec(input.principal).toString(),
            commitmentFeePct: ratePct(config.facility.commitmentFeeRate),
            overlimitRatePct: ratePct(config.facility.overlimitRate),
            minimumPaymentPct: ratePct(config.facility.minimumPaymentRate),
            minimumPaymentFloor: config.facility.minimumPaymentFloor,
          },
    rates: {
      nominalAnnualRatePct: ratePct(input.nominalAnnualRate),
      effectiveAnnualRatePct: ratePct(input.effectiveAnnualRate),
      interestMethod: config.pricing.interestMethod,
      rateType: config.attributes.rateType,
      floating: fl ? { benchmarkCode: fl.benchmarkCode, marginPct: ratePct(fl.margin)!, resetFrequency: fl.resetFrequency } : null,
    },
    fees: feeLines,
    totals,
    schedule: summary,
    latePayment: {
      type: p.type,
      flatAmount: p.flatAmount,
      percentOfOverduePct: ratePct(p.percentOfOverdue),
      annualRatePct: ratePct(p.annualRate),
      graceDays: p.graceDays,
      capPerInstalment: p.capPerInstalment,
      capPerLoan: p.capPerLoan,
      returnedPaymentFee: config.pricing.returnedPaymentFee,
    },
    prepayment: {
      partialAllowed: pp.allowed,
      partialMinAmount: pp.minAmount,
      partialFeePct: ratePct(pp.feeRate),
      settlementAllowed: es.allowed,
      settlementFeePct: ratePct(es.feeRate),
      settlementFeeFixed: es.feeFixed,
      rebateMethod: es.rebateMethod,
    },
    lockIn: {
      appliesTo: [...erc.appliesTo],
      basis: erc.basis,
      tiers: erc.tiers.map((t) => ({ untilMonth: t.untilMonth, action: t.action, ratePct: ratePct(t.rate), fixed: t.fixed })),
    },
  };
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
