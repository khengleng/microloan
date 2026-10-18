"use client";

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell, useLendingHref } from '@/components/lending/LendingShell';
import { ActionPanel, Btn, Card, ErrorBox, Field, IssueList, JsonBlock, KV, Notice, Spinner, TextArea, TextInput } from '@/components/lending/ui';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { JsonDiff } from '@/components/lending/JsonDiff';
import { Person } from '@/components/lending/People';
import { ConfigEditor } from '@/components/lending/products/ConfigEditor';
import { normalizeIssues } from '@/components/lending/products/NewProductWizard';
import { useAction, useApi, useCapabilities } from '@/components/lending/useAsync';
import type { MissingCapability, ProductConfig, ProductVersionDetail } from '@/components/lending/types';

type Act = 'submit' | 'approve' | 'reject' | 'activate' | 'retire';
// Button labels and toasts come from LendingProducts.version.actions.<act> / done.<act>.
const ACTIONS: { act: Act; from: string; perm: string; variant: 'primary' | 'secondary' | 'danger' }[] = [
    { act: 'submit', from: 'DRAFT', perm: 'loan_product.submit', variant: 'primary' },
    { act: 'approve', from: 'SUBMITTED', perm: 'loan_product.approve', variant: 'primary' },
    { act: 'reject', from: 'SUBMITTED', perm: 'loan_product.reject', variant: 'danger' },
    { act: 'activate', from: 'APPROVED', perm: 'loan_product.activate', variant: 'primary' },
    { act: 'retire', from: 'ACTIVE', perm: 'loan_product.retire', variant: 'danger' },
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
    const t = useTranslations('LendingProducts.version');

    const [draft, setDraft] = useState<ProductConfig | null>(null);
    const [summary, setSummary] = useState('');
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');

    const refresh = () => { reload(); reloadCaps(); };

    if (loading && !v) return <LendingShell title={t('title')}><Spinner /></LendingShell>;
    if (loadError || !v) return <LendingShell title={t('title')} back={{ href: '/lending/products', label: 'Products' }}><ErrorBox error={loadError} /></LendingShell>;

    const productName = v.product?.name ?? t('product');
    const missing = v.missingCapabilities ?? [];
    const isDraft = v.status === 'DRAFT';

    const transition = async (act: Act, body: Record<string, string> = {}) => {
        if (act === 'activate' || act === 'retire') {
            const ok = await confirm({
                title: act === 'activate' ? t('activateTitle') : t('retireTitle'),
                message: act === 'activate' ? t('activateBody') : t('retireBody'),
                confirmLabel: act === 'activate' ? t('actions.activate') : t('actions.retire'),
                variant: act === 'retire' ? 'danger' : 'warning',
            });
            if (!ok) return;
        }
        const r = await run(act, () => api.post(`/lending/product-versions/${id}/${act}`, body));
        if (r) {
            showToast(t(`done.${act}`), 'success');
            setRejecting(false);
            setReason('');
            refresh();
        }
    };

    const saveDraft = async () => {
        const r = await run('save', () => api.put(`/lending/product-versions/${id}`, { config: draft, ...(summary.trim() ? { changeSummary: summary.trim() } : {}) }));
        if (r) {
            showToast(t('draftSaved'), 'success');
            setDraft(null);
            refresh();
        }
    };

    const newVersion = async () => {
        const r = await run('newVersion', () => api.post<{ id: string }>(`/lending/products/${v.productId}/versions`, {}));
        if (r) {
            showToast(t('newDraftCreated'), 'success');
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
                <Link href={href(`/lending/simulator?version=${v.id}`)} className="text-[13px] font-semibold text-[#635BFF] hover:underline mr-2">{t('simulate')}</Link>
                {ACTIONS.filter((a) => a.from === v.status).map((a) => {
                    const c = can(a.perm);
                    if (a.act === 'reject') {
                        return <Btn data-tour="product-version-reject" key={a.act} variant="danger" disabled={!c.allowed} reason={c.reason} onClick={() => setRejecting(true)}>{t('actions.reject')}</Btn>;
                    }
                    return <Btn data-tour="product-version-action" key={a.act} variant={a.variant} busy={busy === a.act} disabled={!c.allowed} reason={c.reason} onClick={() => transition(a.act)}>{t(`actions.${a.act}`)}</Btn>;
                })}
                {(v.status === 'ACTIVE' || v.status === 'RETIRED' || v.status === 'REJECTED') && (
                    <Btn data-tour="product-version-new" busy={busy === 'newVersion'} disabled={!can('loan_product.create').allowed} reason={can('loan_product.create').reason} onClick={newVersion}>{t('newVersion')}</Btn>
                )}
            </>}
        >
            <ErrorBox error={error && !saveIssues.length ? error : null} onDismiss={clearError} />
            {error?.code === 'MISSING_CAPABILITIES' && (
                <Notice tone="danger" title={t('refusedTitle')}>
                    {t.rich('refusedBody', { link: (c) => <Link className="underline" href={href('/lending/catalogue')}>{c}</Link> })}
                </Notice>
            )}

            {rejecting && (
                <ActionPanel title={t('rejectTitle')} onClose={() => setRejecting(false)}>
                    <Field label={t('reason')}><TextArea value={reason} onChange={setReason} rows={2} /></Field>
                    <Btn variant="danger" busy={busy === 'reject'} onClick={() => transition('reject', reason.trim() ? { reason: reason.trim() } : {})}>{t('confirmReject')}</Btn>
                </ActionPanel>
            )}

            {v.status === 'SUBMITTED' && (
                <Card title={t('reviewTitle')} subtitle={v.activeVersionId ? t('reviewDiff') : t('reviewFirst')} className="border-[#635BFF] ring-1 ring-[#635BFF]/20">
                    {v.diffFromActive ? <JsonDiff diff={v.diffFromActive} /> : <p className="text-[13px] text-[#697386]">{t('noActive')}</p>}
                </Card>
            )}

            <div data-tour="product-version-checks" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t('versionCard')}>
                    <KV cols={2} items={[
                        [t('status'), <StatusBadge key="s" status={v.status} />],
                        [t('effective'), `${v.effectiveFrom ?? '—'}${v.effectiveTo ? ` → ${v.effectiveTo}` : ''}`],
                        [t('maker'), v.makerId ? <Person key="m" id={v.makerId} /> : '—'],
                        [t('checker'), v.checkerId ? <Person key="c" id={v.checkerId} /> : '—'],
                        [t('changeSummary'), v.changeSummary || '—'],
                        [t('activeVersion'), v.activeVersionId ? <Link key="a" className="text-[#635BFF] hover:underline" href={href(`/lending/products/versions/${v.activeVersionId}`)}>{t('open')}</Link> : t('none')],
                    ]} />
                </Card>
                <Card title={t('validation')}>
                    {v.validation.ok
                        ? <Notice tone="success" title={t('valid')} />
                        : <Notice tone="danger" title={t('issues', { count: v.validation.issues.length })}><IssueList issues={v.validation.issues} /></Notice>}
                </Card>
                <Card title={t('capabilities')} subtitle={t('required', { count: v.requiredCapabilities.length })}>
                    {missing.length === 0
                        ? <Notice tone="success" title={t('allImplemented')} />
                        : (
                            <Notice tone="danger" title={t('missing', { count: missing.length })}>
                                <ul className="list-disc pl-4 space-y-0.5 mt-1">{missing.map((m, i) => <li key={i} className="text-[12px]">{missingLabel(m)}</li>)}</ul>
                            </Notice>
                        )}
                    <p className="mt-2 text-[11px] font-mono text-[#8792A2] break-words">{v.requiredCapabilities.join(', ')}</p>
                </Card>
            </div>

            {v.status !== 'SUBMITTED' && v.diffFromActive && v.diffFromActive.length > 0 && (
                <Card title={t('diffTitle')}><JsonDiff diff={v.diffFromActive} /></Card>
            )}

            <Card
                title={t('configuration')}
                subtitle={isDraft ? t('draftEditable') : t('readOnly')}
                actions={isDraft && !draft && (
                    <Btn data-tour="product-version-edit" variant="primary" disabled={!can('loan_product.update').allowed} reason={can('loan_product.update').reason} onClick={() => setDraft(v.config)}>{t('editDraft')}</Btn>
                )}
            >
                {draft ? (
                    <div className="space-y-4">
                        <ConfigEditor config={draft} onChange={setDraft} issues={saveIssues} />
                        {saveIssues.length > 0 && <ErrorBox error={{ message: t('seeSteps', { message: error?.message ?? t('validationFailed') }), code: error?.code }} />}
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                            <Field label={t('changeSummary')} className="flex-1"><TextInput value={summary} onChange={setSummary} maxLength={500} placeholder={t('summaryPlaceholder')} /></Field>
                            <div className="flex gap-2">
                                <Btn onClick={() => { setDraft(null); clearError(); }}>{t('cancel')}</Btn>
                                <Btn variant="primary" busy={busy === 'save'} onClick={saveDraft}>{t('saveDraft')}</Btn>
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
