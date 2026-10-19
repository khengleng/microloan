"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, Notice, Spinner, Table, TextArea, TextInput, td, tdR } from '../ui';
import { clean, idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { Person } from '../People';

/* GET /lending/loans/:id/cooling-off (D-125). */
interface CoolingOffQuote {
    asOf: string; currency: string; principal: string; interest: string; fees: string; payable: string; advanceApplied: string;
    coolingOff?: { penaltiesWaived: string; interestWaived: string; feesRefunded: string; feeTaxRefunded: string };
    error?: string;
}
interface CoolingOffTask { id: string; status: string; makerId: string; decidedBy?: string | null; payload: { reason?: string; customerReference?: string | null; requestedOn?: string } }
export interface CoolingOffStatus {
    businessDate: string; days: number; disbursementDate: string | null; windowEndsOn: string | null; open: boolean;
    quote: CoolingOffQuote | null; tasks: CoolingOffTask[];
}

/**
 * Cancel a loan inside the cooling-off period (D-125): one person records
 * the customer's request, another approves it, then the customer's repayment
 * of what they received closes the loan — no penalty or settlement charge,
 * the lender's upfront fees refunded.
 */
export function CoolingOffPanel({ loanId, can, onDone, onClose }: {
    loanId: string; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const t = useTranslations('LendingServicing.coolingOff');
    const confirm = useConfirm();
    const status = useApi<CoolingOffStatus>(`/lending/loans/${loanId}/cooling-off`);
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const [reason, setReason] = useState('');
    const [reference, setReference] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const s = status.data;
    const open = s?.tasks.find((x) => x.status === 'PENDING' || x.status === 'APPROVED') ?? null;
    const q = s?.quote && !s.quote.error ? s.quote : null;
    const request = can('loan.cooling_off.request');
    const approve = can('loan.cooling_off.approve');
    const post = can('loan.repayment.post');

    const submit = async () => {
        const res = await run('request', () => api.post(`/lending/loans/${loanId}/cooling-off-cancellations`, clean({ reason: reason.trim(), customerReference: reference.trim() })));
        if (res) { status.reload(); onDone(t('requested')); }
    };
    const decide = async (ok: boolean) => {
        if (!open) return;
        const res = await run(`decide-${ok}`, () => api.post(`/lending/loans/${loanId}/cooling-off-cancellations/${open.id}/decision`, { approve: ok }));
        if (res) { status.reload(); onDone(ok ? t('approved') : t('rejected')); }
    };
    const execute = async () => {
        if (!open || !q) return;
        const ok = await confirm({ title: t('confirmTitle'), message: t('confirm', { amount: q.payable, currency: q.currency }), confirmLabel: t('execute'), variant: 'warning' });
        if (!ok) return;
        const body = clean({ amount: q.payable, externalReference: externalReference.trim() });
        const k = key.keyFor({ ...body, task: open.id });
        const res = await run('execute', () => api.post(`/lending/loans/${loanId}/cooling-off-cancellations/${open.id}/execute`, body, idem(k)));
        if (res) { key.reset(); onDone(t('cancelled')); }
    };

    const rows: [string, string][] = q ? [
        [t('rows.principal'), q.principal],
        [t('rows.interest'), q.interest],
        [t('rows.fees'), q.fees],
        ...(q.coolingOff ? [[t('rows.feesRefunded'), `-${Number(q.coolingOff.feesRefunded) + Number(q.coolingOff.feeTaxRefunded)}`] as [string, string]] : []),
        ...(Number(q.advanceApplied) > 0 ? [[t('rows.lessAdvance'), `-${q.advanceApplied}`] as [string, string]] : []),
        [t('rows.payable'), q.payable],
    ] : [];

    return (
        <ActionPanel title={t('title')} onClose={onClose}>
            {status.loading && !s ? <Spinner /> : status.error ? <ErrorBox error={status.error} /> : s && (
                <div className="space-y-3">
                    {s.days === 0 ? (
                        <Notice tone="info">{t('disabled')}</Notice>
                    ) : (
                        <p className="text-[12px] text-[#697386]">{t('window', { days: s.days, from: s.disbursementDate ?? '—', until: s.windowEndsOn ?? '—' })}</p>
                    )}
                    {!s.open && !open && s.days > 0 && <Notice tone="warn" title={t('closedTitle')}>{t('closed', { date: s.windowEndsOn ?? '—' })}</Notice>}
                    {q && (
                        <Table>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {rows.map(([label, v]) => (
                                    <tr key={label}><td className={td}>{label}</td><td className={tdR}><MoneyCell value={v} currency={q.currency} /></td></tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                    {q?.coolingOff && Number(q.coolingOff.penaltiesWaived) > 0 && <p className="text-[12px] text-[#697386]">{t('penaltiesWaived', { amount: q.coolingOff.penaltiesWaived })}</p>}
                    {s.quote?.error && <Notice tone="warn">{s.quote.error}</Notice>}
                    {open && (
                        <Notice tone={open.status === 'APPROVED' ? 'success' : 'warn'} title={open.status === 'APPROVED' ? t('approvedTitle') : t('pendingTitle')}>
                            <p>{open.payload.reason}{open.payload.customerReference ? ` · ${open.payload.customerReference}` : ''}</p>
                            <p className="text-[12px]">{t('requestedBy')} <Person id={open.makerId} />{open.payload.requestedOn ? ` · ${open.payload.requestedOn}` : ''}</p>
                            {open.status === 'PENDING' && (
                                <div className="flex gap-2 mt-2">
                                    <Btn size="sm" variant="primary" onClick={() => decide(true)} busy={busy === 'decide-true'} disabled={!approve.allowed} reason={approve.reason}>{t('approve')}</Btn>
                                    <Btn size="sm" variant="danger" onClick={() => decide(false)} busy={busy === 'decide-false'} disabled={!approve.allowed} reason={approve.reason}>{t('reject')}</Btn>
                                </div>
                            )}
                            {open.status === 'APPROVED' && (
                                <div className="flex flex-wrap items-end gap-2 mt-2">
                                    <Field label={t('externalReference')} hint={t('optional')}><TextInput value={externalReference} onChange={setExternalReference} maxLength={120} className="w-56" /></Field>
                                    <Btn variant="primary" onClick={execute} busy={busy === 'execute'} disabled={!post.allowed || !q} reason={post.reason}>{t('execute')}</Btn>
                                </div>
                            )}
                        </Notice>
                    )}
                    {s.open && !open && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label={t('reason')}><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
                            <Field label={t('customerReference')} hint={t('customerReferenceHint')}><TextInput value={reference} onChange={setReference} maxLength={120} /></Field>
                            <div><Btn variant="primary" onClick={submit} busy={busy === 'request'} disabled={!request.allowed || reason.trim().length < 3} reason={request.reason}>{t('request')}</Btn></div>
                        </div>
                    )}
                    <ErrorBox error={error} onDismiss={clearError} />
                </div>
            )}
        </ActionPanel>
    );
}
