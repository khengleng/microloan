/**
 * Form layout for the product configuration wizard. This mirrors the
 * server-side `productConfigSchema` (packages/shared/src/lending/config.ts);
 * the server remains the validator — this only chooses the controls.
 */

export type FieldKind =
    | 'text' | 'ntext' | 'textarea'
    | 'decimal' | 'ndecimal'
    | 'rate' | 'nrate'
    | 'int' | 'nint'
    | 'bool'
    | 'enum' | 'nenum'
    | 'multi' | 'list'
    | 'order'
    | 'toggleObject'
    | 'json'
    | 'outcome' | 'gradeRules';

export interface FieldSpec {
    path: string;
    label: string;
    kind: FieldKind;
    options?: readonly string[];
    hint?: string;
    /** Only render when this path holds a non-null value. */
    when?: string;
    /** Default value used by toggleObject when switched on. */
    defaultValue?: unknown;
    readOnly?: boolean;
}

export interface StepSpec { key: string; label: string; roots: string[]; fields: FieldSpec[]; note?: string }

const CUSTOMER_TYPES = ['INDIVIDUAL', 'SOLE_PROPRIETOR', 'SME', 'CORPORATE', 'INSTITUTION', 'PUBLIC_BODY'] as const;
const CHANNELS = ['BRANCH', 'STAFF_PORTAL', 'BORROWER_PORTAL', 'AGENT', 'API'] as const;
const EMPLOYMENT = ['SALARIED', 'SELF_EMPLOYED', 'BUSINESS_OWNER', 'FARMER', 'STUDENT', 'OTHER'] as const;
const DAY_COUNTS = ['ACT_365_FIXED', 'ACT_360', 'ACT_ACT_ISDA', 'THIRTY_360_ISDA', 'THIRTY_E_360'] as const;
const RESTRUCTURE_OPTIONS = [
    'TERM_EXTENSION', 'INSTALMENT_REDUCTION', 'PRINCIPAL_GRACE', 'PAYMENT_DEFERRAL', 'INTEREST_ONLY', 'RATE_REDUCTION',
    'SEASONAL_ALIGNMENT', 'DUE_DATE_CHANGE', 'BALLOON_ADJUSTMENT', 'ARREARS_RESCHEDULING', 'CAPITALIZATION', 'CHARGE_WAIVER', 'PRINCIPAL_FORGIVENESS',
] as const;

export const STEPS: StepSpec[] = [
    {
        key: 'identity', label: 'Identity', roots: ['identity', 'schemaVersion'],
        fields: [
            { path: 'identity.familyCode', label: 'Family', kind: 'text', readOnly: true },
            { path: 'identity.templateCode', label: 'Template', kind: 'text', readOnly: true },
            { path: 'identity.name', label: 'Product name', kind: 'text' },
            { path: 'identity.description', label: 'Description', kind: 'textarea' },
            { path: 'identity.currency', label: 'Currency', kind: 'text', hint: 'ISO code configured on this platform, e.g. USD, KHR' },
            { path: 'identity.legalEntityCode', label: 'Legal entity code', kind: 'ntext' },
            { path: 'identity.liability', label: 'Liability', kind: 'enum', options: ['INDIVIDUAL', 'GROUP_JOINT', 'GROUP_INDIVIDUAL'] },
            { path: 'identity.customerTypes', label: 'Customer types', kind: 'multi', options: CUSTOMER_TYPES },
            { path: 'identity.channels', label: 'Channels', kind: 'multi', options: CHANNELS },
            { path: 'identity.segments', label: 'Segments', kind: 'list', hint: 'Comma-separated codes' },
            { path: 'identity.countries', label: 'Countries', kind: 'list', hint: 'Comma-separated ISO-2 codes' },
            { path: 'identity.eligibleBranchCodes', label: 'Eligible branch codes (null = all)', kind: 'json' },
        ],
    },
    {
        key: 'attributes', label: 'Attributes', roots: ['attributes', 'facility'],
        fields: [
            { path: 'attributes.secured', label: 'Secured', kind: 'bool' },
            { path: 'attributes.rateType', label: 'Rate type', kind: 'enum', options: ['FIXED', 'FLOATING'] },
            { path: 'attributes.greenPurpose', label: 'Green purpose', kind: 'bool' },
            { path: 'attributes.digitalChannel', label: 'Digital channel', kind: 'bool' },
            { path: 'attributes.recourse', label: 'Recourse', kind: 'enum', options: ['FULL', 'LIMITED', 'NON_RECOURSE', 'NOT_APPLICABLE'] },
            { path: 'attributes.structure', label: 'Structure', kind: 'enum', options: ['CONVENTIONAL', 'MURABAHA', 'IJARAH'] },
            { path: 'facility.type', label: 'Facility type', kind: 'enum', options: ['TERM', 'REVOLVING', 'OVERDRAFT', 'STAGED_DRAWDOWN'], hint: 'Only capabilities marked IMPLEMENTED can be activated — check the capability matrix.' },
            { path: 'facility.minLimit', label: 'Facility: minimum limit', kind: 'ndecimal', hint: 'Limit-based facilities only (not TERM)' },
            { path: 'facility.maxLimit', label: 'Facility: maximum limit', kind: 'ndecimal' },
            { path: 'facility.availabilityMonths', label: 'Facility: availability (months)', kind: 'nint', hint: 'How long drawdowns stay available from the start date' },
            { path: 'facility.minimumDrawdown', label: 'Facility: minimum drawdown', kind: 'ndecimal' },
            { path: 'facility.maximumDrawdown', label: 'Facility: maximum drawdown', kind: 'ndecimal' },
            { path: 'facility.commitmentFeeRate', label: 'Facility: commitment fee on undrawn (annual)', kind: 'nrate' },
            { path: 'facility.minimumPaymentRate', label: 'Overdraft: minimum payment rate', kind: 'nrate' },
            { path: 'facility.minimumPaymentFloor', label: 'Overdraft: minimum payment floor', kind: 'ndecimal' },
            { path: 'facility.minimumPaymentDueDays', label: 'Overdraft: days from statement to minimum payment due', kind: 'int' },
            { path: 'facility.overlimitRate', label: 'Facility: over-limit annual rate', kind: 'nrate', hint: 'Empty refuses over-limit balances outright' },
            { path: 'facility.termOutOnExpiry', label: 'Facility: term out when availability ends', kind: 'bool' },
            { path: 'facility.tranches', label: 'Staged drawdown: tranches', kind: 'json', hint: '[{ code, label, shareOfLimit, availableAfterMonths, conditions: [codes] }]' },
        ],
    },
    {
        key: 'group', label: 'Group lending', roots: ['group'],
        note: 'Only for products whose liability is GROUP_JOINT or GROUP_INDIVIDUAL.',
        fields: [
            { path: 'group', label: 'Group terms', kind: 'toggleObject', defaultValue: { minMembers: 3, maxMembers: 10, shareBasis: 'EQUAL', minMembershipDays: 0, requireLeader: true, allowExitWithOutstanding: false } },
            { path: 'group.minMembers', label: 'Minimum members', kind: 'int', when: 'group' },
            { path: 'group.maxMembers', label: 'Maximum members', kind: 'int', when: 'group' },
            { path: 'group.shareBasis', label: 'Share basis', kind: 'enum', options: ['EQUAL', 'NEGOTIATED'], when: 'group' },
            { path: 'group.minMembershipDays', label: 'Minimum membership (days) before a loan', kind: 'int', when: 'group' },
            { path: 'group.requireLeader', label: 'Require a leader', kind: 'bool', when: 'group' },
            { path: 'group.allowExitWithOutstanding', label: 'Allow exit while the loan is outstanding', kind: 'bool', when: 'group' },
        ],
    },
    {
        key: 'specialised', label: 'Card / BNPL / lease', roots: ['card', 'bnpl', 'lease'],
        note: 'Card terms need a REVOLVING facility; BNPL and lease terms a TERM product (a lease also needs BALLOON repayment for its residual).',
        fields: [
            { path: 'card', label: 'Credit card terms (LT-07)', kind: 'toggleObject', defaultValue: { cashAdvanceAnnualRate: '0.18', cashAdvanceFeeRate: '0.03', cashAdvanceFeeMinimum: '5', cashAdvanceLimitShare: '0.3', minimumPaymentRate: '0.05', minimumPaymentFloor: '10', paymentDueDays: 21, instalmentPlan: null } },
            { path: 'card.cashAdvanceAnnualRate', label: 'Cash-advance annual rate (from day one)', kind: 'rate', when: 'card' },
            { path: 'card.cashAdvanceFeeRate', label: 'Cash-advance fee rate', kind: 'nrate', when: 'card' },
            { path: 'card.cashAdvanceFeeMinimum', label: 'Cash-advance minimum fee', kind: 'ndecimal', when: 'card' },
            { path: 'card.cashAdvanceLimitShare', label: 'Cash-advance share of the limit', kind: 'rate', when: 'card' },
            { path: 'card.minimumPaymentRate', label: 'Minimum payment: share of principal', kind: 'rate', when: 'card' },
            { path: 'card.minimumPaymentFloor', label: 'Minimum payment floor', kind: 'decimal', when: 'card' },
            { path: 'card.paymentDueDays', label: 'Days from statement to due date', kind: 'int', when: 'card' },
            { path: 'card.instalmentPlan', label: 'Instalment plans (UC-44)', kind: 'json', when: 'card', hint: '{ "annualRate": "0.12", "minAmount": "200", "allowedMonths": [3, 6, 12] } or null' },
            { path: 'bnpl', label: 'BNPL merchant settlement (LT-11)', kind: 'toggleObject', defaultValue: { merchantDiscountRate: '0.04' } },
            { path: 'bnpl.merchantDiscountRate', label: 'Merchant discount rate', kind: 'rate', when: 'bnpl' },
            { path: 'lease', label: 'Lease terms (LT-15)', kind: 'toggleObject', defaultValue: { assetTypes: ['VEHICLE'], allowReturn: true } },
            { path: 'lease.assetTypes', label: 'Leasable asset types', kind: 'list', when: 'lease', hint: 'Comma-separated codes' },
            { path: 'lease.allowReturn', label: 'Lessee may return the asset instead of paying the residual', kind: 'bool', when: 'lease' },
        ],
    },
    {
        key: 'limits', label: 'Limits', roots: ['limits'],
        fields: [
            { path: 'limits.minAmount', label: 'Minimum amount', kind: 'decimal' },
            { path: 'limits.maxAmount', label: 'Maximum amount', kind: 'decimal' },
            { path: 'limits.minInstalments', label: 'Minimum instalments', kind: 'int' },
            { path: 'limits.maxInstalments', label: 'Maximum instalments', kind: 'int' },
        ],
    },
    {
        key: 'eligibility', label: 'Eligibility', roots: ['eligibility'],
        fields: [
            { path: 'eligibility.minAgeYears', label: 'Minimum age (years)', kind: 'nint' },
            { path: 'eligibility.maxAgeAtMaturityYears', label: 'Max age at maturity (years)', kind: 'nint' },
            { path: 'eligibility.minMonthlyIncome', label: 'Minimum monthly income', kind: 'ndecimal' },
            { path: 'eligibility.minBusinessAgeMonths', label: 'Minimum business age (months)', kind: 'nint' },
            { path: 'eligibility.maxDebtServiceRatio', label: 'Max debt-service ratio', kind: 'nrate' },
            { path: 'eligibility.minCreditScore', label: 'Minimum credit score', kind: 'nint', hint: '300–850; blank: not gated' },
            { path: 'eligibility.minDscr', label: 'Minimum DSCR', kind: 'ndecimal', hint: 'Net operating income ÷ annual debt service, e.g. 1.25' },
            { path: 'eligibility.employmentTypes', label: 'Employment types (none = any)', kind: 'multi', options: EMPLOYMENT },
        ],
    },
    {
        key: 'pricing', label: 'Pricing', roots: ['pricing'],
        fields: [
            { path: 'pricing.fixed', label: 'Fixed-rate pricing', kind: 'toggleObject', defaultValue: { defaultAnnualRate: '0.12', minAnnualRate: '0.08', maxAnnualRate: '0.18' } },
            { path: 'pricing.fixed.defaultAnnualRate', label: 'Default annual rate', kind: 'rate', when: 'pricing.fixed' },
            { path: 'pricing.fixed.minAnnualRate', label: 'Minimum annual rate', kind: 'rate', when: 'pricing.fixed' },
            { path: 'pricing.fixed.maxAnnualRate', label: 'Maximum annual rate', kind: 'rate', when: 'pricing.fixed' },
            { path: 'pricing.floating', label: 'Floating pricing (JSON or null)', kind: 'json', hint: '{ benchmarkCode, margin, resetFrequency, floor, cap }' },
            { path: 'pricing.rateConvention', label: 'Rate convention', kind: 'enum', options: ['NOMINAL', 'EFFECTIVE'] },
            { path: 'pricing.interestMethod', label: 'Interest method', kind: 'enum', options: ['REDUCING_BALANCE', 'FLAT'] },
            { path: 'pricing.accrualBasis', label: 'Accrual basis', kind: 'enum', options: ['PERIODIC', 'DAILY'] },
            { path: 'pricing.dayCount', label: 'Day count', kind: 'enum', options: DAY_COUNTS },
            { path: 'pricing.ratePrecision', label: 'Rate precision (digits)', kind: 'int' },
            { path: 'pricing.regulatoryCapAnnualRate', label: 'Regulatory rate cap', kind: 'nrate' },
            { path: 'pricing.rounding.increment', label: 'Rounding increment', kind: 'decimal', hint: 'e.g. 0.01 for cents, 100 for KHR' },
            { path: 'pricing.rounding.mode', label: 'Rounding mode', kind: 'enum', options: ['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'] },
            { path: 'pricing.capitalization.allowInterestGraceCapitalization', label: 'Allow interest-grace capitalization', kind: 'bool' },
            { path: 'pricing.capitalization.basis', label: 'Capitalization basis', kind: 'enum', options: ['COMPOUND', 'SIMPLE'], hint: 'SIMPLE: grace interest on the original principal only — no interest on interest' },
            { path: 'pricing.penalty.type', label: 'Penalty type', kind: 'enum', options: ['NONE', 'FLAT_PER_INSTALMENT', 'PERCENT_PER_INSTALMENT', 'RATE_ON_OVERDUE'] },
            { path: 'pricing.penalty.flatAmount', label: 'Penalty flat amount', kind: 'ndecimal' },
            { path: 'pricing.penalty.percentOfOverdue', label: 'Late fee: % of the overdue amount', kind: 'nrate', hint: 'For PERCENT_PER_INSTALMENT — charged once per overdue instalment' },
            { path: 'pricing.penalty.annualRate', label: 'Penalty annual rate', kind: 'nrate' },
            { path: 'pricing.penalty.graceDays', label: 'Penalty grace days', kind: 'int' },
            { path: 'pricing.penalty.capPerInstalment', label: 'Penalty cap per instalment', kind: 'ndecimal' },
            { path: 'pricing.penalty.capPerLoan', label: 'Penalty cap per loan', kind: 'ndecimal', hint: 'Most that late charges may ever total on one loan' },
            { path: 'pricing.returnedPaymentFee', label: 'Returned-payment fee', kind: 'ndecimal', hint: 'Charged when a repayment is reversed as bounced or returned' },
            { path: 'pricing.promotion', label: 'Promotional rate (campaign)', kind: 'toggleObject', defaultValue: { code: 'PROMO', annualRate: '0', instalments: 3, label: '' }, hint: 'Applies when the contract quotes the campaign code; the contract rate follows' },
            { path: 'pricing.promotion.code', label: 'Campaign code', kind: 'text', when: 'pricing.promotion' },
            { path: 'pricing.promotion.annualRate', label: 'Promotional annual rate', kind: 'rate', when: 'pricing.promotion' },
            { path: 'pricing.promotion.instalments', label: 'Promotional instalments', kind: 'int', when: 'pricing.promotion' },
            { path: 'pricing.promotion.label', label: 'Promotion description', kind: 'text', when: 'pricing.promotion' },
            { path: 'pricing.fees', label: 'Fees', kind: 'json', hint: '[{ code, name, calculation: PERCENT_OF_PRINCIPAL|FIXED, rate?, amount?, minAmount?, maxAmount?, treatment: DEDUCTED|FINANCED|SEPARATE, taxRate?, waivable }]' },
        ],
    },
    {
        key: 'repayment', label: 'Repayment', roots: ['repayment'],
        fields: [
            { path: 'repayment.method', label: 'Method', kind: 'enum', options: ['EQUAL_INSTALMENT', 'EQUAL_PRINCIPAL', 'INTEREST_ONLY', 'BALLOON', 'EXPLICIT'] },
            { path: 'repayment.frequency', label: 'Frequency', kind: 'nenum', options: ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM'] },
            { path: 'repayment.customFrequency', label: 'Custom frequency (JSON or null)', kind: 'json', hint: '{ unit: DAY|WEEK|MONTH, every }' },
            { path: 'repayment.maxPrincipalGraceInstalments', label: 'Max principal-grace instalments', kind: 'int' },
            { path: 'repayment.maxInterestGraceInstalments', label: 'Max interest-grace instalments', kind: 'int' },
            { path: 'repayment.maxBalloonFraction', label: 'Max balloon fraction', kind: 'nrate' },
            { path: 'repayment.instalmentSteps', label: 'Stepped instalments', kind: 'json', hint: 'null for level instalments, or [{ instalments, multiplier }] — e.g. [{ "instalments": 6, "multiplier": "0.5" }] for six half-size instalments first' },
            { path: 'repayment.allowIrregularFirstPeriod', label: 'Allow irregular first period', kind: 'bool' },
            { path: 'repayment.maxFirstPeriodDays', label: 'Max first-period days', kind: 'nint' },
            { path: 'repayment.businessDayConvention', label: 'Business-day convention', kind: 'enum', options: ['NONE', 'FOLLOWING', 'MODIFIED_FOLLOWING', 'PRECEDING'] },
            { path: 'repayment.holidayCalendarCode', label: 'Holiday calendar code', kind: 'ntext' },
            { path: 'repayment.accrualDateBasis', label: 'Accrual date basis', kind: 'enum', options: ['UNADJUSTED', 'ADJUSTED'] },
            { path: 'repayment.maxBackdateDays', label: 'Max back-date days', kind: 'int' },
            { path: 'repayment.prepayment.allowed', label: 'Prepayment allowed', kind: 'bool' },
            { path: 'repayment.prepayment.minAmount', label: 'Prepayment minimum', kind: 'ndecimal' },
            { path: 'repayment.prepayment.feeRate', label: 'Prepayment fee rate', kind: 'nrate' },
            { path: 'repayment.prepayment.allowedStrategies', label: 'Prepayment strategies', kind: 'multi', options: ['RECAST', 'SHORTEN'] },
            { path: 'repayment.prepayment.defaultStrategy', label: 'Default prepayment strategy', kind: 'enum', options: ['RECAST', 'SHORTEN'] },
            { path: 'repayment.earlySettlement.allowed', label: 'Early settlement allowed', kind: 'bool' },
            { path: 'repayment.earlySettlement.feeRate', label: 'Settlement fee rate', kind: 'nrate' },
            { path: 'repayment.earlySettlement.feeFixed', label: 'Settlement fixed fee', kind: 'ndecimal' },
            { path: 'repayment.earlySettlement.rebateMethod', label: 'Payoff interest (flat-rate loans)', kind: 'enum', options: ['ACCRUED', 'RULE_OF_78', 'ACTUARIAL'], hint: 'ACCRUED charges interest accrued to the payoff date; the others rebate precomputed interest' },
            { path: 'repayment.earlyRepaymentCharges', label: 'Lock-in tiers (early repayment charges)', kind: 'json', hint: '{ appliesTo: [PARTIAL_PREPAYMENT, EARLY_SETTLEMENT], basis: AMOUNT_REPAID|OUTSTANDING_PRINCIPAL, tiers: [{ untilMonth, action: CHARGE|REFUSE, rate?, fixed? }] } — tiers replace the base fee while they apply' },
            { path: 'repayment.allocation.order', label: 'Payment allocation order', kind: 'order' },
            { path: 'repayment.allocation.strategy', label: 'Allocation strategy', kind: 'enum', options: ['OLDEST_DUE_FIRST', 'COMPONENT_FIRST'] },
            { path: 'repayment.allocation.excessHandling', label: 'Money beyond what is due', kind: 'enum', options: ['ADVANCE', 'PREPAY', 'REJECT'], hint: 'ADVANCE holds it for the next instalments; PREPAY reduces principal' },
        ],
    },
    {
        key: 'security', label: 'Security', roots: ['security'],
        fields: [
            { path: 'security.collateralRequired', label: 'Collateral required', kind: 'bool' },
            { path: 'security.acceptedCollateralTypes', label: 'Accepted collateral types', kind: 'list', hint: 'Comma-separated codes' },
            { path: 'security.maxLtv', label: 'Max loan-to-value', kind: 'nrate' },
            { path: 'security.valuationMaxAgeDays', label: 'Valuation max age (days)', kind: 'nint' },
            { path: 'security.guaranteeRequired', label: 'Guarantee required', kind: 'bool' },
            { path: 'security.minGuarantors', label: 'Minimum guarantors', kind: 'int' },
            { path: 'security.marginCallCureDays', label: 'Margin call cure period (days)', kind: 'int', hint: 'Time to repay or add collateral after a revaluation breaches max LTV' },
            { path: 'security.haircuts', label: 'Haircuts by collateral type', kind: 'json', hint: '{ "LAND": "0.3" }' },
        ],
    },
    {
        key: 'operations', label: 'Operations', roots: ['operations'],
        fields: [
            { path: 'operations.workflowCode', label: 'Workflow code', kind: 'text', hint: 'See the Workflows page' },
            { path: 'operations.restructureAllowed', label: 'Restructure allowed', kind: 'bool' },
            { path: 'operations.writeOffMinDpd', label: 'Write-off minimum DPD', kind: 'nint' },
            { path: 'operations.downPayment.minFraction', label: 'Minimum down payment', kind: 'nrate', hint: 'Fraction of the purchase price paid before disbursement, e.g. 0.2' },
            { path: 'operations.nonAccrual.enabled', label: 'Non-accrual', kind: 'bool', hint: 'Hold interest in suspense instead of income past a days-past-due threshold' },
            { path: 'operations.nonAccrual.fromDpd', label: 'Non-accrual from DPD', kind: 'nint' },
            { path: 'operations.nonAccrual.cureAtDpd', label: 'Return to accrual at DPD', kind: 'int' },
            { path: 'operations.nonAccrual.reverseAccruedOnEntry', label: 'On entry, move unpaid recognised interest to suspense', kind: 'bool' },
            { path: 'operations.integrations.creditBureau', label: 'Credit bureau', kind: 'enum', options: ['NONE', 'OPTIONAL', 'REQUIRED'] },
            { path: 'operations.integrations.kyc', label: 'KYC', kind: 'enum', options: ['MANUAL', 'EXTERNAL_REQUIRED'] },
            { path: 'operations.integrations.payments', label: 'Payments', kind: 'enum', options: ['MANUAL', 'ADAPTER'] },
            { path: 'operations.requiredDocuments', label: 'Required documents', kind: 'json', hint: '[{ code, label, stage: APPLICATION|APPROVAL|DISBURSEMENT, mandatory }]' },
            { path: 'operations.disbursementConditions', label: 'Disbursement conditions', kind: 'json', hint: '[{ code, label }]' },
            { path: 'operations.delinquencyBuckets', label: 'Delinquency buckets', kind: 'json', hint: '[{ code, label, minDpd, maxDpd|null }]' },
            { path: 'operations.collectionStages', label: 'Collection stages', kind: 'json', hint: '[{ code, label, fromDpd }]' },
        ],
    },
    {
        key: 'restructuring', label: 'Restructuring', roots: ['restructuring'],
        fields: [
            { path: 'restructuring.allowedOptions', label: 'Allowed options', kind: 'multi', options: RESTRUCTURE_OPTIONS },
            { path: 'restructuring.allowInterestCapitalization', label: 'Allow interest capitalization (interest on interest)', kind: 'bool' },
            { path: 'restructuring.allowFeeCapitalization', label: 'Allow fee capitalization', kind: 'bool' },
            { path: 'restructuring.allowPenaltyCapitalization', label: 'Allow penalty capitalization', kind: 'bool' },
            { path: 'restructuring.allowedDeferredInterestTreatments', label: 'Deferred-interest treatments', kind: 'multi', options: ['PAY_SEPARATELY', 'DEFER_NO_CAPITALIZATION', 'CAPITALIZE', 'WAIVE'] },
            { path: 'restructuring.maxExtensionInstalments', label: 'Max extension instalments', kind: 'int' },
            { path: 'restructuring.maxDeferralInstalments', label: 'Max deferral instalments', kind: 'int' },
            { path: 'restructuring.escalateAfterRestructures', label: 'Escalate after N restructures', kind: 'int' },
            { path: 'restructuring.probationInstalments', label: 'Probation instalments', kind: 'int' },
            { path: 'restructuring.balloonReminderDays', label: 'Balloon follow-up: days before it falls due', kind: 'int' },
            { path: 'restructuring.materialityTolerance', label: 'Materiality tolerance', kind: 'decimal' },
            { path: 'restructuring.proposalValidityDays', label: 'Proposal validity (days)', kind: 'int' },
            { path: 'restructuring.allowNegotiatedSettlement', label: 'Allow negotiated settlement (for less than owed)', kind: 'bool' },
            { path: 'restructuring.settlementAllocationOrder', label: 'Negotiated settlement: order the amount clears', kind: 'order' },
            { path: 'restructuring.allowPostWriteOffRecovery', label: 'Allow recoveries after write-off', kind: 'bool' },
            { path: 'restructuring.allowRefinance', label: 'Allow refinancing', kind: 'bool' },
            { path: 'restructuring.refinanceAllowDelinquent', label: 'Refinance: allow a delinquent loan', kind: 'bool' },
            { path: 'restructuring.refinanceAllowArrearsRollIn', label: 'Refinance: allow arrears to be funded by the new loan (evergreening risk)', kind: 'bool' },
            { path: 'restructuring.refinanceMaxDaysPastDue', label: 'Refinance: maximum DPD', kind: 'nint' },
            { path: 'restructuring.refinanceMinInstalmentsPaid', label: 'Refinance: minimum instalments paid', kind: 'int' },
            { path: 'restructuring.maxRefinanceCount', label: 'Refinance: maximum times per loan chain', kind: 'int' },
            { path: 'restructuring.allowRefinanceShortfall', label: 'Refinance: borrower may pay a shortfall', kind: 'bool' },
        ],
    },
    {
        key: 'policies', label: 'Policies', roots: ['policies'],
        note: 'Compose contracts from the policy library: per kind, a default and the menu a contract may choose from. Every code must have an approved version before the product can be activated.',
        fields: [
            { path: 'policies', label: 'Policy menus', kind: 'json', hint: '{ "PREPAYMENT": { "defaultCode": "P-LOCK12", "menu": ["P-LOCK12", "P-NONE"], "parameterBounds": { "lockInMonths": { "min": 6, "max": 18 } } } } — kinds: PREPAYMENT, LATE_CHARGES, ALLOCATION, NON_ACCRUAL' },
        ],
    },
    {
        key: 'scoring', label: 'Scoring', roots: ['scoring'],
        note: 'The scorecard that drives the decision (the organisation’s active version of the code, else the template), an optional silent challenger, the thin-file switch and the decision strategy. “Recommend approve” only recommends approval — the workflow’s approvers still approve. Defaults refer every grade.',
        fields: [
            { path: 'scoring.championCode', label: 'Champion scorecard code', kind: 'text', hint: 'STANDARD_RETAIL or one of Lending › Scorecards' },
            { path: 'scoring.challengerCode', label: 'Challenger scorecard code (shadow, never decides)', kind: 'ntext' },
            { path: 'scoring.thinFile.enabled', label: 'Score thin-file borrowers on a separate scorecard', kind: 'bool' },
            { path: 'scoring.thinFile.scorecardCode', label: 'Thin-file scorecard code', kind: 'text' },
            { path: 'scoring.thinFile.maxInternalHistoryMonths', label: 'Thin file: fewer months of history with us than', kind: 'int' },
            { path: 'scoring.thinFile.requireNoBureauScore', label: 'Thin file: only when there is no bureau score', kind: 'bool' },
            { path: 'scoring.strategy.declineBelowScore', label: 'Decline below score (with the eligibility minimum, the stricter applies)', kind: 'nint' },
            { path: 'scoring.strategy.defaultOutcome', label: 'Outcome for grades without a rule', kind: 'outcome' },
            { path: 'scoring.strategy.gradeRules', label: 'Grade rules', kind: 'gradeRules', hint: 'One row per grade: the outcome, the largest amount that grade may borrow (blank = the product limit) and the rate add-on in basis points (100 bps = 1%).' },
            { path: 'scoring.strategy.knockouts.writtenOff', label: 'Knock-out: earlier write-off', kind: 'bool' },
            { path: 'scoring.strategy.knockouts.maxCurrentDpd', label: 'Knock-out: current days past due above', kind: 'nint' },
            { path: 'scoring.strategy.knockouts.minAgeYears', label: 'Knock-out: age below', kind: 'nint' },
            { path: 'scoring.strategy.knockouts.maxAgeYears', label: 'Knock-out: age above', kind: 'nint' },
            { path: 'scoring.strategy.knockouts.maxDebtServiceRatio', label: 'Knock-out: debt-service ratio above', kind: 'nrate' },
            { path: 'scoring.strategy.enforceRateAddOn', label: 'Require the grade’s rate add-on at approval', kind: 'bool' },
        ],
    },
    {
        key: 'accounting', label: 'Accounting', roots: ['accounting'],
        note: 'Ledger account codes used when events post journals.',
        fields: [
            'cash', 'loansReceivable', 'interestReceivable', 'feesReceivable', 'penaltyReceivable', 'interestIncome', 'feeIncome',
            'penaltyIncome', 'taxPayable', 'writeOffExpense', 'roundingDifferences', 'concessionsExpense', 'principalForgivenessExpense',
            'recoveryIncome', 'customerAdvances', 'interestSuspense', 'penaltySuspense', 'merchantDiscountIncome', 'merchantClawbackReceivable',
            'cardCashAdvanceFeeIncome', 'returnedLeaseAssets',
        ].map((k) => ({ path: `accounting.${k}`, label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), kind: 'text' as const })),
    },
];

export const ALLOCATION_COMPONENTS = ['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL'] as const;

/** Which wizard step an issue path belongs to. */
export function stepForPath(path: string): string {
    const root = path.split('.')[0];
    return STEPS.find((s) => s.roots.includes(root))?.key ?? 'review';
}

export function getPath(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const k of path.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[k];
    }
    return cur;
}

/** Immutable set; creates intermediate objects as needed. */
export function setPath<T>(obj: T, path: string, value: unknown): T {
    const keys = path.split('.');
    const root: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
    let cur = root;
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        const next = cur[k];
        const copy = Array.isArray(next) ? [...next] : next && typeof next === 'object' ? { ...(next as Record<string, unknown>) } : {};
        cur[k] = copy;
        cur = copy as Record<string, unknown>;
    }
    cur[keys[keys.length - 1]] = value;
    return root as T;
}
