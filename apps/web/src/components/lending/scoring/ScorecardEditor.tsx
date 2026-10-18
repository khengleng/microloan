"use client";

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Btn, Checkbox, Field, SelectInput, Table, TextInput, inputCls, td, th } from '../ui';
import { useScoringText } from './i18n';
import type {
    Bin, CategoryRule, Characteristic, CharacteristicType, GradeBand, LinearRule, ScoreVariable, ScorecardDefinition,
} from './types';

/** Integer input that keeps the text while typing ("-", "") and reports only whole numbers. */
function IntInput({ value, onChange, disabled, nullable, placeholder }: {
    value: number | null; onChange: (v: number | null) => void; disabled?: boolean; nullable?: boolean; placeholder?: string;
}) {
    const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
    const [seen, setSeen] = useState(value);
    if (seen !== value) {
        setSeen(value);
        if (String(value ?? '') !== text) setText(value === null || value === undefined ? '' : String(value));
    }
    return (
        <input
            inputMode="numeric"
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => {
                const t = e.target.value;
                setText(t);
                if (t.trim() === '' && nullable) { setSeen(null); onChange(null); return; }
                if (/^-?\d+$/.test(t.trim())) { const n = parseInt(t, 10); setSeen(n); onChange(n); }
            }}
            className={`${inputCls} tabular-nums`}
        />
    );
}

const TYPES: CharacteristicType[] = ['BINS', 'CATEGORIES', 'LINEAR'];

function newCharacteristic(n: number): Characteristic {
    return {
        code: `CHARACTERISTIC_${n}`,
        label: '',
        variable: '',
        type: 'BINS',
        bins: [{ upTo: null, points: 0, reason: '' }],
        missing: { points: 0, reason: 'Not provided' },
        adverseReason: null,
    };
}

function withType(c: Characteristic, type: CharacteristicType): Characteristic {
    const out: Characteristic = { ...c, type };
    if (type === 'BINS' && !out.bins?.length) out.bins = [{ upTo: null, points: 0, reason: '' }];
    if (type === 'CATEGORIES' && !out.categories?.length) out.categories = [{ values: [], points: 0, reason: '' }];
    if (type === 'LINEAR' && !out.linear) out.linear = { centre: '0', weight: '1', minPoints: null, maxPoints: null, reason: '' };
    return out;
}

function variableOption(v: ScoreVariable, consent: string) {
    return { value: v.code, label: `${v.code} — ${v.label} · ${v.source.toLowerCase()}${v.consent ? ` · ${consent}` : ''}` };
}

/**
 * Structured editor for a scorecard definition. The API validates the whole
 * definition on save; its issues are shown by the caller.
 */
export function ScorecardEditor({ value, onChange, variables, readOnly }: {
    value: ScorecardDefinition; onChange: (d: ScorecardDefinition) => void; variables: ScoreVariable[]; readOnly?: boolean;
}) {
    const { t } = useScoringText();
    const set = (patch: Partial<ScorecardDefinition>) => onChange({ ...value, ...patch });
    const setGrade = (i: number, patch: Partial<GradeBand>) => set({ grades: value.grades.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
    const setChar = (i: number, c: Characteristic) => set({ characteristics: value.characteristics.map((x, k) => (k === i ? c : x)) });
    const move = (i: number, d: -1 | 1) => {
        const list = [...value.characteristics];
        const j = i + d;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        set({ characteristics: list });
    };

    return (
        <fieldset data-tour="scorecards-editor" disabled={readOnly} className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label={t('editor.baseScore')}><IntInput value={value.baseScore} onChange={(v) => set({ baseScore: v ?? 0 })} /></Field>
                <Field label={t('editor.minScore')}><IntInput value={value.minScore} onChange={(v) => set({ minScore: v ?? 0 })} /></Field>
                <Field label={t('editor.maxScore')}><IntInput value={value.maxScore} onChange={(v) => set({ maxScore: v ?? 0 })} /></Field>
                <Field label={t('editor.adverseCount')} hint="0–10"><IntInput value={value.adverseReasonCount} onChange={(v) => set({ adverseReasonCount: v ?? 0 })} /></Field>
            </div>

            <div>
                <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[12px] font-bold text-[#3C4257]">{t('editor.gradeBands')} <span className="font-normal text-[#697386]">— {t('editor.gradeBandsHint')}</span></p>
                    {!readOnly && <Btn size="sm" onClick={() => set({ grades: [...value.grades, { grade: '', label: '', minScore: value.minScore }] })}><Plus size={13} /> {t('editor.band')}</Btn>}
                </div>
                <Table className="border border-[#E3E8EE] rounded">
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('editor.grade')}</th><th className={th}>{t('editor.label')}</th><th className={th}>{t('editor.fromScore')}</th><th className={th} /></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {value.grades.map((g, i) => (
                            <tr key={i}>
                                <td className={`${td} w-24`}><TextInput value={g.grade} onChange={(v) => setGrade(i, { grade: v.toUpperCase() })} /></td>
                                <td className={td}><TextInput value={g.label} onChange={(v) => setGrade(i, { label: v })} /></td>
                                <td className={`${td} w-32`}><IntInput value={g.minScore} onChange={(v) => setGrade(i, { minScore: v ?? 0 })} /></td>
                                <td className={`${td} w-10`}>
                                    {!readOnly && <Btn size="sm" variant="ghost" aria-label={t('editor.removeBand')} onClick={() => set({ grades: value.grades.filter((_, k) => k !== i) })}><Trash2 size={13} /></Btn>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <p className="text-[12px] font-bold text-[#3C4257]">{t('editor.characteristics', { count: value.characteristics.length })}</p>
                    {!readOnly && <Btn size="sm" onClick={() => set({ characteristics: [...value.characteristics, newCharacteristic(value.characteristics.length + 1)] })}><Plus size={13} /> {t('editor.characteristic')}</Btn>}
                </div>
                {value.characteristics.map((c, i) => (
                    <CharacteristicEditor
                        key={i}
                        value={c}
                        variables={variables}
                        readOnly={readOnly}
                        onChange={(nc) => setChar(i, nc)}
                        onRemove={() => set({ characteristics: value.characteristics.filter((_, k) => k !== i) })}
                        onUp={i > 0 ? () => move(i, -1) : undefined}
                        onDown={i < value.characteristics.length - 1 ? () => move(i, 1) : undefined}
                    />
                ))}
            </div>
        </fieldset>
    );
}

function CharacteristicEditor({ value: c, onChange, variables, readOnly, onRemove, onUp, onDown }: {
    value: Characteristic; onChange: (c: Characteristic) => void; variables: ScoreVariable[]; readOnly?: boolean;
    onRemove: () => void; onUp?: () => void; onDown?: () => void;
}) {
    const { t } = useScoringText();
    const v = variables.find((x) => x.code === c.variable);
    const set = (patch: Partial<Characteristic>) => onChange({ ...c, ...patch });
    const booleans = variables.filter((x) => x.type === 'BOOLEAN');
    const varOptions = variables.map((x) => variableOption(x, t('editor.consent')));
    if (c.variable && !v) varOptions.unshift({ value: c.variable, label: `${c.variable} (${t('test.unknownVariable')})` });

    return (
        <div className="border border-[#E3E8EE] rounded-md p-4 space-y-3 bg-[#FBFCFE]">
            <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] font-bold text-[#1A1F36]">{c.label || c.code || t('editor.newCharacteristic')}</p>
                {!readOnly && (
                    <div className="flex gap-1">
                        <Btn size="sm" variant="ghost" disabled={!onUp} onClick={onUp} aria-label={t('editor.moveUp')}><ArrowUp size={13} /></Btn>
                        <Btn size="sm" variant="ghost" disabled={!onDown} onClick={onDown} aria-label={t('editor.moveDown')}><ArrowDown size={13} /></Btn>
                        <Btn size="sm" variant="danger" onClick={onRemove}><Trash2 size={13} /> {t('editor.remove')}</Btn>
                    </div>
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label={t('editor.code')} hint={t('scorecards.codeHint')}><TextInput value={c.code} onChange={(x) => set({ code: x.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} /></Field>
                <Field label={t('editor.label')}><TextInput value={c.label} onChange={(x) => set({ label: x })} /></Field>
                <Field label={t('editor.group')} hint={t('editor.groupHint')}><TextInput value={c.group ?? ''} onChange={(x) => set({ group: x.toUpperCase().replace(/[^A-Z0-9_]/g, '_') || undefined })} /></Field>
                <Field label={t('editor.variable')} className="md:col-span-2"
                    hint={v ? `${v.type.toLowerCase()}${v.unit ? ` (${v.unit})` : ''} · ${t('editor.sourceIs', { source: v.source.toLowerCase().replace(/_/g, ' ') })} · ${v.consent ? t('editor.requiresConsent', { consent: v.consent }) : t('editor.noConsentNeeded')}${v.description ? ` — ${v.description}` : ''}` : undefined}>
                    <SelectInput value={c.variable} onChange={(x) => set({ variable: x })} options={varOptions} placeholder={t('editor.chooseVariable')} />
                </Field>
                <Field label={t('editor.type')}><SelectInput value={c.type} onChange={(x) => onChange(withType(c, x as CharacteristicType))} options={TYPES.map((x) => ({ value: x, label: t(`editor.types.${x}`) }))} /></Field>
            </div>

            {c.type === 'BINS' && <BinsEditor bins={c.bins ?? []} onChange={(bins) => set({ bins })} readOnly={readOnly} />}
            {c.type === 'CATEGORIES' && <CategoriesEditor rules={c.categories ?? []} onChange={(categories) => set({ categories })} variable={v} readOnly={readOnly} />}
            {c.type === 'LINEAR' && c.linear && <LinearEditor rule={c.linear} onChange={(linear) => set({ linear })} />}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <Field label={t('editor.missingPoints')}><IntInput value={c.missing.points} onChange={(x) => set({ missing: { ...c.missing, points: x ?? 0 } })} /></Field>
                <Field label={t('editor.missingReason')} className="md:col-span-2"><TextInput value={c.missing.reason} onChange={(x) => set({ missing: { ...c.missing, reason: x } })} /></Field>
                <div className="pb-1.5"><Checkbox checked={!!c.missing.omit} disabled={readOnly} onChange={(x) => set({ missing: { ...c.missing, omit: x || undefined } })} label={t('editor.omitWhenMissing')} /></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <Field label={t('editor.skipWhen')} className="md:col-span-2" hint={t('editor.skipWhenHint')}>
                    <SelectInput value={c.skipWhen?.variable ?? ''} placeholder={t('editor.neverSkip')}
                        onChange={(x) => set({ skipWhen: x ? { variable: x, equals: c.skipWhen?.equals ?? true } : undefined })}
                        options={booleans.map((x) => variableOption(x, t('editor.consent')))} />
                </Field>
                {c.skipWhen && (
                    <Field label={t('editor.equals')}>
                        <SelectInput value={String(c.skipWhen.equals)} onChange={(x) => set({ skipWhen: { variable: c.skipWhen!.variable, equals: x === 'true' } })} options={['true', 'false']} />
                    </Field>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div className="pb-1.5">
                    <Checkbox checked={!!c.adverseReason} disabled={readOnly} label={t('editor.adverseReason')}
                        onChange={(x) => set({ adverseReason: x ? { code: c.code, text: '' } : null })} />
                </div>
                {c.adverseReason && (
                    <>
                        <Field label={t('editor.reasonCode')}><TextInput value={c.adverseReason.code} onChange={(x) => set({ adverseReason: { ...c.adverseReason!, code: x.toUpperCase() } })} /></Field>
                        <Field label={t('editor.customerText')} className="md:col-span-2"><TextInput value={c.adverseReason.text} onChange={(x) => set({ adverseReason: { ...c.adverseReason!, text: x } })} /></Field>
                    </>
                )}
            </div>
        </div>
    );
}

function BinsEditor({ bins, onChange, readOnly }: { bins: Bin[]; onChange: (b: Bin[]) => void; readOnly?: boolean }) {
    const { t } = useScoringText();
    const setBin = (i: number, patch: Partial<Bin>) => onChange(bins.map((b, k) => (k === i ? { ...b, ...patch } : b)));
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <p className="text-[12px] text-[#697386]">{t('editor.binsHint')} {'{value}'} / {'{percent}'}</p>
                {!readOnly && <Btn size="sm" onClick={() => onChange([...bins.slice(0, -1), { upTo: '', points: 0, reason: '' }, ...bins.slice(-1)])}><Plus size={13} /> {t('editor.bin')}</Btn>}
            </div>
            <Table className="border border-[#E3E8EE] rounded bg-white">
                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('editor.upTo')}</th><th className={th}>{t('editor.points')}</th><th className={th}>{t('editor.reason')}</th><th className={th}>{t('editor.omit')}</th><th className={th} /></tr></thead>
                <tbody className="divide-y divide-[#F0F2F5]">
                    {bins.map((b, i) => {
                        const last = i === bins.length - 1;
                        return (
                            <tr key={i}>
                                <td className={`${td} w-32`}>
                                    {last ? <span className="text-[12px] text-[#697386]">{t('editor.andAbove')}</span> : <TextInput value={b.upTo ?? ''} onChange={(x) => setBin(i, { upTo: x.trim() })} placeholder="0.25" />}
                                </td>
                                <td className={`${td} w-24`}><IntInput value={b.points} onChange={(x) => setBin(i, { points: x ?? 0 })} /></td>
                                <td className={td}><TextInput value={b.reason} onChange={(x) => setBin(i, { reason: x })} /></td>
                                <td className={`${td} w-14`}><Checkbox checked={!!b.omit} disabled={readOnly} onChange={(x) => setBin(i, { omit: x || undefined })} label="" /></td>
                                <td className={`${td} w-10`}>
                                    {!readOnly && !last && <Btn size="sm" variant="ghost" aria-label={t('editor.removeBin')} onClick={() => onChange(bins.filter((_, k) => k !== i))}><Trash2 size={13} /></Btn>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </Table>
        </div>
    );
}

function CategoriesEditor({ rules, onChange, variable, readOnly }: { rules: CategoryRule[]; onChange: (r: CategoryRule[]) => void; variable?: ScoreVariable; readOnly?: boolean }) {
    const { t } = useScoringText();
    const setRule = (i: number, patch: Partial<CategoryRule>) => onChange(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    const domain = variable?.type === 'BOOLEAN' ? ['true', 'false'] : variable?.domain ?? null;
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <p className="text-[12px] text-[#697386]">{domain ? t('editor.tickValues') : t('editor.commaValues')}</p>
                {!readOnly && <Btn size="sm" onClick={() => onChange([...rules, { values: [], points: 0, reason: '' }])}><Plus size={13} /> {t('editor.category')}</Btn>}
            </div>
            <Table className="border border-[#E3E8EE] rounded bg-white">
                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('editor.values')}</th><th className={th}>{t('editor.points')}</th><th className={th}>{t('editor.reason')}</th><th className={th}>{t('editor.omit')}</th><th className={th} /></tr></thead>
                <tbody className="divide-y divide-[#F0F2F5]">
                    {rules.map((r, i) => (
                        <tr key={i}>
                            <td className={td}>
                                {domain ? (
                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                        {domain.map((d) => (
                                            <Checkbox key={d} checked={r.values.includes(d)} disabled={readOnly} label={d}
                                                onChange={(x) => setRule(i, { values: x ? [...r.values, d] : r.values.filter((y) => y !== d) })} />
                                        ))}
                                    </div>
                                ) : (
                                    <TextInput value={r.values.join(', ')} onChange={(x) => setRule(i, { values: x.split(',').map((s) => s.trim()).filter(Boolean) })} />
                                )}
                            </td>
                            <td className={`${td} w-24`}><IntInput value={r.points} onChange={(x) => setRule(i, { points: x ?? 0 })} /></td>
                            <td className={td}><TextInput value={r.reason} onChange={(x) => setRule(i, { reason: x })} /></td>
                            <td className={`${td} w-14`}><Checkbox checked={!!r.omit} disabled={readOnly} onChange={(x) => setRule(i, { omit: x || undefined })} label="" /></td>
                            <td className={`${td} w-10`}>
                                {!readOnly && <Btn size="sm" variant="ghost" aria-label={t('editor.removeCategory')} onClick={() => onChange(rules.filter((_, k) => k !== i))}><Trash2 size={13} /></Btn>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        </div>
    );
}

function LinearEditor({ rule, onChange }: { rule: LinearRule; onChange: (r: LinearRule) => void }) {
    const { t } = useScoringText();
    const set = (patch: Partial<LinearRule>) => onChange({ ...rule, ...patch });
    return (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Field label={t('editor.centre')} hint={t('editor.decimal')}><TextInput value={rule.centre} onChange={(x) => set({ centre: x.trim() })} /></Field>
            <Field label={t('editor.weight')} hint={t('editor.pointsPerUnit')}><TextInput value={rule.weight} onChange={(x) => set({ weight: x.trim() })} /></Field>
            <Field label={t('editor.minPoints')} hint={t('editor.blankNone')}><IntInput nullable value={rule.minPoints} onChange={(x) => set({ minPoints: x })} /></Field>
            <Field label={t('editor.maxPoints')} hint={t('editor.blankNone')}><IntInput nullable value={rule.maxPoints} onChange={(x) => set({ maxPoints: x })} /></Field>
            <Field label={t('editor.reason')} className="col-span-2 md:col-span-1"><TextInput value={rule.reason} onChange={(x) => set({ reason: x })} /></Field>
        </div>
    );
}
