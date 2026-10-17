/**
 * Financial covenant ratios (LT-16). Pure: no I/O, no clock.
 *
 * Each ratio is returned unrounded; a covenant compares it with its
 * threshold in the direction its type says.
 */
import { Dec, dec } from './decimal.js';
import type { CovenantType } from './config.js';

/**
 * Net leverage = (total debt − cash) ÷ EBITDA. Null when EBITDA is zero or
 * negative: leverage is then unbounded and a maximum-leverage covenant fails.
 */
export function netLeverage(totalDebt: string, cash: string, ebitda: string): Dec | null {
  const e = dec(ebitda, 'ebitda');
  if (e.lte(0)) return null;
  return dec(totalDebt, 'totalDebt').minus(dec(cash, 'cash')).div(e);
}

/** Interest cover = EBITDA ÷ interest expense. Null when there is no interest to cover. */
export function interestCover(ebitda: string, interestExpense: string): Dec | null {
  const i = dec(interestExpense, 'interestExpense');
  if (i.lte(0)) return null;
  return dec(ebitda, 'ebitda').div(i);
}

/** Whether a covenant ratio meets its threshold: maximums are ≤, minimums ≥. */
export function covenantPasses(type: CovenantType, value: Dec | null, threshold: string): boolean {
  const t = dec(threshold, 'threshold');
  if (type === 'MAX_LTV' || type === 'MAX_LEVERAGE') return value !== null && value.lte(t);
  return value !== null && value.gte(t);
}
