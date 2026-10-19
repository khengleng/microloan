/**
 * Loan classification and impairment (OPS-5). Pure: no I/O, no clock.
 *
 * Two configurable modes:
 * - REGULATORY: a provisioning rate per classification class, the class set by
 *   days past due (e.g. the NBC tiers), applied to outstanding principal.
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

/** NBC short-term microfinance tiers (the legacy provisioning defaults). */
export const NBC_IMPAIRMENT_CLASSES: ImpairmentClass[] = [
  { code: 'STANDARD', label: 'Standard', minDpd: 0, rate: '0.01' },
  { code: 'SPECIAL_MENTION', label: 'Special mention', minDpd: 15, rate: '0.03' },
  { code: 'SUBSTANDARD', label: 'Substandard', minDpd: 31, rate: '0.25' },
  { code: 'DOUBTFUL', label: 'Doubtful', minDpd: 61, rate: '0.5' },
  { code: 'LOSS', label: 'Loss', minDpd: 91, rate: '1' },
];

export interface ImpairmentInput {
  daysPastDue: number;
  /** Outstanding principal (the regulatory base). */
  principal: string;
  /** Exposure at default for ECL: the recognised receivables. */
  exposure: string;
  restructured: boolean;
  onProbation: boolean;
  nonAccrual: boolean;
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

/** Classify a loan and work out the allowance it requires. */
export function assessImpairment(policy: ImpairmentPolicy, x: ImpairmentInput, rounding: RoundingRule): ImpairmentResult {
  const issues = validateImpairmentPolicy(policy);
  if (issues.length) throw new EngineError('INVALID_IMPAIRMENT_POLICY', issues.join(' '));
  const dpd = Math.max(0, Math.floor(x.daysPastDue));
  const cls = [...policy.classes].reverse().find((c) => dpd >= c.minDpd)!;

  if (policy.mode === 'REGULATORY') {
    const principal = dec(x.principal, 'principal');
    const allowance = roundMoney(principal.times(cls.rate), rounding);
    const i = policy.classes.indexOf(cls);
    const stage = cls.stage ?? (i === 0 ? 1 : i === policy.classes.length - 1 ? 3 : 2);
    return {
      classification: cls.code,
      stage,
      allowance: allowance.toString(),
      explanation: `${cls.label} (${dpd} days past due): ${dec(cls.rate).times(100)}% of principal ${principal} = ${allowance}.`,
    };
  }

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
    explanation: `Stage ${stage} (${dpd} days past due${x.nonAccrual ? ', non-accrual' : ''}${x.restructured && x.onProbation ? ', restructured on probation' : ''}): PD ${pd.times(100)}% × LGD ${lgd.times(100)}% × EAD ${ead} = ${allowance}.`,
  };
}
