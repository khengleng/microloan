import Decimal from 'decimal.js';

/**
 * A private Decimal constructor for the lending engine.
 *
 * Monetary and rate arithmetic never touches binary floating point. Precision
 * is far above anything a schedule needs (40 significant digits) so that the
 * only rounding that happens is the explicit, configured business rounding.
 *
 * The engine's public boundary takes and returns decimal *strings*, never
 * Decimal instances: the API, Prisma and this package may each load their
 * own copy of decimal.js, and `instanceof` across copies is unreliable.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });
export type Dec = InstanceType<typeof D>;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/** Parse a decimal string (or a safe integer) into a Dec, rejecting anything ambiguous. */
export function dec(value: string | number | Dec, field = 'value'): Dec {
  if (value instanceof D) return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new EngineError('INVALID_DECIMAL', `${field} must be passed as a decimal string, not a fractional number (${value}).`);
    }
    return new D(value);
  }
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value.trim())) {
    throw new EngineError('INVALID_DECIMAL', `${field} must be a decimal string, got ${JSON.stringify(value)}.`);
  }
  return new D(value.trim());
}

export const ZERO = new D(0);
export const ONE = new D(1);

/** Domain error carrying a stable machine code and an operator-readable message. */
export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export function sum(values: Dec[]): Dec {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}
