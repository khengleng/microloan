"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, SelectInput, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

export function RepaymentForm({ loanId, currency, can, onDone, onClose }: {
    loanId: string; currency: string; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const [amount, setAmount] = useState('');
    const [valueDate, setValueDate] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const [strategy, setStrategy] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.repayment.post');

    const post = async () => {
        if (!MONEY_RE.test(amount.trim()) || !/[1-9]/.test(amount)) { setProblem('Enter a positive decimal amount (up to 4 decimals).'); return; }
        setProblem('');
        const body = clean({ amount: amount.trim(), valueDate, externalReference: externalReference.trim(), prepaymentStrategy: strategy });
        const k = key.keyFor(body);
        const res = await run('repay', () => api.post(`/lending/loans/${loanId}/repayments`, body, idem(k)));
        if (res) {
            key.reset();
            setAmount('');
            setExternalReference('');
            onDone('Repayment posted');
        }
    };

    return (
        <ActionPanel title="Post repayment" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={`Amount (${currency})`} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label="Value date" hint="Optional — defaults to the business date">
                    <TextInput type="date" value={valueDate} onChange={setValueDate} />
                </Field>
                <Field label="External reference" hint="Optional">
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} />
                </Field>
                <Field label="Prepayment strategy" hint="Applies to any excess over amounts due">
                    <SelectInput
                        value={strategy}
                        onChange={setStrategy}
                        placeholder="Product default"
                        options={[{ value: 'RECAST', label: 'RECAST — lower instalment' }, { value: 'SHORTEN', label: 'SHORTEN — earlier maturity' }]}
                    />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">Retrying the same payment reuses its idempotency key, so a network retry never posts twice.</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'repay'} disabled={!allowed.allowed} reason={allowed.reason}>Post repayment</Btn>
        </ActionPanel>
    );
}
