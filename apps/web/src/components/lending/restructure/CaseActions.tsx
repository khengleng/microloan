"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { RestructureCase } from '../types';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { Person } from '../People';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, JsonBlock, Notice, Table, TextArea, TextInput, td, th } from '../ui';
import { clean, idem, useAction, useIdempotencyKey, type ApiErrorInfo } from '../useAsync';

/** Case states in which the API accepts each action (policy/actions.ts). */
const REJECTABLE = ['REQUESTED', 'MORE_INFO_REQUIRED', 'AFFORDABILITY_ASSESSED', 'SPECIALIST_REVIEW', 'OPTIONS_PROPOSED'];
const WITHDRAWABLE = [...REJECTABLE, 'APPROVED'];
const EXECUTABLE = ['CUSTOMER_ACCEPTED', 'CONDITIONS_SATISFIED'];
const SATISFIABLE = ['APPROVED', 'CUSTOMER_ACCEPTED'];

type Diff = { field: string; proposed: string; actual: string };

/** Explains a PROPOSAL_STALE conflict and lists the balance differences. */
export function StaleProposalNotice({ error }: { error: ApiErrorInfo }) {
    const t = useTranslations('LendingRestructure');
    const diffs = error.body?.differences;
    const rows = Array.isArray(diffs) ? (diffs as Diff[]) : null;
    return (
        <div className="border-2 border-red-300 bg-red-50 rounded-md p-4 space-y-2 text-[13px] text-red-900" role="alert">
            <p className="font-bold">{t('stale.title')}</p>
            <p>{t.rich('stale.body', { b: (c) => <b>{c}</b> })}</p>
            {rows ? (
                <Table className="bg-white rounded border border-red-200">
                    <thead><tr className="border-b border-red-200"><th className={th}>{t('stale.field')}</th><th className={th}>{t('stale.inAccepted')}</th><th className={th}>{t('stale.now')}</th></tr></thead>
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
    const t = useTranslations('LendingRestructure');
    const { showToast } = useToast();
    const confirm = useConfirm();
    const { can } = useWorkspace();
    const { busy, error, run, clearError } = useAction();
    const execKey = useIdempotencyKey();
    const revKey = useIdempotencyKey();
    const [panel, setPanel] = useState<'none' | 'execute' | 'reverse' | 'reject' | 'withdraw'>('none');
    const [note, setNote] = useState('');
    const [externalReference, setExtRef] = useState('');

    const hasAccepted = c.proposals.some((p) => p.status === 'ACCEPTED');
    const executedAmendment = (c.amendments ?? []).some((a) => (a.status ?? 'EXECUTED') === 'EXECUTED');
    const canReject = can('restructure.approve') && REJECTABLE.includes(c.status);
    const canWithdraw = can('restructure.request') && WITHDRAWABLE.includes(c.status);
    const canExecute = can('restructure.execute') && EXECUTABLE.includes(c.status);
    const canReverse = can('restructure.execute') && c.status === 'MONITORING';
    const outstanding = (c.conditions ?? []).filter((x) => x.status === 'OUTSTANDING').length;
    const noteOk = note.trim().length >= 3;

    const open_ = (p: typeof panel) => { clearError(); setNote(''); setPanel(panel === p ? 'none' : p); };
    const done = (msg: string) => { showToast(msg, 'success'); setPanel('none'); setNote(''); onChanged(); };

    const execute = async () => {
        const body = clean({ externalReference: externalReference.trim() });
        const key = execKey.keyFor({ caseId: c.id, ...body });
        const res = await run('execute', () => api.post(`/lending/restructures/${c.id}/execute`, body, idem(key)));
        if (res) { execKey.reset(); done(t('actions.toastExecuted')); }
    };
    const reverse = async () => {
        const ok = await confirm({ title: t('actions.confirmReverseTitle'), message: t('actions.confirmReverseMessage'), confirmLabel: t('actions.reverseBtn'), variant: 'danger' });
        if (!ok) return;
        const body = { note: note.trim() };
        const key = revKey.keyFor({ caseId: c.id, ...body });
        const res = await run('reverse', () => api.post(`/lending/restructures/${c.id}/reverse`, body, idem(key)));
        if (res) { revKey.reset(); done(t('actions.toastReversed')); }
    };
    const simple = (kind: 'reject' | 'withdraw') => async () => {
        const res = await run(kind, () => api.post(`/lending/restructures/${c.id}/${kind}`, { note: note.trim() }));
        if (res) done(kind === 'reject' ? t('actions.toastRejected') : t('actions.toastWithdrawn'));
    };

    const stale = error?.code === 'PROPOSAL_STALE';

    return (
        <Card title={t('actions.title')}>
            <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    {canExecute && <Btn variant="primary" disabled={!hasAccepted || outstanding > 0} reason={!hasAccepted ? t('actions.noAccepted') : outstanding ? t('actions.conditionsOutstanding', { count: outstanding }) : undefined} onClick={() => open_('execute')}>{t('actions.execute')}</Btn>}
                    {canReverse && <Btn variant="danger" disabled={!executedAmendment} reason={!executedAmendment ? t('actions.nothingToReverse') : undefined} onClick={() => open_('reverse')}>{t('actions.reverse')}</Btn>}
                    {canReject && <Btn variant="danger" onClick={() => open_('reject')}>{t('actions.reject')}</Btn>}
                    {canWithdraw && <Btn onClick={() => open_('withdraw')}>{t('actions.withdraw')}</Btn>}
                    {!canExecute && !canReverse && !canReject && !canWithdraw && <p className="text-[12px] text-[#697386]">{t('actions.noneOpen')}</p>}
                </div>

                {panel === 'execute' && (
                    <ActionPanel title={t('actions.executeTitle')} onClose={() => setPanel('none')}>
                        <p className="text-[12px] text-[#697386]">
                            {t('actions.executeBody')}
                        </p>
                        <Field label={t('actions.externalReference')}><TextInput value={externalReference} onChange={setExtRef} maxLength={120} /></Field>
                        {stale ? <StaleProposalNotice error={error} /> : <ErrorBox error={error} onDismiss={clearError} />}
                        <Btn variant="primary" busy={busy === 'execute'} onClick={execute}>{t('actions.executeBtn')}</Btn>
                    </ActionPanel>
                )}
                {(panel === 'reverse' || panel === 'reject' || panel === 'withdraw') && (
                    <ActionPanel title={panel === 'reverse' ? t('actions.reverseTitle') : panel === 'reject' ? t('actions.rejectTitle') : t('actions.withdrawTitle')} onClose={() => setPanel('none')}>
                        {panel === 'reverse' && <Notice tone="warn">{t('actions.reverseNotice')}</Notice>}
                        <Field label={t('common.reason')} hint={t('common.atLeast3')}><TextArea value={note} onChange={setNote} rows={2} maxLength={500} /></Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn
                            variant={panel === 'withdraw' ? 'primary' : 'danger'}
                            busy={busy === panel}
                            disabled={!noteOk}
                            onClick={panel === 'reverse' ? reverse : simple(panel)}
                        >
                            {panel === 'reverse' ? t('actions.reverseBtn') : panel === 'reject' ? t('actions.rejectBtn') : t('actions.withdrawBtn')}
                        </Btn>
                    </ActionPanel>
                )}
            </div>
        </Card>
    );
}

/** Conditions precedent with "mark satisfied". */
export function ConditionsPanel({ c, onChanged }: { c: RestructureCase; onChanged: () => void }) {
    const t = useTranslations('LendingRestructure');
    const { showToast } = useToast();
    const { can } = useWorkspace();
    const canSatisfy = can('restructure.execute') && SATISFIABLE.includes(c.status);
    const { busy, error, run, clearError } = useAction();
    const [active, setActive] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const conditions = (c.conditions ?? []) as (RestructureCase['conditions'][number] & { evidence?: string | null; resolvedBy?: string | null; resolvedAt?: string | null; mandatory?: boolean })[];

    const satisfy = async (code: string) => {
        const res = await run(code, () => api.post(`/lending/restructures/${c.id}/conditions/${encodeURIComponent(code)}`, { note: note.trim() }));
        if (res) { showToast(t('conditions.toastSatisfied', { code }), 'success'); setActive(null); setNote(''); onChanged(); }
    };

    return (
        <Card title={t('conditions.title')} subtitle={t('conditions.subtitle')} bodyClass="p-0">
            {conditions.length === 0 ? <Empty>{t('conditions.empty')}</Empty> : (
                <div className="divide-y divide-[#F0F2F5]">
                    {conditions.map((x) => (
                        <div key={x.code} className="px-5 py-3 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p className="text-[13px] font-semibold text-[#1A1F36]">{x.label} {x.mandatory === false && <span className="text-[11px] text-[#697386]">{t('conditions.optional')}</span>}</p>
                                    <p className="font-mono text-[11px] text-[#8792A2]">{x.code}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <StatusBadge status={x.status} />
                                    {x.status === 'OUTSTANDING' && canSatisfy && <Btn size="sm" onClick={() => { clearError(); setNote(''); setActive(active === x.code ? null : x.code); }}>{t('conditions.markSatisfiedOpen')}</Btn>}
                                </div>
                            </div>
                            {(x.evidence || x.note) && <p className="text-[12px] text-[#3C4257]">{t('conditions.evidence', { evidence: x.evidence ?? x.note ?? '' })}{x.resolvedBy ? <> — <Person id={x.resolvedBy} /></> : ''}{x.resolvedAt ? `, ${fmtDateTime(x.resolvedAt)}` : ''}</p>}
                            {active === x.code && (
                                <ActionPanel title={t('conditions.satisfyTitle', { code: x.code })} onClose={() => setActive(null)}>
                                    <Field label={t('conditions.evidenceNote')} hint={t('common.atLeast3')}><TextArea value={note} onChange={setNote} rows={2} maxLength={500} /></Field>
                                    <ErrorBox error={error} onDismiss={clearError} />
                                    <Btn variant="primary" busy={busy === x.code} disabled={note.trim().length < 3} onClick={() => satisfy(x.code)}>{t('conditions.markSatisfied')}</Btn>
                                </ActionPanel>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}
