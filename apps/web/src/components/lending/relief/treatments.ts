import type { InterestTreatment, TermTreatment } from './types';

/**
 * Mirrors the engine's `describeHolidayCost` (packages/shared/src/lending/payment-holiday.ts).
 * Only WAIVE costs the borrower nothing; CAPITALIZE grows the debt.
 */
export const INTEREST_TREATMENTS: { value: InterestTreatment; label: string; costsBorrower: boolean; tone: 'success' | 'warn' | 'danger'; summary: string }[] = [
    {
        value: 'WAIVE',
        label: 'Waive',
        costsBorrower: false,
        tone: 'success',
        summary: 'Interest arising during the holiday is waived; the borrower pays nothing for it. The lender bears the cost.',
    },
    {
        value: 'DEFER_NO_CAPITALIZATION',
        label: 'Defer, no capitalization',
        costsBorrower: true,
        tone: 'warn',
        summary: 'Interest becomes payable later without bearing further interest.',
    },
    {
        value: 'PAY_SEPARATELY',
        label: 'Pay separately',
        costsBorrower: true,
        tone: 'warn',
        summary: 'Interest remains payable during the holiday; only principal is deferred.',
    },
    {
        value: 'CAPITALIZE',
        label: 'Capitalize',
        costsBorrower: true,
        tone: 'danger',
        summary: 'Interest is added to the principal and bears interest from then on, so the holiday increases what is owed.',
    },
];

export const TERM_TREATMENTS: { value: TermTreatment; label: string; summary: string }[] = [
    {
        value: 'EXTEND_TERM',
        label: 'Extend term',
        summary: 'The skipped payments are added to the end: the loan matures as many periods later.',
    },
    {
        value: 'KEEP_MATURITY',
        label: 'Keep maturity',
        summary: 'The maturity date holds; the skipped payments are absorbed into higher instalments afterwards — relief now, a heavier burden later.',
    },
];

export function treatmentOf(v: string) {
    return INTEREST_TREATMENTS.find((t) => t.value === v);
}

export function termOf(v: string) {
    return TERM_TREATMENTS.find((t) => t.value === v);
}

export const costBadgeCls = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
} as const;
