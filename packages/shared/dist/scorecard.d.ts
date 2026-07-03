export type Decision = 'APPROVE' | 'REFER' | 'DECLINE';
export interface ScorecardInput {
    bureauGrade?: string | null;
    hasCreditCheck: boolean;
    requireCreditCheck: boolean;
    monthlyIncome?: number | null;
    monthlyExpenses?: number | null;
    installmentAmount: number;
    onTimeInstallments: number;
    lateInstallments: number;
    priorDefaults: number;
    kycStatus: string;
    collateralValue: number;
    principal: number;
    guarantorCount: number;
}
export interface ScoreFactor {
    key: string;
    label: string;
    points: number;
    max: number;
    detail: string;
}
export interface ScorecardResult {
    score: number;
    grade: string;
    decision: Decision;
    dsr: number | null;
    factors: ScoreFactor[];
    reasons: string[];
}
export declare function computeScorecard(input: ScorecardInput): ScorecardResult;
