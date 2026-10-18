"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { ActionPanel, Btn, Card, Checkbox, Empty, ErrorBox, Field, Notice, SelectInput, Table, TextInput, th, td } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { clean, useAction } from '../useAsync';
import { fmtDateTime, localToIso } from '../format';
import type { Assignment } from '../types';
import { useMyId, useUserName, userOptions, type TabProps } from './common';

export function AssignmentsTab({ data, reload }: TabProps) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const userName = useUserName(data.users);
    const me = useMyId();
    const [revoking, setRevoking] = useState<Assignment | null>(null);
    const [revokeReason, setRevokeReason] = useState('');
    const branchName = new Map((data.branches ?? []).map((b) => [b.id, b.name]));
    const { can } = useWorkspace();
    const tg = useTranslations('Governance.scope');
    const canApprove = can('access_policy.approve');
    const canManage = can('access_policy.manage');

    const pending = data.assignments.filter((a) => a.status === 'PENDING');
    const sorted = [...pending, ...data.assignments.filter((a) => a.status !== 'PENDING')];

    const decide = async (a: Assignment, approve: boolean) => {
        const r = await run(`decide-${a.id}`, () => api.post(`/lending/access/assignments/${a.id}/decision`, { approve }));
        if (r) { showToast(approve ? 'Assignment approved' : 'Assignment rejected', 'success'); reload(); }
    };
    const revoke = async () => {
        if (!revoking) return;
        const r = await run('revoke', () => api.post(`/lending/access/assignments/${revoking.id}/revoke`, { reason: revokeReason.trim() }));
        if (r) { showToast('Assignment revoked', 'success'); setRevoking(null); setRevokeReason(''); reload(); }
    };

    return (
        <div className="space-y-5">
            {pending.length > 0 && (
                <Notice tone="warn" title={`${pending.length} assignment request(s) awaiting a second admin`}>
                    Maker-checker: the admin who requested an assignment cannot approve it. Another admin with <code>access_policy.approve</code> must decide.
                </Notice>
            )}
            <Card title="Role assignments" subtitle="Which users hold which roles, and in what scope." bodyClass="p-0">
                <div className="p-4 pb-0"><ErrorBox error={error} onDismiss={clearError} /></div>
                {sorted.length === 0 ? <Empty>No role assignments yet.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE]">
                                <th className={th}>User</th><th className={th}>Role</th><th className={th}>Scope</th><th className={th}>Status</th>
                                <th className={th}>Requested by</th><th className={th}>Approved by</th><th className={th}>Valid to</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {sorted.map((a) => {
                                const own = !!me && a.requestedBy === me;
                                return (
                                    <tr key={a.id} className={a.status === 'PENDING' ? 'bg-amber-50/60' : ''}>
                                        <td className={td}>{userName(a.userId)}</td>
                                        <td className={td}><span className="font-mono text-[12px]">{a.role?.code}</span><div className="text-[11px] text-[#697386]">{a.role?.name}</div></td>
                                        <td className={td}>
                                            {a.allBranches ? 'All branches' : a.branchIds.length ? a.branchIds.map((id) => branchName.get(id) ?? id.slice(0, 8)).join(', ') : 'Own branch'}
                                            {a.portfolioIds.length > 0 && <div className="text-[11px] text-[#697386]">{a.portfolioIds.length} portfolio(s)</div>}
                                        </td>
                                        <td className={td}><StatusBadge status={a.status} /></td>
                                        <td className={td}>{userName(a.requestedBy)}</td>
                                        <td className={td}>{userName(a.approvedBy)}</td>
                                        <td className={td}>{a.validTo ? fmtDateTime(a.validTo) : 'No expiry'}</td>
                                        <td className={`${td} whitespace-nowrap`}>
                                            <div className="flex gap-1.5 justify-end">
                                                {a.status === 'PENDING' && (
                                                    <>
                                                        <Btn size="sm" variant="primary" busy={busy === `decide-${a.id}`} disabled={own || !!busy || !canApprove} reason={!canApprove ? tg('needApprove') : own ? 'You requested this — a second admin must approve' : undefined} onClick={() => decide(a, true)}>Approve</Btn>
                                                        <Btn size="sm" variant="danger" disabled={own || !!busy || !canApprove} reason={!canApprove ? tg('needApprove') : own ? 'You requested this — a second admin must decide' : undefined} onClick={() => decide(a, false)}>Reject</Btn>
                                                    </>
                                                )}
                                                {a.status === 'ACTIVE' && <Btn size="sm" variant="danger" disabled={!canManage} reason={!canManage ? tg('needManage') : undefined} onClick={() => { setRevoking(a); setRevokeReason(''); }}>Revoke</Btn>}
                                            </div>
                                            {a.status === 'PENDING' && own && <p className="text-[10px] text-amber-800 mt-1 text-right">Awaiting another admin</p>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
                {revoking && (
                    <div className="p-4">
                        <ActionPanel title={`Revoke ${revoking.role?.code} from ${userName(revoking.userId)}`} onClose={() => setRevoking(null)}>
                            <Field label="Reason" error={revokeReason && revokeReason.trim().length < 3 ? 'At least 3 characters' : undefined}>
                                <TextInput value={revokeReason} onChange={setRevokeReason} maxLength={300} />
                            </Field>
                            <div className="flex justify-end">
                                <Btn variant="danger" busy={busy === 'revoke'} disabled={revokeReason.trim().length < 3} onClick={revoke}>Revoke assignment</Btn>
                            </div>
                        </ActionPanel>
                    </div>
                )}
            </Card>
            {canManage && <RequestAssignmentForm data={data} reload={reload} />}
        </div>
    );
}

function RequestAssignmentForm({ data, reload }: TabProps) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [userId, setUserId] = useState('');
    const [roleId, setRoleId] = useState('');
    const [allBranches, setAllBranches] = useState(false);
    const [branchIds, setBranchIds] = useState<string[]>([]);
    const [portfolioIds, setPortfolioIds] = useState<string[]>([]);
    const tg = useTranslations('Governance.scope');
    const [validTo, setValidTo] = useState('');
    const [reason, setReason] = useState('');

    const role = data.roles.find((r) => r.id === roleId);
    const valid = !!userId && !!roleId;

    const submit = async () => {
        const body = clean({
            userId,
            roleId,
            allBranches: allBranches || undefined,
            branchIds: !allBranches && branchIds.length ? branchIds : undefined,
            portfolioIds: portfolioIds.length ? portfolioIds : undefined,
            validTo: localToIso(validTo),
            reason: reason.trim(),
        });
        const r = await run('request', () => api.post('/lending/access/assignments', body));
        if (r) {
            showToast('Assignment requested — awaiting approval by another admin', 'success');
            setUserId(''); setRoleId(''); setAllBranches(false); setBranchIds([]); setPortfolioIds([]); setValidTo(''); setReason('');
            reload();
        }
    };

    return (
        <Card title="Request role assignment" subtitle="Creates a PENDING assignment; a different admin must approve it.">
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="User"><SelectInput value={userId} onChange={setUserId} options={userOptions(data.users)} placeholder="Select user…" /></Field>
                    <Field label="Role" hint={role?.sensitive ? 'Sensitive role — grants financial or administrative powers.' : undefined}>
                        <SelectInput value={roleId} onChange={setRoleId} options={data.roles.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}${r.sensitive ? ' (sensitive)' : ''}` }))} placeholder="Select role…" />
                    </Field>
                    <div className="md:col-span-2"><Checkbox checked={allBranches} onChange={setAllBranches} label="All branches" /></div>
                    <Field label={tg('branches')} hint={tg('branchesHint')}>
                        <MultiPick
                            options={(data.branches ?? []).filter((x) => x.isActive || branchIds.includes(x.id)).map((x) => ({ value: x.id, label: x.code ? `${x.name} (${x.code})` : x.name }))}
                            value={allBranches ? [] : branchIds} onChange={setBranchIds} disabled={allBranches} empty={tg('noBranches')}
                        />
                    </Field>
                    <Field label={tg('portfolios')} hint={tg('portfoliosHint')}>
                        <MultiPick
                            options={(data.portfolios ?? []).filter((x) => x.isActive || portfolioIds.includes(x.id)).map((x) => ({ value: x.id, label: `${x.code} — ${x.name}` }))}
                            value={portfolioIds} onChange={setPortfolioIds} empty={tg('noPortfolios')}
                        />
                    </Field>
                    <Field label="Valid to (optional)"><TextInput type="datetime-local" value={validTo} onChange={setValidTo} /></Field>
                    <Field label="Reason (optional)"><TextInput value={reason} onChange={setReason} maxLength={300} /></Field>
                </div>
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end">
                    <Btn variant="primary" busy={busy === 'request'} disabled={!valid} reason={!valid ? tg('selectUserRole') : undefined} onClick={submit}>Request assignment</Btn>
                </div>
            </div>
        </Card>
    );
}

/** A checkbox list for picking several records by name; ids never typed by hand. */
function MultiPick({ options, value, onChange, disabled, empty }: {
    options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; empty: string;
}) {
    if (!options.length) return <p className="text-[12px] text-[#8792A2] pt-1">{empty}</p>;
    return (
        <div className={`max-h-40 overflow-auto rounded border border-[#E3E8EE] p-2 flex flex-col gap-1 ${disabled ? 'opacity-60' : ''}`}>
            {options.map((o) => (
                <Checkbox key={o.value} disabled={disabled} checked={value.includes(o.value)} label={o.label}
                    onChange={(on) => onChange(on ? [...value, o.value] : value.filter((x) => x !== o.value))} />
            ))}
        </div>
    );
}
