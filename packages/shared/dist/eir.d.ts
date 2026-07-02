export interface KeyFactsInput {
    principal: number;
    /** Cash the borrower actually receives = principal − upfront fees. */
    netDisbursed: number;
    /** Ordered monthly installment totals (principal + interest, incl. any
     *  scheduled fees but excluding contingent penalties). */
    installments: number[];
    nominalAnnualRate: number;
    termMonths: number;
    processingFee?: number;
    adminFee?: number;
    currency?: string;
}
export interface KeyFacts {
    currency: string;
    principal: number;
    netDisbursed: number;
    nominalAnnualRate: number;
    effectiveAnnualRate: number;
    totalPrincipal: number;
    totalInterest: number;
    totalFees: number;
    totalRepayable: number;
    totalCostOfCredit: number;
    installmentCount: number;
    averageInstallment: number;
    firstInstallment: number;
}
/**
 * Monthly internal rate of return solving:
 *   netDisbursed = Σ installment_k / (1 + r)^k
 * NPV(r) is monotonically decreasing in r, so a bisection on [0, hi] converges.
 * Returns the monthly rate (fraction), or 0 when the cash flows are degenerate.
 */
export declare function monthlyIrr(netDisbursed: number, installments: number[]): number;
/** Effective annual interest rate (EIR / APR) as a percentage. */
export declare function computeEir(netDisbursed: number, installments: number[]): number;
export declare function buildKeyFacts(input: KeyFactsInput): KeyFacts;
