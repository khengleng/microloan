/**
 * Scorecard monitoring statistics (DECISIONS D-080): discrimination (AUC,
 * Gini, Kolmogorov–Smirnov) on booked loans with a known outcome, and
 * population stability (PSI) between a baseline and a recent window.
 *
 * Convention: a higher score means lower risk, so a scorecard discriminates
 * when good loans score higher than bad ones. Results are decimal strings.
 * Pure: no I/O, no clock.
 */
import { D, dec, type Dec } from './decimal.js';

export interface ScoredOutcome {
  score: number;
  bad: boolean;
}

const fixed = (x: Dec, dp = 4) => x.toDecimalPlaces(dp).toFixed(dp);

/** Distinct scores ascending with good / bad counts at each. */
function tally(rows: ScoredOutcome[]) {
  const by = new Map<number, { good: number; bad: number }>();
  for (const r of rows) {
    const t = by.get(r.score) ?? { good: 0, bad: 0 };
    if (r.bad) t.bad++;
    else t.good++;
    by.set(r.score, t);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Area under the ROC curve: the probability that a randomly chosen good loan
 * scores higher than a randomly chosen bad one (ties count half), and
 * Gini = 2·AUC − 1. Null when there are no goods or no bads.
 */
export function aucGini(rows: ScoredOutcome[]): { auc: string; gini: string; goods: number; bads: number } | null {
  const goods = rows.filter((r) => !r.bad).length;
  const bads = rows.length - goods;
  if (!goods || !bads) return null;
  let goodsBelow = 0;
  let concordant = new D(0);
  for (const [, t] of tally(rows)) {
    // Each bad at this score is beaten by the goods above it; the goods here tie.
    concordant = concordant.plus(new D(t.bad).times(new D(goods - goodsBelow - t.good).plus(new D(t.good).div(2))));
    goodsBelow += t.good;
  }
  const auc = concordant.div(new D(goods).times(bads));
  return { auc: fixed(auc), gini: fixed(auc.times(2).minus(1)), goods, bads };
}

/**
 * Kolmogorov–Smirnov: the largest gap between the cumulative share of bads
 * and of goods at or below a score, and the score where it occurs.
 */
export function ksStatistic(rows: ScoredOutcome[]): { ks: string; atScore: number } | null {
  const goods = rows.filter((r) => !r.bad).length;
  const bads = rows.length - goods;
  if (!goods || !bads) return null;
  let cg = 0;
  let cb = 0;
  let best = new D(0);
  let at = rows[0].score;
  for (const [score, t] of tally(rows)) {
    cg += t.good;
    cb += t.bad;
    const gap = new D(cb).div(bads).minus(new D(cg).div(goods)).abs();
    if (gap.gt(best)) {
      best = gap;
      at = score;
    }
  }
  return { ks: fixed(best), atScore: at };
}

/**
 * Population stability index over the same bins (e.g. grades) of a baseline
 * and a recent population: Σ (aᵢ − eᵢ)·ln(aᵢ / eᵢ) on proportions, an empty
 * bin taking `epsilon` so the logarithm stays finite. Rule of thumb: < 0.1
 * stable, 0.1–0.25 watch, > 0.25 shifted.
 */
export function populationStability(
  baseline: Record<string, number>,
  recent: Record<string, number>,
  epsilon: string,
): { psi: string; bins: { bin: string; baseline: string; recent: string; contribution: string }[] } | null {
  const bins = [...new Set([...Object.keys(baseline), ...Object.keys(recent)])];
  const nb = bins.reduce((s, b) => s + (baseline[b] ?? 0), 0);
  const nr = bins.reduce((s, b) => s + (recent[b] ?? 0), 0);
  if (!nb || !nr) return null;
  const eps = dec(epsilon, 'epsilon');
  let psi = new D(0);
  const out = bins.map((bin) => {
    const e = D.max(new D(baseline[bin] ?? 0).div(nb), eps);
    const a = D.max(new D(recent[bin] ?? 0).div(nr), eps);
    const c = a.minus(e).times(a.div(e).ln());
    psi = psi.plus(c);
    return { bin, baseline: fixed(e), recent: fixed(a), contribution: fixed(c) };
  });
  return { psi: fixed(psi), bins: out };
}

/** Share as a fixed 4-dp decimal string; null on an empty base. */
export function share(part: number, whole: number): string | null {
  return whole ? fixed(new D(part).div(whole)) : null;
}
