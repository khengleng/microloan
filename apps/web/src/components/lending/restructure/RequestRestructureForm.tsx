"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Btn, Checkbox, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import { DIFFICULTY_TYPES, HARDSHIP_CATEGORIES, MONEY_RE, STAFF_TRIGGERS, intOrUndef, useRestructureLabels } from './labels';

/**
 * Staff form to open a restructuring / hardship case on a loan account.
 * Opening a case never changes the loan; it starts an assessment.
 */
export function RequestRestructureForm({ loanId, onCreated, onCancel }: {
    loanId: string; onCreated?: (caseId: string) => void; onCancel?: () => void;
}) {
    const t = useTranslations('LendingRestructure.request');
    const tc = useTranslations('LendingRestructure.common');
    const L = useRestructureLabels();
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [trigger, setTrigger] = useState('STAFF_ON_CUSTOMER_REQUEST');
    const [hardshipCategory, setHardship] = useState('INCOME_REDUCTION');
    const [difficultyType, setDifficulty] = useState('TEMPORARY');
    const [customerStatement, setStatement] = useState('');
    const [lowerInstalment, setLowerInstalment] = useState('');
    const [longerTermMonths, setLongerTerm] = useState('');
    const [paymentBreakMonths, setBreak] = useState('');
    const [reliefNote, setReliefNote] = useState('');
    const [consentRecorded, setConsent] = useState(false);
    const [consentReference, setConsentRef] = useState('');
    const [expectedRecoveryDate, setRecovery] = useState('');

    const needsConsent = trigger === 'STAFF_ON_CUSTOMER_REQUEST';
    const breakN = intOrUndef(paymentBreakMonths);
    const problems: string[] = [];
    if (!loanId) problems.push(t('problems.loan'));
    if (needsConsent && !consentRecorded) problems.push(t('problems.consent'));
    if (needsConsent && consentReference.trim().length === 0) problems.push(t('problems.consentReference'));
    if (lowerInstalment && !MONEY_RE.test(lowerInstalment.trim())) problems.push(t('problems.instalment'));
    if (longerTermMonths && intOrUndef(longerTermMonths) === undefined) problems.push(t('problems.longerTerm'));
    if (paymentBreakMonths && (breakN === undefined || breakN > 24)) problems.push(t('problems.paymentBreak'));

    const submit = async () => {
        const relief = clean({
            lowerInstalment: lowerInstalment.trim(),
            longerTermMonths: intOrUndef(longerTermMonths),
            paymentBreakMonths: breakN,
            note: reliefNote.trim(),
        });
        const body = {
            ...clean({
                trigger,
                hardshipCategory,
                difficultyType,
                customerStatement: customerStatement.trim(),
                consentRecorded: needsConsent ? consentRecorded : undefined,
                consentReference: needsConsent ? consentReference.trim() : undefined,
                expectedRecoveryDate,
            }),
            // Always sent, even when empty: the API requires the object.
            requestedRelief: relief ?? {},
        };
        const res = await run('request', () => api.post<{ id: string; reference?: string }>(`/lending/restructures/loans/${loanId}`, body));
        if (res) {
            showToast(t('toastOpened', { reference: res.data.reference ?? '' }), 'success');
            onCreated?.(res.data.id);
        }
    };

    return (
        <div className="space-y-4">
            <Notice tone="info">{t('notice')}</Notice>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={tc('trigger')}>
                    <SelectInput value={trigger} onChange={setTrigger} options={L.options('trigger', STAFF_TRIGGERS)} />
                </Field>
                <Field label={t('hardshipCategory')}>
                    <SelectInput value={hardshipCategory} onChange={setHardship} options={L.options('hardship', HARDSHIP_CATEGORIES)} />
                </Field>
                <Field label={t('difficultyType')}>
                    <SelectInput value={difficultyType} onChange={setDifficulty} options={L.options('difficulty', DIFFICULTY_TYPES)} />
                </Field>
            </div>
            <Field label={tc('customerStatement')} hint={t('customerStatementHint')}>
                <TextArea value={customerStatement} onChange={setStatement} maxLength={2000} />
            </Field>
            <fieldset className="border border-[#E3E8EE] rounded-md p-3 space-y-3">
                <legend className="px-1 text-[12px] font-bold text-[#3C4257]">{t('reliefLegend')}</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label={t('lowerInstalment')} hint={t('lowerInstalmentHint')}>
                        <TextInput value={lowerInstalment} onChange={setLowerInstalment} inputMode="decimal" placeholder={t('lowerInstalmentPlaceholder')} />
                    </Field>
                    <Field label={t('longerTerm')}>
                        <TextInput value={longerTermMonths} onChange={setLongerTerm} inputMode="numeric" />
                    </Field>
                    <Field label={t('paymentBreak')} hint={t('paymentBreakHint')}>
                        <TextInput value={paymentBreakMonths} onChange={setBreak} inputMode="numeric" />
                    </Field>
                </div>
                <Field label={tc('note')}>
                    <TextInput value={reliefNote} onChange={setReliefNote} maxLength={500} />
                </Field>
            </fieldset>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('expectedRecovery')} hint={t('expectedRecoveryHint')}>
                    <TextInput type="date" value={expectedRecoveryDate} onChange={setRecovery} />
                </Field>
            </div>
            {needsConsent && (
                <div className="border border-amber-200 bg-amber-50/60 rounded-md p-3 space-y-2">
                    <Checkbox checked={consentRecorded} onChange={setConsent} label={t('consentCheckbox')} />
                    <Field label={t('consentReference')} hint={t('consentReferenceHint')}>
                        <TextInput value={consentReference} onChange={setConsentRef} maxLength={120} />
                    </Field>
                </div>
            )}
            {problems.length > 0 && (
                <ul className="text-[12px] text-amber-800 list-disc pl-5 space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn variant="primary" busy={busy === 'request'} disabled={problems.length > 0} reason={problems[0]} onClick={submit}>{t('submit')}</Btn>
                {onCancel && <Btn onClick={onCancel}>{tc('cancel')}</Btn>}
            </div>
        </div>
    );
}

export default RequestRestructureForm;
