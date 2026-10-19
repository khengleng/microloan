"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import type { ApprovalTask } from '../types';
import { Person } from '../People';
import { useTranslations } from 'next-intl';

const KINDS = ['EARLY_SETTLEMENT', 'PARTIAL_PREPAYMENT'];

/**
 * Waive an early repayment fee (UC-32): one person proposes, another approves;
 * the next settlement or prepayment of that kind is charged no fee.
 */
export function FeeWaiverPanel({ loanId, tasks, can, onDone, onClose }: {
    loanId: string; tasks: ApprovalTask[];
    can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const tl = useTranslations('LendingServicing.feeWaiver');
    const [kind, setKind] = useState('EARLY_SETTLEMENT');
    const [reason, setReason] = useState('');
    const [expiresOn, setExpiresOn] = useState('');
    const { busy, error, run, clearError } = useAction();
    const waivers = tasks.filter((t) => t.action === 'FEE_WAIVER' && (t.status === 'PENDING' || t.status === 'APPROVED'));
    const propose = can('loan.fee_waiver.propose');
    const approve = can('loan.fee_waiver.approve');
    const kindOf = (t: ApprovalTask) => (t.payload as { kind?: string } | undefined)?.kind ?? '';
    const kindLabel = (k: string) => (KINDS.includes(k) ? tl(`kinds.${k}`) : k);

    const submit = async () => {
        const res = await run('propose', () => api.post(`/lending/loans/${loanId}/fee-waivers`, clean({ kind, reason: reason.trim(), expiresOn })));
        if (res) onDone(tl('proposed'));
    };
    const decide = async (taskId: string, ok: boolean) => {
        const res = await run(`${taskId}:${ok}`, () => api.post(`/lending/loans/${loanId}/fee-waivers/${taskId}/decision`, { approve: ok }));
        if (res) onDone(ok ? tl('approved') : tl('rejected'));
    };

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            {waivers.map((t) => (
                <Notice key={t.id} tone={t.status === 'APPROVED' ? 'success' : 'warn'} title={t.status === 'APPROVED' ? tl('approvedTitle', { kind: kindLabel(kindOf(t)) }) : tl('pendingTitle', { kind: kindLabel(kindOf(t)) })}>
                    <p>{tl.rich('proposedBy', { who: () => <span>{t.makerEmail ?? <Person id={t.makerId} />}</span> })}</p>
                    {t.status === 'PENDING' && (
                        <div className="flex gap-2 mt-2">
                            <Btn size="sm" variant="primary" onClick={() => decide(t.id, true)} busy={busy === `${t.id}:true`} disabled={!approve.allowed} reason={approve.reason}>{tl('approve')}</Btn>
                            <Btn size="sm" variant="danger" onClick={() => decide(t.id, false)} busy={busy === `${t.id}:false`} disabled={!approve.allowed} reason={approve.reason}>{tl('reject')}</Btn>
                        </div>
                    )}
                </Notice>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={tl('fee')}><SelectInput value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: tl(`kinds.${k}`) }))} /></Field>
                <Field label={tl('expiresOn')} hint={tl('optional')}><TextInput type="date" value={expiresOn} onChange={setExpiresOn} /></Field>
                <Field label={tl('reason')}><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'propose'} disabled={!propose.allowed || reason.trim().length < 3} reason={propose.reason}>{tl('propose')}</Btn>
        </ActionPanel>
    );
}
