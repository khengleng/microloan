"use client";

import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Btn, ErrorBox, Notice } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import { fmtDateTime } from '../format';
import { TASK_ACTION, TASK_LABEL, type RecoveryTask } from './types';

type Can = (code: string) => { allowed: boolean; reason?: string };

function describe(t: RecoveryTask): string {
    const p = t.payload as Record<string, string | undefined>;
    switch (t.action) {
        case 'REPOSSESSION_SEIZURE': return `Seize the asset, held at ${p.location ?? '—'}.`;
        case 'PAWN_FORFEITURE': return `Forfeit the pawned item: ${p.reason ?? ''}`;
        case 'PREMIUM_REMITTANCE': return `Pay the premium held for ${p.insurer ?? 'the insurer'} (ref ${p.reference ?? '—'}).`;
        case 'INSURANCE_CLAIM': return p.coversBalance ? `${p.eventType} claim covering the balance on the settlement day.` : `${p.eventType} claim.`;
        case 'DEBT_SALE': return `Sell the loan to ${p.buyer ?? 'the buyer'}; the loan leaves the book.`;
        case 'RECOVERY_REFUND': return `Pay the surplus to ${p.payee ?? 'the borrower'}.`;
        default: return '';
    }
}

/**
 * Recovery tasks awaiting a second user. Approving one that moves money
 * posts it, so the request carries an idempotency key.
 */
export function RecoveryTasks({ loanId, tasks, currency, can, onDone }: {
    loanId: string; tasks: RecoveryTask[]; currency: string; can?: Can; onDone: (msg: string) => void;
}) {
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    if (tasks.length === 0) return null;

    const decide = async (t: RecoveryTask, approve: boolean) => {
        const ok = await confirm({
            title: `${approve ? 'Approve' : 'Reject'}: ${TASK_LABEL[t.action]}`,
            message: approve ? `${describe(t)} This is posted immediately.` : 'Reject this proposal?',
            confirmLabel: approve ? 'Approve' : 'Reject',
            variant: approve ? 'danger' : 'default',
        });
        if (!ok) return;
        const body = { approve };
        const res = await run(`${t.id}:${approve}`, () => api.post(`/lending/loans/${loanId}/recovery-tasks/${t.id}/decision`, body, idem(key.keyFor({ taskId: t.id, ...body }))));
        if (res) {
            key.reset();
            onDone(`${TASK_LABEL[t.action]} ${approve ? 'approved' : 'rejected'}`);
        }
    };

    return (
        <div className="space-y-2">
            {tasks.map((t) => {
                const perm = can ? can(TASK_ACTION[t.action]) : { allowed: true };
                return (
                    <Notice key={t.id} tone="warn" title={<>{TASK_LABEL[t.action]}{t.amount && <> · <Money value={t.amount} currency={t.currency ?? currency} /></>}</>}>
                        <p className="mb-2">{describe(t)} Proposed by <span className="font-mono">{t.makerId.slice(0, 8)}</span> on {fmtDateTime(t.createdAt)}. A different user must decide it.</p>
                        <div className="flex gap-2">
                            <Btn size="sm" variant="primary" onClick={() => decide(t, true)} busy={busy === `${t.id}:true`} disabled={!perm.allowed} reason={perm.reason}>Approve</Btn>
                            <Btn size="sm" variant="danger" onClick={() => decide(t, false)} busy={busy === `${t.id}:false`} disabled={!perm.allowed} reason={perm.reason}>Reject</Btn>
                        </div>
                    </Notice>
                );
            })}
            <ErrorBox error={error} onDismiss={clearError} />
        </div>
    );
}
