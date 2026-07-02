// NBC loan classification & loan-loss provisioning.
//
// The National Bank of Cambodia requires lenders to classify their loan
// portfolio by delinquency and hold a loss provision against each class
// (Prakas on asset classification and provisioning). These are the standard
// tiers/rates applied to short-term microfinance loans. Rates are expressed as
// a fraction of outstanding principal (0.01 = 1%).
//
// A tenant may tighten (increase) these rates via configuration but the defaults
// here reflect the regulatory minimum, so provisioning is never understated.
export var LoanClassification;
(function (LoanClassification) {
    LoanClassification["STANDARD"] = "STANDARD";
    LoanClassification["SPECIAL_MENTION"] = "SPECIAL_MENTION";
    LoanClassification["SUBSTANDARD"] = "SUBSTANDARD";
    LoanClassification["DOUBTFUL"] = "DOUBTFUL";
    LoanClassification["LOSS"] = "LOSS";
})(LoanClassification || (LoanClassification = {}));
// Ordered by severity ascending; evaluated from most-severe downward.
export const NBC_CLASSIFICATION_TIERS = [
    { classification: LoanClassification.STANDARD, minDaysOverdue: 0, provisionRate: 0.01, label: 'Standard' },
    { classification: LoanClassification.SPECIAL_MENTION, minDaysOverdue: 15, provisionRate: 0.03, label: 'Special Mention' },
    { classification: LoanClassification.SUBSTANDARD, minDaysOverdue: 31, provisionRate: 0.25, label: 'Substandard' },
    { classification: LoanClassification.DOUBTFUL, minDaysOverdue: 61, provisionRate: 0.5, label: 'Doubtful' },
    { classification: LoanClassification.LOSS, minDaysOverdue: 91, provisionRate: 1.0, label: 'Loss' },
];
/**
 * Classify a loan by its worst (maximum) days-overdue across unpaid installments.
 * A loan with no overdue installments is STANDARD (still carries a 1% general
 * provision per NBC).
 */
export function classifyByDaysOverdue(daysOverdue) {
    const days = Math.max(0, Math.floor(daysOverdue || 0));
    let tier = NBC_CLASSIFICATION_TIERS[0];
    for (const candidate of NBC_CLASSIFICATION_TIERS) {
        if (days >= candidate.minDaysOverdue) {
            tier = candidate;
        }
    }
    return {
        classification: tier.classification,
        provisionRate: tier.provisionRate,
        daysOverdue: days,
    };
}
/**
 * Provision amount = outstanding principal × provision rate, rounded to cents.
 * (Provisioning is an accounting estimate; USD-cent rounding is sufficient and
 * currency-agnostic here — the ledger stores the loan's own currency.)
 */
export function provisionAmount(outstandingPrincipal, provisionRate) {
    const amt = Math.max(0, outstandingPrincipal) * provisionRate;
    return Math.round(amt * 100) / 100;
}
