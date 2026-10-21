"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, Empty, ErrorBox, Field, SelectInput, Table, TextInput, td, th } from '../ui';
import { idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { Person } from '../People';
import type { ApprovalTask } from '../types';

interface Demand { id: string; reference: string; guarantorName: string; amount: string; paid: string; currency: string; issuedOn: string; payBy: string; status: string; letter: string }
interface Guarantee { id: string; guarantorName: string; type: string; amount: string; currency: string }
interface Promise_ { id: string; amount: string; currency: string; promisedOn: string; payBy: string; countsUntil: string; received: string; status: string; note: string }

/** Calling the guarantor (UC-60) and set-off of the borrower's deposit (UC-61). */
export function ArrearsRemediesPanel({ loanId, currency, tasks, can, onDone, onClose }: {
    loanId: string; currency: string; tasks: ApprovalTask[]; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const tl = useTranslations('LendingServicing.arrearsRemedies');
    const confirm = useConfirm();
    const data = useApi<{ guarantees: Guarantee[]; demands: Demand[] }>(`/lending/loans/${loanId}/guarantor-demands`);
    const [demand, setDemand] = useState({ guaranteeId: '', amount: '', payWithinDays: '14' });
    const [payment, setPayment] = useState<{ id: string; amount: string; ref: string } | null>(null);
    const [setOff, setSetOff] = useState({ amount: '', sourceAccount: '', reason: '' });
    const [letter, setLetter] = useState<string | null>(null);
    const promises = useApi<Promise_[]>(`/lending/loans/${loanId}/promises`);
    const [promise, setPromise] = useState({ amount: '', payBy: '', note: '' });
    const { busy, error, run, clearError } = useAction();
    const payKey = useIdempotencyKey();
    const decideKey = useIdempotencyKey();
    const post = can('loan.repayment.post');
    const issueDemand = can('loan.guarantor_demand.issue');
    const proposeSetOff = can('loan.set_off.propose');
    const approve = can('loan.set_off.approve');
    const pending = tasks.filter((t) => t.action === 'SET_OFF' && t.status === 'PENDING');

    const issue = async () => {
        const body = { guaranteeId: demand.guaranteeId, ...(demand.amount.trim() ? { amount: demand.amount.trim() } : {}), payWithinDays: Number(demand.payWithinDays) || 14 };
        const res = await run('demand', () => api.post<Demand>(`/lending/loans/${loanId}/guarantor-demands`, body));
        if (res) { setLetter(res.data.letter); data.reload(); }
    };
    const pay = async () => {
        if (!payment) return;
        const body = { amount: payment.amount.trim(), ...(payment.ref.trim() ? { externalReference: payment.ref.trim() } : {}) };
        const res = await run('pay', () => api.post(`/lending/loans/${loanId}/guarantor-demands/${payment.id}/payments`, body, idem(payKey.keyFor({ ...body, id: payment.id }))));
        if (res) { payKey.reset(); setPayment(null); onDone(tl('toastGuarantorPaid')); }
    };
    const withdraw = async (d: Demand) => {
        if (!(await confirm({ title: tl('withdrawTitle'), message: tl('withdrawMessage', { reference: d.reference }), confirmLabel: tl('withdraw'), variant: 'danger' }))) return;
        if (await run(`wd-${d.id}`, () => api.post(`/lending/loans/${loanId}/guarantor-demands/${d.id}/withdraw`))) data.reload();
    };
    // Promises to pay (UC-59): working them is collection.task.work, held with loan.repayment.post.
    const recordPromise = async () => {
        const body = { amount: promise.amount.trim(), payBy: promise.payBy, ...(promise.note.trim() ? { note: promise.note.trim() } : {}) };
        if (await run('promise', () => api.post(`/lending/loans/${loanId}/promises`, body))) { setPromise({ amount: '', payBy: '', note: '' }); promises.reload(); }
    };
    const withdrawPromise = async (p: Promise_) => {
        if (await run(`pw-${p.id}`, () => api.post(`/lending/collections/promises/${p.id}/cancel`, { reason: tl('promiseWithdrawReason') }))) promises.reload();
    };
    const propose = async () => {
        const res = await run('setoff', () => api.post(`/lending/loans/${loanId}/set-offs`, { amount: setOff.amount.trim(), sourceAccount: setOff.sourceAccount.trim(), reason: setOff.reason.trim() }));
        if (res) onDone(tl('toastSetOffProposed'));
    };
    const decide = async (t: ApprovalTask, ok: boolean) => {
        if (!(await confirm({ title: ok ? tl('approveSetOffTitle') : tl('rejectSetOffTitle'), message: ok ? tl('applyMessage', { currency, amount: t.amount ?? '' }) : tl('rejectMessage', { currency, amount: t.amount ?? '' }), confirmLabel: ok ? tl('approve') : tl('reject'), variant: ok ? 'default' : 'danger' }))) return;
        const body = { approve: ok };
        const res = await run(`so-${t.id}`, () => api.post(`/lending/loans/${loanId}/set-offs/${t.id}/decision`, body, idem(decideKey.keyFor({ ...body, id: t.id }))));
        if (res) { decideKey.reset(); onDone(ok ? tl('toastSetOffApplied') : tl('toastSetOffRejected')); }
    };

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            <div className="space-y-2">
                <div className="text-[13px] font-medium text-[#1A1F36]">{tl('callGuarantor')}</div>
                {data.data && data.data.guarantees.length === 0 ? <Empty>{tl('noGuarantees')}</Empty> : (
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label={tl('guarantee')}>
                            <SelectInput value={demand.guaranteeId} onChange={(v) => setDemand({ ...demand, guaranteeId: v })} placeholder={tl('choose')}
                                options={(data.data?.guarantees ?? []).map((g) => ({ value: g.id, label: tl('guaranteeOption', { name: g.guarantorName, currency: g.currency, amount: g.amount }) }))} />
                        </Field>
                        <Field label={tl('amount')} hint={tl('amountHint')}><TextInput value={demand.amount} onChange={(v) => setDemand({ ...demand, amount: v })} inputMode="decimal" className="w-32" /></Field>
                        <Field label={tl('payWithin')}><TextInput value={demand.payWithinDays} onChange={(v) => setDemand({ ...demand, payWithinDays: v })} inputMode="numeric" className="w-20" /></Field>
                        <Btn variant="primary" onClick={issue} busy={busy === 'demand'} disabled={!issueDemand.allowed || !demand.guaranteeId} reason={issueDemand.reason}>{tl('issueDemand')}</Btn>
                    </div>
                )}
                {!!data.data?.demands.length && (
                    <Table>
                        <thead><tr><th className={th}>{tl('columns.demand')}</th><th className={th}>{tl('columns.guarantor')}</th><th className={th}>{tl('columns.amountPaid')}</th><th className={th}>{tl('columns.payBy')}</th><th className={th}>{tl('columns.status')}</th><th className={th} /></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.data.demands.map((d) => (
                                <tr key={d.id}>
                                    <td className={`${td} font-mono`}>{d.reference}</td>
                                    <td className={td}>{d.guarantorName}</td>
                                    <td className={td}>{d.currency} {d.amount} / {d.paid}</td>
                                    <td className={td}>{d.payBy}</td>
                                    <td className={td}><StatusBadge status={d.status} /></td>
                                    <td className={`${td} space-x-1 whitespace-nowrap`}>
                                        <Btn size="sm" variant="ghost" onClick={() => setLetter(d.letter)}>{tl('letter')}</Btn>
                                        {d.status === 'OPEN' && <Btn size="sm" onClick={() => setPayment({ id: d.id, amount: '', ref: '' })} disabled={!post.allowed} reason={post.reason}>{tl('recordPayment')}</Btn>}
                                        {d.status === 'OPEN' && issueDemand.allowed && <Btn size="sm" variant="ghost" onClick={() => withdraw(d)}>{tl('withdraw')}</Btn>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
                {payment && (
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label={tl('paidByGuarantor')}><TextInput value={payment.amount} onChange={(v) => setPayment({ ...payment, amount: v })} inputMode="decimal" className="w-32" /></Field>
                        <Field label={tl('reference')}><TextInput value={payment.ref} onChange={(v) => setPayment({ ...payment, ref: v })} maxLength={120} className="w-44" /></Field>
                        <Btn variant="primary" onClick={pay} busy={busy === 'pay'}>{tl('postPayment')}</Btn>
                        <Btn variant="ghost" onClick={() => setPayment(null)}>{tl('cancel')}</Btn>
                    </div>
                )}
                {letter && <pre className="whitespace-pre-wrap rounded-md border border-[#E3E8EE] bg-[#F7FAFC] p-3 font-mono text-[12px] text-[#3C4257]">{letter}</pre>}
            </div>

            <div className="space-y-2 border-t border-[#E3E8EE] pt-3">
                <div className="text-[13px] font-medium text-[#1A1F36]">{tl('promisesTitle')}</div>
                <p className="text-[12px] text-[#697386]">{tl('promisesBody')}</p>
                <div className="flex flex-wrap items-end gap-2">
                    <Field label={tl('promiseAmount')}><TextInput value={promise.amount} onChange={(v) => setPromise({ ...promise, amount: v })} inputMode="decimal" className="w-32" /></Field>
                    <Field label={tl('promiseDate')}><TextInput type="date" value={promise.payBy} onChange={(v) => setPromise({ ...promise, payBy: v })} className="w-40" /></Field>
                    <Field label={tl('promiseNote')}><TextInput value={promise.note} onChange={(v) => setPromise({ ...promise, note: v })} maxLength={1000} className="w-56" /></Field>
                    <Btn onClick={recordPromise} busy={busy === 'promise'} disabled={!post.allowed || !promise.amount.trim() || !promise.payBy} reason={post.reason}>{tl('recordPromise')}</Btn>
                </div>
                {promises.data && promises.data.length === 0 ? <Empty>{tl('noPromises')}</Empty> : !!promises.data?.length && (
                    <Table>
                        <thead><tr><th className={th}>{tl('promiseColumns.promised')}</th><th className={th}>{tl('promiseColumns.payBy')}</th><th className={th}>{tl('promiseColumns.received')}</th><th className={th}>{tl('promiseColumns.status')}</th><th className={th} /></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {promises.data.map((p) => (
                                <tr key={p.id}>
                                    <td className={td}>{p.currency} {p.amount}<div className="text-[11px] text-[#8792A2]">{p.promisedOn}{p.note ? ` — ${p.note}` : ''}</div></td>
                                    <td className={td}>{p.payBy} ({p.countsUntil})</td>
                                    <td className={td}>{p.status === 'PENDING' ? '—' : `${p.currency} ${p.received}`}</td>
                                    <td className={td}><StatusBadge status={p.status} /></td>
                                    <td className={td}>{p.status === 'PENDING' && post.allowed && <Btn size="sm" variant="ghost" onClick={() => withdrawPromise(p)} busy={busy === `pw-${p.id}`}>{tl('promiseWithdraw')}</Btn>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </div>

            <div className="space-y-2 border-t border-[#E3E8EE] pt-3">
                <div className="text-[13px] font-medium text-[#1A1F36]">{tl('setOffTitle')}</div>
                <p className="text-[12px] text-[#697386]">{tl('setOffBody')}</p>
                <div className="flex flex-wrap items-end gap-2">
                    <Field label={tl('amount')}><TextInput value={setOff.amount} onChange={(v) => setSetOff({ ...setOff, amount: v })} inputMode="decimal" className="w-32" /></Field>
                    <Field label={tl('depositAccount')}><TextInput value={setOff.sourceAccount} onChange={(v) => setSetOff({ ...setOff, sourceAccount: v })} maxLength={60} className="w-40" /></Field>
                    <Field label={tl('reason')}><TextInput value={setOff.reason} onChange={(v) => setSetOff({ ...setOff, reason: v })} maxLength={500} className="w-64" /></Field>
                    <Btn onClick={propose} busy={busy === 'setoff'} disabled={!proposeSetOff.allowed} reason={proposeSetOff.reason}>{tl('proposeSetOff')}</Btn>
                </div>
                {pending.map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <StatusBadge status={t.status} /> <span>{tl('pendingSetOff', { currency, amount: t.amount ?? '' })}</span>
                        <span className="text-[11px] text-[#697386]">{t.makerEmail ?? <Person id={t.makerId} />}</span>
                        <Btn size="sm" variant="primary" onClick={() => decide(t, true)} busy={busy === `so-${t.id}`} disabled={!approve.allowed} reason={approve.reason}>{tl('approve')}</Btn>
                        <Btn size="sm" variant="danger" onClick={() => decide(t, false)} disabled={!approve.allowed} reason={approve.reason}>{tl('reject')}</Btn>
                    </div>
                ))}
            </div>
            <ErrorBox error={error ?? data.error ?? promises.error} onDismiss={clearError} />
        </ActionPanel>
    );
}
