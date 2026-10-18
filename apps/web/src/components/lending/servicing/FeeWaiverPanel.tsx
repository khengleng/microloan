"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import type { ApprovalTask } from '../types';

const KINDS = [
    { value: 'EARLY_SETTLEMENT', label: 'Early settlement fee' },
    { value: 'PARTIAL_PREPAYMENT', label: 'Partial prepayment fee' },
];

/**
 * Waive an early repayment fee (UC-32): one person proposes, another approves;
 * the next settlement or prepayment of that kind is charged no fee.
 */
export function FeeWaiverPanel({ loanId, tasks, can, onDone, onClose }: {
    loanId: string; tasks: ApprovalTask[];
    can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const [kind, setKind] = useState('EARLY_SETTLEMENT');
    const [reason, setReason] = useState('');
    const [expiresOn, setExpiresOn] = useState('');
    const { busy, error, run, clearError } = useAction();
    const waivers = tasks.filter((t) => t.action === 'FEE_WAIVER' && (t.status === 'PENDING' || t.status === 'APPROVED'));
    const propose = can('loan.fee_waiver.propose');
    const approve = can('loan.fee_waiver.approve');
    const kindOf = (t: ApprovalTask) => (t.payload as { kind?: string } | undefined)?.kind ?? '';

    const submit = async () => {
        const res = await run('propose', () => api.post(`/lending/loans/${loanId}/fee-waivers`, clean({ kind, reason: reason.trim(), expiresOn })));
        if (res) onDone('Waiver proposed — a different user must approve it');
    };
    const decide = async (taskId: string, ok: boolean) => {
        const res = await run(`${taskId}:${ok}`, () => api.post(`/lending/loans/${loanId}/fee-waivers/${taskId}/decision`, { approve: ok }));
        if (res) onDone(ok ? 'Waiver approved — it applies to the next payment of that kind' : 'Waiver rejected');
    };

    return (
        <ActionPanel title="Fee waiver" onClose={onClose}>
            {waivers.map((t) => (
                <Notice key={t.id} tone={t.status === 'APPROVED' ? 'success' : 'warn'} title={`${KINDS.find((k) => k.value === kindOf(t))?.label ?? kindOf(t)} — ${t.status === 'APPROVED' ? 'approved, not yet used' : 'awaiting approval'}`}>
                    <p>Proposed by <span>{t.makerEmail ?? t.makerId.slice(0, 8)}</span>.</p>
                    {t.status === 'PENDING' && (
                        <div className="flex gap-2 mt-2">
                            <Btn size="sm" variant="primary" onClick={() => decide(t.id, true)} busy={busy === `${t.id}:true`} disabled={!approve.allowed} reason={approve.reason}>Approve</Btn>
                            <Btn size="sm" variant="danger" onClick={() => decide(t.id, false)} busy={busy === `${t.id}:false`} disabled={!approve.allowed} reason={approve.reason}>Reject</Btn>
                        </div>
                    )}
                </Notice>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Fee"><SelectInput value={kind} onChange={setKind} options={KINDS} /></Field>
                <Field label="Expires on" hint="Optional"><TextInput type="date" value={expiresOn} onChange={setExpiresOn} /></Field>
                <Field label="Reason"><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'propose'} disabled={!propose.allowed || reason.trim().length < 3} reason={propose.reason}>Propose waiver</Btn>
        </ActionPanel>
    );
}
