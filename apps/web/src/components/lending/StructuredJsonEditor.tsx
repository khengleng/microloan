"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox, Field, TextArea, TextInput } from './ui';

/**
 * Where a JSON text is broken, in words a person can act on: the parser's
 * message plus the line and column of the offending character.
 */
export function jsonProblem(text: string): string | null {
    try { JSON.parse(text); return null; } catch (e) {
        const msg = (e as Error).message;
        const at = /position (\d+)/.exec(msg);
        if (!at) return msg;
        const pos = Number(at[1]);
        const before = text.slice(0, pos);
        const line = before.split('\n').length;
        const col = pos - before.lastIndexOf('\n');
        return `${msg.replace(/ in JSON at position \d+.*$/, '')} (line ${line}, column ${col})`;
    }
}

type Leaf = string | number | boolean | null | unknown[];

function leaves(v: unknown, prefix = ''): [string, Leaf][] {
    if (v && typeof v === 'object' && !Array.isArray(v))
        return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => leaves(x, prefix ? `${prefix}.${k}` : k));
    return [[prefix, v as Leaf]];
}

function setPath(root: unknown, path: string, value: unknown): unknown {
    const keys = path.split('.');
    const copy = structuredClone(root) as Record<string, unknown>;
    let cur = copy;
    for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
    cur[keys[keys.length - 1]] = value;
    return copy;
}

/**
 * A form over a JSON settings object: numbers, text and switches get their
 * own inputs; lists and tables stay small JSON fields, each checked as typed.
 * The shape (which keys exist) is the starting value's — the server's schema
 * decides validity, this only spares people hand-editing one large JSON.
 */
export function StructuredJsonEditor({ value, onChange, labels = {}, onValidity }: {
    value: unknown;
    onChange: (next: unknown) => void;
    labels?: Record<string, string>;
    /** Called with the number of fields that do not parse. */
    onValidity?: (invalid: number) => void;
}) {
    const t = useTranslations('Governance.json');
    // Text being typed per field, kept until it parses.
    const [text, setText] = useState<Record<string, string>>({});
    const [bad, setBad] = useState<Record<string, string>>({});

    const report = (next: Record<string, string>) => { setBad(next); onValidity?.(Object.keys(next).length); };
    const edit = (path: string, raw: string, parse: (s: string) => unknown) => {
        setText((m) => ({ ...m, [path]: raw }));
        try {
            const v = parse(raw);
            const nb = { ...bad }; delete nb[path]; report(nb);
            onChange(setPath(value, path, v));
        } catch (e) {
            report({ ...bad, [path]: (e as Error).message });
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
            {leaves(value).map(([path, v]) => {
                const label = <>{labels[path] ?? path}<span className="ml-1 font-mono text-[10px] font-normal text-[#8792A2]">{path}</span></>;
                if (typeof v === 'boolean')
                    return <div key={path} className="pt-5"><Checkbox checked={v} onChange={(on) => onChange(setPath(value, path, on))} label={label} /></div>;
                if (typeof v === 'number')
                    return (
                        <Field key={path} label={label} error={bad[path]}>
                            <TextInput inputMode="decimal" value={text[path] ?? String(v)} onChange={(s) => edit(path, s, (x) => {
                                const n = Number(x.trim());
                                if (x.trim() === '' || !Number.isFinite(n)) throw new Error(t('notNumber'));
                                return n;
                            })} />
                        </Field>
                    );
                if (typeof v === 'string')
                    return <Field key={path} label={label}><TextInput value={v} onChange={(s) => onChange(setPath(value, path, s))} /></Field>;
                // Lists, tables and empty values: a small JSON field each.
                return (
                    <Field key={path} label={label} error={bad[path]} hint={t('jsonHint')}>
                        <TextArea rows={Array.isArray(v) && v.some((x) => typeof x === 'object') ? 5 : 2} className="font-mono text-[12px]"
                            value={text[path] ?? JSON.stringify(v)}
                            onChange={(s) => edit(path, s, (x) => { const p = jsonProblem(x); if (p) throw new Error(p); return JSON.parse(x); })} />
                    </Field>
                );
            })}
        </div>
    );
}

/** Form / JSON switch shared by the settings editors. */
export function EditorModeSwitch({ mode, onChange }: { mode: 'form' | 'json'; onChange: (m: 'form' | 'json') => void }) {
    const t = useTranslations('Governance.json');
    const cls = (on: boolean) => `px-2.5 py-1 text-[12px] font-semibold rounded ${on ? 'bg-[#635BFF] text-white' : 'text-[#3C4257] hover:bg-[#F0F2F5]'}`;
    return (
        <div className="inline-flex gap-1 rounded border border-[#E3E8EE] p-0.5" role="tablist">
            <button type="button" className={cls(mode === 'form')} onClick={() => onChange('form')}>{t('form')}</button>
            <button type="button" className={cls(mode === 'json')} onClick={() => onChange('json')}>{t('json')}</button>
        </div>
    );
}
