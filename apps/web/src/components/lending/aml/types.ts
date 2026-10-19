/** Shapes of the AML/CFT API (/lending/aml, DECISIONS D-118…D-122). */

export interface RiskFactor { code: string; present: boolean; weight: number; detail: string }

export interface CaseSummary {
    id: string;
    reference: string;
    status: string;
    topType: string;
    topScore: string;
    disposition: string | null;
    trigger: string;
    createdAt: string;
    decidedAt: string | null;
}

export interface EddRecord {
    id: string;
    reason: string;
    sourceOfFunds: string;
    sourceOfWealth: string;
    documentReference: string;
    documentId: string | null;
    status: string;
    makerId: string;
    checkerId: string | null;
    decidedAt: string | null;
    comment: string;
    createdAt: string;
}

export interface AmlSummary {
    id: string;
    firstName: string;
    lastName: string;
    kycStatus: string;
    amlStatus: string;
    amlStatusChangedAt: string | null;
    amlStatusChangedBy: string | null;
    pep: boolean;
    nationality: string | null;
    occupation: string | null;
    amlRiskRating: string | null;
    amlRiskScore: number | null;
    amlRiskFactors: RiskFactor[] | null;
    amlRiskRatedAt: string | null;
    amlNextReviewOn: string | null;
    reviewDue: boolean;
    amlScreenedAt: string | null;
    eddRequired: boolean;
    cases: CaseSummary[];
    openCase: CaseSummary | null;
    pendingClearance: { taskId: string; proposedBy: string; proposedAt: string; reason: string | null } | null;
    edd: EddRecord[];
    gate: { clear: boolean; reasons: string[] };
    you: { mayScreen: boolean; mayApproveClearance: boolean; mayApproveEdd: boolean; mayDisposition: boolean; mayRaiseStr: boolean };
}

export interface Hit {
    entryId: string;
    entryType: string;
    listCode: string;
    listName: string;
    matchedName: string;
    source: string;
    score: number;
    method: string;
    dobMismatch: boolean;
}

export interface ScreeningCase {
    id: string;
    reference: string;
    borrowerId: string;
    trigger: string;
    screenedName: string;
    hits: Hit[];
    topScore: string;
    topType: string;
    status: string;
    disposition: string | null;
    dispositionNote: string;
    proposedBy: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    createdAt: string;
    borrower?: { id: string; firstName: string; lastName: string; branchId?: string | null; amlStatus: string };
}

export interface WatchListVersion {
    id: string;
    listCode: string;
    version: number;
    name: string;
    fileName: string;
    entryCount: number;
    status: string;
    makerId: string;
    checkerId: string | null;
    decidedAt: string | null;
    reason: string;
    createdAt: string;
}

export interface RescreenJob {
    id: string;
    listVersionId: string;
    status: string;
    screened: number;
    casesOpened: number;
    error: string | null;
    createdAt: string;
    completedAt: string | null;
}

export interface RatingRow {
    id: string;
    firstName: string;
    lastName: string;
    amlStatus: string;
    amlRiskRating: string | null;
    amlRiskScore: number | null;
    pep: boolean;
    amlNextReviewOn: string | null;
    eddRequired: boolean;
    eddStatus: 'APPROVED' | 'PENDING' | 'NONE';
}

export interface CtrGroup {
    borrowerId: string;
    date: string;
    currency: string;
    threshold: string;
    total: string;
    basis: 'SINGLE' | 'AGGREGATED';
    transactions: { id: string; amount: string; direction: 'IN' | 'OUT' }[];
    customer: { name: string; idType: string | null; idNumberHint: string | null; branch: string | null };
}

export interface CtrReport {
    from: string;
    to: string;
    thresholds: Record<string, string>;
    cashChannels: string[];
    groups: CtrGroup[];
    unassessedCurrencies: string[];
    withoutChannel: number;
    cashTransactions: number;
}

export interface StrCase {
    id: string;
    reference: string;
    borrowerId: string;
    loanAccountId: string | null;
    financialEventId: string | null;
    grounds: string;
    indicators: string[];
    raisedBy: string;
    screeningCaseId: string | null;
    status: string;
    reviewNotes: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    cafiuReference: string | null;
    cafiuReportedOn: string | null;
    createdAt: string;
    borrower?: { id: string; firstName: string; lastName: string };
}

/** Mirrors lending.STR_INDICATORS (packages/shared); the API validates against that list. */
export const STR_INDICATORS = [
    'STRUCTURING', 'UNUSUAL_CASH', 'THIRD_PARTY_PAYMENTS', 'UNEXPLAINED_EARLY_REPAYMENT',
    'INCONSISTENT_WITH_PROFILE', 'WATCH_LIST_MATCH', 'IDENTITY_CONCERN', 'OTHER',
] as const;
