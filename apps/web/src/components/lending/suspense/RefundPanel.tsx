"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, Notice, TextArea, TextInput } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import { compareDecimal } from '../format';
import type { PendingRefund, SuspensePayment } from './types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Propose returning held money to the payer (maker). */
export function RefundProposalPanel({ payment, onProposed, onClose }: {
    payment: SuspensePayment; onProposed: (p: PendingRefund) => void; onClose: () => void;
}) {
    const [amount, setAmount] = useState(payment.remaining);
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState<Record<string, string>>({});
    const { busy, error, run, clearError } = useAction();

    const propose = async () => {
        const p: Record<string, string> = {};
        const a = amount.trim();
        if (!MONEY_RE.test(a) || !/[1-9]/.test(a)) p.amount = 'Enter a positive decimal amount (up to 4 decimals).';
        else if (compareDecimal(a, payment.remaining) > 0) p.amount = `At most ${payment.remaining} ${payment.currency} is still held.`;
        if (reason.trim().length < 3) p.reason = 'Record why the money is being returned (at least 3 characters).';
        setProblem(p);
        if (Object.keys(p).length) return;
        const res = await run('propose', () => api.post<{ id: string }>(`/lending/suspense/${payment.id}/refunds`, { amount: a, reason: reason.trim() }));
        if (res) onProposed({ taskId: res.data.id, amount: a, currency: payment.currency, reason: reason.trim() });
    };

    return (
        <ActionPanel title={`Refund ${payment.reference} to the payer`} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={`Amount (${payment.currency})`} hint={`Up to ${payment.remaining} held`} error={problem.amount}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label="Reason" className="sm:col-span-2" error={problem.reason}>
                    <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} placeholder="e.g. Payer confirmed the transfer was sent in error" />
                </Field>
            </div>
            <Notice tone="info">Refunds are maker-checker: this creates a proposal, and <strong>a different user</strong> must approve it before any money leaves suspense.</Notice>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={propose} busy={busy === 'propose'}>Propose refund</Btn>
        </ActionPanel>
    );
}

/** Approve (and pay out) or reject a refund proposed in this session (checker). */
export function RefundDecisionPanel({ payment, pending, onDecided, onClose }: {
    payment: SuspensePayment; pending: PendingRefund; onDecided: (approved: boolean) => void; onClose: () => void;
}) {
    const [comment, setComment] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();

    const decide = async (approve: boolean) => {
        const body = { approve, ...(comment.trim() ? { comment: comment.trim() } : {}) };
        const k = key.keyFor({ taskId: pending.taskId, ...body });
        const res = await run(approve ? 'approve' : 'reject', () => api.post(`/lending/suspense/${payment.id}/refunds/${pending.taskId}/decision`, body, idem(k)));
        if (res) {
            key.reset();
            onDecided(approve);
        }
    };

    return (
        <ActionPanel title={<span className="flex items-center gap-2">Refund awaiting approval <span className="font-mono text-[11px] text-[#697386]">task {pending.taskId.slice(0, 8)}</span></span>} onClose={onClose}>
            <div className="text-[13px] text-[#3C4257] space-y-1">
                <p>Return <strong><Money value={pending.amount} currency={pending.currency} /></strong> from {payment.reference} to {payment.payerName || 'the payer'}.</p>
                <p className="text-[12px] text-[#697386]">Reason: {pending.reason}</p>
            </div>
            <Notice tone="warn" title="A different user must decide">
                The proposer cannot approve their own refund. Ask a colleague with refund-approval rights to sign in and decide; the proposal stays listed on this receipt until it is decided (task <span className="font-mono">{pending.taskId}</span>).
            </Notice>
            <Field label="Comment" hint="Optional">
                <TextInput value={comment} onChange={setComment} maxLength={500} />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex items-center gap-2">
                <Btn variant="primary" onClick={() => decide(true)} busy={busy === 'approve'} disabled={!!busy}>Approve &amp; pay out</Btn>
                <Btn variant="danger" onClick={() => decide(false)} busy={busy === 'reject'} disabled={!!busy}>Reject</Btn>
            </div>
        </ActionPanel>
    );
}
