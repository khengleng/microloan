/**
 * The origination score as the platform computed it before scorecards were
 * configurable (removed from packages/shared in favour of the STANDARD_RETAIL
 * scorecard template). Kept verbatim, only here, as the oracle the template is
 * proven against: same inputs, same score, grade and factors.
 */
import { dec } from '../../src/lending/decimal.js';

export interface ScoreInput {
  /** Monthly instalment burden over income; null when income is unknown. */
  debtServiceRatio: string | null;
  ageYears: number | null;
  /** Loans with this lender closed in good standing. */
  closedLoans: number;
  /** Worst current days past due on the borrower's live loans. */
  worstCurrentDpd: number;
  /** Any loan of the borrower written off or sold. */
  writtenOff: boolean;
  /** Loan-to-value of the pledged security; null when unsecured. */
  loanToValue: string | null;
  guarantees: number;
  /** External bureau score on a 300–850 scale, or null when none. */
  bureauScore: number | null;
}

export interface ScoreFactor {
  factor: string;
  points: number;
  reason: string;
}

export interface ScoreResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  factors: ScoreFactor[];
}

export const SCORE_BASE = 450;
export const SCORE_MIN = 300;
export const SCORE_MAX = 850;

export function creditScore(x: ScoreInput): ScoreResult {
  const factors: ScoreFactor[] = [];
  const add = (factor: string, points: number, reason: string) => factors.push({ factor, points, reason });

  if (x.debtServiceRatio === null) add('AFFORDABILITY', 0, 'Income unknown; affordability not scored.');
  else {
    const r = dec(x.debtServiceRatio, 'debtServiceRatio');
    const pct = r.times(100).toDecimalPlaces(1).toString();
    if (r.lte('0.3')) add('AFFORDABILITY', 120, `Instalments take ${pct}% of income (≤ 30%).`);
    else if (r.lte('0.45')) add('AFFORDABILITY', 80, `Instalments take ${pct}% of income (≤ 45%).`);
    else if (r.lte('0.6')) add('AFFORDABILITY', 40, `Instalments take ${pct}% of income (≤ 60%).`);
    else add('AFFORDABILITY', -40, `Instalments take ${pct}% of income (over 60%).`);
  }

  if (x.ageYears === null) add('AGE', 20, 'Age unknown.');
  else if (x.ageYears >= 25 && x.ageYears <= 55) add('AGE', 60, `Age ${x.ageYears} (25–55).`);
  else add('AGE', 30, `Age ${x.ageYears}.`);

  if (x.writtenOff) add('HISTORY', -150, 'A previous loan was written off or sold.');
  else {
    const closed = Math.min(x.closedLoans, 3);
    if (closed) add('HISTORY', closed * 25, `${x.closedLoans} loan(s) repaid with us.`);
    if (x.worstCurrentDpd === 0) add('CONDUCT', 60, 'No live loan with us is past due.');
    else if (x.worstCurrentDpd <= 30) add('CONDUCT', 10, `A live loan is ${x.worstCurrentDpd} days past due.`);
    else add('CONDUCT', -80, `A live loan is ${x.worstCurrentDpd} days past due.`);
  }

  if (x.loanToValue !== null) {
    const ltv = dec(x.loanToValue, 'loanToValue');
    if (ltv.lte('0.6')) add('SECURITY', 50, `Loan-to-value ${ltv.times(100).toDecimalPlaces(1)}% (≤ 60%).`);
    else if (ltv.lte('0.8')) add('SECURITY', 25, `Loan-to-value ${ltv.times(100).toDecimalPlaces(1)}% (≤ 80%).`);
  }
  if (x.guarantees > 0) add('SECURITY', 20, `${x.guarantees} guarantor(s).`);

  if (x.bureauScore !== null && x.bureauScore > 0) {
    // Centre the bureau score on 575 and weigh it at 40%.
    const pts = Math.round((x.bureauScore - 575) * 0.4);
    add('BUREAU', pts, `Bureau score ${x.bureauScore}.`);
  } else add('BUREAU', 0, 'No bureau score.');

  const raw = SCORE_BASE + factors.reduce((s, f) => s + f.points, 0);
  const score = Math.max(SCORE_MIN, Math.min(SCORE_MAX, raw));
  const grade = score >= 700 ? 'A' : score >= 620 ? 'B' : score >= 550 ? 'C' : 'D';
  return { score, grade, factors };
}

