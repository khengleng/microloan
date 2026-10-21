"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { ActionPanel, Btn, ErrorBox, Field, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import { localToIso } from '../format';
import { readImage, type Receipt } from './types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/**
 * Record a KHQR payment seen in the lender's bank app or merchant
 * notification. Nothing is posted: another person verifies it (D-160).
 */
export function RecordReceiptForm({ loanId, currency, onDone, onClose }: {
    loanId: string; currency: string; onDone: (r: Receipt) => void; onClose: () => void;
}) {
    const t = useTranslations('LendingQr.record');
    const [amount, setAmount] = useState('');
    const [paidAt, setPaidAt] = useState('');
    const [bankRef, setBankRef] = useState('');
    const [payerName, setPayerName] = useState('');
    const [payerAccount, setPayerAccount] = useState('');
    const [remark, setRemark] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [problems, setProblems] = useState<Record<string, string>>({});
    const { busy, error, run, clearError } = useAction();

    const save = async () => {
        const p: Record<string, string> = {};
        if (!MONEY_RE.test(amount.trim()) || !/[1-9]/.test(amount)) p.amount = t('positiveAmount');
        if (!paidAt) p.paidAt = t('paidAtRequired');
        if (bankRef.replace(/[^0-9a-z]/gi, '').length < 6) p.bankRef = t('bankRefShort');
        setProblems(p);
        if (Object.keys(p).length) return;
        const shot = file ? await readImage(file) : null;
        const body = clean({
            amount: amount.trim(), currency, paidAt: localToIso(paidAt), bankRef: bankRef.trim(),
            payerName: payerName.trim(), payerAccount: payerAccount.trim(), remark: remark.trim(),
            screenshot: shot ? { fileName: file!.name, mimeType: shot.mimeType, contentBase64: shot.base64 } : undefined,
        });
        const res = await run('save', () => api.post<Receipt>(`/lending/loans/${loanId}/khqr-receipts`, body));
        if (res) onDone(res.data);
    };

    return (
        <ActionPanel title={t('title')} onClose={onClose}>
            <p className="text-[12px] text-[#697386]">{t('intro')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label={t('amount', { currency })} error={problems.amount}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" placeholder="0.00" />
                </Field>
                <Field label={t('paidAt')} error={problems.paidAt}>
                    <TextInput type="datetime-local" value={paidAt} onChange={setPaidAt} />
                </Field>
                <Field label={t('bankRef')} hint={t('bankRefHint')} error={problems.bankRef}>
                    <TextInput value={bankRef} onChange={setBankRef} maxLength={120} className="font-mono" />
                </Field>
                <Field label={t('payerName')}><TextInput value={payerName} onChange={setPayerName} maxLength={120} /></Field>
                <Field label={t('payerAccount')}><TextInput value={payerAccount} onChange={setPayerAccount} maxLength={120} /></Field>
                <Field label={t('remark')}><TextInput value={remark} onChange={setRemark} maxLength={500} /></Field>
                <Field label={t('screenshot')} hint={t('screenshotHint')}>
                    <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        className="block text-[13px] text-[#3C4257] file:mr-3 file:rounded file:border file:border-[#E3E8EE] file:bg-white file:px-3 file:py-1 file:text-[12px] file:font-semibold" />
                </Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={save} busy={busy === 'save'}>{t('save')}</Btn>
        </ActionPanel>
    );
}
