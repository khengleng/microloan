"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, SelectInput, TextArea, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import { CHANNELS } from './types';
import type { SuspensePayment } from './types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Record money received with no identifiable loan: Dr cash, Cr unidentified suspense. */
export function ReceiptForm({ defaultCurrency, onDone, onClose }: {
    defaultCurrency: string; onDone: (p: SuspensePayment) => void; onClose: () => void;
}) {
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState(defaultCurrency);
    const [valueDate, setValueDate] = useState('');
    const [channel, setChannel] = useState('BANK_TRANSFER');
    const [externalReference, setExternalReference] = useState('');
    const [payerName, setPayerName] = useState('');
    const [narrative, setNarrative] = useState('');
    const [problems, setProblems] = useState<Record<string, string>>({});
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();

    const post = async () => {
        const p: Record<string, string> = {};
        if (!MONEY_RE.test(amount.trim()) || !/[1-9]/.test(amount)) p.amount = 'Enter a positive decimal amount (up to 4 decimals).';
        if (!/^[A-Z]{3}$/.test(currency)) p.currency = 'Three-letter ISO code, e.g. USD.';
        if (externalReference.trim().length < 2) p.externalReference = 'At least 2 characters — the bank or channel reference.';
        setProblems(p);
        if (Object.keys(p).length) return;
        const body = clean({
            amount: amount.trim(), currency, valueDate, channel,
            externalReference: externalReference.trim(), payerName: payerName.trim(), narrative: narrative.trim(),
        });
        const k = key.keyFor(body);
        const res = await run('receive', () => api.post<SuspensePayment>('/lending/suspense', body, idem(k)));
        if (res) {
            key.reset();
            setAmount('');
            setExternalReference('');
            setPayerName('');
            setNarrative('');
            onDone(res.data);
        }
    };

    return (
        <ActionPanel title="Record unidentified receipt" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Amount" error={problems.amount}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" placeholder="0.00" />
                </Field>
                <Field label="Currency" error={problems.currency}>
                    <TextInput value={currency} onChange={(v) => setCurrency(v.toUpperCase())} maxLength={3} className="font-mono" />
                </Field>
                <Field label="Value date" hint="Optional — defaults to the business date (up to 30 days back)">
                    <TextInput type="date" value={valueDate} onChange={setValueDate} />
                </Field>
                <Field label="Channel">
                    <SelectInput value={channel} onChange={setChannel} options={CHANNELS} />
                </Field>
                <Field label="External reference" error={problems.externalReference} hint="Bank / channel transaction reference">
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} />
                </Field>
                <Field label="Payer name" hint="Optional — as shown on the statement">
                    <TextInput value={payerName} onChange={setPayerName} maxLength={120} />
                </Field>
                <Field label="Narrative" hint="Optional — anything that may help identify the loan" className="sm:col-span-2">
                    <TextArea value={narrative} onChange={setNarrative} rows={1} maxLength={500} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">The money is posted to the unidentified-payments suspense account until it is matched to a loan or refunded. Retrying the same receipt reuses its idempotency key.</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'receive'}>Record receipt</Btn>
        </ActionPanel>
    );
}
