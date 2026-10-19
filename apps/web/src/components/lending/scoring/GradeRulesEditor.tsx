"use client";

import { Plus, Trash2 } from 'lucide-react';
import { Btn, Table, inputCls, td, th } from '../ui';
import { isDecimalString } from '../format';
import { useScoringText } from './i18n';

/** The decision outcomes a strategy can give (packages/shared scoring-strategy STRATEGY_OUTCOMES). */
export const STRATEGY_OUTCOMES = ['AUTO_APPROVE', 'REFER', 'DECLINE'] as const;

/**
 * One grade rule exactly as the product configuration stores it
 * (`gradeRuleSchema`): grade, outcome, maxAmount (decimal string or null for
 * the product limit) and rateAddOnBps (whole basis points, 0–5000).
 */
export interface GradeRule {
    grade: string;
    outcome: (typeof STRATEGY_OUTCOMES)[number];
    maxAmount: string | null;
    rateAddOnBps: number;
}

/** Rows as typed: the add-on stays text while it is being typed. */
function asRules(value: unknown): GradeRule[] {
    if (!Array.isArray(value)) return [];
    return value.map((r) => {
        const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
        return {
            grade: typeof o.grade === 'string' ? o.grade : '',
            outcome: (STRATEGY_OUTCOMES as readonly string[]).includes(o.outcome as string) ? (o.outcome as GradeRule['outcome']) : 'REFER',
            maxAmount: typeof o.maxAmount === 'string' ? o.maxAmount : null,
            rateAddOnBps: typeof o.rateAddOnBps === 'number' ? o.rateAddOnBps : 0,
        };
    });
}

/** Select an outcome by its friendly label; the stored value stays the code. */
export function OutcomeSelect({ value, onChange, disabled, allowEmpty }: {
    value: string | null | undefined; onChange: (v: GradeRule['outcome'] | undefined) => void; disabled?: boolean; allowEmpty?: boolean;
}) {
    const { t, outcome } = useScoringText();
    return (
        <select className={inputCls} value={value ?? ''} disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? undefined : (e.target.value as GradeRule['outcome']))}>
            {(allowEmpty || !value) && <option value="">{t('gradeRules.select')}</option>}
            {STRATEGY_OUTCOMES.map((o) => <option key={o} value={o}>{outcome(o)}</option>)}
        </select>
    );
}

/**
 * Structured editor for `scoring.strategy.gradeRules`: one row per grade with
 * its outcome, an optional maximum amount and a rate add-on. It produces the
 * same array the API validates; the server stays the validator (one rule per
 * grade, at most 12, amounts within the product limit).
 */
export function GradeRulesEditor({ value, onChange, disabled }: { value: unknown; onChange: (rules: GradeRule[]) => void; disabled?: boolean }) {
    const { t } = useScoringText();
    const rules = asRules(value);
    const setRow = (i: number, patch: Partial<GradeRule>) => onChange(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    const grades = rules.map((r) => r.grade);
    return (
        <div className="space-y-2">
            {rules.length === 0 ? (
                <p className="text-[12px] text-[#697386]">{t('gradeRules.none')}</p>
            ) : (
                <Table className="border border-[#E3E8EE] rounded bg-white">
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('gradeRules.grade')}</th><th className={th}>{t('gradeRules.outcome')}</th>
                            <th className={th}>{t('gradeRules.maxAmount')}</th><th className={th}>{t('gradeRules.rateAddOn')}</th><th className={th} />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rules.map((r, i) => {
                            const dup = r.grade !== '' && grades.indexOf(r.grade) !== i;
                            const badGrade = r.grade !== '' && !/^[A-Z0-9][A-Z0-9+-]{0,7}$/.test(r.grade);
                            const badAmount = r.maxAmount !== null && r.maxAmount !== '' && !isDecimalString(r.maxAmount);
                            return (
                                <tr key={i}>
                                    <td className={`${td} w-28`}>
                                        <input className={inputCls} value={r.grade} disabled={disabled} placeholder="A"
                                            onChange={(e) => setRow(i, { grade: e.target.value.toUpperCase().replace(/\s/g, '') })} />
                                        {(dup || badGrade) && <p className="text-[11px] text-red-600 mt-0.5">{dup ? t('gradeRules.duplicate') : t('gradeRules.badGrade')}</p>}
                                    </td>
                                    <td className={`${td} w-48`}>
                                        <OutcomeSelect value={r.outcome} disabled={disabled} onChange={(o) => setRow(i, { outcome: o ?? 'REFER' })} />
                                    </td>
                                    <td className={`${td} w-40`}>
                                        <input className={inputCls} inputMode="decimal" value={r.maxAmount ?? ''} disabled={disabled} placeholder={t('gradeRules.productLimit')}
                                            onChange={(e) => setRow(i, { maxAmount: e.target.value.trim() === '' ? null : e.target.value.trim() })} />
                                        {badAmount && <p className="text-[11px] text-red-600 mt-0.5">{t('gradeRules.badAmount')}</p>}
                                    </td>
                                    <td className={`${td} w-32`}>
                                        <input className={`${inputCls} tabular-nums`} type="number" min={0} max={5000} step={1} value={String(r.rateAddOnBps)} disabled={disabled}
                                            onChange={(e) => {
                                                const n = Number.parseInt(e.target.value, 10);
                                                setRow(i, { rateAddOnBps: Number.isNaN(n) ? 0 : n });
                                            }} />
                                    </td>
                                    <td className={`${td} w-10`}>
                                        {!disabled && <Btn size="sm" variant="ghost" aria-label={t('gradeRules.remove')} onClick={() => onChange(rules.filter((_, k) => k !== i))}><Trash2 size={13} /></Btn>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            )}
            {!disabled && (
                <Btn size="sm" disabled={rules.length >= 12} reason={rules.length >= 12 ? t('gradeRules.max') : undefined}
                    onClick={() => onChange([...rules, { grade: '', outcome: 'REFER', maxAmount: null, rateAddOnBps: 0 }])}>
                    <Plus size={13} /> {t('gradeRules.add')}
                </Btn>
            )}
        </div>
    );
}
