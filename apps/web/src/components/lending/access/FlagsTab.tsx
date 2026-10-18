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
import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import { Person, UserPicker } from '../People';
import type { BranchRef } from '../types';

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
    const t = useTranslations('LendingAccess.flags');

    return (
        <div className="space-y-5">
            <Card title={t('contextTitle')} subtitle={t('contextSubtitle')}>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                    <Field label={t('productCode')}><TextInput value={draft.productCode} onChange={(productCode) => setDraft((d) => ({ ...d, productCode }))} /></Field>
                    <Field label={t('branch')}><SelectInput value={draft.branchId} onChange={(branchId) => setDraft((d) => ({ ...d, branchId }))} options={(overview.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} placeholder={t('any')} /></Field>
                    <Field label={t('channel')}><SelectInput value={draft.channel} onChange={(channel) => setDraft((d) => ({ ...d, channel }))} options={CHANNELS} placeholder={t('default')} /></Field>
                    <Field label={t('segment')}><TextInput value={draft.segment} onChange={(segment) => setDraft((d) => ({ ...d, segment }))} /></Field>
                    <Field label={t('cohort')}><TextInput value={draft.cohort} onChange={(cohort) => setDraft((d) => ({ ...d, cohort }))} /></Field>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                    <Btn size="sm" variant="ghost" onClick={() => { setDraft(EMPTY_CTX); setCtx(EMPTY_CTX); }}>{t('clear')}</Btn>
                    <Btn size="sm" variant="primary" busy={loading} onClick={() => { setCtx({ ...draft }); if (JSON.stringify(draft) === JSON.stringify(ctx)) reload(); }}>{t('evaluate')}</Btn>
                </div>
            </Card>

            <ErrorBox error={error} />
            {loading && !data ? <Spinner /> : data && (
                <>
                    <Card title={t('precedenceTitle')} subtitle={t('precedenceSubtitle')}>
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
                    <Cohorts branches={overview.branches ?? []} />
                </>
            )}
        </div>
    );
}

function FlagList({ flags }: { flags: Flag[] }) {
    const groups = new Map<string, Flag[]>();
    for (const f of flags) groups.set(f.category, [...(groups.get(f.category) ?? []), f]);
    const t = useTranslations('LendingAccess.flags');
    return (
        <Card title={t('flagsTitle')} subtitle={t('flagsSubtitle')} bodyClass="p-0">
            {flags.length === 0 ? <Empty>{t('noFlags')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>{t('colFlag')}</th><th className={th}>{t('colState')}</th><th className={th}>{t('colSource')}</th><th className={th}>{t('colScope')}</th><th className={th}>{t('colDefault')}</th>
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
    const t = useTranslations('LendingAccess.flags');
    return (
        <>
            <tr className="bg-[#F7FAFC] border-y border-[#E3E8EE]"><td colSpan={5} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#697386]">{category}</td></tr>
            {flags.map((f) => (
                <tr key={f.key} className="border-b border-[#F0F2F5]">
                    <td className={td}>
                        <span className="font-mono text-[12px] text-[#1A1F36]">{f.key}</span>
                        {f.sensitive && <span className="ml-1.5 text-[9px] font-bold px-1 rounded bg-red-50 text-red-700 border border-red-200">{t('sensitive')}</span>}
                        <div className="text-[11px] text-[#697386]">{f.description}</div>
                    </td>
                    <td className={td}>
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold ${f.evaluation.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{f.evaluation.enabled ? t('on') : t('off')}</span>
                    </td>
                    <td className={td}><span className="font-mono text-[11px]">{f.evaluation.source}</span></td>
                    <td className={td}><span className="text-[12px]">{f.evaluation.scope ?? '—'}</span></td>
                    <td className={td}><span className="text-[12px] text-[#697386]">{f.defaultEnabled ? t('defaultOn') : t('defaultOff')}</span></td>
                </tr>
            ))}
        </>
    );
}

function Approvals({ approvals, rules, userName, reload }: { approvals: ApprovalRow[]; rules: FlagRule[]; userName: (id: string | null | undefined) => string; reload: () => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const { can } = useWorkspace();
    const me = useMyId();
    const pending = approvals.filter((a) => a.status === 'PENDING');
    const ruleById = new Map(rules.map((r) => [r.id, r]));
    const t = useTranslations('LendingAccess.flags');

    const decide = async (a: ApprovalRow, approve: boolean) => {
        const r = await run(`decide-${a.id}`, () => api.post(`/lending/access/flags/changes/${a.id}/decision`, { approve }));
        if (r) { showToast(approve ? t('changeApproved') : t('changeRejected'), 'success'); reload(); }
    };

    return (
        <Card title={t('approvalsTitle')} subtitle={t('approvalsSubtitle', { count: pending.length })} bodyClass="p-0">
            <div className="p-4 pb-0"><ErrorBox error={error} onDismiss={clearError} /></div>
            {approvals.length === 0 ? <Empty>{t('noChanges')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>{t('colAction')}</th><th className={th}>{t('colRule')}</th><th className={th}>{t('colMaker')}</th><th className={th}>{t('colReason')}</th><th className={th}>{t('colStatus')}</th><th className={th}></th>
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
                                        {rule ? <><span className="font-mono text-[12px]">{rule.flagKey}</span> <span className="text-[11px] text-[#697386]">{rule.scopeType}{rule.scopeValue ? `=${rule.scopeValue}` : ''} → {rule.enabled ? t('on') : t('off')}</span></> : <span className="font-mono text-[11px]">{a.ruleId ?? '—'}</span>}
                                    </td>
                                    <td className={td}>{userName(a.makerId)}</td>
                                    <td className={`${td} text-[12px]`}>{a.reason ?? '—'}</td>
                                    <td className={td}><StatusBadge status={a.status} /></td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        {a.status === 'PENDING' && (
                                            <div className="flex gap-1.5 justify-end">
                                                <Btn size="sm" variant="primary" busy={busy === `decide-${a.id}`} disabled={own || !!busy || !can('feature_flag.approve')} reason={!can('feature_flag.approve') ? t('needApprove') : own ? t('ownApprove') : undefined} onClick={() => decide(a, true)}>{t('approve')}</Btn>
                                                <Btn size="sm" variant="danger" disabled={own || !!busy || !can('feature_flag.approve')} reason={!can('feature_flag.approve') ? t('needApprove') : own ? t('ownDecide') : undefined} onClick={() => decide(a, false)}>{t('reject')}</Btn>
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
    const t = useTranslations('LendingAccess.flags');
    return (
        <>
            <td className={td}><span className="font-mono text-[12px]">{r.flagKey}</span></td>
            <td className={td}>{r.scopeType ?? t('platform')}{r.scopeValue ? <span className="text-[#697386]"> = {r.scopeValue}</span> : null}</td>
            <td className={td}>
                <span className={`font-bold text-[11px] ${r.enabled ? 'text-emerald-700' : 'text-slate-600'}`}>{r.enabled ? t('on') : t('off')}</span>
                {r.emergency && <span className="ml-1 text-[9px] font-bold px-1 rounded bg-red-600 text-white">{t('emergency')}</span>}
            </td>
            <td className={`${td} text-[12px] whitespace-nowrap`}>{r.effectiveFrom ? fmtDateTime(r.effectiveFrom) : '—'}{r.effectiveTo ? <><br />→ {fmtDateTime(r.effectiveTo)}</> : null}</td>
            <td className={td}><StatusBadge status={r.status ?? null} /></td>
        </>
    );
}

function TenantRules({ rules, reload }: { rules: FlagRule[]; reload: () => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const { can } = useWorkspace();
    const [removing, setRemoving] = useState<FlagRule | null>(null);
    const t = useTranslations('LendingAccess.flags');
    const [reason, setReason] = useState('');

    const submit = async () => {
        if (!removing) return;
        const r = await run('remove', () => api.post(`/lending/access/flags/rules/${removing.id}/remove`, { reason: reason.trim() }));
        if (r) { showToast(t('removalProposed'), 'success'); setRemoving(null); setReason(''); reload(); }
    };

    return (
        <Card title={t('tenantRules')} bodyClass="p-0">
            {rules.length === 0 ? <Empty>{t('noTenantRules')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>{t('colFlag')}</th><th className={th}>{t('colScope')}</th><th className={th}>{t('colSets')}</th><th className={th}>{t('colEffective')}</th><th className={th}>{t('colStatus')}</th><th className={th}>{t('colPriority')}</th><th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rules.map((r) => (
                            <tr key={r.id}>
                                <RuleRowCells r={r} />
                                <td className={td}>{r.priority ?? '—'}</td>
                                <td className={`${td} text-right`}>
                                    {r.status === 'ACTIVE' && <Btn size="sm" variant="danger" disabled={!can('feature_flag.manage')} reason={!can('feature_flag.manage') ? t('needManage') : undefined} onClick={() => { setRemoving(r); setReason(''); clearError(); }}>{t('proposeRemoval')}</Btn>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {removing && (
                <div className="p-4">
                    <ActionPanel title={t('removalTitle', { flag: removing.flagKey, scope: `${removing.scopeType}${removing.scopeValue ? `=${removing.scopeValue}` : ''}` })} onClose={() => setRemoving(null)}>
                        <Field label={t('colReason')} error={reason && reason.trim().length < 3 ? t('minChars') : undefined}><TextInput value={reason} onChange={setReason} maxLength={300} /></Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <div className="flex justify-end"><Btn variant="danger" busy={busy === 'remove'} disabled={reason.trim().length < 3} onClick={submit}>{t('proposeRemoval')}</Btn></div>
                    </ActionPanel>
                </div>
            )}
        </Card>
    );
}

function PlatformRules({ rules, userName }: { rules: PlatformRuleRow[]; userName: (id: string | null | undefined) => string }) {
    const t = useTranslations('LendingAccess.flags');
    return (
        <Card title={t('platformRules')} subtitle={t('platformRulesSubtitle')} bodyClass="p-0">
            {rules.length === 0 ? <Empty>{t('noPlatformRules')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>{t('colFlag')}</th><th className={th}>{t('colScope')}</th><th className={th}>{t('colSets')}</th><th className={th}>{t('colEffective')}</th><th className={th}>{t('colStatus')}</th><th className={th}>{t('colMaker')}</th><th className={th}>{t('colReason')}</th>
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
    const { can } = useWorkspace();
    const [flagKey, setFlagKey] = useState('');
    const [scopeType, setScopeType] = useState('TENANT');
    const [scopeValue, setScopeValue] = useState('');
    const [enabled, setEnabled] = useState('true');
    const [emergency, setEmergency] = useState(false);
    const [priority, setPriority] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [reason, setReason] = useState('');
    const t = useTranslations('LendingAccess.flags');

    const flag = flags.find((f) => f.key === flagKey);
    const priorityErr = priority && (!/^\d+$/.test(priority) || Number(priority) > 1000) ? t('priorityRule') : undefined;
    const scopeErr = scopeType !== 'TENANT' && !scopeValue.trim() ? t('scopeRequired') : undefined;
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
            showToast(t('ruleProposed'), 'success');
            setFlagKey(''); setScopeValue(''); setEmergency(false); setPriority(''); setFrom(''); setTo(''); setReason('');
            reload();
        }
    };

    return (
        <Card title={t('proposeTitle')} subtitle={t('proposeSubtitle')}>
            <div className="space-y-4">
                {flag?.sensitive && <Notice tone="warn" title={t('sensitiveFlag')}>{t('sensitiveFlagBody')}</Notice>}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Field label={t('colFlag')}><SelectInput value={flagKey} onChange={setFlagKey} options={flags.map((f) => ({ value: f.key, label: f.sensitive ? t('flagSensitive', { key: f.key }) : f.key }))} placeholder={t('selectFlag')} /></Field>
                    <Field label={t('scopeType')}><SelectInput value={scopeType} onChange={setScopeType} options={SCOPES} /></Field>
                    <Field label={t('scopeValue')} error={scopeErr}>
                        {scopeType === 'CHANNEL'
                            ? <SelectInput value={scopeValue} onChange={setScopeValue} options={CHANNELS} placeholder={t('selectChannel')} />
                            : <TextInput value={scopeValue} onChange={setScopeValue} disabled={scopeType === 'TENANT'} maxLength={80} placeholder={scopeType === 'TENANT' ? t('na') : ''} />}
                    </Field>
                    <Field label={t('setFlag')}><SelectInput value={enabled} onChange={setEnabled} options={[{ value: 'true', label: t('on') }, { value: 'false', label: t('off') }]} /></Field>
                    <Field label={t('priorityOptional')} error={priorityErr} hint="0–1000"><TextInput value={priority} onChange={setPriority} inputMode="numeric" /></Field>
                    <Field label={t('effectiveFromOptional')}><TextInput type="datetime-local" value={from} onChange={setFrom} /></Field>
                    <Field label={t('effectiveToOptional')}><TextInput type="datetime-local" value={to} onChange={setTo} /></Field>
                    <Field label={t('colReason')} error={reason && reason.trim().length < 3 ? t('minChars') : undefined}><TextInput value={reason} onChange={setReason} maxLength={300} /></Field>
                </div>
                <Checkbox checked={emergency} onChange={setEmergency} label={t('emergencyLabel')} />
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end">
                    <Btn variant="primary" busy={busy === 'propose'} disabled={!valid || !can('feature_flag.manage')} reason={!can('feature_flag.manage') ? t('needManage') : !valid ? t('required') : undefined} onClick={submit}>{t('proposeRule')}</Btn>
                </div>
            </div>
        </Card>
    );
}

interface CohortChange {
    id: string; status: string; cohortCode: string; subjectType: 'BRANCH' | 'USER' | 'BORROWER'; subjectId: string; member: boolean;
    makerId: string; decidedBy: string | null; reason: string | null; createdAt: string;
}
interface CohortMember { id: string; cohortCode: string; subjectType: string; subjectId: string; addedBy: string; createdAt: string }

/**
 * Cohort membership is maker-checker controlled: one person proposes adding
 * or removing a member (feature_flag.manage); a second person — never the
 * proposer, nor a user being placed in the cohort — applies it
 * (feature_flag.approve).
 */
function Cohorts({ branches }: { branches: BranchRef[] }) {
    const t = useTranslations('Governance.cohort');
    const { showToast } = useToast();
    const { can, access, reloadWork } = useWorkspace();
    const me = access?.principal.id;
    const { data, error: loadError, reload } = useApi<{ members: CohortMember[]; changes: CohortChange[] }>('/lending/access/cohorts');
    const { busy, error, run, clearError } = useAction();
    const [cohortCode, setCohortCode] = useState('');
    const [subjectType, setSubjectType] = useState<'BRANCH' | 'USER' | 'BORROWER'>('BRANCH');
    const [subjectId, setSubjectId] = useState('');
    const [member, setMember] = useState('true');
    const [reason, setReason] = useState('');
    const canManage = can('feature_flag.manage');
    const canApprove = can('feature_flag.approve');
    const codeErr = cohortCode && !/^[A-Z0-9_]{2,40}$/.test(cohortCode.trim()) ? t('codeInvalid') : undefined;
    const valid = !!cohortCode.trim() && !codeErr && !!subjectId.trim();
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const subject = (type: string, id: string) =>
        type === 'USER' ? <Person id={id} /> : type === 'BRANCH' ? <span>{branchName.get(id) ?? id}</span> : <span className="font-mono text-[12px]">{id}</span>;

    const propose = async () => {
        const r = await run('cohort', () => api.post('/lending/access/cohorts', { cohortCode: cohortCode.trim(), subjectType, subjectId: subjectId.trim(), member: member === 'true', ...(reason.trim() ? { reason: reason.trim() } : {}) }));
        if (r) { showToast(t('proposed'), 'success'); setSubjectId(''); setReason(''); reload(); }
    };
    const decide = async (c: CohortChange, approve: boolean) => {
        const r = await run(`decide-${c.id}`, () => api.post(`/lending/access/cohort-changes/${c.id}/decision`, { approve }));
        if (r) { showToast(approve ? t('applied') : t('rejected'), 'success'); reload(); reloadWork(); }
    };

    const pending = (data?.changes ?? []).filter((c) => c.status === 'PENDING');
    return (
        <>
            <Card title={t('title')} subtitle={t('subtitle')} bodyClass="p-0">
                <div className="p-4 pb-0 space-y-2"><ErrorBox error={loadError} /><ErrorBox error={error} onDismiss={clearError} /></div>
                {!data ? <Spinner /> : (
                    <>
                        <div className="px-4 pt-3 text-[12px] font-semibold text-[#3C4257]">{t('pending')}</div>
                        {pending.length === 0 ? <Empty>{t('noPending')}</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE]"><th className={th}>{t('cohort')}</th><th className={th}>{t('change')}</th><th className={th}>{t('subject')}</th><th className={th}>{t('proposedBy')}</th><th className={th}></th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {pending.map((c) => {
                                        const own = !!me && (c.makerId === me || (c.subjectType === 'USER' && c.subjectId === me));
                                        const why = !canApprove ? t('needApprove') : own ? t('ownChange') : undefined;
                                        return (
                                            <tr key={c.id} className="bg-amber-50/60">
                                                <td className={td}><span className="font-mono text-[12px]">{c.cohortCode}</span></td>
                                                <td className={td}>{c.member ? t('add') : t('remove')}{c.reason && <div className="text-[11px] text-[#697386]">{c.reason}</div>}</td>
                                                <td className={td}>{t(`type.${c.subjectType}`)}: {subject(c.subjectType, c.subjectId)}</td>
                                                <td className={td}><Person id={c.makerId} /><div className="text-[11px] text-[#697386]">{fmtDateTime(c.createdAt)}</div></td>
                                                <td className={`${td} text-right whitespace-nowrap space-x-1`}>
                                                    <Btn size="sm" variant="primary" busy={busy === `decide-${c.id}`} disabled={!!busy || !!why} reason={why} onClick={() => decide(c, true)}>{t('approve')}</Btn>
                                                    <Btn size="sm" variant="danger" disabled={!!busy || !!why} reason={why} onClick={() => decide(c, false)}>{t('reject')}</Btn>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        )}
                        <div className="px-4 pt-3 text-[12px] font-semibold text-[#3C4257]">{t('members')}</div>
                        {data.members.length === 0 ? <Empty>{t('noMembers')}</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE]"><th className={th}>{t('cohort')}</th><th className={th}>{t('subject')}</th><th className={th}>{t('proposedBy')}</th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {data.members.map((m) => (
                                        <tr key={m.id}>
                                            <td className={td}><span className="font-mono text-[12px]">{m.cohortCode}</span></td>
                                            <td className={td}>{t(`type.${m.subjectType}`)}: {subject(m.subjectType, m.subjectId)}</td>
                                            <td className={td}><Person id={m.addedBy} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </>
                )}
            </Card>
            {canManage && (
                <Card title={t('proposeTitle')} subtitle={t('proposeSubtitle')}>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <Field label={t('cohortCode')} error={codeErr}><TextInput value={cohortCode} onChange={(v) => setCohortCode(v.toUpperCase())} maxLength={40} placeholder="PILOT_2026" /></Field>
                            <Field label={t('subjectType')}>
                                <SelectInput value={subjectType} onChange={(v) => { setSubjectType(v as 'BRANCH' | 'USER' | 'BORROWER'); setSubjectId(''); }} options={(['BRANCH', 'USER', 'BORROWER'] as const).map((v) => ({ value: v, label: t(`type.${v}`) }))} />
                            </Field>
                            <Field label={t('subject')} hint={subjectType === 'BORROWER' ? t('borrowerHint') : undefined}>
                                {subjectType === 'BRANCH' ? (
                                    <SelectInput value={subjectId} onChange={setSubjectId} options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder={t('pickBranch')} />
                                ) : subjectType === 'USER' ? (
                                    <UserPicker value={subjectId} onChange={(id) => setSubjectId(id)} placeholder={t('pickUser')} />
                                ) : (
                                    <TextInput value={subjectId} onChange={setSubjectId} maxLength={64} placeholder={t('borrowerId')} />
                                )}
                            </Field>
                            <Field label={t('membership')}><SelectInput value={member} onChange={setMember} options={[{ value: 'true', label: t('add') }, { value: 'false', label: t('remove') }]} /></Field>
                        </div>
                        <Field label={t('reason')}><TextInput value={reason} onChange={setReason} maxLength={300} /></Field>
                        <div className="flex justify-end">
                            <Btn variant="primary" busy={busy === 'cohort'} disabled={!valid} onClick={propose}>{t('propose')}</Btn>
                        </div>
                    </div>
                </Card>
            )}
        </>
    );
}
