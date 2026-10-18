"use client";

import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Plus, Trash2, TrendingUp, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { RestructureOptions, RestructureSimulation } from '../types';
import { MoneyCell } from '../MoneyCell';
import { ActionPanel, Btn, Card, ErrorBox, Field, Notice, Table, TextInput, td, tdR, th, thR } from '../ui';
import { clean, useAction } from '../useAsync';
import { OptionsForm, draftToOptions, emptyDraft, type OptionsDraft } from './OptionsForm';
import { SimulationView } from './SimulationView';

const MAX_SCENARIOS = 3;

interface Scenario { id: number; name: string; draft: OptionsDraft; options: RestructureOptions; result: RestructureSimulation }
interface ConditionRow { k: number; code: string; label: string }

let seq = 0;
const CODE_RE = /^[A-Z0-9_]{2,40}$/;

function FitIcon({ fits }: { fits: boolean | null | undefined }) {
    const t = useTranslations('LendingRestructure.compare');
    if (fits === true) return <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 size={14} /> {t('fits')}</span>;
    if (fits === false) return <span className="inline-flex items-center gap-1 text-red-700 font-semibold"><XCircle size={14} /> {t('doesNotFit')}</span>;
    return <span className="inline-flex items-center gap-1 text-[#697386]"><HelpCircle size={14} /> {t('notAssessed')}</span>;
}

/** Propose a simulated scenario, with optional conditions precedent. */
function ProposePanel({ caseId, scenario, onClose, onProposed }: { caseId: string; scenario: Scenario; onClose: () => void; onProposed: () => void }) {
    const t = useTranslations('LendingRestructure.propose');
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [conds, setConds] = useState<ConditionRow[]>([]);
    const rows = conds.filter((c) => c.code || c.label).map((c) => ({ code: c.code.trim(), label: c.label.trim() }));
    const bad = rows.some((r) => !CODE_RE.test(r.code) || !r.label);
    const upd = (k: number, patch: Partial<ConditionRow>) => setConds((cs) => cs.map((c) => (c.k === k ? { ...c, ...patch } : c)));

    const submit = async () => {
        const body = { options: clean(scenario.options), ...(rows.length ? { conditions: rows } : {}) };
        const res = await run('propose', () => api.post(`/lending/restructures/${caseId}/proposals`, body));
        if (res) {
            showToast(t('toastCreated', { name: scenario.name }), 'success');
            onProposed();
        }
    };

    return (
        <ActionPanel title={t('title', { name: scenario.name })} onClose={onClose}>
            <p className="text-[12px] text-[#697386]">
                {t('body')}
            </p>
            <div className="space-y-2">
                <p className="text-[12px] font-bold text-[#3C4257]">{t('conditionsTitle')}</p>
                {conds.map((c) => (
                    <div key={c.k} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-end">
                        <Field label={t('code')} error={c.code && !CODE_RE.test(c.code) ? t('codeError') : undefined}>
                            <TextInput value={c.code} onChange={(v) => upd(c.k, { code: v.toUpperCase() })} placeholder="ARREARS_PAID" maxLength={40} />
                        </Field>
                        <Field label={t('label')}><TextInput value={c.label} onChange={(v) => upd(c.k, { label: v })} maxLength={160} placeholder={t('labelPlaceholder')} /></Field>
                        <button type="button" aria-label={t('removeCondition')} className="p-1.5 text-[#697386] hover:text-red-600" onClick={() => setConds((cs) => cs.filter((x) => x.k !== c.k))}>
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
                <Btn size="sm" disabled={conds.length >= 10} onClick={() => setConds((cs) => [...cs, { k: ++seq, code: '', label: '' }])}><Plus size={13} /> {t('addCondition')}</Btn>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" busy={busy === 'propose'} disabled={bad} reason={bad ? t('fixRows') : undefined} onClick={submit}>{t('submit')}</Btn>
        </ActionPanel>
    );
}

/** Up to three named option scenarios simulated and compared side by side. */
export function CompareOptions({ caseId, canPropose, onProposed }: { caseId: string; canPropose: boolean; onProposed: () => void }) {
    const t = useTranslations('LendingRestructure');
    const { busy, error, run, clearError } = useAction();
    const [draft, setDraft] = useState<OptionsDraft>(emptyDraft);
    const [name, setName] = useState(() => t('compare.optionName', { letter: 'A' }));
    const [editing, setEditing] = useState<number | null>(null);
    const [scenarios, setScenarios] = useState<Scenario[]>([]);
    const [expanded, setExpanded] = useState<number | null>(null);
    const [proposing, setProposing] = useState<number | null>(null);

    const { options, problems } = draftToOptions(draft, t);
    const full = editing === null && scenarios.length >= MAX_SCENARIOS;

    const simulate = async () => {
        const opts = clean(options);
        const res = await run('simulate', () => api.post<RestructureSimulation>(`/lending/restructures/${caseId}/simulate`, opts));
        if (!res) return;
        const label = name.trim() || t('compare.optionName', { letter: String.fromCharCode(65 + scenarios.length) });
        if (editing !== null) {
            setScenarios((ss) => ss.map((s) => (s.id === editing ? { ...s, name: label, draft, options: opts, result: res.data } : s)));
            setExpanded(editing);
        } else {
            const id = ++seq;
            setScenarios((ss) => [...ss, { id, name: label, draft, options: opts, result: res.data }]);
            setExpanded(id);
            setName(t('compare.optionName', { letter: String.fromCharCode(66 + scenarios.length) }));
        }
        setEditing(null);
    };

    const edit = (s: Scenario) => { setEditing(s.id); setDraft(s.draft); setName(s.name); };
    const remove = (id: number) => {
        setScenarios((ss) => ss.filter((s) => s.id !== id));
        if (editing === id) setEditing(null);
        if (proposing === id) setProposing(null);
    };

    return (
        <div className="space-y-5">
            <Card
                title={editing !== null ? t('compare.editTitle') : t('compare.simulateTitle')}
                subtitle={t('compare.simulateSubtitle')}
            >
                <div className="space-y-4">
                    <Field label={t('compare.scenarioName')} className="max-w-xs"><TextInput value={name} onChange={setName} maxLength={40} /></Field>
                    <OptionsForm draft={draft} onChange={setDraft} />
                    {problems.length > 0 && <ul className="text-[12px] text-amber-800 list-disc pl-5 space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                    {full && <Notice tone="warn">{t('compare.full')}</Notice>}
                    <ErrorBox error={error} onDismiss={clearError} />
                    <div className="flex flex-wrap gap-2">
                        <Btn variant="primary" busy={busy === 'simulate'} disabled={problems.length > 0 || full} reason={problems[0]} onClick={simulate}>
                            {editing !== null ? t('compare.rerun') : t('compare.simulateKeep')}
                        </Btn>
                        {editing !== null && <Btn onClick={() => setEditing(null)}>{t('compare.cancelEdit')}</Btn>}
                        <Btn variant="ghost" onClick={() => setDraft(emptyDraft())}>{t('compare.reset')}</Btn>
                    </div>
                </div>
            </Card>

            {scenarios.length > 0 && (
                <Card title={t('compare.comparisonTitle')} subtitle={t('compare.comparisonSubtitle')} bodyClass="p-0">
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('compare.col.scenario')}</th>
                                <th className={thR}>{t('compare.col.instalment')}</th>
                                <th className={th}>{t('compare.col.maturity')}</th>
                                <th className={thR}>{t('compare.col.totalPayments')}</th>
                                <th className={thR}>{t('compare.col.totalInterest')}</th>
                                <th className={thR}>{t('compare.col.dueAtEffective')}</th>
                                <th className={th}>{t('compare.col.affordability')}</th>
                                <th className={th}>{t('compare.col.warnings')}</th>
                                <th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            <tr className="bg-slate-50/70">
                                <td className={`${td} italic text-[#697386]`}>{t('compare.currentTerms')}</td>
                                <td className={tdR}><MoneyCell value={scenarios[0].result.comparison.original.instalment} /></td>
                                <td className={td}>{scenarios[0].result.comparison.original.maturityDate ?? '—'}</td>
                                <td className={tdR}><MoneyCell value={scenarios[0].result.comparison.original.totalFuturePayments} /></td>
                                <td className={tdR}><MoneyCell value={scenarios[0].result.comparison.original.totalFutureInterestAndCharges} /></td>
                                <td className={tdR}>—</td><td className={td}></td><td className={td}></td><td className={td}></td>
                            </tr>
                            {scenarios.map((s) => {
                                const c = s.result.comparison;
                                const nWarn = (c.warnings?.length ?? 0) + (s.result.policyExceptions?.length ?? 0);
                                return (
                                    <tr key={s.id} className={editing === s.id ? 'bg-[#F8F9FF]' : ''}>
                                        <td className={`${td} font-semibold text-[#1A1F36]`}>{s.name}</td>
                                        <td className={tdR}><MoneyCell value={c.proposed.instalment} strong /></td>
                                        <td className={`${td} whitespace-nowrap`}>{c.proposed.maturityDate}</td>
                                        <td className={tdR}><MoneyCell value={c.proposed.totalFuturePayments} /></td>
                                        <td className={tdR}><MoneyCell value={c.proposed.totalFutureInterestAndCharges} /></td>
                                        <td className={tdR}><MoneyCell value={c.proposed.payableAtEffectiveDate} highlightNonZero /></td>
                                        <td className={`${td} whitespace-nowrap`}><FitIcon fits={s.result.affordability?.fits} /></td>
                                        <td className={td}>
                                            <div className="flex flex-col gap-0.5">
                                                {c.lowerInstalmentHigherCost && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800"><TrendingUp size={12} /> {t('compare.higherCost')}</span>}
                                                {nWarn > 0 && <span className="text-[11px] text-amber-800">{t('compare.warningCount', { count: nWarn })}</span>}
                                                {!c.lowerInstalmentHigherCost && nWarn === 0 && <span className="text-[11px] text-[#AAB7C4]">{t('common.none')}</span>}
                                            </div>
                                        </td>
                                        <td className={`${td} whitespace-nowrap`}>
                                            <div className="flex gap-1">
                                                <Btn size="sm" variant="ghost" onClick={() => edit(s)}>{t('common.edit')}</Btn>
                                                <Btn size="sm" variant="ghost" onClick={() => remove(s.id)}>{t('common.remove')}</Btn>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </Card>
            )}

            {scenarios.map((s) => (
                <Card
                    key={s.id}
                    title={
                        <button type="button" className="flex items-center gap-1.5" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                            {expanded === s.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {s.name}
                        </button>
                    }
                    subtitle={t('compare.effective', { date: s.options.effectiveDate })}
                    actions={canPropose && <Btn size="sm" variant="primary" onClick={() => setProposing(proposing === s.id ? null : s.id)}>{t('compare.propose')}</Btn>}
                >
                    <div className="space-y-4">
                        {proposing === s.id && (
                            <ProposePanel caseId={caseId} scenario={s} onClose={() => setProposing(null)} onProposed={() => { setProposing(null); onProposed(); }} />
                        )}
                        {expanded === s.id ? <SimulationView sim={s.result} /> : (
                            <p className="text-[12px] text-[#697386]">{t('compare.expandHint')}</p>
                        )}
                    </div>
                </Card>
            ))}
        </div>
    );
}
