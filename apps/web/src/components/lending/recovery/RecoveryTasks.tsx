"use client";

import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Btn, ErrorBox, Notice } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import { fmtDateTime } from '../format';
import { Person } from '../People';
import { TASK_ACTION, type RecoveryTask } from './types';

type Can = (code: string) => { allowed: boolean; reason?: string };

type Tr = ReturnType<typeof useTranslations>;

function describe(tr: Tr, t: RecoveryTask): string {
    const p = t.payload as Record<string, string | undefined>;
    switch (t.action) {
        case 'REPOSSESSION_SEIZURE': return tr('describe.seizure', { location: p.location ?? '—' });
        case 'PAWN_FORFEITURE': return tr('describe.forfeiture', { reason: p.reason ?? '' });
        case 'PREMIUM_REMITTANCE': return p.insurer ? tr('describe.remittance', { insurer: p.insurer, reference: p.reference ?? '—' }) : tr('describe.remittanceNoInsurer', { reference: p.reference ?? '—' });
        case 'INSURANCE_CLAIM': return p.coversBalance ? tr('describe.claimBalance', { event: p.eventType ?? '' }) : tr('describe.claim', { event: p.eventType ?? '' });
        case 'DEBT_SALE': return p.buyer ? tr('describe.debtSale', { buyer: p.buyer }) : tr('describe.debtSaleNoBuyer');
        case 'RECOVERY_REFUND': return p.payee ? tr('describe.refund', { payee: p.payee }) : tr('describe.refundNoPayee');
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
    const tr = useTranslations('LendingRecovery.tasks');
    const tt = useTranslations('LendingRecovery.task');
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    if (tasks.length === 0) return null;

    const decide = async (t: RecoveryTask, approve: boolean) => {
        const ok = await confirm({
            title: approve ? tr('approveTitle', { task: tt(t.action) }) : tr('rejectTitle', { task: tt(t.action) }),
            message: approve ? tr('approveMessage', { description: describe(tr, t) }) : tr('rejectMessage'),
            confirmLabel: approve ? tr('approve') : tr('reject'),
            variant: approve ? 'danger' : 'default',
        });
        if (!ok) return;
        const body = { approve };
        const res = await run(`${t.id}:${approve}`, () => api.post(`/lending/loans/${loanId}/recovery-tasks/${t.id}/decision`, body, idem(key.keyFor({ taskId: t.id, ...body }))));
        if (res) {
            key.reset();
            onDone(approve ? tr('approved', { task: tt(t.action) }) : tr('rejected', { task: tt(t.action) }));
        }
    };

    return (
        <div className="space-y-2">
            {tasks.map((t) => {
                const perm = can ? can(TASK_ACTION[t.action]) : { allowed: true };
                return (
                    <Notice key={t.id} tone="warn" title={<>{tt(t.action)}{t.amount && <> · <Money value={t.amount} currency={t.currency ?? currency} /></>}</>}>
                        <p className="mb-2">{describe(tr, t)} {tr.rich('proposedBy', { who: () => <Person id={t.makerId} />, when: fmtDateTime(t.createdAt) })}</p>
                        <div className="flex gap-2">
                            <Btn size="sm" variant="primary" onClick={() => decide(t, true)} busy={busy === `${t.id}:true`} disabled={!perm.allowed} reason={perm.reason}>{tr('approve')}</Btn>
                            <Btn size="sm" variant="danger" onClick={() => decide(t, false)} busy={busy === `${t.id}:false`} disabled={!perm.allowed} reason={perm.reason}>{tr('reject')}</Btn>
                        </div>
                    </Notice>
                );
            })}
            <ErrorBox error={error} onDismiss={clearError} />
        </div>
    );
}
