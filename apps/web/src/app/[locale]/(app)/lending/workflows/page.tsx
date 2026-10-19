"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import { Lock, Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { LendingShell } from '@/components/lending/LendingShell';
import { Btn, Card, Checkbox, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, TextInput, th, td } from '@/components/lending/ui';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { useAction, useApi } from '@/components/lending/useAsync';
import { fmtMoney, isDecimalString } from '@/components/lending/format';
import type { ApprovalLevel, WorkflowDefinition, WorkflowsResponse } from '@/components/lending/types';

const CODE_RE = /^[A-Z0-9_]{2,40}$/;

function DefinitionSummary({ def }: { def: WorkflowDefinition }) {
    const tw = useTranslations('LendingWorkflows');
    const stepName = (s: string) => (tw.has(`steps.${s}`) ? tw(`steps.${s}`) : s.replace(/_/g, ' ').toLowerCase());
    return (
        <div className="space-y-1">
            <p className="text-[12px] text-[#3C4257]">{def.steps.map(stepName).join(' → ')}</p>
            <p className="text-[11px] text-[#697386]">
                {def.approvalLevels.map((l) => tw('level', { currency: l.currency, amount: fmtMoney(l.minAmount), count: l.approvalsRequired })).join(' · ')}
            </p>
        </div>
    );
}

function Builder({ wf, onCreated }: { wf: WorkflowsResponse; onCreated: () => void }) {
    const { showToast } = useToast();
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [steps, setSteps] = useState<string[]>(() => [...wf.supportedSteps]);
    const [levels, setLevels] = useState<ApprovalLevel[]>([{ currency: '*', minAmount: '0', approvalsRequired: 1 }]);
    const { busy, error, run } = useAction();
    const t = useTranslations('Governance.workflow');
    const tw = useTranslations('LendingWorkflows');
    const alwaysOn = wf.alwaysOnSteps ?? [];

    const loadBuiltIn = (key: string) => {
        const b = wf.builtIn[key];
        if (!b) return;
        setSteps(wf.supportedSteps.filter((s) => b.definition.steps.includes(s) || alwaysOn.includes(s)));
        setLevels(b.definition.approvalLevels.map((l) => ({ ...l })));
        if (!name) setName(b.name);
    };

    const toggle = (s: string, on: boolean) =>
        setSteps((cur) => wf.supportedSteps.filter((x) => (x === s ? on : cur.includes(x))));

    const setLevel = (i: number, patch: Partial<ApprovalLevel>) => setLevels((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

    const levelErrors = levels.map((l) =>
        !/^([A-Z]{3}|\*)$/.test(l.currency) ? { field: 'currency', msg: t('currencyInvalid') }
            : !isDecimalString(l.minAmount) ? { field: 'amount', msg: t('amountInvalid') }
                // Amounts in different currencies are not comparable: the API refuses '*' above 0.
                : l.currency === '*' && Number(l.minAmount) !== 0 ? { field: 'currency', msg: t('starAboveZero') }
                    : null);
    const hasZero = levels.some((l) => /^0(\.0+)?$/.test(l.minAmount));
    const valid = CODE_RE.test(code) && name.trim().length >= 2 && levelErrors.every((e) => !e) && hasZero;

    const submit = async () => {
        const definition: WorkflowDefinition = { steps: wf.supportedSteps.filter((s) => steps.includes(s) || alwaysOn.includes(s)), approvalLevels: levels };
        const r = await run('create', () => api.post('/lending/workflows', { code, name: name.trim(), definition }));
        if (r) {
            showToast(tw('submitted'), 'success');
            setCode(''); setName('');
            onCreated();
        }
    };

    return (
        <Card title={tw('builderTitle')} subtitle={tw('builderSubtitle')}>
            <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Field label={tw('code')} hint="A–Z, 0–9, _" error={code && !CODE_RE.test(code) ? tw('codeRule') : undefined}>
                        <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} placeholder="STANDARD_RETAIL" />
                    </Field>
                    <Field label={tw('name')}><TextInput value={name} onChange={setName} /></Field>
                    <Field label={tw('startFrom')}>
                        <SelectInput value="" onChange={loadBuiltIn} placeholder={tw('chooseToCopy')} options={Object.entries(wf.builtIn).map(([k, b]) => ({ value: k, label: `${b.name} (${k})` }))} />
                    </Field>
                </div>

                <div>
                    <p className="text-[12px] font-semibold text-[#3C4257] mb-2">{tw.rich('stepsHeading', { note: (c) => <span className="font-normal text-[#697386]">{c}</span> })}</p>
                    <ol className="space-y-1.5">
                        {wf.supportedSteps.map((s, i) => {
                            const mandatory = wf.mandatorySteps.includes(s);
                            const locked = !mandatory && alwaysOn.includes(s);
                            return (
                                <li key={s} className="flex items-center gap-3 border border-[#E3E8EE] rounded px-3 py-2 bg-white">
                                    <span className="text-[11px] text-[#8792A2] w-4">{i + 1}</span>
                                    <Checkbox checked={mandatory || locked || steps.includes(s)} disabled={mandatory || locked} onChange={(on) => toggle(s, on)} label={<span className="font-mono text-[12px]">{s}</span>} />
                                    {mandatory && <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#697386]"><Lock size={11} /> {tw('mandatory')}</span>}
                                    {locked && <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#697386]" title={t('cpExplain')}><Lock size={11} /> {t('alwaysOn')}</span>}
                                </li>
                            );
                        })}
                    </ol>
                </div>

                <div>
                    <p className="text-[12px] font-semibold text-[#3C4257] mb-2">{tw.rich('levelsHeading', { note: (c) => <span className="font-normal text-[#697386]">{c}</span> })}</p>
                    <div className="space-y-2">
                        {levels.map((l, i) => (
                            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                                <Field label={tw('currency')} error={levelErrors[i]?.field === 'currency' ? levelErrors[i]!.msg : undefined}>
                                    <TextInput value={l.currency} onChange={(v) => setLevel(i, { currency: v.toUpperCase() })} placeholder={t('currencyPlaceholder')} />
                                </Field>
                                <Field label={tw('fromAmount')} error={levelErrors[i]?.field === 'amount' ? levelErrors[i]!.msg : undefined}>
                                    <TextInput inputMode="decimal" value={l.minAmount} onChange={(v) => setLevel(i, { minAmount: v.trim() })} />
                                </Field>
                                <Field label={tw('approvalsRequired')}>
                                    <SelectInput value={String(l.approvalsRequired)} onChange={(v) => setLevel(i, { approvalsRequired: Number.parseInt(v, 10) })} options={['1', '2', '3']} />
                                </Field>
                                <Btn variant="ghost" disabled={levels.length === 1} onClick={() => setLevels((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={14} /></Btn>
                            </div>
                        ))}
                        <Btn size="sm" onClick={() => setLevels((ls) => [...ls, { currency: '', minAmount: '', approvalsRequired: 2 }])}><Plus size={13} /> {tw('addLevel')}</Btn>
                        {!hasZero && <p className="text-[11px] text-red-600">{tw('needZero')}</p>}
                        <p className="text-[11px] text-[#697386]">{t('levelsHelp')}</p>
                    </div>
                </div>

                {alwaysOn.length > 0 && <p className="text-[11px] text-[#697386]">{t('cpExplain')}</p>}
                <ErrorBox error={error} />
                <div className="flex justify-end">
                    <Btn variant="primary" busy={busy === 'create'} disabled={!valid} onClick={submit}>{tw('submit')}</Btn>
                </div>
            </div>
        </Card>
    );
}

export default function WorkflowsPage() {
    const { showToast } = useToast();
    const { data, error, loading, reload } = useApi<WorkflowsResponse>('/lending/workflows');
    const act = useAction();
    const { can, access } = useWorkspace();
    const t = useTranslations('Governance.workflow');
    const tw = useTranslations('LendingWorkflows');
    const me = access?.principal.id;
    const canApprove = can('workflow.approve');

    const decide = async (id: string, approve: boolean) => {
        const r = await act.run(`${id}:${approve}`, () => api.post(`/lending/workflows/${id}/decision`, { approve }));
        if (r) { showToast(approve ? tw('activated') : tw('rejected'), 'success'); reload(); }
    };

    return (
        <LendingShell title="Workflows" subtitle="Origination workflows: optional checks and amount-based approval levels.">
            {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} /> : data && (
                <>
                    <Notice tone="info">{tw('phaseNotice')}</Notice>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <Card title={tw('builtInTitle')} subtitle={tw('builtInSubtitle')}>
                            <div className="space-y-3">
                                {Object.entries(data.builtIn).map(([k, b]) => (
                                    <div key={k} className="border border-[#E3E8EE] rounded p-3">
                                        <p className="text-[13px] font-semibold text-[#1A1F36]">{b.name} <span className="font-mono text-[11px] text-[#8792A2]">{k}</span></p>
                                        <DefinitionSummary def={b.definition} />
                                    </div>
                                ))}
                            </div>
                        </Card>
                        <Card title={tw('versionsTitle')} bodyClass="p-0">
                            <ErrorBox error={act.error} onDismiss={act.clearError} />
                            {data.versions.length === 0 ? <Empty>{tw('noVersions')}</Empty> : (
                                <Table>
                                    <thead>
                                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                            <th className={th}>{tw('code')}</th><th className={th}>{tw('definition')}</th><th className={th}>{tw('status')}</th><th className={th}></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F0F2F5]">
                                        {data.versions.map((v) => (
                                            <tr key={v.id}>
                                                <td className={td}><p className="font-mono text-[12px] font-semibold">{v.code} v{v.version}</p><p className="text-[12px] text-[#697386]">{v.name}</p></td>
                                                <td className={td}><DefinitionSummary def={v.definition} /></td>
                                                <td className={td}><StatusBadge status={v.status} /></td>
                                                <td className={`${td} whitespace-nowrap`}>
                                                    {v.status === 'SUBMITTED' && canApprove && v.makerId !== me && (
                                                        <div className="flex gap-1.5">
                                                            <Btn size="sm" variant="primary" busy={act.busy === `${v.id}:true`} onClick={() => decide(v.id, true)} title={tw('approveHint')}>{tw('approve')}</Btn>
                                                            <Btn size="sm" variant="danger" busy={act.busy === `${v.id}:false`} onClick={() => decide(v.id, false)}>{tw('reject')}</Btn>
                                                        </div>
                                                    )}
                                                    {v.status === 'SUBMITTED' && !!me && v.makerId === me && <p className="text-[11px] text-amber-800">{t('awaitingOther')}</p>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Card>
                    </div>
                    {can('workflow.manage') && <Builder wf={data} onCreated={reload} />}
                </>
            )}
        </LendingShell>
    );
}
