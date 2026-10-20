"use client";

import { useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Btn, Field, Notice, SelectInput, TextInput, Table, td, th } from '../ui';
import { KIND_INFO, POLICY_TEMPLATES, paramRefs, paramsToRows, rowsToParams } from './types';
import type { ParamRow, PolicyKind, PolicyParameter } from './types';

type Tr = ReturnType<typeof useTranslations>;

export interface DefinitionDraft {
    rows: ParamRow[];
    bodyText: string;
}

export function emptyDraft(): DefinitionDraft {
    return { rows: [], bodyText: '{\n}' };
}

export function draftFrom(parameters: Record<string, PolicyParameter> | null | undefined, body: unknown): DefinitionDraft {
    return { rows: paramsToRows(parameters), bodyText: JSON.stringify(body ?? {}, null, 2) };
}

/**
 * Parse and check a draft before sending. The server is authoritative; this
 * only catches what can be seen locally (bad JSON, wrong top-level keys,
 * undeclared `$param` references, bad parameter bounds).
 */
export function checkDraft(t: Tr, kind: PolicyKind, d: DefinitionDraft): { parameters?: Record<string, PolicyParameter>; body?: Record<string, unknown>; problems: string[] } {
    const problems: string[] = [];
    let body: Record<string, unknown> | undefined;
    try {
        const parsed: unknown = JSON.parse(d.bodyText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) problems.push(t('check.notObject'));
        else body = parsed as Record<string, unknown>;
    } catch (e) {
        problems.push(t('check.invalidJson', { message: (e as Error).message }));
    }
    const { params, problems: pp } = rowsToParams(d.rows);
    problems.push(...pp);
    if (body) {
        const allowed = KIND_INFO[kind].keys;
        const stray = Object.keys(body).filter((k) => !allowed.includes(k));
        if (stray.length) problems.push(t('check.stray', { kind, allowed: allowed.join(', '), found: stray.join(', ') }));
        if (Object.keys(body).length === 0) problems.push(t('check.empty', { allowed: allowed.join(', ') }));
        if (params) {
            const missing = Array.from(paramRefs(body)).filter((n) => !(n in params));
            if (missing.length) problems.push(t('check.undeclared', { count: missing.length, names: missing.join(', ') }));
        }
    }
    return { parameters: params, body, problems };
}

export function PolicyDefinitionEditor({ kind, value, onChange }: { kind: PolicyKind; value: DefinitionDraft; onChange: (d: DefinitionDraft) => void }) {
    const t = useTranslations('LendingPolicies');
    const [templateIdx, setTemplateIdx] = useState('');
    const templates = POLICY_TEMPLATES[kind];
    const setRow = (i: number, patch: Partial<ParamRow>) => onChange({ ...value, rows: value.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
    const used = (() => {
        try { return paramRefs(JSON.parse(value.bodyText)); } catch { return new Set<string>(); }
    })();

    const applyTemplate = () => {
        const tpl = templates[Number(templateIdx)];
        if (!tpl) return;
        onChange({ rows: paramsToRows(tpl.parameters).map((r) => (r.label ? { ...r, label: t(`templates.${kind}.${templateIdx}.params.${r.name}`) } : r)), bodyText: JSON.stringify(tpl.body, null, 2) });
    };

    const insertRef = (name: string) => {
        if (!name) return;
        navigator.clipboard?.writeText(JSON.stringify({ $param: name })).catch(() => undefined);
    };

    return (
        <div className="space-y-4">
            <div>
                <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[12px] font-semibold text-[#3C4257]">{t('parameters')}</p>
                    <Btn size="sm" variant="ghost" disabled={value.rows.length >= 10}
                        onClick={() => onChange({ ...value, rows: [...value.rows, { name: '', type: 'int', default: '', min: '', max: '', label: '' }] })}>
                        <Plus size={13} /> {t('editor.addParameter')}
                    </Btn>
                </div>
                {value.rows.length === 0 ? (
                    <p className="text-[12px] text-[#697386]">{t.rich('editor.noParameters', { ref: () => <code className="font-mono">{'{ "$param": "name" }'}</code> })}</p>
                ) : (
                    <Table className="border border-[#E3E8EE] rounded">
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('col.name')}</th>
                                <th className={th}>{t('col.type')}</th>
                                <th className={th}>{t('col.default')}</th>
                                <th className={th}>{t('col.min')}</th>
                                <th className={th}>{t('col.max')}</th>
                                <th className={th}>{t('col.label')}</th>
                                <th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {value.rows.map((r, i) => (
                                <tr key={i}>
                                    <td className={td}>
                                        <TextInput value={r.name} onChange={(v) => setRow(i, { name: v })} placeholder="lockInMonths" className="font-mono min-w-[140px]" />
                                        {r.name && !used.has(r.name) && <span className="block text-[11px] text-amber-700 mt-0.5">{t('editor.notUsed')}</span>}
                                    </td>
                                    <td className={td}>
                                        <SelectInput value={r.type} onChange={(v) => setRow(i, { type: v as ParamRow['type'] })} options={['int', 'decimal']} className="w-24" />
                                    </td>
                                    <td className={td}><TextInput value={r.default} onChange={(v) => setRow(i, { default: v })} inputMode="decimal" className="w-20" /></td>
                                    <td className={td}><TextInput value={r.min} onChange={(v) => setRow(i, { min: v })} inputMode="decimal" className="w-20" /></td>
                                    <td className={td}><TextInput value={r.max} onChange={(v) => setRow(i, { max: v })} inputMode="decimal" className="w-20" /></td>
                                    <td className={td}><TextInput value={r.label} onChange={(v) => setRow(i, { label: v })} maxLength={120} className="min-w-[140px]" /></td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        <Btn size="sm" variant="ghost" onClick={() => insertRef(r.name)} title={t('editor.copyRefTitle')} disabled={!r.name}>{t('editor.copyRef')}</Btn>
                                        <Btn size="sm" variant="ghost" onClick={() => onChange({ ...value, rows: value.rows.filter((_, k) => k !== i) })} title={t('editor.remove')}><Trash2 size={13} /></Btn>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </div>

            <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                    <Field label={t('editor.template')} className="flex-1 min-w-[240px]" hint={templateIdx !== '' ? (templates[Number(templateIdx)] ? t(`templates.${kind}.${templateIdx}.description`) : undefined) : t('editor.templateHint', { kind: t(`kindLower.${kind}`) })}>
                        <SelectInput value={templateIdx} onChange={setTemplateIdx} placeholder={t('editor.chooseTemplate')} options={templates.map((_tpl, i) => ({ value: String(i), label: t(`templates.${kind}.${i}.label`) }))} />
                    </Field>
                    <Btn onClick={applyTemplate} disabled={templateIdx === ''} className="mb-[18px]"><Wand2 size={13} /> {t('editor.useTemplate')}</Btn>
                </div>
                <Field label={t('editor.body')} hint={t.rich('editor.bodyHint', { keys: () => <span className="font-mono">{KIND_INFO[kind].keys.join(', ')}</span>, path: () => <span className="font-mono">{KIND_INFO[kind].path}</span> })}>
                    <textarea
                        className="w-full rounded border border-[#E3E8EE] font-mono text-[12px] p-3 min-h-[260px] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/30 focus:border-[#635BFF]"
                        value={value.bodyText}
                        spellCheck={false}
                        onChange={(e) => onChange({ ...value, bodyText: e.target.value })}
                    />
                </Field>
                <BodyJsonStatus text={value.bodyText} onFormat={(txt) => onChange({ ...value, bodyText: txt })} />
            </div>
        </div>
    );
}

function BodyJsonStatus({ text, onFormat }: { text: string; onFormat: (t: string) => void }) {
    const t = useTranslations('LendingPolicies.editor');
    let err: string | null = null;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (e) { err = (e as Error).message; }
    if (err) return <Notice tone="warn" title={t('invalidJson')}>{err}</Notice>;
    return (
        <div className="flex items-center gap-2 text-[11px] text-[#697386]">
            <span className="text-emerald-700 font-semibold">{t('validJson')}</span>
            <button type="button" className="underline hover:text-[#1A1F36]" onClick={() => onFormat(JSON.stringify(parsed, null, 2))}>{t('format')}</button>
            <span>{t('serverChecks')}</span>
        </div>
    );
}

export function LocalProblems({ problems }: { problems: string[] }) {
    const t = useTranslations('LendingPolicies.editor');
    if (!problems.length) return null;
    return (
        <Notice tone="warn" title={t('fixThese')}>
            <ul className="list-disc pl-5 space-y-0.5 text-[12px]">
                {problems.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
        </Notice>
    );
}
