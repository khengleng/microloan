"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Btn, SelectInput, TextInput } from '../ui';
import { qs, useApi } from '../useAsync';
import { fullName } from '../format';
import type { BorrowerLite, BorrowersPage } from './types';

/**
 * Resolve borrower ids to display names via the legacy GET /borrowers/:id.
 * Ids the caller cannot read (other branch, deleted) fall back to a short id.
 */
export function useBorrowerNames(ids: string[]) {
    const key = [...new Set(ids)].sort().join(',');
    const [names, setNames] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!key) return;
        let cancelled = false;
        const list = key.split(',');
        Promise.allSettled(list.map((id) => api.get<BorrowerLite>(`/borrowers/${id}`))).then((results) => {
            if (cancelled) return;
            const next: Record<string, string> = {};
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') next[list[i]] = fullName(r.value.data);
            });
            setNames((prev) => ({ ...prev, ...next }));
        });
        return () => { cancelled = true; };
    }, [key]);

    return (id: string) => names[id] ?? shortId(id);
}

export function shortId(id: string | null | undefined): string {
    if (!id) return '—';
    return `${id.slice(0, 8)}…`;
}

/** Search the borrower register and pick one. */
export function BorrowerPicker({ value, onChange, exclude = [] }: {
    value: string; onChange: (id: string) => void; exclude?: string[];
}) {
    const t = useTranslations('LendingGroups');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const { data, error, loading } = useApi<BorrowersPage>(`/borrowers${qs({ search: query, page: 1, limit: 50 })}`);
    const skip = new Set(exclude);
    const options = (data?.data ?? [])
        .filter((b) => !skip.has(b.id))
        .map((b) => ({ value: b.id, label: `${fullName(b)}${b.phone ? ` · ${b.phone}` : ''}` }));

    return (
        <div className="space-y-1.5">
            <div className="flex gap-2">
                <TextInput
                    value={search}
                    onChange={setSearch}
                    placeholder={t('picker.searchPlaceholder')}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setQuery(search.trim()); } }}
                />
                <Btn size="sm" onClick={() => setQuery(search.trim())} busy={loading}>{t('common.search')}</Btn>
            </div>
            <SelectInput
                value={value}
                onChange={onChange}
                options={options}
                placeholder={loading ? t('picker.loading') : options.length ? t('picker.select') : t('picker.none')}
            />
            {error && <span className="block text-[11px] text-red-600">{error.message}</span>}
        </div>
    );
}
