"use client";

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { ActionPanel, Btn, Card, Checkbox, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, TextInput, th, td } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { clean, qs, useAction, useApi } from '../useAsync';
import { fmtDateTime, localToIso } from '../format';
import type { Flag, FlagApproval, FlagRule, FlagsResponse } from '../types';
import { useMyId, useUserName, type TabProps } from './common';

const CHANNELS = ['BRANCH', 'STAFF_PORTAL', 'BORROWER_PORTAL', 'AGENT', 'API'];
const SCOPES = ['TENANT', 'PRODUCT', 'BRANCH', 'CHANNEL', 'SEGMENT', 'COHORT'];

interface Ctx { productCode: string; branchId: string; channel: string; segment: string; cohort: string }
const EMPTY_CTX: Ctx = { productCode: '', branchId: '', channel: '', segment: '', cohort: '' };

type ApprovalRow = FlagApproval & { createdAt?: string };
type PlatformRuleRow = FlagRule & { makerId?: string };

export function FlagsTab({ data: overview }: TabProps) {
    const [draft, setDraft] = useState<Ctx>(EMPTY_CTX);
    const [ctx, setCtx] = useState<Ctx>(EMPTY_CTX);
    const { data, error, loading, reload } = useApi<FlagsResponse>(`/lending/access/flags${qs({ ...ctx })}`);
    const userName = useUserName(overview.users);

    return (
        <div className="space-y-5">
            <Card title="Evaluation context" subtitle="Flags are evaluated for this context. Leave fields empty to use defaults (channel defaults to STAFF_PORTAL).">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                    <Field label="Product code"><TextInput value={draft.productCode} onChange={(productCode) => setDraft((d) => ({ ...d, productCode }))} /></Field>
                    <Field label="Branch ID"><TextInput value={draft.branchId} onChange={(branchId) => setDraft((d) => ({ ...d, branchId }))} /></Field>
                    <Field label="Channel"><SelectInput value={draft.channel} onChange={(channel) => setDraft((d) => ({ ...d, channel }))} options={CHANNELS} placeholder="(default)" /></Field>
                    <Field label="Segment"><TextInput value={draft.segment} onChange={(segment) => setDraft((d) => ({ ...d, segment }))} /></Field>
                    <Field label="Cohort"><TextInput value={draft.cohort} onChange={(cohort) => setDraft((d) => ({ ...d, cohort }))} /></Field>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                    <Btn size="sm" variant="ghost" onClick={() => { setDraft(EMPTY_CTX); setCtx(EMPTY_CTX); }}>Clear</Btn>
                    <Btn size="sm" variant="primary" busy={loading} onClick={() => { setCtx({ ...draft }); if (JSON.stringify(draft) === JSON.stringify(ctx)) reload(); }}>Evaluate</Btn>
                </div>
            </Card>

            <ErrorBox error={error} />
            {loading && !data ? <Spinner /> : data && (
                <>
                    <Card title="Precedence" subtitle="Evaluation order — the first matching source wins.">
                        <ol className="flex flex-wrap items-center gap-1.5">
                            {data.precedence.map((p, i) => (
                                <li key={p} className="flex items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 border border-[#C9D7FF] bg-[#F0F5FF] text-[#4B45C6] rounded px-2 py-0.5 text-[11px] font-mono">
                                        <span className="font-bold">{i + 1}</span> {p}
                                    </span>
                                    {i < data.precedence.length - 1 && <ChevronRight size={12} className="text-[#AAB7C4]" />}
                                </li>
                            ))}
                        </ol>
                    </Card>
                    <FlagList flags={data.flags} />
                    <Approvals approvals={data.approvals as ApprovalRow[]} rules={data.tenantRules} userName={userName} reload={reload} />
                    <TenantRules rules={data.tenantRules} reload={reload} />
                    <PlatformRules rules={data.platformRules as PlatformRuleRow[]} userName={userName} />
                    <ProposeRuleForm flags={data.flags} reload={reload} />
                    <CohortForm />
                </>
            )}
        </div>
    );
}

function FlagList({ flags }: { flags: Flag[] }) {
    const groups = new Map<string, Flag[]>();
    for (const f of flags) groups.set(f.category, [...(groups.get(f.category) ?? []), f]);
    return (
        <Card title="Feature flags" subtitle="Current evaluation for the context above." bodyClass="p-0">
            {flags.length === 0 ? <Empty>No flags defined.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>Flag</th><th className={th}>State</th><th className={th}>Source</th><th className={th}>Scope</th><th className={th}>Default</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[...groups.entries()].map(([cat, list]) => (
                            <FlagGroup key={cat} category={cat} flags={list} />
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

function FlagGroup({ category, flags }: { category: string; flags: Flag[] }) {
    return (
        <>
            <tr className="bg-[#F7FAFC] border-y border-[#E3E8EE]"><td colSpan={5} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#697386]">{category}</td></tr>
            {flags.map((f) => (
                <tr key={f.key} className="border-b border-[#F0F2F5]">
                    <td className={td}>
                        <span className="font-mono text-[12px] text-[#1A1F36]">{f.key}</span>
                        {f.sensitive && <span className="ml-1.5 text-[9px] font-bold px-1 rounded bg-red-50 text-red-700 border border-red-200">SENSITIVE</span>}
                        <div className="text-[11px] text-[#697386]">{f.description}</div>
                    </td>
                    <td className={td}>
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold ${f.evaluation.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{f.evaluation.enabled ? 'ON' : 'OFF'}</span>
                    </td>
                    <td className={td}><span className="font-mono text-[11px]">{f.evaluation.source}</span></td>
                    <td className={td}><span className="text-[12px]">{f.evaluation.scope ?? '—'}</span></td>
                    <td className={td}><span className="text-[12px] text-[#697386]">{f.defaultEnabled ? 'on' : 'off'}</span></td>
                </tr>
            ))}
        </>
    );
}

function Approvals({ approvals, rules, userName, reload }: { approvals: ApprovalRow[]; rules: FlagRule[]; userName: (id: string | null | undefined) => string; reload: () => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const me = useMyId();
    const pending = approvals.filter((a) => a.status === 'PENDING');
    const ruleById = new Map(rules.map((r) => [r.id, r]));

    const decide = async (a: ApprovalRow, approve: boolean) => {
        const r = await run(`decide-${a.id}`, () => api.post(`/lending/access/flags/changes/${a.id}/decision`, { approve }));
        if (r) { showToast(approve ? 'Flag change approved' : 'Flag change rejected', 'success'); reload(); }
    };

    return (
        <Card title="Flag change approvals" subtitle={`${pending.length} pending. The maker cannot approve their own change.`} bodyClass="p-0">
            <div className="p-4 pb-0"><ErrorBox error={error} onDismiss={clearError} /></div>
            {approvals.length === 0 ? <Empty>No flag change requests.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>Action</th><th className={th}>Rule</th><th className={th}>Maker</th><th className={th}>Reason</th><th className={th}>Status</th><th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {approvals.map((a) => {
                            const rule = a.ruleId ? ruleById.get(a.ruleId) : undefined;
                            const own = !!me && a.makerId === me;
                            return (
                                <tr key={a.id} className={a.status === 'PENDING' ? 'bg-amber-50/60' : ''}>
                                    <td className={td}><span className="font-mono text-[12px]">{a.action}</span></td>
                                    <td className={td}>
                                        {rule ? <><span className="font-mono text-[12px]">{rule.flagKey}</span> <span className="text-[11px] text-[#697386]">{rule.scopeType}{rule.scopeValue ? `=${rule.scopeValue}` : ''} → {rule.enabled ? 'ON' : 'OFF'}</span></> : <span className="font-mono text-[11px]">{a.ruleId ?? '—'}</span>}
                                    </td>
                                    <td className={td}>{userName(a.makerId)}</td>
                                    <td className={`${td} text-[12px]`}>{a.reason ?? '—'}</td>
                                    <td className={td}><StatusBadge status={a.status} /></td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        {a.status === 'PENDING' && (
                                            <div className="flex gap-1.5 justify-end">
                                                <Btn size="sm" variant="primary" busy={busy === `decide-${a.id}`} disabled={own || !!busy} reason={own ? 'You proposed this change — a second admin must approve' : undefined} onClick={() => decide(a, true)}>Approve</Btn>
                                                <Btn size="sm" variant="danger" disabled={own || !!busy} reason={own ? 'You proposed this change — a second admin must decide' : undefined} onClick={() => decide(a, false)}>Reject</Btn>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

function RuleRowCells({ r }: { r: FlagRule }) {
    return (
        <>
            <td className={td}><span className="font-mono text-[12px]">{r.flagKey}</span></td>
            <td className={td}>{r.scopeType ?? 'PLATFORM'}{r.scopeValue ? <span className="text-[#697386]"> = {r.scopeValue}</span> : null}</td>
            <td className={td}>
                <span className={`font-bold text-[11px] ${r.enabled ? 'text-emerald-700' : 'text-slate-600'}`}>{r.enabled ? 'ON' : 'OFF'}</span>
                {r.emergency && <span className="ml-1 text-[9px] font-bold px-1 rounded bg-red-600 text-white">EMERGENCY</span>}
            </td>
            <td className={`${td} text-[12px] whitespace-nowrap`}>{r.effectiveFrom ? fmtDateTime(r.effectiveFrom) : '—'}{r.effectiveTo ? <><br />→ {fmtDateTime(r.effectiveTo)}</> : null}</td>
            <td className={td}><StatusBadge status={r.status ?? null} /></td>
        </>
    );
}

function TenantRules({ rules, reload }: { rules: FlagRule[]; reload: () => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [removing, setRemoving] = useState<FlagRule | null>(null);
    const [reason, setReason] = useState('');

    const submit = async () => {
        if (!removing) return;
        const r = await run('remove', () => api.post(`/lending/access/flags/rules/${removing.id}/remove`, { reason: reason.trim() }));
        if (r) { showToast('Removal proposed — awaiting approval', 'success'); setRemoving(null); setReason(''); reload(); }
    };

    return (
        <Card title="Tenant rules" bodyClass="p-0">
            {rules.length === 0 ? <Empty>No tenant flag rules.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>Flag</th><th className={th}>Scope</th><th className={th}>Sets</th><th className={th}>Effective</th><th className={th}>Status</th><th className={th}>Priority</th><th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rules.map((r) => (
                            <tr key={r.id}>
                                <RuleRowCells r={r} />
                                <td className={td}>{r.priority ?? '—'}</td>
                                <td className={`${td} text-right`}>
                                    {r.status === 'ACTIVE' && <Btn size="sm" variant="danger" onClick={() => { setRemoving(r); setReason(''); clearError(); }}>Propose removal</Btn>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {removing && (
                <div className="p-4">
                    <ActionPanel title={`Propose removal of ${removing.flagKey} (${removing.scopeType}${removing.scopeValue ? `=${removing.scopeValue}` : ''})`} onClose={() => setRemoving(null)}>
                        <Field label="Reason" error={reason && reason.trim().length < 3 ? 'At least 3 characters' : undefined}><TextInput value={reason} onChange={setReason} maxLength={300} /></Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <div className="flex justify-end"><Btn variant="danger" busy={busy === 'remove'} disabled={reason.trim().length < 3} onClick={submit}>Propose removal</Btn></div>
                    </ActionPanel>
                </div>
            )}
        </Card>
    );
}

function PlatformRules({ rules, userName }: { rules: PlatformRuleRow[]; userName: (id: string | null | undefined) => string }) {
    return (
        <Card title="Platform rules" subtitle="Set by the platform operator; read-only for tenants. Platform emergency-off overrides every tenant rule." bodyClass="p-0">
            {rules.length === 0 ? <Empty>No platform flag rules.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>Flag</th><th className={th}>Scope</th><th className={th}>Sets</th><th className={th}>Effective</th><th className={th}>Status</th><th className={th}>Maker</th><th className={th}>Reason</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rules.map((r) => (
                            <tr key={r.id}>
                                <RuleRowCells r={r} />
                                <td className={td}>{userName(r.makerId)}</td>
                                <td className={`${td} text-[12px]`}>{r.reason ?? '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

function ProposeRuleForm({ flags, reload }: { flags: Flag[]; reload: () => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [flagKey, setFlagKey] = useState('');
    const [scopeType, setScopeType] = useState('TENANT');
    const [scopeValue, setScopeValue] = useState('');
    const [enabled, setEnabled] = useState('true');
    const [emergency, setEmergency] = useState(false);
    const [priority, setPriority] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [reason, setReason] = useState('');

    const flag = flags.find((f) => f.key === flagKey);
    const priorityErr = priority && (!/^\d+$/.test(priority) || Number(priority) > 1000) ? 'Whole number 0–1000' : undefined;
    const scopeErr = scopeType !== 'TENANT' && !scopeValue.trim() ? 'Required for this scope' : undefined;
    const valid = flagKey && !scopeErr && !priorityErr && reason.trim().length >= 3;

    const submit = async () => {
        const body = clean({
            flagKey, scopeType,
            scopeValue: scopeType === 'TENANT' ? undefined : scopeValue.trim(),
            enabled: enabled === 'true',
            emergency: emergency || undefined,
            priority: priority ? Number(priority) : undefined,
            effectiveFrom: localToIso(from),
            effectiveTo: localToIso(to),
            reason: reason.trim(),
        });
        const r = await run('propose', () => api.post('/lending/access/flags/rules', body));
        if (r) {
            showToast('Flag rule proposed — awaiting approval', 'success');
            setFlagKey(''); setScopeValue(''); setEmergency(false); setPriority(''); setFrom(''); setTo(''); setReason('');
            reload();
        }
    };

    return (
        <Card title="Propose flag rule" subtitle="Creates a pending rule that a second admin must approve.">
            <div className="space-y-4">
                {flag?.sensitive && <Notice tone="warn" title="Sensitive flag">Changes to this flag affect financial or regulatory behaviour.</Notice>}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Field label="Flag"><SelectInput value={flagKey} onChange={setFlagKey} options={flags.map((f) => ({ value: f.key, label: `${f.key}${f.sensitive ? ' (sensitive)' : ''}` }))} placeholder="Select flag…" /></Field>
                    <Field label="Scope type"><SelectInput value={scopeType} onChange={setScopeType} options={SCOPES} /></Field>
                    <Field label="Scope value" error={scopeErr}>
                        {scopeType === 'CHANNEL'
                            ? <SelectInput value={scopeValue} onChange={setScopeValue} options={CHANNELS} placeholder="Select channel…" />
                            : <TextInput value={scopeValue} onChange={setScopeValue} disabled={scopeType === 'TENANT'} maxLength={80} placeholder={scopeType === 'TENANT' ? 'n/a' : ''} />}
                    </Field>
                    <Field label="Set flag"><SelectInput value={enabled} onChange={setEnabled} options={[{ value: 'true', label: 'ON' }, { value: 'false', label: 'OFF' }]} /></Field>
                    <Field label="Priority (optional)" error={priorityErr} hint="0–1000"><TextInput value={priority} onChange={setPriority} inputMode="numeric" /></Field>
                    <Field label="Effective from (optional)"><TextInput type="datetime-local" value={from} onChange={setFrom} /></Field>
                    <Field label="Effective to (optional)"><TextInput type="datetime-local" value={to} onChange={setTo} /></Field>
                    <Field label="Reason" error={reason && reason.trim().length < 3 ? 'At least 3 characters' : undefined}><TextInput value={reason} onChange={setReason} maxLength={300} /></Field>
                </div>
                <Checkbox checked={emergency} onChange={setEmergency} label="Emergency rule (cannot be overridden by narrower tenant rules)" />
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end">
                    <Btn variant="primary" busy={busy === 'propose'} disabled={!valid} reason={!valid ? 'Flag, scope value (unless TENANT) and reason are required' : undefined} onClick={submit}>Propose rule</Btn>
                </div>
            </div>
        </Card>
    );
}

function CohortForm() {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [cohortCode, setCohortCode] = useState('');
    const [subjectType, setSubjectType] = useState('USER');
    const [subjectId, setSubjectId] = useState('');
    const [member, setMember] = useState('true');
    const valid = cohortCode.trim() && subjectId.trim();

    const submit = async () => {
        const r = await run('cohort', () => api.post('/lending/access/cohorts', { cohortCode: cohortCode.trim(), subjectType, subjectId: subjectId.trim(), member: member === 'true' }));
        if (r) { showToast(member === 'true' ? 'Added to cohort' : 'Removed from cohort', 'success'); setSubjectId(''); }
    };

    return (
        <Card title="Cohort membership" subtitle="Add or remove a branch, user or borrower from a rollout cohort.">
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Field label="Cohort code"><TextInput value={cohortCode} onChange={setCohortCode} maxLength={40} placeholder="PILOT_2026" /></Field>
                    <Field label="Subject type"><SelectInput value={subjectType} onChange={setSubjectType} options={['BRANCH', 'USER', 'BORROWER']} /></Field>
                    <Field label="Subject ID"><TextInput value={subjectId} onChange={setSubjectId} maxLength={64} /></Field>
                    <Field label="Membership"><SelectInput value={member} onChange={setMember} options={[{ value: 'true', label: 'Member' }, { value: 'false', label: 'Not a member' }]} /></Field>
                </div>
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end">
                    <Btn variant="primary" busy={busy === 'cohort'} disabled={!valid} onClick={submit}>Save membership</Btn>
                </div>
            </div>
        </Card>
    );
}
