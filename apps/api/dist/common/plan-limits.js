"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuotaLimits = void 0;
exports.getQuotaLimits = getQuotaLimits;
exports.QuotaLimits = {
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
function getQuotaLimits(plan) {
    const defaultPlan = 'FREE';
    const planKey = (plan && exports.QuotaLimits[plan] ? plan : defaultPlan);
    return exports.QuotaLimits[planKey];
}
//# sourceMappingURL=plan-limits.js.map