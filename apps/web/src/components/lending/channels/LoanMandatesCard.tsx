"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, Table, TextInput, td, tdR, th, thR } from '../ui';
import { useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { todayIso } from '../format';
import type { DebitAttempt, Mandate } from './types';

interface MandatesView { mandates: Mandate[]; attempts: DebitAttempt[] }

/**
 * Direct-debit mandates on a loan and the end-of-day collection attempts
 * made under them (UC-16). The account number is shown masked.
 */
export function LoanMandatesCard({ loanId, status, can }: {
    loanId: string; status: string; can: (code: string) => { allowed: boolean; reason?: string };
}) {
    const { showToast } = useToast();
    const view = useApi<MandatesView>(`/lending/loans/${loanId}/mandates`);
    const [adding, setAdding] = useState(false);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [form, setForm] = useState({ mandateReference: '', bankCode: '', accountNumber: '', accountName: '', consentDate: todayIso() });
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
            showToast('Mandate recorded — instalments will be collected on their due dates', 'success');
            setAdding(false);
            setForm({ mandateReference: '', bankCode: '', accountNumber: '', accountName: '', consentDate: todayIso() });
            view.reload();
        }
    };
    const revoke = async (id: string) => {
        if (reason.trim().length < 3) return;
        const res = await run('revoke', () => api.post(`/lending/loans/${loanId}/mandates/${id}/revoke`, { reason: reason.trim() }));
        if (res) { showToast('Mandate revoked', 'success'); setRevoking(null); setReason(''); view.reload(); }
    };

    return (
        <Card
            title="Auto-debit"
            subtitle={active
                ? `Mandate ${active.mandateReference}: ${active.bankCode} ${active.accountNumber} — collected by end of day on each due date.`
                : 'No active mandate: instalments are paid by the borrower.'}
            actions={live && !active && !adding ? <Btn size="sm" onClick={() => setAdding(true)} disabled={!manage.allowed} reason={manage.reason}>Set up mandate</Btn> : undefined}
            bodyClass="p-0"
        >
            {view.error && <div className="p-4"><ErrorBox error={view.error} /></div>}
            {adding && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <ActionPanel title="New direct-debit mandate" onClose={() => { setAdding(false); clearError(); }}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            <Field label="Mandate reference"><TextInput value={form.mandateReference} onChange={set('mandateReference')} maxLength={64} /></Field>
                            <Field label="Bank"><TextInput value={form.bankCode} onChange={set('bankCode')} maxLength={32} placeholder="e.g. ABA" /></Field>
                            <Field label="Account number"><TextInput value={form.accountNumber} onChange={set('accountNumber')} maxLength={34} /></Field>
                            <Field label="Account holder"><TextInput value={form.accountName} onChange={set('accountName')} maxLength={120} /></Field>
                            <Field label="Consent date" hint="When the borrower signed"><TextInput type="date" value={form.consentDate} onChange={set('consentDate')} /></Field>
                        </div>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant="primary" onClick={add} busy={busy === 'add'}>Record mandate</Btn>
                    </ActionPanel>
                </div>
            )}
            {v && v.mandates.length > 0 && (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>Mandate</th><th className={th}>Bank / account</th><th className={th}>Holder</th>
                            <th className={th}>Consent</th><th className={th}>Status</th><th className={th}></th>
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
                                        <Btn size="sm" variant="danger" onClick={() => setRevoking(m.id)} disabled={!manage.allowed} reason={manage.reason}>Revoke</Btn>
                                    )}
                                    {revoking === m.id && (
                                        <div className="flex flex-wrap gap-2 items-center">
                                            <TextInput value={reason} onChange={setReason} placeholder="Reason" maxLength={500} className="!w-56" />
                                            <Btn size="sm" variant="danger" onClick={() => revoke(m.id)} busy={busy === 'revoke'}>Confirm</Btn>
                                            <Btn size="sm" variant="ghost" onClick={() => setRevoking(null)}>Cancel</Btn>
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
                    <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">Collection attempts</p>
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Due date</th><th className={th}>Attempt</th><th className={th}>Run on</th>
                                <th className={thR}>Amount</th><th className={th}>Outcome</th><th className={th}>Next retry</th><th className={th}>Bank reference</th>
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
            {v && v.mandates.length === 0 && !adding && <Empty>No mandates on this loan.</Empty>}
        </Card>
    );
}
