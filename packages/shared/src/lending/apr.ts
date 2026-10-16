import { D, Dec, dec, EngineError, ONE, ZERO } from './decimal.js';
import { LocalDate, daysBetween } from './dates.js';

export interface CashFlow {
  date: LocalDate;
  /** Positive = paid to the borrower, negative = paid by the borrower. */
  amount: string;
}

/**
 * Annual effective rate (XIRR, ACT/365) that discounts the borrower's cash
 * flows to zero: Σ CFₜ / (1 + x)^(dₜ/365) = 0. This is the disclosure EIR/APR,
 * including fees, so it differs from the contractual rate when fees exist.
 *
 * Solved by Newton's method with a bisection fallback, in decimal arithmetic.
 */
export function effectiveAnnualRate(flows: CashFlow[]): string {
  if (flows.length < 2) throw new EngineError('APR_INPUT', 'At least two cash flows are needed for an effective rate.');
  const t0 = flows[0].date;
  const points = flows.map((f) => ({ t: new D(daysBetween(t0, f.date)).div(365), cf: dec(f.amount) }));
  const npv = (x: Dec) => points.reduce((acc, p) => acc.plus(p.cf.div(ONE.plus(x).pow(p.t))), ZERO);
  const dnpv = (x: Dec) => points.reduce((acc, p) => acc.minus(p.t.times(p.cf).div(ONE.plus(x).pow(p.t.plus(1)))), ZERO);

  let x = new D('0.1');
  for (let i = 0; i < 50; i++) {
    const f = npv(x);
    if (f.abs().lt('1e-12')) return x.toDecimalPlaces(8).toString();
    const df = dnpv(x);
    if (df.isZero()) break;
    const next = x.minus(f.div(df));
    if (next.lte(-0.99) || next.gt(100) || !next.isFinite()) break;
    if (next.minus(x).abs().lt('1e-14')) return next.toDecimalPlaces(8).toString();
    x = next;
  }
  // Bisection fallback on [-0.99, 100].
  let lo = new D('-0.99');
  let hi = new D(100);
  let flo = npv(lo);
  for (let i = 0; i < 200; i++) {
    const mid = lo.plus(hi).div(2);
    const fm = npv(mid);
    if (fm.abs().lt('1e-12') || hi.minus(lo).lt('1e-12')) return mid.toDecimalPlaces(8).toString();
    if (fm.isNegative() === flo.isNegative()) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  throw new EngineError('APR_NO_SOLUTION', 'The effective rate did not converge for these cash flows.');
}
