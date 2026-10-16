"use client";

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell, useLendingHref } from '@/components/lending/LendingShell';
import { ActionPanel, Btn, Card, ErrorBox, Field, IssueList, JsonBlock, KV, Notice, Spinner, TextArea, TextInput } from '@/components/lending/ui';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { JsonDiff } from '@/components/lending/JsonDiff';
import { ConfigEditor } from '@/components/lending/products/ConfigEditor';
import { normalizeIssues } from '@/components/lending/products/NewProductWizard';
import { useAction, useApi, useCapabilities } from '@/components/lending/useAsync';
import type { MissingCapability, ProductConfig, ProductVersionDetail } from '@/components/lending/types';

type Act = 'submit' | 'approve' | 'reject' | 'activate' | 'retire';
const PAST: Record<Act, string> = { submit: 'submitted', approve: 'approved', reject: 'rejected', activate: 'activated', retire: 'retired' };

const ACTIONS: { act: Act; label: string; from: string; perm: string; variant: 'primary' | 'secondary' | 'danger' }[] = [
    { act: 'submit', label: 'Submit for approval', from: 'DRAFT', perm: 'loan_product.submit', variant: 'primary' },
    { act: 'approve', label: 'Approve', from: 'SUBMITTED', perm: 'loan_product.approve', variant: 'primary' },
    { act: 'reject', label: 'Reject', from: 'SUBMITTED', perm: 'loan_product.reject', variant: 'danger' },
    { act: 'activate', label: 'Activate', from: 'APPROVED', perm: 'loan_product.activate', variant: 'primary' },
    { act: 'retire', label: 'Retire', from: 'ACTIVE', perm: 'loan_product.retire', variant: 'danger' },
];

function missingLabel(m: MissingCapability | string) {
    return typeof m === 'string' ? m : `${m.id} (${m.status.replace(/_/g, ' ')})${m.description ? ` — ${m.description}` : ''}`;
}

export default function ProductVersionPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const href = useLendingHref();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const { data: v, error: loadError, loading, reload } = useApi<ProductVersionDetail>(`/lending/product-versions/${id}`);
    const { can, reload: reloadCaps } = useCapabilities('PRODUCT_VERSION', id);
    const { busy, error, run, clearError } = useAction();

    const [draft, setDraft] = useState<ProductConfig | null>(null);
    const [summary, setSummary] = useState('');
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');

    const refresh = () => { reload(); reloadCaps(); };

    if (loading && !v) return <LendingShell title="Product version"><Spinner /></LendingShell>;
    if (loadError || !v) return <LendingShell title="Product version" back={{ href: '/lending/products', label: 'Products' }}><ErrorBox error={loadError} /></LendingShell>;

    const productName = v.product?.name ?? 'Product';
    const missing = v.missingCapabilities ?? [];
    const isDraft = v.status === 'DRAFT';

    const transition = async (act: Act, body: Record<string, string> = {}) => {
        if (act === 'activate' || act === 'retire') {
            const ok = await confirm({
                title: act === 'activate' ? 'Activate this version?' : 'Retire this version?',
                message: act === 'activate'
                    ? 'New applications will use this configuration. Any currently active version will be superseded.'
                    : 'The product will no longer accept new applications on this version. Existing loans keep their terms.',
                confirmLabel: act === 'activate' ? 'Activate' : 'Retire',
                variant: act === 'retire' ? 'danger' : 'warning',
            });
            if (!ok) return;
        }
        const r = await run(act, () => api.post(`/lending/product-versions/${id}/${act}`, body));
        if (r) {
            showToast(`Version ${PAST[act]}`, 'success');
            setRejecting(false);
            setReason('');
            refresh();
        }
    };

    const saveDraft = async () => {
        const r = await run('save', () => api.put(`/lending/product-versions/${id}`, { config: draft, ...(summary.trim() ? { changeSummary: summary.trim() } : {}) }));
        if (r) {
            showToast('Draft saved', 'success');
            setDraft(null);
            refresh();
        }
    };

    const newVersion = async () => {
        const r = await run('newVersion', () => api.post<{ id: string }>(`/lending/products/${v.productId}/versions`, {}));
        if (r) {
            showToast('New draft version created', 'success');
            router.push(href(`/lending/products/versions/${r.data.id}`));
        }
    };

    const saveIssues = normalizeIssues(error?.issues);

    return (
        <LendingShell
            back={{ href: '/lending/products', label: 'Products' }}
            title={<span className="flex items-center gap-2">{productName} v{v.version} <StatusBadge status={v.status} /></span>}
            subtitle={<span className="font-mono text-[12px]">{v.product?.code} · {v.product?.familyCode} / {v.product?.templateCode}</span>}
            actions={<>
                <Link href={href(`/lending/simulator?version=${v.id}`)} className="text-[13px] font-semibold text-[#635BFF] hover:underline mr-2">Simulate pricing →</Link>
                {ACTIONS.filter((a) => a.from === v.status).map((a) => {
                    const c = can(a.perm);
                    if (a.act === 'reject') {
                        return <Btn key={a.act} variant="danger" disabled={!c.allowed} reason={c.reason} onClick={() => setRejecting(true)}>Reject</Btn>;
                    }
                    return <Btn key={a.act} variant={a.variant} busy={busy === a.act} disabled={!c.allowed} reason={c.reason} onClick={() => transition(a.act)}>{a.label}</Btn>;
                })}
                {(v.status === 'ACTIVE' || v.status === 'RETIRED' || v.status === 'REJECTED') && (
                    <Btn busy={busy === 'newVersion'} disabled={!can('loan_product.create').allowed} reason={can('loan_product.create').reason} onClick={newVersion}>New version</Btn>
                )}
            </>}
        >
            <ErrorBox error={error && !saveIssues.length ? error : null} onDismiss={clearError} />
            {error?.code === 'MISSING_CAPABILITIES' && (
                <Notice tone="danger" title="Activation refused: the engine lacks capabilities this configuration needs">
                    Activation requires every required capability to be IMPLEMENTED. See the missing list below and the <Link className="underline" href={href('/lending/catalogue')}>capability matrix</Link>.
                </Notice>
            )}

            {rejecting && (
                <ActionPanel title="Reject this version" onClose={() => setRejecting(false)}>
                    <Field label="Reason"><TextArea value={reason} onChange={setReason} rows={2} /></Field>
                    <Btn variant="danger" busy={busy === 'reject'} onClick={() => transition('reject', reason.trim() ? { reason: reason.trim() } : {})}>Confirm rejection</Btn>
                </ActionPanel>
            )}

            {v.status === 'SUBMITTED' && (
                <Card title="Changes to review before approval" subtitle={v.activeVersionId ? 'Differences from the currently active version' : 'There is no active version — this is the first configuration.'} className="border-[#635BFF] ring-1 ring-[#635BFF]/20">
                    {v.diffFromActive ? <JsonDiff diff={v.diffFromActive} /> : <p className="text-[13px] text-[#697386]">No active version to compare against; review the full configuration below.</p>}
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title="Version">
                    <KV cols={2} items={[
                        ['Status', <StatusBadge key="s" status={v.status} />],
                        ['Effective', `${v.effectiveFrom ?? '—'}${v.effectiveTo ? ` → ${v.effectiveTo}` : ''}`],
                        ['Maker', <span key="m" className="font-mono text-[11px]">{v.makerId ?? '—'}</span>],
                        ['Checker', <span key="c" className="font-mono text-[11px]">{v.checkerId ?? '—'}</span>],
                        ['Change summary', v.changeSummary || '—'],
                        ['Active version', v.activeVersionId ? <Link key="a" className="text-[#635BFF] hover:underline" href={href(`/lending/products/versions/${v.activeVersionId}`)}>open</Link> : 'none'],
                    ]} />
                </Card>
                <Card title="Validation">
                    {v.validation.ok
                        ? <Notice tone="success" title="Configuration is valid" />
                        : <Notice tone="danger" title={`${v.validation.issues.length} issue(s)`}><IssueList issues={v.validation.issues} /></Notice>}
                </Card>
                <Card title="Capabilities" subtitle={`${v.requiredCapabilities.length} required`}>
                    {missing.length === 0
                        ? <Notice tone="success" title="All required capabilities are implemented" />
                        : (
                            <Notice tone="danger" title={`${missing.length} missing — activation will be refused`}>
                                <ul className="list-disc pl-4 space-y-0.5 mt-1">{missing.map((m, i) => <li key={i} className="text-[12px]">{missingLabel(m)}</li>)}</ul>
                            </Notice>
                        )}
                    <p className="mt-2 text-[11px] font-mono text-[#8792A2] break-words">{v.requiredCapabilities.join(', ')}</p>
                </Card>
            </div>

            {v.status !== 'SUBMITTED' && v.diffFromActive && v.diffFromActive.length > 0 && (
                <Card title="Differences from active version"><JsonDiff diff={v.diffFromActive} /></Card>
            )}

            <Card
                title="Configuration"
                subtitle={isDraft ? 'Drafts can be edited. Submitting freezes the configuration for review.' : 'Read-only — create a new version to change it.'}
                actions={isDraft && !draft && (
                    <Btn variant="primary" disabled={!can('loan_product.update').allowed} reason={can('loan_product.update').reason} onClick={() => setDraft(v.config)}>Edit draft</Btn>
                )}
            >
                {draft ? (
                    <div className="space-y-4">
                        <ConfigEditor config={draft} onChange={setDraft} issues={saveIssues} />
                        {saveIssues.length > 0 && <ErrorBox error={{ message: `${error?.message ?? 'Validation failed'} — see the highlighted steps.`, code: error?.code }} />}
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                            <Field label="Change summary" className="flex-1"><TextInput value={summary} onChange={setSummary} maxLength={500} placeholder="What changed and why" /></Field>
                            <div className="flex gap-2">
                                <Btn onClick={() => { setDraft(null); clearError(); }}>Cancel</Btn>
                                <Btn variant="primary" busy={busy === 'save'} onClick={saveDraft}>Save draft</Btn>
                            </div>
                        </div>
                    </div>
                ) : (
                    <JsonBlock value={v.config} />
                )}
            </Card>
        </LendingShell>
    );
}
