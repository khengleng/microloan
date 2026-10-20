"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, FileText, User } from 'lucide-react';
import { learning } from '@microloan/shared';

/**
 * A lesson's animated explainer: a short, self-running illustration drawn
 * with CSS and SVG from the lesson's data (no video). It steps through the
 * stages on its own and can be paused, stepped and replayed; with reduced
 * motion it does not autoplay or animate.
 */

const STAGE_MS = 4200;

function useReducedMotion() {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);
    return reduced;
}

export function Explainer({ explainer }: { explainer: learning.Explainer }) {
    const t = useTranslations('Learning.explainer');
    const reduced = useReducedMotion();
    const n = explainer.stages.length;
    const [stage, setStage] = useState(0);
    const [playing, setPlaying] = useState(true);
    const autoplay = playing && !reduced;

    useEffect(() => {
        if (!autoplay) return;
        if (stage >= n - 1) { const done = setTimeout(() => setPlaying(false), STAGE_MS); return () => clearTimeout(done); }
        const timer = setTimeout(() => setStage((s) => Math.min(s + 1, n - 1)), STAGE_MS);
        return () => clearTimeout(timer);
    }, [autoplay, stage, n]);

    const current = explainer.stages[stage];

    return (
        <figure className="rounded-lg border border-[#E3E8EE] bg-white overflow-hidden">
            <div className={`p-4 sm:p-6 bg-gradient-to-b from-[#F6F8FA] to-white`}>
                {explainer.kind === 'flow' && <FlowView stages={explainer.stages} stage={stage} reduced={reduced} />}
                {explainer.kind === 'handoff' && <HandoffView ex={explainer} stage={stage} reduced={reduced} />}
                {explainer.kind === 'ledger' && <LedgerView ex={explainer} stage={stage} reduced={reduced} t={t} />}
                {explainer.kind === 'ageing' && <AgeingView ex={explainer} stage={stage} reduced={reduced} />}
                {explainer.kind === 'points' && <PointsView ex={explainer} stage={stage} reduced={reduced} t={t} />}
                {explainer.kind === 'screen' && <ScreenView ex={explainer} stage={stage} reduced={reduced} t={t} />}
            </div>
            <figcaption className="border-t border-[#E3E8EE] px-4 py-3 sm:px-6">
                <div aria-live="polite" className="min-h-[3.5rem]">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#635BFF]">{t('stageOf', { stage: stage + 1, total: n })} · <span lang="en">{current.label}</span></p>
                    <p lang="en" className="mt-0.5 text-[14px] text-[#1A1F36]">{current.caption}</p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex gap-1.5" role="tablist" aria-label={t('stages')}>
                        {explainer.stages.map((s, i) => (
                            <button
                                key={i}
                                type="button"
                                role="tab"
                                aria-selected={i === stage}
                                aria-label={`${i + 1}. ${s.label}`}
                                onClick={() => { setStage(i); setPlaying(false); }}
                                className={`h-2 rounded-full transition-all ${i === stage ? 'w-6 bg-[#635BFF]' : i < stage ? 'w-2 bg-[#635BFF]/50' : 'w-2 bg-[#E3E8EE]'}`}
                            />
                        ))}
                    </div>
                    <div className="flex items-center gap-1">
                        <IconBtn label={t('previous')} disabled={stage === 0} onClick={() => { setStage((s) => Math.max(0, s - 1)); setPlaying(false); }}><ChevronLeft size={15} /></IconBtn>
                        {stage === n - 1 && !autoplay ? (
                            <IconBtn label={t('replay')} onClick={() => { setStage(0); setPlaying(!reduced); }}><RotateCcw size={14} /></IconBtn>
                        ) : (
                            <IconBtn label={autoplay ? t('pause') : t('play')} disabled={reduced} onClick={() => setPlaying((p) => !p)}>{autoplay ? <Pause size={14} /> : <Play size={14} />}</IconBtn>
                        )}
                        <IconBtn label={t('next')} disabled={stage === n - 1} onClick={() => { setStage((s) => Math.min(n - 1, s + 1)); setPlaying(false); }}><ChevronRight size={15} /></IconBtn>
                    </div>
                </div>
            </figcaption>
        </figure>
    );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
    return (
        <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
            className="w-8 h-8 inline-flex items-center justify-center rounded border border-[#E3E8EE] bg-white text-[#3C4257] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            {children}
        </button>
    );
}

const ease = (reduced: boolean, ms = 600) => (reduced ? 'none' : `all ${ms}ms cubic-bezier(.4,0,.2,1)`);

/** A token travelling along a chain of stages. */
function FlowView({ stages, stage, reduced }: { stages: learning.ExplainerStage[]; stage: number; reduced: boolean }) {
    const n = stages.length;
    const pct = n > 1 ? (stage / (n - 1)) * 100 : 0;
    return (
        <div>
            {/* Horizontal on wider screens */}
            <div className="hidden sm:block relative px-6 pt-2 pb-1">
                <div className="absolute left-10 right-10 top-[26px] h-1 rounded-full bg-[#E3E8EE]" />
                <div className="absolute left-10 top-[26px] h-1 rounded-full bg-[#635BFF]" style={{ width: `calc((100% - 5rem) * ${pct / 100})`, transition: ease(reduced) }} />
                <div className="relative flex justify-between">
                    {stages.map((s, i) => (
                        <div key={i} className="flex flex-col items-center w-20 text-center">
                            <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-[12px] font-bold ${i <= stage ? 'border-[#635BFF] bg-[#635BFF] text-white' : 'border-[#C1C9D2] bg-white text-[#697386]'}`}
                                style={{ transform: i === stage ? 'scale(1.18)' : 'scale(1)', transition: ease(reduced, 400), boxShadow: i === stage ? '0 0 0 6px rgba(99,91,255,.15)' : 'none' }}>
                                {i + 1}
                            </div>
                            <span lang="en" className={`mt-2 text-[11.5px] leading-tight ${i === stage ? 'font-bold text-[#1A1F36]' : 'text-[#697386]'}`}>{s.label}</span>
                        </div>
                    ))}
                </div>
            </div>
            {/* Vertical on phones */}
            <ol className="sm:hidden space-y-2">
                {stages.map((s, i) => (
                    <li key={i} className="flex items-center gap-3">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold ${i <= stage ? 'bg-[#635BFF] text-white' : 'bg-[#E3E8EE] text-[#697386]'}`} style={{ transition: ease(reduced, 400) }}>{i + 1}</span>
                        <span lang="en" className={`text-[13px] ${i === stage ? 'font-bold text-[#1A1F36]' : 'text-[#697386]'}`}>{s.label}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

/** A record passed between two people (maker → checker). */
function HandoffView({ ex, stage, reduced }: { ex: Extract<learning.Explainer, { kind: 'handoff' }>; stage: number; reduced: boolean }) {
    const s = ex.stages[stage];
    return (
        <div className="relative h-40 sm:h-36">
            {ex.actors.map((name, i) => (
                <div key={i} className={`absolute top-0 ${i === 0 ? 'left-0' : 'right-0'} w-24 sm:w-28 flex flex-col items-center text-center`}>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${s.actor === i ? 'bg-[#635BFF] text-white' : 'bg-[#E3E8EE] text-[#697386]'}`} style={{ transition: ease(reduced, 400), boxShadow: s.actor === i ? '0 0 0 6px rgba(99,91,255,.15)' : 'none' }}>
                        <User size={22} />
                    </div>
                    <span className="mt-1.5 text-[12px] font-semibold text-[#1A1F36] leading-tight">{name}</span>
                </div>
            ))}
            <div className="absolute top-3 h-0.5 left-24 right-24 sm:left-28 sm:right-28 border-t-2 border-dashed border-[#C1C9D2]" />
            <div
                className="absolute top-14 sm:top-12 w-36 sm:w-44 rounded-md border border-[#C1C9D2] bg-white shadow-md px-3 py-2"
                style={{ left: s.actor === 0 ? '0%' : 'calc(100% - 11rem)', transition: ease(reduced, 700) }}
            >
                <div className="flex items-center gap-1.5 text-[#635BFF]"><FileText size={14} /><span lang="en" className="text-[11px] font-bold uppercase tracking-wide">{s.label}</span></div>
                <div className="mt-1.5 space-y-1" aria-hidden="true">
                    <div className="h-1.5 rounded bg-[#E3E8EE] w-full" />
                    <div className="h-1.5 rounded bg-[#E3E8EE] w-3/4" />
                </div>
            </div>
        </div>
    );
}

const num = (a: string) => Number(a.replace(/[^0-9.-]/g, '')) || 0;

/** Journal entries appearing in T-accounts. */
function LedgerView({ ex, stage, reduced, t }: { ex: Extract<learning.Explainer, { kind: 'ledger' }>; stage: number; reduced: boolean; t: (k: string) => string }) {
    const accounts: string[] = [];
    for (const s of ex.stages) for (const e of s.entries) if (!accounts.includes(e.account)) accounts.push(e.account);
    const shown = ex.stages.slice(0, stage + 1).flatMap((s, si) => s.entries.map((e, ei) => ({ ...e, key: `${si}-${ei}`, fresh: si === stage })));
    const cur = ex.stages[stage].entries;
    const dr = cur.filter((e) => e.side === 'DR').reduce((a, e) => a + num(e.amount), 0);
    const cr = cur.filter((e) => e.side === 'CR').reduce((a, e) => a + num(e.amount), 0);
    return (
        <div>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {accounts.map((acc) => {
                    const lines = shown.filter((e) => e.account === acc);
                    const active = cur.some((e) => e.account === acc);
                    return (
                        <div key={acc} className={`rounded border bg-white ${active ? 'border-[#635BFF]' : 'border-[#E3E8EE]'}`} style={{ transition: ease(reduced, 300) }}>
                            <p className="px-2 py-1 text-[12px] font-bold text-center border-b border-[#E3E8EE] text-[#1A1F36]">{acc}</p>
                            <div className="grid grid-cols-2 min-h-[3.25rem] text-[12px] tabular-nums">
                                {(['DR', 'CR'] as const).map((side) => (
                                    <div key={side} className={`px-2 py-1 ${side === 'DR' ? 'border-r border-[#E3E8EE]' : 'text-right'}`}>
                                        <span className="block text-[10px] font-bold text-[#697386]">{side === 'DR' ? t('debit') : t('credit')}</span>
                                        {lines.filter((e) => e.side === side).map((e) => (
                                            <span key={e.key} className={`block ${e.fresh ? 'font-bold text-[#1A1F36]' : 'text-[#697386]'} ${e.fresh && !reduced ? 'animate-in fade-in slide-in-from-top-1 duration-500' : ''}`}>{e.amount}</span>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
            {cur.length > 0 && (
                <p className={`mt-3 text-[12px] font-semibold ${Math.abs(dr - cr) < 0.005 ? 'text-emerald-700' : 'text-amber-800'}`}>
                    {Math.abs(dr - cr) < 0.005 ? t('balanced') : t('unbalanced')}
                </p>
            )}
        </div>
    );
}

/** Days past due moving through ageing buckets. */
function AgeingView({ ex, stage, reduced }: { ex: Extract<learning.Explainer, { kind: 'ageing' }>; stage: number; reduced: boolean }) {
    const days = ex.stages[stage].days;
    const k = ex.buckets.length;
    const idx = Math.max(0, ex.buckets.findIndex((b) => days >= b.fromDays && (b.toDays === undefined || days <= b.toDays)));
    const b = ex.buckets[idx];
    const span = b.toDays === undefined ? Math.max(30, b.fromDays) : Math.max(1, b.toDays - b.fromDays + 1);
    const within = b.toDays === undefined ? Math.min(1, (days - b.fromDays) / span) : (days - b.fromDays) / span;
    const pos = ((idx + Math.min(0.95, Math.max(0.05, within))) / k) * 100;
    const colours = ['#1F9D55', '#B7791F', '#DD6B20', '#C53030', '#9B2C2C', '#742A2A'];
    return (
        <div className="pt-8">
            <div className="relative">
                <div className="flex h-10 rounded overflow-hidden border border-[#E3E8EE]">
                    {ex.buckets.map((bk, i) => (
                        <div key={i} className="flex-1 flex items-center justify-center text-[10.5px] sm:text-[11.5px] font-semibold text-white text-center px-1 leading-tight"
                            style={{ background: colours[Math.min(i, colours.length - 1)], opacity: i <= idx ? 1 : 0.35, transition: ease(reduced, 400) }}>
                            <span lang="en">{bk.label}</span>
                        </div>
                    ))}
                </div>
                <div className="absolute -top-8 flex flex-col items-center" style={{ left: `${pos}%`, transform: 'translateX(-50%)', transition: ease(reduced, 800) }}>
                    <span className="px-2 py-0.5 rounded bg-[#1A1F36] text-white text-[11px] font-bold tabular-nums whitespace-nowrap">DPD {days}</span>
                    <span className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[6px] border-t-[#1A1F36]" />
                </div>
            </div>
            <div className="mt-1 flex text-[10.5px] text-[#697386] tabular-nums">
                {ex.buckets.map((bk, i) => (
                    <span key={i} className="flex-1 text-center">{bk.toDays === undefined ? `${bk.fromDays}+` : `${bk.fromDays}–${bk.toDays}`}</span>
                ))}
            </div>
        </div>
    );
}

/** Scorecard points adding up to a score and a grade. */
function PointsView({ ex, stage, reduced, t }: { ex: Extract<learning.Explainer, { kind: 'points' }>; stage: number; reduced: boolean; t: (k: string) => string }) {
    const n = ex.stages.length;
    const reveal = Math.ceil(((stage + 1) / n) * ex.attributes.length);
    const shown = ex.attributes.slice(0, reveal);
    const total = shown.reduce((a, x) => a + x.points, 0);
    const final = ex.attributes.reduce((a, x) => a + x.points, 0);
    const grades = [...ex.grades].sort((a, b) => a.min - b.min);
    const grade = [...grades].reverse().find((g) => total >= g.min)?.grade ?? '—';
    const lo = Math.min(grades[0]?.min ?? 0, ex.attributes[0]?.points ?? 0);
    const hi = Math.max(final, (grades[grades.length - 1]?.min ?? final) + 100);
    const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / Math.max(1, hi - lo)) * 100))}%`;
    return (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <table className="w-full text-[12.5px]">
                <tbody>
                    {ex.attributes.map((a, i) => (
                        <tr key={i} className="border-b border-[#E3E8EE] last:border-0" style={{ opacity: i < reveal ? 1 : 0.25, transition: ease(reduced, 500) }}>
                            <td className="py-1 pr-2 text-[#1A1F36]">{a.name}</td>
                            <td className="py-1 pr-2 text-[#697386]">{a.value}</td>
                            <td className="py-1 text-right font-bold tabular-nums text-[#3F38D9]">{a.points >= 0 ? `+${a.points}` : a.points}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="flex flex-col items-center justify-center rounded-lg bg-white border border-[#E3E8EE] p-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#697386]">{t('score')}</span>
                <span className="text-3xl font-bold tabular-nums text-[#1A1F36]">{total}</span>
                <span className="mt-1 text-[12px] text-[#697386]">{t('grade')} <b className="text-[#635BFF] text-[15px]">{grade}</b></span>
                <div className="relative mt-3 w-full h-2 rounded-full bg-[#E3E8EE]">
                    {grades.map((g) => (
                        <span key={g.grade} className="absolute -top-4 text-[10px] text-[#697386]" style={{ left: at(g.min), transform: 'translateX(-50%)' }}>{g.grade}</span>
                    ))}
                    <span className="absolute top-1/2 w-3.5 h-3.5 rounded-full bg-[#635BFF] border-2 border-white shadow" style={{ left: at(total), transform: 'translate(-50%,-50%)', transition: ease(reduced, 700) }} />
                </div>
            </div>
        </div>
    );
}

/** A miniature of the portal with one area lit at a time. */
function ScreenView({ ex, stage, reduced, t }: { ex: Extract<learning.Explainer, { kind: 'screen' }>; stage: number; reduced: boolean; t: (k: string) => string }) {
    const area = ex.stages[stage].area;
    const lit = (a: string) => ({
        boxShadow: area === a ? '0 0 0 3px #635BFF, 0 0 0 8px rgba(99,91,255,.2)' : 'none',
        opacity: area === a ? 1 : 0.55,
        transition: ease(reduced, 400),
    });
    return (
        <div className="mx-auto max-w-xl rounded-md border border-[#C1C9D2] bg-[#F4F5F7] overflow-hidden shadow-sm" aria-hidden="true">
            <div className="flex h-48 sm:h-56">
                <div className="w-1/4 bg-[#253858] p-2 space-y-1.5 rounded-sm" style={lit('menu')}>
                    {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-2 rounded bg-white/30" style={{ width: `${60 + ((i * 13) % 35)}%` }} />)}
                </div>
                <div className="flex-1 flex flex-col">
                    <div className="h-9 bg-white border-b border-[#E3E8EE] flex items-center gap-2 px-2">
                        <div className="flex-1 h-5 rounded bg-[#F4F5F7] border border-[#E3E8EE] flex items-center px-1.5 text-[9px] text-[#697386]" style={lit('search')}>{t('miniSearch')}</div>
                        <div className="h-5 px-1.5 rounded text-[9px] font-bold flex items-center text-[#635BFF]" style={lit('help')}>?</div>
                        <div className="h-5 px-1.5 rounded border border-[#E3E8EE] bg-[#F4F5F7] text-[9px] font-bold flex items-center" style={lit('language')}>EN | KM</div>
                    </div>
                    <div className="flex-1 p-2 grid grid-cols-3 gap-1.5 content-start" style={lit('content')}>
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="h-12 rounded bg-white border border-[#E3E8EE] p-1.5" style={lit('queues')}>
                                <div className="h-1.5 w-3/4 rounded bg-[#C1C9D2]" />
                                <div className="mt-2 text-[12px] font-bold text-[#1A1F36]">{[3, 1, 7][i]}</div>
                            </div>
                        ))}
                        <div className="col-span-3 h-14 rounded bg-white border border-[#E3E8EE]" />
                    </div>
                </div>
            </div>
        </div>
    );
}
