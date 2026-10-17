"use client";

import { useState } from 'react';
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
    const [tab, setTab] = useState<Tab>('review');
    return (
        <LendingShell title="Documents" subtitle="Customer documents awaiting review, expiring identity documents and retention rules.">
            <Tabs<Tab> value={tab} onChange={setTab} tabs={[
                { value: 'review', label: 'Review queue' },
                { value: 'expiry', label: 'Expiring & expired' },
                { value: 'retention', label: 'Retention & legal' },
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
    const q = useApi<{ documents: QueueRow[] }>('/lending/document-review-queue');
    return (
        <Card title="Awaiting review" subtitle="Accept or reject from the customer's library. You cannot review a document you uploaded." bodyClass="p-0"
            actions={<Btn size="sm" variant="ghost" onClick={q.reload}>Refresh</Btn>}>
            {q.error && <div className="p-4"><ErrorBox error={q.error} /></div>}
            {q.loading && !q.data ? <Spinner /> : (q.data?.documents.length ?? 0) === 0 ? (!q.error && <Empty>Nothing awaiting review.</Empty>) : (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Customer</th><th className={th}>Document</th><th className={th}>Version</th><th className={th}>Uploaded</th><th className={th}>Expires</th><th className={th}></th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {q.data!.documents.map((d) => (
                            <tr key={d.id} className="hover:bg-[#F7FAFC]">
                                <td className={td}><CustomerLink id={d.borrowerId} name={d.customer} /></td>
                                <td className={td}>{d.title}<div className="font-mono text-[11px] text-[#697386]">{d.category.toLowerCase()} · {d.typeCode} · {d.origin.toLowerCase()}</div></td>
                                <td className={td}>v{d.version}<div className="text-[11px] text-[#697386]">{d.fileName}</div></td>
                                <td className={`${td} whitespace-nowrap`}>{fmtDateTime(d.uploadedAt)}</td>
                                <td className={td}>{d.expiresOn ?? '—'}</td>
                                <td className={`${td} text-right`}>{d.ownUpload ? <span className="text-[11px] text-[#8792A2]">your upload</span> : <CustomerLink id={d.borrowerId} name="Review →" />}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

function Expiries() {
    const { showToast } = useToast();
    const [within, setWithin] = useState('60');
    const list = useApi<{ businessDate: string; documents: ExpiryRow[] }>(`/lending/document-expiries?withinDays=${within}`);
    const { busy, error, run } = useAction();
    return (
        <Card title="Expiring and expired documents" subtitle={list.data ? `As of business date ${list.data.businessDate}. Reminders are raised automatically each night before a document expires.` : undefined} bodyClass="p-0"
            actions={<>
                <SelectInput value={within} onChange={setWithin} options={[{ value: '30', label: 'Next 30 days' }, { value: '60', label: 'Next 60 days' }, { value: '180', label: 'Next 180 days' }]} className="!w-auto" />
                <Btn size="sm" busy={busy === 'run'} onClick={() => run('run', async () => {
                    const r = await api.post<{ expired: number; reminded: number }>('/lending/document-expiries/run');
                    showToast(`${r.data.expired} flagged expired, ${r.data.reminded} reminders raised`, 'success');
                    list.reload();
                })}><RefreshCw size={13} /> Run expiry check now</Btn>
            </>}>
            {error && <div className="p-4"><ErrorBox error={error} /></div>}
            {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
            {list.loading && !list.data ? <Spinner /> : (list.data?.documents.length ?? 0) === 0 ? (!list.error && <Empty>No documents expire in this window.</Empty>) : (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Customer</th><th className={th}>Document</th><th className={th}>Expires</th><th className={th}>State</th><th className={th}>Reminder sent</th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {list.data!.documents.map((d) => (
                            <tr key={d.id} className={d.expired ? 'bg-red-50/40' : d.daysToExpiry <= 30 ? 'bg-amber-50/40' : ''}>
                                <td className={td}><CustomerLink id={d.borrowerId} name={d.customer} /></td>
                                <td className={td}>{d.title}<div className="font-mono text-[11px] text-[#697386]">{d.typeCode}</div></td>
                                <td className={`${td} whitespace-nowrap`}>{d.expiresOn}<div className="text-[11px] text-[#697386]">{d.expired ? `${-d.daysToExpiry} days ago` : `in ${d.daysToExpiry} days`}</div></td>
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
    if (r.error?.status === 403) return <Notice tone="warn" title="Compliance only">Retention rules, legal hold and deletion need the document management permission (Risk / compliance role).</Notice>;
    return (
        <div className="space-y-4">
            <Card title="Retention periods" subtitle="Years a document is kept after the customer relationship ends (last loan closed, no open application). A type rule overrides its category; categories without a rule use the default.">
                {r.loading && !r.data ? <Spinner /> : r.data && (
                    <div className="space-y-4">
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Applies to</th><th className={th}>Years</th><th className={th}>Source</th><th className={th}></th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {Object.entries(r.data.defaults).map(([cat, years]) => {
                                    const rule = r.data!.rules.find((x) => x.scope === 'CATEGORY' && x.code === cat);
                                    return (
                                        <tr key={cat}>
                                            <td className={td}>Category {cat.toLowerCase()}</td>
                                            <td className={td}>{rule?.retentionYears ?? years}</td>
                                            <td className={td}>{rule ? `tenant rule · ${fmtDateTime(rule.updatedAt)}` : 'default'}</td>
                                            <td className={`${td} text-right`}>{rule && <Btn size="sm" variant="ghost" onClick={() => save([{ scope: 'CATEGORY', code: cat, retentionYears: null }], 'Back to the default')}>Use default</Btn>}</td>
                                        </tr>
                                    );
                                })}
                                {r.data.rules.filter((x) => x.scope === 'TYPE').map((rule) => (
                                    <tr key={rule.id}>
                                        <td className={td}>Type <span className="font-mono">{rule.code}</span></td>
                                        <td className={td}>{rule.retentionYears}</td>
                                        <td className={td}>tenant rule · {fmtDateTime(rule.updatedAt)}</td>
                                        <td className={`${td} text-right`}><Btn size="sm" variant="ghost" onClick={() => save([{ scope: 'TYPE', code: rule.code, retentionYears: null }], 'Rule removed')}>Remove</Btn></td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                            <Field label="Applies to"><SelectInput value={form.scope} onChange={(v) => setForm((f) => ({ ...f, scope: v, code: v === 'CATEGORY' ? 'KYC' : '' }))} options={[{ value: 'CATEGORY', label: 'Category' }, { value: 'TYPE', label: 'Document type' }]} /></Field>
                            <Field label={form.scope === 'CATEGORY' ? 'Category' : 'Type code'}>
                                {form.scope === 'CATEGORY'
                                    ? <SelectInput value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} options={[...DOCUMENT_CATEGORIES]} />
                                    : <TextInput value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} placeholder="PASSPORT" />}
                            </Field>
                            <Field label="Years"><TextInput type="number" min={1} max={100} value={form.years} onChange={(v) => setForm((f) => ({ ...f, years: v }))} /></Field>
                            <Btn variant="primary" busy={busy === 'save'} disabled={!form.code || !(Number(form.years) >= 1)}
                                onClick={() => save([{ scope: form.scope, code: form.code, retentionYears: Number(form.years) }], 'Retention rule saved')}>Save rule</Btn>
                        </div>
                        <ErrorBox error={error} />
                    </div>
                )}
            </Card>
            <Card title="Older document stores">
                <p className="text-[13px] text-[#3C4257] mb-3">KYC images, legacy loan documents and application uploads made before the library are linked into each customer&apos;s library when it is opened. Link every customer now (nothing is moved or deleted):</p>
                <Btn busy={busy === 'link'} onClick={() => run('link', async () => {
                    const x = await api.post<{ customers: number }>('/lending/document-library/link-legacy');
                    showToast(`Linked older documents of ${x.data.customers} customer(s)`, 'success');
                })}>Link older documents</Btn>
            </Card>
        </div>
    );
}
