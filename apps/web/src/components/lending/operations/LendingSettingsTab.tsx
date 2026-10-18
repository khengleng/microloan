"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { JsonDiff } from '../JsonDiff';
import { jsonDiff } from '../policies/types';
import { StatusBadge } from '../StatusBadge';
import { Btn, Card, Empty, ErrorBox, Field, Notice, Spinner, Table, TextArea, td, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { fmtDateTime } from '../format';

interface SettingsRow {
    id: string; version: number; status: string; settings: unknown; makerId: string; checkerId: string | null;
    decidedAt: string | null; reason: string; createdAt: string;
}
interface SettingsList { active: SettingsRow | null; versions: SettingsRow[]; effective: Record<string, unknown>; defaults: Record<string, unknown> }

/** What each setting means, for the read-only view. Keys are dotted paths. */
const LABELS: Record<string, string> = {
    'regulatory.classes': 'Regulatory loan classes (days past due → provision rate)',
    'regulatory.sizeBandEdgesUsd': 'Regulatory return: loan-size band edges (USD)',
    'regulatory.sizeBandKhrPerUsd': 'Regulatory return: KHR per USD for the size bands',
    'regulatory.rateBandEdgesPct': 'Regulatory return: interest-rate band edges (% a year)',
    'accounting.cash': 'Cash / bank account',
    'accounting.retainedEarnings': 'Retained earnings (year-end close)',
    'accounting.migrationClearing': 'Migration clearing (opening balances)',
    'accounting.fxPosition': 'FX position',
    'accounting.fxGainLoss': 'FX gain / loss',
    'accounting.unidentifiedSuspense': 'Unidentified receipts (suspense)',
    'accounting.legacy.loansReceivable': 'Original loan book: loans receivable',
    'accounting.legacy.interestIncome': 'Original loan book: interest income',
    'accounting.legacy.penaltyIncome': 'Original loan book: penalty income',
    'accounting.legacy.feeIncome': 'Original loan book: fee income',
    'accounting.legacy.loanLossAllowance': 'Original loan book: loan-loss allowance',
    'accounting.legacy.provisionExpense': 'Original loan book: provision expense',
    'accounting.legacy.writeOffExpense': 'Original loan book: write-off expense',
    'payments.maxFileLines': 'Payment files: most lines per file',
    'payments.maxBackdateDays': 'Unidentified receipts and payment files: most days back-dated',
    'access.maxDelegationDays': 'Longest delegation of authority (days)',
    'legacyServicing.defaultAfterDaysOverdue': 'Original loan book: mark DEFAULTED after days overdue',
    'scoring.monitoring.badDaysPastDue': 'Scorecard monitoring: a loan is bad once an instalment is this many days late',
    'scoring.monitoring.performanceMonths': 'Scorecard monitoring: … within this many months of disbursement',
    'scoring.monitoring.baselineWindowDays': 'Scorecard monitoring: baseline window for stability (days)',
    'scoring.monitoring.recentWindowDays': 'Scorecard monitoring: recent window for stability (days)',
    'scoring.monitoring.psiEpsilon': 'Scorecard monitoring: share given to an empty grade in the stability index',
    'scoring.consent.maxValidityDays': 'Alternative data: longest a customer consent may run (days)',
    'scoring.alternativeData.maxRecordAgeDays': 'Alternative data: verified records older than this no longer count (days)',
    'scoring.alternativeData.digitalChannels': 'Alternative data: payment channels counted as digital repayments',
};

function flatten(v: unknown, prefix = ''): [string, unknown][] {
    if (v && typeof v === 'object' && !Array.isArray(v))
        return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flatten(x, prefix ? `${prefix}.${k}` : k));
    return [[prefix, v]];
}
const show = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x !== 'object') ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * The lender's own operating parameters (DECISIONS D-071): regulatory return
 * bands and classes, tenant-level ledger accounts, payment-file and
 * delegation limits. Finance proposes a complete version; a different user
 * with the approval permission (risk) approves it. Until one is approved the
 * defaults apply — the values the platform used before these were settings.
 */
export function LendingSettingsTab() {
    const { showToast } = useToast();
    const list = useApi<SettingsList>('/lending/ops/settings');
    const [draft, setDraft] = useState('');
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();

    if (!list.data) return list.error ? <ErrorBox error={list.error} /> : <Spinner />;
    const { active, versions, effective, defaults } = list.data;
    const defaultsFlat = new Map(flatten(defaults));

    const propose = async () => {
        let settings: unknown;
        try { settings = JSON.parse(draft); } catch { setProblem('The settings are not valid JSON.'); return; }
        setProblem('');
        const res = await run('propose', () => api.post('/lending/ops/settings', { settings, reason: reason.trim() || undefined }));
        if (res) { showToast('Settings proposed — a second person must approve them', 'success'); setDraft(''); list.reload(); }
    };
    const decide = async (id: string, approve: boolean) => {
        const res = await run(`${id}:${approve}`, () => api.post(`/lending/ops/settings/${id}/decision`, { approve }));
        if (res) { showToast(approve ? 'Settings in force' : 'Settings rejected', 'success'); list.reload(); }
    };

    return (
        <div className="space-y-4">
            {!active && (
                <Notice tone="info" title="Defaults in force">
                    No version has been approved, so every value below is the platform default.
                </Notice>
            )}
            <Card title={active ? `In force: version ${active.version}` : 'In force: defaults'} subtitle={active?.decidedAt ? `Approved ${fmtDateTime(active.decidedAt)}` : undefined} bodyClass="p-0">
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Setting</th><th className={th}>Value</th><th className={th}>Default</th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {flatten(effective).map(([k, v]) => (
                            <tr key={k}>
                                <td className={td}>{LABELS[k] ?? k}<div className="font-mono text-[11px] text-[#697386]">{k}</div></td>
                                <td className={`${td} font-mono text-[12px]`}>{show(v)}</td>
                                <td className={`${td} font-mono text-[12px] text-[#697386]`}>{show(defaultsFlat.get(k))}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </Card>
            <Card title="Versions" bodyClass="p-0">
                {versions.length === 0 ? <Empty>No version has been proposed.</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Version</th><th className={th}>Status</th><th className={th}>Proposed</th><th className={th}>Note</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {versions.map((v) => (
                                <tr key={v.id}>
                                    <td className={td}>v{v.version}</td>
                                    <td className={td}><StatusBadge status={v.status} /></td>
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(v.createdAt)} · <span className="font-mono text-[11px]">{v.makerId.slice(0, 8)}</span></td>
                                    <td className={td}>{v.reason || '—'}</td>
                                    <td className={td}>
                                        {v.status === 'PENDING' && (
                                            <div className="flex gap-2">
                                                <Btn size="sm" variant="primary" onClick={() => decide(v.id, true)} busy={busy === `${v.id}:true`}>Approve</Btn>
                                                <Btn size="sm" variant="danger" onClick={() => decide(v.id, false)} busy={busy === `${v.id}:false`}>Reject</Btn>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
            <Card
                title="Propose a change"
                subtitle="A different user with the settings-approval permission must approve it. Account codes must exist in the chart of accounts; a changed account applies to new postings only."
                actions={<Btn size="sm" onClick={() => { setDraft(JSON.stringify(effective, null, 2)); setProblem(''); }}>Start from what is in force</Btn>}
            >
                {draft === '' ? <p className="text-[13px] text-[#697386]">Start from the settings in force and change what you need.</p> : (
                    <div className="space-y-3">
                        <Field label="Settings (JSON)" error={problem || undefined}>
                            <TextArea value={draft} onChange={setDraft} rows={18} className="font-mono text-[12px]" />
                        </Field>
                        {(() => { try { return <JsonDiff diff={jsonDiff(effective, JSON.parse(draft))} emptyLabel="Same as the settings in force." />; } catch { return null; } })()}
                        <Field label="Why"><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant="primary" onClick={propose} busy={busy === 'propose'}>Propose</Btn>
                    </div>
                )}
            </Card>
            {error && !draft && <ErrorBox error={error} onDismiss={clearError} />}
        </div>
    );
}
