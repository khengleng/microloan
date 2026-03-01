export declare const QuotaLimits: {
    FREE: {
        maxUsers: number;
        maxBorrowers: number;
        maxLoanProducts: number;
        maxLoans: number;
    };
    BASIC: {
        maxUsers: number;
        maxBorrowers: number;
        maxLoanProducts: number;
        maxLoans: number;
    };
    PROFESSIONAL: {
        maxUsers: number;
        maxBorrowers: number;
        maxLoanProducts: number;
        maxLoans: number;
    };
    ENTERPRISE: {
        maxUsers: number;
        maxBorrowers: number;
        maxLoanProducts: number;
        maxLoans: number;
    };
};
export type PlanName = keyof typeof QuotaLimits;
export declare function getQuotaLimits(plan?: string | null): {
    maxUsers: number;
    maxBorrowers: number;
    maxLoanProducts: number;
    maxLoans: number;
} | {
    maxUsers: number;
    maxBorrowers: number;
    maxLoanProducts: number;
    maxLoans: number;
} | {
    maxUsers: number;
    maxBorrowers: number;
    maxLoanProducts: number;
    maxLoans: number;
} | {
    maxUsers: number;
    maxBorrowers: number;
    maxLoanProducts: number;
    maxLoans: number;
};
