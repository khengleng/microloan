"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Money received on a loan already written off (UC-70): booked as recovery income; the loan stays written off. */
export function RecoveryPanel({ loanId, currency, can, onDone, onClose }: {
    loanId: string; currency: string; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const [amount, setAmount] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const [note, setNote] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.recovery.post');

    const post = async () => {
        if (!MONEY_RE.test(amount.trim()) || !/[1-9]/.test(amount)) { setProblem('Enter a positive amount.'); return; }
        setProblem('');
        const body = clean({ amount: amount.trim(), externalReference: externalReference.trim(), note: note.trim() });
        const res = await run('recover', () => api.post(`/lending/loans/${loanId}/recoveries`, body, idem(key.keyFor(body))));
        if (res) {
            key.reset();
            onDone('Recovery posted');
        }
    };

    return (
        <ActionPanel title="Record a recovery" onClose={onClose}>
            <p className="text-[12px] text-[#697386]">The balance was written off, so the money is recovery income, attributed against what was written off (principal first). The loan stays written off.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={`Amount (${currency})`} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label="External reference" hint="Optional">
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} />
                </Field>
                <Field label="Note" hint="Optional">
                    <TextInput value={note} onChange={setNote} maxLength={500} />
                </Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'recover'} disabled={!allowed.allowed} reason={allowed.reason}>Post recovery</Btn>
        </ActionPanel>
    );
}
