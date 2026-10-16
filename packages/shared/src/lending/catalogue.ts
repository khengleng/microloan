import { LoanFamilyCode, ProductConfigInput, productConfigSchema, ProductConfig, requiredCapabilitiesFor } from './config.js';
import { missingCapabilities } from './capabilities.js';

export interface LoanFamilyDefinition {
  code: LoanFamilyCode;
  name: string;
  description: string;
}

export const LOAN_FAMILY_DEFINITIONS: LoanFamilyDefinition[] = [
  { code: 'PERSONAL', name: 'Personal / consumer', description: 'Unsecured and salary-linked consumer credit.' },
  { code: 'PROPERTY', name: 'Property', description: 'Mortgage, construction, renovation and home equity lending.' },
  { code: 'VEHICLE_ASSET', name: 'Vehicle / assets', description: 'Vehicle and equipment finance.' },
  { code: 'EDUCATION', name: 'Education', description: 'Student, tuition and vocational training loans.' },
  { code: 'MICROFINANCE', name: 'Microfinance', description: 'Microenterprise, group and livelihood lending.' },
  { code: 'SME_COMMERCIAL', name: 'SME / commercial', description: 'Business term, working capital and commercial property lending.' },
  { code: 'AGRICULTURE', name: 'Agriculture', description: 'Crop, livestock, fisheries and farm investment lending.' },
  { code: 'CORPORATE_PROJECT', name: 'Corporate / project', description: 'Corporate, syndicated, project and acquisition finance.' },
  { code: 'TRADE_RECEIVABLES', name: 'Trade / receivables', description: 'Import/export, invoice, factoring and supply-chain finance.' },
  { code: 'INSTITUTIONAL_PUBLIC', name: 'Institutional / public', description: 'Interbank, municipal, sovereign and development lending.' },
];

export interface ProductTemplateDefinition {
  code: string;
  familyCode: LoanFamilyCode;
  name: string;
  description: string;
  /** Capabilities the product type needs beyond what its configuration implies. */
  extraCapabilities: string[];
  /** Part of the Phase 1 end-to-end verified slice. */
  phase1Slice: boolean;
  defaultConfig: ProductConfig;
}

const STANDARD_BUCKETS = [
  { code: 'CURRENT', label: 'Current', minDpd: 0, maxDpd: 0 },
  { code: 'DPD_1_30', label: '1–30 days', minDpd: 1, maxDpd: 30 },
  { code: 'DPD_31_60', label: '31–60 days', minDpd: 31, maxDpd: 60 },
  { code: 'DPD_61_90', label: '61–90 days', minDpd: 61, maxDpd: 90 },
  { code: 'DPD_90_PLUS', label: '90+ days', minDpd: 91, maxDpd: null },
];
const STANDARD_STAGES = [
  { code: 'REMINDER', label: 'Reminder', fromDpd: 1 },
  { code: 'FIELD_FOLLOW_UP', label: 'Field follow-up', fromDpd: 31 },
  { code: 'RECOVERY', label: 'Recovery', fromDpd: 91 },
];

/** Defaults shared by every template; a template overrides only what differs. */
function base(familyCode: LoanFamilyCode, templateCode: string, name: string): ProductConfigInput {
  return {
    schemaVersion: 1,
    identity: {
      familyCode,
      templateCode,
      name,
      description: '',
      legalEntityCode: null,
      currency: 'USD',
      customerTypes: ['INDIVIDUAL'],
      liability: 'INDIVIDUAL',
      eligibleBranchCodes: null,
      countries: ['KH'],
      segments: [],
      channels: ['BRANCH', 'STAFF_PORTAL'],
    },
    attributes: { secured: false, rateType: 'FIXED', greenPurpose: false, digitalChannel: false, recourse: 'NOT_APPLICABLE', structure: 'CONVENTIONAL' },
    limits: { minAmount: '100', maxAmount: '10000', minInstalments: 3, maxInstalments: 36 },
    eligibility: {
      minAgeYears: 18,
      maxAgeAtMaturityYears: 65,
      minMonthlyIncome: null,
      employmentTypes: [],
      minBusinessAgeMonths: null,
      maxDebtServiceRatio: '0.5',
    },
    pricing: {
      fixed: { defaultAnnualRate: '0.15', minAnnualRate: '0.10', maxAnnualRate: '0.18' },
      floating: null,
      rateConvention: 'NOMINAL',
      interestMethod: 'REDUCING_BALANCE',
      accrualBasis: 'PERIODIC',
      dayCount: 'ACT_365_FIXED',
      ratePrecision: 12,
      regulatoryCapAnnualRate: '0.18',
      rounding: { increment: '0.01', mode: 'HALF_UP' },
      fees: [],
      penalty: { type: 'RATE_ON_OVERDUE', flatAmount: null, annualRate: '0.06', graceDays: 3, capPerInstalment: null },
      capitalization: { allowInterestGraceCapitalization: false },
    },
    repayment: {
      method: 'EQUAL_INSTALMENT',
      frequency: 'MONTHLY',
      customFrequency: null,
      maxPrincipalGraceInstalments: 0,
      maxInterestGraceInstalments: 0,
      maxBalloonFraction: null,
      allowIrregularFirstPeriod: false,
      maxFirstPeriodDays: null,
      businessDayConvention: 'NONE',
      holidayCalendarCode: null,
      accrualDateBasis: 'UNADJUSTED',
      prepayment: { allowed: true, minAmount: null, feeRate: null, allowedStrategies: ['RECAST', 'SHORTEN'], defaultStrategy: 'RECAST' },
      earlySettlement: { allowed: true, feeRate: null, feeFixed: null },
      allocation: { order: ['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL'], strategy: 'OLDEST_DUE_FIRST', excessHandling: 'PREPAY' },
      maxBackdateDays: 0,
    },
    security: { collateralRequired: false, acceptedCollateralTypes: [], maxLtv: null, haircuts: {}, valuationMaxAgeDays: null, guaranteeRequired: false, minGuarantors: 0 },
    facility: { type: 'TERM' },
    operations: {
      workflowCode: 'STANDARD_RETAIL',
      requiredDocuments: [{ code: 'ID_DOCUMENT', label: 'Identity document', stage: 'APPLICATION', mandatory: true }],
      disbursementConditions: [{ code: 'AGREEMENT_SIGNED', label: 'Loan agreement signed by the borrower' }],
      delinquencyBuckets: STANDARD_BUCKETS,
      collectionStages: STANDARD_STAGES,
      writeOffMinDpd: 180,
      restructureAllowed: true,
      integrations: { creditBureau: 'OPTIONAL', kyc: 'MANUAL', payments: 'MANUAL' },
    },
    accounting: {
      cash: '1000',
      loansReceivable: '1200',
      interestReceivable: '1210',
      feesReceivable: '1220',
      penaltyReceivable: '1230',
      interestIncome: '4000',
      feeIncome: '4200',
      penaltyIncome: '4100',
      taxPayable: '2200',
      writeOffExpense: '5100',
      roundingDifferences: '4900',
    },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object | null ? DeepPartial<T[K]> | null : T[K] };

function merge<T>(target: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return target;
  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur) ? merge(cur, v as never) : v;
  }
  return out as T;
}

function template(
  code: string,
  familyCode: LoanFamilyCode,
  name: string,
  description: string,
  patch: DeepPartial<ProductConfigInput> = {},
  extraCapabilities: string[] = [],
  phase1Slice = false,
): ProductTemplateDefinition {
  const config = productConfigSchema.parse(merge(base(familyCode, code, name), patch));
  return { code, familyCode, name, description, extraCapabilities, phase1Slice, defaultConfig: config };
}

const SECURED = (maxLtv: string, types: string[], haircuts: Record<string, string> = {}) => ({
  attributes: { secured: true },
  security: { collateralRequired: true, acceptedCollateralTypes: types, maxLtv, haircuts, valuationMaxAgeDays: 365 },
});
const BUSINESS = { identity: { customerTypes: ['SOLE_PROPRIETOR', 'SME'] as ('SOLE_PROPRIETOR' | 'SME')[] }, eligibility: { minBusinessAgeMonths: 12, maxAgeAtMaturityYears: null } };
const CORPORATE = { identity: { customerTypes: ['CORPORATE'] as 'CORPORATE'[] }, eligibility: { minAgeYears: null, maxAgeAtMaturityYears: null, maxDebtServiceRatio: null } };
const INSTITUTION = { identity: { customerTypes: ['INSTITUTION', 'PUBLIC_BODY'] as ('INSTITUTION' | 'PUBLIC_BODY')[] }, eligibility: { minAgeYears: null, maxAgeAtMaturityYears: null, maxDebtServiceRatio: null }, pricing: { dayCount: 'ACT_360' as const } };

/**
 * Facility presets. Every facility prices a fluctuating drawn balance, so they
 * all force DAILY accrual — a periodic rate is undefined when the balance can
 * change on any day.
 */
const REVOLVING = (availabilityMonths: number, commitmentFeeRate: string | null = '0.005') => ({
  pricing: { accrualBasis: 'DAILY' as const },
  facility: { type: 'REVOLVING' as const, availabilityMonths, commitmentFeeRate, termOutOnExpiry: true },
});
const OVERDRAFT_FACILITY = {
  pricing: { accrualBasis: 'DAILY' as const },
  facility: {
    type: 'OVERDRAFT' as const,
    availabilityMonths: 12,
    minimumPaymentRate: '0.05',
    minimumPaymentFloor: '25',
    // An overdraft is repayable on demand: it does not amortize on expiry.
    termOutOnExpiry: false,
  },
};
const STAGED = (availabilityMonths: number, tranches: { code: string; label: string; shareOfLimit: string; availableAfterMonths: number; conditions?: string[] }[]) => ({
  pricing: { accrualBasis: 'DAILY' as const },
  facility: {
    type: 'STAGED_DRAWDOWN' as const,
    availabilityMonths,
    termOutOnExpiry: true,
    tranches: tranches.map((t) => ({ ...t, conditions: t.conditions ?? [] })),
  },
});

export const PRODUCT_TEMPLATES: ProductTemplateDefinition[] = [
  // Personal / consumer
  template('PERSONAL_INSTALMENT', 'PERSONAL', 'Personal instalment loan', 'Unsecured level-instalment consumer loan.', {
    pricing: { fees: [{ code: 'PROCESSING', name: 'Processing fee', calculation: 'PERCENT_OF_PRINCIPAL', rate: '0.01', treatment: 'DEDUCTED', waivable: true }] },
  }, [], true),
  template('SALARY_LOAN', 'PERSONAL', 'Salary loan', 'Instalments deducted from salary.', { eligibility: { employmentTypes: ['SALARIED'] } }),
  template('SALARY_ADVANCE', 'PERSONAL', 'Salary advance', 'Short single-payment advance repaid on payday.', {
    repayment: { method: 'INTEREST_ONLY', prepayment: { allowed: false } },
    limits: { minInstalments: 1, maxInstalments: 1, maxAmount: '2000' },
    eligibility: { employmentTypes: ['SALARIED'] },
  }),
  template('EMERGENCY_LOAN', 'PERSONAL', 'Emergency loan', 'Small, fast-disbursed unsecured loan.', { limits: { maxAmount: '1500', maxInstalments: 12 } }),
  template('DEBT_CONSOLIDATION', 'PERSONAL', 'Debt consolidation', 'Refinances existing consumer debts into one instalment loan.', { limits: { maxInstalments: 60, maxAmount: '30000' } }),
  // A card line revolves and is repayable on demand against a minimum
  // payment, so it carries no commitment fee and does not term out.
  template('CREDIT_CARD', 'PERSONAL', 'Credit card', 'Revolving card credit.', {
    pricing: { accrualBasis: 'DAILY' },
    limits: { minAmount: '100', maxAmount: '20000', minInstalments: 1, maxInstalments: 12 },
    facility: { type: 'REVOLVING', availabilityMonths: 12, commitmentFeeRate: null, termOutOnExpiry: false },
  }, ['card.revolving_credit']),
  template('BNPL', 'PERSONAL', 'Buy now, pay later', 'Purchase-linked short instalment plans.', { identity: { channels: ['API'] } }, ['bnpl.merchant_settlement']),
  // Property
  template('HOME_MORTGAGE', 'PROPERTY', 'Home mortgage', 'Long-tenor annuity secured on residential property.', {
    ...SECURED('0.8', ['RESIDENTIAL_PROPERTY'], { RESIDENTIAL_PROPERTY: '0.1' }),
    limits: { minAmount: '10000', maxAmount: '500000', minInstalments: 60, maxInstalments: 360 },
    pricing: { fixed: { defaultAnnualRate: '0.09', minAnnualRate: '0.06', maxAnnualRate: '0.12' }, fees: [{ code: 'ARRANGEMENT', name: 'Arrangement fee', calculation: 'PERCENT_OF_PRINCIPAL', rate: '0.005', minAmount: '100', treatment: 'FINANCED', waivable: false }] },
    eligibility: { maxAgeAtMaturityYears: 75, maxDebtServiceRatio: '0.45' },
    operations: {
      workflowCode: 'SECURED_TWO_LEVEL',
      requiredDocuments: [
        { code: 'ID_DOCUMENT', label: 'Identity document', stage: 'APPLICATION', mandatory: true },
        { code: 'TITLE_DEED', label: 'Property title', stage: 'APPROVAL', mandatory: true },
        { code: 'VALUATION_REPORT', label: 'Valuation report', stage: 'APPROVAL', mandatory: true },
      ],
      disbursementConditions: [
        { code: 'AGREEMENT_SIGNED', label: 'Loan agreement signed by the borrower' },
        { code: 'MORTGAGE_REGISTERED', label: 'Mortgage registered over the property' },
      ],
      writeOffMinDpd: 360,
    },
  }, [], true),
  template('CONSTRUCTION', 'PROPERTY', 'Construction loan', 'Staged drawdowns against build milestones.', { ...SECURED('0.7', ['RESIDENTIAL_PROPERTY']), limits: { minAmount: '10000', maxAmount: '500000', minInstalments: 60, maxInstalments: 300 }, eligibility: { maxAgeAtMaturityYears: 75, maxDebtServiceRatio: '0.45' }, ...STAGED(24, [{ code: 'FOUNDATION', label: 'Foundation complete', shareOfLimit: '0.3', availableAfterMonths: 0 }, { code: 'STRUCTURE', label: 'Structure complete', shareOfLimit: '0.4', availableAfterMonths: 6, conditions: ['SURVEYOR_REPORT'] }, { code: 'COMPLETION', label: 'Practical completion', shareOfLimit: '0.3', availableAfterMonths: 12, conditions: ['SURVEYOR_REPORT', 'OCCUPANCY_CERTIFICATE'] }]) }),
  template('RENOVATION', 'PROPERTY', 'Renovation loan', 'Home improvement term loan.', { ...SECURED('0.8', ['RESIDENTIAL_PROPERTY']), limits: { maxAmount: '50000', maxInstalments: 84 } }),
  template('HOME_EQUITY_TERM', 'PROPERTY', 'Home equity term loan', 'Term loan secured on home equity.', { ...SECURED('0.7', ['RESIDENTIAL_PROPERTY']), limits: { maxAmount: '150000', maxInstalments: 180 } }),
  template('HOME_EQUITY_LINE', 'PROPERTY', 'Home equity line', 'Revolving line secured on home equity.', { ...SECURED('0.7', ['RESIDENTIAL_PROPERTY']), limits: { minAmount: '5000', maxAmount: '150000', minInstalments: 12, maxInstalments: 180 }, eligibility: { maxAgeAtMaturityYears: 75 }, ...REVOLVING(120) }),
  template('INVESTMENT_PROPERTY', 'PROPERTY', 'Investment property loan', 'Buy-to-let mortgage.', { ...SECURED('0.7', ['RESIDENTIAL_PROPERTY', 'COMMERCIAL_PROPERTY']), limits: { minAmount: '10000', maxAmount: '500000', maxInstalments: 300 } }),
  template('BRIDGE_LOAN', 'PROPERTY', 'Bridge loan', 'Short interest-only loan repaid from a property sale.', { ...SECURED('0.7', ['RESIDENTIAL_PROPERTY']), repayment: { method: 'INTEREST_ONLY' }, limits: { minInstalments: 1, maxInstalments: 24, maxAmount: '300000' } }),
  // Vehicle / assets
  template('CAR_LOAN', 'VEHICLE_ASSET', 'Car loan', 'Vehicle finance secured on the car.', { ...SECURED('0.9', ['VEHICLE'], { VEHICLE: '0.2' }), limits: { maxAmount: '80000', maxInstalments: 84 } }),
  template('MOTORCYCLE_LOAN', 'VEHICLE_ASSET', 'Motorcycle loan', 'Motorcycle finance.', { ...SECURED('0.9', ['VEHICLE']), limits: { maxAmount: '5000', maxInstalments: 36 } }),
  template('COMMERCIAL_VEHICLE', 'VEHICLE_ASSET', 'Commercial vehicle loan', 'Trucks and vans for business use.', { ...SECURED('0.85', ['VEHICLE']), ...BUSINESS, limits: { maxAmount: '200000', maxInstalments: 72 } }),
  template('EQUIPMENT_LOAN', 'VEHICLE_ASSET', 'Machinery / equipment loan', 'Equipment finance secured on the asset.', { ...SECURED('0.8', ['EQUIPMENT']), ...BUSINESS, limits: { maxAmount: '250000', maxInstalments: 84 } }),
  template('BALLOON_VEHICLE', 'VEHICLE_ASSET', 'Balloon vehicle loan', 'Lower instalments with a final balloon payment.', {
    ...SECURED('0.9', ['VEHICLE']),
    repayment: { method: 'BALLOON', maxBalloonFraction: '0.4', prepayment: { allowedStrategies: ['RECAST'] } },
    limits: { maxAmount: '80000', maxInstalments: 60 },
  }),
  // Education
  template('STUDENT_LOAN', 'EDUCATION', 'Student loan', 'Study loan with a grace period during studies.', {
    eligibility: { employmentTypes: ['STUDENT'], minAgeYears: 17 },
    repayment: { maxPrincipalGraceInstalments: 48, maxInterestGraceInstalments: 48 },
    pricing: { capitalization: { allowInterestGraceCapitalization: true } },
    limits: { maxInstalments: 120 },
  }),
  template('TUITION_LOAN', 'EDUCATION', 'Tuition loan', 'Short tuition instalment plan.', { limits: { maxInstalments: 12, maxAmount: '8000' } }),
  template('VOCATIONAL_TRAINING', 'EDUCATION', 'Vocational training loan', 'Training course finance.', { limits: { maxInstalments: 24, maxAmount: '3000' } }),
  template('INCOME_CONTINGENT_EDUCATION', 'EDUCATION', 'Income-contingent education loan', 'Repayments scale with future income.', {}, ['education.income_contingent']),
  // Microfinance
  template('MICRO_INDIVIDUAL', 'MICROFINANCE', 'Individual microenterprise loan', 'Weekly or monthly loan to a microenterprise owner.', {
    ...BUSINESS,
    identity: { customerTypes: ['INDIVIDUAL', 'SOLE_PROPRIETOR'] },
    repayment: { frequency: 'FORTNIGHTLY' },
    limits: { minAmount: '100', maxAmount: '5000', minInstalments: 6, maxInstalments: 52 },
    pricing: {
      fixed: { defaultAnnualRate: '0.18', minAnnualRate: '0.12', maxAnnualRate: '0.18' },
      fees: [{ code: 'ADMIN', name: 'Administration fee', calculation: 'FIXED', amount: '5', treatment: 'SEPARATE', taxRate: '0.1', waivable: true }],
      penalty: { type: 'FLAT_PER_INSTALMENT', flatAmount: '2', annualRate: null, graceDays: 2 },
    },
    eligibility: { minBusinessAgeMonths: 6 },
    security: { guaranteeRequired: true, minGuarantors: 1 },
  }, [], true),
  template('MICRO_GROUP', 'MICROFINANCE', 'Group lending', 'Joint-liability group loan.', { identity: { liability: 'GROUP_JOINT' } }),
  template('MICRO_LIVELIHOOD', 'MICROFINANCE', 'Livelihood loan', 'Household livelihood loan.', { limits: { maxAmount: '3000' } }),
  template('MICRO_SEASONAL', 'MICROFINANCE', 'Seasonal microloan', 'Small loan repaid on seasonal income dates.', {
    repayment: { method: 'EXPLICIT', frequency: null, prepayment: { allowedStrategies: ['RECAST', 'SHORTEN'] } },
    pricing: { accrualBasis: 'DAILY' },
    limits: { minInstalments: 1, maxInstalments: 6, maxAmount: '3000' },
  }),
  // SME / commercial
  template('SME_TERM', 'SME_COMMERCIAL', 'SME business term loan', 'Equal-principal term loan for business investment.', {
    ...BUSINESS,
    ...SECURED('0.75', ['COMMERCIAL_PROPERTY', 'RESIDENTIAL_PROPERTY', 'EQUIPMENT', 'DEPOSIT'], { EQUIPMENT: '0.3', DEPOSIT: '0' }),
    repayment: { method: 'EQUAL_PRINCIPAL', frequency: 'MONTHLY', maxPrincipalGraceInstalments: 6 },
    limits: { minAmount: '5000', maxAmount: '500000', minInstalments: 12, maxInstalments: 84 },
    pricing: {
      fixed: { defaultAnnualRate: '0.12', minAnnualRate: '0.08', maxAnnualRate: '0.18' },
      dayCount: 'ACT_365_FIXED',
      fees: [{ code: 'ARRANGEMENT', name: 'Arrangement fee', calculation: 'PERCENT_OF_PRINCIPAL', rate: '0.01', minAmount: '50', maxAmount: '2500', treatment: 'DEDUCTED', taxRate: '0.1', waivable: false }],
    },
    operations: {
      workflowCode: 'SECURED_TWO_LEVEL',
      requiredDocuments: [
        { code: 'BUSINESS_REGISTRATION', label: 'Business registration', stage: 'APPLICATION', mandatory: true },
        { code: 'FINANCIAL_STATEMENTS', label: 'Financial statements', stage: 'APPLICATION', mandatory: true },
        { code: 'COLLATERAL_TITLE', label: 'Collateral ownership evidence', stage: 'APPROVAL', mandatory: true },
      ],
      writeOffMinDpd: 360,
    },
  }, [], true),
  template('WORKING_CAPITAL', 'SME_COMMERCIAL', 'Working capital loan', 'Short-term working capital, bullet or instalment.', { ...BUSINESS, repayment: { method: 'INTEREST_ONLY' }, limits: { minInstalments: 1, maxInstalments: 12 } }),
  template('OVERDRAFT', 'SME_COMMERCIAL', 'Overdraft', 'Business overdraft facility.', { ...BUSINESS, limits: { minAmount: '1000', maxAmount: '100000', minInstalments: 1, maxInstalments: 12 }, ...OVERDRAFT_FACILITY }),
  template('REVOLVING_CREDIT', 'SME_COMMERCIAL', 'Revolving credit facility', 'Revolving business credit line.', { ...BUSINESS, limits: { minAmount: '5000', maxAmount: '250000', minInstalments: 6, maxInstalments: 60 }, ...REVOLVING(36) }),
  template('INVENTORY_BACKED', 'SME_COMMERCIAL', 'Inventory-backed loan', 'Borrowing base against inventory.', { ...BUSINESS, ...SECURED('0.6', ['INVENTORY']) }, ['collateral.borrowing_base']),
  template('COMMERCIAL_PROPERTY', 'SME_COMMERCIAL', 'Commercial property loan', 'Term loan secured on commercial real estate.', { ...BUSINESS, ...SECURED('0.7', ['COMMERCIAL_PROPERTY']), limits: { minAmount: '20000', maxAmount: '2000000', maxInstalments: 180 } }),
  // Agriculture
  template('AGRI_CROP_SEASONAL', 'AGRICULTURE', 'Seasonal crop loan', 'Interest accrues daily; principal is repaid on harvest dates.', {
    identity: { customerTypes: ['INDIVIDUAL', 'SOLE_PROPRIETOR'] },
    eligibility: { employmentTypes: ['FARMER'], maxAgeAtMaturityYears: 70 },
    repayment: {
      method: 'EXPLICIT',
      frequency: null,
      businessDayConvention: 'FOLLOWING',
      holidayCalendarCode: 'KH',
      prepayment: { allowedStrategies: ['RECAST', 'SHORTEN'] },
    },
    pricing: {
      accrualBasis: 'DAILY',
      dayCount: 'ACT_365_FIXED',
      fixed: { defaultAnnualRate: '0.14', minAnnualRate: '0.10', maxAnnualRate: '0.18' },
    },
    limits: { minAmount: '200', maxAmount: '20000', minInstalments: 1, maxInstalments: 4 },
  }, [], true),
  template('AGRI_LIVESTOCK', 'AGRICULTURE', 'Livestock loan', 'Livestock purchase with principal grace.', { repayment: { maxPrincipalGraceInstalments: 6 }, limits: { maxInstalments: 36 } }),
  template('AGRI_FISHERIES', 'AGRICULTURE', 'Fisheries loan', 'Boats, nets and aquaculture.', { repayment: { maxPrincipalGraceInstalments: 3 } }),
  template('AGRI_FARM_EQUIPMENT', 'AGRICULTURE', 'Farm equipment loan', 'Tractors and machinery secured on the asset.', { ...SECURED('0.8', ['EQUIPMENT']), limits: { maxAmount: '100000', maxInstalments: 60 } }),
  template('AGRI_PLANTATION', 'AGRICULTURE', 'Plantation development loan', 'Long grace while plantations mature.', {
    repayment: { frequency: 'SEMI_ANNUAL', maxPrincipalGraceInstalments: 8, maxInterestGraceInstalments: 4 },
    pricing: { capitalization: { allowInterestGraceCapitalization: true } },
    limits: { minInstalments: 4, maxInstalments: 30, maxAmount: '500000' },
  }),
  // Corporate / project
  template('CORPORATE_TERM', 'CORPORATE_PROJECT', 'Corporate term loan', 'Senior term loan to a corporate borrower.', { ...CORPORATE, repayment: { frequency: 'QUARTERLY', method: 'EQUAL_PRINCIPAL' }, limits: { minAmount: '100000', maxAmount: '50000000', minInstalments: 4, maxInstalments: 40 } }),
  template('SYNDICATED', 'CORPORATE_PROJECT', 'Syndicated loan', 'Multi-lender facility with an agent.', CORPORATE, ['syndication.participations']),
  template('PROJECT_FINANCE', 'CORPORATE_PROJECT', 'Project finance', 'Non-recourse finance repaid from project cash flows.', { ...CORPORATE, attributes: { recourse: 'NON_RECOURSE' } }, ['project_finance.waterfall', 'covenants.monitoring']),
  template('INFRASTRUCTURE', 'CORPORATE_PROJECT', 'Infrastructure finance', 'Long-tenor infrastructure finance.', CORPORATE, ['project_finance.waterfall', 'covenants.monitoring']),
  template('ACQUISITION_FINANCE', 'CORPORATE_PROJECT', 'Acquisition finance', 'Leveraged acquisition finance with covenants.', CORPORATE, ['covenants.monitoring']),
  // Trade / receivables
  template('IMPORT_LOAN', 'TRADE_RECEIVABLES', 'Import loan', 'Finance against import documents.', BUSINESS, ['trade.documentary']),
  template('EXPORT_WORKING_CAPITAL', 'TRADE_RECEIVABLES', 'Export working capital', 'Pre-shipment export finance.', BUSINESS, ['trade.documentary']),
  template('INVOICE_BACKED', 'TRADE_RECEIVABLES', 'Invoice-backed loan', 'Advances against an invoice register.', BUSINESS, ['trade.invoice_finance', 'collateral.borrowing_base']),
  template('FACTORING', 'TRADE_RECEIVABLES', 'Factoring', 'Purchase of receivables with debtor collection.', { ...BUSINESS, attributes: { recourse: 'FULL' } }, ['trade.factoring']),
  template('SUPPLY_CHAIN_FINANCE', 'TRADE_RECEIVABLES', 'Supply-chain finance', 'Buyer-led payables finance.', BUSINESS, ['trade.supply_chain']),
  template('FORFAITING', 'TRADE_RECEIVABLES', 'Forfaiting', 'Without-recourse purchase of trade receivables.', { ...BUSINESS, attributes: { recourse: 'NON_RECOURSE' } }, ['trade.forfaiting']),
  // Institutional / public
  template('INTERBANK', 'INSTITUTIONAL_PUBLIC', 'Interbank loan', 'Short-term interbank placement.', INSTITUTION, ['institutional.counterparty_limits']),
  template('MUNICIPAL', 'INSTITUTIONAL_PUBLIC', 'Municipal loan', 'Lending to local government.', INSTITUTION, ['institutional.counterparty_limits']),
  template('SOVEREIGN', 'INSTITUTIONAL_PUBLIC', 'Sovereign loan', 'Lending to a national government.', INSTITUTION, ['institutional.counterparty_limits']),
  template('DEVELOPMENT_CONCESSIONAL', 'INSTITUTIONAL_PUBLIC', 'Development / concessional loan', 'Concessional development lending.', INSTITUTION, ['institutional.counterparty_limits']),
  // Islamic structures — separate contract behaviour, not a conventional loan with a relabelled rate.
  template('MURABAHA', 'PERSONAL', 'Murabaha financing', 'Asset purchase and resale at a disclosed profit.', { attributes: { structure: 'MURABAHA' } }, ['islamic.murabaha']),
  template('IJARAH', 'VEHICLE_ASSET', 'Ijarah financing', 'Lease with rentals; the financier owns the asset.', { attributes: { structure: 'IJARAH', secured: true }, security: { collateralRequired: true, acceptedCollateralTypes: ['VEHICLE', 'EQUIPMENT'], maxLtv: '1' } }, ['islamic.ijarah']),
];

export const TEMPLATE_BY_CODE: Record<string, ProductTemplateDefinition> = Object.fromEntries(PRODUCT_TEMPLATES.map((t) => [t.code, t]));

export interface TemplateAvailability {
  available: boolean;
  requiredCapabilities: string[];
  missing: { id: string; status: string; description: string }[];
}

/** Whether a template's default product could be activated with today's capabilities. */
export function templateAvailability(t: ProductTemplateDefinition): TemplateAvailability {
  const required = [...new Set([...requiredCapabilitiesFor(t.defaultConfig), ...t.extraCapabilities])].sort();
  const missing = missingCapabilities(required).map((c) => ({ id: c.id, status: c.status, description: c.description }));
  return { available: missing.length === 0, requiredCapabilities: required, missing };
}
