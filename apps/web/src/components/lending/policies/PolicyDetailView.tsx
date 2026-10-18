"use client";

import { useState } from 'react';
import { Plus } from 'lucide-react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
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

export function PolicyDetailView({ id, initialVersionId }: { id: string; initialVersionId?: string | null }) {
    const t = useTranslations('LendingPolicies');
    const { showToast } = useToast();
    const confirm = useConfirm();
    const myId = useMyId();
    const { data: policy, error: loadError, loading, reload } = useApi<LendingPolicy>(`/lending/policies/${id}`);
    const { busy, error, run, clearError } = useAction();
    const [selectedId, setSelectedId] = useState<string | null>(initialVersionId ?? null);
    const [adding, setAdding] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');

    if (loading && !policy) return <LendingShell title={t('detail.policy')} back={{ href: '/lending/policies', label: t('library.title') }}><Spinner /></LendingShell>;
    if (!policy) return <LendingShell title={t('detail.policy')} back={{ href: '/lending/policies', label: t('library.title') }}><ErrorBox error={loadError} /></LendingShell>;

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
                title: t('detail.retireTitle', { code: policy.code, version: v.version }),
                message: t('detail.retireMessage'),
                confirmLabel: t('detail.retire'),
                variant: 'danger',
            });
            if (!ok) return;
        }
        const r = await run(act, () => api.post(`/lending/policy-versions/${v.id}/${act}`, body ?? {}));
        if (r) {
            showToast(t(`detail.past.${act}`, { code: policy.code, version: v.version }), 'success');
            setRejecting(false);
            setReason('');
            reload();
        }
    };

    return (
        <LendingShell
            back={{ href: '/lending/policies', label: t('library.title') }}
            title={<span className="flex items-center gap-2"><span className="font-mono">{policy.code}</span> {policy.name}</span>}
            subtitle={<>{KIND_INFO[policy.kind] ? t(`kind.${policy.kind}`) : policy.kind} · {t.rich('detail.replaces', { path: () => <span className="font-mono text-[12px]">{KIND_INFO[policy.kind]?.path}</span> })}</>}
            actions={!adding && canDraft && (
                <Btn variant="primary" onClick={() => { setAdding(true); clearError(); }} reason={hasOpenDraft ? t('detail.openDraft') : undefined}>
                    <Plus size={15} /> {t('detail.newVersion')}
                </Btn>
            )}
        >
            {loadError && <ErrorBox error={loadError} />}

            {adding && (
                <NewVersionForm
                    policy={policy}
                    onClose={() => setAdding(false)}
                    onCreated={(v) => {
                        showToast(t('detail.draftCreated', { version: v.version }), 'success');
                        setAdding(false);
                        setSelectedId(v.id);
                        reload();
                    }}
                />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t('detail.policy')} className="lg:col-span-1">
                    <KV cols={2} items={[
                        [t('detail.kind'), <span key="k" className="font-mono text-[12px]">{policy.kind}</span>],
                        [t('detail.liveVersion'), live ? `v${live.version}` : <span key="n" className="text-amber-700">{t('noneApproved')}</span>],
                        [t('detail.created'), fmtDateTime(policy.createdAt)],
                        [t('detail.createdBy'), <Person key="c" id={policy.createdBy} />],
                    ]} />
                    {policy.description && <p className="mt-3 text-[13px] text-[#3C4257] whitespace-pre-wrap">{policy.description}</p>}
                    {!live && <div className="mt-3"><Notice tone="warn">{t('detail.notLive')}</Notice></div>}
                </Card>
                <Card title={t('detail.versions')} subtitle={t('detail.versionsSubtitle')} bodyClass="p-0" className="lg:col-span-2">
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('detail.colVersion')}</th>
                                <th className={th}>{t('detail.colStatus')}</th>
                                <th className={th}>{t('changeSummary')}</th>
                                <th className={th}>{t('detail.colMakerChecker')}</th>
                                <th className={thR}>{t('detail.created')}</th>
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
                    title={<span className="flex items-center gap-2">{t('detail.versionN', { version: selected.version })} <StatusBadge status={selected.status} /></span>}
                    subtitle={selected.changeSummary || undefined}
                    className={selected.status === 'SUBMITTED' ? 'border-[#635BFF] ring-1 ring-[#635BFF]/20' : ''}
                    actions={<>
                        {selected.status === 'DRAFT' && canSubmit && <Btn variant="primary" busy={busy === 'submit'} onClick={() => transition(selected, 'submit')}>{t('detail.submit')}</Btn>}
                        {selected.status === 'SUBMITTED' && canApprove && <>
                            <Btn variant="primary" busy={busy === 'approve'} onClick={() => transition(selected, 'approve')}
                                title={iAmMaker ? t('detail.youMadeTitle') : undefined}>{t('detail.approve')}</Btn>
                            <Btn variant="danger" onClick={() => setRejecting(true)}>{t('detail.reject')}</Btn>
                        </>}
                        {selected.status === 'APPROVED' && canRetire && <Btn variant="danger" busy={busy === 'retire'} onClick={() => transition(selected, 'retire')}>{t('detail.retire')}</Btn>}
                    </>}
                >
                    <div className="space-y-4">
                        {selected.status === 'SUBMITTED' && iAmMaker && (
                            <Notice tone="info" title={t('detail.makerChecker')}>{t('detail.youMade')}</Notice>
                        )}
                        <ErrorBox error={error} onDismiss={clearError} />
                        {rejecting && selected.status === 'SUBMITTED' && (
                            <ActionPanel title={t('detail.rejectTitle', { version: selected.version })} onClose={() => setRejecting(false)}>
                                <Field label={t('detail.reason')} hint={t('detail.reasonHint')}>
                                    <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} />
                                </Field>
                                <Btn variant="danger" busy={busy === 'reject'} disabled={!reason.trim()} onClick={() => transition(selected, 'reject', { reason: reason.trim() })}>{t('detail.confirmReject')}</Btn>
                            </ActionPanel>
                        )}
                        {selected.status === 'REJECTED' && selected.rejectionReason && (
                            <Notice tone="danger" title={t('detail.rejected')}>{selected.rejectionReason}</Notice>
                        )}

                        <KV cols={4} items={[
                            [t('detail.maker'), <Person key="m" id={selected.makerId} />],
                            [t('detail.submitted'), fmtDateTime(selected.submittedAt)],
                            [t('detail.checker'), selected.checkerId ? <Person key="k" id={selected.checkerId} /> : '—'],
                            [t('detail.approved'), fmtDateTime(selected.approvedAt)],
                            [t('detail.retired'), fmtDateTime(selected.retiredAt)],
                            [t('detail.bodyHash'), <span key="h" className="font-mono text-[11px] break-all" title={selected.bodyHash}>{selected.bodyHash?.slice(0, 16)}…</span>],
                        ]} />

                        <div>
                            <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">{t('parameters')}</p>
                            {Object.keys(selected.parameters ?? {}).length === 0 ? (
                                <p className="text-[12px] text-[#697386]">{t('detail.noParameters')}</p>
                            ) : (
                                <Table className="border border-[#E3E8EE] rounded">
                                    <thead>
                                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                            <th className={th}>{t('col.name')}</th>
                                            <th className={th}>{t('col.label')}</th>
                                            <th className={th}>{t('col.type')}</th>
                                            <th className={thR}>{t('col.default')}</th>
                                            <th className={thR}>{t('col.min')}</th>
                                            <th className={thR}>{t('col.max')}</th>
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
                            <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">{t('detail.body')}</p>
                            <JsonBlock value={selected.body} />
                        </div>

                        <div>
                            <p className="text-[12px] font-semibold text-[#3C4257] mb-1.5">
                                {previous ? t('changesFrom', { version: previous.version }) : t('detail.changes')}
                            </p>
                            {previous ? (
                                <JsonDiff
                                    diff={jsonDiff({ parameters: previous.parameters ?? {}, body: previous.body }, { parameters: selected.parameters ?? {}, body: selected.body })}
                                    emptyLabel={t('detail.identical', { version: previous.version })}
                                />
                            ) : <p className="text-[13px] text-[#697386]">{t('detail.firstVersion')}</p>}
                        </div>
                    </div>
                </Card>
            )}
        </LendingShell>
    );
}
