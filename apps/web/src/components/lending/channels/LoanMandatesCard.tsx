"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, Table, TextInput, td, tdR, th, thR } from '../ui';
import { useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { useBusinessDate } from '../useBusinessDate';
import { MockBankNotice } from './PaymentChannelsView';
import type { DebitAttempt, Mandate } from './types';

interface MandatesView { mandates: Mandate[]; attempts: DebitAttempt[] }

/**
 * Direct-debit mandates on a loan and the end-of-day collection attempts
 * made under them (UC-16). The account number is shown masked.
 */
export function LoanMandatesCard({ loanId, status, can }: {
    loanId: string; status: string; can: (code: string) => { allowed: boolean; reason?: string };
}) {
    const t = useTranslations('LendingChannels.mandates');
    const { showToast } = useToast();
    const view = useApi<MandatesView>(`/lending/loans/${loanId}/mandates`);
    const [adding, setAdding] = useState(false);
    const [revoking, setRevoking] = useState<string | null>(null);
    const businessDate = useBusinessDate();
    const [form, setForm] = useState({ mandateReference: '', bankCode: '', accountNumber: '', accountName: '', consentDate: businessDate });
    const [reason, setReason] = useState('');
    const { busy, error, run, clearError } = useAction();
    const manage = can('loan.repayment.post');

    const v = view.data;
    const active = v?.mandates.find((m) => m.status === 'ACTIVE');
    const live = status === 'ACTIVE' || status === 'BOOKED';
    const set = (k: keyof typeof form) => (x: string) => setForm((f) => ({ ...f, [k]: x }));

    const add = async () => {
        const res = await run('add', () => api.post(`/lending/loans/${loanId}/mandates`, {
            ...form,
            mandateReference: form.mandateReference.trim(),
            bankCode: form.bankCode.trim(),
            accountNumber: form.accountNumber.trim(),
            accountName: form.accountName.trim(),
        }));
        if (res) {
            showToast(t('recorded'), 'success');
            setAdding(false);
            setForm({ mandateReference: '', bankCode: '', accountNumber: '', accountName: '', consentDate: businessDate });
            view.reload();
        }
    };
    const revoke = async (id: string) => {
        if (reason.trim().length < 3) return;
        const res = await run('revoke', () => api.post(`/lending/loans/${loanId}/mandates/${id}/revoke`, { reason: reason.trim() }));
        if (res) { showToast(t('revoked'), 'success'); setRevoking(null); setReason(''); view.reload(); }
    };

    return (
        <Card
            title={t('title')}
            subtitle={active
                ? t('activeSubtitle', { reference: active.mandateReference, bank: active.bankCode, account: active.accountNumber })
                : t('noActive')}
            actions={live && !active && !adding ? <Btn size="sm" onClick={() => setAdding(true)} disabled={!manage.allowed} reason={manage.reason}>{t('setUp')}</Btn> : undefined}
            bodyClass="p-0"
        >
            {view.error && <div className="p-4"><ErrorBox error={view.error} /></div>}
            {(adding || active) && <MockBankNotice className="p-4 border-b border-[#E3E8EE]" />}
            {adding && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <ActionPanel title={t('newTitle')} onClose={() => { setAdding(false); clearError(); }}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            <Field label={t('mandateReference')}><TextInput value={form.mandateReference} onChange={set('mandateReference')} maxLength={64} /></Field>
                            <Field label={t('bank')}><TextInput value={form.bankCode} onChange={set('bankCode')} maxLength={32} placeholder={t('bankPlaceholder')} /></Field>
                            <Field label={t('accountNumber')}><TextInput value={form.accountNumber} onChange={set('accountNumber')} maxLength={34} /></Field>
                            <Field label={t('accountHolder')}><TextInput value={form.accountName} onChange={set('accountName')} maxLength={120} /></Field>
                            <Field label={t('consentDate')} hint={t('consentHint')}><TextInput type="date" value={form.consentDate} onChange={set('consentDate')} /></Field>
                        </div>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant="primary" onClick={add} busy={busy === 'add'}>{t('record')}</Btn>
                    </ActionPanel>
                </div>
            )}
            {v && v.mandates.length > 0 && (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('colMandate')}</th><th className={th}>{t('colBankAccount')}</th><th className={th}>{t('colHolder')}</th>
                            <th className={th}>{t('colConsent')}</th><th className={th}>{t('colStatus')}</th><th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {v.mandates.map((m) => (
                            <tr key={m.id}>
                                <td className={`${td} font-mono text-[12px]`}>{m.mandateReference}</td>
                                <td className={td}>{m.bankCode} <span className="font-mono">{m.accountNumber}</span></td>
                                <td className={td}>{m.accountName}</td>
                                <td className={td}>{m.consentDate}</td>
                                <td className={td}><StatusBadge status={m.status} />{m.revokeReason && <p className="text-[11px] text-[#697386] mt-0.5">{m.revokeReason}</p>}</td>
                                <td className={td}>
                                    {m.status === 'ACTIVE' && revoking !== m.id && (
                                        <Btn size="sm" variant="danger" onClick={() => setRevoking(m.id)} disabled={!manage.allowed} reason={manage.reason}>{t('revoke')}</Btn>
                                    )}
                                    {revoking === m.id && (
                                        <div className="flex flex-wrap gap-2 items-center">
                                            <TextInput value={reason} onChange={setReason} placeholder={t('reason')} maxLength={500} className="!w-56" />
                                            <Btn size="sm" variant="danger" onClick={() => revoke(m.id)} busy={busy === 'revoke'}>{t('confirm')}</Btn>
                                            <Btn size="sm" variant="ghost" onClick={() => setRevoking(null)}>{t('cancel')}</Btn>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {revoking && <div className="px-4 pb-3"><ErrorBox error={error} onDismiss={clearError} /></div>}
            {v && v.attempts.length > 0 && (
                <div className="border-t border-[#E3E8EE]">
                    <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('attempts')}</p>
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('colDueDate')}</th><th className={th}>{t('colAttempt')}</th><th className={th}>{t('colRunOn')}</th>
                                <th className={thR}>{t('colAmount')}</th><th className={th}>{t('colOutcome')}</th><th className={th}>{t('colNextRetry')}</th><th className={th}>{t('colBankReference')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {v.attempts.map((a) => (
                                <tr key={a.id}>
                                    <td className={td}>{a.dueDate}</td>
                                    <td className={td}>#{a.attemptNo}</td>
                                    <td className={td}>{a.businessDate}</td>
                                    <td className={tdR}><MoneyCell value={a.amount} currency={a.currency} /></td>
                                    <td className={td}>
                                        <StatusBadge status={a.status} />
                                        {a.failureCode && <span className="ml-1 font-mono text-[11px] text-red-700">{a.failureCode}</span>}
                                        {a.detail && <p className="text-[11px] text-[#697386] mt-0.5">{a.detail}</p>}
                                    </td>
                                    <td className={td}>{a.nextRetryDate ?? '—'}</td>
                                    <td className={`${td} font-mono text-[11px]`}>{a.bankReference ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </div>
            )}
            {v && v.mandates.length === 0 && !adding && <Empty>{t('none')}</Empty>}
        </Card>
    );
}
