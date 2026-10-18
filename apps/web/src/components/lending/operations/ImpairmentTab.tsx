"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { JsonDiff } from '../JsonDiff';
import { jsonDiff } from '../policies/types';
import { StatusBadge } from '../StatusBadge';
import { Btn, Card, Empty, ErrorBox, Field, Notice, Spinner, Table, TextArea, td, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { useWorkspace } from '@/lib/workspace';
import { EditorModeSwitch, StructuredJsonEditor, jsonProblem } from '../StructuredJsonEditor';
import { fmtDateTime } from '../format';

interface PolicyRow {
    id: string; version: number; status: string; settings: unknown; makerId: string; checkerId: string | null;
    decidedAt: string | null; reason: string; createdAt: string;
}
interface PolicyList { active: PolicyRow | null; versions: PolicyRow[]; template: unknown }

const ECL_TEMPLATE = {
    mode: 'ECL',
    classes: [
        { code: 'PERFORMING', label: 'Performing', minDpd: 0, rate: '0' },
        { code: 'UNDERPERFORMING', label: 'Underperforming', minDpd: 30, rate: '0' },
        { code: 'NON_PERFORMING', label: 'Non-performing', minDpd: 90, rate: '0' },
    ],
    ecl: { stage2FromDpd: 30, stage3FromDpd: 90, restructuredMinStage: 2, nonAccrualIsStage3: true, pd: { stage1: '0.02', stage2: '0.15', stage3: '1' }, lgd: '0.45' },
};

/**
 * Classification and impairment policy (OPS-5): finance proposes, risk
 * approves; end of day posts each loan's change in allowance. Nothing is
 * provisioned until a policy is in force.
 */
export function ImpairmentTab() {
    const { showToast } = useToast();
    const list = useApi<PolicyList>('/lending/ops/impairment-policy');
    const [draft, setDraft] = useState('');
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const [mode, setMode] = useState<'form' | 'json'>('form');
    const [formInvalid, setFormInvalid] = useState(0);
    const [formKey, setFormKey] = useState(0);
    const { busy, error, run, clearError } = useAction();
    const { can, access } = useWorkspace();
    const me = access?.principal.id;
    const canPropose = can('impairment.manage');
    const canDecide = can('impairment.approve');

    if (!list.data) return list.error ? <ErrorBox error={list.error} /> : <Spinner />;
    const { active, versions, template } = list.data;

    const start = (t: unknown) => { setDraft(JSON.stringify(t, null, 2)); setProblem(''); setFormInvalid(0); setFormKey((k) => k + 1); };
    const propose = async () => {
        let settings: unknown;
        const bad = jsonProblem(draft);
        if (bad) { setProblem(`The policy is not valid JSON: ${bad}`); return; }
        settings = JSON.parse(draft);
        setProblem('');
        const res = await run('propose', () => api.post('/lending/ops/impairment-policy', { settings, reason: reason.trim() || undefined }));
        if (res) { showToast('Policy proposed — a risk reviewer must approve it', 'success'); setDraft(''); list.reload(); }
    };
    const decide = async (id: string, approve: boolean) => {
        const res = await run(`${id}:${approve}`, () => api.post(`/lending/ops/impairment-policy/${id}/decision`, { approve }));
        if (res) { showToast(approve ? 'Policy in force from the next end of day' : 'Policy rejected', 'success'); list.reload(); }
    };

    return (
        <div className="space-y-4">
            {!active && (
                <Notice tone="warn" title="No impairment policy in force">
                    Lending loans carry no loss allowance until a policy is approved. Start from the NBC regulatory template or an ECL template below.
                </Notice>
            )}
            {active && (
                <Card title={`In force: version ${active.version}`} subtitle={`Approved ${active.decidedAt ? fmtDateTime(active.decidedAt) : ''}`}>
                    <pre className="text-[12px] bg-[#F7FAFC] border border-[#E3E8EE] rounded p-3 overflow-x-auto">{JSON.stringify(active.settings, null, 2)}</pre>
                </Card>
            )}
            <Card title="Versions" bodyClass="p-0">
                {versions.length === 0 ? <Empty>No policy has been proposed.</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Version</th><th className={th}>Status</th><th className={th}>Mode</th><th className={th}>Proposed</th><th className={th}>Note</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {versions.map((v) => (
                                <tr key={v.id}>
                                    <td className={td}>v{v.version}</td>
                                    <td className={td}><StatusBadge status={v.status} /></td>
                                    <td className={td}>{(v.settings as { mode?: string })?.mode}</td>
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(v.createdAt)} · <span className="font-mono text-[11px]">{v.makerId.slice(0, 8)}</span></td>
                                    <td className={td}>{v.reason || '—'}</td>
                                    <td className={td}>
                                        {v.status === 'PENDING' && (
                                            <div className="flex gap-2">
                                                <Btn size="sm" variant="primary" onClick={() => decide(v.id, true)} busy={busy === `${v.id}:true`} disabled={!canDecide || v.makerId === me} reason={!canDecide ? 'Needs impairment.approve' : v.makerId === me ? 'You proposed this — another person must approve' : undefined}>Approve</Btn>
                                                <Btn size="sm" variant="danger" onClick={() => decide(v.id, false)} busy={busy === `${v.id}:false`} disabled={!canDecide || v.makerId === me} reason={!canDecide ? 'Needs impairment.approve' : v.makerId === me ? 'You proposed this — another person must decide' : undefined}>Reject</Btn>
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
                title="Propose a policy"
                subtitle="A different user with the impairment-approval permission (risk) must approve it."
                actions={
                    <div className="flex gap-2">
                        <Btn size="sm" onClick={() => start(active?.settings ?? template)}>Start from {active ? 'current' : 'NBC regulatory'}</Btn>
                        <Btn size="sm" onClick={() => start(ECL_TEMPLATE)}>Start from ECL</Btn>
                    </div>
                }
            >
                {draft === '' ? <p className="text-[13px] text-[#697386]">Pick a starting point.</p> : (
                    <div className="space-y-3">
                        <p className="text-[12px] text-[#697386]">
                            REGULATORY: each class&apos;s rate applies to outstanding principal. ECL: allowance = PD × LGD × exposure, with the stage set by days past due, non-accrual and restructuring; class rates are ignored.
                        </p>
                        <EditorModeSwitch mode={mode} onChange={(m) => { if (m === 'form' && jsonProblem(draft)) return; setMode(m); setFormInvalid(0); setFormKey((k) => k + 1); }} />
                        {mode === 'form' && !jsonProblem(draft) ? (
                            <StructuredJsonEditor key={formKey} value={JSON.parse(draft)} onChange={(next) => setDraft(JSON.stringify(next, null, 2))} onValidity={setFormInvalid} />
                        ) : (
                            <Field label="Policy (JSON)" error={problem || jsonProblem(draft) || undefined}>
                                <TextArea value={draft} onChange={(v) => { setDraft(v); setProblem(''); }} rows={18} className="font-mono text-[12px]" />
                            </Field>
                        )}
                        {active && (() => { try { return <JsonDiff diff={jsonDiff(active.settings, JSON.parse(draft))} emptyLabel="Same as the policy in force." />; } catch { return null; } })()}
                        <Field label="Why"><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant="primary" onClick={propose} busy={busy === 'propose'} disabled={!canPropose || !!jsonProblem(draft) || (mode === 'form' && formInvalid > 0)} reason={!canPropose ? 'Needs impairment.manage' : undefined}>Propose</Btn>
                    </div>
                )}
            </Card>
            {error && !draft && <ErrorBox error={error} onDismiss={clearError} />}
        </div>
    );
}
