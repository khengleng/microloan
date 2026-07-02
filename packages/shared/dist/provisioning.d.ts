export declare enum LoanClassification {
    STANDARD = "STANDARD",
    SPECIAL_MENTION = "SPECIAL_MENTION",
    SUBSTANDARD = "SUBSTANDARD",
    DOUBTFUL = "DOUBTFUL",
    LOSS = "LOSS"
}
export interface ClassificationTier {
    classification: LoanClassification;
    minDaysOverdue: number;
    provisionRate: number;
    label: string;
}
export declare const NBC_CLASSIFICATION_TIERS: ClassificationTier[];
export interface ClassificationResult {
    classification: LoanClassification;
    provisionRate: number;
    daysOverdue: number;
}
/**
 * Classify a loan by its worst (maximum) days-overdue across unpaid installments.
 * A loan with no overdue installments is STANDARD (still carries a 1% general
 * provision per NBC).
 */
export declare function classifyByDaysOverdue(daysOverdue: number): ClassificationResult;
/**
 * Provision amount = outstanding principal × provision rate, rounded to cents.
 * (Provisioning is an accounting estimate; USD-cent rounding is sufficient and
 * currency-agnostic here — the ledger stores the loan's own currency.)
 */
export declare function provisionAmount(outstandingPrincipal: number, provisionRate: number): number;
