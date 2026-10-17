/**
 * Facility types, mirroring apps/api/src/lending/facilities/facilities.service.ts
 * (the `view`, `drawdownView`, `statementView` and `limitChangeView` shapes)
 * and the engine types in packages/shared/src/lending/facility.ts.
 *
 * Money and rates are decimal strings; dates are YYYY-MM-DD unless noted.
 */

export type FacilityType = 'REVOLVING' | 'OVERDRAFT' | 'STAGED_DRAWDOWN';

export const FACILITY_TYPES: FacilityType[] = ['REVOLVING', 'OVERDRAFT', 'STAGED_DRAWDOWN'];
export const FACILITY_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMED_OUT', 'CLOSED', 'CANCELLED'];

export interface FacilitySummary {
    id: string;
    reference: string;
    borrowerId: string;
    facilityType: FacilityType | string;
    currency: string;
    limitAmount: string;
    /** Cumulative amount ever advanced; never reduced by repayment. */
    totalDrawn: string;
    chargesRaised: string;
    status: string;
    availabilityFrom: string | null;
    availabilityTo: string | null;
    maturityDate: string | null;
    createdAt: string;
}

export interface FacilityTranche {
    code: string;
    amount: string;
    availableFrom: string;
    conditions: string[];
}

export interface FacilityTerms {
    type: FacilityType | string;
    currency: string;
    limitAmount: string;
    availabilityStart: string;
    availabilityEnd: string;
    maturityDate: string;
    annualRate: string;
    dayCount: string;
    rounding: unknown;
    minimumDrawdown: string | null;
    maximumDrawdown: string | null;
    commitmentFeeRate: string | null;
    minimumPaymentRate: string | null;
    minimumPaymentFloor: string | null;
    overlimitRate: string | null;
    tranches: FacilityTranche[];
}

export interface FacilityPosition {
    outstanding: string;
    totalDrawn: string;
    totalRepaid: string;
    available: string;
    /** Outstanding ÷ limit, as a decimal fraction. */
    utilization: string;
    overlimit: string;
    releasedTranches: string[];
}

export interface Drawdown {
    id: string;
    facilityId: string;
    sequence: number;
    amount: string;
    currency: string;
    valueDate: string | null;
    trancheCode: string | null;
    purpose: string;
    /** REQUESTED, APPROVED, RELEASED, REJECTED, CANCELLED */
    status: string;
    eventId: string | null;
    requestedBy: string;
    approvedBy: string | null;
    approvedAt: string | null;
    releasedBy: string | null;
    releasedAt: string | null;
    rejectedBy: string | null;
    rejectedAt: string | null;
    rejectionReason: string | null;
    createdAt: string;
}

export interface FacilityCondition {
    id: string;
    trancheCode: string;
    code: string;
    label: string;
    /** PENDING, SATISFIED, WAIVED */
    status: string;
    evidence: string | null;
    satisfiedBy: string | null;
    satisfiedAt: string | null;
    waivedBy: string | null;
    waivedAt: string | null;
    waiverReason: string | null;
    createdAt: string;
}

export interface FacilityStatementRow {
    id: string;
    sequence: number;
    periodStart: string | null;
    /** Exclusive. */
    periodEnd: string | null;
    openingBalance: string;
    drawdowns: string;
    repayments: string;
    interest: string;
    overlimitInterest: string;
    commitmentFee: string;
    closingBalance: string;
    chargesRaised: string;
    minimumPayment: string | null;
    minimumPaymentDue: string | null;
    engineVersion: string;
    createdBy: string;
    createdAt: string;
}

export interface FacilityLimitChange {
    id: string;
    previousLimit: string;
    newLimit: string;
    /** INCREASE, DECREASE, EXTENSION, SUSPENSION, REINSTATEMENT */
    changeType: string;
    reason: string;
    effectiveDate: string | null;
    /** REQUESTED, APPROVED, REJECTED */
    status: string;
    requestedBy: string;
    approvedBy: string | null;
    approvedAt: string | null;
    rejectedBy: string | null;
    rejectedAt: string | null;
    createdAt: string;
}

export interface FacilityDetail {
    facility: FacilitySummary;
    terms: FacilityTerms;
    position: FacilityPosition;
    /** The loan account carrying the drawn balance. */
    loanAccountId: string;
    drawdowns: Drawdown[];
    conditions: FacilityCondition[];
    statements: FacilityStatementRow[];
    limitChanges: FacilityLimitChange[];
}

export interface DrawdownCheck {
    ok: boolean;
    issues: { path: string; message: string }[];
    resulting: FacilityPosition | null;
}

export interface TermOutPlan {
    principal: string;
    effectiveDate: string;
    months: number;
}

export const LIMIT_CHANGE_TYPES = ['INCREASE', 'DECREASE', 'EXTENSION', 'SUSPENSION', 'REINSTATEMENT'];

export const MONEY_RE = /^\d+(\.\d{1,4})?$/;
export const CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{1,47}$/;

export type Can = (code: string) => { allowed: boolean; reason?: string };
