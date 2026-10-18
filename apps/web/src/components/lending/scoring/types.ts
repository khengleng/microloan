import type { ApiErrorInfo } from '../useAsync';

/* ── Scorecard definitions (validated by the API) ────────────────────────── */

export type VariableType = 'NUMBER' | 'BOOLEAN' | 'CATEGORY';
export type VariableSource = 'APPLICATION' | 'INTERNAL' | 'BUREAU' | 'OFFICER_VERIFIED' | 'PROVIDER';

export interface ScoreVariable {
    code: string;
    label: string;
    type: VariableType;
    source: VariableSource;
    consent: string | null;
    unit: string | null;
    description: string;
    domain?: string[];
}

export interface Bin { upTo: string | null; points: number; reason: string; omit?: boolean }
export interface CategoryRule { values: string[]; points: number; reason: string; omit?: boolean }
export interface LinearRule { centre: string; weight: string; minPoints: number | null; maxPoints: number | null; reason: string }
export type CharacteristicType = 'BINS' | 'CATEGORIES' | 'LINEAR';

export interface Characteristic {
    code: string;
    label: string;
    group?: string;
    variable: string;
    type: CharacteristicType;
    bins?: Bin[];
    categories?: CategoryRule[];
    linear?: LinearRule;
    missing: { points: number; reason: string; omit?: boolean };
    skipWhen?: { variable: string; equals: boolean };
    adverseReason: { code: string; text: string } | null;
}

export interface GradeBand { grade: string; label: string; minScore: number }

export interface ScorecardDefinition {
    schemaVersion: 1;
    baseScore: number;
    minScore: number;
    maxScore: number;
    adverseReasonCount: number;
    grades: GradeBand[];
    characteristics: Characteristic[];
}

export type VersionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'RETIRED';

export interface ScorecardVersion {
    id: string;
    version: number;
    status: VersionStatus;
    changeSummary: string | null;
    makerId: string;
    checkerId: string | null;
    activatedBy: string | null;
    createdAt: string;
    approvedAt: string | null;
    activatedAt: string | null;
    definition?: ScorecardDefinition;
    definitionHash?: string;
    rejectionReason?: string | null;
}

export interface Scorecard {
    id: string;
    code: string;
    name: string;
    description: string | null;
    templateCode: string | null;
    createdBy: string;
    createdAt: string;
    versions: ScorecardVersion[];
}

export interface ScorecardTemplate { code: string; name: string; description: string; definition: ScorecardDefinition }

export interface ScorecardList {
    scorecards: Scorecard[];
    templates: ScorecardTemplate[];
    variables: ScoreVariable[];
    templateInForce: string[];
}

/* ── Score results ───────────────────────────────────────────────────────── */

export interface CharacteristicResult {
    code: string;
    group: string | null;
    label: string;
    variable: string;
    value: unknown;
    missing: boolean;
    skipped: boolean;
    omitted: boolean;
    points: number;
    maxPoints: number;
    reason: string;
    outcome: string;
}

export interface ScoreResult {
    score: number;
    rawScore: number;
    grade: string;
    gradeLabel: string;
    characteristics: CharacteristicResult[];
    factors: { factor: string; points: number; reason: string }[];
    adverseReasons: { code: string; text: string; characteristic: string; shortfall: number }[];
}

export type ScoreOutcome = 'AUTO_APPROVE' | 'REFER' | 'DECLINE';
export interface CodedMessage { code: string; message: string }

export interface ScoreEvaluation {
    id: string;
    role: 'CHAMPION' | 'CHALLENGER';
    stage: 'APPLICATION' | 'APPROVAL' | 'RESCORE';
    scorecardCode: string;
    version: number;
    source: 'TENANT' | 'TEMPLATE';
    thinFile: boolean;
    score: number;
    grade: string;
    outcome: ScoreOutcome;
    drivesDecision: boolean;
    createdAt: string;
    evaluatedBy: string | null;
    inputs: {
        asOf: string;
        evaluatedAt: string;
        currency: string;
        features: Record<string, { value: unknown; source: string; consentId?: string; evidence?: string; note?: string }>;
    };
    result: ScoreResult;
    strategy: {
        outcome: ScoreOutcome;
        knockouts: CodedMessage[];
        reasons: CodedMessage[];
        declineBelowScore: number | null;
        maxAmount: string | null;
        amountAboveGradeLimit: boolean;
        rateAddOnBps: number | null;
        /** What the customer is told; shown from ApplicationScores.customerExplanation. */
        explanation: { outcome: ScoreOutcome; reasons: CodedMessage[] };
    } | null;
}

export interface ApplicationScores {
    evaluations: ScoreEvaluation[];
    latest: ScoreEvaluation | null;
    challenger: ScoreEvaluation | null;
    customerExplanation: { outcome: string; reasons: CodedMessage[] } | null;
}

/* ── Monitoring ──────────────────────────────────────────────────────────── */

export interface GradeStats {
    grade: string;
    count: number;
    share: string | null;
    minScore: number | null;
    maxScore: number | null;
    outcomes: Partial<Record<ScoreOutcome, number>>;
    approved: number;
    rejected: number;
    approvalRate: string | null;
    matureLoans: number;
    bad: number;
    badRate: string | null;
}

export interface MonitoredVersion {
    scorecardCode: string;
    version: number;
    source: string;
    role: 'CHAMPION' | 'CHALLENGER';
    applications: number;
    averageScore: string | number | null;
    approvalRate: string | null;
    byGrade: GradeStats[];
    discrimination: {
        matureLoans: number;
        goods: number;
        bads: number;
        auc: string | null;
        gini: string | null;
        ks: { ks: string; atScore: number } | null;
    };
    stability: {
        baseline: Record<string, number>;
        recent: Record<string, number>;
        psi: string | null;
        bins: { bin: string; baseline: string | null; recent: string | null; contribution: string | null }[];
    };
}

export interface MonitoringReport {
    asOf: string;
    parameters: {
        badDaysPastDue: number;
        performanceMonths: number;
        baseline: { from: string; to: string };
        recent: { from: string; to: string };
        psiEpsilon: string;
    };
    versions: MonitoredVersion[];
}

/* ── Alternative data ────────────────────────────────────────────────────── */

export type AltRecordKind = 'UTILITY_BILLS' | 'TELCO_STATEMENT' | 'RENT_HISTORY' | 'BUSINESS_CASH_FLOW';

export interface ConsentEntry {
    id: string;
    action: 'GRANT' | 'REVOKE';
    source: string;
    grantId: string | null;
    purpose: string;
    scope: string | null;
    method: string;
    documentId: string | null;
    effectiveAt: string;
    expiresAt: string | null;
    reason: string | null;
    recordedBy: string;
    createdAt: string;
    revoked: boolean;
}

export interface AltRecord {
    id: string;
    kind: AltRecordKind;
    data: Record<string, unknown>;
    periodFrom: string;
    periodTo: string;
    documentId: string;
    document: { id: string; title: string; typeCode: string } | null;
    consentId: string | null;
    status: 'PENDING' | 'VERIFIED' | 'REJECTED';
    note: string | null;
    recordedBy: string;
    verifiedBy: string | null;
    verifiedAt: string | null;
    rejectionReason: string | null;
    createdAt: string;
}

export interface AlternativeData {
    sources: string[];
    kinds: AltRecordKind[];
    inForce: { source: string; grantId: string | null; expiresAt: string | null }[];
    consents: ConsentEntry[];
    records: AltRecord[];
}

export interface ProviderOverview {
    sources: { source: string; capability: string; usable: boolean; reason: 'NOT_CONFIGURED' | 'NO_ADAPTER_IMPLEMENTATION' | null; message: string }[];
    implementedProviders: string[];
    configurations: {
        id: string; source: string; providerCode: string; endpointUrl: string; status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
        makerId: string; checkerId: string | null; credentialsSet: boolean; createdAt: string;
    }[];
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

export const SOURCE_LABELS: Record<string, string> = {
    INTERNAL_BEHAVIOUR: 'Internal repayment behaviour',
    UTILITY_BILLS: 'Utility bills',
    TELCO_STATEMENT: 'Telco statement',
    RENT_HISTORY: 'Rent history',
    BUSINESS_CASH_FLOW: 'Business cash flow',
    SMARTPHONE_DATA: 'Smartphone data',
    TELCO_DATA: 'Telco data (provider)',
    EWALLET_DATA: 'E-wallet data (provider)',
};

export const OUTCOME_LABELS: Record<ScoreOutcome, string> = {
    AUTO_APPROVE: 'Recommend approve',
    REFER: 'Refer',
    DECLINE: 'Recommend decline',
};

export const OUTCOME_CLS: Record<ScoreOutcome, string> = {
    AUTO_APPROVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REFER: 'bg-amber-50 text-amber-800 border-amber-200',
    DECLINE: 'bg-red-50 text-red-700 border-red-200',
};

export function sourceLabel(s: string): string {
    return SOURCE_LABELS[s] ?? s.replace(/_/g, ' ').toLowerCase();
}

export function versionLabel(version: number): string {
    return version === 0 ? 'template' : `v${version}`;
}

export function shortId(id: string | null | undefined): string {
    return id ? id.slice(0, 8) : '—';
}

/** Stability label for a population stability index (decimal string). */
export function psiLabel(psi: string | null): { label: string; cls: string } {
    if (psi === null || psi === undefined) return { label: 'not enough data', cls: 'text-[#697386]' };
    const v = Number(psi);
    if (v < 0.1) return { label: 'stable', cls: 'text-emerald-700' };
    if (v <= 0.25) return { label: 'watch', cls: 'text-amber-700' };
    return { label: 'shifted', cls: 'text-red-700' };
}

/** Server validation issues arrive as {path, message} or {code, message}; ErrorBox shows paths. */
export function withIssuePaths(err: ApiErrorInfo | null): ApiErrorInfo | null {
    if (!err?.issues) return err;
    return {
        ...err,
        issues: err.issues.map((i) => {
            const raw = i as unknown as { path?: unknown; code?: string; message: string };
            const path = Array.isArray(raw.path) ? raw.path.join('.') : typeof raw.path === 'string' ? raw.path : raw.code ?? '';
            return { path, message: raw.message };
        }),
    };
}

export function blankDefinition(): ScorecardDefinition {
    return {
        schemaVersion: 1,
        baseScore: 0,
        minScore: 0,
        maxScore: 1000,
        adverseReasonCount: 4,
        grades: [
            { grade: 'A', label: 'Low risk', minScore: 700 },
            { grade: 'B', label: 'Medium risk', minScore: 550 },
            { grade: 'C', label: 'High risk', minScore: 0 },
        ],
        // At least one characteristic is required; start from affordability.
        characteristics: [
            {
                code: 'AFFORDABILITY',
                label: 'Affordability (debt-service ratio)',
                variable: 'debtServiceRatio',
                type: 'BINS',
                bins: [
                    { upTo: '0.4', points: 100, reason: 'Instalments take {percent}% of income.', omit: false },
                    { upTo: null, points: 0, reason: 'Instalments take {percent}% of income.', omit: false },
                ],
                missing: { points: 0, reason: 'Income unknown.', omit: false },
                adverseReason: null,
            } as Characteristic,
        ],
    };
}

/** Variables a definition reads (characteristics and skip conditions). */
export function variablesUsed(def: ScorecardDefinition | null | undefined): string[] {
    if (!def) return [];
    const out = new Set<string>();
    for (const c of def.characteristics ?? []) {
        if (c.variable) out.add(c.variable);
        if (c.skipWhen?.variable) out.add(c.skipWhen.variable);
    }
    return [...out];
}

/** Drop the rule blocks that do not belong to each characteristic's type before saving. */
export function normaliseDefinition(def: ScorecardDefinition): ScorecardDefinition {
    return {
        ...def,
        characteristics: def.characteristics.map((c) => {
            const { bins, categories, linear, group, skipWhen, ...rest } = c;
            const out: Characteristic = { ...rest };
            if (group) out.group = group;
            if (skipWhen?.variable) out.skipWhen = skipWhen;
            if (c.type === 'BINS') out.bins = bins ?? [];
            if (c.type === 'CATEGORIES') out.categories = categories ?? [];
            if (c.type === 'LINEAR' && linear) out.linear = linear;
            return out;
        }),
    };
}

export function displayValue(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}
