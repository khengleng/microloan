/**
 * Response shapes for the configurable lending API (`/v1/lending/...`).
 * Money and rates are decimal strings; dates are "YYYY-MM-DD".
 */

export type Money = string;
export type LocalDate = string;

export interface Issue { path: string; message: string }
export interface DiffEntry { path: string; before: unknown; after: unknown }

export interface DecisionCheck {
    layer: string;
    code: string;
    passed: boolean;
    message: string;
    detail?: unknown;
}

/* ── Catalogue & capabilities ─────────────────────────────────────────────── */

export type CapabilityStatus = 'IMPLEMENTED' | 'SIMULATION_ONLY' | 'REQUIRES_INTEGRATION' | 'NOT_IMPLEMENTED';

export interface MissingCapability { id: string; status: CapabilityStatus; description: string }

export interface TemplateSummary {
    code: string;
    name: string;
    description: string;
    phase1Slice?: boolean;
    available: boolean;
    requiredCapabilities: string[];
    missing: MissingCapability[];
    structure?: unknown;
}

export interface Family { code: string; name: string; description: string; templates: TemplateSummary[] }

export interface Capability {
    id: string;
    area: string;
    description: string;
    status: CapabilityStatus;
    phase?: number | string;
    evidence?: string | string[] | null;
    limitation?: string | null;
}

export interface CapabilityMatrix { engineVersion: string; capabilities: Capability[]; templates: TemplateSummary[] }

export interface TemplateDetail extends TemplateSummary {
    familyCode?: string;
    defaultConfig: ProductConfig;
    availability?: { available: boolean; missing: MissingCapability[] };
}

/* ── Products ─────────────────────────────────────────────────────────────── */

/** Product configuration (validated server-side; the UI edits it loosely). */
export type ProductConfig = Record<string, unknown> & {
    schemaVersion?: number;
    identity?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    limits?: Record<string, unknown>;
    eligibility?: Record<string, unknown>;
    pricing?: Record<string, unknown>;
    repayment?: Record<string, unknown>;
    security?: Record<string, unknown>;
    facility?: Record<string, unknown>;
    operations?: Record<string, unknown>;
    restructuring?: Record<string, unknown>;
    accounting?: Record<string, unknown>;
};

export type VersionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'ACTIVE' | 'RETIRED' | 'REJECTED' | string;

export interface ProductVersionSummary {
    id: string;
    version: number;
    status: VersionStatus;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    makerId: string | null;
    checkerId: string | null;
    changeSummary: string | null;
}

export interface Product {
    id: string;
    code: string;
    name: string;
    familyCode: string;
    templateCode: string;
    activeVersion: ProductVersionSummary | null | number;
    versions: ProductVersionSummary[];
}

export interface ProductVersionDetail extends ProductVersionSummary {
    productId: string;
    product?: { id: string; code: string; name: string; familyCode?: string; templateCode?: string };
    config: ProductConfig;
    validation: { ok: boolean; issues: Issue[] };
    requiredCapabilities: string[];
    missingCapabilities: (MissingCapability | string)[];
    diffFromActive: DiffEntry[] | null;
    activeVersionId: string | null;
    rejectionReason?: string | null;
}

/* ── Simulation ───────────────────────────────────────────────────────────── */

export interface ScheduleLine {
    number: number;
    periodStart: LocalDate;
    periodEnd: LocalDate;
    dueDate: LocalDate;
    accrualDays: number;
    annualRate: Money;
    periodicRate: Money;
    openingPrincipal: Money;
    principal: Money;
    interest: Money;
    capitalizedInterest: Money;
    total: Money;
    closingPrincipal: Money;
    kind: string;
    projected: boolean;
}

export interface ScheduleResult {
    lines: ScheduleLine[];
    totals: { principal: Money; interest: Money; capitalizedInterest: Money; payments: Money };
    instalmentAmount: Money | null;
    finalResidual: Money | null;
    maturityDate: LocalDate;
    explanation: string[];
    hasProjectedAmounts: boolean;
    currency?: string;
}

export interface FeeLine {
    code: string;
    name?: string;
    amount: Money;
    tax?: Money;
    treatment: string;
    waived?: boolean;
}

export interface SimulationResult {
    simulation: true;
    termsCheck: { ok: boolean; issues: Issue[] };
    fees: { lines: FeeLine[]; financed: Money; deducted: Money; separate: Money; bookedPrincipal: Money; netDisbursement: Money };
    schedule: ScheduleResult;
    effectiveAnnualRate: Money | null;
    calculationRecord?: unknown;
}

export interface Terms {
    principal: Money;
    numberOfInstalments?: number;
    annualRate?: Money;
    disbursementDate: LocalDate;
    firstDueDate?: LocalDate;
    principalGraceInstalments?: number;
    interestGraceInstalments?: number;
    balloonAmount?: Money;
    explicitSchedule?: { dueDate: LocalDate; principal: Money }[];
    waivedFeeCodes?: string[];
    /** Paid by the borrower before disbursement (UC-02); not part of the loan. */
    downPayment?: Money;
    /** Campaign code of the product's promotional rate (UC-46). */
    promotionCode?: string;
    /** Business financials for debt-service coverage (LT-16). */
    financials?: { annualNetOperatingIncome: Money; otherAnnualDebtService?: Money };
    /** Income-contingent loans: the income declared at origination. */
    declaredAnnualIncome?: Money;
}

/* ── Workflows ────────────────────────────────────────────────────────────── */

export interface ApprovalLevel { currency: string; minAmount: Money; approvalsRequired: number }
export interface WorkflowDefinition { steps: string[]; approvalLevels: ApprovalLevel[] }
export interface WorkflowVersion { id: string; code: string; version: number; name: string; definition: WorkflowDefinition; status: string; makerId: string | null }
export interface WorkflowsResponse {
    supportedSteps: string[];
    mandatorySteps: string[];
    builtIn: Record<string, { name: string; definition: WorkflowDefinition }>;
    versions: WorkflowVersion[];
}

/* ── Access ───────────────────────────────────────────────────────────────── */

export interface Permission { code: string; description: string; category: string; financial: boolean; platformAllowed: boolean }
export interface Role { id: string; code: string; name: string; description: string | null; isSystem: boolean; permissions: string[]; sensitive: boolean }
export interface Assignment {
    id: string; userId: string; roleId: string; role: { code: string; name: string };
    allBranches: boolean; branchIds: string[]; portfolioIds: string[]; status: string;
    requestedBy: string | null; approvedBy: string | null; validTo: string | null;
}
export interface Delegation {
    id: string; fromUserId?: string; toUserId: string; permissions: string[]; validFrom: string; validTo: string;
    maxAmount?: Money | null; currency?: string | null; reason?: string; status: string; requestedBy?: string; approvedBy?: string | null;
}
export interface Authority {
    id: string; roleId: string | null; userId: string | null; permission: string; currency: string; maxAmount: Money;
    familyCode?: string | null; status: string; role: { code: string } | null;
}
export interface LendingUser { id: string; email: string; role: string; branchId: string | null; isActive: boolean }

export type CondOp = 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'contains';
export interface Comparison { attr: string; op: CondOp; value?: unknown }
export type Condition = { all: Condition[] } | { any: Condition[] } | { not: Condition } | Comparison;
export interface PolicyRule { id: string; effect: 'DENY' | 'REQUIRE'; actions: string[]; condition: Condition; message: string }
export interface PolicyVersion { id: string; version: number; rules: PolicyRule[]; status: string; makerId: string | null }
export interface Policy { id: string; code: string; name: string; description?: string | null; versions: PolicyVersion[] }

export interface AccessOverview {
    permissions: Permission[];
    roles: Role[];
    assignments: Assignment[];
    delegations: Delegation[];
    authorities: Authority[];
    users: LendingUser[];
    policies: Policy[];
    /** The lender's limits (lending settings), checked again by the API. */
    limits?: { maxDelegationDays: number };
}

export interface FlagEvaluation { enabled: boolean; source: string; ruleId: string | null; scope: string | null }
export interface Flag { key: string; description: string; category: string; sensitive: boolean; defaultEnabled: boolean; evaluation: FlagEvaluation }
export interface FlagRule {
    id: string; flagKey: string; scopeType: string; scopeValue: string | null; enabled: boolean; emergency?: boolean;
    priority?: number; effectiveFrom?: string | null; effectiveTo?: string | null; status?: string; reason?: string;
}
export interface FlagApproval { id: string; ruleId: string | null; action: string; status: string; makerId: string; reason: string | null; payload?: unknown }
export interface FlagsResponse { precedence: string[]; flags: Flag[]; tenantRules: FlagRule[]; platformRules: FlagRule[]; approvals: FlagApproval[] }

export interface ServiceAccount { id: string; name: string; scopes: string[]; status?: string; isActive?: boolean; expiresAt?: string | null; lastUsedAt?: string | null; createdAt?: string; keyPrefix?: string }

export interface PolicySimulation {
    question: string;
    answer: 'YES' | 'NO';
    decision: { allowed: boolean; checks: DecisionCheck[]; flags: unknown[] };
    subject: { roles: unknown; grants: unknown; authorities: unknown; cohorts: unknown };
}

/* ── Applications & loans ─────────────────────────────────────────────────── */

export interface Borrower { id?: string; firstName: string; lastName: string }

export interface ApplicationSummary {
    id: string; reference: string; status: string; requestedAmount: Money; currency: string; createdAt: string; borrower: Borrower | null;
}

export interface ApplicationDetail extends ApplicationSummary {
    borrowerId: string;
    productId: string;
    productVersionId: string;
    terms: Terms;
    purpose?: string | null;
    product: { id: string; code: string; name: string } | null;
    productVersion: { id: string; version: number; status: string; config?: ProductConfig } | null;
    documents: { id: string; code: string; fileName: string; mimeType: string; sizeBytes?: number; createdAt: string }[];
    decisions: { id: string; type?: string; stage?: string; decision?: string; outcome?: string; recommendation?: string; rationale: string; actorId?: string; decidedBy?: string; createdAt: string }[];
    conditions: { code: string; label: string; status: string; evidence?: string | null }[];
    guarantees: { id: string; guarantorName: string; type: string; amount: Money; status?: string }[];
    pledges: { id: string; collateral?: { type: string; description: string; marketValue: Money; valuationDate?: string } | null; type?: string; description?: string; marketValue?: Money; pledgedValue?: Money }[];
    agreement: { account: { id: string; reference: string; status: string } | null } | null;
    simulation?: SimulationResult | null;
}

export interface LoanSummary {
    id: string; reference: string; status: string; currency: string;
    bookedPrincipal: Money; principalOutstanding: Money; interestReceivable: Money; feesReceivable: Money; penaltyReceivable: Money;
    daysPastDue: number; delinquencyBucket: string; collectionStage: string | null; maturityDate: LocalDate | null; isRestructured: boolean;
}

export interface LoanAccount extends LoanSummary {
    borrowerId: string; applicationId: string; productId: string; productVersionId: string; familyCode: string;
    instalmentAmount: Money | null; disbursementDate: LocalDate | null; lastAccrualDate: LocalDate | null;
    restructureCount: number; probationRemaining: number; delinquencyFloorBucket: string | null;
    /** Money paid before it was due, applied to instalments on their due dates (UC-27). */
    advanceBalance?: Money;
    /** Interest is held in suspense instead of income while true (UC-62). */
    nonAccrual?: boolean; nonAccrualSince?: LocalDate | null; interestInSuspense?: Money;
    /** Loss allowance and classification from the tenant's impairment policy (OPS-5). */
    allowance?: Money; classification?: string | null; impairmentStage?: number | null;
    /** Down payment received before disbursement and the part the lender still holds (UC-02). */
    downPaymentReceived?: Money; downPaymentHeld?: Money;
}

export interface LoanScheduleLine {
    id: string; agreementVersion: number; number: number; periodStart: LocalDate; periodEnd: LocalDate; dueDate: LocalDate;
    openingPrincipal: Money; principalDue: Money; interestDue: Money; capitalizedInterest: Money; feeDue: Money; taxDue: Money; penaltyDue: Money;
    deferredInterestDue: Money; principalPaid: Money; interestPaid: Money; feePaid: Money; taxPaid: Money; penaltyPaid: Money;
    annualRate: Money; projected: boolean; status: string;
}

export interface JournalLine { id?: string; accountCode: string; debit: Money; credit: Money; description?: string }

export interface FinancialEvent {
    id: string; type: string; status: string; businessDate: string; valueDate: string; amount: Money; currency?: string;
    components: Record<string, unknown>; actorId: string; externalReference: string | null; reversalOfId?: string | null; narrative?: string;
    journal: { lines: JournalLine[] } | null; allocations: unknown[];
}

export interface ApprovalTask { id: string; action: string; status: string; amount: Money | null; currency?: string | null; makerId: string; payload?: unknown; createdAt?: string }

/** A policy the contract was composed from, frozen at booking (POLICY_MODEL.md). */
export interface ContractPolicy { kind: string; code: string; version: number; policyVersionId: string; parameters: Record<string, number> }

export interface AgreementVersion { version: number; reason: string; effectiveDate: LocalDate; engineVersion: string; configHash: string; createdAt: string; createdBy: string; policies?: ContractPolicy[] | null }

export interface LoanDetail {
    account: LoanAccount;
    productCode: string;
    productVersionStatus: string;
    agreementVersion: number;
    agreementVersions: AgreementVersion[];
    schedule: LoanScheduleLine[];
    events: FinancialEvent[];
    tasks: ApprovalTask[];
    /** Card, BNPL or lease behaviour on this loan (LT-07, LT-11, LT-15). */
    specialised?: { kind: 'CARD'; cardId: string | null } | { kind: 'BNPL' } | { kind: 'LEASE'; structure: string } | { kind: 'PROJECT_FINANCE' } | { kind: 'TRADE'; direction: 'IMPORT' | 'EXPORT' } | { kind: 'MURABAHA' } | { kind: 'INCOME_CONTINGENT' } | { kind: 'INSTITUTIONAL' } | null;
}

export interface SettlementQuote {
    asOf: LocalDate; currency: string; principal: Money; interest: Money; fees: Money; penalties: Money;
    settlementFee: Money; total: Money; payable: Money; roundingDifference: Money;
    /** Lock-in tier or base fee that set the settlement fee (UC-32). */
    settlementFeeExplanation?: string;
    /** Money held on advance that goes towards the payoff (UC-27). */
    advanceApplied?: Money;
    /** Rule of 78 / actuarial rebate on precomputed interest (UC-33). */
    interestRebate?: { method: string; rebate: Money; explanation: string };
    /** Murabaha: profit owed on settlement after any ibra'. */
    murabaha?: { unearnedProfit: Money; ibra: Money; profitOwed: Money; explanation: string };
}

/* ── Ops ──────────────────────────────────────────────────────────────────── */

export interface TrialBalance {
    currency: string;
    rows: { code: string; name: string; type: string; debit: Money; credit: Money; balance: Money }[];
    totals: { debit: Money; credit: Money; balanced: boolean };
}

export interface Reconciliation {
    accountsChecked: number;
    breaks: { loanAccountId: string; reference: string; check: string; subledger?: Money; ledger?: Money; schedule?: Money; difference?: Money; detail?: string }[];
    trialBalanceBalanced: boolean;
    checkedAt: string;
}

export interface JournalEntry {
    id: string; entryDate: string; currency: string; description: string;
    event: { type: string; status: string } | null; lines: JournalLine[]; loanAccountId?: string | null;
}

export interface AuditRecord {
    id: string; actorId: string | null; actorType: string; action: string; resourceType: string; resourceId: string | null;
    outcome: string; decision: { allowed?: boolean; checks?: DecisionCheck[] } | null; details: unknown; configVersions: unknown;
    businessDate: string | null; eventTime: string;
}

export interface Paged<T> { data: T[]; total: number }

/* ── Restructuring ────────────────────────────────────────────────────────── */

export interface ExtraDue { interest: Money; fees: Money; penalties: Money; taxes: Money }

export interface BalanceSnapshot {
    asOf: LocalDate; currency: string; principal: Money; overduePrincipal: Money; overdueInterest: Money; accruedInterestNotDue: Money;
    fees: Money; penalties: Money; taxes: Money; unallocatedPayments: Money;
}

export interface ProposedLine {
    number: number; periodStart: LocalDate; periodEnd: LocalDate; dueDate: LocalDate; openingPrincipal: Money; principal: Money;
    interest: Money; capitalizedInterest: Money; annualRate: Money; deferred: ExtraDue; total: Money;
}

export interface RestructureCalculation {
    newPrincipal: Money;
    components: {
        waived: { interest: Money; fees: Money; penalties: Money; futureInterest: Money };
        capitalized: { interest: Money; fees: Money; penalties: Money };
        forgiven: Money;
        principalPaidAtRestructure: Money;
        deferred: ExtraDue;
        payableAtEffectiveDate: ExtraDue;
    };
    lines: ProposedLine[];
    termSolution: { method: string; instalments: number; detail: string } | null;
    concessionValue: { rateReduction: Money; futureInterestWaived: Money; total: Money };
    explanation: string[];
    schedule: ScheduleResult;
    policyExceptions?: string[];
}

export interface RestructureComparison {
    original: { instalment: Money | null; maturityDate: LocalDate | null; totalFuturePayments: Money; totalFutureInterestAndCharges: Money; balloon: Money };
    proposed: { instalment: Money | null; maturityDate: LocalDate; totalFuturePayments: Money; totalFutureInterestAndCharges: Money; balloon: Money; payableAtEffectiveDate: Money };
    capitalized: Money;
    waived: Money;
    forgiven: Money;
    lowerInstalmentHigherCost: boolean;
    warnings: string[];
}

export interface RestructureOptions {
    effectiveDate: LocalDate;
    numberOfInstalments?: number;
    targetInstalment?: Money;
    annualRate?: Money;
    temporaryRate?: { annualRate: Money; instalments: number };
    interestOnlyInstalments?: number;
    paymentDeferralInstalments?: number;
    deferredInterestTreatment?: 'PAY_SEPARATELY' | 'DEFER_NO_CAPITALIZATION' | 'CAPITALIZE' | 'WAIVE';
    capitalize?: { overdueInterest?: boolean; accruedInterest?: boolean; fees?: boolean; penalties?: boolean };
    arrearsTreatment?: 'PAY_AT_EFFECTIVE_DATE' | 'SPREAD_OVER_TERM';
    waive?: { interest?: Money; fees?: Money; penalties?: Money };
    principalForgiveness?: Money;
    principalPaymentAtRestructure?: Money;
    method?: 'EQUAL_INSTALMENT' | 'EQUAL_PRINCIPAL' | 'BALLOON';
    frequency?: string;
    balloonAmount?: Money;
    firstDueDate?: LocalDate;
    explicitSchedule?: { dueDate: LocalDate; principal: Money }[];
}

export interface RestructureSimulation {
    simulation?: boolean;
    note?: string;
    snapshot: BalanceSnapshot;
    calculation: RestructureCalculation;
    comparison: RestructureComparison;
    affordability: { fits: boolean | null; message: string };
    usedOptions: string[] | { options: string[]; flags: string[] };
    requiredFlags: string[];
    policyExceptions: string[];
    concessions: unknown;
}

export interface AffordabilityResultView {
    availableForThisLoanMonthly: Money | null;
    seasonalCapacity: { month: LocalDate; surplus: Money; available: Money }[] | null;
    sustainable: boolean;
    specialistReview: boolean;
    lines: { label: string; amount: Money }[];
    dscr: string | null;
    excludedDebts?: string[];
    explanation: string[];
}

export interface RestructureApproval { id: string; approverId?: string; actorId?: string; decision?: string; note?: string | null; level?: number; createdAt: string }
export interface RestructureAcceptance { id: string; method: string; channel?: string; evidence?: string | null; proposalHash: string; actorId?: string | null; recordedBy?: string | null; acceptedBy?: string | null; createdAt: string }

export interface RestructureProposal {
    id: string; version: number; status: string; effectiveDate: LocalDate; options: RestructureOptions; snapshot: BalanceSnapshot;
    calculation: RestructureCalculation; comparison: RestructureComparison; concessions: unknown; policyExceptions: string[];
    approvalsRequired: number; proposalHash: string; expiresAt?: string | null;
    approvals: RestructureApproval[]; acceptances: RestructureAcceptance[]; createdAt?: string; makerId?: string;
}

export interface RestructureCaseSummary {
    id: string; reference: string; status: string; trigger: string; hardshipCategory: string; difficultyType: string;
    loanAccountId: string; previousRestructures: number; createdAt: string;
}

export interface RestructureCase extends RestructureCaseSummary {
    customerStatement?: string | null;
    requestedRelief: { lowerInstalment?: Money; longerTermMonths?: number; paymentBreakMonths?: number; note?: string } | null;
    consentRecorded?: boolean; consentReference?: string | null; expectedRecoveryDate?: string | null;
    evidence: { id: string; type: string; description: string; quality: string; documentRef?: string | null; createdAt: string }[];
    assessments: { id: string; template: string; result: AffordabilityResultView; evidenceQuality: string; assumptions: string; verificationDate: string; comments?: string | null; createdAt?: string }[];
    proposals: RestructureProposal[];
    conditions: { code: string; label: string; status: string; note?: string | null }[];
    tasks: { id: string; type: string; dueDate: string; status: string; detail?: unknown }[];
    amendments: { id: string; agreementVersion?: number; effectiveDate?: string; status?: string; createdAt?: string }[];
}

export interface RestructureTask {
    id: string; type: string; dueDate: string; status: string; detail: unknown;
    case: { reference: string; loanAccountId: string; status: string } | null;
}
