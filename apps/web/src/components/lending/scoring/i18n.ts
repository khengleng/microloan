"use client";

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { usePeople as useSharedPeople } from '../People';
import { OUTCOME_LABELS, SOURCE_LABELS } from './types';
import type { ScoreOutcome } from './types';

/**
 * Translations for the scoring screens (messages namespace "Scoring"), with
 * the code-to-label helpers they share. A code the messages do not know
 * falls back to the English label, then to the code itself.
 */
export function useScoringText() {
    const t = useTranslations('Scoring');
    return useMemo(() => {
        const pick = (group: string, code: string, fallback?: string) =>
            t.has(`${group}.${code}`) ? t(`${group}.${code}`) : fallback ?? code.replace(/_/g, ' ').toLowerCase();
        return {
            t,
            source: (s: string) => pick('source', s, SOURCE_LABELS[s]),
            outcome: (o: string) => pick('outcome', o, OUTCOME_LABELS[o as ScoreOutcome]),
            kind: (k: string) => pick('kind', k),
            method: (m: string) => pick('method', m),
            version: (v: number) => (v === 0 ? t('common.template') : `v${v}`),
        };
    }, [t]);
}

/**
 * Who each staff id is, by email, from the shared colleague lookup
 * (GET /me/people, own organisation only). Until the answer arrives, or for
 * an id that is not a user, the first 8 characters of the id show.
 */
export function usePeople(ids: (string | null | undefined)[]) {
    const map = useSharedPeople(ids);
    return (id: string | null | undefined): string => (id ? map.get(id)?.email ?? id.slice(0, 8) : '—');
}
