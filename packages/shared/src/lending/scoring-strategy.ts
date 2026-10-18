/**
 * Decision strategy (DECISIONS D-076): which scorecards a product uses and
 * what a score means for an application — AUTO_APPROVE (a recommendation to
 * approve, never an approval), REFER or DECLINE — with knock-out rules, a
 * maximum amount and a pricing add-on by grade, and the rule that sends a
 * thin-file borrower to the thin-file scorecard.
 *
 * Part of the product configuration (`scoring`). Every default reproduces the
 * behaviour before strategies existed: the standard scorecard, no
 * challenger, no thin-file switch, every grade REFER, no knock-outs — so the
 * only gate remains `eligibility.minCreditScore`.
 *
 * Pure: no I/O, no clock.
 */
import { z } from 'zod';
import { dec } from './decimal.js';
import type { ScoringInputs } from './scorecards.js';

const code = z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{1,47}$/, 'codes are 2–48 chars: A-Z, 0-9, _ . -');
const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');
const rateFraction = decimalString.refine((x) => dec(x).lte(1), 'rates are decimal fractions (0.45 = 45%)');

export const STRATEGY_OUTCOMES = ['AUTO_APPROVE', 'REFER', 'DECLINE'] as const;
export type StrategyOutcome = (typeof STRATEGY_OUTCOMES)[number];

export const gradeRuleSchema = z
  .object({
    grade: z.string().regex(/^[A-Z0-9][A-Z0-9+-]{0,7}$/),
    outcome: z.enum(STRATEGY_OUTCOMES),
    /** Largest amount (in the product's currency) an application with this grade may be approved for; null: the product limit. */
    maxAmount: decimalString.nullable().default(null),
    /** Recommended rate add-on over the product's default rate, in basis points. */
    rateAddOnBps: z.number().int().min(0).max(5000).default(0),
  })
  .strict();

export const knockoutsSchema = z
  .object({
    /** Decline when any earlier loan was written off or sold. */
    writtenOff: z.boolean().default(false),
    /** Decline when a live loan is more than this many days past due. */
    maxCurrentDpd: z.number().int().min(0).max(3650).nullable().default(null),
    minAgeYears: z.number().int().min(0).max(120).nullable().default(null),
    maxAgeYears: z.number().int().min(0).max(150).nullable().default(null),
    /** Decline above this debt-service ratio. */
    maxDebtServiceRatio: rateFraction.nullable().default(null),
  })
  .strict();

export const strategySchema = z
  .object({
    /** Decline below this score (the stricter of this and eligibility.minCreditScore applies). */
    declineBelowScore: z.number().int().min(0).max(10_000).nullable().default(null),
    /** Outcome by grade; a grade not listed takes defaultOutcome. */
    gradeRules: z.array(gradeRuleSchema).max(12).default([]),
    defaultOutcome: z.enum(STRATEGY_OUTCOMES).default('REFER'),
    knockouts: knockoutsSchema.default({}),
    /** Approval requires the contract rate to include the grade's add-on. Off: the add-on is a recommendation. */
    enforceRateAddOn: z.boolean().default(false),
  })
  .strict();

export const thinFileRuleSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** The scorecard used instead of the champion for a thin-file borrower. */
    scorecardCode: code.default('THIN_FILE'),
    /** Thin file: fewer whole months of history with the lender than this… */
    maxInternalHistoryMonths: z.number().int().min(0).max(600).default(6),
    /** …and (when true) no bureau score. */
    requireNoBureauScore: z.boolean().default(true),
  })
  .strict();

export const productScoringSchema = z
  .object({
    /** The scorecard that drives the decision: the tenant's ACTIVE version of this code, else the template. */
    championCode: code.default('STANDARD_RETAIL'),
    /** Evaluated silently on every assessment and stored; never drives the decision. */
    challengerCode: code.nullable().default(null),
    thinFile: thinFileRuleSchema.default({}),
    strategy: strategySchema.default({}),
  })
  .strict();

export type ProductScoring = z.infer<typeof productScoringSchema>;
export type ScoringStrategy = z.infer<typeof strategySchema>;
export type ThinFileRule = z.infer<typeof thinFileRuleSchema>;

/** Cross-field checks for the product editor. */
export function validateProductScoring(s: ProductScoring): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (s.challengerCode && s.challengerCode === s.championCode) issues.push({ path: 'scoring.challengerCode', message: 'the challenger must differ from the champion' });
  const grades = s.strategy.gradeRules.map((g) => g.grade);
  if (new Set(grades).size !== grades.length) issues.push({ path: 'scoring.strategy.gradeRules', message: 'one rule per grade' });
  const k = s.strategy.knockouts;
  if (k.minAgeYears !== null && k.maxAgeYears !== null && k.minAgeYears > k.maxAgeYears) issues.push({ path: 'scoring.strategy.knockouts', message: 'minAgeYears exceeds maxAgeYears' });
  return issues;
}

/**
 * Thin file: no bureau score (when required) and fewer months of history with
 * the lender than the rule allows. A borrower whose history is unknown counts
 * as having none.
 */
export function isThinFile(rule: ThinFileRule, inputs: ScoringInputs): boolean {
  if (!rule.enabled) return false;
  const bureau = inputs.bureauScore;
  const hasBureau = bureau !== null && bureau !== undefined && bureau !== '' && dec(String(bureau)).gt(0);
  if (rule.requireNoBureauScore && hasBureau) return false;
  const months = inputs.internalHistoryMonths;
  const m = months === null || months === undefined || months === '' ? 0 : dec(String(months)).toNumber();
  return m < rule.maxInternalHistoryMonths;
}

export interface StrategyReason {
  code: string;
  message: string;
}

export interface StrategyResult {
  outcome: StrategyOutcome;
  /** Knock-outs that fired (each declines). */
  knockouts: StrategyReason[];
  /** Why the outcome is what it is, in order of precedence. */
  reasons: StrategyReason[];
  /** The decline threshold applied (stricter of strategy and eligibility); null: none. */
  declineBelowScore: number | null;
  /** The grade's maximum amount, when set. */
  maxAmount: string | null;
  /** Requested amount above the grade's maximum. */
  amountAboveGradeLimit: boolean;
  rateAddOnBps: number;
}

/**
 * Apply a strategy to a score. Precedence: knock-outs, then the decline
 * threshold, then the grade's rule (or the default). A requested amount above
 * the grade's maximum can never be AUTO_APPROVE: it is referred.
 */
export function evaluateStrategy(
  strategy: ScoringStrategy,
  input: { score: number; grade: string; inputs: ScoringInputs; requestedAmount: string; minCreditScore: number | null },
): StrategyResult {
  const k = strategy.knockouts;
  const x = input.inputs;
  const knockouts: StrategyReason[] = [];
  const num = (name: string) => {
    const raw = x[name];
    return raw === null || raw === undefined || raw === '' || typeof raw === 'boolean' ? null : dec(String(raw), name);
  };
  if (k.writtenOff && (x.writtenOff === true || x.writtenOff === 'true')) knockouts.push({ code: 'KO_WRITTEN_OFF', message: 'An earlier loan was written off or sold.' });
  const dpd = num('worstCurrentDpd');
  if (k.maxCurrentDpd !== null && dpd !== null && dpd.gt(k.maxCurrentDpd))
    knockouts.push({ code: 'KO_CURRENT_ARREARS', message: `A live loan is ${dpd.toString()} days past due (more than ${k.maxCurrentDpd}).` });
  const age = num('ageYears');
  if (k.minAgeYears !== null && (age === null || age.lt(k.minAgeYears)))
    knockouts.push({ code: 'KO_AGE', message: age === null ? 'Age is unknown.' : `Age ${age.toString()} is below ${k.minAgeYears}.` });
  if (k.maxAgeYears !== null && age !== null && age.gt(k.maxAgeYears)) knockouts.push({ code: 'KO_AGE', message: `Age ${age.toString()} is above ${k.maxAgeYears}.` });
  const dsr = num('debtServiceRatio');
  if (k.maxDebtServiceRatio !== null && dsr !== null && dsr.gt(k.maxDebtServiceRatio))
    knockouts.push({ code: 'KO_DEBT_SERVICE', message: `Debt-service ratio ${dsr.toDecimalPlaces(3).toString()} exceeds ${k.maxDebtServiceRatio}.` });

  const thresholds = [strategy.declineBelowScore, input.minCreditScore].filter((t): t is number => t !== null);
  const declineBelowScore = thresholds.length ? Math.max(...thresholds) : null;
  const rule = strategy.gradeRules.find((r) => r.grade === input.grade) ?? null;
  const maxAmount = rule?.maxAmount ?? null;
  const amountAboveGradeLimit = maxAmount !== null && dec(input.requestedAmount, 'requestedAmount').gt(maxAmount);
  const reasons: StrategyReason[] = [...knockouts];
  let outcome: StrategyOutcome;
  if (knockouts.length) outcome = 'DECLINE';
  else if (declineBelowScore !== null && input.score < declineBelowScore) {
    outcome = 'DECLINE';
    reasons.push({ code: 'SCORE_BELOW_CUTOFF', message: `Score ${input.score} is below the cut-off ${declineBelowScore}.` });
  } else {
    outcome = rule?.outcome ?? strategy.defaultOutcome;
    reasons.push({ code: rule ? 'GRADE_RULE' : 'DEFAULT_OUTCOME', message: rule ? `Grade ${input.grade}: ${rule.outcome}.` : `No rule for grade ${input.grade}: ${strategy.defaultOutcome}.` });
    if (amountAboveGradeLimit && outcome === 'AUTO_APPROVE') {
      outcome = 'REFER';
      reasons.push({ code: 'AMOUNT_ABOVE_GRADE_LIMIT', message: `Grade ${input.grade} allows at most ${maxAmount}; the request is referred.` });
    }
  }
  return { outcome, knockouts, reasons, declineBelowScore, maxAmount, amountAboveGradeLimit, rateAddOnBps: rule?.rateAddOnBps ?? 0 };
}

/**
 * What a customer is told about a scored decision: the outcome and the main
 * reasons in plain words — never points, weights or cut-offs.
 */
export function publicScoreExplanation(
  outcome: StrategyOutcome,
  adverse: { code: string; text: string }[],
  knockouts: StrategyReason[],
): { outcome: StrategyOutcome; reasons: { code: string; message: string }[] } {
  const customer: Record<string, string> = {
    KO_WRITTEN_OFF: 'A previous loan was not repaid.',
    KO_CURRENT_ARREARS: 'A current loan is in arrears.',
    KO_AGE: 'The applicant’s age is outside what this product allows.',
    KO_DEBT_SERVICE: 'The repayments would be too high for the income declared.',
  };
  const reasons = [
    ...knockouts.map((k) => ({ code: k.code, message: customer[k.code] ?? k.message })),
    ...(outcome === 'AUTO_APPROVE' ? [] : adverse.map((a) => ({ code: a.code, message: a.text }))),
  ];
  const seen = new Set<string>();
  return { outcome, reasons: reasons.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true))) };
}
