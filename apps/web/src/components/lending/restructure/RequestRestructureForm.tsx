"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Btn, Checkbox, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import { DIFFICULTY_TYPES, HARDSHIP_CATEGORIES, MONEY_RE, STAFF_TRIGGERS, intOrUndef } from './labels';

/**
 * Staff form to open a restructuring / hardship case on a loan account.
 * Opening a case never changes the loan; it starts an assessment.
 */
export function RequestRestructureForm({ loanId, onCreated, onCancel }: {
    loanId: string; onCreated?: (caseId: string) => void; onCancel?: () => void;
}) {
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
    if (!loanId) problems.push('A loan account id is required.');
    if (needsConsent && !consentRecorded) problems.push('Record that the customer consented to this request.');
    if (needsConsent && consentReference.trim().length === 0) problems.push('Enter the consent reference (form number, call id…).');
    if (lowerInstalment && !MONEY_RE.test(lowerInstalment.trim())) problems.push('Requested instalment must be a decimal amount.');
    if (longerTermMonths && intOrUndef(longerTermMonths) === undefined) problems.push('Longer term must be a whole number of months.');
    if (paymentBreakMonths && (breakN === undefined || breakN > 24)) problems.push('Payment break must be 1–24 months.');

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
            showToast(`Restructure case ${res.data.reference ?? ''} opened`, 'success');
            onCreated?.(res.data.id);
        }
    };

    return (
        <div className="space-y-4">
            <Notice tone="info">Opening a case starts a hardship assessment. Nothing on the loan changes until a proposal is approved, accepted by the customer and executed.</Notice>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Trigger">
                    <SelectInput value={trigger} onChange={setTrigger} options={STAFF_TRIGGERS} />
                </Field>
                <Field label="Hardship category">
                    <SelectInput value={hardshipCategory} onChange={setHardship} options={HARDSHIP_CATEGORIES} />
                </Field>
                <Field label="Difficulty type">
                    <SelectInput value={difficultyType} onChange={setDifficulty} options={DIFFICULTY_TYPES} />
                </Field>
            </div>
            <Field label="Customer statement" hint="In the customer's words, what happened and what they need.">
                <TextArea value={customerStatement} onChange={setStatement} maxLength={2000} />
            </Field>
            <fieldset className="border border-[#E3E8EE] rounded-md p-3 space-y-3">
                <legend className="px-1 text-[12px] font-bold text-[#3C4257]">Relief requested by the customer (optional)</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Lower instalment of" hint="Amount they can afford per instalment">
                        <TextInput value={lowerInstalment} onChange={setLowerInstalment} inputMode="decimal" placeholder="e.g. 150.00" />
                    </Field>
                    <Field label="Longer term (months)">
                        <TextInput value={longerTermMonths} onChange={setLongerTerm} inputMode="numeric" />
                    </Field>
                    <Field label="Payment break (months)" hint="1–24 months">
                        <TextInput value={paymentBreakMonths} onChange={setBreak} inputMode="numeric" />
                    </Field>
                </div>
                <Field label="Note">
                    <TextInput value={reliefNote} onChange={setReliefNote} maxLength={500} />
                </Field>
            </fieldset>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Expected recovery date" hint="When the customer expects their situation to improve">
                    <TextInput type="date" value={expectedRecoveryDate} onChange={setRecovery} />
                </Field>
            </div>
            {needsConsent && (
                <div className="border border-amber-200 bg-amber-50/60 rounded-md p-3 space-y-2">
                    <Checkbox checked={consentRecorded} onChange={setConsent} label="The customer has consented to this restructure request" />
                    <Field label="Consent reference" hint="Signed form number, call recording id, etc.">
                        <TextInput value={consentReference} onChange={setConsentRef} maxLength={120} />
                    </Field>
                </div>
            )}
            {problems.length > 0 && (
                <ul className="text-[12px] text-amber-800 list-disc pl-5 space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn variant="primary" busy={busy === 'request'} disabled={problems.length > 0} reason={problems[0]} onClick={submit}>Open restructure case</Btn>
                {onCancel && <Btn onClick={onCancel}>Cancel</Btn>}
            </div>
        </div>
    );
}

export default RequestRestructureForm;
