/**
 * Debt-service coverage (LT-16). Pure: no I/O, no clock.
 *
 * The origination credit score lives in scorecards.ts: configurable tenant
 * scorecards whose defaults are templates (scorecard-templates.ts).
 */
import { Dec, dec } from './decimal.js';

/**
 * Debt-service coverage ratio: annual net operating income over annual debt
 * service (this loan plus other debt). Null when there is no debt service.
 */
export function debtServiceCoverage(annualNetOperatingIncome: string, annualDebtService: string): Dec | null {
  const ds = dec(annualDebtService, 'annualDebtService');
  if (ds.lte(0)) return null;
  return dec(annualNetOperatingIncome, 'annualNetOperatingIncome').div(ds);
}
