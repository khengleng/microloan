"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, SelectInput, TextArea, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import { MONEY_RE, type Can, type FacilityStatementRow, type TermOutPlan } from './types';

type DoneProps = { facilityId: string; onDone: (msg: string) => void; onClose: () => void };

/* ── Repayment ───────────────────────────────────────────────────────────── */

/**
 * Repay against the facility. The server clears penalty, fees, interest and
 * then principal straight off the loan account's balances; paying more than is
 * owed is refused.
 */
export function FacilityRepaymentPanel({ facilityId, currency, outstanding, can, onDone, onClose }: DoneProps & {
    currency: string; outstanding: string; can: Can;
}) {
    const [amount, setAmount] = useState('');
    const [valueDate, setValueDate] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.repayment.post');

    const post = async () => {
        const a = amount.trim();
        if (!MONEY_RE.test(a) || !/[1-9]/.test(a)) { setProblem('Enter a positive decimal amount (up to 4 decimals).'); return; }
        setProblem('');
        const body = clean({ amount: a, valueDate, externalReference: externalReference.trim() });
        const k = key.keyFor(body);
        const res = await run('repay', () => api.post<{ eventId: string; applied: Record<string, string> }>(`/lending/facilities/${facilityId}/repayments`, body, idem(k)));
        if (res) {
            key.reset();
            const parts = Object.entries(res.data.applied ?? {}).filter(([, v]) => /[1-9]/.test(v)).map(([k2, v]) => `${k2.toLowerCase()} ${v}`);
            onDone(`Repayment of ${currency} ${a} posted${parts.length ? ` — ${parts.join(', ')}` : ''}`);
        }
    };

    return (
        <ActionPanel title="Post repayment" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={`Amount (${currency})`} hint={`Principal outstanding: ${currency} ${outstanding}`} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label="Value date" hint="Optional — defaults to the business date">
                    <TextInput type="date" value={valueDate} onChange={setValueDate} />
                </Field>
                <Field label="External reference" hint="Optional">
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">Applied to penalty, fees, interest, then principal. On a revolving line or overdraft, repaid principal becomes available to draw again. Retrying the same payment reuses its idempotency key.</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'repay'} disabled={!allowed.allowed} reason={allowed.reason}>Post repayment</Btn>
        </ActionPanel>
    );
}

/* ── Statement ───────────────────────────────────────────────────────────── */

/**
 * Close a statement period: raises the period's interest, over-limit interest
 * and commitment fee as receivables. Periods never overlap — the next one
 * starts where the last ended.
 */
export function StatementPanel({ facilityId, currency, periodStart, onDone, onClose }: DoneProps & {
    currency: string; periodStart: string;
}) {
    const confirm = useConfirm();
    const [periodEnd, setPeriodEnd] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();

    const generate = async () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) { setProblem('Choose the date the period closes on.'); return; }
        if (periodEnd <= periodStart) { setProblem(`The period starts on ${periodStart}; it must close after that.`); return; }
        setProblem('');
        const ok = await confirm({
            title: 'Generate statement',
            message: `Close the period ${periodStart} → ${periodEnd}? Interest and fees for the period are posted to the facility's loan account.`,
            confirmLabel: 'Generate',
        });
        if (!ok) return;
        const body = { periodEnd };
        const k = key.keyFor(body);
        const res = await run('statement', () => api.post<{ statement: FacilityStatementRow }>(`/lending/facilities/${facilityId}/statements`, body, idem(k)));
        if (res) {
            key.reset();
            const st = res.data.statement;
            onDone(`Statement #${st.sequence} generated — charges ${currency} ${st.chargesRaised}`);
        }
    };

    return (
        <ActionPanel title="Generate statement" onClose={onClose}>
            <div className="flex flex-wrap items-end gap-3">
                <Field label="Period start">
                    <TextInput value={periodStart} onChange={() => undefined} disabled className="w-40" />
                </Field>
                <Field label="Period end" hint="Exclusive; not after the business date" error={problem || undefined}>
                    <TextInput type="date" value={periodEnd} onChange={setPeriodEnd} min={periodStart} className="w-44" />
                </Field>
                <Btn variant="primary" onClick={generate} busy={busy === 'statement'}>Generate statement</Btn>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/* ── Status ──────────────────────────────────────────────────────────────── */

const MOVES: Record<string, { from: string[]; label: string }> = {
    SUSPEND: { from: ['PENDING', 'ACTIVE'], label: 'Suspend — stop further drawdowns' },
    REINSTATE: { from: ['SUSPENDED'], label: 'Reinstate — reopen for drawdowns' },
    EXPIRE: { from: ['ACTIVE', 'SUSPENDED'], label: 'Expire — end availability now' },
};

export function availableStatusMoves(status: string): string[] {
    return Object.keys(MOVES).filter((k) => MOVES[k].from.includes(status));
}

export function StatusPanel({ facilityId, status, onDone, onClose }: DoneProps & { status: string }) {
    const confirm = useConfirm();
    const moves = availableStatusMoves(status);
    const [action, setAction] = useState(moves[0] ?? '');
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();

    const submit = async () => {
        if (!action) return;
        if (action === 'SUSPEND' && !reason.trim()) { setProblem('Give a reason for suspending the facility.'); return; }
        setProblem('');
        const ok = await confirm({
            title: 'Change facility status',
            message: `${action.charAt(0)}${action.slice(1).toLowerCase()} this facility?`,
            confirmLabel: 'Confirm',
            variant: action === 'REINSTATE' ? 'default' : 'danger',
        });
        if (!ok) return;
        const res = await run('status', () => api.post<{ status: string }>(`/lending/facilities/${facilityId}/status`, clean({ action, reason: reason.trim() })));
        if (res) onDone(`Facility is now ${res.data.status.toLowerCase().replace(/_/g, ' ')}`);
    };

    if (moves.length === 0) {
        return (
            <ActionPanel title="Change status" onClose={onClose}>
                <p className="text-[13px] text-[#697386]">A {status.toLowerCase().replace(/_/g, ' ')} facility has no status changes available.</p>
            </ActionPanel>
        );
    }

    return (
        <ActionPanel title="Change status" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Action">
                    <SelectInput value={action} onChange={setAction} options={moves.map((m) => ({ value: m, label: MOVES[m].label }))} />
                </Field>
                <Field label={action === 'SUSPEND' ? 'Reason' : 'Reason (optional)'} error={problem || undefined} className="sm:col-span-2">
                    <TextArea value={reason} onChange={setReason} maxLength={500} rows={2} />
                </Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant={action === 'REINSTATE' ? 'primary' : 'danger'} onClick={submit} busy={busy === 'status'}>Apply</Btn>
        </ActionPanel>
    );
}

/* ── Term-out ────────────────────────────────────────────────────────────── */

export function TermOutPanel({ facilityId, currency, availabilityEnd, maturityDate, onDone, onClose }: DoneProps & {
    currency: string; availabilityEnd: string; maturityDate: string;
}) {
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();

    const submit = async () => {
        const ok = await confirm({
            title: 'Term out facility',
            message: `Convert the balance drawn at ${availabilityEnd} into a term loan amortizing to ${maturityDate}? No further drawdowns will be possible.`,
            confirmLabel: 'Term out',
            variant: 'danger',
        });
        if (!ok) return;
        const res = await run('termout', () => api.post<TermOutPlan>(`/lending/facilities/${facilityId}/term-out`));
        if (res) onDone(`Termed out from ${res.data.effectiveDate}: ${currency} ${res.data.principal} over ${res.data.months} month(s)`);
    };

    return (
        <ActionPanel title="Term out" onClose={onClose}>
            <p className="text-[13px] text-[#3C4257]">
                Once availability has ended ({availabilityEnd}), the balance drawn at that date amortizes over the whole months remaining to maturity ({maturityDate}).
                Open drawdown requests must be settled first, and the product must allow term-out on expiry.
            </p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="danger" onClick={submit} busy={busy === 'termout'}>Term out</Btn>
        </ActionPanel>
    );
}
