"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, TextArea } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { ApprovalTask } from '../types';
import { Person } from '../People';
import { useTranslations } from 'next-intl';

export function WriteOffPanel({ loanId, currency, tasks, can, onDone, onClose }: {
    loanId: string; currency: string; tasks: ApprovalTask[]; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const tl = useTranslations('LendingServicing.writeOff');
    const confirm = useConfirm();
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const pending = tasks.filter((t) => t.action.includes('WRITE_OFF') && t.status === 'PENDING');
    const propose = can('loan.writeoff.propose');
    const approve = can('loan.writeoff.approve');

    const submit = async () => {
        if (reason.trim().length < 3) { setProblem(tl('reasonTooShort')); return; }
        setProblem('');
        const res = await run('propose', () => api.post(`/lending/loans/${loanId}/write-offs`, { reason: reason.trim() }));
        if (res) {
            setReason('');
            onDone(tl('proposed'));
        }
    };

    const decide = async (task: ApprovalTask, ok: boolean) => {
        const confirmed = await confirm({
            title: ok ? tl('approveTitle') : tl('rejectTitle'),
            message: ok
                ? (task.amount ? tl('approveMessageAmount', { currency, amount: task.amount }) : tl('approveMessage'))
                : tl('rejectMessage'),
            confirmLabel: ok ? tl('approveTitle') : tl('reject'),
            variant: ok ? 'danger' : 'default',
        });
        if (!confirmed) return;
        const body = { approve: ok };
        const k = key.keyFor({ taskId: task.id, ...body });
        const res = await run(`decide-${task.id}`, () => api.post(`/lending/loans/${loanId}/write-offs/${task.id}/decision`, body, idem(k)));
        if (res) {
            key.reset();
            onDone(ok ? tl('approved') : tl('rejected'));
        }
    };

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            {pending.length === 0 ? (
                <>
                    <Field label={tl('reason')} error={problem || undefined}>
                        <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} />
                    </Field>
                    <Btn variant="danger" onClick={submit} busy={busy === 'propose'} disabled={!propose.allowed} reason={propose.reason}>{tl('propose')}</Btn>
                </>
            ) : pending.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <StatusBadge status={t.status} />
                    <span>{tl('proposal')} {t.amount && <Money value={t.amount} currency={t.currency ?? currency} />}</span>
                    <span className="font-mono text-[11px] text-[#8792A2]">{tl.rich('maker', { who: () => <Person id={t.makerId} /> })}</span>
                    <Btn size="sm" variant="danger" onClick={() => decide(t, true)} busy={busy === `decide-${t.id}`} disabled={!approve.allowed} reason={approve.reason}>{tl('approve')}</Btn>
                    <Btn size="sm" onClick={() => decide(t, false)} disabled={!approve.allowed || busy === `decide-${t.id}`} reason={approve.reason}>{tl('reject')}</Btn>
                </div>
            ))}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
