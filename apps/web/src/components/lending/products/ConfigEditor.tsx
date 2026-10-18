"use client";

import { useMemo, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Issue, ProductConfig } from '../types';
import { Btn, IssueList, Notice } from '../ui';
import { ConfigField } from './ConfigField';
import { STEPS, setPath, stepForPath } from './configSchema';

/**
 * Multi-step product configuration editor. Each step edits one section of the
 * config; nested arrays fall back to JSON boxes. Server validation issues are
 * shown on the step and next to the matching field.
 */
export function ConfigEditor({ config, onChange, issues = [], disabled }: {
    config: ProductConfig; onChange: (c: ProductConfig) => void; issues?: Issue[]; disabled?: boolean;
}) {
    const [step, setStep] = useState(STEPS[0].key);
    // Bumped when the whole config is replaced so uncontrolled JSON/list boxes re-read their value.
    const [revision, setRevision] = useState(0);
    const [fullJson, setFullJson] = useState<string | null>(null);
    const [fullErr, setFullErr] = useState<string | null>(null);
    const t = useTranslations('LendingProducts.config');
    const stepText = (key: string, part: 'label' | 'note', fallback: string) => (t.has(`steps.${key}.${part}`) ? t(`steps.${key}.${part}`) : fallback);

    const issuesByStep = useMemo(() => {
        const m: Record<string, Issue[]> = {};
        for (const i of issues) (m[stepForPath(i.path)] ??= []).push(i);
        return m;
    }, [issues]);

    const fieldError = (path: string) => {
        const hit = issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
        return hit.length ? hit.map((i) => (i.path === path ? i.message : `${i.path.slice(path.length + 1)}: ${i.message}`)).join('; ') : undefined;
    };

    const current = STEPS.find((s) => s.key === step);
    const allKeys = [...STEPS.map((s) => s.key), 'review'];
    const pos = allKeys.indexOf(step);

    const onSet = (path: string, value: unknown) => onChange(setPath(config, path, value));

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
            <ol className="flex lg:flex-col gap-1 overflow-x-auto no-scrollbar">
                {[...STEPS.map((s) => ({ key: s.key, label: stepText(s.key, 'label', s.label) })), { key: 'review', label: t('review') }].map((s, i) => {
                    const n = issuesByStep[s.key]?.length ?? 0;
                    const active = s.key === step;
                    return (
                        <li key={s.key}>
                            <button type="button" onClick={() => setStep(s.key)}
                                className={`w-full whitespace-nowrap flex items-center justify-between gap-2 text-left px-3 py-1.5 rounded text-[13px] ${active ? 'bg-[#635BFF] text-white font-semibold' : 'text-[#3C4257] hover:bg-slate-100'}`}>
                                <span><span className="opacity-60 mr-1.5">{i + 1}</span>{s.label}</span>
                                {n > 0 ? (
                                    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${active ? 'text-white' : 'text-red-600'}`}><AlertCircle size={12} />{n}</span>
                                ) : issues.length > 0 ? <Check size={12} className={active ? 'text-white' : 'text-emerald-600'} /> : null}
                            </button>
                        </li>
                    );
                })}
            </ol>

            <div className="space-y-4 min-w-0">
                {issuesByStep[step]?.length ? (
                    <Notice tone="danger" title={t('stepIssues', { count: issuesByStep[step].length })}>
                        <IssueList issues={issuesByStep[step]} />
                    </Notice>
                ) : null}

                {current && (
                    <>
                        {current.note && <p className="text-[12px] text-[#697386]">{stepText(current.key, 'note', current.note)}</p>}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
                            {current.fields.map((f) => {
                                if (f.when) {
                                    const parent = f.when.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), config);
                                    if (parent === null || parent === undefined) return null;
                                }
                                return <ConfigField key={`${f.path}-${revision}`} spec={f} config={config} onSet={onSet} error={fieldError(f.path)} disabled={disabled} />;
                            })}
                        </div>
                    </>
                )}

                {step === 'review' && (
                    <div className="space-y-3">
                        {issues.length > 0 && (
                            <Notice tone="danger" title={t('issues', { count: issues.length })}><IssueList issues={issues} /></Notice>
                        )}
                        <p className="text-[12px] text-[#697386]">{t('reviewNote')}</p>
                        <textarea
                            className="w-full rounded border border-[#E3E8EE] font-mono text-[12px] p-3 min-h-[420px]"
                            value={fullJson ?? JSON.stringify(config, null, 2)}
                            disabled={disabled}
                            onChange={(e) => setFullJson(e.target.value)}
                        />
                        {fullErr && <p className="text-[12px] text-red-600">{t('invalidJson', { error: fullErr })}</p>}
                        {fullJson !== null && (
                            <div className="flex gap-2">
                                <Btn variant="primary" size="sm" onClick={() => {
                                    try {
                                        const parsed = JSON.parse(fullJson) as ProductConfig;
                                        onChange(parsed);
                                        setFullJson(null);
                                        setFullErr(null);
                                        setRevision((r) => r + 1);
                                    } catch (e) { setFullErr((e as Error).message); }
                                }}>{t('applyJson')}</Btn>
                                <Btn size="sm" onClick={() => { setFullJson(null); setFullErr(null); }}>{t('discardEdits')}</Btn>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex justify-between pt-2 border-t border-[#F0F2F5]">
                    <Btn size="sm" disabled={pos <= 0} onClick={() => setStep(allKeys[pos - 1])}>{t('back')}</Btn>
                    <span className="text-[11px] text-[#8792A2] self-center">{t('stepOf', { n: pos + 1, total: allKeys.length })}</span>
                    <Btn size="sm" disabled={pos >= allKeys.length - 1} onClick={() => setStep(allKeys[pos + 1])}>{t('next')}</Btn>
                </div>
            </div>
        </div>
    );
}
