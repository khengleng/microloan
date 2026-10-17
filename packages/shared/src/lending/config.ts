import { z } from 'zod';
import { CURRENCY_DEFINITIONS, validateRoundingRule } from './money.js';
import { SUPPORTED_DAY_COUNTS } from './dates.js';
import { EngineError, dec } from './decimal.js';
import { buildPeriods, type ScheduleInput } from './schedule.js';
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
    /** INSURER: a credit-insurance premium collected for the insurer — booked to the insurer payable, not fee income (UC-06). */
    payee: z.enum(['LENDER', 'INSURER']).default('LENDER'),
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
        /** Lowest origination credit score approved (OPS-2), on the 300–850 scale; null: not gated. */
        minCreditScore: z.number().int().min(300).max(850).nullable().default(null),
        /** Lowest debt-service coverage (NOI ÷ annual debt service) approved (LT-16); null: not gated. */
        minDscr: decimalString.nullable().default(null),
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
            /**
             * FLAT_PER_INSTALMENT: a fixed late fee once per overdue instalment;
             * PERCENT_PER_INSTALMENT: a percentage of the overdue amount, once;
             * RATE_ON_OVERDUE: daily penalty interest on the overdue amount (UC-55, UC-56).
             */
            type: z.enum(['NONE', 'FLAT_PER_INSTALMENT', 'PERCENT_PER_INSTALMENT', 'RATE_ON_OVERDUE']),
            flatAmount: decimalString.nullable().default(null),
            percentOfOverdue: rateFraction.nullable().default(null),
            annualRate: rateFraction.nullable().default(null),
            graceDays: z.number().int().min(0).max(365).default(0),
            capPerInstalment: decimalString.nullable().default(null),
            /** Most that late charges may ever total on one loan. */
            capPerLoan: decimalString.nullable().default(null),
          })
          .strict(),
        /** Charged when a repayment is reversed because it bounced or was returned (UC-23). */
        returnedPaymentFee: decimalString.nullable().default(null),
        /**
         * A promotional rate for the first instalments of contracts that quote
         * the campaign code (UC-46); the contract rate applies after it and the
         * instalment is re-solved when it does.
         */
        promotion: z
          .object({ code, annualRate: rateFraction, instalments: z.number().int().min(1).max(120), label: z.string().max(120).default('') })
          .strict()
          .nullable()
          .default(null),
        capitalization: z
          .object({
            allowInterestGraceCapitalization: z.boolean(),
            /** SIMPLE: grace interest on the original principal only, never on interest (TV-16). */
            basis: z.enum(['COMPOUND', 'SIMPLE']).default('COMPOUND'),
          })
          .strict(),
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
        /** Stepped (graduated or step-down) instalments (UC-15); null for level instalments. */
        instalmentSteps: z
          .array(z.object({ instalments: z.number().int().min(1).max(600), multiplier: decimalString }).strict())
          .max(12)
          .nullable()
          .default(null),
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
        earlySettlement: z
          .object({
            allowed: z.boolean(),
            feeRate: rateFraction.nullable().default(null),
            feeFixed: decimalString.nullable().default(null),
            /**
             * Interest owed on early payoff (UC-33). ACCRUED: interest accrued to
             * the payoff date by day count. RULE_OF_78 / ACTUARIAL (flat-rate
             * loans): the precomputed interest less the method's rebate for the
             * instalments not yet due.
             */
            rebateMethod: z.enum(['ACCRUED', 'RULE_OF_78', 'ACTUARIAL']).default('ACCRUED'),
          })
          .strict(),
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
        /** Days a borrower has to cure a margin call after a revaluation breaches max LTV (UC-51). */
        marginCallCureDays: z.number().int().min(1).max(90).default(7),
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
        /** How far over the limit a drawdown may go, as a fraction of the limit (UC-41); needs an over-limit rate. */
        overlimitTolerance: rateFraction.nullable().default(null),
        /** Flat fee for each statement period in which the balance went over the limit (UC-41). */
        overlimitFee: decimalString.nullable().default(null),
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
    /**
     * Credit-card terms (LT-07). Only on a REVOLVING facility: the card splits
     * the drawn balance into purchases, cash advances and instalment plans,
     * which price differently (UC-39, UC-40, UC-44). The purchase rate is the
     * facility's negotiated annual rate.
     */
    card: z
      .object({
        cashAdvanceAnnualRate: rateFraction,
        /** Fee on each cash advance: the greater of rate × amount and the minimum (UC-40). */
        cashAdvanceFeeRate: rateFraction.nullable().default(null),
        cashAdvanceFeeMinimum: decimalString.nullable().default(null),
        /** Share of the limit that may be outstanding as cash advances. */
        cashAdvanceLimitShare: rateFraction.default('0.3'),
        minimumPaymentRate: rateFraction.default('0.05'),
        minimumPaymentFloor: decimalString.default('10'),
        /** Days from the statement date to the payment due date. */
        paymentDueDays: z.number().int().min(14).max(25).default(21),
        /** Converting a purchase into fixed instalments (UC-44). Null: not offered. */
        instalmentPlan: z
          .object({
            annualRate: rateFraction,
            minAmount: decimalString,
            allowedMonths: z.array(z.number().int().min(2).max(60)).min(1),
          })
          .strict()
          .nullable()
          .default(null),
      })
      .strict()
      .nullable()
      .default(null),
    /**
     * Buy now, pay later (LT-11): the merchant is paid the purchase price less
     * this discount at disbursement, and refunds come back through it (UC-52).
     */
    bnpl: z
      .object({ merchantDiscountRate: rateFraction })
      .strict()
      .nullable()
      .default(null),
    /**
     * A true lease (LT-15; Ijarah when the structure says so): the lender buys
     * and owns the asset, the customer pays rentals, and at the end either
     * buys it for the residual or hands it back.
     */
    lease: z
      .object({
        assetTypes: z.array(code).min(1),
        /** Whether the lessee may return the asset instead of paying the residual. */
        allowReturn: z.boolean().default(true),
      })
      .strict()
      .nullable()
      .default(null),
    operations: z
      .object({
        workflowCode: code,
        requiredDocuments: z.array(z.object({ code, label: text(80), stage: z.enum(['APPLICATION', 'APPROVAL', 'DISBURSEMENT']), mandatory: z.boolean() }).strict()).default([]),
        disbursementConditions: z.array(z.object({ code, label: text(160) }).strict()).default([]),
        delinquencyBuckets: z.array(bucketSchema).min(1),
        /**
         * The collections ladder (UC-58): at each stage end of day raises one
         * task — an SMS or notice is sent at once; a call, visit or legal
         * review waits in the stage's work queue.
         */
        collectionStages: z
          .array(
            z
              .object({
                code,
                label: text(60),
                fromDpd: z.number().int().min(0),
                action: z.enum(['SMS', 'CALL', 'VISIT', 'NOTICE', 'LEGAL_REVIEW', 'NONE']).default('CALL'),
                queue: z.string().trim().max(40).default(''),
              })
              .strict(),
          )
          .default([]),
        writeOffMinDpd: z.number().int().min(0).nullable().default(null),
        restructureAllowed: z.boolean().default(true),
        /**
         * Minimum down payment as a fraction of the purchase price (principal +
         * down payment), collected before disbursement (UC-02). Null: none required.
         */
        downPayment: z
          .object({ minFraction: rateFraction.nullable().default(null) })
          .strict()
          .default({ minFraction: null }),
        /** Stop recognising interest as income past a days-past-due threshold (DECISIONS D-002). */
        nonAccrual: z
          .object({
            enabled: z.boolean().default(false),
            fromDpd: z.number().int().min(1).max(3650).nullable().default(null),
            /** The loan returns to accrual when days past due falls to this or below. */
            cureAtDpd: z.number().int().min(0).max(3650).default(0),
            /**
             * On entry, move interest already recognised but still unpaid out of
             * income into suspense (DECISIONS D-006). Off keeps it as income and
             * suspends only what accrues from then on.
             */
            reverseAccruedOnEntry: z.boolean().default(true),
          })
          .strict()
          .default({ enabled: false, fromDpd: null, cureAtDpd: 0, reverseAccruedOnEntry: true }),
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
    /** Recovery workflows: repossession, pawn forfeiture, debt sale (DECISIONS D-011…D-014). */
    recovery: z
      .object({
        /** Days past due before collateral may be repossessed. */
        repossessionMinDpd: z.number().int().min(0).max(3650).default(90),
        /** Order net sale proceeds clear the balances in, after costs (UC-65). */
        proceedsOrder: z
          .array(z.enum(['PENALTY', 'FEE', 'INTEREST', 'PRINCIPAL']))
          .length(4)
          .default(['INTEREST', 'PRINCIPAL', 'FEE', 'PENALTY']),
        /** Days after the redemption deadline before a pawn may be forfeited (UC-66). */
        pawnForfeitureGraceDays: z.number().int().min(0).max(365).default(0),
        /** Days past due before a performing loan may be sold to a collection agency (UC-71). */
        debtSaleMinDpd: z.number().int().min(0).max(3650).default(90),
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
    /**
     * Trade finance (LT-18, LT-19). Absent on every other product: the
     * section is optional, so configurations written before it existed parse
     * exactly as they did.
     */
    trade: z
      .object({
        /** Invoice financing on a revolving facility (LT-18, UC-67). */
        invoice: z
          .object({
            /** Fraction of an approved invoice advanced, e.g. '0.8'. */
            advanceRate: rateFraction,
            /** Fee as a fraction of the invoice per fee period (TV-20: '0.02' per 30 days). */
            feeRatePerPeriod: rateFraction,
            feePeriodDays: z.number().int().min(1).max(365),
            feeBasis: z.enum(['WHOLE_PERIODS', 'PRO_RATA']).default('WHOLE_PERIODS'),
            /** Days after the invoice due date before the borrower owes the advance (UC-67). */
            recourseGraceDays: z.number().int().min(0).max(365).default(30),
            /** Longest invoice (issue → due) the product finances. */
            maxInvoiceTenorDays: z.number().int().min(1).max(730).default(180),
          })
          .strict()
          .optional(),
        /** Letters of credit (LT-19, UC-53). */
        letterOfCredit: z
          .object({
            feeRatePerPeriod: rateFraction,
            feePeriodDays: z.number().int().min(1).max(365).default(90),
            minimumFee: decimalString.default('0'),
            maxTenorDays: z.number().int().min(1).max(1825).default(365),
            /** Product code of the term loan a paid credit converts into (UC-53). */
            conversionProductCode: code.nullable().default(null),
          })
          .strict()
          .optional(),
        /**
         * Factoring: the lender buys the seller's invoices, notifies the
         * debtor and collects. Serviced on a revolving limit, like invoices.
         */
        factoring: z
          .object({
            advanceRate: rateFraction,
            /** Discount charge as a fraction of the invoice per fee period, raised on collection. */
            feeRatePerPeriod: rateFraction,
            feePeriodDays: z.number().int().min(1).max(365).default(30),
            feeBasis: z.enum(['WHOLE_PERIODS', 'PRO_RATA']).default('WHOLE_PERIODS'),
            /** Service fee (commission) as a fraction of the invoice, deducted from the advance. */
            serviceFeeRate: rateFraction.default('0'),
            /** What the seller still answers for once the debtor defaults. */
            recourse: z.enum(['FULL', 'LIMITED', 'NONE']),
            /** LIMITED: the seller's liability as a fraction of the invoice. */
            limitedRecourseRate: rateFraction.nullable().default(null),
            /** Days after the due date before the debtor is in default. */
            recourseGraceDays: z.number().int().min(0).max(365).default(60),
            maxInvoiceTenorDays: z.number().int().min(1).max(730).default(120),
            /** Disclosed factoring: the debtor must be notified before the advance. */
            notificationRequired: z.boolean().default(true),
            /** Largest share of the limit outstanding on one debtor; null = no limit. */
            maxDebtorConcentration: rateFraction.nullable().default(null),
          })
          .strict()
          .optional(),
        /**
         * Supply-chain (payables) finance: the facility is the anchor buyer's
         * programme limit; suppliers' invoices the buyer has approved are
         * paid early at a discount and the buyer pays the face at maturity.
         */
        supplyChain: z
          .object({
            discountRate: rateFraction,
            dayCountBasis: z.union([z.literal(360), z.literal(365)]).default(360),
            discountMethod: z.enum(['STRAIGHT', 'YIELD']).default('STRAIGHT'),
            maxInvoiceTenorDays: z.number().int().min(1).max(365).default(180),
            /** Days after maturity before the buyer's unpaid invoice ages as arrears. */
            buyerGraceDays: z.number().int().min(0).max(90).default(5),
            /** Suppliers must be onboarded and approved before their invoices are paid. */
            supplierApprovalRequired: z.boolean().default(true),
          })
          .strict()
          .optional(),
        /** Forfaiting: bills or notes bought without recourse at a discount. */
        forfaiting: z
          .object({
            discountRate: rateFraction,
            dayCountBasis: z.union([z.literal(360), z.literal(365)]).default(360),
            discountMethod: z.enum(['STRAIGHT', 'YIELD']).default('STRAIGHT'),
            /** Days of grace added to the discount period for collection (market practice). */
            graceDays: z.number().int().min(0).max(30).default(3),
            maxTenorDays: z.number().int().min(1).max(1825).default(720),
            instrumentTypes: z.array(z.enum(['BILL_OF_EXCHANGE', 'PROMISSORY_NOTE'])).min(1).default(['BILL_OF_EXCHANGE', 'PROMISSORY_NOTE']),
            /** Each instrument must carry a bank's aval (guarantee) before it is bought. */
            avalRequired: z.boolean().default(true),
            /** Days after maturity before an unpaid instrument is in default. */
            collectionGraceDays: z.number().int().min(0).max(90).default(10),
          })
          .strict()
          .optional(),
        /** Import / export loans against trade documents. */
        documentary: z
          .object({
            direction: z.enum(['IMPORT', 'EXPORT']),
            /** Documents that must be verified before the loan is paid out. */
            requiredDocuments: z.array(code).min(1),
            maxTradeCycleDays: z.number().int().min(1).max(720).default(180),
            proceedsGraceDays: z.number().int().min(0).max(180).default(30),
            maxFinancingRatio: rateFraction.default('0.9'),
          })
          .strict()
          .optional(),
        /** Ledger accounts specific to trade finance. */
        accounts: z
          .object({
            /** Invoice balance owed to the borrower once the advance and fee are repaid. */
            reservePayable: code.default('2310'),
            /** Off-balance-sheet memo pair for issued letters of credit. */
            lcContingentAsset: code.default('9100'),
            lcContingentLiability: code.default('9200'),
            /** Discount withheld on bought receivables, not yet earned (liability). */
            unearnedDiscount: code.default('2340'),
            /** Discount earned on bought receivables (forfaiting, supply-chain finance). */
            discountIncome: code.default('4530'),
            /** Factoring service fees (commission). */
            serviceFeeIncome: code.default('4540'),
            /** Bought receivables lost without recourse to the seller. */
            creditLoss: code.default('5500'),
          })
          .strict()
          .default({}),
      })
      .strict()
      .optional(),
    /** Syndicated lending (LT-24). Optional, like `trade`. */
    syndication: z
      .object({
        minParticipants: z.number().int().min(2).max(50).default(2),
        maxParticipants: z.number().int().min(2).max(50).default(20),
        accounts: z
          .object({
            /** Participants' money collected by the agent and not yet passed on. */
            participantsPayable: code.default('2320'),
            /** Participants' funding of the loan, reduced as principal is returned to them. */
            participantFunding: code.default('2330'),
            /** Participants' share of interest, penalties and fees collected. */
            participantShareExpense: code.default('5310'),
          })
          .strict()
          .default({}),
      })
      .strict()
      .optional(),
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
        /** Loss allowance (contra-asset) and the expense that builds it (OPS-5). */
        loanLossAllowance: code.default('1300'),
        provisionExpense: code.default('5000'),
        /** Down payments the lender collected, held until paid to the seller (UC-02). */
        downPaymentsHeld: code.default('2600'),
        /** Customer deposits applied to a loan under the right of set-off (UC-61). */
        setOffClearing: code.default('2700'),
        /** Recovery workflows (UC-06, UC-65, UC-66, UC-68, UC-71). */
        insurerPayable: code.default('2610'),
        insuranceClaimsReceivable: code.default('1410'),
        borrowerRefundsPayable: code.default('2710'),
        recoveryCostsExpense: code.default('5300'),
        debtSaleGain: code.default('4400'),
        debtSaleLoss: code.default('5400'),
        /** BNPL (LT-11, UC-52): merchant discount earned, and refunds owed back by merchants. */
        merchantDiscountIncome: code.default('4500'),
        merchantClawbackReceivable: code.default('1240'),
        /** Cards (UC-40): the fee charged on a cash advance. */
        cardCashAdvanceFeeIncome: code.default('4520'),
        /** Leases (LT-15): assets handed back at lease end, held for sale. */
        returnedLeaseAssets: code.default('1260'),
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

  if (c.repayment.earlySettlement.rebateMethod !== 'ACCRUED' && c.pricing.interestMethod !== 'FLAT')
    add('repayment.earlySettlement.rebateMethod', 'a Rule of 78 or actuarial rebate applies to flat-rate (precomputed) interest only');
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
  if (c.repayment.instalmentSteps?.length) {
    if (c.repayment.method !== 'EQUAL_INSTALMENT' || c.pricing.interestMethod !== 'REDUCING_BALANCE') {
      add('repayment.instalmentSteps', 'stepped instalments need level instalments on a reducing balance');
    }
    if (c.repayment.instalmentSteps.some((st) => dec(st.multiplier).lte(0))) add('repayment.instalmentSteps', 'multipliers must be positive');
    const stepped = c.repayment.instalmentSteps.reduce((n, st) => n + st.instalments, 0);
    if (stepped > c.limits.minInstalments) add('repayment.instalmentSteps', `the steps cover ${stepped} instalments, more than the shortest allowed term (${c.limits.minInstalments})`);
  }
  if (c.pricing.promotion) {
    if (!c.pricing.fixed) add('pricing.promotion', 'a promotional rate needs fixed pricing');
    if (c.pricing.promotion.instalments >= c.limits.minInstalments) add('pricing.promotion.instalments', `must be shorter than the shortest allowed term (${c.limits.minInstalments})`);
  }
  if (c.repayment.maxInterestGraceInstalments > c.repayment.maxPrincipalGraceInstalments) add('repayment', 'interest grace cannot exceed principal grace');
  if (c.repayment.maxInterestGraceInstalments > 0 && !c.pricing.capitalization.allowInterestGraceCapitalization) {
    add('pricing.capitalization', 'interest grace requires capitalization to be allowed');
  }
  if (!c.repayment.prepayment.allowedStrategies.includes(c.repayment.prepayment.defaultStrategy)) add('repayment.prepayment', 'default strategy must be allowed');
  if (new Set(c.repayment.allocation.order).size !== 5) add('repayment.allocation.order', 'must list each component exactly once');
  if (c.repayment.businessDayConvention !== 'NONE' && !c.repayment.holidayCalendarCode) add('repayment.holidayCalendarCode', 'required when due dates are adjusted');

  if (c.pricing.penalty.type === 'FLAT_PER_INSTALMENT' && !c.pricing.penalty.flatAmount) add('pricing.penalty.flatAmount', 'required');
  if (c.pricing.penalty.type === 'RATE_ON_OVERDUE' && !c.pricing.penalty.annualRate) add('pricing.penalty.annualRate', 'required');
  if (c.pricing.penalty.type === 'PERCENT_PER_INSTALMENT' && !c.pricing.penalty.percentOfOverdue) add('pricing.penalty.percentOfOverdue', 'required');

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
  if (new Set(c.recovery.proceedsOrder).size !== 4) {
    add('recovery.proceedsOrder', 'must list each component exactly once');
  }
  validateGroupBlock(c, add);
  validateFacilityBlock(c, add);
  validateTradeBlock(c, add);
  validateSpecialisedBlocks(c, add);

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
    if (f.overlimitRate !== null || f.overlimitTolerance !== null || f.overlimitFee !== null) set.push('over-limit terms');
    if (f.termOutOnExpiry) set.push('termOutOnExpiry');
    if (f.tranches.length) set.push('tranches');
    if (set.length) add('facility', `a TERM product draws no limit; remove ${set.join(', ')}`);
    return;
  }

  if (f.availabilityMonths === null) add('facility.availabilityMonths', 'a facility needs an availability period');
  if (f.overlimitTolerance !== null && dec(f.overlimitTolerance).gt(0) && f.overlimitRate === null) {
    add('facility.overlimitTolerance', 'an over-limit allowance needs an over-limit rate');
  }
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

/**
 * Trade-finance and syndication cross-field rules.
 *
 * Each specialised behaviour is tied to the one product shape it is serviced
 * on, so a product cannot claim it while the servicing path ignores it:
 * invoices are advanced against a revolving limit, a letter of credit is not
 * itself a loan, and a syndicate shares one term loan.
 */
function validateTradeBlock(c: ProductConfig, add: (path: string, message: string) => void): void {
  const inv = c.trade?.invoice;
  const lc = c.trade?.letterOfCredit;
  const fac = c.trade?.factoring;
  const scf = c.trade?.supplyChain;
  const forf = c.trade?.forfaiting;
  const docs = c.trade?.documentary;
  const receivables = [inv, fac, scf, forf].filter(Boolean).length;
  if (receivables > 1) add('trade', 'a product finances one kind of receivable: invoices, factoring, supply-chain finance or forfaiting');
  if ((fac || scf || forf) && c.facility.type !== 'REVOLVING')
    add('facility.type', 'bought receivables are funded against a revolving programme limit; set facility.type to REVOLVING');
  if (fac) {
    const expected = { FULL: 'FULL', LIMITED: 'LIMITED', NONE: 'NON_RECOURSE' }[fac.recourse];
    if (c.attributes.recourse !== expected) add('attributes.recourse', `factoring with ${fac.recourse} recourse is described as ${expected}`);
    if (fac.recourse === 'LIMITED') {
      if (fac.limitedRecourseRate === null || dec(fac.limitedRecourseRate).lte(0))
        add('trade.factoring.limitedRecourseRate', 'limited recourse needs the seller’s liability as a fraction of the invoice, above 0');
    } else if (fac.limitedRecourseRate !== null) add('trade.factoring.limitedRecourseRate', 'applies only to LIMITED recourse');
    if (dec(fac.advanceRate).lte(0)) add('trade.factoring.advanceRate', 'must be above 0');
    if (dec(fac.serviceFeeRate).gte(dec(fac.advanceRate))) add('trade.factoring.serviceFeeRate', 'the service fee must be less than the advance');
  }
  if (forf && c.attributes.recourse !== 'NON_RECOURSE') add('attributes.recourse', 'forfaiting is without recourse to the seller: NON_RECOURSE');
  if (docs) {
    if (c.facility.type !== 'TERM') add('trade.documentary', 'a documentary trade loan is a term loan; facility.type must be TERM');
    if (receivables || lc) add('trade', 'a documentary trade loan cannot also buy receivables or issue letters of credit');
    if (!c.repayment.earlySettlement.allowed) add('repayment.earlySettlement.allowed', 'trade proceeds settle the loan when they arrive; allow early settlement');
    if (dec(docs.maxFinancingRatio).lte(0)) add('trade.documentary.maxFinancingRatio', 'must be above 0');
    if (new Set(docs.requiredDocuments).size !== docs.requiredDocuments.length) add('trade.documentary.requiredDocuments', 'list each document once');
  }
  if (inv) {
    if (c.facility.type !== 'REVOLVING') add('trade.invoice', 'invoices are advanced against a revolving limit; set facility.type to REVOLVING');
    if (c.attributes.recourse !== 'FULL')
      add('attributes.recourse', 'invoice financing here is with full recourse to the borrower (UC-67); limited or non-recourse purchase is configured as factoring or forfaiting');
    if (dec(inv.advanceRate).lte(0)) add('trade.invoice.advanceRate', 'must be above 0');
  }
  if (lc) {
    if (c.facility.type !== 'TERM') add('trade.letterOfCredit', 'a letter of credit is issued, not drawn; facility.type must be TERM');
    if (receivables) add('trade', 'a product finances receivables or issues letters of credit, not both');
    if (c.syndication) add('trade.letterOfCredit', 'a letter of credit product cannot also be syndicated');
  }
  if (c.syndication) {
    if (c.facility.type !== 'TERM') add('syndication', 'syndication shares one term loan; facility.type must be TERM');
    if (c.identity.liability !== 'INDIVIDUAL') add('syndication', 'a syndicated loan has one borrower; group liability is not supported');
    if (c.syndication.minParticipants > c.syndication.maxParticipants) add('syndication', 'minParticipants exceeds maxParticipants');
  }
}

/**
 * Cards, BNPL and leases each ride on one existing shape: a card is a
 * revolving line, BNPL and leases are term loans. A block on the wrong shape
 * would be configuration nothing in the servicing path reads.
 */
function validateSpecialisedBlocks(c: ProductConfig, add: (path: string, message: string) => void): void {
  if (c.card) {
    if (c.facility.type !== 'REVOLVING') add('card', 'card terms apply to a REVOLVING facility');
    if (c.facility.termOutOnExpiry) add('facility.termOutOnExpiry', 'a card is repayable against a minimum payment; it does not term out');
    if (c.card.cashAdvanceFeeRate === null && c.card.cashAdvanceFeeMinimum === null) add('card.cashAdvanceFeeRate', 'a cash advance needs a fee rate or a minimum fee');
    if (c.card.instalmentPlan && new Set(c.card.instalmentPlan.allowedMonths).size !== c.card.instalmentPlan.allowedMonths.length)
      add('card.instalmentPlan.allowedMonths', 'list each term once');
  }
  if (c.bnpl) {
    if (c.facility.type !== 'TERM') add('bnpl', 'BNPL is a purchase-linked instalment plan, not a facility');
    if (dec(c.bnpl.merchantDiscountRate).gte(dec('0.5'))) add('bnpl.merchantDiscountRate', 'a merchant discount of half the price or more is not a discount');
  }
  if (c.lease) {
    if (c.facility.type !== 'TERM') add('lease', 'a lease is a rental schedule, not a facility');
    if (c.repayment.method !== 'BALLOON') add('repayment.method', 'a lease carries its residual (purchase-option price) as the final balloon: use BALLOON');
    if (!c.security.collateralRequired) add('security.collateralRequired', 'the leased asset is the security: a lease must be secured');
  }
  if (c.attributes.structure === 'IJARAH' && !c.lease) add('lease', 'an Ijarah product is a lease and needs lease terms');
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
  if (c.trade?.invoice) req.add('trade.invoice_finance');
  if (c.trade?.letterOfCredit) req.add('trade.letter_of_credit');
  if (c.trade?.factoring) req.add('trade.factoring');
  if (c.trade?.supplyChain) req.add('trade.supply_chain');
  if (c.trade?.forfaiting) req.add('trade.forfaiting');
  if (c.trade?.documentary) req.add('trade.documentary');
  if (c.syndication) req.add('syndication.participations');
  if (c.attributes.structure === 'MURABAHA') req.add('islamic.murabaha');
  if (c.attributes.structure === 'IJARAH') req.add('islamic.ijarah');
  if (c.card) req.add('card.revolving_credit');
  if (c.bnpl) req.add('bnpl.merchant_settlement');
  if (c.lease) req.add('lease.true_lease');
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
  /** Paid by the borrower towards the purchase, not financed (UC-02). */
  downPayment?: string;
  /** The campaign code of the product's promotional rate (UC-46). */
  promotionCode?: string;
  /** Business financials for debt-service coverage (LT-16), annual amounts. */
  financials?: { annualNetOperatingIncome: string; otherAnnualDebtService?: string };
  /**
   * The contract's choice from the product's policy menus (POLICY_MODEL.md).
   * A kind left out uses the product's default policy.
   */
  policies?: Partial<Record<PolicyKind, { code?: string; parameters?: Record<string, number> }>>;
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
  const minDown = c.operations.downPayment.minFraction;
  if (minDown) {
    const down = t.downPayment ? dec(t.downPayment, 'downPayment') : dec(0);
    const required = principal.plus(down).times(minDown);
    if (down.lt(required))
      add('downPayment', `at least ${dec(minDown).times(100)}% of the purchase price (${principal.plus(down)}) is required: ${required.toDecimalPlaces(2)}`);
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
  if (t.promotionCode && t.promotionCode !== c.pricing.promotion?.code) add('promotionCode', 'no such promotion on this product');
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
  const input: ScheduleInput = {
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
    graceCapitalization: c.pricing.capitalization.basis,
    balloonAmount: t.balloonAmount,
    explicitSchedule: t.explicitSchedule,
    businessDayConvention: c.repayment.businessDayConvention,
    calendar,
    accrualDateBasis: c.repayment.accrualDateBasis,
    instalmentSteps: c.repayment.instalmentSteps ?? undefined,
  };
  const promo = c.pricing.promotion;
  if (!rates && promo && t.promotionCode === promo.code) {
    // UC-46: the promotional rate from disbursement, the contract rate from the start of the period after the promotion.
    const periods = buildPeriods(input).periods;
    if (promo.instalments >= periods.length) throw new EngineError('INVALID_PROMOTION', 'The promotion must end before the last instalment.');
    input.rates = [
      { effectiveFrom: t.disbursementDate, annualRate: promo.annualRate, source: `PROMOTION:${promo.code}` },
      { effectiveFrom: periods[promo.instalments].start, annualRate: input.annualRate!, source: 'CONTRACT_FIXED' },
    ];
    input.annualRate = undefined;
  }
  return input;
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
