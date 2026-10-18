"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { ActionPanel, Btn, ErrorBox, Field, Notice, TextArea, TextInput } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import { compareDecimal } from '../format';
import { Person } from '../People';
import type { PendingRefund, SuspensePayment } from './types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Propose returning held money to the payer (maker). */
export function RefundProposalPanel({ payment, onProposed, onClose }: {
    payment: SuspensePayment; onProposed: (p: PendingRefund) => void; onClose: () => void;
}) {
    const t = useTranslations('LendingSuspense.refund');
    const [amount, setAmount] = useState(payment.remaining);
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState<Record<string, string>>({});
    const { busy, error, run, clearError } = useAction();

    const propose = async () => {
        const p: Record<string, string> = {};
        const a = amount.trim();
        if (!MONEY_RE.test(a) || !/[1-9]/.test(a)) p.amount = t('positiveAmount');
        else if (compareDecimal(a, payment.remaining) > 0) p.amount = t('atMost', { amount: payment.remaining, currency: payment.currency });
        if (reason.trim().length < 3) p.reason = t('reasonShort');
        setProblem(p);
        if (Object.keys(p).length) return;
        const res = await run('propose', () => api.post<{ id: string }>(`/lending/suspense/${payment.id}/refunds`, { amount: a, reason: reason.trim() }));
        if (res) onProposed({ taskId: res.data.id, amount: a, currency: payment.currency, reason: reason.trim() });
    };

    return (
        <ActionPanel title={t('proposeTitle', { reference: payment.reference })} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('amount', { currency: payment.currency })} hint={t('upTo', { amount: payment.remaining })} error={problem.amount}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label={t('reason')} className="sm:col-span-2" error={problem.reason}>
                    <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} placeholder={t('reasonPlaceholder')} />
                </Field>
            </div>
            <Notice tone="info">{t.rich('makerChecker', { strong: (chunks) => <strong>{chunks}</strong> })}</Notice>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={propose} busy={busy === 'propose'}>{t('propose')}</Btn>
        </ActionPanel>
    );
}

/** Approve (and pay out) or reject a refund proposed in this session (checker). */
export function RefundDecisionPanel({ payment, pending, onDecided, onClose }: {
    payment: SuspensePayment; pending: PendingRefund; onDecided: (approved: boolean) => void; onClose: () => void;
}) {
    const t = useTranslations('LendingSuspense.refund');
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
        <ActionPanel title={<span className="flex items-center gap-2">{t('awaitingTitle')} <span className="font-mono text-[11px] text-[#697386]">{t('task', { id: pending.taskId.slice(0, 8) })}</span></span>} onClose={onClose}>
            <div className="text-[13px] text-[#3C4257] space-y-1">
                <p>{payment.payerName
                    ? t.rich('returnTo', { amount: () => <strong><Money value={pending.amount} currency={pending.currency} /></strong>, reference: payment.reference, payer: payment.payerName })
                    : t.rich('returnToPayer', { amount: () => <strong><Money value={pending.amount} currency={pending.currency} /></strong>, reference: payment.reference })}</p>
                <p className="text-[12px] text-[#697386]">{t('reasonLine', { reason: pending.reason })}</p>
                {pending.makerId && <p className="text-[12px] text-[#697386]">{t.rich('proposedBy', { who: () => <Person id={pending.makerId} /> })}</p>}
            </div>
            <Notice tone="warn" title={t('differentUser')}>
                {t.rich('differentUserBody', { task: () => <span className="font-mono">{pending.taskId}</span> })}
            </Notice>
            <Field label={t('comment')} hint={t('optional')}>
                <TextInput value={comment} onChange={setComment} maxLength={500} />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex items-center gap-2">
                <Btn variant="primary" onClick={() => decide(true)} busy={busy === 'approve'} disabled={!!busy}>{t('approve')}</Btn>
                <Btn variant="danger" onClick={() => decide(false)} busy={busy === 'reject'} disabled={!!busy}>{t('reject')}</Btn>
            </div>
        </ActionPanel>
    );
}
