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
import { shortId, sourceLabel, withIssuePaths } from './types';
import type { ProviderOverview } from './types';

function ConfigureForm({ sources, onDone, onClose }: { sources: string[]; onDone: () => void; onClose: () => void }) {
    const [form, setForm] = useState({ source: sources[0] ?? '', providerCode: '', endpointUrl: '', credentials: '' });
    const { busy, error, run } = useAction();
    const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
    const save = async () => {
        const res = await run('save', () => api.post('/lending/alternative-data-providers', form));
        if (res) onDone();
    };
    return (
        <ActionPanel title="Configure a provider" onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Source"><SelectInput value={form.source} onChange={set('source')} options={sources.map((s) => ({ value: s, label: sourceLabel(s) }))} /></Field>
                <Field label="Provider code" hint="A–Z, 0–9, _ and -"><TextInput value={form.providerCode} onChange={(v) => set('providerCode')(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} /></Field>
                <Field label="Endpoint" hint="Must use https"><TextInput value={form.endpointUrl} onChange={set('endpointUrl')} placeholder="https://…" /></Field>
                <Field label="Credentials" hint="Stored encrypted and never shown again (8 characters or more)">
                    <TextInput type="password" autoComplete="new-password" value={form.credentials} onChange={set('credentials')} />
                </Field>
            </div>
            <Notice tone="warn">A second administrator must approve this configuration. Even then, the source stays unusable until an adapter for the provider ships.</Notice>
            <ErrorBox error={withIssuePaths(error)} />
            <Btn variant="primary" busy={busy === 'save'} onClick={save} disabled={!form.source || !form.providerCode || !form.endpointUrl || form.credentials.length < 8}>Submit for approval</Btn>
        </ActionPanel>
    );
}

/** Provider-fed alternative data sources: configuration under maker-checker; no adapter ships yet. */
export function ProvidersTab() {
    const { showToast } = useToast();
    const ws = useWorkspace();
    const me = ws.access?.principal.id ?? null;
    const data = useApi<ProviderOverview>('/lending/alternative-data-providers');
    const [open, setOpen] = useState(false);
    const [comment, setComment] = useState('');
    const { busy, error, run, clearError } = useAction();

    const decide = async (id: string, approve: boolean) => {
        const res = await run(`${id}-${approve}`, () => api.post(`/lending/alternative-data-providers/${id}/decision`, { approve, ...(comment.trim() ? { comment: comment.trim() } : {}) }));
        if (res) { showToast(approve ? 'Configuration approved' : 'Configuration rejected', 'success'); setComment(''); data.reload(); }
    };

    if (data.loading && !data.data) return <Spinner />;
    if (data.error && !data.data) return <ErrorBox error={data.error} />;
    const d = data.data;
    if (!d) return null;
    const pending = d.configurations.filter((c) => c.status === 'PENDING');

    return (
        <div className="space-y-5">
            <Notice tone="warn" title="These sources require an integration">
                Telco, e-wallet and smartphone data come from external providers. No provider adapter ships with the system yet
                {d.implementedProviders.length ? ` (implemented: ${d.implementedProviders.join(', ')})` : ''}, so these sources cannot feed a score
                even when a configuration is approved. Officer-captured data and internal behaviour work without them.
            </Notice>

            <Card title="Sources" bodyClass="p-0">
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Source</th><th className={th}>Capability</th><th className={th}>Status</th><th className={th}>Why</th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {d.sources.map((s) => (
                            <tr key={s.source}>
                                <td className={td}>{sourceLabel(s.source)}<div className="font-mono text-[11px] text-[#697386]">{s.source}</div></td>
                                <td className={td}>{s.capability}</td>
                                <td className={td}><StatusBadge status={s.usable ? 'ACTIVE' : 'REQUIRES_INTEGRATION'} /></td>
                                <td className={td}>{s.message}{s.reason && <div className="font-mono text-[11px] text-[#697386]">{s.reason}</div>}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </Card>

            <Card
                title="Configurations"
                subtitle="Credentials are write-only. The approver must be a different administrator."
                actions={<Btn variant="primary" onClick={() => setOpen(!open)}><Plus size={14} /> Configure</Btn>}
                bodyClass="p-0"
            >
                {open && (
                    <div className="p-4 border-b border-[#E3E8EE]">
                        <ConfigureForm sources={d.sources.map((s) => s.source)} onClose={() => setOpen(false)} onDone={() => { setOpen(false); showToast('Configuration submitted', 'success'); data.reload(); }} />
                    </div>
                )}
                {d.configurations.length === 0 ? <Empty>No provider configured.</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Source</th><th className={th}>Provider</th><th className={th}>Endpoint</th><th className={th}>Credentials</th><th className={th}>Status</th><th className={th}>Maker / checker</th><th className={th} /></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.configurations.map((c) => {
                                const own = !!me && c.makerId === me;
                                return (
                                    <tr key={c.id}>
                                        <td className={td}>{sourceLabel(c.source)}</td>
                                        <td className={td}><span className="font-mono text-[12px]">{c.providerCode}</span></td>
                                        <td className={td}><span className="font-mono text-[11px] break-all">{c.endpointUrl}</span></td>
                                        <td className={td}>{c.credentialsSet ? 'set' : 'not set'}</td>
                                        <td className={td}><StatusBadge status={c.status} /><div className="text-[11px] text-[#697386] whitespace-nowrap">{fmtDateTime(c.createdAt)}</div></td>
                                        <td className={td}><span className="font-mono text-[11px]">{shortId(c.makerId)} / {shortId(c.checkerId)}</span></td>
                                        <td className={`${td} text-right whitespace-nowrap`}>
                                            {c.status === 'PENDING' && (
                                                <div className="flex justify-end gap-1.5">
                                                    <Btn size="sm" variant="primary" disabled={own} reason={own ? 'You made this configuration; another administrator must approve it.' : undefined} busy={busy === `${c.id}-true`} onClick={() => decide(c.id, true)}>Approve</Btn>
                                                    <Btn size="sm" variant="danger" disabled={own} reason={own ? 'You made this configuration.' : undefined} busy={busy === `${c.id}-false`} onClick={() => decide(c.id, false)}>Reject</Btn>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
                {pending.length > 0 && (
                    <div className="px-4 py-3 border-t border-[#E3E8EE]">
                        <Field label="Comment for your decision (optional)"><TextInput value={comment} onChange={setComment} /></Field>
                    </div>
                )}
                <div className="px-4 pb-3"><ErrorBox error={error} onDismiss={clearError} /></div>
            </Card>
        </div>
    );
}
