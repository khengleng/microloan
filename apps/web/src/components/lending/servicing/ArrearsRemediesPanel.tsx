"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, Empty, ErrorBox, Field, SelectInput, Table, TextInput, td, th } from '../ui';
import { idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import type { ApprovalTask } from '../types';

interface Demand { id: string; reference: string; guarantorName: string; amount: string; paid: string; currency: string; issuedOn: string; payBy: string; status: string; letter: string }
interface Guarantee { id: string; guarantorName: string; type: string; amount: string; currency: string }

/** Calling the guarantor (UC-60) and set-off of the borrower's deposit (UC-61). */
export function ArrearsRemediesPanel({ loanId, currency, tasks, can, onDone, onClose }: {
    loanId: string; currency: string; tasks: ApprovalTask[]; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const confirm = useConfirm();
    const data = useApi<{ guarantees: Guarantee[]; demands: Demand[] }>(`/lending/loans/${loanId}/guarantor-demands`);
    const [demand, setDemand] = useState({ guaranteeId: '', amount: '', payWithinDays: '14' });
    const [payment, setPayment] = useState<{ id: string; amount: string; ref: string } | null>(null);
    const [setOff, setSetOff] = useState({ amount: '', sourceAccount: '', reason: '' });
    const [letter, setLetter] = useState<string | null>(null);
    const { busy, error, run, clearError } = useAction();
    const payKey = useIdempotencyKey();
    const decideKey = useIdempotencyKey();
    const post = can('loan.repayment.post');
    const approve = can('loan.repayment.reverse');
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
        if (res) { payKey.reset(); setPayment(null); onDone('Guarantor payment posted'); }
    };
    const withdraw = async (d: Demand) => {
        if (!(await confirm({ title: 'Withdraw demand', message: `Withdraw ${d.reference}?`, confirmLabel: 'Withdraw', variant: 'danger' }))) return;
        if (await run(`wd-${d.id}`, () => api.post(`/lending/loans/${loanId}/guarantor-demands/${d.id}/withdraw`))) data.reload();
    };
    const propose = async () => {
        const res = await run('setoff', () => api.post(`/lending/loans/${loanId}/set-offs`, { amount: setOff.amount.trim(), sourceAccount: setOff.sourceAccount.trim(), reason: setOff.reason.trim() }));
        if (res) onDone('Set-off proposed — awaiting approval');
    };
    const decide = async (t: ApprovalTask, ok: boolean) => {
        if (!(await confirm({ title: ok ? 'Approve set-off' : 'Reject set-off', message: `${ok ? 'Apply' : 'Reject'} ${currency} ${t.amount} from the borrower's deposit?`, confirmLabel: ok ? 'Approve' : 'Reject', variant: ok ? 'default' : 'danger' }))) return;
        const body = { approve: ok };
        const res = await run(`so-${t.id}`, () => api.post(`/lending/loans/${loanId}/set-offs/${t.id}/decision`, body, idem(decideKey.keyFor({ ...body, id: t.id }))));
        if (res) { decideKey.reset(); onDone(ok ? 'Set-off applied' : 'Set-off rejected'); }
    };

    return (
        <ActionPanel title="Guarantor and set-off" onClose={onClose}>
            <div className="space-y-2">
                <div className="text-[13px] font-medium text-[#1A1F36]">Call the guarantor</div>
                {data.data && data.data.guarantees.length === 0 ? <Empty>This loan has no guarantees.</Empty> : (
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label="Guarantee">
                            <SelectInput value={demand.guaranteeId} onChange={(v) => setDemand({ ...demand, guaranteeId: v })} placeholder="Choose…"
                                options={(data.data?.guarantees ?? []).map((g) => ({ value: g.id, label: `${g.guarantorName} — up to ${g.currency} ${g.amount}` }))} />
                        </Field>
                        <Field label="Amount" hint="Blank: all the guarantee still covers"><TextInput value={demand.amount} onChange={(v) => setDemand({ ...demand, amount: v })} inputMode="decimal" className="w-32" /></Field>
                        <Field label="Pay within (days)"><TextInput value={demand.payWithinDays} onChange={(v) => setDemand({ ...demand, payWithinDays: v })} inputMode="numeric" className="w-20" /></Field>
                        <Btn variant="primary" onClick={issue} busy={busy === 'demand'} disabled={!post.allowed || !demand.guaranteeId} reason={post.reason}>Issue demand</Btn>
                    </div>
                )}
                {!!data.data?.demands.length && (
                    <Table>
                        <thead><tr><th className={th}>Demand</th><th className={th}>Guarantor</th><th className={th}>Amount / paid</th><th className={th}>Pay by</th><th className={th}>Status</th><th className={th} /></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.data.demands.map((d) => (
                                <tr key={d.id}>
                                    <td className={`${td} font-mono`}>{d.reference}</td>
                                    <td className={td}>{d.guarantorName}</td>
                                    <td className={td}>{d.currency} {d.amount} / {d.paid}</td>
                                    <td className={td}>{d.payBy}</td>
                                    <td className={td}><StatusBadge status={d.status} /></td>
                                    <td className={`${td} space-x-1 whitespace-nowrap`}>
                                        <Btn size="sm" variant="ghost" onClick={() => setLetter(d.letter)}>Letter</Btn>
                                        {d.status === 'OPEN' && <Btn size="sm" onClick={() => setPayment({ id: d.id, amount: '', ref: '' })} disabled={!post.allowed} reason={post.reason}>Record payment</Btn>}
                                        {d.status === 'OPEN' && <Btn size="sm" variant="ghost" onClick={() => withdraw(d)}>Withdraw</Btn>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
                {payment && (
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label="Paid by guarantor"><TextInput value={payment.amount} onChange={(v) => setPayment({ ...payment, amount: v })} inputMode="decimal" className="w-32" /></Field>
                        <Field label="Reference"><TextInput value={payment.ref} onChange={(v) => setPayment({ ...payment, ref: v })} maxLength={120} className="w-44" /></Field>
                        <Btn variant="primary" onClick={pay} busy={busy === 'pay'}>Post payment</Btn>
                        <Btn variant="ghost" onClick={() => setPayment(null)}>Cancel</Btn>
                    </div>
                )}
                {letter && <pre className="whitespace-pre-wrap rounded-md border border-[#E3E8EE] bg-[#F7FAFC] p-3 font-mono text-[12px] text-[#3C4257]">{letter}</pre>}
            </div>

            <div className="space-y-2 border-t border-[#E3E8EE] pt-3">
                <div className="text-[13px] font-medium text-[#1A1F36]">Set-off from the borrower&apos;s deposit</div>
                <p className="text-[12px] text-[#697386]">Applies money from the borrower&apos;s own deposit account to what is overdue. A second person approves; the deposit system is debited through the set-off clearing account.</p>
                <div className="flex flex-wrap items-end gap-2">
                    <Field label="Amount"><TextInput value={setOff.amount} onChange={(v) => setSetOff({ ...setOff, amount: v })} inputMode="decimal" className="w-32" /></Field>
                    <Field label="Deposit account"><TextInput value={setOff.sourceAccount} onChange={(v) => setSetOff({ ...setOff, sourceAccount: v })} maxLength={60} className="w-40" /></Field>
                    <Field label="Reason"><TextInput value={setOff.reason} onChange={(v) => setSetOff({ ...setOff, reason: v })} maxLength={500} className="w-64" /></Field>
                    <Btn onClick={propose} busy={busy === 'setoff'} disabled={!post.allowed} reason={post.reason}>Propose set-off</Btn>
                </div>
                {pending.map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <StatusBadge status={t.status} /> <span>Set-off {currency} {t.amount}</span>
                        <Btn size="sm" variant="primary" onClick={() => decide(t, true)} busy={busy === `so-${t.id}`} disabled={!approve.allowed} reason={approve.reason}>Approve</Btn>
                        <Btn size="sm" variant="danger" onClick={() => decide(t, false)} disabled={!approve.allowed} reason={approve.reason}>Reject</Btn>
                    </div>
                ))}
            </div>
            <ErrorBox error={error ?? data.error} onDismiss={clearError} />
        </ActionPanel>
    );
}
