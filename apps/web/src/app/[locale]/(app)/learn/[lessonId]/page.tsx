"use client";

import { Suspense, use } from 'react';
import { LessonView } from '@/components/learning/LessonView';

/** One lesson: objectives, explainer, "Try it" tour, manual link and quiz. */
export default function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
    const { lessonId } = use(params);
    return (
        <Suspense>
            <LessonView lessonId={lessonId} />
        </Suspense>
    );
}
