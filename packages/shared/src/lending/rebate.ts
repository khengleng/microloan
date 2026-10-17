/**
 * Interest rebates on early payoff of precomputed (flat-rate) loans (UC-33).
 * Pure: no I/O, no clock.
 */
import { D, Dec, dec, EngineError, ONE, ZERO } from './decimal.js';
import { roundMoney, RoundingRule } from './money.js';
import { periodicRateFromPayments } from './apr.js';

export type RebateMethod = 'RULE_OF_78' | 'ACTUARIAL' | 'STRAIGHT_LINE';

export interface RebateInput {
  method: RebateMethod;
  /** Total precomputed interest over the contract. */
  totalInterest: string;
  /** Amount financed (principal). Needed for ACTUARIAL. */
  principal: string;
  /** Scheduled instalments, in order. Needed for ACTUARIAL. */
  instalments: string[];
  /** Number of instalments in the contract. */
  numberOfInstalments: number;
  /** Instalments not yet due at payoff. */
  remainingInstalments: number;
  rounding: RoundingRule;
}

export interface Rebate {
  method: RebateMethod;
  rebate: string;
  explanation: string;
}

/**
 * The unearned interest returned on payoff.
 *
 * - RULE_OF_78 (sum of digits): interest is earned in proportion to the
 *   digits of the periods, so the rebate for k remaining of n periods is
 *   I × k(k+1) / (n(n+1)) (TV-12).
 * - ACTUARIAL: interest is earned as on a reducing-balance loan at the rate
 *   implied by the instalments; the rebate is the remaining instalments less
 *   their present value at that rate (the actuarial balance).
 * - STRAIGHT_LINE: I × k / n.
 */
export function precomputedInterestRebate(input: RebateInput): Rebate {
  const n = input.numberOfInstalments;
  const k = input.remainingInstalments;
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(k) || k < 0 || k > n)
    throw new EngineError('REBATE_INPUT', 'Remaining instalments must be between 0 and the number of instalments.');
  const interest = dec(input.totalInterest, 'totalInterest');
  const round = (v: Dec) => roundMoney(v, input.rounding);
  switch (input.method) {
    case 'RULE_OF_78': {
      const rebate = round(interest.times(k * (k + 1)).div(n * (n + 1)));
      return {
        method: input.method,
        rebate: rebate.toString(),
        explanation: `Rule of 78: ${interest} × (${k} × ${k + 1}) / (${n} × ${n + 1}) = ${rebate}.`,
      };
    }
    case 'STRAIGHT_LINE': {
      const rebate = round(interest.times(k).div(n));
      return { method: input.method, rebate: rebate.toString(), explanation: `Straight line: ${interest} × ${k} / ${n} = ${rebate}.` };
    }
    case 'ACTUARIAL': {
      if (input.instalments.length !== n)
        throw new EngineError('REBATE_INPUT', 'The actuarial method needs every scheduled instalment.');
      const { periodicRate } = periodicRateFromPayments(input.principal, input.instalments, 12);
      const r = new D(periodicRate);
      const remaining = input.instalments.slice(n - k).map((p) => dec(p));
      const due = remaining.reduce((s, p) => s.plus(p), ZERO);
      const balance = remaining.reduce((s, p, i) => s.plus(p.div(ONE.plus(r).pow(i + 1))), ZERO);
      const rebate = round(due.minus(balance));
      return {
        method: input.method,
        rebate: rebate.toString(),
        explanation: `Actuarial: remaining instalments ${round(due)} less their value at ${r.times(100).toDecimalPlaces(6)}% per period (${round(balance)}) = ${rebate}.`,
      };
    }
    default:
      throw new EngineError('REBATE_INPUT', `Unknown rebate method ${String(input.method)}.`);
  }
}
