import type { LocalDate, Money } from '../types';

/** An invoice in an invoice-finance register (LT-18, UC-67). */
export interface TradeInvoice {
    id: string;
    reference: string;
    facilityId: string;
    loanAccountId: string;
    debtorName: string;
    debtorReference: string | null;
    invoiceNumber: string;
    currency: string;
    amount: Money;
    issueDate: LocalDate;
    dueDate: LocalDate;
    status: string;
    advanceRate: string;
    feeRatePerPeriod: string;
    feePeriodDays: number;
    recourseGraceDays: number;
    advanceAmount: Money;
    advanceDate: LocalDate | null;
    advanceOutstanding: Money;
    feeRaised: Money;
    feePaid: Money;
    feeOwed: Money;
    collectedFromDebtor: Money;
    collectedFromBorrower: Money;
    reserveHeld: Money;
    reservePaid: Money;
    reserveOwed: Money;
    recourseDate: LocalDate | null;
    registeredBy: string;
    approvedBy: string | null;
    advanceRequestedBy: string | null;
    advanceApprovedBy: string | null;
    rejectionReason: string | null;
}

export interface InvoiceRegister {
    facility: { id: string; reference: string; status: string; currency: string; limitAmount: Money; loanAccountId: string; daysPastDue: number };
    terms: { advanceRate: string; feeRatePerPeriod: string; feePeriodDays: number; feeBasis: string; recourseGraceDays: number; maxInvoiceTenorDays: number } | null;
    position: { limit?: Money; outstanding: Money; available: Money };
    summary: { invoices: number; advancedOutstanding: Money; feesOutstanding: Money; inRecourse: number; reserveOwedToBorrower: Money };
    invoices: TradeInvoice[];
}

export interface InvoiceQuote {
    asOf: LocalDate;
    advance: Money;
    feeToDate: Money;
    feeOwed?: Money;
    advanceOwed?: Money;
    owed: Money;
    surplusIfDebtorPaysInFull?: Money;
    recourseDate: LocalDate | null;
    inRecourse: boolean;
    reserveOwedToBorrower?: Money;
}

export interface InvoiceDetail {
    invoice: TradeInvoice;
    quote: InvoiceQuote;
    facility: { id: string; reference: string; loanAccountId: string };
    collections: { id: string; source: string; amount: Money; feeRaised: Money; toFee: Money; toAdvance: Money; toReserve: Money; valueDate: LocalDate; eventId: string }[];
    reservePayouts: { id: string; status: string; amount: Money; makerId: string; decidedBy: string | null; createdAt: string }[];
}

/** A letter of credit (LT-19, UC-53). */
export interface LetterOfCredit {
    id: string;
    reference: string;
    borrowerId: string;
    productId: string;
    currency: string;
    amount: Money;
    beneficiaryName: string;
    beneficiaryBank: string | null;
    issueDate: LocalDate;
    expiryDate: LocalDate;
    feeAmount: Money;
    status: string;
    drawnAmount: Money;
    releasedAmount: Money;
    undrawn: Money;
    requestedBy: string;
    issuedBy: string | null;
    rejectionReason: string | null;
    closeReason: string | null;
    terms: { conversion?: { productCode: string; numberOfInstalments: number; annualRate: string | null }; feePreview?: { fee: Money; explanation: string } };
}

export interface LcDrawing {
    id: string;
    sequence: number;
    amount: Money;
    documentsReference: string;
    numberOfInstalments: number;
    status: string;
    requestedBy: string;
    approvedBy: string | null;
    paidBy: string | null;
    rejectionReason: string | null;
    loanAccountId: string | null;
    loan: { id: string; reference: string; status: string; principalOutstanding: Money } | null;
}

export interface LcDetail { letterOfCredit: LetterOfCredit; drawings: LcDrawing[]; undrawn: Money }

export const LC_STATUSES = ['REQUESTED', 'ISSUED', 'PARTIALLY_DRAWN', 'FULLY_DRAWN', 'EXPIRED', 'CANCELLED', 'REJECTED'];
