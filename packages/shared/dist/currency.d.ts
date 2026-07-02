export declare enum Currency {
    USD = "USD",
    KHR = "KHR"
}
export declare const SUPPORTED_CURRENCIES: Currency[];
export declare function isSupportedCurrency(value: unknown): value is Currency;
export declare function normalizeCurrency(value: unknown, fallback?: Currency): Currency;
/**
 * Round an amount to the currency's smallest settleable cash unit.
 * USD → nearest cent, KHR → nearest 100 riel.
 */
export declare function roundCurrency(amount: number, currency: Currency): number;
/**
 * Format an amount with the correct symbol and decimals for the currency.
 * KHR is suffixed (Cambodian convention: "20,000៛"); USD is prefixed ("$20.00").
 */
export declare function formatCurrency(amount: number, currency: Currency): string;
/**
 * Convert an amount between currencies given a rate expressed as
 * "how many units of `to` equal one unit of `from`". Result is cash-rounded.
 */
export declare function convertCurrency(amount: number, from: Currency, to: Currency, rateFromTo: number): number;
export declare const NBC_ANNUAL_INTEREST_CAP_PCT = 18;
export declare function resolveInterestCap(tenantMaxAnnualPct?: number | null): number;
export interface RateCapCheck {
    ok: boolean;
    cap: number;
    rate: number;
    message?: string;
}
/**
 * Validate an annual interest rate (in %) against the effective cap.
 * Returns a structured result so callers can throw a domain-appropriate error.
 */
export declare function checkInterestRateCap(annualRatePct: number, tenantMaxAnnualPct?: number | null): RateCapCheck;
