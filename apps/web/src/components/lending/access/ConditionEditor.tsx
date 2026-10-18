"use client";

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CondOp, Permission } from '../types';
import { Btn, Field, SelectInput, TextInput, inputCls } from '../ui';
import { Chip, groupByCategory } from './common';
import {
    ACTION_RE, POLICY_ATTRIBUTES, POLICY_OPERATORS, RULE_ID_RE, compToCondition, newComparison,
    type CompDraft, type RuleDraft,
} from './policyModel';

const NUMERIC = new Set(['environment.hourUtc', 'environment.dayOfWeek']);

function valuePlaceholder(c: CompDraft, t: (key: string) => string): string {
    if (c.op === 'in' || c.op === 'nin') return NUMERIC.has(c.attr) ? t('phNumList') : t('phList');
    if (c.attr === 'resource.amount') return t('phAmount');
    if (c.attr === 'environment.hourUtc') return '0–23';
    if (c.attr === 'environment.dayOfWeek') return t('phDay');
    return t('phValue');
}

/** One comparison row: [NOT] attr op value. */
function ComparisonRow({ c, onChange, onRemove }: { c: CompDraft; onChange: (c: CompDraft) => void; onRemove: () => void }) {
    const err = compToCondition(c).error;
    const t = useTranslations('LendingAccess.condition');
    return (
        <div className="space-y-1">
            <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] gap-2 items-center">
                <button
                    type="button"
                    onClick={() => onChange({ ...c, not: !c.not })}
                    className={`px-2 py-1.5 rounded border text-[11px] font-bold ${c.not ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-[#E3E8EE] text-[#AAB7C4]'}`}
                    title={t('notHint')}
                >
                    {t('not')}
                </button>
                <SelectInput value={c.attr} onChange={(attr) => onChange({ ...c, attr })} options={[...POLICY_ATTRIBUTES]} />
                <SelectInput
                    value={c.op}
                    onChange={(op) => onChange({ ...c, op: op as CondOp, value: op === 'exists' ? 'true' : c.op === 'exists' ? '' : c.value })}
                    options={POLICY_OPERATORS.map((o) => ({ value: o.value, label: t(`ops.${o.value}`) }))}
                    className="w-32"
                />
                {c.op === 'exists'
                    ? <SelectInput value={c.value === 'false' ? 'false' : 'true'} onChange={(value) => onChange({ ...c, value })} options={['true', 'false']} />
                    : <TextInput value={c.value} onChange={(value) => onChange({ ...c, value })} placeholder={valuePlaceholder(c, t)} inputMode={NUMERIC.has(c.attr) || c.attr === 'resource.amount' ? 'decimal' : undefined} />}
                <button type="button" onClick={onRemove} className="p-1.5 text-[#8792A2] hover:text-red-600" aria-label={t('removeCondition')}><Trash2 size={14} /></button>
            </div>
            {err && c.value !== '' && <p className="text-[11px] text-red-600 pl-12">{err}</p>}
        </div>
    );
}

/** Pick actions from the permission catalogue, or type a prefix ending in ".*". */
function ActionPicker({ permissions, value, onChange }: { permissions: Permission[]; value: string[]; onChange: (v: string[]) => void }) {
    const [custom, setCustom] = useState('');
    const t = useTranslations('LendingAccess.condition');
    const groups = groupByCategory(permissions);
    const add = (a: string) => { if (a && !value.includes(a)) onChange([...value, a]); };
    const customOk = ACTION_RE.test(custom.trim()) && custom.trim().endsWith('.*');
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-1 min-h-[24px]">
                {value.length === 0 && <span className="text-[12px] text-[#8792A2]">{t('noActions')}</span>}
                {value.map((a) => <Chip key={a} tone="accent" onRemove={() => onChange(value.filter((x) => x !== a))}>{a}</Chip>)}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select value="" onChange={(e) => add(e.target.value)} className={inputCls}>
                    <option value="">{t('addFromCatalogue')}</option>
                    {groups.map(([cat, perms]) => (
                        <optgroup key={cat} label={cat}>
                            {perms.map((p) => <option key={p.code} value={p.code} disabled={value.includes(p.code)}>{p.code}</option>)}
                        </optgroup>
                    ))}
                </select>
                <div className="flex gap-2">
                    <TextInput value={custom} onChange={setCustom} placeholder={t('prefixPlaceholder')} />
                    <Btn size="sm" disabled={!customOk} reason={!customOk ? t('prefixRule') : undefined} onClick={() => { add(custom.trim()); setCustom(''); }}>{t('add')}</Btn>
                </div>
            </div>
        </div>
    );
}

/** Constrained editor for one ABAC rule (no free-form code). */
export function RuleEditor({ rule, permissions, index, onChange, onRemove }: {
    rule: RuleDraft; permissions: Permission[]; index: number; onChange: (r: RuleDraft) => void; onRemove: () => void;
}) {
    const t = useTranslations('LendingAccess.condition');
    const setComp = (key: string, c: CompDraft) => onChange({ ...rule, comparisons: rule.comparisons.map((x) => (x.key === key ? c : x)) });
    return (
        <div className="border border-[#E3E8EE] rounded-md p-4 space-y-4 bg-white">
            <div className="flex items-center justify-between">
                <p className="text-[13px] font-bold text-[#1A1F36]">{t('rule', { n: index + 1 })}</p>
                <Btn size="sm" variant="ghost" onClick={onRemove}><Trash2 size={13} /> {t('removeRule')}</Btn>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label={t('ruleId')} error={rule.id && !RULE_ID_RE.test(rule.id) ? t('ruleIdRule') : undefined}>
                    <TextInput value={rule.id} onChange={(id) => onChange({ ...rule, id: id.toLowerCase() })} placeholder="large-disbursement-mfa" maxLength={40} />
                </Field>
                <Field label={t('effect')} hint={rule.effect === 'DENY' ? t('denyHint') : t('requireHint')}>
                    <SelectInput value={rule.effect} onChange={(effect) => onChange({ ...rule, effect: effect as RuleDraft['effect'] })} options={['DENY', 'REQUIRE']} />
                </Field>
                <Field label={t('message')} error={rule.message && rule.message.trim().length < 3 ? t('minChars') : undefined}>
                    <TextInput value={rule.message} onChange={(message) => onChange({ ...rule, message })} maxLength={200} placeholder={t('messagePlaceholder')} />
                </Field>
            </div>
            <Field label={t('actions')}><ActionPicker permissions={permissions} value={rule.actions} onChange={(actions) => onChange({ ...rule, actions })} /></Field>
            <div>
                <p className="text-[12px] font-semibold text-[#3C4257] mb-1">{t('condition')}</p>
                {rule.raw ? (
                    <div className="space-y-2">
                        <p className="text-[12px] text-amber-800">{t('tooDeep')}</p>
                        <pre className="text-[11px] bg-[#F7FAFC] border border-[#E3E8EE] rounded p-2 overflow-auto">{JSON.stringify(rule.raw, null, 2)}</pre>
                        <Btn size="sm" onClick={() => onChange({ ...rule, raw: undefined, comparisons: [newComparison()] })}>{t('rebuild')}</Btn>
                    </div>
                ) : (
                    <div className="space-y-2 border-l-2 border-[#C9D7FF] pl-3">
                        <div className="flex items-center gap-2 text-[12px] text-[#3C4257]">
                            {t('match')}
                            <SelectInput
                                value={rule.combinator}
                                onChange={(v) => onChange({ ...rule, combinator: v as RuleDraft['combinator'] })}
                                options={[{ value: 'all', label: t('allOf') }, { value: 'any', label: t('anyOf') }]}
                                className="w-40"
                            />
                            {t('theFollowing')}
                        </div>
                        {rule.comparisons.map((c) => (
                            <ComparisonRow key={c.key} c={c} onChange={(n) => setComp(c.key, n)} onRemove={() => onChange({ ...rule, comparisons: rule.comparisons.filter((x) => x.key !== c.key) })} />
                        ))}
                        <Btn size="sm" variant="ghost" disabled={rule.comparisons.length >= 20} onClick={() => onChange({ ...rule, comparisons: [...rule.comparisons, newComparison()] })}>{t('addComparison')}</Btn>
                    </div>
                )}
            </div>
        </div>
    );
}
