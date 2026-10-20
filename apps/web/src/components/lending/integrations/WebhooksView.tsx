"use client";

import { useState } from 'react';
import { CheckCircle2, Copy, KeyRound, Plus, Send, ShieldAlert } from 'lucide-react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { LendingShell } from '../LendingShell';
import { Btn, Card, Checkbox, Disclosure, Empty, ErrorBox, Field, Spinner, Table, TextInput, td, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';

type Can = { allowed: boolean; reason: string };
interface Endpoint {
    id: string; url: string; description: string; topics: string[]; secretPrefix: string; status: string;
    createdBy: string; approvedBy: string | null; consecutiveFailures: number; lastDeliveryAt: string | null; lastSuccessAt: string | null;
    disabledReason: string; createdAt: string; lastWeek: Record<string, number>;
}
interface Delivery { id: string; topic: string; status: string; attempts: number; responseStatus: number | null; lastError: string; durationMs: number | null; createdAt: string; deliveredAt: string | null; nextAttemptAt: string }
interface ListResponse { topics: { topic: string; description: string }[]; endpoints: Endpoint[]; permissions: { manage: Can; approve: Can } }

const VERIFY_SNIPPET = `// Node.js — verify a delivery before trusting it
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, headers, secret) {
  const ts = Number(headers['x-webhook-timestamp']);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false; // older than 5 minutes
  const expected = 'v1=' + createHmac('sha256', secret).update(\`\${ts}.\${rawBody}\`).digest('hex');
  const given = String(headers['x-webhook-signature'] ?? '');
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
// Answer 2xx quickly; process asynchronously. X-Webhook-Id is the same on every retry of one event.`;

function SecretBox({ secret, onDone }: { secret: string; onDone: () => void }) {
    const t = useTranslations('LendingWebhooks');
    const [copied, setCopied] = useState(false);
    return (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-900"><ShieldAlert size={15} /> {t('secret.copyNow')}</div>
            <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded border border-amber-200 bg-white px-2 py-1 font-mono text-[12px]">{secret}</code>
                <Btn size="sm" onClick={() => { void navigator.clipboard?.writeText(secret); setCopied(true); }}><Copy size={13} /> {copied ? t('secret.copied') : t('secret.copy')}</Btn>
            </div>
            <Btn size="sm" variant="ghost" onClick={onDone}>{t('secret.stored')}</Btn>
        </div>
    );
}

function Deliveries({ id, canManage }: { id: string; canManage: Can }) {
    const t = useTranslations('LendingWebhooks');
    const list = useApi<Delivery[]>(`/lending/webhooks/${id}/deliveries`);
    const { busy, error, run, clearError } = useAction();
    if (list.loading && !list.data) return <Spinner />;
    if (!list.data?.length) return <Empty>{t('deliveries.none')}</Empty>;
    const retry = async (d: Delivery) => { if (await run(`retry-${d.id}`, () => api.post(`/lending/webhooks/${id}/deliveries/${d.id}/retry`))) list.reload(); };
    return (
        <div className="space-y-2">
            <Table>
                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('deliveries.colEvent')}</th><th className={th}>{t('deliveries.colStatus')}</th><th className={th}>{t('deliveries.colAttempts')}</th><th className={th}>{t('deliveries.colResponse')}</th><th className={th}>{t('deliveries.colWhen')}</th><th className={th} /></tr></thead>
                <tbody className="divide-y divide-[#F0F2F5]">
                    {list.data.map((d) => (
                        <tr key={d.id}>
                            <td className={`${td} font-mono text-[12px]`}>{d.topic}</td>
                            <td className={td}><StatusBadge status={d.status} /></td>
                            <td className={td}>{d.attempts}</td>
                            <td className={`${td} text-[12px]`}>{d.responseStatus ?? '—'}{d.lastError ? <div className="text-red-700">{d.lastError}</div> : null}{d.durationMs !== null ? <div className="text-[#8792A2]">{d.durationMs} ms</div> : null}</td>
                            <td className={`${td} text-[12px]`}>{fmtDateTime(d.deliveredAt ?? d.createdAt)}{d.status === 'PENDING' && d.attempts > 0 ? <div className="text-[#8792A2]">{t('deliveries.nextTry', { when: fmtDateTime(d.nextAttemptAt) })}</div> : null}</td>
                            <td className={td}>{d.status === 'FAILED' && <Btn size="sm" onClick={() => retry(d)} busy={busy === `retry-${d.id}`} disabled={!canManage.allowed} reason={canManage.reason || undefined}>{t('deliveries.retry')}</Btn>}</td>
                        </tr>
                    ))}
                </tbody>
            </Table>
            <ErrorBox error={error} onDismiss={clearError} />
        </div>
    );
}

export function WebhooksView() {
    const t = useTranslations('LendingWebhooks');
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    const confirm = useConfirm();
    const { showToast } = useToast();
    const list = useApi<ListResponse>('/lending/webhooks');
    const [form, setForm] = useState<{ url: string; description: string; topics: string[] } | null>(null);
    const [secret, setSecret] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const { busy, error, run, clearError } = useAction();
    const data = list.data;

    const create = async () => {
        if (!form) return;
        const res = await run('create', () => api.post<Endpoint & { secret: string }>('/lending/webhooks', { url: form.url.trim(), description: form.description.trim(), topics: form.topics }));
        if (res) { setSecret(res.data.secret); setForm(null); list.reload(); }
    };
    const act = async (e: Endpoint, what: 'approve' | 'reject' | 'disable' | 'enable' | 'rotate' | 'ping') => {
        if (what === 'rotate' && !(await confirm({ title: t('rotateTitle'), message: t('rotateMessage'), confirmLabel: t('rotate'), variant: 'warning' }))) return;
        if (what === 'disable' && !(await confirm({ title: t('disableTitle'), message: t('disableMessage'), confirmLabel: t('switchOff'), variant: 'danger' }))) return;
        const path = { approve: 'decision', reject: 'decision', disable: 'disable', enable: 'enable', rotate: 'rotate-secret', ping: 'ping' }[what];
        const body = what === 'approve' ? { approve: true } : what === 'reject' ? { approve: false } : undefined;
        const res = await run(`${what}-${e.id}`, () => api.post<{ secret?: string; status?: string }>(`/lending/webhooks/${e.id}/${path}`, body));
        if (!res) return;
        if (what === 'rotate' && res.data.secret) setSecret(res.data.secret);
        if (what === 'ping') showToast(res.data.status === 'SENT' ? t('testDelivered') : t('testFailed'), res.data.status === 'SENT' ? 'success' : 'error');
        list.reload();
    };

    return (
        <LendingShell title={tw('webhooks')} subtitle={tp('webhooks')}>
            {list.error && <ErrorBox error={list.error} />}
            {!data ? <Spinner /> : (
                <>
                    {secret && <SecretBox secret={secret} onDone={() => setSecret(null)} />}
                    <Card
                        title={t('endpoints')}
                        actions={!form && <Btn variant="primary" size="sm" onClick={() => setForm({ url: 'https://', description: '', topics: ['lending.disbursed', 'lending.repayment'] })} disabled={!data.permissions.manage.allowed} reason={data.permissions.manage.reason || undefined}><Plus size={13} /> {t('addEndpoint')}</Btn>}
                        bodyClass="p-0"
                    >
                        {form && (
                            <div className="space-y-3 border-b border-[#E3E8EE] p-4">
                                <div className="grid gap-3 md:grid-cols-2">
                                    <Field label={t('endpointUrl')} hint={t('endpointUrlHint')}><TextInput value={form.url} onChange={(v) => setForm({ ...form, url: v })} placeholder="https://core.example.com/hooks/lending" /></Field>
                                    <Field label={t('description')}><TextInput value={form.description} onChange={(v) => setForm({ ...form, description: v })} maxLength={200} placeholder={t('descriptionPlaceholder')} /></Field>
                                </div>
                                <div>
                                    <div className="mb-1 text-[12px] font-semibold text-[#3C4257]">{t('events')}</div>
                                    <div className="grid gap-1 md:grid-cols-2">
                                        <Checkbox checked={form.topics.includes('*')} onChange={(on) => setForm({ ...form, topics: on ? ['*'] : [] })} label={<span>{t.rich('allEventsLater', { b: (chunks) => <b>{chunks}</b> })}</span>} />
                                        {data.topics.filter((t) => t.topic !== 'webhook.ping').map((t) => (
                                            <Checkbox key={t.topic} disabled={form.topics.includes('*')} checked={form.topics.includes('*') || form.topics.includes(t.topic)}
                                                onChange={(on) => setForm({ ...form, topics: on ? [...form.topics, t.topic] : form.topics.filter((x) => x !== t.topic) })}
                                                label={<span><code className="text-[11px]">{t.topic}</code> — {t.description}</span>} />
                                        ))}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Btn variant="primary" onClick={create} busy={busy === 'create'} disabled={!form.topics.length || form.url.trim().length < 9}>{t('register')}</Btn>
                                    <Btn variant="ghost" onClick={() => setForm(null)}>{t('cancel')}</Btn>
                                </div>
                            </div>
                        )}
                        {data.endpoints.length === 0 && !form ? <div className="p-5"><Empty>{t('noEndpoints')}</Empty></div> : (
                            <ul className="divide-y divide-[#F0F2F5]">
                                {data.endpoints.map((e) => (
                                    <li key={e.id} className="space-y-2 p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2"><StatusBadge status={e.status} /><span className="truncate font-mono text-[13px] text-[#1A1F36]">{e.url}</span></div>
                                                <div className="mt-1 text-[12px] text-[#697386]">
                                                    {e.description && <>{e.description} · </>}
                                                    {e.topics.includes('*') ? t('allEvents') : t('eventsCount', { count: e.topics.length })} · {t('secretPrefix', { prefix: e.secretPrefix })}
                                                    {e.lastSuccessAt && <> · {t('lastDelivered', { when: fmtDateTime(e.lastSuccessAt) })}</>}
                                                </div>
                                                <div className="mt-1 flex gap-3 text-[12px]">
                                                    <span className="text-emerald-700"><CheckCircle2 size={12} className="inline" /> {t('sentThisWeek', { count: e.lastWeek.SENT ?? 0 })}</span>
                                                    {(e.lastWeek.PENDING ?? 0) > 0 && <span className="text-amber-700">{t('retrying', { count: e.lastWeek.PENDING })}</span>}
                                                    {(e.lastWeek.FAILED ?? 0) > 0 && <span className="text-red-700">{t('failed', { count: e.lastWeek.FAILED })}</span>}
                                                    {e.consecutiveFailures > 0 && <span className="text-red-700">{t('failuresInRow', { count: e.consecutiveFailures })}</span>}
                                                </div>
                                                {e.disabledReason && <div className="text-[12px] text-[#697386]">{e.disabledReason}</div>}
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                {e.status === 'PENDING_APPROVAL' && (
                                                    <>
                                                        <Btn size="sm" variant="primary" onClick={() => act(e, 'approve')} busy={busy === `approve-${e.id}`} disabled={!data.permissions.approve.allowed} reason={data.permissions.approve.reason || undefined}>{t('activate')}</Btn>
                                                        <Btn size="sm" variant="danger" onClick={() => act(e, 'reject')} disabled={!data.permissions.approve.allowed}>{t('reject')}</Btn>
                                                    </>
                                                )}
                                                {e.status === 'ACTIVE' && (
                                                    <>
                                                        <Btn size="sm" onClick={() => act(e, 'ping')} busy={busy === `ping-${e.id}`} disabled={!data.permissions.manage.allowed}><Send size={12} /> {t('sendTest')}</Btn>
                                                        <Btn size="sm" onClick={() => act(e, 'rotate')} busy={busy === `rotate-${e.id}`} disabled={!data.permissions.manage.allowed}><KeyRound size={12} /> {t('rotateSecret')}</Btn>
                                                        <Btn size="sm" variant="ghost" onClick={() => act(e, 'disable')} disabled={!data.permissions.manage.allowed}>{t('switchOff')}</Btn>
                                                    </>
                                                )}
                                                {e.status === 'DISABLED' && <Btn size="sm" onClick={() => act(e, 'enable')} disabled={!data.permissions.manage.allowed}>{t('turnBackOn')}</Btn>}
                                                <Btn size="sm" variant="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? t('hideDeliveries') : t('deliveriesBtn')}</Btn>
                                            </div>
                                        </div>
                                        {open === e.id && <Deliveries id={e.id} canManage={data.permissions.manage} />}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="px-4 pb-4"><ErrorBox error={error} onDismiss={clearError} /></div>
                    </Card>
                    <Card title={t('receiving.title')} subtitle={t('receiving.subtitle', { shape: '{ id, type, createdAt, data }' })}>
                        <ul className="mb-3 list-disc space-y-1 pl-5 text-[13px] text-[#3C4257]">
                            <li>{t.rich('receiving.signature', { code: (chunks) => <code>{chunks}</code> })}</li>
                            <li>{t('receiving.answer')}</li>
                            <li>{t.rich('receiving.id', { code: (chunks) => <code>{chunks}</code> })}</li>
                            <li>{t('receiving.switchedOff')}</li>
                        </ul>
                        <Disclosure summary={t('receiving.example')}><pre className="overflow-x-auto rounded bg-[#1A1F36] p-3 text-[12px] text-white">{VERIFY_SNIPPET}</pre></Disclosure>
                    </Card>
                </>
            )}
        </LendingShell>
    );
}
