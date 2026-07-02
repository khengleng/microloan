// Dual-currency support for Cambodia (USD + KHR).
//
// Cambodia is a dual-currency economy: micro-loans are booked in either
// US Dollars or Khmer Riel. Money must never be stored or rounded as a naive
// 2-decimal float for KHR — the Riel has no sub-unit in practice and cash is
// only settled in note denominations. This module centralises currency rules
// so every layer (loans, repayments, ledger, reports) rounds and formats the
// same way.

export enum Currency {
    USD = 'USD',
    KHR = 'KHR',
}

export const SUPPORTED_CURRENCIES: Currency[] = [Currency.USD, Currency.KHR];

// Smallest cash unit a lender realistically settles/records in.
//   USD → 0.01 (cents)
//   KHR → 100 riel (smallest note in common circulation; sub-100 is not tendered)
const CASH_ROUNDING_STEP: Record<Currency, number> = {
    [Currency.USD]: 0.01,
    [Currency.KHR]: 100,
};

// Decimal places used for display.
const DISPLAY_DECIMALS: Record<Currency, number> = {
    [Currency.USD]: 2,
    [Currency.KHR]: 0,
};

export function isSupportedCurrency(value: unknown): value is Currency {
    return typeof value === 'string' && SUPPORTED_CURRENCIES.includes(value as Currency);
}

export function normalizeCurrency(value: unknown, fallback: Currency = Currency.USD): Currency {
    if (typeof value === 'string') {
        const upper = value.toUpperCase();
        if (isSupportedCurrency(upper)) return upper as Currency;
    }
    return fallback;
}

/**
 * Round an amount to the currency's smallest settleable cash unit.
 * USD → nearest cent, KHR → nearest 100 riel.
 */
export function roundCurrency(amount: number, currency: Currency): number {
    const step = CASH_ROUNDING_STEP[currency] ?? 0.01;
    if (step >= 1) {
        return Math.round(amount / step) * step;
    }
    // Sub-unit rounding (USD): avoid binary float drift.
    const factor = Math.round(1 / step);
    return Math.round(amount * factor) / factor;
}

/**
 * Format an amount with the correct symbol and decimals for the currency.
 * KHR is suffixed (Cambodian convention: "20,000៛"); USD is prefixed ("$20.00").
 */
export function formatCurrency(amount: number, currency: Currency): string {
    const decimals = DISPLAY_DECIMALS[currency] ?? 2;
    const rounded = roundCurrency(amount, currency);
    const formatted = rounded.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
    return currency === Currency.KHR ? `${formatted}៛` : `$${formatted}`;
}

/**
 * Convert an amount between currencies given a rate expressed as
 * "how many units of `to` equal one unit of `from`". Result is cash-rounded.
 */
export function convertCurrency(
    amount: number,
    from: Currency,
    to: Currency,
    rateFromTo: number,
): number {
    if (from === to) return roundCurrency(amount, to);
    if (!(rateFromTo > 0)) {
        throw new Error(`Invalid exchange rate ${rateFromTo} for ${from}->${to}`);
    }
    return roundCurrency(amount * rateFromTo, to);
}

// ── NBC interest-rate cap ───────────────────────────────────────────────────
// The National Bank of Cambodia caps the interest rate that MFIs and licensed
// lenders may charge on new loans at 18% per annum (Prakas since 2017). We treat
// this as the platform default ceiling; a tenant may configure a *lower* cap but
// never a higher one.
export const NBC_ANNUAL_INTEREST_CAP_PCT = 18;

export function resolveInterestCap(tenantMaxAnnualPct?: number | null): number {
    if (tenantMaxAnnualPct == null || !(tenantMaxAnnualPct > 0)) {
        return NBC_ANNUAL_INTEREST_CAP_PCT;
    }
    // A tenant cannot lift the regulatory ceiling, only tighten it.
    return Math.min(tenantMaxAnnualPct, NBC_ANNUAL_INTEREST_CAP_PCT);
}

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
export function checkInterestRateCap(
    annualRatePct: number,
    tenantMaxAnnualPct?: number | null,
): RateCapCheck {
    const cap = resolveInterestCap(tenantMaxAnnualPct);
    if (!(annualRatePct >= 0)) {
        return { ok: false, cap, rate: annualRatePct, message: 'Interest rate must be zero or positive.' };
    }
    if (annualRatePct > cap + 1e-9) {
        return {
            ok: false,
            cap,
            rate: annualRatePct,
            message: `Annual interest rate ${annualRatePct}% exceeds the NBC regulatory cap of ${cap}%.`,
        };
    }
    return { ok: true, cap, rate: annualRatePct };
}
