"use client";

import { useState } from 'react';
import { Plus } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, TextInput, td, th } from '../ui';
import { useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { usePeople, useScoringText } from './i18n';
import { withIssuePaths } from './types';
import type { ProviderOverview } from './types';

function ConfigureForm({ sources, onDone, onClose }: { sources: string[]; onDone: () => void; onClose: () => void }) {
    const { t, source } = useScoringText();
    const [form, setForm] = useState({ source: sources[0] ?? '', providerCode: '', endpointUrl: '', credentials: '' });
    const { busy, error, run } = useAction();
    const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
    const save = async () => {
        const res = await run('save', () => api.post('/lending/alternative-data-providers', form));
        if (res) onDone();
    };
    return (
        <ActionPanel title={t('providers.configureTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label={t('providers.source')}><SelectInput value={form.source} onChange={set('source')} options={sources.map((s) => ({ value: s, label: source(s) }))} /></Field>
                <Field label={t('providers.providerCode')} hint={t('providers.providerCodeHint')}><TextInput value={form.providerCode} onChange={(v) => set('providerCode')(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} /></Field>
                <Field label={t('providers.endpoint')} hint={t('providers.endpointHint')}><TextInput value={form.endpointUrl} onChange={set('endpointUrl')} placeholder="https://…" /></Field>
                <Field label={t('providers.credentials')} hint={t('providers.credentialsHint')}>
                    <TextInput type="password" autoComplete="new-password" value={form.credentials} onChange={set('credentials')} />
                </Field>
            </div>
            <Notice tone="warn">{t('providers.secondAdminNotice')}</Notice>
            <ErrorBox error={withIssuePaths(error)} />
            <Btn variant="primary" busy={busy === 'save'} onClick={save} disabled={!form.source || !form.providerCode || !form.endpointUrl || form.credentials.length < 8}>{t('providers.submitForApproval')}</Btn>
        </ActionPanel>
    );
}

/**
 * Provider-fed alternative data sources: configuration under maker-checker;
 * no adapter ships yet. Governed like webhooks: reading needs
 * access_policy.read, configuring access_policy.manage, and the second
 * administrator's approval access_policy.approve.
 */
export function ProvidersTab() {
    const { t, source } = useScoringText();
    const { showToast } = useToast();
    const ws = useWorkspace();
    const can = (p: string) => !ws.access || ws.can(p);
    const me = ws.access?.principal.id ?? null;
    const data = useApi<ProviderOverview>('/lending/alternative-data-providers');
    const person = usePeople((data.data?.configurations ?? []).flatMap((c) => [c.makerId, c.checkerId]));
    const [open, setOpen] = useState(false);
    const [comment, setComment] = useState('');
    const { busy, error, run, clearError } = useAction();

    const decide = async (id: string, approve: boolean) => {
        const res = await run(`${id}-${approve}`, () => api.post(`/lending/alternative-data-providers/${id}/decision`, { approve, ...(comment.trim() ? { comment: comment.trim() } : {}) }));
        if (res) { showToast(approve ? t('providers.approvedToast') : t('providers.rejectedToast'), 'success'); setComment(''); data.reload(); }
    };

    if (data.loading && !data.data) return <Spinner />;
    if (data.error && !data.data) return <ErrorBox error={data.error} />;
    const d = data.data;
    if (!d) return null;
    const canApprove = can('access_policy.approve');
    const pending = d.configurations.filter((c) => c.status === 'PENDING');

    return (
        <div className="space-y-5">
            <Notice tone="warn" title={t('providers.integrationTitle')}>
                {t('providers.integration1')}
                {d.implementedProviders.length ? ` ${t('providers.implemented', { list: d.implementedProviders.join(', ') })}` : ''}
                {' '}{t('providers.integration2')}
            </Notice>

            <Card title={t('providers.sourcesTitle')} bodyClass="p-0">
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('providers.source')}</th><th className={th}>{t('providers.capability')}</th><th className={th}>{t('providers.status')}</th><th className={th}>{t('providers.why')}</th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {d.sources.map((s) => (
                            <tr key={s.source}>
                                <td className={td}>{source(s.source)}<div className="font-mono text-[11px] text-[#697386]">{s.source}</div></td>
                                <td className={td}>{s.capability}</td>
                                <td className={td}><StatusBadge status={s.usable ? 'ACTIVE' : 'REQUIRES_INTEGRATION'} /></td>
                                <td className={td}>{s.message}{s.reason && <div className="font-mono text-[11px] text-[#697386]">{s.reason}</div>}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </Card>

            <Card
                title={t('providers.configurationsTitle')}
                subtitle={t('providers.configurationsSubtitle')}
                actions={can('access_policy.manage') && <Btn variant="primary" onClick={() => setOpen(!open)}><Plus size={14} /> {t('providers.configure')}</Btn>}
                bodyClass="p-0"
            >
                {open && (
                    <div className="p-4 border-b border-[#E3E8EE]">
                        <ConfigureForm sources={d.sources.map((s) => s.source)} onClose={() => setOpen(false)} onDone={() => { setOpen(false); showToast(t('providers.submittedToast'), 'success'); data.reload(); }} />
                    </div>
                )}
                {d.configurations.length === 0 ? <Empty>{t('providers.none')}</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('providers.source')}</th><th className={th}>{t('providers.provider')}</th><th className={th}>{t('providers.endpoint')}</th><th className={th}>{t('providers.credentials')}</th><th className={th}>{t('providers.status')}</th><th className={th}>{t('providers.makerChecker')}</th><th className={th} /></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.configurations.map((c) => {
                                const own = !!me && c.makerId === me;
                                return (
                                    <tr key={c.id}>
                                        <td className={td}>{source(c.source)}</td>
                                        <td className={td}><span className="font-mono text-[12px]">{c.providerCode}</span></td>
                                        <td className={td}><span className="font-mono text-[11px] break-all">{c.endpointUrl}</span></td>
                                        <td className={td}>{c.credentialsSet ? t('providers.credentialsSet') : t('providers.credentialsNotSet')}</td>
                                        <td className={td}><StatusBadge status={c.status} /><div className="text-[11px] text-[#697386] whitespace-nowrap">{fmtDateTime(c.createdAt)}</div></td>
                                        <td className={td}><span className="text-[12px]">{person(c.makerId)} / {person(c.checkerId)}</span></td>
                                        <td className={`${td} text-right whitespace-nowrap`}>
                                            {c.status === 'PENDING' && canApprove && (
                                                <div className="flex justify-end gap-1.5">
                                                    <Btn size="sm" variant="primary" disabled={own} reason={own ? t('providers.ownApprove') : undefined} busy={busy === `${c.id}-true`} onClick={() => decide(c.id, true)}>{t('providers.approve')}</Btn>
                                                    <Btn size="sm" variant="danger" disabled={own} reason={own ? t('providers.ownConfiguration') : undefined} busy={busy === `${c.id}-false`} onClick={() => decide(c.id, false)}>{t('providers.reject')}</Btn>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
                {pending.length > 0 && canApprove && (
                    <div className="px-4 py-3 border-t border-[#E3E8EE]">
                        <Field label={t('providers.decisionComment')}><TextInput value={comment} onChange={setComment} /></Field>
                    </div>
                )}
                <div className="px-4 pb-3"><ErrorBox error={error} onDismiss={clearError} /></div>
            </Card>
        </div>
    );
}
