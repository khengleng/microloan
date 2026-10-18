"use client";

import { useState } from 'react';
import { Plus } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell } from '../LendingShell';
import { ActionPanel, Btn, Card, ErrorBox, Field, JsonBlock, KV, Notice, Spinner, Table, TextArea, td, th, tdR, thR } from '../ui';
import { useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { JsonDiff } from '../JsonDiff';
import { fmtDateTime } from '../format';
import { useMyId } from '../access/common';
import { useWorkspace } from '@/lib/workspace';
import { Person } from '../People';
import { KIND_INFO, jsonDiff } from './types';
import type { LendingPolicy, LendingPolicyVersion } from './types';
import { NewVersionForm } from './NewVersionForm';

type Act = 'submit' | 'approve' | 'reject' | 'retire';
const PAST: Record<Act, string> = { submit: 'submitted for approval', approve: 'approved', reject: 'rejected', retire: 'retired' };

export function PolicyDetailView({ id, initialVersionId }: { id: string; initialVersionId?: string | null }) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const myId = useMyId();
    const { data: policy, error: loadError, loading, reload } = useApi<LendingPolicy>(`/lending/policies/${id}`);
    const { busy, error, run, clearError } = useAction();
    const [selectedId, setSelectedId] = useState<string | null>(initialVersionId ?? null);
    const [adding, setAdding] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');

    if (loading && !policy) return <LendingShell title="Policy" back={{ href: '/lending/policies', label: 'Policy library' }}><Spinner /></LendingShell>;
    if (!policy) return <LendingShell title="Policy" back={{ href: '/lending/policies', label: 'Policy library' }}><ErrorBox error={loadError} /></LendingShell>;

    const versions = policy.versions;
    const selected = versions.find((v) => v.id === selectedId) ?? versions[0];
    const previous = selected ? versions.find((v) => v.version === selected.version - 1) : undefined;
    const live = versions.find((v) => v.status === 'APPROVED');
    const hasOpenDraft = versions.some((v) => v.status === 'DRAFT' || v.status === 'SUBMITTED');
    const iAmMaker = !!myId && !!selected && selected.makerId === myId;
    const { can } = useWorkspace();
    // Policy versions are governed like product versions (policy/actions.ts lending_policy.*).
    const canDraft = can('loan_product.create');
    const canSubmit = can('loan_product.submit');
    const canApprove = can('loan_product.approve') && !iAmMaker;
    const canRetire = can('loan_product.retire');

    const transition = async (v: LendingPolicyVersion, act: Act, body?: { reason: string }) => {
        if (act === 'retire') {
            const ok = await confirm({
                title: `Retire ${policy.code} v${v.version}?`,
                message: 'New contracts can no longer be composed from this version. Contracts already booked keep the terms they were frozen with.',
                confirmLabel: 'Retire',
                variant: 'danger',
            });
            if (!ok) return;
        }
        const r = await run(act, () => api.post(`/lending/policy-versions/${v.id}/${act}`, body ?? {}));
        if (r) {
            showToast(`${policy.code} v${v.version} ${PAST[act]}`, 'success');
            setRejecting(false);
            setReason('');
            reload();
        }
    };

    return (
        <LendingShell
            back={{ href: '/lending/policies', label: 'Policy library' }}
            title={<span className="flex items-center gap-2"><span className="font-mono">{policy.code}</span> {policy.name}</span>}
            subtitle={<>{KIND_INFO[policy.kind]?.label ?? policy.kind} · replaces <span className="font-mono text-[12px]">{KIND_INFO[policy.kind]?.path}</span></>}
            actions={!adding && canDraft && (
                <Btn variant="primary" onClick={() => { setAdding(true); clearError(); }} reason={hasOpenDraft ? 'A version is already in draft or awaiting approval' : undefined}>
                    <Plus size={15} /> New version
                </Btn>
            )}
        >
            {loadError && <ErrorBox error={loadError} />}

            {adding && (
                <NewVersionForm
                    policy={policy}
                    onClose={() => setAdding(false)}
                    onCreated={(v) => {
                        showToast(`Draft v${v.version} created`, 'success');
                        setAdding(false);
                        setSelectedId(v.id);
                        reload();
                    }}
                />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title="Policy" className="lg:col-span-1">
                    <KV cols={2} items={[
                        ['Kind', <span key="k" className="font-mono text-[12px]">{policy.kind}</span>],
                        ['Live version', live ? `v${live.version}` : <span key="n" className="text-amber-700">none approved</span>],
                        ['Created', fmtDateTime(policy.createdAt)],
                        ['Created by', <Person key="c" id={policy.createdBy} />],
                    ]} />
                    {policy.description && <p className="mt-3 text-[13px] text-[#3C4257] whitespace-pre-wrap">{policy.description}</p>}
                    {!live && <div className="mt-3"><Notice tone="warn">Products cannot go live with this policy on a menu until a version is approved.</Notice></div>}
                </Card>
                <Card title="Versions" subtitle="Approved versions are immutable — running contracts reference them." bodyClass="p-0" className="lg:col-span-2">
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Version</th>
                                <th className={th}>Status</th>
                                <th className={th}>Change summary</th>
                                <th className={th}>Maker / checker</th>
                                <th className={thR}>Created</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {versions.map((v) => (
                                <tr key={v.id} onClick={() => { setSelectedId(v.id); setRejecting(false); clearError(); }}
                                    className={`cursor-pointer ${selected?.id === v.id ? 'bg-[#F0F5FF]' : 'hover:bg-[#F7FAFC]'}`}>
                                    <td className={`${td} font-semibold`}>v{v.version}</td>
                                    <td className={td}><StatusBadge status={v.status} /></td>
                                    <td className={td}>{v.changeSummary || <span className="text-[#AAB7C4]">—</span>}</td>
                                    <td className={`${td} text-[#697386]`}><Person id={v.makerId} /> / {v.checkerId ? <Person id={v.checkerId} /> : '—'}</td>
                                    <td className={`${tdR} text-[12px]`}>{fmtDateTime(v.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            </div>

            {selected && (
                <Card
                    title={<span className="flex items-center gap-2">Version {selected.version} <StatusBadge status={selected.status} /></span>}
                    subtitle={selected.changeSummary || undefined}
                    className={selected.status === 'SUBMITTED' ? 'border-[#635BFF] ring-1 ring-[#635BFF]/20' : ''}
                    actions={<>
                        {selected.status === 'DRAFT' && canSubmit && <Btn variant="primary" busy={busy === 'submit'} onClick={() => transition(selected, 'submit')}>Submit for approval</Btn>}
                        {selected.status === 'SUBMITTED' && canApprove && <>
                            <Btn variant="primary" busy={busy === 'approve'} onClick={() => transition(selected, 'approve')}
                                title={iAmMaker ? 'You made this version; the server requires a different user to approve it.' : undefined}>Approve</Btn>
                            <Btn variant="danger" onClick={() => setRejecting(true)}>Reject</Btn>
                        </>}
                        {selected.status === 'APPROVED' && canRetire && <Btn variant="danger" busy={busy === 'retire'} onClick={() => transition(selected, 'retire')}>Retire</Btn>}
                    </>}
                >
                    <div className="space-y-4">
                        {selected.status === 'SUBMITTED' && iAmMaker && (
                            <Notice tone="info" title="Maker-checker">You made this version. A different user must approve or reject it.</Notice>
                        )}
                        <ErrorBox error={error} onDismiss={clearError} />
                        {rejecting && selected.status === 'SUBMITTED' && (
                            <ActionPanel title={`Reject v${selected.version}`} onClose={() => setRejecting(false)}>
                                <Field label="Reason" hint="Required — the maker sees it on the version">
                                    <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} />
                                </Field>
                                <Btn variant="danger" busy={busy === 'reject'} disabled={!reason.trim()} onClick={() => transition(selected, 'reject', { reason: reason.trim() })}>Confirm rejection</Btn>
                            </ActionPanel>
                        )}
                        {selected.status === 'REJECTED' && selected.rejectionReason && (
                            <Notice tone="danger" title="Rejected">{selected.rejectionReason}</Notice>
                        )}

                        <KV cols={4} items={[
                            ['Maker', <Person key="m" id={selected.makerId} />],
                            ['Submitted', fmtDateTime(selected.submittedAt)],
                            ['Checker', selected.checkerId ? <Person key="k" id={selected.checkerId} /> : '—'],
                            ['Approved', fmtDateTime(selected.approvedAt)],
                            ['Retired', fmtDateTime(selected.retiredAt)],
                            ['Body hash', <span key="h" className="font-mono text-[11px] break-all" title={selected.bodyHash}>{selected.bodyHash?.slice(0, 16)}…</span>],
                        ]} />

                        <div>
                            <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">Parameters</p>
                            {Object.keys(selected.parameters ?? {}).length === 0 ? (
                                <p className="text-[12px] text-[#697386]">No parameters — the body is used as written.</p>
                            ) : (
                                <Table className="border border-[#E3E8EE] rounded">
                                    <thead>
                                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                            <th className={th}>Name</th>
                                            <th className={th}>Label</th>
                                            <th className={th}>Type</th>
                                            <th className={thR}>Default</th>
                                            <th className={thR}>Min</th>
                                            <th className={thR}>Max</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F0F2F5]">
                                        {Object.entries(selected.parameters).map(([name, p]) => (
                                            <tr key={name}>
                                                <td className={`${td} font-mono text-[12px] font-semibold`}>{name}</td>
                                                <td className={td}>{p.label || <span className="text-[#AAB7C4]">—</span>}</td>
                                                <td className={td}>{p.type}</td>
                                                <td className={tdR}>{p.default}</td>
                                                <td className={tdR}>{p.min}</td>
                                                <td className={tdR}>{p.max}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </div>

                        <div>
                            <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">Body</p>
                            <JsonBlock value={selected.body} />
                        </div>

                        <div>
                            <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">
                                {previous ? `Changes from v${previous.version}` : 'Changes'}
                            </p>
                            {previous ? (
                                <JsonDiff
                                    diff={jsonDiff({ parameters: previous.parameters ?? {}, body: previous.body }, { parameters: selected.parameters ?? {}, body: selected.body })}
                                    emptyLabel={`Identical to v${previous.version}.`}
                                />
                            ) : <p className="text-[13px] text-[#697386]">First version — nothing to compare against.</p>}
                        </div>
                    </div>
                </Card>
            )}
        </LendingShell>
    );
}
