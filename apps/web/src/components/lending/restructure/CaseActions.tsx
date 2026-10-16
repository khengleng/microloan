"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { RestructureCase } from '../types';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, JsonBlock, Notice, Table, TextArea, TextInput, td, th } from '../ui';
import { clean, idem, useAction, useIdempotencyKey, type ApiErrorInfo } from '../useAsync';
import { PRE_EXECUTION_STATUSES } from './labels';

type Diff = { field: string; proposed: string; actual: string };

/** Explains a PROPOSAL_STALE conflict and lists the balance differences. */
export function StaleProposalNotice({ error }: { error: ApiErrorInfo }) {
    const diffs = error.body?.differences;
    const rows = Array.isArray(diffs) ? (diffs as Diff[]) : null;
    return (
        <div className="border-2 border-red-300 bg-red-50 rounded-md p-4 space-y-2 text-[13px] text-red-900" role="alert">
            <p className="font-bold">Balances changed since the proposal was accepted — execution stopped.</p>
            <p>
                The loan&apos;s balances no longer match the snapshot the customer accepted. Nothing was changed. Create a new proposal from fresh
                figures; it needs <b>renewed credit approval</b> and <b>renewed customer acceptance</b> before it can be executed.
            </p>
            {rows ? (
                <Table className="bg-white rounded border border-red-200">
                    <thead><tr className="border-b border-red-200"><th className={th}>Field</th><th className={th}>In accepted proposal</th><th className={th}>Now</th></tr></thead>
                    <tbody className="divide-y divide-red-100">
                        {rows.map((d) => (
                            <tr key={d.field}><td className={`${td} font-mono text-[12px]`}>{d.field}</td><td className={`${td} tabular-nums`}>{String(d.proposed)}</td><td className={`${td} tabular-nums font-semibold`}>{String(d.actual)}</td></tr>
                        ))}
                    </tbody>
                </Table>
            ) : diffs !== undefined ? <JsonBlock value={diffs} /> : null}
        </div>
    );
}

/** Case-level actions: execute, reverse, reject, withdraw. */
export function CaseActions({ c, onChanged }: { c: RestructureCase; onChanged: () => void }) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();
    const execKey = useIdempotencyKey();
    const revKey = useIdempotencyKey();
    const [panel, setPanel] = useState<'none' | 'execute' | 'reverse' | 'reject' | 'withdraw'>('none');
    const [note, setNote] = useState('');
    const [externalReference, setExtRef] = useState('');

    const hasAccepted = c.proposals.some((p) => p.status === 'ACCEPTED');
    const executedAmendment = (c.amendments ?? []).some((a) => (a.status ?? 'EXECUTED') === 'EXECUTED');
    const open = PRE_EXECUTION_STATUSES.includes(c.status);
    const outstanding = (c.conditions ?? []).filter((x) => x.status === 'OUTSTANDING').length;
    const noteOk = note.trim().length >= 3;

    const open_ = (p: typeof panel) => { clearError(); setNote(''); setPanel(panel === p ? 'none' : p); };
    const done = (msg: string) => { showToast(msg, 'success'); setPanel('none'); setNote(''); onChanged(); };

    const execute = async () => {
        const body = clean({ externalReference: externalReference.trim() });
        const key = execKey.keyFor({ caseId: c.id, ...body });
        const res = await run('execute', () => api.post(`/lending/restructures/${c.id}/execute`, body, idem(key)));
        if (res) { execKey.reset(); done('Restructure executed — the loan now follows the new schedule'); }
    };
    const reverse = async () => {
        const ok = await confirm({ title: 'Reverse restructure?', message: 'This restores the loan to its previous agreement and reverses the accounting. Continue?', confirmLabel: 'Reverse', variant: 'danger' });
        if (!ok) return;
        const body = { note: note.trim() };
        const key = revKey.keyFor({ caseId: c.id, ...body });
        const res = await run('reverse', () => api.post(`/lending/restructures/${c.id}/reverse`, body, idem(key)));
        if (res) { revKey.reset(); done('Restructure reversed'); }
    };
    const simple = (kind: 'reject' | 'withdraw') => async () => {
        const res = await run(kind, () => api.post(`/lending/restructures/${c.id}/${kind}`, { note: note.trim() }));
        if (res) done(kind === 'reject' ? 'Case rejected' : 'Case withdrawn');
    };

    const stale = error?.code === 'PROPOSAL_STALE';

    return (
        <Card title="Case actions">
            <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    <Btn variant="primary" disabled={!hasAccepted || outstanding > 0} reason={!hasAccepted ? 'No accepted proposal' : outstanding ? `${outstanding} condition(s) outstanding` : undefined} onClick={() => open_('execute')}>Execute…</Btn>
                    <Btn variant="danger" disabled={!executedAmendment || c.status === 'REVERSED'} reason={!executedAmendment ? 'Nothing executed to reverse' : undefined} onClick={() => open_('reverse')}>Reverse…</Btn>
                    <Btn variant="danger" disabled={!open} reason={!open ? 'Case is not open' : undefined} onClick={() => open_('reject')}>Reject case…</Btn>
                    <Btn disabled={!open} reason={!open ? 'Case is not open' : undefined} onClick={() => open_('withdraw')}>Withdraw…</Btn>
                </div>

                {panel === 'execute' && (
                    <ActionPanel title="Execute the accepted proposal" onClose={() => setPanel('none')}>
                        <p className="text-[12px] text-[#697386]">
                            Balances are re-checked against the accepted snapshot. If they changed materially, execution stops and a new proposal is required.
                        </p>
                        <Field label="External reference (optional)"><TextInput value={externalReference} onChange={setExtRef} maxLength={120} /></Field>
                        {stale ? <StaleProposalNotice error={error} /> : <ErrorBox error={error} onDismiss={clearError} />}
                        <Btn variant="primary" busy={busy === 'execute'} onClick={execute}>Execute restructure</Btn>
                    </ActionPanel>
                )}
                {(panel === 'reverse' || panel === 'reject' || panel === 'withdraw') && (
                    <ActionPanel title={panel === 'reverse' ? 'Reverse the executed amendment' : panel === 'reject' ? 'Reject this case' : 'Withdraw this case'} onClose={() => setPanel('none')}>
                        {panel === 'reverse' && <Notice tone="warn">Reversal is only possible if no financial activity has been posted since execution.</Notice>}
                        <Field label="Reason" hint="At least 3 characters."><TextArea value={note} onChange={setNote} rows={2} maxLength={500} /></Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn
                            variant={panel === 'withdraw' ? 'primary' : 'danger'}
                            busy={busy === panel}
                            disabled={!noteOk}
                            onClick={panel === 'reverse' ? reverse : simple(panel)}
                        >
                            {panel === 'reverse' ? 'Reverse' : panel === 'reject' ? 'Reject case' : 'Withdraw case'}
                        </Btn>
                    </ActionPanel>
                )}
            </div>
        </Card>
    );
}

/** Conditions precedent with "mark satisfied". */
export function ConditionsPanel({ c, onChanged }: { c: RestructureCase; onChanged: () => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [active, setActive] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const conditions = (c.conditions ?? []) as (RestructureCase['conditions'][number] & { evidence?: string | null; resolvedBy?: string | null; resolvedAt?: string | null; mandatory?: boolean })[];

    const satisfy = async (code: string) => {
        const res = await run(code, () => api.post(`/lending/restructures/${c.id}/conditions/${encodeURIComponent(code)}`, { note: note.trim() }));
        if (res) { showToast(`Condition ${code} satisfied`, 'success'); setActive(null); setNote(''); onChanged(); }
    };

    return (
        <Card title="Conditions" subtitle="Must be satisfied before the accepted proposal can be executed." bodyClass="p-0">
            {conditions.length === 0 ? <Empty>No conditions on this case.</Empty> : (
                <div className="divide-y divide-[#F0F2F5]">
                    {conditions.map((x) => (
                        <div key={x.code} className="px-5 py-3 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p className="text-[13px] font-semibold text-[#1A1F36]">{x.label} {x.mandatory === false && <span className="text-[11px] text-[#697386]">(optional)</span>}</p>
                                    <p className="font-mono text-[11px] text-[#8792A2]">{x.code}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <StatusBadge status={x.status} />
                                    {x.status === 'OUTSTANDING' && <Btn size="sm" onClick={() => { clearError(); setNote(''); setActive(active === x.code ? null : x.code); }}>Mark satisfied…</Btn>}
                                </div>
                            </div>
                            {(x.evidence || x.note) && <p className="text-[12px] text-[#3C4257]">Evidence: {x.evidence ?? x.note}{x.resolvedBy ? ` — ${x.resolvedBy}` : ''}{x.resolvedAt ? `, ${fmtDateTime(x.resolvedAt)}` : ''}</p>}
                            {active === x.code && (
                                <ActionPanel title={`Satisfy ${x.code}`} onClose={() => setActive(null)}>
                                    <Field label="Evidence / note" hint="At least 3 characters."><TextArea value={note} onChange={setNote} rows={2} maxLength={500} /></Field>
                                    <ErrorBox error={error} onDismiss={clearError} />
                                    <Btn variant="primary" busy={busy === x.code} disabled={note.trim().length < 3} onClick={() => satisfy(x.code)}>Mark satisfied</Btn>
                                </ActionPanel>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}
