"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Btn, Card, Disclosure, Empty, ErrorBox, Field, JsonBlock, Notice, TextInput } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { clean, useAction } from '../useAsync';
import type { Policy, PolicyRule, PolicyVersion } from '../types';
import { useMyId, useUserName, type TabProps } from './common';
import { RuleEditor } from './ConditionEditor';
import { describeRule, draftPreview, draftToRule, newRule, ruleToDraft, type RuleDraft } from './policyModel';

interface EditorState { code: string; name: string; description: string; rules: RuleDraft[]; basedOn?: string }

const EMPTY: EditorState = { code: '', name: '', description: '', rules: [] };

export function PoliciesTab({ data, reload }: TabProps) {
    const [editor, setEditor] = useState<EditorState>(EMPTY);

    const loadVersion = (p: Policy, v: PolicyVersion) => {
        setEditor({
            code: p.code,
            name: p.name,
            description: p.description ?? '',
            rules: (Array.isArray(v.rules) ? v.rules : []).map(ruleToDraft),
            basedOn: `${p.code} v${v.version}`,
        });
        document.getElementById('policy-editor')?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <div className="space-y-5">
            <PolicyList policies={data.policies} data={data} reload={reload} onLoad={loadVersion} />
            <PolicyEditor data={data} reload={reload} state={editor} setState={setEditor} />
        </div>
    );
}

function RuleLines({ rules }: { rules: PolicyRule[] }) {
    const t = useTranslations('LendingAccess.policies');
    if (!Array.isArray(rules) || rules.length === 0) return <p className="text-[12px] text-[#8792A2]">{t('noRules')}</p>;
    return (
        <ul className="space-y-1.5">
            {rules.map((r) => (
                <li key={r.id} className="text-[12px]">
                    <span className={`font-bold mr-1 ${r.effect === 'DENY' ? 'text-red-700' : 'text-[#4B45C6]'}`}>[{r.id}]</span>
                    <span className="font-mono text-[#1A1F36]">{describeRule(r)}</span>
                    <span className="text-[#697386]"> — “{r.message}”</span>
                </li>
            ))}
        </ul>
    );
}

function PolicyList({ policies, data, reload, onLoad }: { policies: Policy[]; onLoad: (p: Policy, v: PolicyVersion) => void } & TabProps) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const userName = useUserName(data.users);
    const me = useMyId();
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const t = useTranslations('LendingAccess.policies');

    const decide = async (v: PolicyVersion, approve: boolean) => {
        const r = await run(`decide-${v.id}`, () => api.post(`/lending/access/policies/${v.id}/decision`, clean({ approve, reason: (reasons[v.id] ?? '').trim() })));
        if (r) { showToast(approve ? t('approved') : t('rejected'), 'success'); reload(); }
    };

    return (
        <Card title={t('title')} subtitle={t('subtitle')}>
            <div className="space-y-4">
                <ErrorBox error={error} onDismiss={clearError} />
                {policies.length === 0 ? <Empty>{t('none')}</Empty> : policies.map((p) => (
                    <div key={p.id} className="border border-[#E3E8EE] rounded-md">
                        <div className="px-4 py-2.5 border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <span className="font-mono text-[12px] font-bold text-[#1A1F36]">{p.code}</span>
                            <span className="ml-2 text-[13px] text-[#3C4257]">{p.name}</span>
                            {p.description && <p className="text-[12px] text-[#697386]">{p.description}</p>}
                        </div>
                        <div className="divide-y divide-[#F0F2F5]">
                            {p.versions.length === 0 && <p className="px-4 py-3 text-[12px] text-[#8792A2]">{t('noVersions')}</p>}
                            {p.versions.map((v) => {
                                const own = !!me && v.makerId === me;
                                return (
                                    <div key={v.id} className={`px-4 py-3 space-y-2 ${v.status === 'SUBMITTED' ? 'bg-[#F8F9FF]' : ''}`}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 text-[13px]">
                                                <span className="font-bold">v{v.version}</span>
                                                <StatusBadge status={v.status} />
                                                <span className="text-[12px] text-[#697386]">{t('maker', { name: userName(v.makerId) })}</span>
                                            </div>
                                            <Btn size="sm" variant="ghost" onClick={() => onLoad(p, v)}>{t('load')}</Btn>
                                        </div>
                                        <RuleLines rules={v.rules} />
                                        {v.status === 'SUBMITTED' && (
                                            <div className="flex flex-wrap items-end gap-2 pt-1">
                                                <Field label={t('decisionNote')} className="flex-1 min-w-[200px]">
                                                    <TextInput value={reasons[v.id] ?? ''} onChange={(text) => setReasons((s) => ({ ...s, [v.id]: text }))} maxLength={300} />
                                                </Field>
                                                <Btn size="sm" variant="primary" busy={busy === `decide-${v.id}`} disabled={own || !!busy} reason={own ? t('ownApprove') : undefined} onClick={() => decide(v, true)}>{t('approve')}</Btn>
                                                <Btn size="sm" variant="danger" disabled={own || !!busy} reason={own ? t('ownDecide') : undefined} onClick={() => decide(v, false)}>{t('reject')}</Btn>
                                                {own && <p className="w-full text-[11px] text-amber-800">{t('ownNote')}</p>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function PolicyEditor({ data, reload, state, setState }: TabProps & { state: EditorState; setState: (fn: (s: EditorState) => EditorState) => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const t = useTranslations('LendingAccess.policies');

    const converted = state.rules.map(draftToRule);
    const errors = converted.flatMap((c) => c.errors);
    const ids = state.rules.map((r) => r.id).filter(Boolean);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) errors.push(t('duplicateIds', { ids: [...new Set(dupes)].join(', ') }));
    if (state.rules.length === 0) errors.push(t('addOneRule'));
    const codeOk = state.code.trim().length > 0 && state.code.length <= 40;
    const nameOk = state.name.trim().length > 0;
    const valid = errors.length === 0 && codeOk && nameOk;
    const preview = state.rules.map(draftPreview);

    const update = (key: string, r: RuleDraft) => setState((s) => ({ ...s, rules: s.rules.map((x) => (x.key === key ? r : x)) }));

    const submit = async () => {
        const rules = converted.map((c) => c.rule).filter((r): r is PolicyRule => !!r);
        const body = clean({ code: state.code.trim(), name: state.name.trim(), description: state.description.trim() });
        const res = await run('submit', () => api.post('/lending/access/policies', { ...body, rules }));
        if (res) {
            showToast(t('submitted'), 'success');
            setState(() => EMPTY);
            reload();
        }
    };

    return (
        <div id="policy-editor">
            <Card
                title={t('editorTitle')}
                subtitle={state.basedOn ? t('basedOn', { from: state.basedOn }) : t('editorSubtitle')}
                actions={<Btn size="sm" variant="ghost" onClick={() => setState(() => EMPTY)}>{t('reset')}</Btn>}
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Field label={t('code')} hint={t('codeHint')}>
                            <TextInput value={state.code} onChange={(code) => setState((s) => ({ ...s, code }))} maxLength={40} placeholder="DISBURSEMENT_CONTROLS" />
                        </Field>
                        <Field label={t('name')}><TextInput value={state.name} onChange={(name) => setState((s) => ({ ...s, name }))} maxLength={80} /></Field>
                        <Field label={t('descriptionOptional')}><TextInput value={state.description} onChange={(description) => setState((s) => ({ ...s, description }))} maxLength={500} /></Field>
                    </div>

                    {state.rules.map((r, i) => (
                        <RuleEditor
                            key={r.key}
                            rule={r}
                            index={i}
                            permissions={data.permissions}
                            onChange={(n) => update(r.key, n)}
                            onRemove={() => setState((s) => ({ ...s, rules: s.rules.filter((x) => x.key !== r.key) }))}
                        />
                    ))}
                    <Btn onClick={() => setState((s) => ({ ...s, rules: [...s.rules, newRule()] }))}>{t('addRule')}</Btn>

                    {state.rules.length > 0 && (
                        <Disclosure summary={t('generatedJson')} defaultOpen>
                            <JsonBlock value={preview} />
                        </Disclosure>
                    )}

                    {errors.length > 0 && (state.rules.length > 0 || state.code) && (
                        <Notice tone="warn" title={t('fixFirst')}>
                            <ul className="list-disc pl-5 space-y-0.5 text-[12px]">{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
                        </Notice>
                    )}
                    <ErrorBox error={error} onDismiss={clearError} />
                    <div className="flex justify-end">
                        <Btn variant="primary" busy={busy === 'submit'} disabled={!valid} reason={!valid ? t('required') : undefined} onClick={submit}>{t('submit')}</Btn>
                    </div>
                </div>
            </Card>
        </div>
    );
}
