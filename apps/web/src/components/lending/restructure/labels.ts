/** Shared enum labels for restructuring screens. */

import { useTranslations } from 'next-intl';

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

/** Option groups translated under LendingRestructure.options.<group>.<VALUE>. */
export type OptGroup =
    | 'hardship' | 'difficulty' | 'trigger' | 'evidenceType' | 'evidenceQuality' | 'template' | 'taskType'
    | 'method' | 'frequency' | 'deferredInterest' | 'arrears' | 'acceptanceMethod' | 'acceptForm' | 'actorType';

/**
 * Translated enum labels for the restructuring screens. Falls back to the
 * English `label` in `fallback` (or the code with spaces) when no key exists.
 */
export function useRestructureLabels() {
    const t = useTranslations('LendingRestructure.options');
    const ts = useTranslations('Status');
    const label = (group: OptGroup, value: string | null | undefined, fallback?: Opt[]): string => {
        if (!value) return '—';
        const k = `${group}.${value}`;
        if (t.has(k)) return t(k);
        return fallback ? labelOf(fallback, value) : value.replace(/_/g, ' ');
    };
    const options = (group: OptGroup, values: (string | Opt)[]): Opt[] =>
        values.map((v) => {
            const value = typeof v === 'string' ? v : v.value;
            return { value, label: label(group, value, typeof v === 'string' ? undefined : [v]) };
        });
    /** A case / workflow status code via the shared "Status" messages. */
    const status = (s: string | null | undefined): string => (!s ? '—' : ts.has(s) ? ts(s) : s.replace(/_/g, ' '));
    return { label, options, status };
}
