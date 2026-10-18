"use client";

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Checkbox, Field, inputCls } from '../ui';
import { fmtRate, isDecimalString } from '../format';
import { ALLOCATION_COMPONENTS, FieldSpec, getPath } from './configSchema';
import { GradeRulesEditor, OutcomeSelect } from '../scoring/GradeRulesEditor';

interface Props {
    spec: FieldSpec;
    config: unknown;
    onSet: (path: string, value: unknown) => void;
    error?: string;
    disabled?: boolean;
}

function JsonField({ value, onCommit, disabled }: { value: unknown; onCommit: (v: unknown) => void; disabled?: boolean }) {
    const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
    const [err, setErr] = useState<string | null>(null);
    return (
        <div>
            <textarea
                className={`${inputCls} font-mono text-[12px]`}
                rows={Math.min(14, Math.max(3, text.split('\n').length))}
                value={text}
                disabled={disabled}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => {
                    try {
                        const parsed = JSON.parse(text || 'null');
                        setErr(null);
                        onCommit(parsed);
                    } catch (e) {
                        setErr((e as Error).message);
                    }
                }}
            />
            {err && <p className="text-[11px] text-red-600 mt-0.5">Invalid JSON (not applied): {err}</p>}
        </div>
    );
}

function ListField({ value, onCommit, disabled }: { value: unknown; onCommit: (v: string[]) => void; disabled?: boolean }) {
    const [text, setText] = useState(() => (Array.isArray(value) ? value.join(', ') : ''));
    return (
        <input
            className={inputCls}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => onCommit(text.split(',').map((s) => s.trim()).filter(Boolean))}
        />
    );
}

/** One configuration control, chosen by the field kind. */
export function ConfigField({ spec, config, onSet, error, disabled }: Props) {
    const value = getPath(config, spec.path);
    const set = (v: unknown) => onSet(spec.path, v);
    const ro = disabled || spec.readOnly;

    switch (spec.kind) {
        case 'bool':
            return (
                <div className="pt-5">
                    <Checkbox checked={value === true} onChange={set} label={spec.label} disabled={ro} />
                    {error && <p className="text-[11px] text-red-600 mt-0.5">{error}</p>}
                </div>
            );
        case 'toggleObject':
            return (
                <div className="pt-5 sm:col-span-2">
                    <Checkbox
                        checked={value !== null && value !== undefined}
                        onChange={(on) => set(on ? spec.defaultValue ?? {} : null)}
                        label={spec.label}
                        disabled={ro}
                    />
                    {error && <p className="text-[11px] text-red-600 mt-0.5">{error}</p>}
                </div>
            );
        case 'multi': {
            const arr = Array.isArray(value) ? (value as string[]) : [];
            return (
                <Field label={spec.label} hint={spec.hint} error={error} className="sm:col-span-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border border-[#E3E8EE] rounded p-2">
                        {(spec.options ?? []).map((o) => (
                            <Checkbox
                                key={o}
                                label={<span className="text-[12px]">{o}</span>}
                                checked={arr.includes(o)}
                                disabled={ro}
                                onChange={(on) => set(on ? [...arr, o] : arr.filter((x) => x !== o))}
                            />
                        ))}
                    </div>
                </Field>
            );
        }
        case 'order': {
            const arr = Array.isArray(value) && value.length ? (value as string[]) : [...ALLOCATION_COMPONENTS];
            const move = (i: number, d: number) => {
                const next = [...arr];
                const j = i + d;
                if (j < 0 || j >= next.length) return;
                [next[i], next[j]] = [next[j], next[i]];
                set(next);
            };
            return (
                <Field label={spec.label} hint="Payments are applied in this order." error={error} className="sm:col-span-2">
                    <ol className="flex flex-wrap gap-2">
                        {arr.map((c, i) => (
                            <li key={c} className="flex items-center gap-1 border border-[#E3E8EE] rounded px-2 py-1 text-[12px] bg-white">
                                <span className="text-[#8792A2]">{i + 1}.</span> <b>{c}</b>
                                <button type="button" disabled={ro || i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp size={12} /></button>
                                <button type="button" disabled={ro || i === arr.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown size={12} /></button>
                            </li>
                        ))}
                    </ol>
                </Field>
            );
        }
        case 'outcome':
            return (
                <Field label={spec.label} hint={spec.hint} error={error}>
                    <OutcomeSelect value={typeof value === 'string' ? value : undefined} disabled={ro} onChange={set} />
                </Field>
            );
        case 'gradeRules':
            return (
                <Field label={spec.label} hint={spec.hint} error={error} className="sm:col-span-2">
                    <GradeRulesEditor value={value} disabled={ro} onChange={set} />
                </Field>
            );
        case 'json':
            return (
                <Field label={spec.label} hint={spec.hint ? `${spec.hint} — applied when you leave the box` : 'Applied when you leave the box'} error={error} className="sm:col-span-2">
                    <JsonField value={value} onCommit={set} disabled={ro} />
                </Field>
            );
        case 'list':
            return (
                <Field label={spec.label} hint={spec.hint} error={error}>
                    <ListField value={value} onCommit={set} disabled={ro} />
                </Field>
            );
        case 'enum':
        case 'nenum':
            return (
                <Field label={spec.label} hint={spec.hint} error={error}>
                    <select className={inputCls} value={value === null || value === undefined ? '' : String(value)} disabled={ro}
                        onChange={(e) => set(e.target.value === '' ? (spec.kind === 'nenum' ? null : undefined) : e.target.value)}>
                        {(spec.kind === 'nenum' || value === undefined) && <option value="">{spec.kind === 'nenum' ? '(none)' : 'Select…'}</option>}
                        {(spec.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                </Field>
            );
        case 'int':
        case 'nint':
            return (
                <Field label={spec.label} hint={spec.hint} error={error}>
                    <input type="number" step={1} className={inputCls} disabled={ro}
                        value={value === null || value === undefined ? '' : String(value)}
                        placeholder={spec.kind === 'nint' ? '(none)' : ''}
                        onChange={(e) => {
                            const t = e.target.value;
                            if (t === '') return set(spec.kind === 'nint' ? null : undefined);
                            const n = Number.parseInt(t, 10);
                            set(Number.isNaN(n) ? undefined : n);
                        }} />
                </Field>
            );
        case 'rate':
        case 'nrate':
        case 'decimal':
        case 'ndecimal': {
            const nullable = spec.kind === 'nrate' || spec.kind === 'ndecimal';
            const isRate = spec.kind === 'rate' || spec.kind === 'nrate';
            const s = value === null || value === undefined ? '' : String(value);
            const hint = isRate
                ? `Decimal fraction${s && isDecimalString(s) ? ` = ${fmtRate(s)}` : ' (0.12 = 12%)'}`
                : spec.hint;
            return (
                <Field label={spec.label} hint={hint} error={error || (s && !isDecimalString(s) ? 'must be a decimal like 1000 or 0.125' : undefined)}>
                    <input inputMode="decimal" className={inputCls} disabled={ro} value={s} placeholder={nullable ? '(none)' : ''}
                        onChange={(e) => set(e.target.value === '' ? (nullable ? null : '') : e.target.value.trim())} />
                </Field>
            );
        }
        case 'ntext':
        case 'text':
        case 'textarea':
        default: {
            const s = value === null || value === undefined ? '' : String(value);
            const onChange = (t: string) => set(t === '' && spec.kind === 'ntext' ? null : t);
            return (
                <Field label={spec.label} hint={spec.hint} error={error} className={spec.kind === 'textarea' ? 'sm:col-span-2' : ''}>
                    {spec.kind === 'textarea'
                        ? <textarea className={inputCls} rows={2} disabled={ro} value={s} onChange={(e) => onChange(e.target.value)} />
                        : <input className={inputCls} disabled={ro} value={s} placeholder={spec.kind === 'ntext' ? '(none)' : ''} onChange={(e) => onChange(e.target.value)} />}
                </Field>
            );
        }
    }
}
