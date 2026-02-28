import { InterestMethod } from '@microloan/shared';
declare class CreateLoanPolicyDto {
    creditRating: string;
    interestRate: number;
    minTermMonths?: number;
    maxTermMonths?: number;
    minPrincipal?: number;
    maxPrincipal?: number;
}
export declare class CreateLoanProductDto {
    name: string;
    description?: string;
    interestMethod: InterestMethod;
    isActive?: boolean;
    policies?: CreateLoanPolicyDto[];
}
export {};
