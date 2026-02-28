import { InterestMethod } from '@microloan/shared';
export declare class CreateLoanDto {
    borrowerId: string;
    principal: number;
    annualInterestRate: number;
    termMonths: number;
    startDate: string;
    interestMethod: InterestMethod;
    productId?: string;
    creditRatingApplied?: string;
}
export declare class ChangeLoanStatusDto {
    status: 'DRAFT' | 'DISBURSED' | 'CLOSED' | 'DEFAULTED';
}
