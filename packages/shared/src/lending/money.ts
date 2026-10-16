import type Decimal from 'decimal.js';
import { D, Dec, dec, EngineError } from './decimal.js';

/**
 * Currency definitions.
 *
 * `minorUnits` is the ISO 4217 exponent: the number of decimal places a
 * stored amount may carry. Business rounding is separate: a lender may settle
 * Cambodian riel only in multiples of 100 even though ISO gives KHR two minor
 * units. Never assume two decimal places — JPY and VND have none, KWD, BHD,
 * OMR, JOD and TND have three.
 */
export interface CurrencyDefinition {
  code: string;
  name: string;
  minorUnits: number;
  /** Default business rounding increment, as a decimal string (e.g. '0.01', '100'). */
  defaultRoundingIncrement: string;
}

export const CURRENCY_DEFINITIONS: Record<string, CurrencyDefinition> = {
  USD: { code: 'USD', name: 'US Dollar', minorUnits: 2, defaultRoundingIncrement: '0.01' },
  EUR: { code: 'EUR', name: 'Euro', minorUnits: 2, defaultRoundingIncrement: '0.01' },
  GBP: { code: 'GBP', name: 'Pound Sterling', minorUnits: 2, defaultRoundingIncrement: '0.01' },
  KHR: { code: 'KHR', name: 'Cambodian Riel', minorUnits: 2, defaultRoundingIncrement: '100' },
  THB: { code: 'THB', name: 'Thai Baht', minorUnits: 2, defaultRoundingIncrement: '0.01' },
  SGD: { code: 'SGD', name: 'Singapore Dollar', minorUnits: 2, defaultRoundingIncrement: '0.01' },
  CNY: { code: 'CNY', name: 'Yuan Renminbi', minorUnits: 2, defaultRoundingIncrement: '0.01' },
  LAK: { code: 'LAK', name: 'Lao Kip', minorUnits: 2, defaultRoundingIncrement: '1' },
  VND: { code: 'VND', name: 'Vietnamese Dong', minorUnits: 0, defaultRoundingIncrement: '1' },
  JPY: { code: 'JPY', name: 'Yen', minorUnits: 0, defaultRoundingIncrement: '1' },
  KWD: { code: 'KWD', name: 'Kuwaiti Dinar', minorUnits: 3, defaultRoundingIncrement: '0.001' },
  BHD: { code: 'BHD', name: 'Bahraini Dinar', minorUnits: 3, defaultRoundingIncrement: '0.001' },
  OMR: { code: 'OMR', name: 'Rial Omani', minorUnits: 3, defaultRoundingIncrement: '0.001' },
  JOD: { code: 'JOD', name: 'Jordanian Dinar', minorUnits: 3, defaultRoundingIncrement: '0.001' },
};

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

export interface RoundingRule {
  /** Smallest amount a schedule line or posting may carry, e.g. '0.01', '100'. */
  increment: string;
  mode: RoundingMode;
}

export function getCurrency(code: string): CurrencyDefinition {
  const def = CURRENCY_DEFINITIONS[code];
  if (!def) {
    throw new EngineError('UNSUPPORTED_CURRENCY', `Currency ${code} is not configured on this platform.`);
  }
  return def;
}

/** Default rounding for a currency: its configured increment, half-up. */
export function defaultRounding(currency: string): RoundingRule {
  return { increment: getCurrency(currency).defaultRoundingIncrement, mode: 'HALF_UP' };
}

/**
 * A rounding increment is valid for a currency only if it is representable in
 * the currency's minor units (0.001 is not a valid USD increment) and positive.
 */
export function validateRoundingRule(currency: string, rule: RoundingRule): void {
  const def = getCurrency(currency);
  const inc = dec(rule.increment, 'rounding.increment');
  if (inc.lte(0)) {
    throw new EngineError('INVALID_ROUNDING', 'Rounding increment must be positive.');
  }
  if (inc.decimalPlaces() > def.minorUnits) {
    throw new EngineError(
      'INVALID_ROUNDING',
      `Rounding increment ${rule.increment} has more decimal places than ${currency} allows (${def.minorUnits}).`,
    );
  }
}

const MODE: Record<RoundingMode, Decimal.Rounding> = {
  HALF_UP: D.ROUND_HALF_UP,
  HALF_EVEN: D.ROUND_HALF_EVEN,
  DOWN: D.ROUND_DOWN,
  UP: D.ROUND_UP,
};

/** Round to the rule's increment: round(amount / increment) * increment. */
export function roundMoney(amount: Dec, rule: RoundingRule): Dec {
  const inc = new D(rule.increment);
  return amount.div(inc).toDecimalPlaces(0, MODE[rule.mode]).times(inc);
}

/** Render an amount with exactly the currency's minor units. */
export function formatAmount(amount: Dec, currency: string): string {
  return amount.toFixed(getCurrency(currency).minorUnits);
}

/** True when `amount` carries no more decimal places than the currency allows. */
export function isRepresentable(amount: Dec, currency: string): boolean {
  return amount.decimalPlaces() <= getCurrency(currency).minorUnits;
}

/** Parse an incoming money string and reject sub-minor-unit precision outright. */
export function parseMoney(value: string, currency: string, field = 'amount'): Dec {
  const amount = dec(value, field);
  if (!isRepresentable(amount, currency)) {
    throw new EngineError(
      'INVALID_AMOUNT_PRECISION',
      `${field} ${value} has more decimal places than ${currency} allows (${getCurrency(currency).minorUnits}).`,
    );
  }
  return amount;
}
