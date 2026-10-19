"use client";

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { RestructureOptions } from '../types';
import { isDecimalString, percentToFraction, todayIso } from '../format';
import { Checkbox, Disclosure, Field, SelectInput, TextInput } from '../ui';
import { MONEY_RE, intOrUndef, useRestructureLabels } from './labels';

/** Form state for restructure options; every value is a string as typed. */
export interface OptionsDraft {
    effectiveDate: string;
    numberOfInstalments: string;
    targetInstalment: string;
    annualRatePct: string;
    tempRatePct: string;
    tempRateInstalments: string;
    interestOnlyInstalments: string;
    paymentDeferralInstalments: string;
    deferredInterestTreatment: string;
    capOverdueInterest: boolean;
    capAccruedInterest: boolean;
    capFees: boolean;
    capPenalties: boolean;
    arrearsTreatment: string;
    waiveInterest: string;
    waiveFees: string;
    waivePenalties: string;
    principalForgiveness: string;
    principalPaymentAtRestructure: string;
    method: string;
    frequency: string;
    balloonAmount: string;
    firstDueDate: string;
    explicitSchedule: { k: number; dueDate: string; principal: string }[];
}

export function emptyDraft(): OptionsDraft {
    return {
        effectiveDate: todayIso(), numberOfInstalments: '', targetInstalment: '', annualRatePct: '', tempRatePct: '', tempRateInstalments: '',
        interestOnlyInstalments: '', paymentDeferralInstalments: '', deferredInterestTreatment: '', capOverdueInterest: false,
        capAccruedInterest: false, capFees: false, capPenalties: false, arrearsTreatment: '', waiveInterest: '', waiveFees: '',
        waivePenalties: '', principalForgiveness: '', principalPaymentAtRestructure: '', method: '', frequency: '', balloonAmount: '',
        firstDueDate: '', explicitSchedule: [],
    };
}

const money = (v: string) => (v.trim() ? v.trim() : undefined);

/** Translator for the "LendingRestructure" namespace (from useTranslations). */
type Tr = (key: string, values?: Record<string, string | number>) => string;

/** Convert the draft to API options, collecting validation problems (translated with `t`). */
export function draftToOptions(d: OptionsDraft, t: Tr): { options: RestructureOptions; problems: string[] } {
    const problems: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveDate)) problems.push(t('optionsForm.problems.effectiveDate'));
    const moneyFields: [string, string][] = [
        ['targetInstalment', d.targetInstalment], ['waiveInterest', d.waiveInterest], ['waiveFees', d.waiveFees],
        ['waivePenalties', d.waivePenalties], ['principalForgiveness', d.principalForgiveness],
        ['principalPaymentAtRestructure', d.principalPaymentAtRestructure], ['balloonAmount', d.balloonAmount],
    ];
    for (const [k, v] of moneyFields) if (v.trim() && !MONEY_RE.test(v.trim())) problems.push(t('optionsForm.problems.decimal', { field: t(`optionsForm.fields.${k}`) }));
    const intFields: [string, string, number][] = [
        ['numberOfInstalments', d.numberOfInstalments, 1200], ['tempRateInstalmentsName', d.tempRateInstalments, 120],
        ['interestOnlyInstalments', d.interestOnlyInstalments, 60], ['paymentDeferralName', d.paymentDeferralInstalments, 24],
    ];
    for (const [k, v, max] of intFields) {
        if (!v.trim()) continue;
        const n = intOrUndef(v);
        if (n === undefined || n > max) problems.push(t('optionsForm.problems.wholeNumber', { field: t(`optionsForm.fields.${k}`), max }));
    }
    if (d.annualRatePct.trim() && !isDecimalString(d.annualRatePct)) problems.push(t('optionsForm.problems.annualRate'));
    if (d.tempRatePct.trim() || d.tempRateInstalments.trim()) {
        if (!isDecimalString(d.tempRatePct) || !intOrUndef(d.tempRateInstalments)) problems.push(t('optionsForm.problems.tempRate'));
    }
    if (d.method === 'BALLOON' && !d.balloonAmount.trim()) problems.push(t('optionsForm.problems.balloon'));
    const sched = d.explicitSchedule.filter((r) => r.dueDate || r.principal);
    if (sched.some((r) => !r.dueDate || !MONEY_RE.test(r.principal.trim()))) problems.push(t('optionsForm.problems.schedule'));

    const tempN = intOrUndef(d.tempRateInstalments);
    const options: RestructureOptions = {
        effectiveDate: d.effectiveDate,
        numberOfInstalments: intOrUndef(d.numberOfInstalments),
        targetInstalment: money(d.targetInstalment),
        annualRate: d.annualRatePct.trim() && isDecimalString(d.annualRatePct) ? percentToFraction(d.annualRatePct) : undefined,
        temporaryRate: isDecimalString(d.tempRatePct) && tempN
            ? { annualRate: percentToFraction(d.tempRatePct), instalments: tempN }
            : undefined,
        interestOnlyInstalments: intOrUndef(d.interestOnlyInstalments),
        paymentDeferralInstalments: intOrUndef(d.paymentDeferralInstalments),
        deferredInterestTreatment: (d.deferredInterestTreatment || undefined) as RestructureOptions['deferredInterestTreatment'],
        capitalize: {
            overdueInterest: d.capOverdueInterest || undefined, accruedInterest: d.capAccruedInterest || undefined,
            fees: d.capFees || undefined, penalties: d.capPenalties || undefined,
        },
        arrearsTreatment: (d.arrearsTreatment || undefined) as RestructureOptions['arrearsTreatment'],
        waive: { interest: money(d.waiveInterest), fees: money(d.waiveFees), penalties: money(d.waivePenalties) },
        principalForgiveness: money(d.principalForgiveness),
        principalPaymentAtRestructure: money(d.principalPaymentAtRestructure),
        method: (d.method || undefined) as RestructureOptions['method'],
        frequency: d.frequency || undefined,
        balloonAmount: money(d.balloonAmount),
        firstDueDate: d.firstDueDate || undefined,
        explicitSchedule: sched.length ? sched.map((r) => ({ dueDate: r.dueDate, principal: r.principal.trim() })) : undefined,
    };
    return { options, problems };
}

let seq = 0;

/** Controlled editor for restructure options. */
export function OptionsForm({ draft, onChange }: { draft: OptionsDraft; onChange: (d: OptionsDraft) => void }) {
    const t = useTranslations('LendingRestructure.optionsForm');
    const L = useRestructureLabels();
    const set = <K extends keyof OptionsDraft>(k: K) => (v: OptionsDraft[K]) => onChange({ ...draft, [k]: v });
    const text = (k: keyof OptionsDraft, label: string, hint?: string, extra?: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) => (
        <Field label={label} hint={hint}>
            <TextInput {...extra} value={draft[k] as string} onChange={set(k) as (v: string) => void} />
        </Field>
    );
    const updRow = (k: number, patch: Partial<{ dueDate: string; principal: string }>) =>
        onChange({ ...draft, explicitSchedule: draft.explicitSchedule.map((r) => (r.k === k ? { ...r, ...patch } : r)) });

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {text('effectiveDate', t('fields.effectiveDate'), undefined, { type: 'date' })}
                {text('numberOfInstalments', t('fields.numberOfInstalments'), t('hints.numberOfInstalments'), { inputMode: 'numeric' })}
                {text('targetInstalment', t('fields.targetInstalment'), t('hints.targetInstalment'), { inputMode: 'decimal' })}
                {text('annualRatePct', t('fields.annualRate'), t('hints.annualRate'), { inputMode: 'decimal' })}
                <Field label={t('fields.method')}>
                    <SelectInput value={draft.method} onChange={set('method')} placeholder={t('keepCurrent')} options={L.options('method', ['EQUAL_INSTALMENT', 'EQUAL_PRINCIPAL', 'BALLOON'])} />
                </Field>
                <Field label={t('fields.frequency')}>
                    <SelectInput value={draft.frequency} onChange={set('frequency')} placeholder={t('keepCurrent')} options={L.options('frequency', ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'])} />
                </Field>
                {draft.method === 'BALLOON' && text('balloonAmount', t('fields.balloonAmount'), undefined, { inputMode: 'decimal' })}
                {text('firstDueDate', t('fields.firstDueDate'), t('hints.optional'), { type: 'date' })}
            </div>

            <fieldset className="border border-[#E3E8EE] rounded-md p-3 space-y-3">
                <legend className="px-1 text-[12px] font-bold text-[#3C4257]">{t('paymentRelief')}</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {text('paymentDeferralInstalments', t('fields.paymentDeferral'), t('hints.paymentDeferral'), { inputMode: 'numeric' })}
                    {text('interestOnlyInstalments', t('fields.interestOnlyInstalments'), '1–60', { inputMode: 'numeric' })}
                    {text('tempRatePct', t('fields.tempRate'), t('hints.tempRate'), { inputMode: 'decimal' })}
                    {text('tempRateInstalments', t('fields.tempRateInstalments'), '1–120', { inputMode: 'numeric' })}
                </div>
                <Field label={t('fields.deferredInterest')}>
                    <SelectInput value={draft.deferredInterestTreatment} onChange={set('deferredInterestTreatment')} placeholder={t('default')} options={L.options('deferredInterest', [
                        'PAY_SEPARATELY', 'DEFER_NO_CAPITALIZATION', 'CAPITALIZE', 'WAIVE',
                    ])} />
                </Field>
            </fieldset>

            <fieldset className="border border-[#E3E8EE] rounded-md p-3 space-y-3">
                <legend className="px-1 text-[12px] font-bold text-[#3C4257]">{t('arrearsCharges')}</legend>
                <Field label={t('fields.arrearsTreatment')}>
                    <SelectInput value={draft.arrearsTreatment} onChange={set('arrearsTreatment')} placeholder={t('default')} options={L.options('arrears', [
                        'PAY_AT_EFFECTIVE_DATE', 'SPREAD_OVER_TERM',
                    ])} />
                </Field>
                <div>
                    <p className="text-[12px] font-semibold text-[#3C4257] mb-1">{t('capitalize')}</p>
                    <div className="flex flex-wrap gap-4">
                        <Checkbox checked={draft.capOverdueInterest} onChange={set('capOverdueInterest')} label={t('fields.overdueInterest')} />
                        <Checkbox checked={draft.capAccruedInterest} onChange={set('capAccruedInterest')} label={t('fields.accruedInterest')} />
                        <Checkbox checked={draft.capFees} onChange={set('capFees')} label={t('fields.fees')} />
                        <Checkbox checked={draft.capPenalties} onChange={set('capPenalties')} label={t('fields.penalties')} />
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {text('waiveInterest', t('fields.waiveInterest'), t('hints.concession'), { inputMode: 'decimal' })}
                    {text('waiveFees', t('fields.waiveFees'), undefined, { inputMode: 'decimal' })}
                    {text('waivePenalties', t('fields.waivePenalties'), undefined, { inputMode: 'decimal' })}
                    {text('principalForgiveness', t('fields.principalForgiveness'), t('hints.principalForgiveness'), { inputMode: 'decimal' })}
                    {text('principalPaymentAtRestructure', t('fields.principalPaidAtRestructure'), t('hints.principalPaidAtRestructure'), { inputMode: 'decimal' })}
                </div>
            </fieldset>

            <Disclosure summary={t('explicitSchedule', { count: draft.explicitSchedule.length })}>
                <div className="space-y-2">
                    {draft.explicitSchedule.map((r) => (
                        <div key={r.k} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                            <Field label={t('fields.dueDate')}><TextInput type="date" value={r.dueDate} onChange={(v) => updRow(r.k, { dueDate: v })} /></Field>
                            <Field label={t('fields.principal')}><TextInput value={r.principal} onChange={(v) => updRow(r.k, { principal: v })} inputMode="decimal" /></Field>
                            <button type="button" aria-label={t('removeRow')} className="p-1.5 text-[#697386] hover:text-red-600"
                                onClick={() => onChange({ ...draft, explicitSchedule: draft.explicitSchedule.filter((x) => x.k !== r.k) })}>
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                    <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#635BFF]" disabled={draft.explicitSchedule.length >= 60}
                        onClick={() => onChange({ ...draft, explicitSchedule: [...draft.explicitSchedule, { k: ++seq, dueDate: '', principal: '' }] })}>
                        <Plus size={13} /> {t('addRow')}
                    </button>
                </div>
            </Disclosure>
        </div>
    );
}
