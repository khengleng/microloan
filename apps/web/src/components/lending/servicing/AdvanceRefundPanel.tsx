"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, Notice, TextArea, TextInput } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import type { ApprovalTask } from '../types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/**
 * Refund money held on advance for the borrower (UC-74): one person proposes,
 * a different person approves and pays it out.
 */
export function AdvanceRefundPanel({ loanId, currency, held, tasks, can, onDone, onClose }: {
    loanId: string; currency: string; held: string; tasks: ApprovalTask[];
    can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const [amount, setAmount] = useState(held);
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const pending = tasks.filter((t) => t.action === 'ADVANCE_REFUND' && t.status === 'PENDING');
    const propose = can('loan.advance_refund.propose');
    const approve = can('loan.advance_refund.approve');

    const submit = async () => {
        if (!MONEY_RE.test(amount.trim()) || !/[1-9]/.test(amount)) { setProblem('Enter a positive amount.'); return; }
        if (reason.trim().length < 3) { setProblem('Record why the advance is refunded.'); return; }
        setProblem('');
        const res = await run('propose', () => api.post(`/lending/loans/${loanId}/advance-refunds`, { amount: amount.trim(), reason: reason.trim() }));
        if (res) onDone('Refund proposed — a different user must approve it');
    };

    const decide = async (taskId: string, ok: boolean) => {
        const body = { approve: ok };
        const res = await run(`${taskId}:${ok}`, () => api.post(`/lending/loans/${loanId}/advance-refunds/${taskId}/decision`, body, idem(key.keyFor({ taskId, ...body }))));
        if (res) {
            key.reset();
            onDone(ok ? 'Refund paid out' : 'Refund rejected');
        }
    };

    return (
        <ActionPanel title="Refund money held on advance" onClose={onClose}>
            <p className="text-[12px] text-[#697386]">Held on advance: <b><Money value={held} currency={currency} /></b>. It is applied to instalments as they fall due unless refunded.</p>
            {pending.map((t) => (
                <Notice key={t.id} tone="warn" title={`Refund of ${currency} ${t.amount} awaiting approval`}>
                    <p className="mb-2">Proposed by <span>{t.makerEmail ?? t.makerId.slice(0, 8)}</span>. A different user must approve it.</p>
                    <div className="flex gap-2">
                        <Btn size="sm" variant="primary" onClick={() => decide(t.id, true)} busy={busy === `${t.id}:true`} disabled={!approve.allowed} reason={approve.reason}>Approve and pay</Btn>
                        <Btn size="sm" variant="danger" onClick={() => decide(t.id, false)} busy={busy === `${t.id}:false`} disabled={!approve.allowed} reason={approve.reason}>Reject</Btn>
                    </div>
                </Notice>
            ))}
            {pending.length === 0 && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Field label={`Amount (${currency})`} error={problem || undefined}>
                            <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                        </Field>
                        <Field label="Reason" className="sm:col-span-2">
                            <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} />
                        </Field>
                    </div>
                    <Btn variant="primary" onClick={submit} busy={busy === 'propose'} disabled={!propose.allowed} reason={propose.reason}>Propose refund</Btn>
                </>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
