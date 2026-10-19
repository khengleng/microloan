"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BookOpen, CheckCircle2, Compass, Target, XCircle } from 'lucide-react';
import { learning } from '@microloan/shared';
import { guideHref } from '@/lib/user-guide';
import { useLearning, type QuizResult } from '@/lib/learning';
import { Explainer } from './Explainer';
import { useTour } from './TourProvider';
import { StatusIcon, lessonStatus } from './LearnHome';

/** /learn/[lessonId]: objectives, animated explainer, "Try it" tour, manual link and quiz. */
export function LessonView({ lessonId }: { lessonId: string }) {
    const t = useTranslations('Learning');
    const { locale } = useParams<{ locale: string }>();
    const search = useSearchParams();
    const base = `/${locale ?? 'en'}`;
    const lesson = learning.LESSON_BY_ID[lessonId];
    const { progress, enabled, record } = useLearning();
    const { start } = useTour();
    const row = progress?.[lessonId];

    // Opening a lesson starts it (once; the API keeps the first start).
    useEffect(() => {
        if (lesson && enabled && progress && !progress[lessonId]) void record(lessonId, { event: 'STARTED' }).catch(() => undefined);
    }, [lesson, enabled, progress, lessonId, record]);

    if (!lesson) {
        return (
            <div className="max-w-[900px] mx-auto py-10 text-center">
                <p className="text-[#697386]">{t('lesson.notFound')}</p>
                <Link href={`${base}/learn`} className="text-[#635BFF] font-semibold hover:underline">{t('lesson.back')}</Link>
            </div>
        );
    }

    const pathId = search.get('path');
    const path = (pathId && learning.PATH_BY_ID[pathId]) || learning.LEARNING_PATHS.find((p) => p.lessonIds.includes(lessonId)) || null;
    const pos = path ? path.lessonIds.indexOf(lessonId) : -1;
    const nextId = path && pos >= 0 ? path.lessonIds[pos + 1] : undefined;
    const tour = lesson.tourId ? learning.TOUR_BY_ID[lesson.tourId] : undefined;

    return (
        <div className="max-w-[900px] mx-auto space-y-6 pb-12">
            <div>
                <Link href={`${base}/learn`} className="text-[12px] font-semibold text-[#635BFF] hover:underline">← {t('lesson.back')}</Link>
                {path && <p className="mt-1 text-[12px] text-[#697386]">{path.title} · {t('lesson.position', { n: pos + 1, total: path.lessonIds.length })}</p>}
                <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight flex items-center gap-2">
                    <StatusIcon status={lessonStatus(row)} /> {lesson.title}
                </h1>
                <p className="text-[#697386] text-[14px] mt-0.5">{lesson.summary} · {t('minutes', { minutes: lesson.minutes })}</p>
            </div>

            <section className="bg-white border border-[#E3E8EE] rounded-lg p-5">
                <h2 className="text-[15px] font-bold text-[#1A1F36] flex items-center gap-2"><Target size={16} className="text-[#635BFF]" /> {t('lesson.objectives')}</h2>
                <ul className="mt-2 space-y-1.5">
                    {lesson.objectives.map((o) => (
                        <li key={o} className="flex gap-2 text-[13.5px] text-[#3C4257]"><span className="text-[#635BFF]" aria-hidden="true">•</span>{o}</li>
                    ))}
                </ul>
            </section>

            <section className="space-y-2">
                <h2 className="text-[15px] font-bold text-[#1A1F36]">{t('lesson.explainer')}</h2>
                <Explainer explainer={lesson.explainer} />
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
                <div className="bg-white border border-[#E3E8EE] rounded-lg p-4 flex flex-col">
                    <h2 className="text-[15px] font-bold text-[#1A1F36] flex items-center gap-2"><Compass size={16} className="text-[#635BFF]" /> {t('lesson.tryIt')}</h2>
                    {tour ? (
                        <>
                            <p className="mt-1 text-[13px] text-[#3C4257] flex-1">{tour.summary}</p>
                            {tour.demoAccount && <p className="mt-2 text-[12px] text-[#697386]">{t('lesson.practise', { account: tour.demoAccount })}</p>}
                            <div className="mt-3 flex items-center gap-3">
                                <button type="button" onClick={() => start(tour.id)} className="px-3 py-1.5 text-[13px] font-semibold rounded bg-[#635BFF] text-white hover:bg-[#5249e6]">
                                    {t('lesson.startTour')}
                                </button>
                                {row?.tourCompletedAt && <span className="text-[12px] font-semibold text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={13} /> {t('status.tourDone')}</span>}
                            </div>
                        </>
                    ) : (
                        <p className="mt-1 text-[13px] text-[#697386]">{t('lesson.noTour')}</p>
                    )}
                </div>
                <div className="bg-white border border-[#E3E8EE] rounded-lg p-4 flex flex-col">
                    <h2 className="text-[15px] font-bold text-[#1A1F36] flex items-center gap-2"><BookOpen size={16} className="text-[#635BFF]" /> {t('lesson.manual')}</h2>
                    <p className="mt-1 text-[13px] text-[#3C4257] flex-1">{t('lesson.manualHelp')}</p>
                    <Link href={guideHref(locale ?? 'en', lesson.guide)} target="_blank" rel="noopener" className="mt-3 self-start px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white text-[#3C4257] hover:bg-slate-50">
                        {t('lesson.openManual')}
                    </Link>
                </div>
            </section>

            <Quiz lesson={lesson} best={row?.quizBestScore ?? null} attempts={row?.quizAttempts ?? 0} />

            <nav className="flex items-center justify-between gap-3">
                <Link href={`${base}/learn`} className="text-[13px] font-semibold text-[#635BFF] hover:underline">← {t('lesson.back')}</Link>
                {nextId && (
                    <Link href={`${base}/learn/${nextId}?path=${path!.id}`} className="px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white text-[#3C4257] hover:bg-slate-50">
                        {t('lesson.next')}: {learning.LESSON_BY_ID[nextId].title} →
                    </Link>
                )}
            </nav>
        </div>
    );
}

function Quiz({ lesson, best, attempts }: { lesson: learning.Lesson; best: number | null; attempts: number }) {
    const t = useTranslations('Learning.quiz');
    const { enabled, record } = useLearning();
    const qs = lesson.quiz.questions;
    const [answers, setAnswers] = useState<(number | null)[]>(() => qs.map(() => null));
    const [result, setResult] = useState<QuizResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const complete = answers.every((a) => a !== null);

    const submit = async () => {
        if (!complete) return;
        setBusy(true);
        setError(false);
        const chosen = answers as number[];
        try {
            const r = enabled ? (await record(lesson.id, { event: 'QUIZ_SUBMITTED', answers: chosen }))?.quiz ?? null : learning.gradeQuiz(lesson.id, chosen);
            setResult(r);
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    };
    const retry = () => { setResult(null); setAnswers(qs.map(() => null)); };

    return (
        <section className="bg-white border border-[#E3E8EE] rounded-lg p-5" aria-labelledby="quiz-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="quiz-title" className="text-[15px] font-bold text-[#1A1F36]">{t('title')}</h2>
                <p className="text-[12px] text-[#697386]">
                    {t('passMark', { passMark: lesson.quiz.passMark, total: qs.length })}
                    {best !== null && <> · {t('best', { score: best, total: qs.length })}</>}
                    {attempts > 0 && <> · {t('attempts', { count: attempts })}</>}
                </p>
            </div>
            <ol className="mt-4 space-y-5">
                {qs.map((q, qi) => {
                    const chosen = answers[qi];
                    const right = result ? chosen === q.answer : null;
                    return (
                        <li key={q.id}>
                            <fieldset disabled={!!result || busy}>
                                <legend className="text-[14px] font-semibold text-[#1A1F36]">{qi + 1}. {q.prompt}</legend>
                                <div className="mt-2 grid gap-1.5">
                                    {q.options.map((o, oi) => {
                                        const isAnswer = !!result && oi === q.answer;
                                        const isWrongPick = !!result && oi === chosen && oi !== q.answer;
                                        return (
                                            <label key={oi} className={`flex items-start gap-2 rounded border px-3 py-2 text-[13.5px] cursor-pointer motion-safe:transition-colors ${isAnswer ? 'border-emerald-300 bg-emerald-50' : isWrongPick ? 'border-red-300 bg-red-50' : chosen === oi ? 'border-[#635BFF] bg-[#F0F5FF]' : 'border-[#E3E8EE] hover:bg-[#F6F8FA]'}`}>
                                                <input
                                                    type="radio"
                                                    name={`q-${q.id}`}
                                                    className="mt-0.5 accent-[#635BFF]"
                                                    checked={chosen === oi}
                                                    onChange={() => setAnswers((a) => a.map((x, i) => (i === qi ? oi : x)))}
                                                />
                                                <span>{o}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                                {result && (
                                    <p className={`mt-2 text-[13px] flex gap-1.5 motion-safe:animate-in motion-safe:fade-in ${right ? 'text-emerald-800' : 'text-red-800'}`}>
                                        {right ? <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" /> : <XCircle size={15} className="mt-0.5 flex-shrink-0" />}
                                        <span><b>{right ? t('correct') : t('incorrect')}.</b> {q.explanation}</span>
                                    </p>
                                )}
                            </fieldset>
                        </li>
                    );
                })}
            </ol>
            <div className="mt-5 flex flex-wrap items-center gap-3" aria-live="polite">
                {!result ? (
                    <>
                        <button type="button" onClick={submit} disabled={!complete || busy} className="px-4 py-2 text-[13px] font-semibold rounded bg-[#635BFF] text-white hover:bg-[#5249e6] disabled:opacity-50 disabled:cursor-not-allowed">
                            {busy ? t('submitting') : t('submit')}
                        </button>
                        {!complete && <span className="text-[12px] text-[#697386]">{t('answerAll')}</span>}
                        {error && <span className="text-[12px] text-red-700">{t('error')}</span>}
                    </>
                ) : (
                    <>
                        <p className={`text-[14px] font-semibold ${result.passed ? 'text-emerald-800' : 'text-amber-900'}`}>
                            {t('score', { score: result.score, total: result.total })} {result.passed ? t('passed') : t('failed', { passMark: lesson.quiz.passMark })}
                        </p>
                        <button type="button" onClick={retry} className="px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white hover:bg-slate-50">{t('retry')}</button>
                    </>
                )}
            </div>
        </section>
    );
}
