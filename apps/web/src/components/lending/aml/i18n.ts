"use client";

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { usePeople as useSharedPeople } from '../People';

/** Translations for the AML/CFT screens (messages namespace "Aml"). */
export function useAmlText() {
    const t = useTranslations('Aml');
    return useMemo(() => {
        const pick = (group: string, code: string) =>
            t.has(`${group}.${code}`) ? t(`${group}.${code}`) : code.replace(/_/g, ' ').toLowerCase();
        return {
            t,
            indicator: (c: string) => pick('indicators', c),
            factor: (c: string) => pick('factors', c),
            trigger: (c: string) => pick('triggers', c),
        };
    }, [t]);
}

/** Who each staff id is (own organisation only); the id's start until known. */
export function usePeople(ids: (string | null | undefined)[]) {
    const map = useSharedPeople(ids);
    return (id: string | null | undefined): string =>
        id ? map.get(id)?.email ?? (id.startsWith('system:') ? id.slice(7) : id.slice(0, 8)) : '—';
}
