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
    kind: ReceivablesKind;
    /** Factoring, supply-chain finance and forfaiting only. */
    receivable: Receivable | null;
}

export type ReceivablesKind = 'INVOICE_FINANCE' | 'FACTORING' | 'SUPPLY_CHAIN' | 'FORFAITING';
export type AcknowledgementType = 'DEBTOR_NOTICE' | 'BUYER_APPROVAL' | 'AVAL';

/** What a bought receivable carries beyond the invoice: recourse, fee or discount, acknowledgement. */
export interface Receivable {
    id: string;
    kind: Exclude<ReceivablesKind, 'INVOICE_FINANCE'>;
    recourse: 'FULL' | 'LIMITED' | 'NONE';
    recourseCap: Money | null;
    serviceFee: Money;
    discountRate: string;
    discountDays: number;
    discountAmount: Money;
    discountEarned: Money;
    discountUnearned: Money;
    purchasePrice: Money;
    supplierId: string | null;
    instrumentType: string | null;
    guarantorName: string | null;
    acknowledgementType: AcknowledgementType;
    acknowledgementMethod: string | null;
    acknowledgementReference: string | null;
    acknowledgedAt: string | null;
    defaultedAt: string | null;
    writtenOff: Money;
}

export interface RegisterTerms {
    kind: ReceivablesKind;
    advanceRate: string;
    feeRatePerPeriod: string;
    feePeriodDays: number;
    feeBasis: string;
    recourseGraceDays: number;
    maxInvoiceTenorDays: number;
    recourse: 'FULL' | 'LIMITED' | 'NONE';
    limitedRecourseRate: string | null;
    serviceFeeRate: string;
    discount: { rate: string; dayCountBasis: number; method: string; graceDays: number } | null;
    acknowledgement: { type: AcknowledgementType; required: boolean } | null;
    maxDebtorConcentration: string | null;
    supplierRequired: boolean;
    supplierApprovalRequired: boolean;
    instrumentTypes: string[] | null;
}

export interface TradeSupplier {
    id: string;
    reference: string;
    name: string;
    taxId: string | null;
    bankName: string | null;
    accountNumber: string | null;
    sublimit: Money | null;
    status: string;
    createdBy: string;
    approvedBy: string | null;
    statusReason: string | null;
}

export interface InvoiceRegister {
    facility: { id: string; reference: string; status: string; currency: string; limitAmount: Money; loanAccountId: string; daysPastDue: number };
    kind: ReceivablesKind | null;
    terms: RegisterTerms | null;
    position: { limit?: Money; outstanding: Money; available: Money };
    summary: { invoices: number; advancedOutstanding: Money; feesOutstanding: Money; inRecourse: number; defaulted: number; writtenOff: Money; unearnedDiscount: Money; reserveOwedToBorrower: Money };
    debtors: { name: string; invoices: number; faceOutstanding: Money; advanceOutstanding: Money; shareOfLimit: string; inDefault: number }[];
    suppliers: TradeSupplier[];
    invoices: TradeInvoice[];
}

/** A receivables programme (invoice finance, factoring, supply chain, forfaiting). */
export interface ReceivablesProgramme {
    id: string;
    reference: string;
    kind: ReceivablesKind;
    status: string;
    currency: string;
    limitAmount: Money;
    outstanding: Money;
    daysPastDue: number;
    borrowerName: string | null;
    live: number;
    pending: number;
    inDefault: number;
}

/** How each kind of receivables programme names its parts. */
export const KIND_COPY: Record<ReceivablesKind, { name: string; register: string; counterparty: string; item: string; funding: string; holder: string }> = {
    INVOICE_FINANCE: { name: 'Invoice finance', register: 'Invoice register', counterparty: 'Debtor', item: 'Invoice', funding: 'Advance', holder: 'Borrower' },
    FACTORING: { name: 'Factoring', register: 'Factoring ledger', counterparty: 'Debtor', item: 'Invoice', funding: 'Purchase', holder: 'Seller' },
    SUPPLY_CHAIN: { name: 'Supply-chain finance', register: 'Supply-chain programme', counterparty: 'Supplier', item: 'Supplier invoice', funding: 'Early payment', holder: 'Buyer' },
    FORFAITING: { name: 'Forfaiting', register: 'Forfaiting portfolio', counterparty: 'Obligor', item: 'Instrument', funding: 'Purchase', holder: 'Seller' },
};

export const ACK_COPY: Record<AcknowledgementType, { action: string; done: string; methods: { value: string; label: string }[] }> = {
    DEBTOR_NOTICE: {
        action: 'Record notice to debtor',
        done: 'Debtor notified',
        methods: [
            { value: 'NOTICE_LETTER', label: 'Notice of assignment (letter)' },
            { value: 'EMAIL', label: 'Notice by email' },
            { value: 'DEBTOR_ACKNOWLEDGED', label: 'Debtor acknowledged in writing' },
        ],
    },
    BUYER_APPROVAL: {
        action: 'Record buyer approval',
        done: 'Buyer approved',
        methods: [
            { value: 'BUYER_PORTAL', label: 'Approved in the buyer’s system' },
            { value: 'BUYER_LETTER', label: 'Buyer’s signed confirmation' },
        ],
    },
    AVAL: {
        action: 'Record aval',
        done: 'Avalised',
        methods: [
            { value: 'AVAL_ON_INSTRUMENT', label: 'Aval on the instrument' },
            { value: 'SEPARATE_GUARANTEE', label: 'Separate bank guarantee' },
        ],
    },
};

export interface InvoiceQuote {
    asOf: LocalDate;
    advance: Money;
    paidOutIfFundedToday?: Money | null;
    serviceFee?: Money;
    discount?: Money;
    discountDays?: number;
    holderOwes?: Money | null;
    lenderBears?: Money | null;
    discountEarned?: Money;
    discountUnearned?: Money;
    writtenOff?: Money;
    defaulted?: boolean;
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
    writeOffs: { id: string; status: string; amount: Money; makerId: string; decidedBy: string | null; createdAt: string; payload: { reason?: string } }[];
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

// ── Documentary trade loans (import / export) ──────────────────────────────

export interface TradeTransaction {
    id: string;
    reference: string;
    loanAccountId: string;
    direction: 'IMPORT' | 'EXPORT';
    counterpartyName: string;
    counterpartyCountry: string | null;
    goodsDescription: string;
    currency: string;
    transactionValue: Money;
    cycleStartDate: LocalDate;
    expectedProceedsDate: LocalDate;
    status: string;
    proceedsReceived: Money;
    proceedsApplied: Money;
    proceedsRemitted: Money;
}

export interface TradeDocument {
    id: string;
    code: string;
    label: string;
    required: boolean;
    status: string;
    reference: string | null;
    description: string | null;
    receivedBy: string | null;
    verifiedBy: string | null;
    rejectionReason: string | null;
}

export interface TradeLoanView {
    loan: { id: string; reference: string; status: string; currency: string; bookedPrincipal: Money; principalOutstanding: Money; maturityDate: LocalDate | null; payoff: Money | null };
    terms: { direction: 'IMPORT' | 'EXPORT'; requiredDocuments: string[]; maxTradeCycleDays: number; proceedsGraceDays: number; maxFinancingRatio: string; documentLabels: Record<string, string> };
    businessDate: LocalDate;
    transaction: TradeTransaction | null;
    documents: TradeDocument[];
    proceeds: { id: string; amount: Money; applied: Money; remitted: Money; settled: boolean; payerName: string; externalReference: string | null; remitReference: string | null; valueDate: LocalDate }[];
    checks: {
        documents: { complete: boolean; missing: string[]; unverified: string[] };
        cycle: { ok: boolean; issues: { code: string; message: string }[]; maxFinanceable: Money; latestMaturity: LocalDate; cycleDays: number };
    } | null;
}

export interface TradeLoanList {
    data: (TradeTransaction & { loan: { reference: string; status: string; principalOutstanding: Money; bookedPrincipal: Money }; documentsVerified: number; documents: number })[];
    awaitingTrade: { loanAccountId: string; reference: string; bookedPrincipal: Money; currency: string }[];
}

/** Documents an officer may add beyond the product's checklist. */
export const TRADE_DOCUMENT_CODES: { value: string; label: string }[] = [
    { value: 'COMMERCIAL_INVOICE', label: 'Commercial invoice' },
    { value: 'BILL_OF_LADING', label: 'Bill of lading / air waybill' },
    { value: 'PACKING_LIST', label: 'Packing list' },
    { value: 'INSURANCE_CERTIFICATE', label: 'Insurance certificate' },
    { value: 'CERTIFICATE_OF_ORIGIN', label: 'Certificate of origin' },
    { value: 'CUSTOMS_DECLARATION', label: 'Customs declaration' },
    { value: 'EXPORT_CONTRACT', label: 'Export sales contract / purchase order' },
    { value: 'PROFORMA_INVOICE', label: 'Proforma invoice' },
    { value: 'EXPORT_LICENCE', label: 'Export licence' },
    { value: 'LETTER_OF_CREDIT', label: 'Letter of credit in the exporter’s favour' },
];
