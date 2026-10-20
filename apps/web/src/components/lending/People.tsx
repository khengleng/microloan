"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';

/** A colleague as GET /me/people returns them (own organisation only). */
export interface PersonRef {
    id: string;
    email: string;
    active: boolean;
    branchId: string | null;
}

/*
 * Ids asked for in the same tick are fetched in one request, and each answer is
 * kept for the life of the page so a table of fifty rows costs one call. The
 * browser tab is the only holder; nothing is shared between users.
 */
const known = new Map<string, PersonRef | null>();
const waiting = new Map<string, ((p: PersonRef | null) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
    flushTimer = null;
    const ids = [...waiting.keys()];
    if (!ids.length) return;
    const batch = new Map(ids.map((id) => [id, waiting.get(id)!]));
    ids.forEach((id) => waiting.delete(id));
    for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        api.get<PersonRef[]>('/me/people', { params: { ids: chunk.join(',') } }).then(
            (r) => {
                const byId = new Map((r.data ?? []).map((p) => [p.id, p]));
                for (const id of chunk) {
                    const p = byId.get(id) ?? null;
                    known.set(id, p);
                    batch.get(id)?.forEach((cb) => cb(p));
                }
            },
            () => chunk.forEach((id) => batch.get(id)?.forEach((cb) => cb(null))),
        );
    }
}

const UUID = /^[0-9a-f-]{36}$/i;

function lookup(id: string): Promise<PersonRef | null> {
    if (known.has(id)) return Promise.resolve(known.get(id) ?? null);
    return new Promise((resolve) => {
        waiting.set(id, [...(waiting.get(id) ?? []), resolve]);
        if (!flushTimer) flushTimer = setTimeout(flush, 0);
    });
}

/** Resolve user ids to colleagues; unknown or non-user ids map to null. */
export function usePeople(ids: (string | null | undefined)[]): Map<string, PersonRef | null> {
    const wanted = [...new Set(ids.filter((i): i is string => !!i && UUID.test(i)))].sort();
    const key = wanted.join(',');
    const [map, setMap] = useState<Map<string, PersonRef | null>>(() => new Map(wanted.filter((i) => known.has(i)).map((i) => [i, known.get(i) ?? null])));
    useEffect(() => {
        let live = true;
        const list = key ? key.split(',') : [];
        Promise.all(list.map((id) => lookup(id).then((p) => [id, p] as const))).then((pairs) => {
            if (live) setMap(new Map(pairs));
        });
        return () => { live = false; };
    }, [key]);
    return map;
}

/**
 * Pick a colleague by typing part of their email; `value` is the user id.
 * Results come from GET /me/people?q= (active users of this organisation).
 */
export function UserPicker({ value, onChange, placeholder, className = '' }: {
    value: string; onChange: (id: string, person: PersonRef | null) => void; placeholder?: string; className?: string;
}) {
    const selected = usePeople([value]).get(value) ?? null;
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [results, setHits] = useState<PersonRef[]>([]);
    // Too short a query shows nothing; derived here rather than reset from the effect.
    const hits = q.trim().length < 2 ? [] : results;
    useEffect(() => {
        if (q.trim().length < 2) return;
        let live = true;
        const timer = setTimeout(() => {
            api.get<PersonRef[]>('/me/people', { params: { q: q.trim() } }).then(
                (r) => { if (live) setHits(r.data ?? []); },
                () => { if (live) setHits([]); },
            );
        }, 200);
        return () => { live = false; clearTimeout(timer); };
    }, [q]);
    const inputCls = 'w-full rounded border border-[#E3E8EE] bg-white px-2.5 py-1.5 text-[13px] text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/30 focus:border-[#635BFF]';
    return (
        <div className={`relative ${className}`}>
            <input
                className={inputCls}
                value={open ? q : selected?.email ?? (value ? value : '')}
                placeholder={placeholder}
                onFocus={() => { setOpen(true); setQ(''); }}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onChange={(e) => setQ(e.target.value)}
            />
            {open && hits.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-[#E3E8EE] bg-white shadow-lg">
                    {hits.map((p) => (
                        <li key={p.id}>
                            <button
                                type="button"
                                className="w-full px-2.5 py-1.5 text-left text-[13px] hover:bg-[#F7FAFC]"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { known.set(p.id, p); onChange(p.id, p); setOpen(false); }}
                            >
                                {p.email}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * A user shown by email instead of a bare id. Ids that are not users of this
 * organisation (system actors such as "system:period-close", or people this
 * screen cannot see) fall back to `fallback`, or a short form of the id.
 */
export function Person({ id, fallback, className = '' }: { id: string | null | undefined; fallback?: string; className?: string }) {
    const people = usePeople([id]);
    const t = useTranslations('LendingShared.people');
    if (!id) return <span className={`text-[#AAB7C4] ${className}`}>—</span>;
    const p = people.get(id);
    if (p) return <span className={className} title={p.active ? p.email : t('inactive', { email: p.email })}>{p.email}</span>;
    return <span className={`font-mono text-[12px] ${className}`} title={id}>{fallback ?? (UUID.test(id) ? id.slice(0, 8) : id)}</span>;
}
