"use client";

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { learning } from '@microloan/shared';
import api from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import type { LessonProgress } from '@/lib/learning';
import { Spinner } from '@/components/lending/ui';
import { ProgressBar, StatusIcon, lessonStatus } from './LearnHome';

interface TeamReport {
    paths: { id: string; title: string; roles: string[]; lessonCount: number }[];
    members: {
        userId: string;
        email: string;
        roles: string[];
        lessonsStarted: number;
        lessonsCompleted: number;
        lastActivityAt: string | null;
        paths: { pathId: string; suggested: boolean; completed: number; total: number }[];
    }[];
}

/** /learn/team: every staff member's Learning centre progress (learning.report.read). */
export function TeamProgress() {
    const t = useTranslations('Learning.team');
    const tl = useTranslations('Learning');
    const { locale } = useParams<{ locale: string }>();
    const ws = useWorkspace();
    const allowed = ws.can('learning.report.read');
    const [report, setReport] = useState<TeamReport | null>(null);
    const [failed, setFailed] = useState(false);
    const [pathId, setPathId] = useState<string>('');
    const [openUser, setOpenUser] = useState<string | null>(null);
    const [detail, setDetail] = useState<Record<string, LessonProgress[]>>({});
    const [query, setQuery] = useState('');

    useEffect(() => {
        if (!allowed) return;
        let cancelled = false;
        api.get<TeamReport>('/lending/learning/team')
            .then((r) => { if (!cancelled) setReport(r.data); })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [allowed]);

    useEffect(() => {
        if (!openUser || detail[openUser]) return;
        let cancelled = false;
        api.get<{ lessons: LessonProgress[] }>(`/lending/learning/team/users/${openUser}`)
            .then((r) => { if (!cancelled) setDetail((d) => ({ ...d, [openUser]: r.data.lessons })); })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [openUser, detail]);

    const back = <Link href={`/${locale ?? 'en'}/learn`} className="text-[12px] font-semibold text-[#635BFF] hover:underline">← {tl('lesson.back')}</Link>;
    if (!ws.ready) return <Spinner label={tl('loading')} />;
    if (!allowed) return <div className="max-w-[1100px] mx-auto space-y-3">{back}<p className="bg-white border border-[#E3E8EE] rounded-lg p-6 text-[14px]">{t('noAccess')}</p></div>;
    if (failed) return <div className="max-w-[1100px] mx-auto space-y-3">{back}<p className="bg-white border border-[#E3E8EE] rounded-lg p-6 text-[14px]">{t('failed')}</p></div>;
    if (!report) return <Spinner label={tl('loading')} />;

    const members = report.members.filter((m) => !query || m.email.toLowerCase().includes(query.toLowerCase()));
    const pathCell = (m: TeamReport['members'][number]) => {
        const rows = pathId ? m.paths.filter((p) => p.pathId === pathId) : m.paths.filter((p) => p.suggested);
        if (!rows.length) return <span className="text-[12px] text-[#697386]">{t('noSuggested')}</span>;
        return (
            <div className="space-y-1.5 min-w-[160px]">
                {rows.map((p) => {
                    const title = learning.PATH_BY_ID[p.pathId]?.title ?? p.pathId;
                    return (
                        <div key={p.pathId}>
                            <div className="flex justify-between gap-2 text-[11.5px] text-[#697386]"><span className="truncate">{title}</span><span className="tabular-nums">{p.completed}/{p.total}</span></div>
                            <ProgressBar value={p.completed} total={p.total} label={`${title}: ${p.completed}/${p.total}`} />
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="max-w-[1100px] mx-auto space-y-5 pb-10">
            <div>
                {back}
                <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">{t('title')}</h1>
                <p className="text-[#697386] text-[14px] mt-0.5">{t('subtitle')}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
                <label className="text-[12px] font-semibold text-[#3C4257]">
                    {t('path')}
                    <select value={pathId} onChange={(e) => setPathId(e.target.value)} className="mt-1 block border border-[#E3E8EE] rounded px-2 py-1.5 text-[13px] bg-white">
                        <option value="">{t('suggestedPaths')}</option>
                        {report.paths.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                </label>
                <label className="text-[12px] font-semibold text-[#3C4257]">
                    {t('search')}
                    <input value={query} onChange={(e) => setQuery(e.target.value)} className="mt-1 block border border-[#E3E8EE] rounded px-2 py-1.5 text-[13px] bg-white" />
                </label>
            </div>
            <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-x-auto">
                <table className="w-full text-[13px]">
                    <thead className="bg-[#F6F8FA] text-left text-[11.5px] uppercase tracking-wide text-[#697386]">
                        <tr>
                            <th className="px-4 py-2 font-semibold">{t('member')}</th>
                            <th className="px-4 py-2 font-semibold">{t('roles')}</th>
                            <th className="px-4 py-2 font-semibold">{pathId ? learning.PATH_BY_ID[pathId]?.title : t('suggestedPaths')}</th>
                            <th className="px-4 py-2 font-semibold text-right">{t('completed')}</th>
                            <th className="px-4 py-2 font-semibold">{t('lastActivity')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {members.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[#697386]">{t('noMembers')}</td></tr>}
                        {members.map((m) => {
                            const open = openUser === m.userId;
                            return (
                                <Fragment key={m.userId}>
                                    <tr className="border-t border-[#E3E8EE] align-top">
                                        <td className="px-4 py-2.5">
                                            <button type="button" onClick={() => setOpenUser(open ? null : m.userId)} aria-expanded={open} className="inline-flex items-center gap-1 font-semibold text-[#1A1F36] hover:text-[#635BFF] text-left break-all">
                                                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {m.email}
                                            </button>
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] text-[#697386]">{m.roles.join(', ') || '—'}</td>
                                        <td className="px-4 py-2.5">{pathCell(m)}</td>
                                        <td className="px-4 py-2.5 text-right tabular-nums">{m.lessonsCompleted}</td>
                                        <td className="px-4 py-2.5 text-[12px] text-[#697386] whitespace-nowrap">{m.lastActivityAt ? m.lastActivityAt.slice(0, 10) : t('never')}</td>
                                    </tr>
                                    {open && (
                                        <tr className="bg-[#F6F8FA]">
                                            <td colSpan={5} className="px-6 py-3">
                                                {!detail[m.userId] ? <Spinner label={tl('loading')} /> : detail[m.userId].length === 0 ? (
                                                    <p className="text-[12.5px] text-[#697386]">{t('noLessons')}</p>
                                                ) : (
                                                    <ul className="grid gap-1.5 sm:grid-cols-2">
                                                        {detail[m.userId].map((l) => (
                                                            <li key={l.lessonId} className="flex items-center gap-2 text-[12.5px]">
                                                                <StatusIcon status={lessonStatus(l)} />
                                                                <span className="flex-1 min-w-0 truncate" lang="en">{learning.LESSON_BY_ID[l.lessonId]?.title ?? l.lessonId}</span>
                                                                <span className="text-[11.5px] text-[#697386] tabular-nums whitespace-nowrap">
                                                                    {l.quizBestScore !== null ? `${l.quizBestScore}/${l.quizTotal}` : '—'}
                                                                    {l.tourCompletedAt ? ` · ${tl('status.tourDone')}` : ''}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
