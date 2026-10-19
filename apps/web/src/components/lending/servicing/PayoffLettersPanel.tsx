"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, Empty, ErrorBox, Field, SelectInput, Table, TextInput, td, th } from '../ui';
import { idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import type { SettlementQuote } from '../types';

interface PayoffQuote {
    id: string; reference: string; purpose: 'BORROWER' | 'TAKEOVER'; recipientName: string; recipientReference: string;
    issuedOn: string; expiresOn: string; currency: string; goodThrough: { date: string; payable: string }[]; perDiem: string;
    status: string; settlementEventId: string | null;
}

/** Payoff letters good through a date (UC-31), including takeover quotes for another lender (UC-34). */
export function PayoffLettersPanel({ loanId, can, onDone, onClose }: {
    loanId: string; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const t = useTranslations('LendingServicing.payoffLetters');
    const confirm = useConfirm();
    const list = useApi<PayoffQuote[]>(`/lending/loans/${loanId}/payoff-quotes`);
    const [form, setForm] = useState({ purpose: 'BORROWER', validDays: '10', recipientName: '', recipientReference: '' });
    const [letter, setLetter] = useState<{ reference: string; text: string } | null>(null);
    const [externalReference, setExternalReference] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const issueAllowed = can('loan.repayment.post');

    const issue = async () => {
        const days = Number(form.validDays);
        if (!Number.isInteger(days) || days < 1 || days > 30) { setProblem(t('invalidDays')); return; }
        if (form.purpose === 'TAKEOVER' && form.recipientName.trim().length < 2) { setProblem(t('nameLender')); return; }
        setProblem('');
        const res = await run('issue', () => api.post<PayoffQuote>(`/lending/loans/${loanId}/payoff-quotes`, {
            purpose: form.purpose,
            validDays: days,
            ...(form.recipientName.trim() ? { recipientName: form.recipientName.trim() } : {}),
            ...(form.recipientReference.trim() ? { recipientReference: form.recipientReference.trim() } : {}),
        }));
        if (res) { list.reload(); await view(res.data); }
    };

    const view = async (q: PayoffQuote) => {
        const res = await run(`view-${q.id}`, () => api.get<{ letter: string }>(`/lending/loans/${loanId}/payoff-quotes/${q.id}/letter`));
        if (res) setLetter({ reference: q.reference, text: res.data.letter });
    };

    const settle = async (q: PayoffQuote) => {
        const now = await run(`quote-${q.id}`, () => api.get<SettlementQuote & { businessDate: string }>(`/lending/loans/${loanId}/settlement-quote`));
        if (!now) return;
        const line = q.goodThrough.find((g) => g.date === now.data.businessDate);
        if (!line) { setProblem(t('notGoodOn', { reference: q.reference, date: now.data.businessDate })); return; }
        const ok = await confirm({
            title: t('confirmTitle'),
            message: t('confirmMessage', { currency: q.currency, amount: line.payable, reference: q.reference }),
            confirmLabel: t('settle'),
            variant: 'warning',
        });
        if (!ok) return;
        const body = { amount: line.payable, payoffQuoteId: q.id, ...(externalReference.trim() ? { externalReference: externalReference.trim() } : {}) };
        const res = await run(`settle-${q.id}`, () => api.post(`/lending/loans/${loanId}/settlement`, body, idem(key.keyFor(body))));
        if (res) { key.reset(); onDone(t('settled', { reference: q.reference })); }
    };

    const print = () => {
        if (!letter) return;
        const w = window.open('', '_blank', 'width=720,height=900');
        if (!w) return;
        w.opener = null;
        const pre = w.document.createElement('pre');
        pre.style.font = '13px/1.5 ui-monospace, monospace';
        pre.style.whiteSpace = 'pre-wrap';
        pre.textContent = letter.text;
        w.document.title = letter.reference;
        w.document.body.appendChild(pre);
        w.print();
    };

    return (
        <ActionPanel title={t('title')} onClose={onClose}>
            <div data-tour="payoff-letter-form" className="flex flex-wrap items-end gap-2">
                <Field label={t('for')}>
                    <SelectInput value={form.purpose} onChange={(v) => setForm({ ...form, purpose: v })} options={[{ value: 'BORROWER', label: t('purpose.BORROWER') }, { value: 'TAKEOVER', label: t('purpose.TAKEOVER') }]} />
                </Field>
                <Field label={t('validDays')}><TextInput value={form.validDays} onChange={(v) => setForm({ ...form, validDays: v })} inputMode="numeric" className="w-20" /></Field>
                <Field label={form.purpose === 'TAKEOVER' ? t('acquiringLender') : t('addresseeOptional')}>
                    <TextInput value={form.recipientName} onChange={(v) => setForm({ ...form, recipientName: v })} maxLength={200} className="w-52" />
                </Field>
                <Field label={t('theirReference')}><TextInput value={form.recipientReference} onChange={(v) => setForm({ ...form, recipientReference: v })} maxLength={120} className="w-36" /></Field>
                <Btn variant="primary" onClick={issue} busy={busy === 'issue'} disabled={!issueAllowed.allowed} reason={issueAllowed.reason}>{t('issue')}</Btn>
            </div>
            {problem && <p className="text-[12px] text-red-600">{problem}</p>}

            {list.data && list.data.length === 0 && <Empty>{t('none')}</Empty>}
            {list.data && list.data.length > 0 && (
                <Table>
                    <thead><tr><th className={th}>{t('columns.letter')}</th><th className={th}>{t('columns.for')}</th><th className={th}>{t('columns.goodThrough')}</th><th className={th}>{t('columns.status')}</th><th className={th} /></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {list.data.map((q) => (
                            <tr key={q.id}>
                                <td className={`${td} font-mono`}>{q.reference}</td>
                                <td className={td}>{q.purpose === 'TAKEOVER' ? t('takeover', { name: q.recipientName }) : q.recipientName || t('borrower')}</td>
                                <td className={td}>{t('goodThroughValue', { issuedOn: q.issuedOn, expiresOn: q.expiresOn, currency: q.currency, payable: q.goodThrough[0]?.payable ?? '', perDiem: q.perDiem })}</td>
                                <td className={td}><StatusBadge status={q.status} /></td>
                                <td className={`${td} space-x-2 whitespace-nowrap`}>
                                    <Btn data-tour="payoff-letter-view" size="sm" variant="ghost" onClick={() => view(q)} busy={busy === `view-${q.id}`}>{t('view')}</Btn>
                                    {q.status === 'ISSUED' && (
                                        <Btn data-tour="payoff-settle-letter" size="sm" onClick={() => settle(q)} busy={busy === `settle-${q.id}` || busy === `quote-${q.id}`} disabled={!issueAllowed.allowed} reason={issueAllowed.reason}>{t('settle')}</Btn>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {list.data?.some((q) => q.status === 'ISSUED') && (
                <Field label={t('paymentRef')} hint={t('paymentRefHint')}>
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} className="w-64" />
                </Field>
            )}
            {letter && (
                <div className="rounded-md border border-[#E3E8EE] bg-[#F7FAFC] p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-[13px] font-medium text-[#1A1F36]">{letter.reference}</span>
                        <span className="space-x-2">
                            <Btn size="sm" onClick={print}>{t('print')}</Btn>
                            <Btn size="sm" variant="ghost" onClick={() => setLetter(null)}>{t('hide')}</Btn>
                        </span>
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-[12px] text-[#3C4257]">{letter.text}</pre>
                </div>
            )}
            <ErrorBox error={error ?? list.error} onDismiss={clearError} />
        </ActionPanel>
    );
}
