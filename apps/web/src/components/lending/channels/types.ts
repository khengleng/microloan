/** Payment channels (UC-16, UC-18, UC-19, UC-21) — shapes returned by /lending/payment-channels and the loan routes. */

export type SettlementChannel = 'MOBILE' | 'QR' | 'WALLET' | 'AGENT';
export type FileChannel = SettlementChannel | 'PAYROLL';
export type LineOutcome = 'POSTED' | 'SUSPENSE' | 'DUPLICATE';

export const SETTLEMENT_CHANNELS: { value: SettlementChannel; label: string }[] = [
    { value: 'MOBILE', label: 'Mobile banking' },
    { value: 'QR', label: 'QR (KHQR)' },
    { value: 'WALLET', label: 'Wallet' },
    { value: 'AGENT', label: 'Agent network' },
];

export const CHANNEL_LABEL: Record<string, string> = {
    ...Object.fromEntries(SETTLEMENT_CHANNELS.map((c) => [c.value, c.label])),
    PAYROLL: 'Payroll',
};

export interface ChannelSettings {
    fxSpreadBps: number;
    fxMaxRateAgeDays: number;
    autoDebitMaxAttempts: number;
    autoDebitRetryDays: number;
}

export interface AdapterState { name: string; real: boolean; usable: boolean }

export interface SettingsView {
    settings: ChannelSettings;
    adapters: { bankDebit: AdapterState; fxRates: AdapterState };
}

export interface ChannelFile {
    id: string;
    kind: 'SETTLEMENT' | 'PAYROLL';
    channel: FileChannel;
    fileName: string;
    employer: string | null;
    period: string | null;
    lineCount: number;
    postedCount: number;
    suspenseCount: number;
    duplicateCount: number;
    totals: Record<string, string>;
    businessDate: string;
    importedBy: string;
    createdAt: string;
}

export interface SuspenseState { reference: string; status: string; remaining: string; matched: string; refunded: string }

export interface ChannelFileLine {
    id: string;
    lineNo: number;
    channelTxnId: string;
    reference: string;
    loanRef: string | null;
    employeeRef: string | null;
    nationalIdHint: string | null;
    payerName: string | null;
    amount: string;
    currency: string;
    valueDate: string;
    outcome: LineOutcome;
    reason: string;
    loanAccountId: string | null;
    loanReference: string | null;
    financialEventId: string | null;
    unidentifiedPaymentId: string | null;
    conflicting: boolean;
    reversed: boolean;
    suspense: SuspenseState | null;
}

export interface FileView { replayed?: boolean; file: ChannelFile; lines: ChannelFileLine[] }

export interface ReconTotals {
    currency: string;
    lines: number;
    duplicates: number;
    fileTotal: string;
    posted: string;
    reversed: string;
    suspenseMatched: string;
    suspenseRefunded: string;
    suspenseOpen: string;
    difference: string;
}

export interface ReconBreak {
    lineId: string;
    fileId: string;
    lineNo: number;
    channelTxnId: string;
    currency: string;
    amount: string;
    kind: 'UNMATCHED_IN_SUSPENSE' | 'REVERSED' | 'CONFLICTING_DUPLICATE';
    detail: string;
}

export interface ChannelRecon {
    channel: FileChannel;
    files: { id: string; fileName: string; kind: string; employer: string | null; period: string | null; createdAt: string }[];
    totals: ReconTotals[];
    breaks: ReconBreak[];
}

export interface ReconciliationView { date: string; channels: ChannelRecon[] }

export interface EmployerSummary {
    employer: string;
    period: string;
    files: { id: string; fileName: string; createdAt: string }[];
    employees: number;
    totals: ReconTotals[];
    breaks: ReconBreak[];
}

export interface Mandate {
    id: string;
    mandateReference: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    consentDate: string;
    status: 'ACTIVE' | 'REVOKED';
    revokedAt: string | null;
    revokeReason: string;
    createdAt: string;
}

export interface DebitAttempt {
    id: string;
    mandateId: string;
    loanAccountId: string;
    dueDate: string;
    attemptNo: number;
    businessDate: string;
    amount: string;
    currency: string;
    adapter: string;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'SUSPENSE';
    failureCode: string | null;
    bankReference: string | null;
    financialEventId: string | null;
    unidentifiedPaymentId: string | null;
    nextRetryDate: string | null;
    detail: string;
    createdAt: string;
    mandateReference?: string;
    loanReference?: string | null;
}

export interface FxConversion {
    amount: string;
    from: string;
    to: string;
    midRate: string;
    bankRate: string;
    spreadBps: number;
    converted: string;
    midValue: string;
    gainLoss: string;
    explanation: string;
}

export interface FxQuote {
    valueDate: string;
    conversion: FxConversion;
    rate: { source: string; rateDate: string; base: string; quote: string; rate: string };
}

/** The CSV a settlement file must follow (also in docs/lending/OPERATIONS.md). */
export const SETTLEMENT_SAMPLE = 'reference,loan_ref,amount,currency,value_date,channel_txn_id,payer_name\nR-1001,LN-260105-ABC123,120.50,USD,2026-02-05,WING-889211,Sok Dara';
export const PAYROLL_SAMPLE = 'employee_ref,national_id,loan_ref,amount\nE-001,010203040,,55.00\nE-002,,LN-260105-ABC123,60.00';
