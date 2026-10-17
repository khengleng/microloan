import { z } from 'zod';
import { CURRENCY_DEFINITIONS, validateRoundingRule } from './money.js';
import { SUPPORTED_DAY_COUNTS } from './dates.js';
import { EngineError, dec } from './decimal.js';
import type { ScheduleInput } from './schedule.js';
import type { FeeDefinition } from './fees.js';

/**
 * Product configuration schema.
 *
 * Configuration *selects* supported engine behaviour; it never carries
 * executable logic. Every object is `.strict()`, so an unknown key — a
 * `formula`, a `script`, a `sql` — is a validation error, not silently kept.
 * Free text is length-capped and only ever displayed.
 */

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');
const rateFraction = decimalString.refine((v) => dec(v).lte(1), 'rates are decimal fractions (0.12 = 12%)');
const code = z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{1,47}$/, 'codes are 2–48 chars: A-Z, 0-9, _ . -');
const text = (max: number) => z.string().trim().max(max);

export const LOAN_FAMILIES = [
  'PERSONAL',
  'PROPERTY',
  'VEHICLE_ASSET',
  'EDUCATION',
  'MICROFINANCE',
  'SME_COMMERCIAL',
  'AGRICULTURE',
  'CORPORATE_PROJECT',
  'TRADE_RECEIVABLES',
  'INSTITUTIONAL_PUBLIC',
] as const;
export type LoanFamilyCode = (typeof LOAN_FAMILIES)[number];

export const RESTRUCTURE_OPTIONS = [
  'TERM_EXTENSION',
  'INSTALMENT_REDUCTION',
  'PRINCIPAL_GRACE',
  'PAYMENT_DEFERRAL',
  'INTEREST_ONLY',
  'RATE_REDUCTION',
  'SEASONAL_ALIGNMENT',
  'DUE_DATE_CHANGE',
  'BALLOON_ADJUSTMENT',
  'ARREARS_RESCHEDULING',
  'CAPITALIZATION',
  'CHARGE_WAIVER',
  'PRINCIPAL_FORGIVENESS',
] as const;
export type RestructureOption = (typeof RESTRUCTURE_OPTIONS)[number];

export const CHANNELS = ['BRANCH', 'STAFF_PORTAL', 'BORROWER_PORTAL', 'AGENT', 'API'] as const;

const feeSchema = z
  .object({
    code,
    name: text(80),
    calculation: z.enum(['PERCENT_OF_PRINCIPAL', 'FIXED']),
    rate: rateFraction.optional(),
    amount: decimalString.optional(),
    minAmount: decimalString.optional(),
    maxAmount: decimalString.optional(),
    treatment: z.enum(['DEDUCTED', 'FINANCED', 'SEPARATE']),
    taxRate: rateFraction.optional(),
    waivable: z.boolean(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.calculation === 'PERCENT_OF_PRINCIPAL' && f.rate === undefined) ctx.addIssue({ code: 'custom', message: 'percentage fees need a rate' });
    if (f.calculation === 'FIXED' && f.amount === undefined) ctx.addIssue({ code: 'custom', message: 'fixed fees need an amount' });
  });

const bucketSchema = z.object({ code, label: text(60), minDpd: z.number().int().min(0), maxDpd: z.number().int().min(0).nullable() }).strict();

const componentEnum = z.enum(['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL']);

/** Policy kinds a contract can be composed from (docs/servicing/POLICY_MODEL.md). */
export const POLICY_KINDS = ['PREPAYMENT', 'LATE_CHARGES', 'ALLOCATION', 'NON_ACCRUAL'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

const policyChoiceSchema = z
  .object({
    /** Policy code used when the contract makes no choice. */
    defaultCode: code,
    /** Policies a contract on this product may choose. Must include the default. */
    menu: z.array(code).min(1).max(20),
    /** Narrower bounds for policy parameters on this product. */
    parameterBounds: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/), z.object({ min: z.number(), max: z.number() }).strict()).default({}),
  })
  .strict();

export const productConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: z
      .object({
        familyCode: z.enum(LOAN_FAMILIES),
        templateCode: code,
        name: text(120).min(2),
        description: text(1000).default(''),
        legalEntityCode: code.nullable().default(null),
        currency: z.string().refine((c) => c in CURRENCY_DEFINITIONS, 'currency is not configured on this platform'),
        customerTypes: z.array(z.enum(['INDIVIDUAL', 'SOLE_PROPRIETOR', 'SME', 'CORPORATE', 'INSTITUTION', 'PUBLIC_BODY'])).min(1),
        liability: z.enum(['INDIVIDUAL', 'GROUP_JOINT', 'GROUP_INDIVIDUAL']),
        eligibleBranchCodes: z.array(code).nullable().default(null),
        countries: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
        segments: z.array(code).default([]),
        channels: z.array(z.enum(CHANNELS)).min(1),
      })
      .strict(),
    attributes: z
      .object({
        secured: z.boolean(),
        rateType: z.enum(['FIXED', 'FLOATING']),
        greenPurpose: z.boolean().default(false),
        digitalChannel: z.boolean().default(false),
        recourse: z.enum(['FULL', 'LIMITED', 'NON_RECOURSE', 'NOT_APPLICABLE']).default('NOT_APPLICABLE'),
        structure: z.enum(['CONVENTIONAL', 'MURABAHA', 'IJARAH']).default('CONVENTIONAL'),
      })
      .strict(),
    limits: z
      .object({
        minAmount: decimalString,
        maxAmount: decimalString,
        minInstalments: z.number().int().min(1),
        maxInstalments: z.number().int().min(1).max(1200),
      })
      .strict(),
    eligibility: z
      .object({
        minAgeYears: z.number().int().min(0).max(120).nullable().default(null),
        maxAgeAtMaturityYears: z.number().int().min(0).max(120).nullable().default(null),
        minMonthlyIncome: decimalString.nullable().default(null),
        employmentTypes: z.array(z.enum(['SALARIED', 'SELF_EMPLOYED', 'BUSINESS_OWNER', 'FARMER', 'STUDENT', 'OTHER'])).default([]),
        minBusinessAgeMonths: z.number().int().min(0).nullable().default(null),
        maxDebtServiceRatio: rateFraction.nullable().default(null),
      })
      .strict(),
    pricing: z
      .object({
        fixed: z
          .object({ defaultAnnualRate: rateFraction, minAnnualRate: rateFraction, maxAnnualRate: rateFraction })
          .strict()
          .nullable(),
        floating: z
          .object({
            benchmarkCode: code,
            margin: rateFraction,
            resetFrequency: z.enum(['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL']),
            floor: rateFraction.nullable(),
            cap: rateFraction.nullable(),
          })
          .strict()
          .nullable(),
        rateConvention: z.enum(['NOMINAL', 'EFFECTIVE']),
        interestMethod: z.enum(['REDUCING_BALANCE', 'FLAT']),
        accrualBasis: z.enum(['PERIODIC', 'DAILY']),
        dayCount: z.enum(SUPPORTED_DAY_COUNTS),
        ratePrecision: z.number().int().min(4).max(20).default(12),
        regulatoryCapAnnualRate: rateFraction.nullable().default(null),
        rounding: z.object({ increment: decimalString, mode: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']) }).strict(),
        fees: z.array(feeSchema).default([]),
        penalty: z
          .object({
            type: z.enum(['NONE', 'FLAT_PER_INSTALMENT', 'RATE_ON_OVERDUE']),
            flatAmount: decimalString.nullable().default(null),
            annualRate: rateFraction.nullable().default(null),
            graceDays: z.number().int().min(0).max(365).default(0),
            capPerInstalment: decimalString.nullable().default(null),
          })
          .strict(),
        capitalization: z.object({ allowInterestGraceCapitalization: z.boolean() }).strict(),
      })
      .strict(),
    repayment: z
      .object({
        method: z.enum(['EQUAL_INSTALMENT', 'EQUAL_PRINCIPAL', 'INTEREST_ONLY', 'BALLOON', 'EXPLICIT']),
        frequency: z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM']).nullable(),
        customFrequency: z.object({ unit: z.enum(['DAY', 'WEEK', 'MONTH']), every: z.number().int().min(1).max(365) }).strict().nullable().default(null),
        maxPrincipalGraceInstalments: z.number().int().min(0).default(0),
        maxInterestGraceInstalments: z.number().int().min(0).default(0),
        maxBalloonFraction: rateFraction.nullable().default(null),
        allowIrregularFirstPeriod: z.boolean().default(false),
        maxFirstPeriodDays: z.number().int().min(1).max(730).nullable().default(null),
        businessDayConvention: z.enum(['NONE', 'FOLLOWING', 'MODIFIED_FOLLOWING', 'PRECEDING']),
        holidayCalendarCode: code.nullable().default(null),
        accrualDateBasis: z.enum(['UNADJUSTED', 'ADJUSTED']).default('UNADJUSTED'),
        prepayment: z
          .object({
            allowed: z.boolean(),
            minAmount: decimalString.nullable().default(null),
            feeRate: rateFraction.nullable().default(null),
            allowedStrategies: z.array(z.enum(['RECAST', 'SHORTEN'])).default(['RECAST']),
            defaultStrategy: z.enum(['RECAST', 'SHORTEN']).default('RECAST'),
          })
          .strict(),
        earlySettlement: z.object({ allowed: z.boolean(), feeRate: rateFraction.nullable().default(null), feeFixed: decimalString.nullable().default(null) }).strict(),
        /**
         * Lock-in tiers for repaying early (DECISIONS D-004). Tiers are checked in
         * order by whole months since disbursement; the first tier whose
         * `untilMonth` has not passed applies and replaces the base fee.
         */
        earlyRepaymentCharges: z
          .object({
            appliesTo: z.array(z.enum(['PARTIAL_PREPAYMENT', 'EARLY_SETTLEMENT'])).min(1).default(['PARTIAL_PREPAYMENT', 'EARLY_SETTLEMENT']),
            basis: z.enum(['AMOUNT_REPAID', 'OUTSTANDING_PRINCIPAL']).default('AMOUNT_REPAID'),
            tiers: z
              .array(
                z
                  .object({
                    untilMonth: z.number().int().min(1).max(600),
                    action: z.enum(['CHARGE', 'REFUSE']),
                    rate: rateFraction.nullable().default(null),
                    fixed: decimalString.nullable().default(null),
                  })
                  .strict(),
              )
              .max(12)
              .default([]),
          })
          .strict()
          .default({ appliesTo: ['PARTIAL_PREPAYMENT', 'EARLY_SETTLEMENT'], basis: 'AMOUNT_REPAID', tiers: [] }),
        allocation: z
          .object({
            order: z.array(componentEnum).length(5),
            strategy: z.enum(['OLDEST_DUE_FIRST', 'COMPONENT_FIRST']),
            /**
             * What a payment above the amount currently due does. ADVANCE holds it
             * as a customer advance applied to instalments on their due dates
             * (DECISIONS D-001); PREPAY reduces principal now; REJECT refuses it.
             */
            excessHandling: z.enum(['ADVANCE', 'PREPAY', 'REJECT']),
          })
          .strict(),
        maxBackdateDays: z.number().int().min(0).max(31).default(0),
      })
      .strict(),
    security: z
      .object({
        collateralRequired: z.boolean(),
        acceptedCollateralTypes: z.array(code).default([]),
        maxLtv: rateFraction.nullable().default(null),
        haircuts: z.record(code, rateFraction).default({}),
        valuationMaxAgeDays: z.number().int().min(1).nullable().default(null),
        guaranteeRequired: z.boolean().default(false),
        minGuarantors: z.number().int().min(0).default(0),
      })
      .strict(),
    /**
     * Group lending terms. Only meaningful when `identity.liability` is a
     * GROUP_* value; an individual product may carry none of them.
     */
    group: z
      .object({
        minMembers: z.number().int().min(2).max(50).default(3),
        maxMembers: z.number().int().min(2).max(50).default(10),
        shareBasis: z.enum(['EQUAL', 'NEGOTIATED']).default('EQUAL'),
        /** Days a member must have been in the group before a loan includes them. */
        minMembershipDays: z.number().int().min(0).max(3650).default(0),
        requireLeader: z.boolean().default(true),
        /** Whether a member may leave while the group's loan is outstanding. */
        allowExitWithOutstanding: z.boolean().default(false),
      })
      .strict()
      .nullable()
      .default(null),
    /**
     * Facility terms. A TERM product disburses once against a schedule and
     * ignores everything below `type`; the other three draw against a limit,
     * so they carry the bounds a facility negotiated under this product must
     * respect. The per-facility limit itself is negotiated, not configured —
     * these are the product's outer limits on it.
     */
    facility: z
      .object({
        type: z.enum(['TERM', 'REVOLVING', 'OVERDRAFT', 'STAGED_DRAWDOWN']),
        /** Smallest and largest limit a facility under this product may carry. */
        minLimit: decimalString.nullable().default(null),
        maxLimit: decimalString.nullable().default(null),
        /** How long drawdowns stay available, from the facility's start date. */
        availabilityMonths: z.number().int().min(1).max(600).nullable().default(null),
        minimumDrawdown: decimalString.nullable().default(null),
        maximumDrawdown: decimalString.nullable().default(null),
        /** Annual fee on the undrawn commitment. */
        commitmentFeeRate: rateFraction.nullable().default(null),
        /** OVERDRAFT: the minimum payment formula. */
        minimumPaymentRate: rateFraction.nullable().default(null),
        minimumPaymentFloor: decimalString.nullable().default(null),
        /**
         * Annual rate on any balance above the limit. Null refuses over-limit
         * balances outright rather than pricing them.
         */
        overlimitRate: rateFraction.nullable().default(null),
        /** Whether the drawn balance amortizes when availability ends. */
        termOutOnExpiry: z.boolean().default(false),
        /** STAGED_DRAWDOWN: the tranche plan a facility inherits. */
        tranches: z
          .array(
            z
              .object({
                code,
                label: text(80),
                /** Share of the facility limit this tranche releases. */
                shareOfLimit: rateFraction,
                /** Months after the facility starts before it may be drawn. */
                availableAfterMonths: z.number().int().min(0).max(600).default(0),
                conditions: z.array(code).default([]),
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),
    operations: z
      .object({
        workflowCode: code,
        requiredDocuments: z.array(z.object({ code, label: text(80), stage: z.enum(['APPLICATION', 'APPROVAL', 'DISBURSEMENT']), mandatory: z.boolean() }).strict()).default([]),
        disbursementConditions: z.array(z.object({ code, label: text(160) }).strict()).default([]),
        delinquencyBuckets: z.array(bucketSchema).min(1),
        collectionStages: z.array(z.object({ code, label: text(60), fromDpd: z.number().int().min(0) }).strict()).default([]),
        writeOffMinDpd: z.number().int().min(0).nullable().default(null),
        restructureAllowed: z.boolean().default(true),
        /** Stop recognising interest as income past a days-past-due threshold (DECISIONS D-002). */
        nonAccrual: z
          .object({
            enabled: z.boolean().default(false),
            fromDpd: z.number().int().min(1).max(3650).nullable().default(null),
            /** The loan returns to accrual when days past due falls to this or below. */
            cureAtDpd: z.number().int().min(0).max(3650).default(0),
          })
          .strict()
          .default({ enabled: false, fromDpd: null, cureAtDpd: 0 }),
        integrations: z
          .object({
            creditBureau: z.enum(['NONE', 'OPTIONAL', 'REQUIRED']),
            kyc: z.enum(['MANUAL', 'EXTERNAL_REQUIRED']),
            payments: z.enum(['MANUAL', 'ADAPTER']),
          })
          .strict(),
      })
      .strict(),
    restructuring: z
      .object({
        allowedOptions: z
          .array(z.enum(RESTRUCTURE_OPTIONS))
          .default(RESTRUCTURE_OPTIONS.filter((o) => o !== 'PRINCIPAL_FORGIVENESS')),
        /** Jurisdiction / product: capitalizing unpaid interest creates interest on interest. */
        allowInterestCapitalization: z.boolean().default(false),
        allowFeeCapitalization: z.boolean().default(true),
        allowPenaltyCapitalization: z.boolean().default(false),
        allowedDeferredInterestTreatments: z.array(z.enum(['PAY_SEPARATELY', 'DEFER_NO_CAPITALIZATION', 'CAPITALIZE', 'WAIVE'])).default(['PAY_SEPARATELY', 'DEFER_NO_CAPITALIZATION', 'WAIVE']),
        maxExtensionInstalments: z.number().int().min(0).max(600).default(24),
        maxDeferralInstalments: z.number().int().min(0).max(24).default(6),
        /** A further restructure after this many needs escalated approval. */
        escalateAfterRestructures: z.number().int().min(0).max(10).default(1),
        /** Consecutive on-time revised instalments before the delinquency floor lifts. */
        probationInstalments: z.number().int().min(0).max(60).default(6),
        /** Balance change between proposal and execution tolerated without re-approval. */
        materialityTolerance: decimalString.default('0'),
        proposalValidityDays: z.number().int().min(1).max(180).default(30),
        /**
         * Whether the loan may be closed for less than it owes. Off by
         * default: giving up money owed is a decision a product opts into.
         */
        allowNegotiatedSettlement: z.boolean().default(false),
        /**
         * Order a negotiated settlement clears components in. The default
         * (principal first) puts the concession on charges; reversing it
         * protects the charges and forgives principal instead.
         */
        settlementAllocationOrder: z
          .array(z.enum(['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL']))
          .length(5)
          .default(['PRINCIPAL', 'INTEREST', 'FEE', 'TAX', 'PENALTY']),
        /** Whether money received after a write-off may be posted as a recovery. */
        allowPostWriteOffRecovery: z.boolean().default(true),
        /**
         * Whether a loan may be replaced by a new one whose proceeds settle
         * it. Off by default: refinancing is how arrears get buried, so a
         * product opts into it.
         */
        allowRefinance: z.boolean().default(false),
        /** Replacing a loan that is behind at all. */
        refinanceAllowDelinquent: z.boolean().default(false),
        /**
         * Funding the replaced loan's arrears from the new loan. This is the
         * mechanism of evergreening, so it is separately controlled.
         */
        refinanceAllowArrearsRollIn: z.boolean().default(false),
        refinanceMaxDaysPastDue: z.number().int().min(0).max(3650).nullable().default(30),
        refinanceMinInstalmentsPaid: z.number().int().min(0).max(600).default(6),
        maxRefinanceCount: z.number().int().min(0).max(10).default(1),
        /** Whether the borrower may pay a shortfall when proceeds fall short. */
        allowRefinanceShortfall: z.boolean().default(false),
      })
      .strict()
      .default({}),
    /**
     * Policy kinds this product composes from the policy library. A kind not
     * listed uses this configuration's own section for every contract.
     */
    policies: z
      .object({
        PREPAYMENT: policyChoiceSchema.optional(),
        LATE_CHARGES: policyChoiceSchema.optional(),
        ALLOCATION: policyChoiceSchema.optional(),
        NON_ACCRUAL: policyChoiceSchema.optional(),
      })
      .strict()
      .default({}),
    accounting: z
      .object({
        cash: code,
        loansReceivable: code,
        interestReceivable: code,
        feesReceivable: code,
        penaltyReceivable: code,
        interestIncome: code,
        feeIncome: code,
        penaltyIncome: code,
        taxPayable: code,
        writeOffExpense: code,
        roundingDifferences: code,
        concessionsExpense: code.default('5200'),
        /** Income from money recovered on loans already written off. */
        recoveryIncome: code.default('4300'),
        principalForgivenessExpense: code.default('5110'),
        /** Money received ahead of its due date, held for the borrower (liability). */
        customerAdvances: code.default('2300'),
        /** Interest accrued on non-accrual loans, not yet recognised as income. */
        interestSuspense: code.default('2400'),
      })
      .strict(),
  })
  .strict();

export type ProductConfig = z.infer<typeof productConfigSchema>;
export type ProductConfigInput = z.input<typeof productConfigSchema>;

export interface ConfigIssue {
  path: string;
  message: string;
}

/**
 * Validate structure (zod) and cross-field business rules. Returns the
 * normalized config (defaults applied) only when there are no issues.
 */
export function validateProductConfig(raw: unknown): { ok: true; config: ProductConfig } | { ok: false; issues: ConfigIssue[] } {
  const parsed = productConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  const c = parsed.data;
  const issues: ConfigIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (dec(c.limits.minAmount).gt(dec(c.limits.maxAmount))) add('limits', 'minAmount exceeds maxAmount');
  if (c.limits.minInstalments > c.limits.maxInstalments) add('limits', 'minInstalments exceeds maxInstalments');
  try {
    validateRoundingRule(c.identity.currency, c.pricing.rounding);
  } catch (e) {
    add('pricing.rounding', (e as Error).message);
  }

  if (c.attributes.rateType === 'FIXED') {
    if (!c.pricing.fixed) add('pricing.fixed', 'a fixed-rate product needs fixed pricing');
    else {
      const f = c.pricing.fixed;
      if (dec(f.minAnnualRate).gt(dec(f.defaultAnnualRate)) || dec(f.defaultAnnualRate).gt(dec(f.maxAnnualRate))) {
        add('pricing.fixed', 'rates must satisfy min ≤ default ≤ max');
      }
      if (c.pricing.regulatoryCapAnnualRate && dec(f.maxAnnualRate).gt(dec(c.pricing.regulatoryCapAnnualRate))) {
        add('pricing.fixed.maxAnnualRate', 'exceeds the regulatory cap');
      }
    }
    if (c.pricing.floating) add('pricing.floating', 'a fixed-rate product cannot carry floating pricing');
  } else {
    if (!c.pricing.floating) add('pricing.floating', 'a floating-rate product needs floating pricing');
    const fl = c.pricing.floating;
    if (fl?.floor && fl.cap && dec(fl.floor).gt(dec(fl.cap))) add('pricing.floating', 'floor exceeds cap');
  }

  if (c.pricing.interestMethod === 'FLAT') {
    if (c.repayment.method !== 'EQUAL_INSTALMENT') add('pricing.interestMethod', 'flat interest supports EQUAL_INSTALMENT only');
    if (c.pricing.accrualBasis !== 'PERIODIC') add('pricing.accrualBasis', 'flat interest requires PERIODIC accrual');
    if (c.pricing.rateConvention !== 'NOMINAL') add('pricing.rateConvention', 'flat interest is a nominal convention');
    if (c.repayment.maxPrincipalGraceInstalments > 0) add('repayment', 'flat interest does not support grace periods');
    if (c.repayment.prepayment.allowed) add('repayment.prepayment', 'flat-rate loans support early settlement, not partial prepayment');
  }
  if (c.repayment.method === 'EXPLICIT' || c.repayment.allowIrregularFirstPeriod || c.repayment.frequency === 'CUSTOM' && c.repayment.customFrequency?.unit === 'DAY') {
    if (c.pricing.accrualBasis !== 'DAILY') add('pricing.accrualBasis', 'irregular or dated periods require DAILY accrual');
  }
  if (c.repayment.method === 'EXPLICIT' && c.repayment.frequency !== null) add('repayment.frequency', 'explicitly dated schedules have no frequency');
  if (c.repayment.method !== 'EXPLICIT' && c.repayment.frequency === null) add('repayment.frequency', 'a frequency is required');
  if (c.repayment.frequency === 'CUSTOM' && !c.repayment.customFrequency) add('repayment.customFrequency', 'required for CUSTOM frequency');
  if (c.repayment.method === 'BALLOON' && !c.repayment.maxBalloonFraction) add('repayment.maxBalloonFraction', 'required for BALLOON');
  if (c.repayment.maxInterestGraceInstalments > c.repayment.maxPrincipalGraceInstalments) add('repayment', 'interest grace cannot exceed principal grace');
  if (c.repayment.maxInterestGraceInstalments > 0 && !c.pricing.capitalization.allowInterestGraceCapitalization) {
    add('pricing.capitalization', 'interest grace requires capitalization to be allowed');
  }
  if (!c.repayment.prepayment.allowedStrategies.includes(c.repayment.prepayment.defaultStrategy)) add('repayment.prepayment', 'default strategy must be allowed');
  if (new Set(c.repayment.allocation.order).size !== 5) add('repayment.allocation.order', 'must list each component exactly once');
  if (c.repayment.businessDayConvention !== 'NONE' && !c.repayment.holidayCalendarCode) add('repayment.holidayCalendarCode', 'required when due dates are adjusted');

  if (c.pricing.penalty.type === 'FLAT_PER_INSTALMENT' && !c.pricing.penalty.flatAmount) add('pricing.penalty.flatAmount', 'required');
  if (c.pricing.penalty.type === 'RATE_ON_OVERDUE' && !c.pricing.penalty.annualRate) add('pricing.penalty.annualRate', 'required');

  if (c.attributes.secured !== c.security.collateralRequired) add('security.collateralRequired', 'must match attributes.secured');
  if (c.security.collateralRequired && !c.security.maxLtv) add('security.maxLtv', 'secured products need an LTV threshold');
  if (c.security.guaranteeRequired && c.security.minGuarantors < 1) add('security.minGuarantors', 'at least one guarantor is required');

  if (
    c.restructuring.refinanceAllowArrearsRollIn &&
    !c.restructuring.refinanceAllowDelinquent
  ) {
    add(
      'restructuring.refinanceAllowArrearsRollIn',
      'rolling arrears into a new loan is only reachable on a delinquent loan; allow refinanceAllowDelinquent or turn it off',
    );
  }
  if (
    c.restructuring.allowNegotiatedSettlement &&
    !c.restructuring.allowedOptions.includes('CHARGE_WAIVER') &&
    !c.restructuring.allowedOptions.includes('PRINCIPAL_FORGIVENESS')
  ) {
    add(
      'restructuring.allowNegotiatedSettlement',
      'a negotiated settlement gives something up; allow CHARGE_WAIVER or PRINCIPAL_FORGIVENESS',
    );
  }
  if (new Set(c.restructuring.settlementAllocationOrder).size !== 5) {
    add('restructuring.settlementAllocationOrder', 'must list each component exactly once');
  }
  validateGroupBlock(c, add);
  validateFacilityBlock(c, add);

  const buckets = [...c.operations.delinquencyBuckets].sort((a, b) => a.minDpd - b.minDpd);
  if (buckets[0].minDpd !== 0) add('operations.delinquencyBuckets', 'buckets must start at 0 DPD');
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i - 1].maxDpd === null || buckets[i - 1].maxDpd! + 1 !== buckets[i].minDpd) add('operations.delinquencyBuckets', 'buckets must be contiguous');
  }
  if (buckets[buckets.length - 1].maxDpd !== null) add('operations.delinquencyBuckets', 'the last bucket must be open-ended');

  // Lock-in tiers: ascending, and a CHARGE tier must charge something.
  const erc = c.repayment.earlyRepaymentCharges;
  erc.tiers.forEach((t, i) => {
    if (i > 0 && t.untilMonth <= erc.tiers[i - 1].untilMonth)
      add(`repayment.earlyRepaymentCharges.tiers.${i}.untilMonth`, 'tiers must be in ascending untilMonth order');
    if (t.action === 'CHARGE' && !t.rate && !t.fixed)
      add(`repayment.earlyRepaymentCharges.tiers.${i}`, 'a CHARGE tier needs a rate or a fixed amount');
    if (t.action === 'REFUSE' && (t.rate || t.fixed))
      add(`repayment.earlyRepaymentCharges.tiers.${i}`, 'a REFUSE tier cannot also charge');
  });
  if (c.operations.nonAccrual.enabled) {
    if (c.operations.nonAccrual.fromDpd == null) add('operations.nonAccrual.fromDpd', 'required when non-accrual is enabled');
    else if (c.operations.nonAccrual.cureAtDpd >= c.operations.nonAccrual.fromDpd)
      add('operations.nonAccrual.cureAtDpd', 'must be below fromDpd');
  }
  for (const [kind, choice] of Object.entries(c.policies)) {
    if (choice && !choice.menu.includes(choice.defaultCode)) add(`policies.${kind}.menu`, 'must include the default policy');
    for (const [name, b] of Object.entries(choice?.parameterBounds ?? {}))
      if (b.min > b.max) add(`policies.${kind}.parameterBounds.${name}`, 'min exceeds max');
  }

  return issues.length ? { ok: false, issues } : { ok: true, config: c };
}

/**
 * Group cross-field rules.
 *
 * A group product needs its terms, and an individual product must not carry
 * them: leaving them settable would let an individual loan look like a
 * solidarity group in the admin UI while nothing in the servicing path ever
 * applied joint liability.
 */
function validateGroupBlock(c: ProductConfig, add: (path: string, message: string) => void): void {
  const isGroup = c.identity.liability !== 'INDIVIDUAL';
  if (!isGroup) {
    if (c.group) add('group', 'an individual-liability product has no group terms; remove them');
    return;
  }
  if (!c.group) {
    add('group', `a ${c.identity.liability} product needs group terms`);
    return;
  }
  const g = c.group;
  if (g.minMembers > g.maxMembers) add('group', 'minMembers exceeds maxMembers');
  // Joint liability is the reason a solidarity group exists; a group that can
  // shed members mid-loan without settling is not jointly liable in practice.
  if (c.identity.liability === 'GROUP_JOINT' && g.allowExitWithOutstanding && !g.requireLeader) {
    add('group.requireLeader', 'a joint-liability group that allows exit mid-loan must name a leader accountable for the balance');
  }
}

/**
 * Facility cross-field rules.
 *
 * A TERM product must not carry facility terms at all: leaving them settable
 * would let a product look like a line of credit in the admin UI while the
 * servicing path still treated it as a one-off disbursement. Each of the other
 * types then requires exactly the terms its behaviour needs.
 */
function validateFacilityBlock(c: ProductConfig, add: (path: string, message: string) => void): void {
  const f = c.facility;
  if (f.type === 'TERM') {
    const set: string[] = [];
    if (f.minLimit !== null || f.maxLimit !== null) set.push('limits');
    if (f.availabilityMonths !== null) set.push('availabilityMonths');
    if (f.minimumDrawdown !== null || f.maximumDrawdown !== null) set.push('drawdown bounds');
    if (f.commitmentFeeRate !== null) set.push('commitmentFeeRate');
    if (f.minimumPaymentRate !== null || f.minimumPaymentFloor !== null) set.push('minimum payment');
    if (f.overlimitRate !== null) set.push('overlimitRate');
    if (f.termOutOnExpiry) set.push('termOutOnExpiry');
    if (f.tranches.length) set.push('tranches');
    if (set.length) add('facility', `a TERM product draws no limit; remove ${set.join(', ')}`);
    return;
  }

  if (f.availabilityMonths === null) add('facility.availabilityMonths', 'a facility needs an availability period');
  if (f.minLimit !== null && f.maxLimit !== null && dec(f.minLimit).gt(dec(f.maxLimit))) {
    add('facility', 'minLimit exceeds maxLimit');
  }
  if (f.minimumDrawdown !== null && f.maximumDrawdown !== null && dec(f.minimumDrawdown).gt(dec(f.maximumDrawdown))) {
    add('facility', 'minimumDrawdown exceeds maximumDrawdown');
  }
  if (c.pricing.accrualBasis !== 'DAILY') {
    add('pricing.accrualBasis', 'a facility accrues on a fluctuating drawn balance and requires DAILY accrual');
  }
  if (c.pricing.interestMethod === 'FLAT') {
    add('pricing.interestMethod', 'flat interest prices a fixed principal; a facility has none');
  }

  if (f.type === 'OVERDRAFT') {
    if (f.minimumPaymentRate === null && f.minimumPaymentFloor === null) {
      add('facility.minimumPaymentRate', 'an overdraft needs a minimum payment rate or floor, or nothing is ever due');
    }
  } else if (f.minimumPaymentRate !== null || f.minimumPaymentFloor !== null) {
    add('facility.minimumPaymentRate', `minimum payment terms apply to an overdraft, not to a ${f.type} facility`);
  }

  if (f.type === 'STAGED_DRAWDOWN') {
    if (!f.tranches.length) add('facility.tranches', 'a staged drawdown needs at least one tranche');
    const codes = new Set<string>();
    let share = dec('0');
    f.tranches.forEach((t, i) => {
      if (codes.has(t.code)) add(`facility.tranches.${i}.code`, `duplicate tranche code ${t.code}`);
      codes.add(t.code);
      share = share.plus(dec(t.shareOfLimit));
      if (f.availabilityMonths !== null && t.availableAfterMonths > f.availabilityMonths) {
        add(`facility.tranches.${i}.availableAfterMonths`, `tranche ${t.code} becomes available after the facility stops being available`);
      }
    });
    if (f.tranches.length && !share.eq(1)) {
      add('facility.tranches', `tranche shares must total exactly 1 (they total ${share.toString()})`);
    }
    if (!f.termOutOnExpiry) {
      add('facility.termOutOnExpiry', 'a staged drawdown must term out: the drawn balance has to amortize once construction ends');
    }
  } else if (f.tranches.length) {
    add('facility.tranches', `tranches apply to a staged drawdown, not to a ${f.type} facility`);
  }
}

/** Capabilities a configuration depends on. Activation requires all to be IMPLEMENTED. */
export function requiredCapabilitiesFor(c: ProductConfig): string[] {
  const req = new Set<string>(['accounting.double_entry', 'servicing.repayment', 'servicing.accrual', 'servicing.closure', 'servicing.delinquency', 'credit.decision', 'origination.individual']);
  const methodCap: Record<string, string> = {
    EQUAL_INSTALMENT: c.pricing.interestMethod === 'FLAT' ? 'schedule.flat_rate' : 'schedule.equal_instalment',
    EQUAL_PRINCIPAL: 'schedule.equal_principal',
    INTEREST_ONLY: 'schedule.interest_only_bullet',
    BALLOON: 'schedule.balloon',
    EXPLICIT: 'schedule.explicit_dated',
  };
  req.add(methodCap[c.repayment.method]);
  req.add(c.attributes.rateType === 'FIXED' ? 'pricing.fixed_rate' : 'pricing.floating_rate');
  if (c.pricing.fees.length) req.add('pricing.upfront_fees');
  if (c.pricing.penalty.type !== 'NONE') req.add('pricing.late_penalty');
  if (c.repayment.allowIrregularFirstPeriod) req.add('schedule.irregular_first_period');
  if (c.repayment.maxPrincipalGraceInstalments > 0) req.add('schedule.grace_principal');
  if (c.repayment.maxInterestGraceInstalments > 0) req.add('schedule.grace_interest_capitalized');
  if (c.repayment.businessDayConvention !== 'NONE') req.add('schedule.business_day_adjustment');
  if (c.repayment.frequency === 'CUSTOM') req.add('schedule.custom_day_frequency');
  if (c.repayment.prepayment.allowed) req.add('servicing.partial_prepayment');
  if (c.repayment.earlySettlement.allowed) req.add('servicing.early_settlement');
  if (c.operations.writeOffMinDpd !== null) req.add('servicing.write_off');
  if (c.operations.restructureAllowed) req.add('servicing.restructure');
  if (c.restructuring.allowNegotiatedSettlement) req.add('servicing.negotiated_settlement');
  if (c.restructuring.allowRefinance) req.add('servicing.refinance');
  if (c.restructuring.allowPostWriteOffRecovery && c.operations.writeOffMinDpd !== null) {
    req.add('servicing.recovery_after_write_off');
  }
  if (c.security.collateralRequired) req.add('collateral.ltv');
  if (c.security.guaranteeRequired) req.add('guarantee.basic');
  req.add(c.identity.liability === 'INDIVIDUAL' ? 'liability.individual' : 'liability.group_joint');
  req.add(c.operations.integrations.payments === 'MANUAL' ? 'disbursement.manual' : 'disbursement.payment_rail');
  if (c.operations.integrations.creditBureau === 'REQUIRED') req.add('integration.credit_bureau');
  if (c.operations.integrations.kyc === 'EXTERNAL_REQUIRED') req.add('integration.kyc');
  const facilityCap: Record<string, string | null> = { TERM: null, REVOLVING: 'facility.revolving', OVERDRAFT: 'facility.overdraft', STAGED_DRAWDOWN: 'facility.staged_drawdown' };
  if (facilityCap[c.facility.type]) req.add(facilityCap[c.facility.type]!);
  if (c.attributes.structure === 'MURABAHA') req.add('islamic.murabaha');
  if (c.attributes.structure === 'IJARAH') req.add('islamic.ijarah');
  return [...req].sort();
}

// ── Negotiated terms → engine input ─────────────────────────────────────────

export interface NegotiatedTerms {
  principal: string;
  numberOfInstalments?: number;
  annualRate?: string;
  disbursementDate: string;
  firstDueDate?: string;
  principalGraceInstalments?: number;
  interestGraceInstalments?: number;
  balloonAmount?: string;
  explicitSchedule?: { dueDate: string; principal: string }[];
  waivedFeeCodes?: string[];
}

export interface TermsCheck {
  ok: boolean;
  issues: ConfigIssue[];
}

/** Check negotiated terms against the product version's limits and options. */
export function checkTerms(c: ProductConfig, t: NegotiatedTerms): TermsCheck {
  const issues: ConfigIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  let principal;
  try {
    principal = dec(t.principal, 'principal');
  } catch (e) {
    add('principal', (e as Error).message);
    return { ok: false, issues };
  }
  if (principal.lt(dec(c.limits.minAmount)) || principal.gt(dec(c.limits.maxAmount))) {
    add('principal', `must be between ${c.limits.minAmount} and ${c.limits.maxAmount} ${c.identity.currency}`);
  }
  const n = c.repayment.method === 'EXPLICIT' ? t.explicitSchedule?.length ?? 0 : t.numberOfInstalments ?? 0;
  if (n < c.limits.minInstalments || n > c.limits.maxInstalments) add('numberOfInstalments', `must be between ${c.limits.minInstalments} and ${c.limits.maxInstalments}`);
  if (c.repayment.method === 'EXPLICIT' && !t.explicitSchedule?.length) add('explicitSchedule', 'required for this product');
  if (c.repayment.method !== 'EXPLICIT' && t.explicitSchedule?.length) add('explicitSchedule', 'not allowed for this product');
  if (c.pricing.fixed && t.annualRate !== undefined) {
    const r = dec(t.annualRate, 'annualRate');
    if (r.lt(dec(c.pricing.fixed.minAnnualRate)) || r.gt(dec(c.pricing.fixed.maxAnnualRate))) {
      add('annualRate', `must be between ${c.pricing.fixed.minAnnualRate} and ${c.pricing.fixed.maxAnnualRate}`);
    }
  }
  if ((t.principalGraceInstalments ?? 0) > c.repayment.maxPrincipalGraceInstalments) add('principalGraceInstalments', `at most ${c.repayment.maxPrincipalGraceInstalments}`);
  if ((t.interestGraceInstalments ?? 0) > c.repayment.maxInterestGraceInstalments) add('interestGraceInstalments', `at most ${c.repayment.maxInterestGraceInstalments}`);
  if (t.firstDueDate && !c.repayment.allowIrregularFirstPeriod) add('firstDueDate', 'this product does not allow an irregular first period');
  if (t.balloonAmount) {
    if (c.repayment.method !== 'BALLOON') add('balloonAmount', 'not allowed for this product');
    else if (dec(t.balloonAmount).gt(principal.times(dec(c.repayment.maxBalloonFraction ?? '0')))) add('balloonAmount', `at most ${c.repayment.maxBalloonFraction} of principal`);
  } else if (c.repayment.method === 'BALLOON') add('balloonAmount', 'required for this product');
  for (const code of t.waivedFeeCodes ?? []) {
    const fee = c.pricing.fees.find((f) => f.code === code);
    if (!fee) add('waivedFeeCodes', `unknown fee ${code}`);
    else if (!fee.waivable) add('waivedFeeCodes', `fee ${code} is not waivable`);
  }
  return { ok: issues.length === 0, issues };
}

export interface CalendarLookup {
  (code: string): { code: string; weekendDays: number[]; holidays: string[] } | undefined;
}

/**
 * Build the engine input from a product version and negotiated terms. Floating
 * products receive `rates` from the caller (benchmark history + margin).
 */
export function toScheduleInput(
  c: ProductConfig,
  t: NegotiatedTerms,
  bookedPrincipal: string,
  calendar?: { code: string; weekendDays: number[]; holidays: string[] },
  rates?: ScheduleInput['rates'],
): ScheduleInput {
  if (c.repayment.businessDayConvention !== 'NONE' && !calendar) {
    throw new EngineError('MISSING_CALENDAR', `Holiday calendar ${c.repayment.holidayCalendarCode} is not available.`);
  }
  return {
    principal: bookedPrincipal,
    currency: c.identity.currency,
    rounding: c.pricing.rounding,
    disbursementDate: t.disbursementDate,
    annualRate: rates ? undefined : (t.annualRate ?? c.pricing.fixed?.defaultAnnualRate),
    rates,
    rateConvention: c.pricing.rateConvention,
    interestMethod: c.pricing.interestMethod,
    accrualBasis: c.pricing.accrualBasis,
    dayCount: c.pricing.dayCount,
    ratePrecision: c.pricing.ratePrecision,
    method: c.repayment.method,
    frequency: c.repayment.frequency ?? undefined,
    customFrequency: c.repayment.customFrequency ?? undefined,
    numberOfInstalments: c.repayment.method === 'EXPLICIT' ? undefined : t.numberOfInstalments,
    firstDueDate: t.firstDueDate,
    principalGraceInstalments: t.principalGraceInstalments ?? 0,
    interestGraceInstalments: t.interestGraceInstalments ?? 0,
    balloonAmount: t.balloonAmount,
    explicitSchedule: t.explicitSchedule,
    businessDayConvention: c.repayment.businessDayConvention,
    calendar,
    accrualDateBasis: c.repayment.accrualDateBasis,
  };
}

export function feesOf(c: ProductConfig): FeeDefinition[] {
  return c.pricing.fees as FeeDefinition[];
}

/** Stable JSON for hashing and diffing: keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export interface ConfigDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

/** Leaf-level differences between two configurations, for the approval screen. */
export function diffConfigs(before: unknown, after: unknown, prefix = ''): ConfigDiffEntry[] {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => diffConfigs(before[k], after[k], prefix ? `${prefix}.${k}` : k));
  }
  return canonicalJson(before) === canonicalJson(after) ? [] : [{ path: prefix || '(root)', before: before ?? null, after: after ?? null }];
}
