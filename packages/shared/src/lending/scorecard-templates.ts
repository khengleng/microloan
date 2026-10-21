/**
 * Scorecard templates: the defaults a tenant starts from (DECISIONS D-075).
 *
 * Like product and workflow templates they are tenant-editable: a tenant
 * installs a template as its own scorecard, changes it and puts it through
 * maker-checker. Until a tenant has an ACTIVE version of a code, the template
 * of that code is what scores — so STANDARD_RETAIL reproduces exactly the
 * score the platform computed before scorecards were configurable (base 450,
 * 300–850, grades A ≥ 700, B ≥ 620, C ≥ 550, D).
 */
import { validateScorecardDefinition, type ScorecardDefinition, type ScorecardDefinitionInput } from './scorecards.js';

export interface ScorecardTemplate {
  code: string;
  name: string;
  description: string;
  definition: ScorecardDefinition;
}

const GRADES = [
  { grade: 'A', label: 'Low risk', minScore: 700 },
  { grade: 'B', label: 'Moderate risk', minScore: 620 },
  { grade: 'C', label: 'Elevated risk', minScore: 550 },
  { grade: 'D', label: 'High risk', minScore: 300 },
];

const omit = { points: 0, reason: '', omit: true };

const STANDARD_RETAIL: ScorecardDefinitionInput = {
  schemaVersion: 1,
  baseScore: 450,
  minScore: 300,
  maxScore: 850,
  adverseReasonCount: 4,
  grades: GRADES,
  characteristics: [
    {
      code: 'AFFORDABILITY',
      label: 'Affordability (debt-service ratio)',
      variable: 'debtServiceRatio',
      type: 'BINS',
      bins: [
        { upTo: '0.3', points: 120, reason: 'Instalments take {percent}% of income (≤ 30%).' },
        { upTo: '0.45', points: 80, reason: 'Instalments take {percent}% of income (≤ 45%).' },
        { upTo: '0.6', points: 40, reason: 'Instalments take {percent}% of income (≤ 60%).' },
        { upTo: null, points: -40, reason: 'Instalments take {percent}% of income (over 60%).' },
      ],
      missing: { points: 0, reason: 'Income unknown; affordability not scored.' },
      adverseReason: { code: 'DEBT_BURDEN', text: 'The repayments are high compared with the income declared.' },
    },
    {
      code: 'AGE',
      label: 'Age',
      variable: 'ageYears',
      type: 'BINS',
      bins: [
        { upTo: '24', points: 30, reason: 'Age {value}.' },
        { upTo: '55', points: 60, reason: 'Age {value} (25–55).' },
        { upTo: null, points: 30, reason: 'Age {value}.' },
      ],
      missing: { points: 20, reason: 'Age unknown.' },
      adverseReason: null,
    },
    {
      code: 'WRITTEN_OFF',
      label: 'Previous write-off',
      group: 'HISTORY',
      variable: 'writtenOff',
      type: 'CATEGORIES',
      categories: [
        { values: ['true'], points: -150, reason: 'A previous loan was written off or sold.' },
        { values: ['false'], ...omit },
      ],
      missing: omit,
      adverseReason: { code: 'PREVIOUS_DEFAULT', text: 'A previous loan with us was not repaid.' },
    },
    {
      code: 'CLOSED_LOANS',
      label: 'Loans repaid with us',
      group: 'HISTORY',
      variable: 'closedLoans',
      type: 'BINS',
      bins: [
        { upTo: '0', ...omit },
        { upTo: '1', points: 25, reason: '{value} loan(s) repaid with us.' },
        { upTo: '2', points: 50, reason: '{value} loan(s) repaid with us.' },
        { upTo: null, points: 75, reason: '{value} loan(s) repaid with us.' },
      ],
      missing: omit,
      skipWhen: { variable: 'writtenOff', equals: true },
      adverseReason: { code: 'LIMITED_HISTORY', text: 'There is little repayment history with us yet.' },
    },
    {
      code: 'CONDUCT',
      label: 'Conduct of live loans',
      variable: 'worstCurrentDpd',
      type: 'BINS',
      bins: [
        { upTo: '0', points: 60, reason: 'No live loan with us is past due.' },
        { upTo: '30', points: 10, reason: 'A live loan is {value} days past due.' },
        { upTo: null, points: -80, reason: 'A live loan is {value} days past due.' },
      ],
      missing: { points: 60, reason: 'No live loan with us is past due.' },
      skipWhen: { variable: 'writtenOff', equals: true },
      adverseReason: { code: 'CURRENT_ARREARS', text: 'A current loan with us is behind on its repayments.' },
    },
    {
      code: 'SECURITY_LTV',
      label: 'Loan-to-value of security',
      group: 'SECURITY',
      variable: 'loanToValue',
      type: 'BINS',
      bins: [
        { upTo: '0.6', points: 50, reason: 'Loan-to-value {percent}% (≤ 60%).' },
        { upTo: '0.8', points: 25, reason: 'Loan-to-value {percent}% (≤ 80%).' },
        { upTo: null, ...omit },
      ],
      missing: omit,
      adverseReason: null,
    },
    {
      code: 'SECURITY_GUARANTEES',
      label: 'Guarantors',
      group: 'SECURITY',
      variable: 'guarantees',
      type: 'BINS',
      bins: [
        { upTo: '0', ...omit },
        { upTo: null, points: 20, reason: '{value} guarantor(s).' },
      ],
      missing: omit,
      adverseReason: null,
    },
    {
      code: 'BUREAU',
      label: 'Bureau score',
      variable: 'bureauScore',
      type: 'LINEAR',
      // Centred on 575 and weighted at 40%.
      linear: { centre: '575', weight: '0.4', reason: 'Bureau score {value}.' },
      missing: { points: 0, reason: 'No bureau score.' },
      adverseReason: { code: 'BUREAU_SCORE', text: 'The credit bureau record lowers the assessment.' },
    },
  ],
};

/**
 * For borrowers with little or no credit history (DECISIONS D-079): the same
 * scale and grades, with affordability kept and history replaced by verified
 * alternative data — utility and rent payment discipline, mobile activity,
 * observed business cash flow, any early repayment behaviour with us, and
 * digital payment habits. Each alternative characteristic scores 0 when its
 * data is missing or not consented, so the template never rewards an absence.
 */
const THIN_FILE: ScorecardDefinitionInput = {
  schemaVersion: 1,
  baseScore: 480,
  minScore: 300,
  maxScore: 850,
  adverseReasonCount: 4,
  grades: GRADES,
  characteristics: [
    {
      code: 'AFFORDABILITY',
      label: 'Affordability (debt-service ratio)',
      variable: 'debtServiceRatio',
      type: 'BINS',
      bins: [
        { upTo: '0.3', points: 100, reason: 'Instalments take {percent}% of income (≤ 30%).' },
        { upTo: '0.45', points: 60, reason: 'Instalments take {percent}% of income (≤ 45%).' },
        { upTo: '0.6', points: 20, reason: 'Instalments take {percent}% of income (≤ 60%).' },
        { upTo: null, points: -60, reason: 'Instalments take {percent}% of income (over 60%).' },
      ],
      missing: { points: -20, reason: 'Income unknown.' },
      adverseReason: { code: 'DEBT_BURDEN', text: 'The repayments are high compared with the income declared.' },
    },
    {
      code: 'AGE',
      label: 'Age',
      variable: 'ageYears',
      type: 'BINS',
      bins: [
        { upTo: '20', points: 10, reason: 'Age {value}.' },
        { upTo: '55', points: 40, reason: 'Age {value} (21–55).' },
        { upTo: null, points: 20, reason: 'Age {value}.' },
      ],
      missing: { points: 0, reason: 'Age unknown.' },
      adverseReason: null,
    },
    {
      code: 'UTILITY_DISCIPLINE',
      label: 'Utility bills paid on time (EDC, water)',
      variable: 'utilityOnTimeRatio',
      type: 'BINS',
      bins: [
        { upTo: '0.5', points: -30, reason: '{percent}% of verified utility bills paid on time.' },
        { upTo: '0.8', points: 20, reason: '{percent}% of verified utility bills paid on time.' },
        { upTo: '0.95', points: 50, reason: '{percent}% of verified utility bills paid on time.' },
        { upTo: null, points: 70, reason: '{percent}% of verified utility bills paid on time.' },
      ],
      missing: { points: 0, reason: 'No verified utility bills.' },
      adverseReason: { code: 'UTILITY_PAYMENTS', text: 'Utility bills were not always paid on time, or none were verified.' },
    },
    {
      code: 'UTILITY_DEPTH',
      label: 'Months of utility bills verified',
      variable: 'utilityMonthsObserved',
      type: 'BINS',
      bins: [
        { upTo: '5', points: 0, reason: '{value} month(s) of utility bills verified.' },
        { upTo: '11', points: 15, reason: '{value} months of utility bills verified.' },
        { upTo: null, points: 30, reason: '{value} months of utility bills verified.' },
      ],
      missing: { points: 0, reason: 'No verified utility bills.' },
      adverseReason: null,
    },
    {
      code: 'RENT_DISCIPLINE',
      label: 'Rent paid on time',
      variable: 'rentOnTimeRatio',
      type: 'BINS',
      bins: [
        { upTo: '0.5', points: -30, reason: '{percent}% of verified rent paid on time.' },
        { upTo: '0.9', points: 20, reason: '{percent}% of verified rent paid on time.' },
        { upTo: null, points: 50, reason: '{percent}% of verified rent paid on time.' },
      ],
      missing: { points: 0, reason: 'No verified rent history.' },
      adverseReason: { code: 'RENT_PAYMENTS', text: 'Rent was not always paid on time, or none was verified.' },
    },
    {
      code: 'MOBILE_ACTIVITY',
      label: 'Months with mobile top-ups',
      variable: 'mobileTopUpMonthsActive',
      type: 'BINS',
      bins: [
        { upTo: '3', points: 0, reason: 'Top-ups in {value} month(s).' },
        { upTo: '8', points: 15, reason: 'Top-ups in {value} months.' },
        { upTo: null, points: 30, reason: 'Top-ups in {value} months.' },
      ],
      missing: { points: 0, reason: 'No verified telco statement.' },
      adverseReason: null,
    },
    {
      code: 'CASH_FLOW',
      label: 'Business cash flow over the instalment',
      variable: 'businessCashFlowCoverage',
      type: 'BINS',
      bins: [
        { upTo: '1', points: -40, reason: 'Observed cash flow covers the instalment {value} times.' },
        { upTo: '1.5', points: 10, reason: 'Observed cash flow covers the instalment {value} times.' },
        { upTo: '2.5', points: 40, reason: 'Observed cash flow covers the instalment {value} times.' },
        { upTo: null, points: 60, reason: 'Observed cash flow covers the instalment {value} times.' },
      ],
      missing: { points: 0, reason: 'No observed business cash flow.' },
      adverseReason: { code: 'CASH_FLOW', text: 'The business cash flow we observed is low compared with the repayments.' },
    },
    {
      code: 'EARLY_REPAYMENT',
      label: 'Repayments with us so far',
      variable: 'onTimeRepaymentRatio',
      type: 'BINS',
      bins: [
        { upTo: '0.7', points: -50, reason: '{percent}% of instalments with us paid on time.' },
        { upTo: '0.95', points: 10, reason: '{percent}% of instalments with us paid on time.' },
        { upTo: null, points: 40, reason: '{percent}% of instalments with us paid on time.' },
      ],
      missing: { points: 0, reason: 'No repayment history with us.' },
      adverseReason: { code: 'LATE_REPAYMENTS', text: 'Some repayments with us were made late.' },
    },
    {
      code: 'DIGITAL_PAYMENTS',
      label: 'Repayments through KHQR / wallet / mobile',
      variable: 'digitalRepaymentShare',
      type: 'BINS',
      bins: [
        { upTo: '0', points: 0, reason: 'No digital repayments.' },
        { upTo: '0.5', points: 10, reason: '{percent}% of repayments made digitally.' },
        { upTo: null, points: 20, reason: '{percent}% of repayments made digitally.' },
      ],
      missing: { points: 0, reason: 'No repayments through channel files.' },
      adverseReason: null,
    },
    {
      code: 'GROUP_CONTRIBUTIONS',
      label: 'Contributions to a solidarity group',
      variable: 'groupContributionMonths',
      type: 'BINS',
      bins: [
        { upTo: '0', points: 0, reason: 'No group contributions.' },
        { upTo: '5', points: 10, reason: 'Contributed to a group in {value} month(s).' },
        { upTo: null, points: 25, reason: 'Contributed to a group in {value} months.' },
      ],
      missing: { points: 0, reason: 'No group contributions.' },
      adverseReason: null,
    },
    {
      code: 'CONDUCT',
      label: 'Conduct of live loans',
      variable: 'worstCurrentDpd',
      type: 'BINS',
      bins: [
        { upTo: '0', points: 0, reason: 'No live loan with us is past due.' },
        { upTo: '30', points: -40, reason: 'A live loan is {value} days past due.' },
        { upTo: null, points: -120, reason: 'A live loan is {value} days past due.' },
      ],
      missing: { points: 0, reason: 'No live loan with us.' },
      adverseReason: { code: 'CURRENT_ARREARS', text: 'A current loan with us is behind on its repayments.' },
    },
    {
      code: 'WRITTEN_OFF',
      label: 'Previous write-off',
      variable: 'writtenOff',
      type: 'CATEGORIES',
      categories: [
        { values: ['true'], points: -150, reason: 'A previous loan was written off or sold.' },
        { values: ['false'], ...omit },
      ],
      missing: omit,
      adverseReason: { code: 'PREVIOUS_DEFAULT', text: 'A previous loan with us was not repaid.' },
    },
  ],
};

/**
 * The in-house bureau score (DECISIONS D-177): a CBC-style 300–850 score of
 * the borrower's credit report, built from this lender's own records only
 * (CBC is on hold). It reads the report's characteristics — delinquency in
 * the last 12 and 24 months, how recently and how often the borrower was 30+
 * days late, write-offs and restructures, revolving utilisation, length of
 * history, recent credit applications and the number of open facilities.
 * A borrower without enough history gets no score (NO_HISTORY), never a low
 * one: that rule sits before the scorecard (bureauScoreEligibility). The
 * score then feeds the application scorecards' bureauScore input.
 */
const BUREAU_GRADES = [
  { grade: 'A', label: 'Very low risk', minScore: 720 },
  { grade: 'B', label: 'Low risk', minScore: 660 },
  { grade: 'C', label: 'Moderate risk', minScore: 600 },
  { grade: 'D', label: 'Elevated risk', minScore: 540 },
  { grade: 'E', label: 'High risk', minScore: 300 },
];

const INTERNAL_BUREAU: ScorecardDefinitionInput = {
  schemaVersion: 1,
  baseScore: 560,
  minScore: 300,
  maxScore: 850,
  adverseReasonCount: 4,
  grades: BUREAU_GRADES,
  characteristics: [
    {
      code: 'WORST_DPD_12M',
      label: 'Worst days past due, last 12 months',
      group: 'DELINQUENCY',
      variable: 'bureauWorstDpd12m',
      type: 'BINS',
      bins: [
        { upTo: '0', points: 80, reason: 'Never past due in the last 12 months.' },
        { upTo: '29', points: 40, reason: 'At most {value} days past due in the last 12 months.' },
        { upTo: '59', points: -20, reason: 'Up to {value} days past due in the last 12 months.' },
        { upTo: '89', points: -60, reason: 'Up to {value} days past due in the last 12 months.' },
        { upTo: null, points: -120, reason: '{value} days past due in the last 12 months.' },
      ],
      missing: { points: 0, reason: 'No facility in the last 12 months.' },
      adverseReason: { code: 'RECENT_ARREARS', text: 'Repayments were late in the last 12 months.' },
    },
    {
      code: 'WORST_DPD_24M',
      label: 'Worst days past due, last 24 months',
      group: 'DELINQUENCY',
      variable: 'bureauWorstDpd24m',
      type: 'BINS',
      bins: [
        { upTo: '0', points: 30, reason: 'Never past due in the last 24 months.' },
        { upTo: '29', points: 15, reason: 'At most {value} days past due in the last 24 months.' },
        { upTo: '89', points: -10, reason: 'Up to {value} days past due in the last 24 months.' },
        { upTo: null, points: -40, reason: '{value} days past due in the last 24 months.' },
      ],
      missing: { points: 0, reason: 'No facility in the last 24 months.' },
      adverseReason: { code: 'PAST_ARREARS', text: 'Repayments were seriously late in the last two years.' },
    },
    {
      code: 'SINCE_DELINQUENCY',
      label: 'Months since last 30+ days past due',
      group: 'DELINQUENCY',
      variable: 'bureauMonthsSinceDelinquency',
      type: 'BINS',
      bins: [
        { upTo: '5', points: -40, reason: '30+ days past due {value} month(s) ago.' },
        { upTo: '11', points: -15, reason: '30+ days past due {value} months ago.' },
        { upTo: '23', points: 10, reason: '30+ days past due {value} months ago.' },
        { upTo: null, points: 30, reason: 'Last 30+ days past due {value} months ago.' },
      ],
      missing: { points: 40, reason: 'Never 30+ days past due.' },
      adverseReason: { code: 'RECENT_DELINQUENCY', text: 'A repayment was 30 days or more late recently.' },
    },
    {
      code: 'TIMES_30_PLUS',
      label: 'Times 30+ days past due, last 12 months',
      group: 'DELINQUENCY',
      variable: 'bureauTimes30Dpd12m',
      type: 'BINS',
      bins: [
        { upTo: '0', points: 20, reason: 'Never 30+ days past due at a month end in the last 12 months.' },
        { upTo: '1', points: -20, reason: '30+ days past due at {value} month end in the last 12 months.' },
        { upTo: '3', points: -50, reason: '30+ days past due at {value} month ends in the last 12 months.' },
        { upTo: null, points: -90, reason: '30+ days past due at {value} month ends in the last 12 months.' },
      ],
      missing: { points: 0, reason: 'No facility in the last 12 months.' },
      adverseReason: { code: 'REPEATED_ARREARS', text: 'Repayments were 30 days or more late more than once.' },
    },
    {
      code: 'WRITE_OFF',
      label: 'Write-off on record',
      group: 'DEROGATORY',
      variable: 'bureauWriteOff',
      type: 'CATEGORIES',
      categories: [
        { values: ['true'], points: -200, reason: 'A facility was written off.' },
        { values: ['false'], ...omit },
      ],
      missing: omit,
      adverseReason: { code: 'WRITE_OFF', text: 'A previous loan was written off.' },
    },
    {
      code: 'RESTRUCTURED',
      label: 'Restructured in the last 24 months',
      group: 'DEROGATORY',
      variable: 'bureauRestructured',
      type: 'CATEGORIES',
      categories: [
        { values: ['true'], points: -60, reason: 'A facility was restructured in the last 24 months.' },
        { values: ['false'], ...omit },
      ],
      missing: omit,
      adverseReason: { code: 'RESTRUCTURED', text: 'A loan was restructured in the last two years.' },
    },
    {
      code: 'UTILISATION',
      label: 'Utilisation of revolving limits',
      variable: 'bureauRevolvingUtilisation',
      type: 'BINS',
      // Best outcome 0, so a borrower without a credit line or card is neither rewarded nor given this reason.
      bins: [
        { upTo: '0.3', points: 0, reason: '{percent}% of revolving limits used.' },
        { upTo: '0.6', points: -20, reason: '{percent}% of revolving limits used.' },
        { upTo: '0.9', points: -40, reason: '{percent}% of revolving limits used.' },
        { upTo: null, points: -70, reason: '{percent}% of revolving limits used.' },
      ],
      missing: omit,
      adverseReason: { code: 'HIGH_UTILISATION', text: 'Credit lines and cards are used close to their limits.' },
    },
    {
      code: 'HISTORY_LENGTH',
      label: 'Age of oldest facility',
      variable: 'bureauOldestFacilityMonths',
      type: 'BINS',
      bins: [
        { upTo: '11', points: 0, reason: 'Oldest facility opened {value} month(s) ago.' },
        { upTo: '35', points: 20, reason: 'Oldest facility opened {value} months ago.' },
        { upTo: '59', points: 35, reason: 'Oldest facility opened {value} months ago.' },
        { upTo: null, points: 50, reason: 'Oldest facility opened {value} months ago.' },
      ],
      missing: { points: 0, reason: 'No facility on record.' },
      adverseReason: { code: 'SHORT_HISTORY', text: 'The credit history is short.' },
    },
    {
      code: 'ENQUIRIES_6M',
      label: 'Credit applications, last 6 months',
      group: 'ENQUIRIES',
      variable: 'bureauEnquiries6m',
      type: 'BINS',
      bins: [
        { upTo: '0', points: 10, reason: 'No other credit application in the last 6 months.' },
        { upTo: '1', points: 0, reason: '{value} other credit application in the last 6 months.' },
        { upTo: '3', points: -20, reason: '{value} other credit applications in the last 6 months.' },
        { upTo: null, points: -45, reason: '{value} other credit applications in the last 6 months.' },
      ],
      missing: { points: 0, reason: 'No enquiries.' },
      adverseReason: { code: 'MANY_ENQUIRIES', text: 'Several recent applications for credit.' },
    },
    {
      code: 'ENQUIRIES_12M',
      label: 'Credit applications, last 12 months',
      group: 'ENQUIRIES',
      variable: 'bureauEnquiries12m',
      type: 'BINS',
      bins: [
        { upTo: '2', ...omit },
        { upTo: '5', points: -10, reason: '{value} other credit applications in the last 12 months.' },
        { upTo: null, points: -30, reason: '{value} other credit applications in the last 12 months.' },
      ],
      missing: omit,
      adverseReason: { code: 'MANY_ENQUIRIES', text: 'Several recent applications for credit.' },
    },
    {
      code: 'ACTIVE_FACILITIES',
      label: 'Open facilities',
      variable: 'bureauActiveFacilities',
      type: 'BINS',
      bins: [
        { upTo: '0', points: 0, reason: 'No open facility.' },
        { upTo: '2', points: 15, reason: '{value} open facility(ies).' },
        { upTo: '4', points: 0, reason: '{value} open facilities.' },
        { upTo: null, points: -25, reason: '{value} open facilities.' },
      ],
      missing: { points: 0, reason: 'No open facility.' },
      adverseReason: { code: 'MANY_FACILITIES', text: 'Many facilities are open at the same time.' },
    },
  ],
};

function build(code: string, name: string, description: string, input: ScorecardDefinitionInput): ScorecardTemplate {
  const v = validateScorecardDefinition(input);
  if (!v.ok) throw new Error(`Scorecard template ${code} is invalid: ${v.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  return { code, name, description, definition: v.definition };
}

export const SCORECARD_TEMPLATES: ScorecardTemplate[] = [
  build(
    'STANDARD_RETAIL',
    'Standard retail scorecard',
    'Affordability, age, repayment history and conduct with us, security and a bureau score when one exists. Reproduces the original origination score.',
    STANDARD_RETAIL,
  ),
  build(
    'THIN_FILE',
    'Thin-file scorecard (alternative data)',
    'For borrowers with little or no credit history: affordability plus verified utility, rent, mobile and cash-flow data and early behaviour with us. Missing or unconsented data scores nothing.',
    THIN_FILE,
  ),
  build(
    'INTERNAL_BUREAU',
    'In-house bureau score (credit report)',
    'Scores the borrower’s credit report built from this lender’s own records (CBC on hold): delinquency in 12 and 24 months, recency and frequency of 30+ days past due, write-offs, restructures, revolving utilisation, length of history, recent applications and open facilities. 300–850; no score without enough history.',
    INTERNAL_BUREAU,
  ),
];

/** The scorecard code a credit report is scored on unless the tenant's settings name another. */
export const INTERNAL_BUREAU_SCORECARD = 'INTERNAL_BUREAU';

export const SCORECARD_TEMPLATE_BY_CODE: Record<string, ScorecardTemplate> = Object.fromEntries(SCORECARD_TEMPLATES.map((t) => [t.code, t]));
