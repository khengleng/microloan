export declare enum InterestMethod {
    FLAT = "FLAT",
    REDUCING_BALANCE = "REDUCING_BALANCE"
}
export interface LoanParams {
    principal: number;
    annualInterestRate: number;
    termMonths: number;
    startDate: Date;
    interestMethod: InterestMethod;
}
export interface Installment {
    installmentNumber: number;
    dueDate: Date;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    outstandingPrincipal: number;
}
export declare function calculateRepaymentSchedule(params: LoanParams): Installment[];
