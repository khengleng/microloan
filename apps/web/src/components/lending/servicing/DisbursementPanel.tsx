"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { ApprovalTask } from '../types';

type Can = (code: string) => { allowed: boolean; reason?: string };

/** Prepare → approve (four-eyes) → execute. */
export function DisbursementPanel({ loanId, currency, tasks, can, onDone, onClose }: {
    loanId: string; currency: string; tasks: ApprovalTask[]; can: Can; onDone: (msg: string) => void; onClose: () => void;
}) {
    const confirm = useConfirm();
    const [valueDate, setValueDate] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const execKey = useIdempotencyKey();

    const disb = tasks.filter((t) => t.action.includes('DISBURSE'));
    const pending = disb.filter((t) => t.status === 'PENDING');
    const approved = disb.filter((t) => t.status === 'APPROVED');
    const prep = can('loan.disbursement.prepare');
    const appr = can('loan.disbursement.approve');
    const exec = can('loan.disbursement.execute');

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
        const body = { externalReference: externalReference.trim() };
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
