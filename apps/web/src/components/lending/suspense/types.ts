import type { LocalDate, Money } from '../types';

export type SuspenseStatus = 'OPEN' | 'MATCHED' | 'REFUNDED';
export type ReceiptChannel = 'BRANCH_CASH' | 'BANK_TRANSFER' | 'MOBILE' | 'AGENT' | 'PAYROLL' | 'OTHER';

export const SUSPENSE_STATUSES: SuspenseStatus[] = ['OPEN', 'MATCHED', 'REFUNDED'];

export const CHANNELS: { value: ReceiptChannel; label: string }[] = [
    { value: 'BRANCH_CASH', label: 'Branch cash' },
    { value: 'BANK_TRANSFER', label: 'Bank transfer' },
    { value: 'MOBILE', label: 'Mobile money' },
    { value: 'AGENT', label: 'Agent' },
    { value: 'PAYROLL', label: 'Payroll deduction' },
    { value: 'OTHER', label: 'Other' },
];

export interface SuspenseMatch {
    id: string;
    /** MATCH (applied to a loan) or REFUND (returned to the payer). */
    kind: 'MATCH' | 'REFUND' | string;
    loanAccountId: string | null;
    financialEventId: string;
    amount: Money;
    actorId: string;
    reason: string;
    createdAt: string;
}

export interface SuspensePayment {
    id: string;
    reference: string;
    amount: Money;
    remaining: Money;
    currency: string;
    valueDate: LocalDate;
    ageDays: number;
    channel: ReceiptChannel | string;
    externalReference: string;
    payerName: string | null;
    narrative: string;
    status: SuspenseStatus | string;
    receivedBy: string;
    createdAt: string;
    matches: SuspenseMatch[];
    /** A refund proposal waiting for a different user's approval. */
    pendingRefund?: PendingRefund | null;
}

export interface SuspenseList {
    businessDate: LocalDate;
    totals: { open: number; remaining: Money };
    payments: SuspensePayment[];
}

/** A refund proposal (an approval task) awaiting a checker. */
export interface PendingRefund {
    taskId: string;
    amount: Money;
    currency: string;
    reason: string;
    makerId?: string;
}

export type AgeBucket = '0-7' | '8-30' | '31+';

export const AGE_BUCKETS: { key: AgeBucket; label: string; cls: string; dot: string }[] = [
    { key: '0-7', label: '0–7 days', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
    { key: '8-30', label: '8–30 days', cls: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
    { key: '31+', label: '31+ days', cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
];

export function ageBucket(days: number): AgeBucket {
    if (days <= 7) return '0-7';
    if (days <= 30) return '8-30';
    return '31+';
}
