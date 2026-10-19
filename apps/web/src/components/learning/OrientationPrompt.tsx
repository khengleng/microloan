"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Compass, X } from 'lucide-react';
import { learning } from '@microloan/shared';
import { useLearning } from '@/lib/learning';
import { useTour } from './TourProvider';

/**
 * First sign-in: offers the portal orientation tour until the person starts
 * it, finishes it or says "Not now". The dismissal is kept by the API on the
 * orientation lesson's progress row, so it follows the person across devices.
 */
export function OrientationPrompt() {
    const t = useTranslations('Learning.prompt');
    const { locale } = useParams<{ locale: string }>();
    const { progress, enabled, record } = useLearning();
    const { start, activeTourId } = useTour();
    const [hidden, setHidden] = useState(false);
    const id = learning.ORIENTATION_LESSON_ID;
    const row = progress?.[id];
    if (!enabled || !progress || hidden || activeTourId) return null;
    if (row?.promptDismissedAt || row?.tourCompletedAt) return null;
    const lesson = learning.LESSON_BY_ID[id];
    if (!lesson?.tourId) return null;

    const dismiss = () => {
        setHidden(true);
        void record(id, { event: 'PROMPT_DISMISSED' }).catch(() => undefined);
    };

    return (
        <aside
            role="dialog"
            aria-labelledby="orientation-title"
            className="fixed z-[60] bottom-4 right-4 left-4 sm:left-auto sm:w-[360px] rounded-lg border border-[#E3E8EE] bg-white shadow-2xl p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-500"
        >
            <div className="flex items-start gap-3">
                <span className="mt-0.5 w-9 h-9 rounded-full bg-[#F0F5FF] text-[#635BFF] flex items-center justify-center flex-shrink-0" aria-hidden="true">
                    <Compass size={18} />
                </span>
                <div className="min-w-0 flex-1">
                    <h2 id="orientation-title" className="text-[15px] font-bold text-[#1A1F36]">{t('title')}</h2>
                    <p className="mt-1 text-[13px] text-[#3C4257]">{t('body')}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => { dismiss(); start(lesson.tourId!); }}
                            className="px-3 py-1.5 text-[13px] font-semibold rounded bg-[#635BFF] text-white hover:bg-[#5249e6]"
                        >
                            {t('start')}
                        </button>
                        <button type="button" onClick={dismiss} className="px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white hover:bg-slate-50">
                            {t('later')}
                        </button>
                        <Link href={`/${locale ?? 'en'}/learn`} onClick={dismiss} className="text-[12px] font-semibold text-[#635BFF] hover:underline">
                            {t('learn')}
                        </Link>
                    </div>
                </div>
                <button type="button" onClick={dismiss} aria-label={t('later')} className="text-[#697386] hover:text-[#1A1F36] p-1 -mt-1 -mr-1">
                    <X size={15} />
                </button>
            </div>
        </aside>
    );
}
