"use client";

import { Field, TextInput } from '../ui';
import { isDecimalString, percentToFraction, shiftDecimal } from '../format';
import type { Terms } from '../types';

/** Editable terms as raw strings (rate entered as a percent). */
export interface TermsDraft {
    principal: string;
    numberOfInstalments: string;
    disbursementDate: string;
    annualRatePct: string;
    firstDueDate: string;
}

export function emptyTermsDraft(disbursementDate: string): TermsDraft {
    return { principal: '', numberOfInstalments: '', disbursementDate, annualRatePct: '', firstDueDate: '' };
}

export function draftFromTerms(t: Partial<Terms> | null | undefined): TermsDraft {
    return {
        principal: t?.principal ?? '',
        numberOfInstalments: t?.numberOfInstalments !== undefined && t?.numberOfInstalments !== null ? String(t.numberOfInstalments) : '',
        disbursementDate: t?.disbursementDate ?? '',
        annualRatePct: t?.annualRate ? shiftDecimal(String(t.annualRate), 2) : '',
        firstDueDate: t?.firstDueDate ?? '',
    };
}

/** Client-side checks; returns a list of problems (empty = OK). */
export function validateTerms(d: TermsDraft): string[] {
    const errs: string[] = [];
    if (!/^\d+(\.\d{1,4})?$/.test(d.principal.trim())) errs.push('Principal must be a decimal amount (up to 4 decimals).');
    if (d.numberOfInstalments && !/^\d+$/.test(d.numberOfInstalments.trim())) errs.push('Number of instalments must be a whole number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.disbursementDate)) errs.push('Disbursement date is required.');
    if (d.annualRatePct && !isDecimalString(d.annualRatePct)) errs.push('Annual rate must be a decimal percent, e.g. 12.5.');
    return errs;
}

/** Build the API `terms` object, keeping fields this form does not edit (grace, balloon, …). */
export function termsFromDraft(d: TermsDraft, base?: Partial<Terms> | null): Terms {
    return {
        ...(base ?? {}),
        principal: d.principal.trim(),
        numberOfInstalments: d.numberOfInstalments.trim() ? Number(d.numberOfInstalments.trim()) : undefined,
        disbursementDate: d.disbursementDate,
        annualRate: d.annualRatePct.trim() ? percentToFraction(d.annualRatePct) : undefined,
        firstDueDate: d.firstDueDate || undefined,
    } as Terms;
}

export function TermsFields({ value, onChange, currency }: { value: TermsDraft; onChange: (v: TermsDraft) => void; currency?: string }) {
    const set = (k: keyof TermsDraft) => (v: string) => onChange({ ...value, [k]: v });
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label={`Principal${currency ? ` (${currency})` : ''}`}>
                <TextInput value={value.principal} onChange={set('principal')} inputMode="decimal" placeholder="10000.00" />
            </Field>
            <Field label="Number of instalments" hint="Optional — product default if blank">
                <TextInput value={value.numberOfInstalments} onChange={set('numberOfInstalments')} inputMode="numeric" />
            </Field>
            <Field label="Annual rate (%)" hint="Optional — e.g. 12.5 for 12.5%">
                <TextInput value={value.annualRatePct} onChange={set('annualRatePct')} inputMode="decimal" />
            </Field>
            <Field label="Disbursement date">
                <TextInput type="date" value={value.disbursementDate} onChange={set('disbursementDate')} />
            </Field>
            <Field label="First due date" hint="Optional">
                <TextInput type="date" value={value.firstDueDate} onChange={set('firstDueDate')} />
            </Field>
        </div>
    );
}
