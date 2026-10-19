"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { HelpLink } from '@/components/help/HelpLink';
import { ActionPanel, Btn, ErrorBox, Field, SelectInput, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { ApprovalTask, LoanAccount } from '../types';
import { useMyId } from '../access/common';
import { Person } from '../People';

type Can = (code: string) => { allowed: boolean; reason?: string };

const PAYEE_TYPES = ['BORROWER', 'SELLER', 'DEALER', 'SCHOOL', 'PREVIOUS_LENDER', 'INTERNAL_LOAN', 'MERCHANT', 'SUPPLIER', 'OTHER'];
interface PayeeDraft { type: string; name: string; reference: string; account: string; loanId: string; amount: string }
const emptyPayee = (): PayeeDraft => ({ type: 'BORROWER', name: '', reference: '', account: '', loanId: '', amount: '' });

/** Prepare → approve (four-eyes) → execute. */
export function DisbursementPanel({ loanId, currency, account, tasks, can, onDone, onClose }: {
    loanId: string; currency: string; account?: LoanAccount; tasks: ApprovalTask[]; can: Can; onDone: (msg: string) => void; onClose: () => void;
}) {
    const t = useTranslations('LendingServicing.disbursement');
    const confirm = useConfirm();
    const [valueDate, setValueDate] = useState('');
    const [externalReference, setExternalReference] = useState('');
    // How the money went out; cash counts towards the cash transaction report (AML).
    const [channel, setChannel] = useState('');
    const [problem, setProblem] = useState('');
    // Down-payment problems show next to the down-payment form, which is used before approval.
    const [dpProblem, setDpProblem] = useState('');
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
    const recordDp = can('loan.down_payment.record');
    const me = useMyId();

    const recordDownPayment = async () => {
        if (!/^\d+(\.\d{1,4})?$/.test(dp.amount.trim()) || !/[1-9]/.test(dp.amount)) { setDpProblem(t('errors.dpAmount')); return; }
        if (dp.externalReference.trim().length < 2) { setDpProblem(t('errors.dpReceipt')); return; }
        setDpProblem('');
        const body = { amount: dp.amount.trim(), collectedBy: dp.collectedBy, externalReference: dp.externalReference.trim() };
        const res = await run('dp', () => api.post(`/lending/loans/${loanId}/down-payments`, body, idem(dpKey.keyFor(body))));
        if (res) {
            dpKey.reset();
            setDp({ amount: '', collectedBy: 'LENDER', externalReference: '' });
            onDone(t('toasts.dpRecorded'));
        }
    };

    const prepare = async () => {
        const res = await run('prepare', () => api.post(`/lending/loans/${loanId}/disbursements`, clean({ valueDate })));
        if (res) onDone(t('toasts.prepared'));
    };

    const decide = async (task: ApprovalTask, approve: boolean) => {
        const ok = await confirm({
            title: approve ? t('confirm.approveTitle') : t('confirm.rejectTitle'),
            message: task.amount
                ? t(approve ? 'confirm.approveMessageAmount' : 'confirm.rejectMessageAmount', { currency, amount: task.amount })
                : t(approve ? 'confirm.approveMessage' : 'confirm.rejectMessage'),
            confirmLabel: approve ? t('approve') : t('reject'),
            variant: approve ? 'default' : 'danger',
        });
        if (!ok) return;
        const res = await run(`decide-${task.id}`, () => api.post(`/lending/loans/${loanId}/disbursements/${task.id}/decision`, { approve }));
        if (res) onDone(approve ? t('toasts.approved') : t('toasts.rejected'));
    };

    const execute = async () => {
        if (externalReference.trim().length < 2) { setProblem(t('errors.externalReference')); return; }
        setProblem('');
        for (const p of payees) {
            if (p.name.trim().length < 2) { setProblem(t('errors.payeeName')); return; }
            if (!/^\d+(\.\d{1,4})?$/.test(p.amount.trim())) { setProblem(t('errors.payeeAmount', { name: p.name })); return; }
            if (p.type === 'INTERNAL_LOAN' && !p.loanId.trim()) { setProblem(t('errors.payeeLoan', { name: p.name })); return; }
        }
        const body = {
            externalReference: externalReference.trim(),
            ...(channel ? { channel } : {}),
            ...(payees.length ? {
                payees: payees.map((p) => clean({ type: p.type, name: p.name.trim(), reference: p.reference.trim(), account: p.account.trim(), loanId: p.type === 'INTERNAL_LOAN' ? p.loanId.trim() : '', amount: p.amount.trim() })),
            } : {}),
        };
        const ok = await confirm({ title: t('confirm.executeTitle'), message: t('confirm.executeMessage'), confirmLabel: t('confirm.executeLabel') });
        if (!ok) return;
        const key = execKey.keyFor(body);
        const res = await run('execute', () => api.post(`/lending/loans/${loanId}/disbursements/execute`, body, idem(key)));
        if (res) {
            execKey.reset();
            onDone(t('toasts.executed'));
        }
    };

    return (
        <ActionPanel title={<span className="flex items-center gap-2">{t('title')} <HelpLink chapter="06-disbursement" anchor="step-1--prepare-the-disbursement" /></span>} onClose={onClose}>
            {pending.length === 0 && approved.length === 0 && (
                <div data-tour="disb-prepare" className="flex flex-wrap items-end gap-2">
                    <Field label={t('valueDate')} hint={t('valueDateHint')}>
                        <TextInput type="date" value={valueDate} onChange={setValueDate} className="w-44" />
                    </Field>
                    <Btn variant="primary" onClick={prepare} busy={busy === 'prepare'} disabled={!prep.allowed} reason={prep.reason}>{t('prepare')}</Btn>
                </div>
            )}

            {pending.map((task) => (
                <div data-tour="disb-pending-task" key={task.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <StatusBadge status={task.status} />
                    <span>{t('task')} {task.amount && <Money value={task.amount} currency={task.currency ?? currency} />}</span>
                    <span className="text-[11px] text-[#8792A2]">{t.rich('maker', { who: () => task.makerEmail ?? <Person id={task.makerId} /> })}</span>
                    {task.makerId !== me && <Btn size="sm" variant="primary" onClick={() => decide(task, true)} busy={busy === `decide-${task.id}`} disabled={!appr.allowed} reason={appr.reason}>{t('approve')}</Btn>}
                    {task.makerId !== me && <Btn size="sm" variant="danger" onClick={() => decide(task, false)} disabled={!appr.allowed || busy === `decide-${task.id}`} reason={appr.reason}>{t('reject')}</Btn>}
                </div>
            ))}

            {account?.status === 'BOOKED' && (
                <div data-tour="disb-down-payment" className="rounded-md border border-[#E3E8EE] p-3 space-y-2">
                    <div className="text-[13px] font-medium text-[#1A1F36]">{t('downPayment.title')}</div>
                    <div className="text-[12px] text-[#697386]">
                        {t.rich('downPayment.body', {
                            received: () => <Money value={account.downPaymentReceived ?? '0'} currency={currency} />,
                            held: () => <Money value={account.downPaymentHeld ?? '0'} currency={currency} />,
                        })}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label={t('downPayment.amount')} error={dpProblem || undefined}><TextInput value={dp.amount} onChange={(v) => setDp({ ...dp, amount: v })} inputMode="decimal" className="w-32" /></Field>
                        <Field label={t('downPayment.collectedBy')}>
                            <SelectInput value={dp.collectedBy} onChange={(v) => setDp({ ...dp, collectedBy: v })} options={[{ value: 'LENDER', label: t('downPayment.collectedLender') }, { value: 'SELLER', label: t('downPayment.collectedSeller') }]} />
                        </Field>
                        <Field label={t('downPayment.receiptReference')}><TextInput value={dp.externalReference} onChange={(v) => setDp({ ...dp, externalReference: v })} maxLength={120} className="w-44" /></Field>
                        <Btn onClick={recordDownPayment} busy={busy === 'dp'} disabled={!recordDp.allowed} reason={recordDp.reason}>{t('downPayment.record')}</Btn>
                    </div>
                </div>
            )}

            {approved.length > 0 && (
                <div data-tour="disb-payees" className="space-y-2">
                    <div className="text-[13px] font-medium text-[#1A1F36]">{t('payees.title')}</div>
                    <div className="text-[12px] text-[#697386]">
                        {t('payees.hint')}
                    </div>
                    {payees.map((p, i) => (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                            <Field label={t('payees.type')}><SelectInput value={p.type} onChange={(v) => setPayee(i, 'type', v)} options={PAYEE_TYPES.map((v) => ({ value: v, label: t(`payeeTypes.${v}`) }))} /></Field>
                            <Field label={t('payees.name')}><TextInput value={p.name} onChange={(v) => setPayee(i, 'name', v)} className="w-44" /></Field>
                            {p.type === 'INTERNAL_LOAN'
                                ? <Field label={t('payees.loanId')}><TextInput value={p.loanId} onChange={(v) => setPayee(i, 'loanId', v)} className="w-64 font-mono" /></Field>
                                : <Field label={t('payees.account')}><TextInput value={p.account} onChange={(v) => setPayee(i, 'account', v)} className="w-36" /></Field>}
                            <Field label={t('payees.reference')}><TextInput value={p.reference} onChange={(v) => setPayee(i, 'reference', v)} className="w-32" /></Field>
                            <Field label={t('payees.amount')}><TextInput value={p.amount} onChange={(v) => setPayee(i, 'amount', v)} inputMode="decimal" className="w-28" /></Field>
                            <Btn size="sm" variant="ghost" onClick={() => setPayees(payees.filter((_, j) => j !== i))}>{t('payees.remove')}</Btn>
                        </div>
                    ))}
                    <div className="flex items-center gap-3 text-[12px] text-[#697386]">
                        <Btn size="sm" onClick={() => setPayees([...payees, emptyPayee()])}>{t('payees.add')}</Btn>
                        {payees.length > 0 && <span>{t('payees.total', { currency, amount: payeeTotal.toFixed(2) })}</span>}
                    </div>
                </div>
            )}

            {approved.length > 0 && (
                <div data-tour="disb-execute" className="flex flex-wrap items-end gap-2">
                    <Field label={t('externalReference')} hint={t('externalReferenceHint')} error={problem || undefined}>
                        <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} className="w-64" />
                    </Field>
                    <Field label={t('channel')} hint={t('channelHint')}>
                        <SelectInput value={channel} onChange={setChannel} placeholder={t('channelUnknown')} options={['BRANCH_CASH', 'BANK_TRANSFER', 'MOBILE', 'WALLET', 'AGENT', 'OTHER'].map((c) => ({ value: c, label: t(`channels.${c}`) }))} className="w-44" />
                    </Field>
                    <Btn variant="primary" onClick={execute} busy={busy === 'execute'} disabled={!exec.allowed} reason={exec.reason}>{t('execute')}</Btn>
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
