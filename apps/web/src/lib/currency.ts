// Web-side currency helpers. Re-exports the shared, single-source-of-truth
// currency rules so the UI formats USD/KHR exactly as the API and ledger do.
import {
    Currency,
    formatCurrency as sharedFormatCurrency,
    roundCurrency,
    SUPPORTED_CURRENCIES,
    normalizeCurrency,
} from '@microloan/shared';

export { Currency, roundCurrency, SUPPORTED_CURRENCIES, normalizeCurrency };

/**
 * Format an amount for display. Accepts a currency code string (e.g. from an
 * API response) or a Currency enum; falls back to USD for unknown values.
 */
export function money(amount: number | string, currency?: string | Currency): string {
    const value = typeof amount === 'string' ? Number(amount) : amount;
    const safe = Number.isFinite(value) ? value : 0;
    return sharedFormatCurrency(safe, normalizeCurrency(currency));
}

export const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }));
