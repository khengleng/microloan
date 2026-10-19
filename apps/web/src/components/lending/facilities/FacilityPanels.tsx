"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
    const tl = useTranslations('LendingFacilities.panels.repayment');

    const post = async () => {
        const a = amount.trim();
        if (!MONEY_RE.test(a) || !/[1-9]/.test(a)) { setProblem(tl('amountInvalid')); return; }
        setProblem('');
        const body = clean({ amount: a, valueDate, externalReference: externalReference.trim() });
        const k = key.keyFor(body);
        const res = await run('repay', () => api.post<{ eventId: string; applied: Record<string, string> }>(`/lending/facilities/${facilityId}/repayments`, body, idem(k)));
        if (res) {
            key.reset();
            const parts = Object.entries(res.data.applied ?? {}).filter(([, v]) => /[1-9]/.test(v)).map(([k2, v]) => tl('appliedPart', { component: tl.has(`components.${k2}`) ? tl(`components.${k2}`) : k2.toLowerCase(), amount: v }));
            onDone(parts.length ? tl('postedApplied', { currency, amount: a, parts: parts.join(', ') }) : tl('posted', { currency, amount: a }));
        }
    };

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={tl('amount', { currency })} hint={tl('amountHint', { currency, outstanding })} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label={tl('valueDate')} hint={tl('valueDateHint')}>
                    <TextInput type="date" value={valueDate} onChange={setValueDate} />
                </Field>
                <Field label={tl('externalReference')} hint={tl('optional')}>
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">{tl('note')}</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'repay'} disabled={!allowed.allowed} reason={allowed.reason}>{tl('title')}</Btn>
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
    const tl = useTranslations('LendingFacilities.panels.statement');

    const generate = async () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) { setProblem(tl('chooseEnd')); return; }
        if (periodEnd <= periodStart) { setProblem(tl('endAfterStart', { start: periodStart })); return; }
        setProblem('');
        const ok = await confirm({
            title: tl('title'),
            message: tl('confirmMessage', { start: periodStart, end: periodEnd }),
            confirmLabel: tl('confirm'),
        });
        if (!ok) return;
        const body = { periodEnd };
        const k = key.keyFor(body);
        const res = await run('statement', () => api.post<{ statement: FacilityStatementRow }>(`/lending/facilities/${facilityId}/statements`, body, idem(k)));
        if (res) {
            key.reset();
            const st = res.data.statement;
            onDone(tl('generated', { sequence: st.sequence, currency, charges: st.chargesRaised }));
        }
    };

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            <div className="flex flex-wrap items-end gap-3">
                <Field label={tl('periodStart')}>
                    <TextInput value={periodStart} onChange={() => undefined} disabled className="w-40" />
                </Field>
                <Field label={tl('periodEnd')} hint={tl('periodEndHint')} error={problem || undefined}>
                    <TextInput type="date" value={periodEnd} onChange={setPeriodEnd} min={periodStart} className="w-44" />
                </Field>
                <Btn variant="primary" onClick={generate} busy={busy === 'statement'}>{tl('title')}</Btn>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/* ── Status ──────────────────────────────────────────────────────────────── */

const MOVES: Record<string, { from: string[] }> = {
    SUSPEND: { from: ['PENDING', 'ACTIVE'] },
    REINSTATE: { from: ['SUSPENDED'] },
    EXPIRE: { from: ['ACTIVE', 'SUSPENDED'] },
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
    const tl = useTranslations('LendingFacilities.panels.status');
    const ts = useTranslations('Status');
    const statusLabel = (s: string) => (ts.has(s) ? ts(s) : s.toLowerCase().replace(/_/g, ' '));

    const submit = async () => {
        if (!action) return;
        if (action === 'SUSPEND' && !reason.trim()) { setProblem(tl('reasonRequired')); return; }
        setProblem('');
        const ok = await confirm({
            title: tl('confirmTitle'),
            message: tl(`confirmMessage.${action}`),
            confirmLabel: tl('confirm'),
            variant: action === 'REINSTATE' ? 'default' : 'danger',
        });
        if (!ok) return;
        const res = await run('status', () => api.post<{ status: string }>(`/lending/facilities/${facilityId}/status`, clean({ action, reason: reason.trim() })));
        if (res) onDone(tl('changed', { status: statusLabel(res.data.status) }));
    };

    if (moves.length === 0) {
        return (
            <ActionPanel title={tl('title')} onClose={onClose}>
                <p className="text-[13px] text-[#697386]">{tl('noMoves', { status: statusLabel(status) })}</p>
            </ActionPanel>
        );
    }

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={tl('action')}>
                    <SelectInput value={action} onChange={setAction} options={moves.map((m) => ({ value: m, label: tl(`moves.${m}`) }))} />
                </Field>
                <Field label={action === 'SUSPEND' ? tl('reason') : tl('reasonOptional')} error={problem || undefined} className="sm:col-span-2">
                    <TextArea value={reason} onChange={setReason} maxLength={500} rows={2} />
                </Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant={action === 'REINSTATE' ? 'primary' : 'danger'} onClick={submit} busy={busy === 'status'}>{tl('apply')}</Btn>
        </ActionPanel>
    );
}

/* ── Term-out ────────────────────────────────────────────────────────────── */

export function TermOutPanel({ facilityId, currency, availabilityEnd, maturityDate, onDone, onClose }: DoneProps & {
    currency: string; availabilityEnd: string; maturityDate: string;
}) {
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();
    const tl = useTranslations('LendingFacilities.panels.termOut');

    const submit = async () => {
        const ok = await confirm({
            title: tl('confirmTitle'),
            message: tl('confirmMessage', { availabilityEnd, maturityDate }),
            confirmLabel: tl('title'),
            variant: 'danger',
        });
        if (!ok) return;
        const res = await run('termout', () => api.post<TermOutPlan>(`/lending/facilities/${facilityId}/term-out`));
        if (res) onDone(tl('done', { date: res.data.effectiveDate, currency, principal: res.data.principal, months: res.data.months }));
    };

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            <p className="text-[13px] text-[#3C4257]">
                {tl('body', { availabilityEnd, maturityDate })}
            </p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="danger" onClick={submit} busy={busy === 'termout'}>{tl('title')}</Btn>
        </ActionPanel>
    );
}
