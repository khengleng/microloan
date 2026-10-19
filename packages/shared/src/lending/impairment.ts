/**
 * Loan classification and impairment (OPS-5). Pure: no I/O, no clock.
 *
 * Two configurable modes:
 * - REGULATORY: a provisioning rate per classification class, the class set by
 *   days past due on the band set for the loan's original term (the NBC
 *   short- and long-term tiers), applied to outstanding principal.
 * - ECL: expected credit loss = PD × LGD × EAD, with IFRS 9 stages — stage 1
 *   (12-month PD), stage 2 (significant increase in credit risk: lifetime PD)
 *   and stage 3 (credit-impaired) — set by days past due and restructuring.
 */
import { dec, EngineError } from './decimal.js';
import { roundMoney, RoundingRule } from './money.js';

export interface ImpairmentClass {
  code: string;
  label: string;
  /** Inclusive lower bound of days past due for this class. */
  minDpd: number;
  /** Provision rate on outstanding principal, as a fraction. */
  rate: string;
  /** Reporting stage of this class in REGULATORY mode; by default the first class is 1, the last 3, others 2. */
  stage?: 1 | 2 | 3;
}

export interface ImpairmentPolicy {
  mode: 'REGULATORY' | 'ECL';
  /** Classification classes, used for reporting in both modes and for the rate in REGULATORY mode. */
  classes: ImpairmentClass[];
  ecl?: {
    /** Days past due from which credit risk has increased significantly. */
    stage2FromDpd: number;
    /** Days past due from which the loan is credit-impaired. */
    stage3FromDpd: number;
    /** A restructured loan is at least this stage while on probation. */
    restructuredMinStage: 1 | 2 | 3;
    /** Non-accrual loans are credit-impaired. */
    nonAccrualIsStage3: boolean;
    pd: { stage1: string; stage2: string; stage3: string };
    lgd: string;
  };
}

/**
 * NBC loan classes for SHORT-TERM loans (original maturity of one year or
 * less), Prakas B7-017-344 as the team recalls it — assumed, needs compliance
 * sign-off (DECISIONS D-114): 0–14 / 15–30 / 31–60 / 61–90 / 91+ days past
 * due at 1%, 3%, 20%, 50% and 100%.
 */
export const NBC_SHORT_TERM_CLASSES: ImpairmentClass[] = [
  { code: 'STANDARD', label: 'Standard', minDpd: 0, rate: '0.01' },
  { code: 'SPECIAL_MENTION', label: 'Special mention', minDpd: 15, rate: '0.03' },
  { code: 'SUBSTANDARD', label: 'Substandard', minDpd: 31, rate: '0.2' },
  { code: 'DOUBTFUL', label: 'Doubtful', minDpd: 61, rate: '0.5' },
  { code: 'LOSS', label: 'Loss', minDpd: 91, rate: '1' },
];

/**
 * NBC loan classes for LONG-TERM loans (original maturity over one year):
 * 0–29 / 30–89 / 90–179 / 180–359 / 360+ days past due at the same rates
 * (D-114, assumed — needs compliance sign-off).
 */
export const NBC_LONG_TERM_CLASSES: ImpairmentClass[] = [
  { code: 'STANDARD', label: 'Standard', minDpd: 0, rate: '0.01' },
  { code: 'SPECIAL_MENTION', label: 'Special mention', minDpd: 30, rate: '0.03' },
  { code: 'SUBSTANDARD', label: 'Substandard', minDpd: 90, rate: '0.2' },
  { code: 'DOUBTFUL', label: 'Doubtful', minDpd: 180, rate: '0.5' },
  { code: 'LOSS', label: 'Loss', minDpd: 360, rate: '1' },
];

/** The short-term set: also the classes a loan of unknown term is graded on. */
export const NBC_IMPAIRMENT_CLASSES: ImpairmentClass[] = NBC_SHORT_TERM_CLASSES;

/**
 * A loan whose original term is at most this many days is short-term. 366
 * rather than 365 so a twelve-month loan running over 29 February stays
 * short-term (D-114).
 */
export const NBC_SHORT_TERM_MAX_DAYS = 366;

/**
 * The regulator's classification as the lender has set it (lending settings
 * `regulatory`): one band set per term, and how restructured loans are held.
 */
export interface RegulatoryBands {
  shortTerm: ImpairmentClass[];
  longTerm: ImpairmentClass[];
  /** Original term (disbursement to original maturity) up to which a loan is short-term. */
  shortTermMaxDays: number;
  /** A restructured loan still on probation is graded at least this class; null: no minimum. */
  restructuredMinClass: string | null;
}

/** What the regulatory classification of one loan depends on. */
export interface RegulatoryFacts {
  /** Days past due today. */
  daysPastDue: number;
  /** Days from disbursement to the original maturity; null when unknown (graded short-term). */
  originalTermDays?: number | null;
  restructured?: boolean;
  /** Still short of the consecutive on-time instalments that cure a restructure. */
  onProbation?: boolean;
  /** Days past due when the loan was restructured, held while on probation. */
  floorDpd?: number | null;
}

export type TermBasis = 'SHORT' | 'LONG';

export function termBasis(shortTermMaxDays: number, originalTermDays: number | null | undefined): TermBasis {
  return originalTermDays != null && originalTermDays > shortTermMaxDays ? 'LONG' : 'SHORT';
}

/** The band set a loan is graded on: by its original term. */
export function bandsForTerm(b: RegulatoryBands, originalTermDays: number | null | undefined) {
  const term = termBasis(b.shortTermMaxDays, originalTermDays);
  return { term, classes: term === 'LONG' ? b.longTerm : b.shortTerm };
}

/**
 * The days past due a loan is classified and provisioned on: while a
 * restructured loan is on probation, never fewer than when it was
 * restructured (D-113) — a restructure alone does not cure arrears.
 */
export function classificationDpd(f: RegulatoryFacts): number {
  const dpd = Math.max(0, Math.floor(f.daysPastDue));
  if (f.onProbation && f.floorDpd != null) return Math.max(dpd, Math.floor(f.floorDpd));
  return dpd;
}

export interface RegulatoryGrade {
  cls: ImpairmentClass;
  index: number;
  term: TermBasis;
  /** The days past due graded on (probation floor applied). */
  dpd: number;
  /** True when the restructured-loan minimum class raised the grade. */
  heldAtMinimum: boolean;
}

/** The regulator's class for one loan: by term, probation floor and the restructured minimum. */
export function classifyRegulatory(b: RegulatoryBands, f: RegulatoryFacts): RegulatoryGrade {
  const { term, classes } = bandsForTerm(b, f.originalTermDays);
  if (!classes.length) throw new EngineError('INVALID_IMPAIRMENT_POLICY', 'At least one classification class is needed.');
  const dpd = classificationDpd(f);
  let index = 0;
  classes.forEach((c, i) => {
    if (dpd >= c.minDpd) index = i;
  });
  let heldAtMinimum = false;
  if (f.restructured && f.onProbation && b.restructuredMinClass) {
    const min = classes.findIndex((c) => c.code === b.restructuredMinClass);
    if (min > index) {
      index = min;
      heldAtMinimum = true;
    }
  }
  return { cls: classes[index], index, term, dpd, heldAtMinimum };
}

/** The reporting stage of a class: its own, else first 1, last 3, others 2. */
function stageOf(classes: ImpairmentClass[], i: number): 1 | 2 | 3 {
  return classes[i].stage ?? (i === 0 ? 1 : i === classes.length - 1 ? 3 : 2);
}

/** The provision the regulator requires on one loan: principal × its class rate. */
export function regulatoryProvision(b: RegulatoryBands, f: RegulatoryFacts, principal: string, rounding: RoundingRule) {
  const grade = classifyRegulatory(b, f);
  const p = dec(principal, 'principal');
  return { grade, amount: roundMoney(p.times(grade.cls.rate), rounding).toString() };
}

/**
 * The regulatory reserve an ECL (CIFRS 9) book carries in equity (D-115):
 * what the regulator requires above the expected-credit-loss allowance held,
 * never negative.
 */
export function regulatoryReserveTarget(regulatoryProvision: string, eclAllowance: string): string {
  const gap = dec(regulatoryProvision, 'regulatoryProvision').minus(dec(eclAllowance, 'eclAllowance'));
  return (gap.gt(0) ? gap : dec(0)).toString();
}

/**
 * The fewest days past due a loan may be written off at (D-117): the
 * lender's floor for its term or, when the lender set none, the day it
 * reaches the last (Loss) class of its band set. The product's own minimum
 * applies on top and can only raise it.
 */
export function writeOffFloorDpd(
  b: RegulatoryBands,
  originalTermDays: number | null | undefined,
  override: { shortTerm: number | null; longTerm: number | null },
): number {
  const { term, classes } = bandsForTerm(b, originalTermDays);
  const own = term === 'LONG' ? override.longTerm : override.shortTerm;
  return own ?? classes[classes.length - 1].minDpd;
}

export interface ImpairmentInput {
  daysPastDue: number;
  /** Outstanding principal (the regulatory base). */
  principal: string;
  /** Exposure at default for ECL: the recognised receivables. */
  exposure: string;
  restructured: boolean;
  onProbation: boolean;
  nonAccrual: boolean;
  /** Days from disbursement to the original maturity (chooses the band set); null: short-term. */
  originalTermDays?: number | null;
  /** Days past due held while a restructured loan is on probation (D-113). */
  floorDpd?: number | null;
}

export interface ImpairmentResult {
  classification: string;
  stage: 1 | 2 | 3;
  /** Required allowance. */
  allowance: string;
  explanation: string;
}

export function validateImpairmentPolicy(p: ImpairmentPolicy): string[] {
  const issues: string[] = [];
  if (!p.classes.length) issues.push('At least one classification class is needed.');
  if (p.classes.length && p.classes[0].minDpd !== 0) issues.push('The first class must start at 0 days past due.');
  p.classes.forEach((c, i) => {
    if (i > 0 && c.minDpd <= p.classes[i - 1].minDpd) issues.push(`Class ${c.code} must start after ${p.classes[i - 1].code}.`);
    const r = dec(c.rate, `classes[${i}].rate`);
    if (r.lt(0) || r.gt(1)) issues.push(`Class ${c.code}: rate must be between 0 and 1.`);
  });
  if (p.mode === 'ECL') {
    const e = p.ecl;
    if (!e) issues.push('ECL mode needs PD, LGD and staging rules.');
    else {
      if (e.stage3FromDpd <= e.stage2FromDpd) issues.push('Stage 3 must start after stage 2.');
      for (const [k, v] of Object.entries({ ...e.pd, lgd: e.lgd })) {
        const r = dec(v, k);
        if (r.lt(0) || r.gt(1)) issues.push(`${k} must be between 0 and 1.`);
      }
    }
  }
  return issues;
}

/**
 * Classify a loan and work out the allowance it requires.
 *
 * With `bands` (the lender's regulatory settings) REGULATORY mode grades on
 * them — the band set for the loan's term, the probation floor and the
 * restructured minimum class — so the allowance is the regulator's
 * provision (D-114). Without, it grades on the policy's own classes. Either
 * way a restructured loan on probation is graded on its floor days (D-113).
 */
export function assessImpairment(
  policy: ImpairmentPolicy,
  x: ImpairmentInput,
  rounding: RoundingRule,
  bands?: RegulatoryBands,
): ImpairmentResult {
  const issues = validateImpairmentPolicy(policy);
  if (issues.length) throw new EngineError('INVALID_IMPAIRMENT_POLICY', issues.join(' '));
  const facts: RegulatoryFacts = {
    daysPastDue: x.daysPastDue,
    originalTermDays: x.originalTermDays ?? null,
    restructured: x.restructured,
    onProbation: x.onProbation,
    floorDpd: x.floorDpd ?? null,
  };
  const dpd = classificationDpd(facts);
  const actual = Math.max(0, Math.floor(x.daysPastDue));
  const held = dpd > actual ? `, graded at ${dpd} by the restructure probation floor` : '';

  if (policy.mode === 'REGULATORY') {
    const principal = dec(x.principal, 'principal');
    if (bands) {
      const g = classifyRegulatory(bands, facts);
      const allowance = roundMoney(principal.times(g.cls.rate), rounding);
      const classes = g.term === 'LONG' ? bands.longTerm : bands.shortTerm;
      return {
        classification: g.cls.code,
        stage: stageOf(classes, g.index),
        allowance: allowance.toString(),
        explanation:
          `${g.cls.label} (${actual} days past due${held}; ${g.term === 'LONG' ? 'long' : 'short'}-term bands` +
          `${g.heldAtMinimum ? '; restructured, held at the minimum class until cured' : ''}): ` +
          `${dec(g.cls.rate).times(100)}% of principal ${principal} = ${allowance}.`,
      };
    }
    const cls = [...policy.classes].reverse().find((c) => dpd >= c.minDpd)!;
    const allowance = roundMoney(principal.times(cls.rate), rounding);
    return {
      classification: cls.code,
      stage: stageOf(policy.classes, policy.classes.indexOf(cls)),
      allowance: allowance.toString(),
      explanation: `${cls.label} (${actual} days past due${held}): ${dec(cls.rate).times(100)}% of principal ${principal} = ${allowance}.`,
    };
  }

  const cls = [...policy.classes].reverse().find((c) => dpd >= c.minDpd)!;
  const e = policy.ecl!;
  let stage: 1 | 2 | 3 = dpd >= e.stage3FromDpd ? 3 : dpd >= e.stage2FromDpd ? 2 : 1;
  if (e.nonAccrualIsStage3 && x.nonAccrual) stage = 3;
  if (x.restructured && x.onProbation && stage < e.restructuredMinStage) stage = e.restructuredMinStage;
  const pd = dec(stage === 1 ? e.pd.stage1 : stage === 2 ? e.pd.stage2 : e.pd.stage3, 'pd');
  const lgd = dec(e.lgd, 'lgd');
  const ead = dec(x.exposure, 'exposure');
  const allowance = roundMoney(pd.times(lgd).times(ead), rounding);
  return {
    classification: cls.code,
    stage,
    allowance: allowance.toString(),
    explanation: `Stage ${stage} (${actual} days past due${held}${x.nonAccrual ? ', non-accrual' : ''}${x.restructured && x.onProbation ? ', restructured on probation' : ''}): PD ${pd.times(100)}% × LGD ${lgd.times(100)}% × EAD ${ead} = ${allowance}.`,
  };
}
