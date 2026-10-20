"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Award, CheckCircle2, ChevronRight, Circle, CircleDot, Compass, Users } from 'lucide-react';
import { learning } from '@microloan/shared';
import { useWorkspace } from '@/lib/workspace';
import { pathProgress, useLearning, type LessonProgress } from '@/lib/learning';
import { Notice, Spinner } from '@/components/lending/ui';
import { useTour } from './TourProvider';

export function lessonStatus(p: LessonProgress | undefined): 'notStarted' | 'inProgress' | 'completed' {
    if (p?.completedAt) return 'completed';
    return p ? 'inProgress' : 'notStarted';
}

export function StatusIcon({ status }: { status: ReturnType<typeof lessonStatus> }) {
    if (status === 'completed') return <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />;
    if (status === 'inProgress') return <CircleDot size={16} className="text-[#635BFF] flex-shrink-0" aria-hidden="true" />;
    return <Circle size={16} className="text-[#C1C9D2] flex-shrink-0" aria-hidden="true" />;
}

export function ProgressBar({ value, total, label }: { value: number; total: number; label: string }) {
    const pct = total ? Math.round((value / total) * 100) : 0;
    return (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-label={label} className="h-2 rounded-full bg-[#E3E8EE] overflow-hidden">
            <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-[#635BFF]'} motion-safe:transition-[width] motion-safe:duration-700`} style={{ width: `${pct}%` }} />
        </div>
    );
}

/** /learn: role-based learning paths with progress, badges and certificates. */
export function LearnHome() {
    const t = useTranslations('Learning');
    const { locale } = useParams<{ locale: string }>();
    const base = `/${locale ?? 'en'}`;
    const ws = useWorkspace();
    const { progress, enabled } = useLearning();
    const { start } = useTour();

    if (!ws.ready || (enabled && !progress)) return <Spinner label={t('loading')} />;

    const roleCodes = ws.access?.roles.map((r) => r.code) ?? [];
    const mine = learning.pathsForRoles(roleCodes);
    const suggested = mine.length < learning.LEARNING_PATHS.length ? mine : [];
    const others = learning.LEARNING_PATHS.filter((p) => !suggested.includes(p));
    const done = Object.values(progress ?? {}).filter((p) => p.completedAt).length;
    const badges = learning.LEARNING_PATHS.filter((p) => pathProgress(p, progress).completedAt);
    const orientation = learning.LESSON_BY_ID[learning.ORIENTATION_LESSON_ID];

    return (
        <div className="max-w-[1100px] mx-auto space-y-6 pb-10">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">{t('title')}</h1>
                    <p className="text-[#697386] text-[14px] mt-0.5">{t('subtitle')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {orientation?.tourId && (
                        <button type="button" onClick={() => start(orientation.tourId!)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white text-[#3C4257] hover:bg-slate-50">
                            <Compass size={14} /> {t('orientationTour')}
                        </button>
                    )}
                    {ws.can('learning.report.read') && (
                        <Link href={`${base}/learn/team`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded bg-[#635BFF] text-white hover:bg-[#5249e6]">
                            <Users size={14} /> {t('team.title')}
                        </Link>
                    )}
                </div>
            </header>
            {locale !== 'en' && <Notice>{t('englishNote')}</Notice>}

            {!enabled && <p className="text-[13px] rounded border border-amber-200 bg-amber-50 text-amber-900 px-4 py-2">{t('platformNote')}</p>}

            {enabled && (
                <section className="grid gap-3 sm:grid-cols-3">
                    <Stat label={t('stats.completed')} value={String(done)} />
                    <Stat label={t('stats.lessons')} value={String(learning.LESSONS.length)} />
                    <Stat label={t('stats.badges')} value={String(badges.length)} />
                </section>
            )}

            {badges.length > 0 && (
                <section aria-labelledby="badges" className="bg-white border border-[#E3E8EE] rounded-lg p-4">
                    <h2 id="badges" className="text-[15px] font-bold text-[#1A1F36]">{t('badges')}</h2>
                    <ul className="mt-3 flex flex-wrap gap-3">
                        {badges.map((p) => (
                            <li key={p.id}>
                                <Link href={`${base}/learn/certificate/${p.id}`} className="group flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 pl-1.5 pr-3 py-1 text-[13px] font-semibold text-emerald-900 hover:bg-emerald-100">
                                    <span className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center motion-safe:group-hover:rotate-12 motion-safe:transition-transform"><Award size={15} /></span>
                                    <span lang="en">{p.title}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {suggested.length > 0 && <PathGroup title={t('yourPaths')} paths={suggested} progress={progress} base={base} open />}
            <PathGroup title={suggested.length ? t('otherPaths') : t('allPaths')} paths={others} progress={progress} base={base} open={!suggested.length} />

        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-white border border-[#E3E8EE] rounded-lg px-4 py-3">
            <p className="text-[12px] text-[#697386]">{label}</p>
            <p className="text-2xl font-bold tabular-nums text-[#1A1F36]">{value}</p>
        </div>
    );
}

function PathGroup({ title, paths, progress, base, open }: {
    title: string; paths: readonly learning.LearningPath[]; progress: Record<string, LessonProgress> | null; base: string; open: boolean;
}) {
    const t = useTranslations('Learning');
    return (
        <section className="space-y-3">
            <h2 className="text-[16px] font-bold text-[#1A1F36]">{title}</h2>
            <div className="grid gap-3 md:grid-cols-2">
                {paths.map((p) => {
                    const pp = pathProgress(p, progress);
                    return (
                        <details key={p.id} open={open} className="group bg-white border border-[#E3E8EE] rounded-lg shadow-sm">
                            <summary className="cursor-pointer list-none px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="text-[15px] font-bold text-[#1A1F36] flex items-center gap-2">
                                            <span lang="en">{p.title}</span>
                                            {pp.completedAt && <Award size={15} className="text-emerald-600" aria-label={t('status.completed')} />}
                                        </h3>
                                        <p lang="en" className="text-[12.5px] text-[#697386]">{p.summary}</p>
                                    </div>
                                    <ChevronRight size={16} className="mt-1 text-[#697386] motion-safe:transition-transform group-open:rotate-90 flex-shrink-0" aria-hidden="true" />
                                </div>
                                <div className="mt-2.5">
                                    <ProgressBar value={pp.completed} total={pp.total} label={t('lessonsDone', { done: pp.completed, total: pp.total })} />
                                    <p className="mt-1 text-[11.5px] text-[#697386]">{t('lessonsDone', { done: pp.completed, total: pp.total })}</p>
                                </div>
                            </summary>
                            <ol className="border-t border-[#E3E8EE]">
                                {p.lessonIds.map((id, i) => {
                                    const l = learning.LESSON_BY_ID[id];
                                    const st = lessonStatus(progress?.[id]);
                                    return (
                                        <li key={id} className="border-b border-[#E3E8EE] last:border-0">
                                            <Link href={`${base}/learn/${id}?path=${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#F6F8FA]">
                                                <StatusIcon status={st} />
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-[13.5px] font-semibold text-[#1A1F36] truncate">{i + 1}. <span lang="en">{l.title}</span></span>
                                                    <span lang="en" className="block text-[12px] text-[#697386] truncate">{l.summary}</span>
                                                </span>
                                                <span className="text-[11.5px] text-[#697386] whitespace-nowrap">{t('minutes', { minutes: l.minutes })}</span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ol>
                            {pp.completedAt && (
                                <div className="px-4 py-2.5 border-t border-[#E3E8EE]">
                                    <Link href={`${base}/learn/certificate/${p.id}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700 hover:underline">
                                        <Award size={14} /> {t('certificate.view')}
                                    </Link>
                                </div>
                            )}
                        </details>
                    );
                })}
            </div>
        </section>
    );
}
