"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { learning } from '@microloan/shared';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** One row of GET /me/learning. */
export interface LessonProgress {
    lessonId: string;
    startedAt: string;
    tourCompletedAt: string | null;
    quizAttempts: number;
    quizBestScore: number | null;
    quizTotal: number | null;
    quizPassedAt: string | null;
    completedAt: string | null;
    promptDismissedAt: string | null;
    updatedAt: string;
}

export type LearningEvent =
    | { event: 'STARTED' }
    | { event: 'TOUR_COMPLETED' }
    | { event: 'QUIZ_SUBMITTED'; answers: number[] }
    | { event: 'PROMPT_DISMISSED' };

export interface QuizResult { score: number; total: number; passed: boolean }

interface LearningValue {
    /** Progress by lesson id; null until loaded (or for platform operators). */
    progress: Record<string, LessonProgress> | null;
    /** Staff of a lending organisation keep progress; platform operators do not. */
    enabled: boolean;
    record: (lessonId: string, e: LearningEvent) => Promise<{ progress: LessonProgress; quiz?: QuizResult } | null>;
    reload: () => void;
}

const LearningContext = createContext<LearningValue>({
    progress: null,
    enabled: false,
    record: async () => null,
    reload: () => undefined,
});

/**
 * The signed-in person's Learning centre progress, kept by the API
 * (GET/PUT /me/learning). Nothing is stored in the browser.
 */
export function LearningProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const enabled = !!user && !user.isPlatform && !!user.tenantId;
    const [progress, setProgress] = useState<Record<string, LessonProgress> | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        api.get<{ lessons: LessonProgress[] }>('/me/learning')
            .then((r) => { if (!cancelled) setProgress(Object.fromEntries(r.data.lessons.map((l) => [l.lessonId, l]))); })
            .catch(() => { if (!cancelled) setProgress({}); });
        return () => { cancelled = true; };
    }, [enabled, tick]);

    const record = useCallback(async (lessonId: string, e: LearningEvent) => {
        if (!enabled || !learning.LESSON_BY_ID[lessonId]) return null;
        const r = await api.put<{ progress: LessonProgress; quiz?: QuizResult }>(`/me/learning/lessons/${encodeURIComponent(lessonId)}`, e);
        setProgress((p) => ({ ...(p ?? {}), [lessonId]: r.data.progress }));
        return r.data;
    }, [enabled]);

    const reload = useCallback(() => setTick((n) => n + 1), []);
    const value = useMemo(() => ({ progress: enabled ? progress : null, enabled, record, reload }), [progress, enabled, record, reload]);
    return <LearningContext.Provider value={value}>{children}</LearningContext.Provider>;
}

export const useLearning = () => useContext(LearningContext);

/** Completed / total lessons of a path. */
export function pathProgress(path: learning.LearningPath, progress: Record<string, LessonProgress> | null) {
    const completed = path.lessonIds.filter((id) => progress?.[id]?.completedAt).length;
    const at = completed === path.lessonIds.length && completed > 0
        ? path.lessonIds.map((id) => progress?.[id]?.completedAt ?? '').sort().pop() ?? null
        : null;
    return { completed, total: path.lessonIds.length, completedAt: at };
}
