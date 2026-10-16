"use client";

import { Plus, Trash2 } from 'lucide-react';
import type { RestructureOptions } from '../types';
import { isDecimalString, percentToFraction, todayIso } from '../format';
import { Checkbox, Disclosure, Field, SelectInput, TextInput } from '../ui';
import { MONEY_RE, intOrUndef } from './labels';

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

/** Convert the draft to API options, collecting validation problems. */
export function draftToOptions(d: OptionsDraft): { options: RestructureOptions; problems: string[] } {
    const problems: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveDate)) problems.push('Effective date is required.');
    const moneyFields: [string, string][] = [
        ['Target instalment', d.targetInstalment], ['Waive interest', d.waiveInterest], ['Waive fees', d.waiveFees],
        ['Waive penalties', d.waivePenalties], ['Principal forgiveness', d.principalForgiveness],
        ['Principal payment at restructure', d.principalPaymentAtRestructure], ['Balloon amount', d.balloonAmount],
    ];
    for (const [label, v] of moneyFields) if (v.trim() && !MONEY_RE.test(v.trim())) problems.push(`${label} must be a decimal amount.`);
    const intFields: [string, string, number][] = [
        ['Number of instalments', d.numberOfInstalments, 1200], ['Temporary rate instalments', d.tempRateInstalments, 120],
        ['Interest-only instalments', d.interestOnlyInstalments, 60], ['Payment deferral instalments', d.paymentDeferralInstalments, 24],
    ];
    for (const [label, v, max] of intFields) {
        if (!v.trim()) continue;
        const n = intOrUndef(v);
        if (n === undefined || n > max) problems.push(`${label} must be a whole number 1–${max}.`);
    }
    if (d.annualRatePct.trim() && !isDecimalString(d.annualRatePct)) problems.push('Annual rate must be a percentage like 12.5.');
    if (d.tempRatePct.trim() || d.tempRateInstalments.trim()) {
        if (!isDecimalString(d.tempRatePct) || !intOrUndef(d.tempRateInstalments)) problems.push('Temporary rate needs both a rate (%) and a number of instalments.');
    }
    if (d.method === 'BALLOON' && !d.balloonAmount.trim()) problems.push('Balloon method needs a balloon amount.');
    const sched = d.explicitSchedule.filter((r) => r.dueDate || r.principal);
    if (sched.some((r) => !r.dueDate || !MONEY_RE.test(r.principal.trim()))) problems.push('Each explicit schedule row needs a due date and principal.');

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
                {text('effectiveDate', 'Effective date', undefined, { type: 'date' })}
                {text('numberOfInstalments', 'Number of instalments', 'Remaining term after restructure', { inputMode: 'numeric' })}
                {text('targetInstalment', 'Target instalment', 'Solve the term for this amount', { inputMode: 'decimal' })}
                {text('annualRatePct', 'New annual rate (%)', 'e.g. 12.5 — blank keeps the current rate', { inputMode: 'decimal' })}
                <Field label="Method">
                    <SelectInput value={draft.method} onChange={set('method')} placeholder="Keep current" options={['EQUAL_INSTALMENT', 'EQUAL_PRINCIPAL', 'BALLOON']} />
                </Field>
                <Field label="Frequency">
                    <SelectInput value={draft.frequency} onChange={set('frequency')} placeholder="Keep current" options={['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL']} />
                </Field>
                {draft.method === 'BALLOON' && text('balloonAmount', 'Balloon amount', undefined, { inputMode: 'decimal' })}
                {text('firstDueDate', 'First due date', 'Optional', { type: 'date' })}
            </div>

            <fieldset className="border border-[#E3E8EE] rounded-md p-3 space-y-3">
                <legend className="px-1 text-[12px] font-bold text-[#3C4257]">Payment relief</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {text('paymentDeferralInstalments', 'Payment break (instalments)', '1–24 — nothing due', { inputMode: 'numeric' })}
                    {text('interestOnlyInstalments', 'Interest-only instalments', '1–60', { inputMode: 'numeric' })}
                    {text('tempRatePct', 'Temporary rate (%)', 'Reduced rate for a period', { inputMode: 'decimal' })}
                    {text('tempRateInstalments', '…for instalments', '1–120', { inputMode: 'numeric' })}
                </div>
                <Field label="Interest during the break">
                    <SelectInput value={draft.deferredInterestTreatment} onChange={set('deferredInterestTreatment')} placeholder="Default" options={[
                        { value: 'PAY_SEPARATELY', label: 'Pay separately' },
                        { value: 'DEFER_NO_CAPITALIZATION', label: 'Defer without capitalizing' },
                        { value: 'CAPITALIZE', label: 'Capitalize into principal' },
                        { value: 'WAIVE', label: 'Waive (concession)' },
                    ]} />
                </Field>
            </fieldset>

            <fieldset className="border border-[#E3E8EE] rounded-md p-3 space-y-3">
                <legend className="px-1 text-[12px] font-bold text-[#3C4257]">Arrears & charges</legend>
                <Field label="Arrears treatment">
                    <SelectInput value={draft.arrearsTreatment} onChange={set('arrearsTreatment')} placeholder="Default" options={[
                        { value: 'PAY_AT_EFFECTIVE_DATE', label: 'Customer pays arrears on the effective date' },
                        { value: 'SPREAD_OVER_TERM', label: 'Spread arrears over the new term' },
                    ]} />
                </Field>
                <div>
                    <p className="text-[12px] font-semibold text-[#3C4257] mb-1">Capitalize into principal</p>
                    <div className="flex flex-wrap gap-4">
                        <Checkbox checked={draft.capOverdueInterest} onChange={set('capOverdueInterest')} label="Overdue interest" />
                        <Checkbox checked={draft.capAccruedInterest} onChange={set('capAccruedInterest')} label="Accrued interest" />
                        <Checkbox checked={draft.capFees} onChange={set('capFees')} label="Fees" />
                        <Checkbox checked={draft.capPenalties} onChange={set('capPenalties')} label="Penalties" />
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {text('waiveInterest', 'Waive interest', 'Concession', { inputMode: 'decimal' })}
                    {text('waiveFees', 'Waive fees', undefined, { inputMode: 'decimal' })}
                    {text('waivePenalties', 'Waive penalties', undefined, { inputMode: 'decimal' })}
                    {text('principalForgiveness', 'Principal forgiveness', 'Requires senior approval', { inputMode: 'decimal' })}
                    {text('principalPaymentAtRestructure', 'Principal paid at restructure', 'Lump sum from customer', { inputMode: 'decimal' })}
                </div>
            </fieldset>

            <Disclosure summary={`Explicit principal schedule (${draft.explicitSchedule.length} rows)`}>
                <div className="space-y-2">
                    {draft.explicitSchedule.map((r) => (
                        <div key={r.k} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                            <Field label="Due date"><TextInput type="date" value={r.dueDate} onChange={(v) => updRow(r.k, { dueDate: v })} /></Field>
                            <Field label="Principal"><TextInput value={r.principal} onChange={(v) => updRow(r.k, { principal: v })} inputMode="decimal" /></Field>
                            <button type="button" aria-label="Remove row" className="p-1.5 text-[#697386] hover:text-red-600"
                                onClick={() => onChange({ ...draft, explicitSchedule: draft.explicitSchedule.filter((x) => x.k !== r.k) })}>
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                    <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#635BFF]" disabled={draft.explicitSchedule.length >= 60}
                        onClick={() => onChange({ ...draft, explicitSchedule: [...draft.explicitSchedule, { k: ++seq, dueDate: '', principal: '' }] })}>
                        <Plus size={13} /> Add row
                    </button>
                </div>
            </Disclosure>
        </div>
    );
}
