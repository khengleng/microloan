"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, Checkbox, ErrorBox, Field, TextInput } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import type { FinancialEvent } from '../types';

/** Only POSTED repayments and advance applications can be reversed (server enforces the same rule). */
export function isReversible(e: FinancialEvent): boolean {
    return e.status === 'POSTED' && (e.type === 'REPAYMENT' || e.type === 'ADVANCE_APPLIED') && !e.reversalOfId;
}

export function ReverseEventForm({ loanId, event, can, onDone, onClose }: {
    loanId: string; event: FinancialEvent; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const confirm = useConfirm();
    const [reason, setReason] = useState('');
    const [returned, setReturned] = useState(false);
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.repayment.reverse');

    const reverse = async () => {
        if (reason.trim().length < 3) { setProblem('Reason must be at least 3 characters.'); return; }
        setProblem('');
        const ok = await confirm({
            title: 'Reverse event',
            message: `Reverse the ${event.type} of ${event.amount} on ${event.valueDate.slice(0, 10)}? A compensating event is posted; the original stays in the history.`,
            confirmLabel: 'Reverse',
            variant: 'danger',
        });
        if (!ok) return;
        const body = event.type === 'REPAYMENT' && returned ? { reason: reason.trim(), returned: true } : { reason: reason.trim() };
        const k = key.keyFor({ eventId: event.id, ...body });
        const res = await run('reverse', () => api.post(`/lending/loans/${loanId}/events/${event.id}/reverse`, body, idem(k)));
        if (res) {
            key.reset();
            onDone('Event reversed');
        }
    };

    return (
        <ActionPanel title={`Reverse ${event.type} · ${event.amount}`} onClose={onClose}>
            <Field label="Reason" error={problem || undefined}>
                <TextInput value={reason} onChange={setReason} maxLength={500} />
            </Field>
            {event.type === 'REPAYMENT' && (
                <Checkbox checked={returned} onChange={setReturned} label="The payment bounced or was returned — charge the product's returned-payment fee" />
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="danger" onClick={reverse} busy={busy === 'reverse'} disabled={!allowed.allowed} reason={allowed.reason}>Reverse event</Btn>
        </ActionPanel>
    );
}
