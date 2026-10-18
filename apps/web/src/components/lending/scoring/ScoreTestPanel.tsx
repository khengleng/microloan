"use client";

import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import api from '@/lib/api';
import { Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, TextInput } from '../ui';
import { useAction, useApi } from '../useAsync';
import { ScoreResultView } from './ScoreResultView';
import { useScoringText } from './i18n';
import { variablesUsed, withIssuePaths } from './types';
import type { Scorecard, ScoreResult, ScoreVariable, ScorecardDefinition, ScorecardList } from './types';

type Input = string | number | boolean | null;

function toInput(v: ScoreVariable | undefined, raw: string): Input {
    const s = raw.trim();
    if (s === '') return null;
    if (v?.type === 'BOOLEAN') return s === 'true';
    if (v?.type === 'NUMBER') return /^-?\d+$/.test(s) ? parseInt(s, 10) : s;
    return s;
}

/**
 * Try a definition against typed inputs without recording anything. Sources:
 * the draft open in the editor, a built-in template, or any saved version.
 */
export function ScoreTestPanel({ list, draft }: { list: ScorecardList; draft: { label: string; definition: ScorecardDefinition } | null }) {
    const { t, version: versionLabel } = useScoringText();
    const [source, setSource] = useState(draft ? 'draft' : list.templates[0] ? `template:${list.templates[0].code}` : '');
    const [inputs, setInputs] = useState<Record<string, string>>({});
    const [result, setResult] = useState<ScoreResult | null>(null);
    const { busy, error, run } = useAction();

    const [kind, a, b] = source.split(':');
    const detail = useApi<Scorecard>(kind === 'version' && a ? `/lending/scorecards/${a}` : null);

    const definition: ScorecardDefinition | null = useMemo(() => {
        if (kind === 'draft') return draft?.definition ?? null;
        if (kind === 'template') return list.templates.find((t) => t.code === a)?.definition ?? null;
        if (kind === 'version') return detail.data?.versions.find((v) => v.id === b)?.definition ?? null;
        return null;
    }, [kind, a, b, draft, list.templates, detail.data]);

    const used = variablesUsed(definition);
    const vars = new Map(list.variables.map((v) => [v.code, v]));

    const options = [
        ...(draft ? [{ value: 'draft', label: t('test.optionEditor', { label: draft.label }) }] : []),
        ...list.templates.map((tpl) => ({ value: `template:${tpl.code}`, label: t('test.optionTemplate', { name: tpl.name, code: tpl.code }) })),
        ...list.scorecards.flatMap((s) => s.versions.map((v) => ({ value: `version:${s.id}:${v.id}`, label: `${s.code} ${versionLabel(v.version)} · ${v.status.toLowerCase()}` }))),
    ];

    const test = async () => {
        const body: Record<string, unknown> = {
            inputs: Object.fromEntries(used.map((code) => [code, toInput(vars.get(code), inputs[code] ?? '')])),
        };
        if (kind === 'draft') body.definition = draft?.definition;
        else if (kind === 'template') body.templateCode = a;
        else if (kind === 'version') body.versionId = b;
        const res = await run('test', () => api.post<ScoreResult>('/lending/scorecard-test', body));
        if (res) setResult(res.data);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title={t('test.title')} subtitle={t('test.subtitle')}>
                <div className="space-y-4">
                    <Field label={t('test.scorecard')}>
                        <SelectInput value={source} onChange={(v) => { setSource(v); setResult(null); }} options={options} placeholder={t('test.choose')} />
                    </Field>
                    {kind === 'version' && detail.loading && <Spinner />}
                    {definition && used.length === 0 && <Empty>{t('test.noCharacteristics')}</Empty>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {used.map((code) => {
                            const v = vars.get(code);
                            const label = <>{v?.label ?? code} <span className="font-mono text-[10px] font-normal text-[#8792A2]">{code}</span></>;
                            const hint = v ? `${v.type.toLowerCase()}${v.unit ? ` · ${v.unit}` : ''}${v.type === 'NUMBER' ? ` · ${t('test.decimalsHint')}` : ''}` : t('test.unknownVariable');
                            const val = inputs[code] ?? '';
                            const setVal = (x: string) => setInputs((s) => ({ ...s, [code]: x }));
                            return (
                                <Field key={code} label={label} hint={hint}>
                                    {v?.type === 'BOOLEAN' ? (
                                        <SelectInput value={val} onChange={setVal} options={[{ value: 'true', label: t('common.yes') }, { value: 'false', label: t('common.no') }]} placeholder={t('test.missing')} />
                                    ) : v?.type === 'CATEGORY' && v.domain?.length ? (
                                        <SelectInput value={val} onChange={setVal} options={v.domain} placeholder={t('test.missing')} />
                                    ) : (
                                        <TextInput value={val} onChange={setVal} inputMode={v?.type === 'NUMBER' ? 'decimal' : undefined} placeholder={t('test.missing')} />
                                    )}
                                </Field>
                            );
                        })}
                    </div>
                    <ErrorBox error={withIssuePaths(error)} />
                    <Btn variant="primary" onClick={test} busy={busy === 'test'} disabled={!source}><FlaskConical size={14} /> {t('test.score')}</Btn>
                </div>
            </Card>
            <Card title={t('test.result')}>
                {result ? <ScoreResultView result={result} /> : <Notice>{t('test.runHint')}</Notice>}
            </Card>
        </div>
    );
}
