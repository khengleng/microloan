"use client";

import { Fragment, useState } from 'react';
import { Download, FlaskConical, Plus, Save } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell } from '../LendingShell';
import {
    ActionPanel, Btn, Card, Disclosure, Empty, ErrorBox, Field, JsonBlock, KV, Notice, Spinner, Table, Tabs, TextArea, TextInput, td, th,
} from '../ui';
import { useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { ScorecardEditor } from './ScorecardEditor';
import { ScoreTestPanel } from './ScoreTestPanel';
import { ProvidersTab } from './ProvidersTab';
import { blankDefinition, normaliseDefinition, shortId, versionLabel, withIssuePaths } from './types';
import type { Scorecard, ScorecardDefinition, ScorecardList, ScorecardTemplate, ScorecardVersion } from './types';

type Tab = 'scorecards' | 'test' | 'providers';
type Draft = { label: string; definition: ScorecardDefinition } | null;

/** Lending permissions decide which buttons show; until /me/access answers, all show and the server decides. */
function usePerm() {
    const ws = useWorkspace();
    return { can: (p: string) => !ws.access || ws.can(p), me: ws.access?.principal.id ?? null };
}

export function ScorecardsView() {
    const [tab, setTab] = useState<Tab>('scorecards');
    const [draft, setDraft] = useState<Draft>(null);
    const list = useApi<ScorecardList>('/lending/scorecards');

    return (
        <LendingShell
            title="Scorecards"
            subtitle="Configurable credit scorecards. Changes go through maker-checker; the active version scores new applications."
            actions={<Btn variant="ghost" onClick={list.reload}>Refresh</Btn>}
        >
            <Tabs<Tab> value={tab} onChange={setTab} tabs={[
                { value: 'scorecards', label: 'Scorecards' },
                { value: 'test', label: 'Test score' },
                { value: 'providers', label: 'Data providers' },
            ]} />
            {tab === 'providers' ? <ProvidersTab /> : list.error && !list.data ? <ErrorBox error={list.error} /> : !list.data ? <Spinner /> : tab === 'test' ? (
                <ScoreTestPanel key={draft?.label ?? 'none'} list={list.data} draft={draft} />
            ) : (
                <ScorecardsTab list={list.data} reload={list.reload} onTest={(d) => { setDraft(d); setTab('test'); }} />
            )}
        </LendingShell>
    );
}

function ScorecardsTab({ list, reload, onTest }: { list: ScorecardList; reload: () => void; onTest: (d: Draft) => void }) {
    const { can } = usePerm();
    const { showToast } = useToast();
    const [openId, setOpenId] = useState<string | null>(null);
    const [panel, setPanel] = useState<{ template?: ScorecardTemplate } | null>(null);

    return (
        <div className="space-y-5">
            {list.templateInForce.length > 0 && (
                <Notice tone="info" title="Scoring from built-in templates">
                    No tenant version is active for {list.templateInForce.map((c) => <span key={c} className="font-mono font-semibold mr-1">{c}</span>)}
                    — applications are scored with the built-in template. Install the template and activate a version to take ownership.
                </Notice>
            )}

            <Card
                title="Scorecards"
                bodyClass="p-0"
                actions={can('scorecard.manage') && <Btn variant="primary" onClick={() => setPanel(panel && !panel.template ? null : {})}><Plus size={14} /> New scorecard</Btn>}
            >
                {panel && (
                    <div className="p-4 border-b border-[#E3E8EE]">
                        <CreateForm key={panel.template?.code ?? 'blank'} template={panel.template} onClose={() => setPanel(null)}
                            onDone={(s) => { setPanel(null); showToast('Scorecard created as a draft', 'success'); reload(); setOpenId(s.id); }} />
                    </div>
                )}
                {list.scorecards.length === 0 ? <Empty>No scorecards yet. Install a template below or create one.</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Code</th><th className={th}>Name</th><th className={th}>Template</th><th className={th}>Active</th><th className={th}>Latest</th><th className={th} /></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {list.scorecards.map((s) => {
                                const active = s.versions.find((v) => v.status === 'ACTIVE');
                                const latest = [...s.versions].sort((a, b) => b.version - a.version)[0];
                                return (
                                    <Fragment key={s.id}>
                                        <tr className={openId === s.id ? 'bg-[#F7FAFC]' : 'hover:bg-[#F7FAFC]'}>
                                            <td className={td}><span className="font-mono text-[12px] font-semibold">{s.code}</span></td>
                                            <td className={td}>{s.name}{s.description && <div className="text-[11px] text-[#697386]">{s.description}</div>}</td>
                                            <td className={td}>{s.templateCode ?? '—'}</td>
                                            <td className={td}>{active ? versionLabel(active.version) : list.templateInForce.includes(s.code) ? 'template' : '—'}</td>
                                            <td className={td}>{latest ? <span className="flex items-center gap-1.5">{versionLabel(latest.version)} <StatusBadge status={latest.status} /></span> : '—'}</td>
                                            <td className={`${td} text-right`}>
                                                <Btn size="sm" variant={openId === s.id ? 'primary' : 'secondary'} onClick={() => setOpenId(openId === s.id ? null : s.id)}>{openId === s.id ? 'Close' : 'Open'}</Btn>
                                            </td>
                                        </tr>
                                        {openId === s.id && (
                                            <tr><td colSpan={6} className="px-4 py-4 bg-[#FBFCFE]"><ScorecardDetail id={s.id} list={list} onChanged={reload} onTest={onTest} /></td></tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>

            <Card title="Templates" subtitle="Built-in starting points. Installing one creates a draft you can adjust, submit and activate." bodyClass="p-0">
                {list.templates.length === 0 ? <Empty>No templates.</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Template</th><th className={th}>Characteristics</th><th className={th}>Grades</th><th className={th} /></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {list.templates.map((t) => {
                                const installed = list.scorecards.some((s) => s.templateCode === t.code || s.code === t.code);
                                return (
                                    <tr key={t.code}>
                                        <td className={td}>{t.name}<div className="font-mono text-[11px] text-[#697386]">{t.code}</div><div className="text-[12px] text-[#697386]">{t.description}</div></td>
                                        <td className={td}>{t.definition.characteristics.length}</td>
                                        <td className={td}>{t.definition.grades.map((g) => g.grade).join(' · ')}</td>
                                        <td className={`${td} text-right whitespace-nowrap`}>
                                            <Btn size="sm" variant="ghost" onClick={() => onTest({ label: `template ${t.code}`, definition: t.definition })}><FlaskConical size={13} /> Test</Btn>
                                            {can('scorecard.manage') && (
                                                <Btn size="sm" disabled={installed} reason={installed ? 'Already installed' : undefined} onClick={() => setPanel({ template: t })}><Download size={13} /> Install template</Btn>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>

            <Card title="Variables" subtitle="What a characteristic can read. Variables that need consent are missing for customers without it." bodyClass="p-0">
                <Disclosure summary={`${list.variables.length} variables`}>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Variable</th><th className={th}>Type</th><th className={th}>Source</th><th className={th}>Consent</th><th className={th}>Description</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {list.variables.map((v) => (
                                <tr key={v.code}>
                                    <td className={td}>{v.label}<div className="font-mono text-[11px] text-[#697386]">{v.code}</div></td>
                                    <td className={td}>{v.type.toLowerCase()}{v.unit ? ` (${v.unit})` : ''}{v.domain?.length ? <div className="text-[11px] text-[#697386]">{v.domain.join(', ')}</div> : null}</td>
                                    <td className={td}>{v.source.toLowerCase().replace(/_/g, ' ')}</td>
                                    <td className={td}>{v.consent ? <span className="font-mono text-[11px]">{v.consent}</span> : '—'}</td>
                                    <td className={td}>{v.description}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Disclosure>
            </Card>
        </div>
    );
}

function CreateForm({ template, onDone, onClose }: { template?: ScorecardTemplate; onDone: (s: Scorecard) => void; onClose: () => void }) {
    const [form, setForm] = useState({ code: template?.code ?? '', name: template?.name ?? '', description: template?.description ?? '', changeSummary: template ? `Installed from template ${template.code}` : 'First version' });
    const { busy, error, run } = useAction();
    const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
    const save = async () => {
        const body: Record<string, unknown> = { code: form.code, name: form.name, changeSummary: form.changeSummary || undefined, description: form.description || undefined };
        if (template) body.templateCode = template.code;
        else body.definition = blankDefinition();
        const res = await run('create', () => api.post<Scorecard>('/lending/scorecards', body));
        if (res) onDone(res.data);
    };
    return (
        <ActionPanel title={template ? `Install template ${template.code}` : 'New scorecard'} onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Code" hint="A–Z, 0–9 and _"><TextInput value={form.code} onChange={(v) => set('code')(v.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} /></Field>
                <Field label="Name"><TextInput value={form.name} onChange={set('name')} /></Field>
                <Field label="Description" className="md:col-span-2"><TextInput value={form.description} onChange={set('description')} /></Field>
                <Field label="Change summary" className="md:col-span-2"><TextInput value={form.changeSummary} onChange={set('changeSummary')} /></Field>
            </div>
            <ErrorBox error={withIssuePaths(error)} />
            <Btn variant="primary" busy={busy === 'create'} disabled={!form.code || !form.name} onClick={save}>{template ? 'Install as draft' : 'Create draft'}</Btn>
        </ActionPanel>
    );
}

function ScorecardDetail({ id, list, onChanged, onTest }: { id: string; list: ScorecardList; onChanged: () => void; onTest: (d: Draft) => void }) {
    const { can, me } = usePerm();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const sc = useApi<Scorecard>(`/lending/scorecards/${id}`);
    const [selected, setSelected] = useState<string | null>(null);
    const [reject, setReject] = useState<{ versionId: string; reason: string } | null>(null);
    const [newSummary, setNewSummary] = useState<string | null>(null);
    const { busy, error, run, clearError } = useAction();

    if (sc.error && !sc.data) return <ErrorBox error={sc.error} />;
    if (!sc.data) return <Spinner />;
    const s = sc.data;
    const versions = [...s.versions].sort((a, b) => b.version - a.version);
    const current = versions.find((v) => v.id === selected) ?? versions.find((v) => v.status === 'DRAFT') ?? versions[0];

    const refresh = (msg: string) => { showToast(msg, 'success'); sc.reload(); onChanged(); };

    const step = async (v: ScorecardVersion, verb: 'submit' | 'approve' | 'activate' | 'retire') => {
        const msgs = {
            submit: `Submit ${s.code} ${versionLabel(v.version)} for approval? It can no longer be edited.`,
            approve: `Approve ${s.code} ${versionLabel(v.version)}? It still needs activating before it scores applications.`,
            activate: `Activate ${s.code} ${versionLabel(v.version)}? It replaces the current active version for new scores.`,
            retire: `Retire ${s.code} ${versionLabel(v.version)}? With no active version, the built-in template (if any) scores instead.`,
        };
        if (!(await confirm({ title: `${verb[0].toUpperCase()}${verb.slice(1)} version`, message: msgs[verb], confirmLabel: verb[0].toUpperCase() + verb.slice(1), variant: verb === 'retire' ? 'warning' : 'default' }))) return;
        const res = await run(`${verb}-${v.id}`, () => api.post(`/lending/scorecard-versions/${v.id}/${verb}`));
        if (res) refresh(`Version ${verb === 'submit' ? 'submitted' : verb === 'approve' ? 'approved' : verb === 'activate' ? 'activated' : 'retired'}`);
    };

    const doReject = async () => {
        if (!reject) return;
        const res = await run('reject', () => api.post(`/lending/scorecard-versions/${reject.versionId}/reject`, { reason: reject.reason }));
        if (res) { setReject(null); refresh('Version rejected'); }
    };

    const newVersion = async () => {
        const res = await run('new', () => api.post<ScorecardVersion>(`/lending/scorecards/${id}/versions`, { changeSummary: newSummary || undefined }));
        if (res) { setNewSummary(null); setSelected(res.data.id); refresh('New draft version created'); }
    };

    const hasDraft = versions.some((v) => v.status === 'DRAFT' || v.status === 'SUBMITTED');

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] text-[#697386]">Created {fmtDateTime(s.createdAt)} by <span className="font-mono">{shortId(s.createdBy)}</span>{s.templateCode ? ` · from template ${s.templateCode}` : ''}</p>
                {can('scorecard.manage') && (
                    <Btn size="sm" onClick={() => setNewSummary(newSummary === null ? '' : null)} disabled={hasDraft} reason={hasDraft ? 'Finish the open draft or submission first' : undefined}><Plus size={13} /> New version</Btn>
                )}
            </div>
            {newSummary !== null && (
                <ActionPanel title="New version (copies the latest definition)" onClose={() => setNewSummary(null)}>
                    <Field label="Change summary"><TextInput value={newSummary} onChange={setNewSummary} /></Field>
                    <Btn variant="primary" busy={busy === 'new'} onClick={newVersion}>Create draft</Btn>
                </ActionPanel>
            )}

            <Table className="border border-[#E3E8EE] rounded bg-white">
                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Version</th><th className={th}>Status</th><th className={th}>Change</th><th className={th}>Maker</th><th className={th}>Checker</th><th className={th}>Activated</th><th className={th} /></tr></thead>
                <tbody className="divide-y divide-[#F0F2F5]">
                    {versions.map((v) => {
                        const own = !!me && v.makerId === me;
                        return (
                            <tr key={v.id} className={current?.id === v.id ? 'bg-[#F8F9FF]' : ''}>
                                <td className={td}><button type="button" className="font-semibold text-[#635BFF] hover:underline" onClick={() => setSelected(v.id)}>{versionLabel(v.version)}</button></td>
                                <td className={td}><StatusBadge status={v.status} />{v.rejectionReason && <div className="text-[11px] text-red-700 mt-0.5">{v.rejectionReason}</div>}</td>
                                <td className={td}>{v.changeSummary || '—'}</td>
                                <td className={td}><span className="font-mono text-[11px]">{shortId(v.makerId)}</span>{own && <span className="ml-1 text-[11px] text-[#697386]">(you)</span>}<div className="text-[11px] text-[#697386]">{fmtDateTime(v.createdAt)}</div></td>
                                <td className={td}><span className="font-mono text-[11px]">{shortId(v.checkerId)}</span>{v.approvedAt && <div className="text-[11px] text-[#697386]">{fmtDateTime(v.approvedAt)}</div>}</td>
                                <td className={td}>{v.activatedAt ? <>{fmtDateTime(v.activatedAt)}<div className="font-mono text-[11px] text-[#697386]">{shortId(v.activatedBy)}</div></> : '—'}</td>
                                <td className={`${td} text-right whitespace-nowrap`}>
                                    <div className="flex justify-end gap-1.5">
                                        {v.status === 'DRAFT' && can('scorecard.manage') && (
                                            <Btn size="sm" variant="primary" disabled={!own && !!me} reason={!own && me ? 'Only the maker of this draft can submit it' : undefined} busy={busy === `submit-${v.id}`} onClick={() => step(v, 'submit')}>Submit</Btn>
                                        )}
                                        {v.status === 'SUBMITTED' && can('scorecard.approve') && (
                                            <>
                                                <Btn size="sm" variant="primary" disabled={own} reason={own ? 'You made this version; a different user must approve it.' : undefined} busy={busy === `approve-${v.id}`} onClick={() => step(v, 'approve')}>Approve</Btn>
                                                <Btn size="sm" variant="danger" disabled={own} reason={own ? 'You made this version.' : undefined} onClick={() => setReject({ versionId: v.id, reason: '' })}>Reject</Btn>
                                            </>
                                        )}
                                        {v.status === 'APPROVED' && (can('scorecard.approve') || can('scorecard.manage')) && (
                                            <Btn size="sm" variant="primary" busy={busy === `activate-${v.id}`} onClick={() => step(v, 'activate')}>Activate</Btn>
                                        )}
                                        {v.status === 'ACTIVE' && (can('scorecard.approve') || can('scorecard.manage')) && (
                                            <Btn size="sm" variant="danger" busy={busy === `retire-${v.id}`} onClick={() => step(v, 'retire')}>Retire</Btn>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </Table>

            {reject && (
                <ActionPanel title="Reject version" onClose={() => setReject(null)}>
                    <Field label="Reason (sent back to the maker)"><TextArea value={reject.reason} onChange={(r) => setReject({ ...reject, reason: r })} /></Field>
                    <Btn variant="danger" busy={busy === 'reject'} disabled={reject.reason.trim().length < 3} onClick={doReject}>Reject</Btn>
                </ActionPanel>
            )}
            <ErrorBox error={withIssuePaths(error)} onDismiss={clearError} />

            {current && (
                <VersionPanel
                    key={`${current.id}-${current.definitionHash ?? ''}`}
                    scorecard={s}
                    version={current}
                    list={list}
                    editable={current.status === 'DRAFT' && can('scorecard.manage') && (!me || current.makerId === me)}
                    onSaved={() => refresh('Draft saved')}
                    onTest={onTest}
                />
            )}
        </div>
    );
}

function VersionPanel({ scorecard, version, list, editable, onSaved, onTest }: {
    scorecard: Scorecard; version: ScorecardVersion; list: ScorecardList; editable: boolean; onSaved: () => void; onTest: (d: Draft) => void;
}) {
    const [def, setDef] = useState<ScorecardDefinition>(() => version.definition ?? blankDefinition());
    const [summary, setSummary] = useState(version.changeSummary ?? '');
    const [dirty, setDirty] = useState(false);
    const { busy, error, run, clearError } = useAction();
    const label = `${scorecard.code} ${versionLabel(version.version)}${dirty ? ' (unsaved edits)' : ''}`;

    const save = async () => {
        const res = await run('save', () => api.put(`/lending/scorecard-versions/${version.id}`, { definition: normaliseDefinition(def), changeSummary: summary || undefined }));
        if (res) { setDirty(false); onSaved(); }
    };

    return (
        <Card
            title={`${scorecard.code} ${versionLabel(version.version)}`}
            subtitle={editable ? 'Draft — you can edit it. The server validates the whole definition when you save.' : `Read-only (${version.status.toLowerCase()}). Create a new version to change it.`}
            actions={<>
                <Btn size="sm" variant="ghost" onClick={() => onTest({ label, definition: normaliseDefinition(def) })}><FlaskConical size={13} /> Test this definition</Btn>
                {editable && <Btn size="sm" variant="primary" busy={busy === 'save'} disabled={!dirty} onClick={save}><Save size={13} /> Save draft</Btn>}
            </>}
        >
            <div className="space-y-4">
                {version.definitionHash && <KV cols={3} items={[['Definition hash', <span key="h" className="font-mono text-[11px] break-all">{version.definitionHash}</span>], ['Characteristics', def.characteristics.length], ['Grades', def.grades.map((g) => g.grade).join(' · ')]]} />}
                {editable && <Field label="Change summary"><TextInput value={summary} onChange={(v) => { setSummary(v); setDirty(true); }} /></Field>}
                <ErrorBox error={withIssuePaths(error)} onDismiss={clearError} />
                <ScorecardEditor value={def} onChange={(d) => { setDef(d); setDirty(true); }} variables={list.variables} readOnly={!editable} />
                {editable && dirty && <Notice tone="warn">Unsaved changes. Save the draft before submitting it.</Notice>}
                <Disclosure summary="Definition JSON"><JsonBlock value={normaliseDefinition(def)} /></Disclosure>
            </div>
        </Card>
    );
}
