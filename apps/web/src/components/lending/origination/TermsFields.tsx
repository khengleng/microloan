"use client";

import { useTranslations } from 'next-intl';
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
    downPayment: string;
    promotionCode: string;
    annualNetOperatingIncome: string;
    declaredAnnualIncome: string;
}

export function emptyTermsDraft(disbursementDate: string): TermsDraft {
    return { principal: '', numberOfInstalments: '', disbursementDate, annualRatePct: '', firstDueDate: '', downPayment: '', promotionCode: '', annualNetOperatingIncome: '', declaredAnnualIncome: '' };
}

export function draftFromTerms(t: Partial<Terms> | null | undefined): TermsDraft {
    return {
        principal: t?.principal ?? '',
        numberOfInstalments: t?.numberOfInstalments !== undefined && t?.numberOfInstalments !== null ? String(t.numberOfInstalments) : '',
        disbursementDate: t?.disbursementDate ?? '',
        annualRatePct: t?.annualRate ? shiftDecimal(String(t.annualRate), 2) : '',
        firstDueDate: t?.firstDueDate ?? '',
        downPayment: t?.downPayment ?? '',
        promotionCode: t?.promotionCode ?? '',
        annualNetOperatingIncome: t?.financials?.annualNetOperatingIncome ?? '',
        declaredAnnualIncome: t?.declaredAnnualIncome ?? '',
    };
}

/** Client-side checks; returns a list of problems (empty = OK). `t` is the LendingOrigination translator. */
export function validateTerms(d: TermsDraft, t: (k: string, v?: Record<string, string | number>) => string): string[] {
    const errs: string[] = [];
    if (!/^\d+(\.\d{1,4})?$/.test(d.principal.trim())) errs.push(t('terms.errPrincipal'));
    if (d.numberOfInstalments && !/^\d+$/.test(d.numberOfInstalments.trim())) errs.push(t('terms.errInstalments'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.disbursementDate)) errs.push(t('terms.errDisbursementDate'));
    if (d.annualRatePct && !isDecimalString(d.annualRatePct)) errs.push(t('terms.errRate'));
    if (d.downPayment && !/^\d+(\.\d{1,4})?$/.test(d.downPayment.trim())) errs.push(t('terms.errDownPayment'));
    if (d.declaredAnnualIncome && !/^\d+(\.\d{1,4})?$/.test(d.declaredAnnualIncome.trim())) errs.push(t('terms.errDeclaredIncome'));
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
        downPayment: d.downPayment.trim() || undefined,
        promotionCode: d.promotionCode.trim() || undefined,
        financials: d.annualNetOperatingIncome.trim()
            ? { ...(base?.financials ?? {}), annualNetOperatingIncome: d.annualNetOperatingIncome.trim() }
            : base?.financials,
        declaredAnnualIncome: d.declaredAnnualIncome.trim() || undefined,
    } as Terms;
}

export function TermsFields({ value, onChange, currency }: { value: TermsDraft; onChange: (v: TermsDraft) => void; currency?: string }) {
    const t = useTranslations('LendingOrigination');
    const set = (k: keyof TermsDraft) => (v: string) => onChange({ ...value, [k]: v });
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label={currency ? t('terms.principalIn', { currency }) : t('terms.principal')}>
                <TextInput value={value.principal} onChange={set('principal')} inputMode="decimal" placeholder="10000.00" />
            </Field>
            <Field label={t('terms.instalments')} hint={t('terms.instalmentsHint')}>
                <TextInput value={value.numberOfInstalments} onChange={set('numberOfInstalments')} inputMode="numeric" />
            </Field>
            <Field label={t('terms.annualRate')} hint={t('terms.annualRateHint')}>
                <TextInput value={value.annualRatePct} onChange={set('annualRatePct')} inputMode="decimal" />
            </Field>
            <Field label={t('terms.disbursementDate')}>
                <TextInput type="date" value={value.disbursementDate} onChange={set('disbursementDate')} />
            </Field>
            <Field label={t('terms.firstDueDate')} hint={t('common.optional')}>
                <TextInput type="date" value={value.firstDueDate} onChange={set('firstDueDate')} />
            </Field>
            <Field label={currency ? t('terms.downPaymentIn', { currency }) : t('terms.downPayment')} hint={t('terms.downPaymentHint')}>
                <TextInput value={value.downPayment} onChange={set('downPayment')} inputMode="decimal" />
            </Field>
            <Field label={t('terms.promotionCode')} hint={t('terms.promotionCodeHint')}>
                <TextInput value={value.promotionCode} onChange={set('promotionCode')} maxLength={40} />
            </Field>
            <Field label={t('terms.noi')} hint={t('terms.noiHint')}>
                <TextInput value={value.annualNetOperatingIncome} onChange={set('annualNetOperatingIncome')} inputMode="decimal" />
            </Field>
            <Field label={t('terms.declaredIncome')} hint={t('terms.declaredIncomeHint')}>
                <TextInput value={value.declaredAnnualIncome} onChange={set('declaredAnnualIncome')} inputMode="decimal" />
            </Field>
        </div>
    );
}
