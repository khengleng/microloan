"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, Tabs, TextInput, td, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { DOCUMENT_CATEGORIES } from './types';

type Tab = 'review' | 'expiry' | 'retention';

interface QueueRow {
    id: string; borrowerId: string; customer: string; category: string; typeCode: string; title: string;
    origin: string; version: number; fileName?: string; uploadedBy?: string; uploadedAt?: string; expiresOn: string | null; ownUpload: boolean;
}
interface ExpiryRow {
    id: string; borrowerId: string; customer: string; category: string; typeCode: string; title: string;
    expiresOn: string; daysToExpiry: number; expired: boolean; expiryState: string; reminderSentOn: string | null;
}
interface Retention { defaults: Record<string, number>; rules: { id: string; scope: 'CATEGORY' | 'TYPE'; code: string; retentionYears: number; updatedBy: string; updatedAt: string }[] }

/** Documents across customers: the review queue (DOC-4), expiries (DOC-6) and retention rules (DOC-7). */
export function DocumentsHub() {
    const t = useTranslations('LendingDocuments');
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    const [tab, setTab] = useState<Tab>('review');
    return (
        <LendingShell title={tw('documents')} subtitle={tp('documents')}>
            <Tabs<Tab> value={tab} onChange={setTab} tabs={[
                { value: 'review', label: t('hub.tabReview') },
                { value: 'expiry', label: t('hub.tabExpiry') },
                { value: 'retention', label: t('hub.tabRetention') },
            ]} />
            {tab === 'review' && <ReviewQueue />}
            {tab === 'expiry' && <Expiries />}
            {tab === 'retention' && <RetentionRules />}
        </LendingShell>
    );
}

function CustomerLink({ id, name }: { id: string; name: string }) {
    const href = useLendingHref();
    return <Link href={href(`/lending/customers/${id}/documents`)} className="font-semibold text-[#635BFF] hover:underline">{name}</Link>;
}

function ReviewQueue() {
    const t = useTranslations('LendingDocuments');
    const q = useApi<{ documents: QueueRow[] }>('/lending/document-review-queue');
    return (
        <Card title={t('common.awaitingReview')} subtitle={t('hub.awaitingSubtitle')} bodyClass="p-0"
            actions={<Btn size="sm" variant="ghost" onClick={q.reload}>{t('common.refresh')}</Btn>}>
            {q.error && <div className="p-4"><ErrorBox error={q.error} /></div>}
            {q.loading && !q.data ? <Spinner /> : (q.data?.documents.length ?? 0) === 0 ? (!q.error && <Empty>{t('hub.nothingAwaiting')}</Empty>) : (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('common.customer')}</th><th className={th}>{t('common.document')}</th><th className={th}>{t('common.version')}</th><th className={th}>{t('common.uploaded')}</th><th className={th}>{t('common.expires')}</th><th className={th}></th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {q.data!.documents.map((d) => (
                            <tr key={d.id} className="hover:bg-[#F7FAFC]">
                                <td className={td}><CustomerLink id={d.borrowerId} name={d.customer} /></td>
                                <td className={td}>{d.title}<div className="font-mono text-[11px] text-[#697386]">{t.has(`categories.${d.category}`) ? t(`categories.${d.category}`) : d.category.toLowerCase()} · {d.typeCode} · {t.has(`origins.${d.origin}`) ? t(`origins.${d.origin}`) : d.origin.toLowerCase()}</div></td>
                                <td className={td}>v{d.version}<div className="text-[11px] text-[#697386]">{d.fileName}</div></td>
                                <td className={`${td} whitespace-nowrap`}>{fmtDateTime(d.uploadedAt)}</td>
                                <td className={td}>{d.expiresOn ?? '—'}</td>
                                <td className={`${td} text-right`}>{d.ownUpload ? <span className="text-[11px] text-[#8792A2]">{t('hub.yourUpload')}</span> : <CustomerLink id={d.borrowerId} name={t('hub.reviewLink')} />}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

function Expiries() {
    const t = useTranslations('LendingDocuments');
    const { showToast } = useToast();
    const [within, setWithin] = useState('60');
    const list = useApi<{ businessDate: string; documents: ExpiryRow[] }>(`/lending/document-expiries?withinDays=${within}`);
    const { busy, error, run } = useAction();
    return (
        <Card title={t('hub.expiringTitle')} subtitle={list.data ? t('hub.expiringSubtitle', { date: list.data.businessDate }) : undefined} bodyClass="p-0"
            actions={<>
                <SelectInput value={within} onChange={setWithin} options={['30', '60', '180'].map((v) => ({ value: v, label: t('hub.nextDays', { days: v }) }))} className="!w-auto" />
                <Btn size="sm" busy={busy === 'run'} onClick={() => run('run', async () => {
                    const r = await api.post<{ expired: number; reminded: number }>('/lending/document-expiries/run');
                    showToast(t('hub.ranCheck', { expired: r.data.expired, reminded: r.data.reminded }), 'success');
                    list.reload();
                })}><RefreshCw size={13} /> {t('hub.runCheck')}</Btn>
            </>}>
            {error && <div className="p-4"><ErrorBox error={error} /></div>}
            {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
            {list.loading && !list.data ? <Spinner /> : (list.data?.documents.length ?? 0) === 0 ? (!list.error && <Empty>{t('hub.noneExpiring')}</Empty>) : (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('common.customer')}</th><th className={th}>{t('common.document')}</th><th className={th}>{t('common.expires')}</th><th className={th}>{t('hub.colState')}</th><th className={th}>{t('hub.colReminder')}</th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {list.data!.documents.map((d) => (
                            <tr key={d.id} className={d.expired ? 'bg-red-50/40' : d.daysToExpiry <= 30 ? 'bg-amber-50/40' : ''}>
                                <td className={td}><CustomerLink id={d.borrowerId} name={d.customer} /></td>
                                <td className={td}>{d.title}<div className="font-mono text-[11px] text-[#697386]">{d.typeCode}</div></td>
                                <td className={`${td} whitespace-nowrap`}>{d.expiresOn}<div className="text-[11px] text-[#697386]">{d.expired ? t('hub.daysAgo', { count: -d.daysToExpiry }) : t('hub.inDays', { count: d.daysToExpiry })}</div></td>
                                <td className={td}><StatusBadge status={d.expired ? 'EXPIRED' : d.expiryState} /></td>
                                <td className={td}>{d.reminderSentOn ?? '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

function RetentionRules() {
    const t = useTranslations('LendingDocuments');
    const { showToast } = useToast();
    const r = useApi<Retention>('/lending/document-retention');
    const { busy, error, run } = useAction();
    const [form, setForm] = useState({ scope: 'CATEGORY', code: 'KYC', years: '5' });
    const save = (rules: { scope: string; code: string; retentionYears: number | null }[], msg: string) =>
        run('save', async () => {
            await api.put('/lending/document-retention', { rules });
            showToast(msg, 'success');
            r.reload();
        });
    if (r.error?.status === 403) return <Notice tone="warn" title={t('hub.complianceTitle')}>{t('hub.complianceBody')}</Notice>;
    return (
        <div className="space-y-4">
            <Card title={t('hub.periodsTitle')} subtitle={t('hub.periodsSubtitle')}>
                {r.loading && !r.data ? <Spinner /> : r.data && (
                    <div className="space-y-4">
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('hub.colAppliesTo')}</th><th className={th}>{t('common.years')}</th><th className={th}>{t('hub.colSource')}</th><th className={th}></th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {Object.entries(r.data.defaults).map(([cat, years]) => {
                                    const rule = r.data!.rules.find((x) => x.scope === 'CATEGORY' && x.code === cat);
                                    return (
                                        <tr key={cat}>
                                            <td className={td}>{t('hub.categoryRow', { category: t.has(`categories.${cat}`) ? t(`categories.${cat}`) : cat.toLowerCase() })}</td>
                                            <td className={td}>{rule?.retentionYears ?? years}</td>
                                            <td className={td}>{rule ? t('hub.tenantRule', { date: fmtDateTime(rule.updatedAt) }) : t('hub.default')}</td>
                                            <td className={`${td} text-right`}>{rule && <Btn size="sm" variant="ghost" onClick={() => save([{ scope: 'CATEGORY', code: cat, retentionYears: null }], t('hub.backToDefault'))}>{t('hub.useDefault')}</Btn>}</td>
                                        </tr>
                                    );
                                })}
                                {r.data.rules.filter((x) => x.scope === 'TYPE').map((rule) => (
                                    <tr key={rule.id}>
                                        <td className={td}>{t.rich('hub.typeRow', { code: rule.code, mono: (c) => <span className="font-mono">{c}</span> })}</td>
                                        <td className={td}>{rule.retentionYears}</td>
                                        <td className={td}>{t('hub.tenantRule', { date: fmtDateTime(rule.updatedAt) })}</td>
                                        <td className={`${td} text-right`}><Btn size="sm" variant="ghost" onClick={() => save([{ scope: 'TYPE', code: rule.code, retentionYears: null }], t('hub.ruleRemoved'))}>{t('common.remove')}</Btn></td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                            <Field label={t('hub.colAppliesTo')}><SelectInput value={form.scope} onChange={(v) => setForm((f) => ({ ...f, scope: v, code: v === 'CATEGORY' ? 'KYC' : '' }))} options={[{ value: 'CATEGORY', label: t('common.category') }, { value: 'TYPE', label: t('hub.scopeType') }]} /></Field>
                            <Field label={form.scope === 'CATEGORY' ? t('common.category') : t('common.typeCode')}>
                                {form.scope === 'CATEGORY'
                                    ? <SelectInput value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))} />
                                    : <TextInput value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} placeholder="PASSPORT" />}
                            </Field>
                            <Field label={t('common.years')}><TextInput type="number" min={1} max={100} value={form.years} onChange={(v) => setForm((f) => ({ ...f, years: v }))} /></Field>
                            <Btn variant="primary" busy={busy === 'save'} disabled={!form.code || !(Number(form.years) >= 1)}
                                onClick={() => save([{ scope: form.scope, code: form.code, retentionYears: Number(form.years) }], t('hub.ruleSaved'))}>{t('hub.saveRule')}</Btn>
                        </div>
                        <ErrorBox error={error} />
                    </div>
                )}
            </Card>
            <Card title={t('hub.olderTitle')}>
                <p className="text-[13px] text-[#3C4257] mb-3">{t('hub.olderBody')}</p>
                <Btn busy={busy === 'link'} onClick={() => run('link', async () => {
                    const x = await api.post<{ customers: number }>('/lending/document-library/link-legacy');
                    showToast(t('hub.linked', { count: x.data.customers }), 'success');
                })}>{t('hub.linkOlder')}</Btn>
            </Card>
        </div>
    );
}
