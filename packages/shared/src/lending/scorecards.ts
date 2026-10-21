/**
 * Configurable, explainable scorecards (OPS-2; DECISIONS D-075).
 *
 * A scorecard is data: a base score, a set of characteristics — each a named
 * input variable cut into bins or categories (or a linear term) with points
 * and a reason — and grade bands. Tenants hold their own versioned,
 * maker-checker approved scorecards; the defaults ship as templates
 * (scorecard-templates.ts), never as constants in a business code path.
 *
 * Pure: no I/O, no clock. Points are integers; every comparison and every
 * linear term is decimal arithmetic.
 */
import { z } from 'zod';
import { Dec, dec, EngineError } from './decimal.js';

// ── Data sources and the variable catalogue ────────────────────────────────

/** Where a scoring input comes from. */
/** INTERNAL_BUREAU: a bureau input that came from the lender's in-house credit report (D-176). */
export const SCORING_SOURCES = ['APPLICATION', 'INTERNAL', 'BUREAU', 'INTERNAL_BUREAU', 'OFFICER_VERIFIED', 'PROVIDER'] as const;
export type ScoringSource = (typeof SCORING_SOURCES)[number];

/**
 * Alternative data sources a borrower consents to, one consent per source.
 * Internal behavioural data is the lender's own repayment, payment-channel
 * and group-contribution history used beyond the standard credit checks.
 */
export const ALT_DATA_SOURCES = [
  'INTERNAL_BEHAVIOUR',
  'UTILITY_BILLS',
  'TELCO_STATEMENT',
  'RENT_HISTORY',
  'BUSINESS_CASH_FLOW',
  'SMARTPHONE_DATA',
  'TELCO_DATA',
  'EWALLET_DATA',
  // Pulling the borrower's credit report (the lender's in-house bureau, or CBC once integrated) — D-178.
  'CREDIT_REPORT',
] as const;
export type AltDataSource = (typeof ALT_DATA_SOURCES)[number];

export type ScoringVariableType = 'NUMBER' | 'BOOLEAN' | 'CATEGORY';

export interface ScoringVariable {
  code: string;
  label: string;
  type: ScoringVariableType;
  source: ScoringSource;
  /** The consent the borrower must have given before this input is fetched or used; null when none is needed. */
  consent: AltDataSource | null;
  unit: 'RATIO' | 'YEARS' | 'MONTHS' | 'DAYS' | 'COUNT' | 'SCORE' | 'COVERAGE' | 'FLAG';
  description: string;
  /** Values outside this inclusive range are treated as missing (e.g. a bureau score of 0 means "no score"). */
  domain?: { min?: string; max?: string };
}

const v = (
  code: string,
  label: string,
  type: ScoringVariableType,
  source: ScoringSource,
  consent: AltDataSource | null,
  unit: ScoringVariable['unit'],
  description: string,
  domain?: ScoringVariable['domain'],
): ScoringVariable => ({ code, label, type, source, consent, unit, description, ...(domain ? { domain } : {}) });

/**
 * Every input a scorecard characteristic may use. Amounts never appear: each
 * input is a ratio, a count, a duration or a score, so a scorecard works the
 * same for USD and KHR loans (amounts in another currency are converted
 * before a ratio is formed, see the feature store).
 */
export const SCORING_VARIABLES: ScoringVariable[] = [
  v('debtServiceRatio', 'Debt-service ratio', 'NUMBER', 'APPLICATION', null, 'RATIO', 'Average monthly instalment over monthly income (both in one currency).', { min: '0' }),
  v('ageYears', 'Age (years)', 'NUMBER', 'APPLICATION', null, 'YEARS', 'Age on the disbursement date.', { min: '0', max: '150' }),
  v('loanToValue', 'Loan-to-value', 'NUMBER', 'APPLICATION', null, 'RATIO', 'Loan plus prior liens over the lendable value of pledged security.', { min: '0' }),
  v('guarantees', 'Guarantors', 'NUMBER', 'APPLICATION', null, 'COUNT', 'Guarantees recorded on the application.', { min: '0' }),
  v('closedLoans', 'Loans repaid with us', 'NUMBER', 'INTERNAL', null, 'COUNT', 'Loans with this lender closed in good standing.', { min: '0' }),
  v('worstCurrentDpd', 'Worst current days past due', 'NUMBER', 'INTERNAL', null, 'DAYS', 'Highest days past due on the borrower’s live loans.', { min: '0' }),
  v('writtenOff', 'Previous write-off', 'BOOLEAN', 'INTERNAL', null, 'FLAG', 'Any loan of the borrower written off or sold.'),
  v('internalHistoryMonths', 'Months of history with us', 'NUMBER', 'INTERNAL', null, 'MONTHS', 'Whole months since the borrower’s first disbursement with this lender.', { min: '0' }),
  v('onTimeRepaymentRatio', 'On-time repayment ratio', 'NUMBER', 'INTERNAL', 'INTERNAL_BEHAVIOUR', 'RATIO', 'Instalments fallen due that were paid in full by their due date.', { min: '0', max: '1' }),
  v('averageDaysLate', 'Average days late', 'NUMBER', 'INTERNAL', 'INTERNAL_BEHAVIOUR', 'DAYS', 'Average lateness of instalments fallen due (0 when on time).', { min: '0' }),
  v('maxDaysPastDueEver', 'Worst lateness ever', 'NUMBER', 'INTERNAL', 'INTERNAL_BEHAVIOUR', 'DAYS', 'Most days any instalment was paid (or is) late.', { min: '0' }),
  v('instalmentsObserved', 'Instalments observed', 'NUMBER', 'INTERNAL', 'INTERNAL_BEHAVIOUR', 'COUNT', 'Instalments fallen due on the borrower’s loans with us.', { min: '0' }),
  v('digitalRepaymentShare', 'Digital repayment share', 'NUMBER', 'INTERNAL', 'INTERNAL_BEHAVIOUR', 'RATIO', 'Share of repayments received through digital channels (KHQR / wallet / mobile) in imported channel files.', { min: '0', max: '1' }),
  v('groupContributionMonths', 'Months contributing to a group', 'NUMBER', 'INTERNAL', 'INTERNAL_BEHAVIOUR', 'MONTHS', 'Distinct months with a recorded contribution to a solidarity-group loan.', { min: '0' }),
  v('bureauScore', 'Bureau score', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'SCORE', 'Credit bureau score from the borrower’s credit report (the lender’s in-house bureau until CBC is integrated); none when the report cannot be scored.', { min: '1' }),
  // Characteristics of the borrower's credit report (D-177): the in-house bureau reads only this lender's records.
  v('bureauWorstDpd12m', 'Worst days past due, 12 months', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'DAYS', 'Most days any facility was past due in the last 12 months.', { min: '0' }),
  v('bureauWorstDpd24m', 'Worst days past due, 24 months', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'DAYS', 'Most days any facility was past due in the last 24 months.', { min: '0' }),
  v('bureauMonthsSinceDelinquency', 'Months since last 30+ days past due', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'MONTHS', 'Whole months since a facility was last 30 or more days past due; missing when never.', { min: '0' }),
  v('bureauTimes30Dpd12m', 'Times 30+ days past due, 12 months', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'COUNT', 'Facility month-ends in the last 12 months at 30 or more days past due.', { min: '0' }),
  v('bureauWriteOff', 'Write-off on the credit report', 'BOOLEAN', 'BUREAU', 'CREDIT_REPORT', 'FLAG', 'Any facility on the report (including the legacy archive) written off.'),
  v('bureauRestructured', 'Restructured in 24 months', 'BOOLEAN', 'BUREAU', 'CREDIT_REPORT', 'FLAG', 'Any facility restructured in the last 24 months.'),
  v('bureauRevolvingUtilisation', 'Utilisation of revolving limits', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'RATIO', 'Balance over limit of open credit lines, overdrafts and cards (the highest currency); missing without one.', { min: '0' }),
  v('bureauOldestFacilityMonths', 'Age of oldest facility (months)', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'MONTHS', 'Whole months since the oldest facility on the report opened.', { min: '0' }),
  v('bureauEnquiries6m', 'Credit applications, 6 months', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'COUNT', 'Other applications for credit in the last 6 months (the one being decided is not counted).', { min: '0' }),
  v('bureauEnquiries12m', 'Credit applications, 12 months', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'COUNT', 'Other applications for credit in the last 12 months (the one being decided is not counted).', { min: '0' }),
  v('bureauActiveFacilities', 'Active facilities', 'NUMBER', 'BUREAU', 'CREDIT_REPORT', 'COUNT', 'Open facilities on the report.', { min: '0' }),
  v('utilityOnTimeRatio', 'Utility bills paid on time', 'NUMBER', 'OFFICER_VERIFIED', 'UTILITY_BILLS', 'RATIO', 'Verified electricity / water bills: months paid on time over months observed.', { min: '0', max: '1' }),
  v('utilityMonthsObserved', 'Utility months observed', 'NUMBER', 'OFFICER_VERIFIED', 'UTILITY_BILLS', 'MONTHS', 'Months of verified utility bills.', { min: '0' }),
  v('mobileTopUpMonthsActive', 'Months with mobile top-ups', 'NUMBER', 'OFFICER_VERIFIED', 'TELCO_STATEMENT', 'MONTHS', 'Months with top-ups on a verified telco statement.', { min: '0' }),
  v('rentOnTimeRatio', 'Rent paid on time', 'NUMBER', 'OFFICER_VERIFIED', 'RENT_HISTORY', 'RATIO', 'Verified rent: months paid on time over months observed.', { min: '0', max: '1' }),
  v('businessCashFlowCoverage', 'Business cash-flow coverage', 'NUMBER', 'OFFICER_VERIFIED', 'BUSINESS_CASH_FLOW', 'COVERAGE', 'Observed net monthly business cash flow over the average monthly instalment (in the loan’s currency).', { min: '0' }),
  v('smartphoneScore', 'Smartphone-data score', 'NUMBER', 'PROVIDER', 'SMARTPHONE_DATA', 'SCORE', 'Score from a smartphone-data provider (requires integration).'),
  v('telcoScore', 'Telco-data score', 'NUMBER', 'PROVIDER', 'TELCO_DATA', 'SCORE', 'Score from a mobile operator (requires integration).'),
  v('ewalletMonthsActive', 'E-wallet months active', 'NUMBER', 'PROVIDER', 'EWALLET_DATA', 'MONTHS', 'Months with e-wallet activity reported by the provider (requires integration).', { min: '0' }),
];

export const SCORING_VARIABLE_BY_CODE: Record<string, ScoringVariable> = Object.fromEntries(SCORING_VARIABLES.map((x) => [x.code, x]));

// ── Definition schema ──────────────────────────────────────────────────────

const signedDecimal = z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string');
const points = z.number().int().min(-1000).max(1000);
const scoreInt = z.number().int().min(0).max(10_000);
const charCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'codes are 2–40 chars: A-Z, 0-9, _');
const reason = z.string().trim().max(200);
const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;
const PLACEHOLDERS = new Set(['value', 'percent']);

const outcomeShape = {
  points,
  /** Shown to staff; {value} and {percent} are filled from the input. */
  reason,
  /** Contributes nothing and is not listed as a factor (points must be 0). */
  omit: z.boolean().default(false),
};

const binSchema = z.object({ ...outcomeShape, upTo: signedDecimal.nullable() }).strict();
const categorySchema = z.object({ ...outcomeShape, values: z.array(z.string().trim().min(1).max(40)).min(1).max(20) }).strict();
const missingSchema = z.object(outcomeShape).strict();

export const characteristicSchema = z
  .object({
    code: charCode,
    label: z.string().trim().min(1).max(80),
    /** Factor group shown to staff (e.g. two SECURITY characteristics); defaults to the code. */
    group: charCode.optional(),
    variable: z.string().min(1).max(60),
    type: z.enum(['BINS', 'CATEGORIES', 'LINEAR']),
    /** BINS: value ≤ upTo falls in the first matching bin, ascending; the last bin has upTo null (no upper bound). */
    bins: z.array(binSchema).min(1).max(30).optional(),
    categories: z.array(categorySchema).min(1).max(20).optional(),
    /** LINEAR: round((value − centre) × weight), half up, within [minPoints, maxPoints]. */
    linear: z
      .object({
        centre: signedDecimal,
        weight: signedDecimal,
        minPoints: points.nullable().default(null),
        maxPoints: points.nullable().default(null),
        reason,
      })
      .strict()
      .optional(),
    /** How a missing input (null, absent, outside the variable's domain, or not consented) scores. */
    missing: missingSchema,
    /** The characteristic is not scored at all when this boolean input has this value. */
    skipWhen: z.object({ variable: z.string().min(1).max(60), equals: z.boolean() }).strict().optional(),
    /** Customer-facing reason given when this characteristic costs points (adverse action). */
    adverseReason: z
      .object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/), text: z.string().trim().min(1).max(200) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export const gradeBandSchema = z
  .object({
    grade: z.string().regex(/^[A-Z0-9][A-Z0-9+-]{0,7}$/, 'grades are 1–8 chars: A-Z, 0-9, + -'),
    label: z.string().trim().max(60).default(''),
    /** Lowest score in the band (inclusive). */
    minScore: scoreInt,
  })
  .strict();

export const scorecardDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    baseScore: z.number().int().min(-10_000).max(10_000),
    minScore: scoreInt,
    maxScore: scoreInt,
    characteristics: z.array(characteristicSchema).min(1).max(40),
    /** Highest band first; the last band must reach down to minScore. */
    grades: z.array(gradeBandSchema).min(1).max(12),
    /** How many adverse reasons an evaluation reports. */
    adverseReasonCount: z.number().int().min(0).max(10).default(4),
  })
  .strict();

export type ScorecardDefinition = z.infer<typeof scorecardDefinitionSchema>;
export type ScorecardDefinitionInput = z.input<typeof scorecardDefinitionSchema>;
export type ScorecardCharacteristic = z.infer<typeof characteristicSchema>;

export interface ScorecardIssue {
  path: string;
  message: string;
}

/** Schema plus the cross-field rules: contiguous ordered bins, known variables, ordered bands. */
export function validateScorecardDefinition(raw: unknown): { ok: true; definition: ScorecardDefinition } | { ok: false; issues: ScorecardIssue[] } {
  const parsed = scorecardDefinitionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  const d = parsed.data;
  const issues: ScorecardIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (d.minScore >= d.maxScore) add('minScore', 'minScore must be below maxScore');

  const codes = new Set<string>();
  d.characteristics.forEach((c, i) => {
    const p = `characteristics.${i}`;
    if (codes.has(c.code)) add(`${p}.code`, `duplicate characteristic code ${c.code}`);
    codes.add(c.code);
    const variable = SCORING_VARIABLE_BY_CODE[c.variable];
    if (!variable) {
      add(`${p}.variable`, `unknown input variable ${c.variable}`);
      return;
    }
    const outcomes: { points: number; reason: string; omit: boolean; path: string }[] = [{ ...c.missing, path: `${p}.missing` }];
    if (c.type === 'BINS') {
      if (variable.type !== 'NUMBER') add(`${p}.type`, `${c.variable} is not numeric; use CATEGORIES`);
      if (!c.bins) add(`${p}.bins`, 'BINS needs bins');
      if (c.categories || c.linear) add(p, 'BINS takes bins only');
      const bins = c.bins ?? [];
      bins.forEach((b, j) => {
        outcomes.push({ ...b, path: `${p}.bins.${j}` });
        const last = j === bins.length - 1;
        if (last && b.upTo !== null) add(`${p}.bins.${j}.upTo`, 'the last bin must be open-ended (upTo null) so every value falls in a bin');
        if (!last && b.upTo === null) add(`${p}.bins.${j}.upTo`, 'only the last bin may be open-ended');
        if (j > 0 && b.upTo !== null && bins[j - 1].upTo !== null && !dec(b.upTo).gt(dec(bins[j - 1].upTo!)))
          add(`${p}.bins.${j}.upTo`, 'bins must be in ascending order without overlap');
      });
    } else if (c.type === 'CATEGORIES') {
      if (variable.type === 'NUMBER') add(`${p}.type`, `${c.variable} is numeric; use BINS or LINEAR`);
      if (!c.categories) add(`${p}.categories`, 'CATEGORIES needs categories');
      if (c.bins || c.linear) add(p, 'CATEGORIES takes categories only');
      const seen = new Set<string>();
      (c.categories ?? []).forEach((cat, j) => {
        outcomes.push({ ...cat, path: `${p}.categories.${j}` });
        for (const val of cat.values) {
          if (seen.has(val)) add(`${p}.categories.${j}.values`, `value ${val} appears in more than one category`);
          seen.add(val);
          if (variable.type === 'BOOLEAN' && val !== 'true' && val !== 'false') add(`${p}.categories.${j}.values`, `${c.variable} is true or false`);
        }
      });
    } else {
      if (variable.type !== 'NUMBER') add(`${p}.type`, `${c.variable} is not numeric; LINEAR needs a number`);
      if (!c.linear) add(`${p}.linear`, 'LINEAR needs centre and weight');
      if (c.bins || c.categories) add(p, 'LINEAR takes linear only');
      if (c.linear) {
        outcomes.push({ points: 0, reason: c.linear.reason, omit: false, path: `${p}.linear` });
        if (c.linear.minPoints !== null && c.linear.maxPoints !== null && c.linear.minPoints > c.linear.maxPoints)
          add(`${p}.linear`, 'minPoints must not exceed maxPoints');
      }
    }
    for (const o of outcomes) {
      if (o.omit && o.points !== 0) add(`${o.path}.points`, 'an omitted outcome contributes no points');
      for (const m of o.reason.matchAll(PLACEHOLDER)) if (!PLACEHOLDERS.has(m[1])) add(`${o.path}.reason`, `unknown placeholder {${m[1]}} (use {value} or {percent})`);
    }
    if (c.skipWhen) {
      const sv = SCORING_VARIABLE_BY_CODE[c.skipWhen.variable];
      if (!sv || sv.type !== 'BOOLEAN') add(`${p}.skipWhen.variable`, 'skipWhen needs a true/false input variable');
    }
  });

  d.grades.forEach((g, i) => {
    if (i > 0 && g.minScore >= d.grades[i - 1].minScore) add(`grades.${i}.minScore`, 'grade bands must be listed highest first, without overlap');
  });
  if (new Set(d.grades.map((g) => g.grade)).size !== d.grades.length) add('grades', 'grade letters must be unique');
  const lowest = d.grades[d.grades.length - 1];
  if (lowest.minScore > d.minScore) add(`grades.${d.grades.length - 1}.minScore`, `the lowest band must start at or below minScore (${d.minScore}) so every score has a grade`);
  if (d.grades[0].minScore > d.maxScore) add('grades.0.minScore', 'the highest band starts above maxScore and can never be reached');
  return issues.length ? { ok: false, issues } : { ok: true, definition: d };
}

/** The variables a definition reads (characteristics and skip conditions). */
export function scorecardVariables(d: ScorecardDefinition): string[] {
  return [...new Set(d.characteristics.flatMap((c) => [c.variable, ...(c.skipWhen ? [c.skipWhen.variable] : [])]))];
}

// ── Evaluation ─────────────────────────────────────────────────────────────

export type ScoringValue = string | number | boolean | null;
export type ScoringInputs = Record<string, ScoringValue | undefined>;

export interface CharacteristicResult {
  code: string;
  group: string;
  label: string;
  variable: string;
  /** The input as used (null when missing). */
  value: ScoringValue;
  missing: boolean;
  /** Not scored because of skipWhen. */
  skipped: boolean;
  /** Not listed as a factor (an omitted outcome, or skipped). */
  omitted: boolean;
  points: number;
  /** Highest points this characteristic can give; null when unbounded. */
  maxPoints: number | null;
  reason: string;
  /** Which outcome applied: bin / category index, 'LINEAR' or 'MISSING'. */
  outcome: number | 'LINEAR' | 'MISSING' | 'SKIPPED';
}

export interface AdverseReason {
  code: string;
  text: string;
  characteristic: string;
  /** Points below the characteristic's best outcome. */
  shortfall: number;
}

export interface ScorecardResult {
  score: number;
  /** Before clamping to [minScore, maxScore]. */
  rawScore: number;
  grade: string;
  gradeLabel: string;
  characteristics: CharacteristicResult[];
  /** Staff view: listed factors in order (omitted ones left out). */
  factors: { factor: string; points: number; reason: string }[];
  adverseReasons: AdverseReason[];
}

function normalise(variable: ScoringVariable | undefined, raw: ScoringValue | undefined): ScoringValue {
  if (raw === undefined || raw === null || raw === '') return null;
  if (!variable) return raw;
  if (variable.type === 'BOOLEAN') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === 'false') return raw === 'true';
    throw new EngineError('INVALID_SCORING_INPUT', `${variable.code} must be true or false.`);
  }
  if (variable.type === 'CATEGORY') return String(raw);
  const n = dec(typeof raw === 'boolean' ? String(raw) : raw, variable.code);
  if (variable.domain?.min !== undefined && n.lt(variable.domain.min)) return null;
  if (variable.domain?.max !== undefined && n.gt(variable.domain.max)) return null;
  return typeof raw === 'number' ? raw : n.toString();
}

function fill(template: string, value: ScoringValue): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    if (value === null) return '—';
    if (name === 'percent') return dec(String(value), 'value').times(100).toDecimalPlaces(1).toString();
    return String(value);
  });
}

/** Math.round semantics (half towards +∞), in decimals. */
function roundHalfUp(x: Dec): number {
  return x.plus('0.5').floor().toNumber();
}

function bestPoints(c: ScorecardCharacteristic): number | null {
  const all: number[] = [c.missing.points];
  if (c.bins) all.push(...c.bins.map((b) => b.points));
  if (c.categories) all.push(...c.categories.map((b) => b.points));
  if (c.linear) {
    if (c.linear.maxPoints === null) return null;
    all.push(c.linear.maxPoints);
  }
  return Math.max(...all);
}

/**
 * Score one set of inputs. The definition must already be valid
 * (validateScorecardDefinition); inputs are decimal strings, safe integers,
 * booleans or category strings, keyed by variable code.
 */
export function evaluateScorecard(definition: ScorecardDefinition, inputs: ScoringInputs): ScorecardResult {
  const characteristics: CharacteristicResult[] = [];
  for (const c of definition.characteristics) {
    const variable = SCORING_VARIABLE_BY_CODE[c.variable];
    const base = { code: c.code, group: c.group ?? c.code, label: c.label, variable: c.variable, maxPoints: bestPoints(c) };
    if (c.skipWhen) {
      const sv = normalise(SCORING_VARIABLE_BY_CODE[c.skipWhen.variable], inputs[c.skipWhen.variable]);
      if (sv === c.skipWhen.equals) {
        characteristics.push({ ...base, value: null, missing: false, skipped: true, omitted: true, points: 0, reason: '', outcome: 'SKIPPED' });
        continue;
      }
    }
    const value = normalise(variable, inputs[c.variable]);
    if (value === null) {
      characteristics.push({ ...base, value, missing: true, skipped: false, omitted: c.missing.omit, points: c.missing.points, reason: fill(c.missing.reason, value), outcome: 'MISSING' });
      continue;
    }
    if (c.type === 'BINS') {
      const x = dec(String(value), c.variable);
      const i = c.bins!.findIndex((b) => b.upTo === null || x.lte(b.upTo));
      const b = c.bins![i];
      characteristics.push({ ...base, value, missing: false, skipped: false, omitted: b.omit, points: b.points, reason: fill(b.reason, value), outcome: i });
    } else if (c.type === 'CATEGORIES') {
      const key = String(value);
      const i = c.categories!.findIndex((cat) => cat.values.includes(key));
      if (i < 0) {
        characteristics.push({ ...base, value, missing: true, skipped: false, omitted: c.missing.omit, points: c.missing.points, reason: fill(c.missing.reason, value), outcome: 'MISSING' });
        continue;
      }
      const cat = c.categories![i];
      characteristics.push({ ...base, value, missing: false, skipped: false, omitted: cat.omit, points: cat.points, reason: fill(cat.reason, value), outcome: i });
    } else {
      const l = c.linear!;
      let pts = roundHalfUp(dec(String(value), c.variable).minus(l.centre).times(l.weight));
      if (l.minPoints !== null) pts = Math.max(l.minPoints, pts);
      if (l.maxPoints !== null) pts = Math.min(l.maxPoints, pts);
      characteristics.push({ ...base, value, missing: false, skipped: false, omitted: false, points: pts, reason: fill(l.reason, value), outcome: 'LINEAR' });
    }
  }
  const rawScore = definition.baseScore + characteristics.reduce((s, c) => s + c.points, 0);
  const score = Math.max(definition.minScore, Math.min(definition.maxScore, rawScore));
  const band = definition.grades.find((g) => score >= g.minScore) ?? definition.grades[definition.grades.length - 1];

  const adverse: AdverseReason[] = [];
  definition.characteristics.forEach((c, i) => {
    const r = characteristics[i];
    if (r.skipped || !c.adverseReason) return;
    const shortfall = r.maxPoints === null ? Math.max(0, -r.points) : r.maxPoints - r.points;
    if (shortfall > 0) adverse.push({ code: c.adverseReason.code, text: c.adverseReason.text, characteristic: c.code, shortfall });
  });
  // Largest shortfall first; definition order breaks ties. One entry per reason code.
  const ordered = adverse.map((a, i) => ({ a, i })).sort((x, y) => y.a.shortfall - x.a.shortfall || x.i - y.i);
  const seen = new Set<string>();
  const adverseReasons = ordered
    .map((x) => x.a)
    .filter((a) => (seen.has(a.code) ? false : (seen.add(a.code), true)))
    .slice(0, definition.adverseReasonCount);

  return {
    score,
    rawScore,
    grade: band.grade,
    gradeLabel: band.label,
    characteristics,
    factors: characteristics.filter((c) => !c.omitted).map((c) => ({ factor: c.group, points: c.points, reason: c.reason })),
    adverseReasons,
  };
}

