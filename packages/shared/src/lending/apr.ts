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

export interface PeriodicRate {
  /** Rate per period that discounts the payments to the amount financed. */
  periodicRate: string;
  /** Nominal annual rate: periodic rate × periods per year (the disclosed "APR" in many markets). */
  nominalAnnualRate: string;
  /** Effective annual rate: (1 + periodic)^(periods per year) − 1. */
  effectiveAnnualRate: string;
}

/**
 * Rate implied by equal-interval payments, the way a disclosure table states
 * it (TV-04, TV-08): solve the periodic IRR on the payment periods, then
 * annualise it nominally (× periods per year) and effectively (compounded).
 *
 * `amountFinanced` is what the borrower receives net of fees deducted at
 * the start; `payments` are due one period apart, the first one period after
 * funding. `periodsPerYear` may be fractional (a 14-day term: 365 / 14).
 */
export function periodicRateFromPayments(amountFinanced: string, payments: string[], periodsPerYear: string | number): PeriodicRate {
  const pv = dec(amountFinanced, 'amountFinanced');
  const pmts = payments.map((p, i) => dec(p, `payments[${i}]`));
  const n = dec(periodsPerYear, 'periodsPerYear');
  if (pv.lte(0) || !pmts.length || n.lte(0)) throw new EngineError('APR_INPUT', 'An amount financed, at least one payment and a positive number of periods per year are needed.');
  const npv = (r: Dec) => pmts.reduce((acc, p, i) => acc.plus(p.div(ONE.plus(r).pow(i + 1))), ZERO).minus(pv);
  // NPV falls as r rises; bisection is exact enough and cannot diverge.
  let lo = new D('-0.99');
  let hi = new D(1000);
  if (npv(lo).lt(0) || npv(hi).gt(0)) throw new EngineError('APR_NO_SOLUTION', 'No rate discounts these payments to the amount financed.');
  for (let i = 0; i < 400 && hi.minus(lo).gt('1e-18'); i++) {
    const mid = lo.plus(hi).div(2);
    if (npv(mid).gt(0)) lo = mid;
    else hi = mid;
  }
  const r = lo.plus(hi).div(2);
  return {
    periodicRate: r.toDecimalPlaces(12).toString(),
    nominalAnnualRate: r.times(n).toDecimalPlaces(8).toString(),
    effectiveAnnualRate: ONE.plus(r).pow(n).minus(1).toDecimalPlaces(8).toString(),
  };
}
