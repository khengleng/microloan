"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import { useTranslations } from 'next-intl';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Money received on a loan already written off (UC-70): booked as recovery income; the loan stays written off. */
export function RecoveryPanel({ loanId, currency, can, onDone, onClose }: {
    loanId: string; currency: string; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const tl = useTranslations('LendingServicing.recovery');
    const [amount, setAmount] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const [note, setNote] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.recovery.post');

    const post = async () => {
        if (!MONEY_RE.test(amount.trim()) || !/[1-9]/.test(amount)) { setProblem(tl('enterAmount')); return; }
        setProblem('');
        const body = clean({ amount: amount.trim(), externalReference: externalReference.trim(), note: note.trim() });
        const res = await run('recover', () => api.post(`/lending/loans/${loanId}/recoveries`, body, idem(key.keyFor(body))));
        if (res) {
            key.reset();
            onDone(tl('done'));
        }
    };

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            <p className="text-[12px] text-[#697386]">{tl('note')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={tl('amount', { currency })} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label={tl('externalReference')} hint={tl('optional')}>
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} />
                </Field>
                <Field label={tl('noteLabel')} hint={tl('optional')}>
                    <TextInput value={note} onChange={setNote} maxLength={500} />
                </Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'recover'} disabled={!allowed.allowed} reason={allowed.reason}>{tl('post')}</Btn>
        </ActionPanel>
    );
}
