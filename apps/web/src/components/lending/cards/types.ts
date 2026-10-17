/** Response shapes for /v1/lending/cards (LT-07). Money is always a decimal string. */

type Money = string;
type LocalDate = string;

export interface CardSummary {
    id: string;
    reference: string;
    maskedNumber: string;
    status: string;
    facilityId: string;
    loanAccountId: string;
    purchaseBalance: Money;
    cashBalance: Money;
    planBalance: Money;
    lastStatementTo: LocalDate | null;
    facilityReference?: string;
    limitAmount?: Money;
    currency?: string;
    borrowerId?: string;
}

export interface CardTransaction {
    id: string;
    type: 'PURCHASE' | 'CASH_ADVANCE' | 'PAYMENT' | 'PLAN_CONVERSION' | 'PLAN_BILLING';
    transactionDate: LocalDate;
    amount: Money;
    fee: Money;
    purchaseDelta: Money;
    cashDelta: Money;
    planDelta: Money;
    merchantName: string;
    description: string;
    eventId: string | null;
    planId: string | null;
}

export interface CardStatement {
    id: string;
    sequence: number;
    periodStart: LocalDate;
    periodEnd: LocalDate;
    dueDate: LocalDate;
    purchaseBalance: Money;
    cashBalance: Money;
    planBalance: Money;
    statementBalance: Money;
    purchaseInterest: Money;
    purchaseInterestWaived: Money;
    cashInterest: Money;
    planInterest: Money;
    planPrincipalBilled: Money;
    cashAdvanceFees: Money;
    minimumPayment: Money;
    graceApplied: boolean;
}

export interface CardPlan {
    id: string;
    sourceTransactionId: string;
    principal: Money;
    annualRate: string;
    months: number;
    instalmentAmount: Money;
    billedCount: number;
    principalRemaining: Money;
    status: string;
}

export interface CardDetail {
    card: CardSummary;
    facility: { id: string; reference: string; status: string; limitAmount: Money; currency: string; availabilityFrom: LocalDate | null; availabilityTo: LocalDate | null };
    loanAccountId: string;
    terms: {
        purchaseAnnualRate: string;
        cashAdvanceAnnualRate: string;
        cashAdvanceFeeRate: string | null;
        cashAdvanceFeeMinimum: Money | null;
        cashAdvanceLimitShare: string;
        minimumPaymentRate: string;
        minimumPaymentFloor: Money;
        paymentDueDays: number;
    };
    instalmentPlanTerms: { annualRate: string; minAmount: Money; allowedMonths: number[] } | null;
    position: {
        businessDate: LocalDate;
        purchaseBalance: Money;
        cashBalance: Money;
        planBalance: Money;
        principal: Money;
        interestOwed: Money;
        feesOwed: Money;
        totalOwed: Money;
        available: Money;
        cashAvailable: Money;
        daysPastDue: number;
        lastStatement: {
            statementBalance: Money;
            minimumPayment: Money;
            dueDate: LocalDate;
            paidSinceStatement: Money;
            toPayInFull: Money;
        } | null;
    };
    transactions: CardTransaction[];
    statements: CardStatement[];
    plans: CardPlan[];
}
