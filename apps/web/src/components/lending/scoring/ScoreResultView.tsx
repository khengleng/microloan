"use client";

import { useState } from 'react';
import { Checkbox, Empty } from '../ui';
import { OUTCOME_CLS, OUTCOME_LABELS, displayValue } from './types';
import type { CharacteristicResult, ScoreOutcome, ScoreResult } from './types';

export function OutcomeBadge({ outcome }: { outcome: ScoreOutcome | string | null | undefined }) {
    if (!outcome) return <span className="text-[#AAB7C4]">—</span>;
    const cls = OUTCOME_CLS[outcome as ScoreOutcome] ?? 'bg-slate-100 text-slate-600 border-slate-200';
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-bold tracking-wide whitespace-nowrap ${cls}`}>
            {OUTCOME_LABELS[outcome as ScoreOutcome] ?? outcome.replace(/_/g, ' ')}
        </span>
    );
}

export function GradePill({ grade, label }: { grade: string; label?: string }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center min-w-7 h-7 px-1.5 rounded bg-[#1A1F36] text-white text-[14px] font-bold">{grade}</span>
            {label && <span className="text-[12px] text-[#697386]">{label}</span>}
        </span>
    );
}

/** Points earned against the characteristic's maximum, with the reason the scorecard gave. */
export function FactorBars({ items }: { items: CharacteristicResult[] }) {
    const [showAll, setShowAll] = useState(false);
    const hidden = items.filter((c) => c.skipped || c.omitted).length;
    const list = showAll ? items : items.filter((c) => !c.skipped && !c.omitted);
    if (items.length === 0) return <Empty>No characteristics.</Empty>;
    return (
        <div className="space-y-2.5">
            {list.map((c) => {
                const pct = c.maxPoints > 0 ? Math.max(0, Math.min(100, (c.points / c.maxPoints) * 100)) : 0;
                const dim = c.skipped || c.omitted;
                return (
                    <div key={c.code} className={dim ? 'opacity-50' : ''}>
                        <div className="flex items-baseline justify-between gap-3">
                            <p className="text-[13px] font-semibold text-[#1A1F36]">
                                {c.label}
                                <span className="ml-1.5 font-mono text-[10px] font-normal text-[#8792A2]">{c.code}{c.group ? ` · ${c.group}` : ''}</span>
                                {c.missing && <span className="ml-1.5 text-[11px] font-normal text-amber-700">missing</span>}
                                {c.skipped && <span className="ml-1.5 text-[11px] font-normal text-[#697386]">skipped</span>}
                                {c.omitted && <span className="ml-1.5 text-[11px] font-normal text-[#697386]">omitted</span>}
                            </p>
                            <span className="text-[12px] tabular-nums text-[#3C4257] whitespace-nowrap">{c.points} / {c.maxPoints}</span>
                        </div>
                        <div className="mt-1 h-2 rounded bg-[#F0F2F5] overflow-hidden">
                            <div className={`h-full rounded ${pct >= 66 ? 'bg-emerald-500' : pct >= 33 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-0.5 text-[12px] text-[#697386]">
                            {c.reason || '—'}
                            <span className="ml-1.5 font-mono text-[10px] text-[#8792A2]">{c.variable} = {displayValue(c.value)}</span>
                        </p>
                    </div>
                );
            })}
            {hidden > 0 && <Checkbox checked={showAll} onChange={setShowAll} label={`Show ${hidden} skipped or omitted`} />}
        </div>
    );
}

export function AdverseReasons({ items }: { items: ScoreResult['adverseReasons'] }) {
    if (!items.length) return <p className="text-[13px] text-[#697386]">No adverse reasons.</p>;
    return (
        <ol className="space-y-1 list-decimal list-inside">
            {items.map((r) => (
                <li key={r.code} className="text-[13px] text-[#3C4257]">
                    {r.text}
                    <span className="ml-1.5 font-mono text-[10px] text-[#8792A2]">{r.code} · {r.characteristic} · −{r.shortfall}</span>
                </li>
            ))}
        </ol>
    );
}

/** Score, grade, factor bars and adverse reasons for one result. */
export function ScoreResultView({ result }: { result: ScoreResult }) {
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-6">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">Score</p>
                    <p className="text-[28px] font-bold text-[#1A1F36] tabular-nums leading-tight">{result.score}</p>
                    {result.rawScore !== result.score && <p className="text-[11px] text-[#697386]">raw {result.rawScore} (clamped)</p>}
                </div>
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">Grade</p>
                    <div className="mt-1"><GradePill grade={result.grade} label={result.gradeLabel} /></div>
                </div>
            </div>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">Factors</p>
                <FactorBars items={result.characteristics} />
            </div>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">Adverse reasons</p>
                <AdverseReasons items={result.adverseReasons} />
            </div>
        </div>
    );
}
