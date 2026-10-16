"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, TextArea } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { ApprovalTask } from '../types';

export function WriteOffPanel({ loanId, currency, tasks, can, onDone, onClose }: {
    loanId: string; currency: string; tasks: ApprovalTask[]; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const confirm = useConfirm();
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const pending = tasks.filter((t) => t.action.includes('WRITE_OFF') && t.status === 'PENDING');
    const propose = can('loan.writeoff.propose');
    const approve = can('loan.writeoff.approve');

    const submit = async () => {
        if (reason.trim().length < 3) { setProblem('Reason must be at least 3 characters.'); return; }
        setProblem('');
        const res = await run('propose', () => api.post(`/lending/loans/${loanId}/write-offs`, { reason: reason.trim() }));
        if (res) {
            setReason('');
            onDone('Write-off proposed — awaiting approval');
        }
    };

    const decide = async (task: ApprovalTask, ok: boolean) => {
        const confirmed = await confirm({
            title: ok ? 'Approve write-off' : 'Reject write-off',
            message: ok
                ? `Write off this loan${task.amount ? ` (${currency} ${task.amount})` : ''}? Balances move to written-off and the ledger is posted.`
                : 'Reject the proposed write-off?',
            confirmLabel: ok ? 'Approve write-off' : 'Reject',
            variant: ok ? 'danger' : 'default',
        });
        if (!confirmed) return;
        const body = { approve: ok };
        const k = key.keyFor({ taskId: task.id, ...body });
        const res = await run(`decide-${task.id}`, () => api.post(`/lending/loans/${loanId}/write-offs/${task.id}/decision`, body, idem(k)));
        if (res) {
            key.reset();
            onDone(ok ? 'Write-off approved' : 'Write-off rejected');
        }
    };

    return (
        <ActionPanel title="Write-off" onClose={onClose}>
            {pending.length === 0 ? (
                <>
                    <Field label="Reason" error={problem || undefined}>
                        <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} />
                    </Field>
                    <Btn variant="danger" onClick={submit} busy={busy === 'propose'} disabled={!propose.allowed} reason={propose.reason}>Propose write-off</Btn>
                </>
            ) : pending.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <StatusBadge status={t.status} />
                    <span>Write-off proposal {t.amount && <Money value={t.amount} currency={t.currency ?? currency} />}</span>
                    <span className="font-mono text-[11px] text-[#8792A2]">maker {t.makerId.slice(0, 8)}</span>
                    <Btn size="sm" variant="danger" onClick={() => decide(t, true)} busy={busy === `decide-${t.id}`} disabled={!approve.allowed} reason={approve.reason}>Approve</Btn>
                    <Btn size="sm" onClick={() => decide(t, false)} disabled={!approve.allowed || busy === `decide-${t.id}`} reason={approve.reason}>Reject</Btn>
                </div>
            ))}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
