"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, SelectInput, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { ApprovalTask, LoanAccount } from '../types';

type Can = (code: string) => { allowed: boolean; reason?: string };

const PAYEE_TYPES = [
    { value: 'BORROWER', label: 'Borrower' },
    { value: 'SELLER', label: 'Seller' },
    { value: 'DEALER', label: 'Dealer' },
    { value: 'SCHOOL', label: 'School' },
    { value: 'PREVIOUS_LENDER', label: 'Previous lender' },
    { value: 'INTERNAL_LOAN', label: 'Our loan (consolidate)' },
    { value: 'MERCHANT', label: 'Merchant (BNPL — paid net of the discount)' },
    { value: 'SUPPLIER', label: 'Asset supplier (lease)' },
    { value: 'OTHER', label: 'Other' },
];
interface PayeeDraft { type: string; name: string; reference: string; account: string; loanId: string; amount: string }
const emptyPayee = (): PayeeDraft => ({ type: 'BORROWER', name: '', reference: '', account: '', loanId: '', amount: '' });

/** Prepare → approve (four-eyes) → execute. */
export function DisbursementPanel({ loanId, currency, account, tasks, can, onDone, onClose }: {
    loanId: string; currency: string; account?: LoanAccount; tasks: ApprovalTask[]; can: Can; onDone: (msg: string) => void; onClose: () => void;
}) {
    const confirm = useConfirm();
    const [valueDate, setValueDate] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const execKey = useIdempotencyKey();
    const dpKey = useIdempotencyKey();
    const [payees, setPayees] = useState<PayeeDraft[]>([]);
    const [dp, setDp] = useState({ amount: '', collectedBy: 'LENDER', externalReference: '' });
    const setPayee = (i: number, k: keyof PayeeDraft, v: string) => setPayees(payees.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
    const payeeTotal = payees.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const disb = tasks.filter((t) => t.action.includes('DISBURSE'));
    const pending = disb.filter((t) => t.status === 'PENDING');
    const approved = disb.filter((t) => t.status === 'APPROVED');
    const prep = can('loan.disbursement.prepare');
    const appr = can('loan.disbursement.approve');
    const exec = can('loan.disbursement.execute');
    const post = can('loan.repayment.post');

    const recordDownPayment = async () => {
        if (!/^\d+(\.\d{1,4})?$/.test(dp.amount.trim())) { setProblem('Down payment must be a decimal amount.'); return; }
        if (dp.externalReference.trim().length < 2) { setProblem('Receipt reference must be at least 2 characters.'); return; }
        setProblem('');
        const body = { amount: dp.amount.trim(), collectedBy: dp.collectedBy, externalReference: dp.externalReference.trim() };
        const res = await run('dp', () => api.post(`/lending/loans/${loanId}/down-payments`, body, idem(dpKey.keyFor(body))));
        if (res) {
            dpKey.reset();
            setDp({ amount: '', collectedBy: 'LENDER', externalReference: '' });
            onDone('Down payment recorded');
        }
    };

    const prepare = async () => {
        const res = await run('prepare', () => api.post(`/lending/loans/${loanId}/disbursements`, clean({ valueDate })));
        if (res) onDone('Disbursement prepared — awaiting approval');
    };

    const decide = async (task: ApprovalTask, approve: boolean) => {
        const ok = await confirm({
            title: approve ? 'Approve disbursement' : 'Reject disbursement',
            message: `${approve ? 'Approve' : 'Reject'} the disbursement task${task.amount ? ` for ${currency} ${task.amount}` : ''}?`,
            confirmLabel: approve ? 'Approve' : 'Reject',
            variant: approve ? 'default' : 'danger',
        });
        if (!ok) return;
        const res = await run(`decide-${task.id}`, () => api.post(`/lending/loans/${loanId}/disbursements/${task.id}/decision`, { approve }));
        if (res) onDone(approve ? 'Disbursement approved' : 'Disbursement rejected');
    };

    const execute = async () => {
        if (externalReference.trim().length < 2) { setProblem('External reference must be at least 2 characters.'); return; }
        setProblem('');
        for (const p of payees) {
            if (p.name.trim().length < 2) { setProblem('Every payee needs a name.'); return; }
            if (!/^\d+(\.\d{1,4})?$/.test(p.amount.trim())) { setProblem(`Payee ${p.name}: amount must be a decimal amount.`); return; }
            if (p.type === 'INTERNAL_LOAN' && !p.loanId.trim()) { setProblem(`Payee ${p.name}: choose the loan to consolidate.`); return; }
        }
        const body = {
            externalReference: externalReference.trim(),
            ...(payees.length ? {
                payees: payees.map((p) => clean({ type: p.type, name: p.name.trim(), reference: p.reference.trim(), account: p.account.trim(), loanId: p.type === 'INTERNAL_LOAN' ? p.loanId.trim() : '', amount: p.amount.trim() })),
            } : {}),
        };
        const ok = await confirm({ title: 'Execute disbursement', message: 'This posts the disbursement to the ledger and activates the loan. Continue?', confirmLabel: 'Execute' });
        if (!ok) return;
        const key = execKey.keyFor(body);
        const res = await run('execute', () => api.post(`/lending/loans/${loanId}/disbursements/execute`, body, idem(key)));
        if (res) {
            execKey.reset();
            onDone('Disbursement executed');
        }
    };

    return (
        <ActionPanel title="Disbursement" onClose={onClose}>
            {pending.length === 0 && approved.length === 0 && (
                <div className="flex flex-wrap items-end gap-2">
                    <Field label="Value date" hint="Optional — defaults to the business date">
                        <TextInput type="date" value={valueDate} onChange={setValueDate} className="w-44" />
                    </Field>
                    <Btn variant="primary" onClick={prepare} busy={busy === 'prepare'} disabled={!prep.allowed} reason={prep.reason}>Prepare disbursement</Btn>
                </div>
            )}

            {pending.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <StatusBadge status={t.status} />
                    <span>Disbursement task {t.amount && <Money value={t.amount} currency={t.currency ?? currency} />}</span>
                    <span className="font-mono text-[11px] text-[#8792A2]">maker {t.makerId.slice(0, 8)}</span>
                    <Btn size="sm" variant="primary" onClick={() => decide(t, true)} busy={busy === `decide-${t.id}`} disabled={!appr.allowed} reason={appr.reason}>Approve</Btn>
                    <Btn size="sm" variant="danger" onClick={() => decide(t, false)} disabled={!appr.allowed || busy === `decide-${t.id}`} reason={appr.reason}>Reject</Btn>
                </div>
            ))}

            {account?.status === 'BOOKED' && (
                <div className="rounded-md border border-[#E3E8EE] p-3 space-y-2">
                    <div className="text-[13px] font-medium text-[#1A1F36]">Down payment</div>
                    <div className="text-[12px] text-[#697386]">
                        Received <Money value={account.downPaymentReceived ?? '0'} currency={currency} /> · held by us <Money value={account.downPaymentHeld ?? '0'} currency={currency} />.
                        The disbursement is refused until the agreed down payment has been received; what we hold is paid out with the proceeds.
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label="Amount"><TextInput value={dp.amount} onChange={(v) => setDp({ ...dp, amount: v })} inputMode="decimal" className="w-32" /></Field>
                        <Field label="Collected by">
                            <SelectInput value={dp.collectedBy} onChange={(v) => setDp({ ...dp, collectedBy: v })} options={[{ value: 'LENDER', label: 'Us (held until payout)' }, { value: 'SELLER', label: 'Seller directly' }]} />
                        </Field>
                        <Field label="Receipt reference"><TextInput value={dp.externalReference} onChange={(v) => setDp({ ...dp, externalReference: v })} maxLength={120} className="w-44" /></Field>
                        <Btn onClick={recordDownPayment} busy={busy === 'dp'} disabled={!post.allowed} reason={post.reason}>Record down payment</Btn>
                    </div>
                </div>
            )}

            {approved.length > 0 && (
                <div className="space-y-2">
                    <div className="text-[13px] font-medium text-[#1A1F36]">Pay to</div>
                    <div className="text-[12px] text-[#697386]">
                        Leave empty to pay the borrower. Split the payout between a seller, dealer, school or previous lender, or consolidate the borrower&apos;s other loans with us — amounts must add up to the payout.
                    </div>
                    {payees.map((p, i) => (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                            <Field label="Type"><SelectInput value={p.type} onChange={(v) => setPayee(i, 'type', v)} options={PAYEE_TYPES} /></Field>
                            <Field label="Name"><TextInput value={p.name} onChange={(v) => setPayee(i, 'name', v)} className="w-44" /></Field>
                            {p.type === 'INTERNAL_LOAN'
                                ? <Field label="Loan id"><TextInput value={p.loanId} onChange={(v) => setPayee(i, 'loanId', v)} className="w-64 font-mono" /></Field>
                                : <Field label="Account"><TextInput value={p.account} onChange={(v) => setPayee(i, 'account', v)} className="w-36" /></Field>}
                            <Field label="Reference"><TextInput value={p.reference} onChange={(v) => setPayee(i, 'reference', v)} className="w-32" /></Field>
                            <Field label="Amount"><TextInput value={p.amount} onChange={(v) => setPayee(i, 'amount', v)} inputMode="decimal" className="w-28" /></Field>
                            <Btn size="sm" variant="ghost" onClick={() => setPayees(payees.filter((_, j) => j !== i))}>Remove</Btn>
                        </div>
                    ))}
                    <div className="flex items-center gap-3 text-[12px] text-[#697386]">
                        <Btn size="sm" onClick={() => setPayees([...payees, emptyPayee()])}>Add payee</Btn>
                        {payees.length > 0 && <span>Total {currency} {payeeTotal.toFixed(2)}</span>}
                    </div>
                </div>
            )}

            {approved.length > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                    <Field label="External reference" hint="Payment rail / bank transfer reference" error={problem || undefined}>
                        <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} className="w-64" />
                    </Field>
                    <Btn variant="primary" onClick={execute} busy={busy === 'execute'} disabled={!exec.allowed} reason={exec.reason}>Execute disbursement</Btn>
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
