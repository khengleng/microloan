export const QuotaLimits = {
    FREE: {
        maxUsers: 3,
        maxBorrowers: 50,
        maxLoanProducts: 2,
        maxLoans: 100,
    },
    BASIC: {
        maxUsers: 10,
        maxBorrowers: 500,
        maxLoanProducts: 5,
        maxLoans: 1000,
    },
    PROFESSIONAL: {
        maxUsers: 25,
        maxBorrowers: 2500,
        maxLoanProducts: 15,
        maxLoans: 5000,
    },
    ENTERPRISE: {
        maxUsers: Number.MAX_SAFE_INTEGER,
        maxBorrowers: Number.MAX_SAFE_INTEGER,
        maxLoanProducts: Number.MAX_SAFE_INTEGER,
        maxLoans: Number.MAX_SAFE_INTEGER,
    },
};

export type PlanName = keyof typeof QuotaLimits;

export function getQuotaLimits(plan?: string | null) {
    const defaultPlan: PlanName = 'FREE';
    const planKey = (plan && QuotaLimits[plan as PlanName] ? plan : defaultPlan) as PlanName;
    return QuotaLimits[planKey];
}
