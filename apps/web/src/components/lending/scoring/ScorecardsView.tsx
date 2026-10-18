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
import { usePeople, useScoringText } from './i18n';
import { blankDefinition, normaliseDefinition, withIssuePaths } from './types';
import type { Scorecard, ScorecardDefinition, ScorecardList, ScorecardTemplate, ScorecardVersion } from './types';

type Tab = 'scorecards' | 'test' | 'providers';
type Draft = { label: string; definition: ScorecardDefinition } | null;

/** Lending permissions decide which buttons show; until /me/access answers, all show and the server decides. */
function usePerm() {
    const ws = useWorkspace();
    return { can: (p: string) => !ws.access || ws.can(p), me: ws.access?.principal.id ?? null };
}

export function ScorecardsView() {
    const { t } = useScoringText();
    const { can } = usePerm();
    const [tab, setTab] = useState<Tab>('scorecards');
    const [draft, setDraft] = useState<Draft>(null);
    // Scorecards need scorecard.read; the data providers tab is an
    // access-policy screen (alt_data.provider.* map to access_policy.*), so a
    // tenant administrator without scorecard access still reaches it.
    const canScorecards = can('scorecard.read');
    const canProviders = can('access_policy.read');
    const list = useApi<ScorecardList>(canScorecards ? '/lending/scorecards' : null);
    const tabs: { value: Tab; label: string }[] = [
        ...(canScorecards ? [{ value: 'scorecards' as const, label: t('scorecards.tabScorecards') }, { value: 'test' as const, label: t('scorecards.tabTest') }] : []),
        ...(canProviders ? [{ value: 'providers' as const, label: t('scorecards.tabProviders') }] : []),
    ];
    const current: Tab | null = tabs.some((x) => x.value === tab) ? tab : tabs[0]?.value ?? null;

    return (
        <LendingShell
            title={t('scorecards.title')}
            subtitle={t('scorecards.subtitle')}
            actions={canScorecards && <Btn variant="ghost" onClick={list.reload}>{t('common.refresh')}</Btn>}
        >
            {tabs.length > 0 && <Tabs<Tab> value={current ?? 'scorecards'} onChange={setTab} tabs={tabs} />}
            {current === null ? (
                <Notice tone="warn" title={t('scorecards.noAccessTitle')}>{t('scorecards.noAccess')}</Notice>
            ) : current === 'providers' ? <ProvidersTab /> : list.error && !list.data ? <ErrorBox error={list.error} /> : !list.data ? <Spinner /> : current === 'test' ? (
                <ScoreTestPanel key={draft?.label ?? 'none'} list={list.data} draft={draft} />
            ) : (
                <ScorecardsTab list={list.data} reload={list.reload} onTest={(d) => { setDraft(d); setTab('test'); }} />
            )}
        </LendingShell>
    );
}

function ScorecardsTab({ list, reload, onTest }: { list: ScorecardList; reload: () => void; onTest: (d: Draft) => void }) {
    const { t, source, version: versionLabel } = useScoringText();
    const { can } = usePerm();
    const { showToast } = useToast();
    const [openId, setOpenId] = useState<string | null>(null);
    const [panel, setPanel] = useState<{ template?: ScorecardTemplate } | null>(null);

    return (
        <div className="space-y-5">
            {list.templateInForce.length > 0 && (
                <Notice tone="info" title={t('scorecards.templatesInForceTitle')}>
                    {t('scorecards.templatesInForce1')} {list.templateInForce.map((c) => <span key={c} className="font-mono font-semibold mr-1">{c}</span>)}
                    {t('scorecards.templatesInForce2')}
                </Notice>
            )}

            <Card
                title={t('scorecards.tabScorecards')}
                bodyClass="p-0"
                actions={can('scorecard.manage') && <Btn variant="primary" onClick={() => setPanel(panel && !panel.template ? null : {})}><Plus size={14} /> {t('scorecards.newScorecard')}</Btn>}
            >
                {panel && (
                    <div className="p-4 border-b border-[#E3E8EE]">
                        <CreateForm key={panel.template?.code ?? 'blank'} template={panel.template} onClose={() => setPanel(null)}
                            onDone={(s) => { setPanel(null); showToast(t('scorecards.createdToast'), 'success'); reload(); setOpenId(s.id); }} />
                    </div>
                )}
                {list.scorecards.length === 0 ? <Empty>{t('scorecards.none')}</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('scorecards.colCode')}</th><th className={th}>{t('scorecards.colName')}</th><th className={th}>{t('scorecards.colTemplate')}</th><th className={th}>{t('scorecards.colActive')}</th><th className={th}>{t('scorecards.colLatest')}</th><th className={th} /></tr></thead>
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
                                            <td className={td}>{active ? versionLabel(active.version) : list.templateInForce.includes(s.code) ? t('common.template') : '—'}</td>
                                            <td className={td}>{latest ? <span className="flex items-center gap-1.5">{versionLabel(latest.version)} <StatusBadge status={latest.status} /></span> : '—'}</td>
                                            <td className={`${td} text-right`}>
                                                <Btn size="sm" variant={openId === s.id ? 'primary' : 'secondary'} onClick={() => setOpenId(openId === s.id ? null : s.id)}>{openId === s.id ? t('common.close') : t('common.open')}</Btn>
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

            <Card title={t('scorecards.templatesTitle')} subtitle={t('scorecards.templatesSubtitle')} bodyClass="p-0">
                {list.templates.length === 0 ? <Empty>{t('scorecards.noTemplates')}</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('scorecards.colTemplate')}</th><th className={th}>{t('scorecards.colCharacteristics')}</th><th className={th}>{t('scorecards.colGrades')}</th><th className={th} /></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {list.templates.map((tpl) => {
                                const installed = list.scorecards.some((s) => s.templateCode === tpl.code || s.code === tpl.code);
                                return (
                                    <tr key={tpl.code}>
                                        <td className={td}>{tpl.name}<div className="font-mono text-[11px] text-[#697386]">{tpl.code}</div><div className="text-[12px] text-[#697386]">{tpl.description}</div></td>
                                        <td className={td}>{tpl.definition.characteristics.length}</td>
                                        <td className={td}>{tpl.definition.grades.map((g) => g.grade).join(' · ')}</td>
                                        <td className={`${td} text-right whitespace-nowrap`}>
                                            <Btn size="sm" variant="ghost" onClick={() => onTest({ label: t('scorecards.templateLabel', { code: tpl.code }), definition: tpl.definition })}><FlaskConical size={13} /> {t('scorecards.test')}</Btn>
                                            {can('scorecard.manage') && (
                                                <Btn size="sm" disabled={installed} reason={installed ? t('scorecards.alreadyInstalled') : undefined} onClick={() => setPanel({ template: tpl })}><Download size={13} /> {t('scorecards.installTemplate')}</Btn>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>

            <Card title={t('scorecards.variablesTitle')} subtitle={t('scorecards.variablesSubtitle')} bodyClass="p-0">
                <Disclosure summary={t('scorecards.variablesCount', { count: list.variables.length })}>
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('scorecards.colVariable')}</th><th className={th}>{t('scorecards.colType')}</th><th className={th}>{t('scorecards.colSource')}</th><th className={th}>{t('scorecards.colConsent')}</th><th className={th}>{t('scorecards.colDescription')}</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {list.variables.map((v) => (
                                <tr key={v.code}>
                                    <td className={td}>{v.label}<div className="font-mono text-[11px] text-[#697386]">{v.code}</div></td>
                                    <td className={td}>{v.type.toLowerCase()}{v.unit ? ` (${v.unit})` : ''}{v.domain?.length ? <div className="text-[11px] text-[#697386]">{v.domain.join(', ')}</div> : null}</td>
                                    <td className={td}>{v.source.toLowerCase().replace(/_/g, ' ')}</td>
                                    <td className={td}>{v.consent ? <span title={v.consent}>{source(v.consent)}</span> : '—'}</td>
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
    const { t } = useScoringText();
    const [form, setForm] = useState({ code: template?.code ?? '', name: template?.name ?? '', description: template?.description ?? '', changeSummary: template ? t('scorecards.installedFrom', { code: template.code }) : t('scorecards.firstVersion') });
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
        <ActionPanel title={template ? t('scorecards.installTitle', { code: template.code }) : t('scorecards.newScorecard')} onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label={t('scorecards.colCode')} hint={t('scorecards.codeHint')}><TextInput value={form.code} onChange={(v) => set('code')(v.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} /></Field>
                <Field label={t('scorecards.colName')}><TextInput value={form.name} onChange={set('name')} /></Field>
                <Field label={t('scorecards.colDescription')} className="md:col-span-2"><TextInput value={form.description} onChange={set('description')} /></Field>
                <Field label={t('scorecards.changeSummary')} className="md:col-span-2"><TextInput value={form.changeSummary} onChange={set('changeSummary')} /></Field>
            </div>
            <ErrorBox error={withIssuePaths(error)} />
            <Btn variant="primary" busy={busy === 'create'} disabled={!form.code || !form.name} onClick={save}>{template ? t('scorecards.installAsDraft') : t('scorecards.createDraft')}</Btn>
        </ActionPanel>
    );
}

function ScorecardDetail({ id, list, onChanged, onTest }: { id: string; list: ScorecardList; onChanged: () => void; onTest: (d: Draft) => void }) {
    const { t, version: versionLabel } = useScoringText();
    const { can, me } = usePerm();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const sc = useApi<Scorecard>(`/lending/scorecards/${id}`);
    const person = usePeople([sc.data?.createdBy, ...(sc.data?.versions ?? []).flatMap((v) => [v.makerId, v.checkerId, v.activatedBy])]);
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
        const args = { code: s.code, version: versionLabel(v.version) };
        if (!(await confirm({ title: t(`scorecards.${verb}.title`), message: t(`scorecards.${verb}.message`, args), confirmLabel: t(`scorecards.${verb}.button`), variant: verb === 'retire' ? 'warning' : 'default' }))) return;
        const res = await run(`${verb}-${v.id}`, () => api.post(`/lending/scorecard-versions/${v.id}/${verb}`));
        if (res) refresh(t(`scorecards.${verb}.done`));
    };

    const doReject = async () => {
        if (!reject) return;
        const res = await run('reject', () => api.post(`/lending/scorecard-versions/${reject.versionId}/reject`, { reason: reject.reason }));
        if (res) { setReject(null); refresh(t('scorecards.rejected')); }
    };

    const newVersion = async () => {
        const res = await run('new', () => api.post<ScorecardVersion>(`/lending/scorecards/${id}/versions`, { changeSummary: newSummary || undefined }));
        if (res) { setNewSummary(null); setSelected(res.data.id); refresh(t('scorecards.newVersionCreated')); }
    };

    const hasDraft = versions.some((v) => v.status === 'DRAFT' || v.status === 'SUBMITTED');
    // Approving, activating and retiring are checker actions (scorecard.approve),
    // and the server refuses the version's maker for each of them.
    const checker = can('scorecard.approve');

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] text-[#697386]">
                    {t('scorecards.createdBy', { when: fmtDateTime(s.createdAt), who: person(s.createdBy) })}
                    {s.templateCode ? ` · ${t('scorecards.fromTemplate', { code: s.templateCode })}` : ''}
                </p>
                {can('scorecard.manage') && (
                    <Btn size="sm" onClick={() => setNewSummary(newSummary === null ? '' : null)} disabled={hasDraft} reason={hasDraft ? t('scorecards.finishDraftFirst') : undefined}><Plus size={13} /> {t('scorecards.newVersion')}</Btn>
                )}
            </div>
            {newSummary !== null && (
                <ActionPanel title={t('scorecards.newVersionTitle')} onClose={() => setNewSummary(null)}>
                    <Field label={t('scorecards.changeSummary')}><TextInput value={newSummary} onChange={setNewSummary} /></Field>
                    <Btn variant="primary" busy={busy === 'new'} onClick={newVersion}>{t('scorecards.createDraft')}</Btn>
                </ActionPanel>
            )}

            <Table className="border border-[#E3E8EE] rounded bg-white">
                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('scorecards.colVersion')}</th><th className={th}>{t('scorecards.colStatus')}</th><th className={th}>{t('scorecards.colChange')}</th><th className={th}>{t('scorecards.colMaker')}</th><th className={th}>{t('scorecards.colChecker')}</th><th className={th}>{t('scorecards.colActivated')}</th><th className={th} /></tr></thead>
                <tbody className="divide-y divide-[#F0F2F5]">
                    {versions.map((v) => {
                        const own = !!me && v.makerId === me;
                        return (
                            <tr key={v.id} className={current?.id === v.id ? 'bg-[#F8F9FF]' : ''}>
                                <td className={td}><button type="button" className="font-semibold text-[#635BFF] hover:underline" onClick={() => setSelected(v.id)}>{versionLabel(v.version)}</button></td>
                                <td className={td}><StatusBadge status={v.status} />{v.rejectionReason && <div className="text-[11px] text-red-700 mt-0.5">{v.rejectionReason}</div>}</td>
                                <td className={td}>{v.changeSummary || '—'}</td>
                                <td className={td}><span className="text-[12px]" title={v.makerId}>{person(v.makerId)}</span>{own && <span className="ml-1 text-[11px] text-[#697386]">{t('common.you')}</span>}<div className="text-[11px] text-[#697386]">{fmtDateTime(v.createdAt)}</div></td>
                                <td className={td}><span className="text-[12px]" title={v.checkerId ?? undefined}>{person(v.checkerId)}</span>{v.approvedAt && <div className="text-[11px] text-[#697386]">{fmtDateTime(v.approvedAt)}</div>}</td>
                                <td className={td}>{v.activatedAt ? <>{fmtDateTime(v.activatedAt)}<div className="text-[11px] text-[#697386]" title={v.activatedBy ?? undefined}>{person(v.activatedBy)}</div></> : '—'}</td>
                                <td className={`${td} text-right whitespace-nowrap`}>
                                    <div className="flex justify-end gap-1.5">
                                        {v.status === 'DRAFT' && can('scorecard.manage') && (
                                            <Btn size="sm" variant="primary" disabled={!own && !!me} reason={!own && me ? t('scorecards.onlyMakerSubmits') : undefined} busy={busy === `submit-${v.id}`} onClick={() => step(v, 'submit')}>{t('scorecards.submit.button')}</Btn>
                                        )}
                                        {v.status === 'SUBMITTED' && checker && (
                                            <>
                                                <Btn size="sm" variant="primary" disabled={own} reason={own ? t('scorecards.ownApprove') : undefined} busy={busy === `approve-${v.id}`} onClick={() => step(v, 'approve')}>{t('scorecards.approve.button')}</Btn>
                                                <Btn size="sm" variant="danger" disabled={own} reason={own ? t('scorecards.ownVersion') : undefined} onClick={() => setReject({ versionId: v.id, reason: '' })}>{t('scorecards.reject')}</Btn>
                                            </>
                                        )}
                                        {v.status === 'APPROVED' && checker && (
                                            <Btn size="sm" variant="primary" disabled={own} reason={own ? t('scorecards.ownActivate') : undefined} busy={busy === `activate-${v.id}`} onClick={() => step(v, 'activate')}>{t('scorecards.activate.button')}</Btn>
                                        )}
                                        {(v.status === 'APPROVED' || v.status === 'ACTIVE') && checker && (
                                            <Btn size="sm" variant="danger" disabled={own} reason={own ? t('scorecards.ownRetire') : undefined} busy={busy === `retire-${v.id}`} onClick={() => step(v, 'retire')}>{t('scorecards.retire.button')}</Btn>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </Table>

            {reject && (
                <ActionPanel title={t('scorecards.rejectTitle')} onClose={() => setReject(null)}>
                    <Field label={t('scorecards.rejectReason')}><TextArea value={reject.reason} onChange={(r) => setReject({ ...reject, reason: r })} /></Field>
                    <Btn variant="danger" busy={busy === 'reject'} disabled={reject.reason.trim().length < 3} onClick={doReject}>{t('scorecards.reject')}</Btn>
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
                    onSaved={() => refresh(t('scorecards.draftSaved'))}
                    onTest={onTest}
                />
            )}
        </div>
    );
}

function VersionPanel({ scorecard, version, list, editable, onSaved, onTest }: {
    scorecard: Scorecard; version: ScorecardVersion; list: ScorecardList; editable: boolean; onSaved: () => void; onTest: (d: Draft) => void;
}) {
    const { t, version: versionLabel } = useScoringText();
    const [def, setDef] = useState<ScorecardDefinition>(() => version.definition ?? blankDefinition());
    const [summary, setSummary] = useState(version.changeSummary ?? '');
    const [dirty, setDirty] = useState(false);
    const { busy, error, run, clearError } = useAction();
    const label = `${scorecard.code} ${versionLabel(version.version)}${dirty ? ` ${t('scorecards.unsavedSuffix')}` : ''}`;

    const save = async () => {
        const res = await run('save', () => api.put(`/lending/scorecard-versions/${version.id}`, { definition: normaliseDefinition(def), changeSummary: summary || undefined }));
        if (res) { setDirty(false); onSaved(); }
    };

    return (
        <Card
            title={`${scorecard.code} ${versionLabel(version.version)}`}
            subtitle={editable ? t('scorecards.editableSubtitle') : t('scorecards.readOnlySubtitle', { status: version.status.toLowerCase() })}
            actions={<>
                <Btn size="sm" variant="ghost" onClick={() => onTest({ label, definition: normaliseDefinition(def) })}><FlaskConical size={13} /> {t('scorecards.testDefinition')}</Btn>
                {editable && <Btn size="sm" variant="primary" busy={busy === 'save'} disabled={!dirty} onClick={save}><Save size={13} /> {t('scorecards.saveDraft')}</Btn>}
            </>}
        >
            <div className="space-y-4">
                {version.definitionHash && <KV cols={3} items={[[t('scorecards.definitionHash'), <span key="h" className="font-mono text-[11px] break-all">{version.definitionHash}</span>], [t('scorecards.colCharacteristics'), def.characteristics.length], [t('scorecards.colGrades'), def.grades.map((g) => g.grade).join(' · ')]]} />}
                {editable && <Field label={t('scorecards.changeSummary')}><TextInput value={summary} onChange={(v) => { setSummary(v); setDirty(true); }} /></Field>}
                <ErrorBox error={withIssuePaths(error)} onDismiss={clearError} />
                <ScorecardEditor value={def} onChange={(d) => { setDef(d); setDirty(true); }} variables={list.variables} readOnly={!editable} />
                {editable && dirty && <Notice tone="warn">{t('scorecards.unsavedNotice')}</Notice>}
                <Disclosure summary={t('scorecards.definitionJson')}><JsonBlock value={normaliseDefinition(def)} /></Disclosure>
            </div>
        </Card>
    );
}
