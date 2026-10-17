/**
 * Collateral-based limits and margin calls (LT-04, LT-09, UC-51).
 * Pure: no I/O, no clock.
 */
import { D, Dec, dec, EngineError, ZERO } from './decimal.js';
import { roundMoney, RoundingRule } from './money.js';

/**
 * Limit available on a line secured behind other liens (HELOC, TV-17):
 * value × maximum combined LTV − balances ranking ahead of it, never below 0.
 */
export function securedLineLimit(collateralValue: string, maxCombinedLtv: string, priorLiens: string[], rounding: RoundingRule) {
  const value = dec(collateralValue, 'collateralValue');
  const ltv = dec(maxCombinedLtv, 'maxCombinedLtv');
  if (value.lt(0) || ltv.lte(0) || ltv.gt(1.5)) throw new EngineError('LIMIT_INPUT', 'Collateral value must be ≥ 0 and the LTV between 0 and 1.5.');
  const prior = priorLiens.reduce((s, l, i) => s.plus(dec(l, `priorLiens[${i}]`)), ZERO);
  const raw = value.times(ltv).minus(prior);
  const limit = roundMoney(D.max(0, raw), rounding);
  return {
    limit: limit.toString(),
    explanation: `${value} × ${ltv.times(100)}% combined LTV − ${prior} ahead = ${limit}.`,
  };
}

export interface MarginCall {
  /** Current loan-to-value as a fraction. */
  ltv: string;
  breached: boolean;
  /** Repayment that restores the maximum LTV. */
  requiredRepayment: string;
  /** Alternatively, extra collateral value that restores it. */
  requiredAdditionalCollateral: string;
  explanation: string;
}

/**
 * Margin call when collateral value falls (UC-51, TV-18): the loan is above
 * its maximum LTV when outstanding > value × max LTV. The cure is either a
 * repayment of outstanding − value × max LTV, or extra collateral of
 * outstanding / max LTV − value.
 */
export function marginCall(outstanding: string, collateralValue: string, maxLtv: string, rounding: RoundingRule): MarginCall {
  const owed = dec(outstanding, 'outstanding');
  const value = dec(collateralValue, 'collateralValue');
  const max = dec(maxLtv, 'maxLtv');
  if (max.lte(0)) throw new EngineError('MARGIN_INPUT', 'Maximum LTV must be positive.');
  const ltv: Dec = value.isZero() ? new D(owed.gt(0) ? 'Infinity' : 0) : owed.div(value);
  const breached = owed.gt(value.times(max));
  const repay = breached ? roundMoney(owed.minus(value.times(max)), rounding) : ZERO;
  const add = breached ? roundMoney(owed.div(max).minus(value), rounding) : ZERO;
  return {
    ltv: ltv.isFinite() ? ltv.toDecimalPlaces(6).toString() : 'Infinity',
    breached,
    requiredRepayment: repay.toString(),
    requiredAdditionalCollateral: add.toString(),
    explanation: breached
      ? `LTV ${ltv.isFinite() ? ltv.times(100).toDecimalPlaces(2) : '∞'}% exceeds ${max.times(100)}%: repay ${repay} or add collateral worth ${add}.`
      : `LTV ${ltv.times(100).toDecimalPlaces(2)}% is within ${max.times(100)}%.`,
  };
}
