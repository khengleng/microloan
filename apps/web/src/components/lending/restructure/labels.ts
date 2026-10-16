/** Shared enum labels for restructuring screens. */

export type Opt = { value: string; label: string };

export const HARDSHIP_CATEGORIES: Opt[] = [
    { value: 'ILLNESS', label: 'Illness or injury' },
    { value: 'JOB_LOSS', label: 'Job loss' },
    { value: 'INCOME_REDUCTION', label: 'Reduced income' },
    { value: 'BUSINESS_DOWNTURN', label: 'Business downturn' },
    { value: 'DELAYED_HARVEST', label: 'Delayed or failed harvest' },
    { value: 'DISASTER', label: 'Natural disaster' },
    { value: 'FAMILY_EVENT', label: 'Family event (death, birth, wedding…)' },
    { value: 'ARREARS', label: 'Payments already overdue' },
    { value: 'OTHER', label: 'Other' },
];

export const DIFFICULTY_TYPES: Opt[] = [
    { value: 'TEMPORARY', label: 'Temporary — expected to recover' },
    { value: 'PERSISTENT', label: 'Persistent — long-term change' },
];

export const STAFF_TRIGGERS: Opt[] = [
    { value: 'STAFF_ON_CUSTOMER_REQUEST', label: 'Customer asked (staff recording)' },
    { value: 'COLLECTIONS', label: 'Collections referral' },
    { value: 'CREDIT_REVIEW', label: 'Credit review' },
];

export const EVIDENCE_TYPES = ['INCOME', 'EXPENSES', 'DEBTS', 'BUSINESS_CASHFLOW', 'HARVEST_FORECAST', 'MEDICAL', 'EMPLOYMENT', 'OTHER'];
export const EVIDENCE_QUALITY = ['VERIFIED', 'PARTIALLY_VERIFIED', 'SELF_DECLARED'];

export const CASE_STATUSES = [
    'REQUESTED', 'MORE_INFO_REQUIRED', 'AFFORDABILITY_ASSESSED', 'SPECIALIST_REVIEW', 'OPTIONS_PROPOSED', 'APPROVED',
    'CUSTOMER_ACCEPTED', 'CONDITIONS_SATISFIED', 'MONITORING', 'COMPLETED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'REVERSED',
];

export const TERMINAL_STATUSES = ['REJECTED', 'WITHDRAWN', 'EXPIRED', 'REVERSED'];

/** Statuses in which the case is still being worked (before execution). */
export const PRE_EXECUTION_STATUSES = [
    'REQUESTED', 'MORE_INFO_REQUIRED', 'AFFORDABILITY_ASSESSED', 'SPECIALIST_REVIEW', 'OPTIONS_PROPOSED', 'APPROVED',
    'CUSTOMER_ACCEPTED', 'CONDITIONS_SATISFIED',
];

export function labelOf(opts: Opt[], value: string | null | undefined): string {
    if (!value) return '—';
    return opts.find((o) => o.value === value)?.label ?? value.replace(/_/g, ' ');
}

export function shortHash(h: string | null | undefined): string {
    return h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '—';
}

/** Positive whole number string → number, else undefined (counts, not money). */
export function intOrUndef(v: string): number | undefined {
    const t = v.trim();
    if (!/^\d+$/.test(t)) return undefined;
    const n = Number.parseInt(t, 10);
    return n > 0 ? n : undefined;
}

export const MONEY_RE = /^\d+(\.\d{1,4})?$/;
