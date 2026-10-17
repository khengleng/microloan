"use client";

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import api from '@/lib/api';

interface SearchResult {
    type: string;
    id: string;
    title: string;
    subtitle: string;
    reference: string | null;
    status: string | null;
    href: string;
}

const TYPE_ORDER = ['BORROWER', 'LOAN', 'APPLICATION', 'FACILITY', 'CARD', 'RESTRUCTURE_CASE', 'LEGACY_LOAN', 'ORGANISATION', 'PLAN_PAYMENT'];
const DEBOUNCE_MS = 250;

/** True when the keystroke happened in a field, so "/" must not steal focus. */
function typingInField(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * One search for borrowers, loans, applications, facilities, cards and cases.
 * "/" or Ctrl/⌘-K focuses it; arrows move, Enter opens, Escape closes.
 * The API confines results to what the person may open.
 */
export function GlobalSearch({ platform = false }: { platform?: boolean }) {
    const t = useTranslations('Workspace.search');
    const { locale } = useParams();
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<{ query: string; results: SearchResult[]; failed?: boolean }>({ query: '', results: [] });
    const [active, setActive] = useState(0);
    const term = q.trim();
    const loading = term.length >= 2 && state.query !== term;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            if ((e.metaKey || e.ctrlKey) && k === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
                setOpen(true);
            } else if (e.key === '/' && !typingInField(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                inputRef.current?.focus();
                setOpen(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (term.length < 2) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            api.get<{ query: string; results: SearchResult[] }>(`/search?q=${encodeURIComponent(term)}`).then(
                (r) => { if (!cancelled) { setState({ query: term, results: r.data.results }); setActive(0); } },
                () => { if (!cancelled) setState({ query: term, results: [], failed: true }); },
            );
        }, DEBOUNCE_MS);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [term]);

    const results = useMemo(() => (term.length >= 2 && state.query === term ? state.results : []), [term, state]);
    const groups = useMemo(() => {
        const by = new Map<string, SearchResult[]>();
        for (const r of results) {
            if (!by.has(r.type)) by.set(r.type, []);
            by.get(r.type)!.push(r);
        }
        let i = 0;
        return [...by.entries()]
            .sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]))
            .map(([type, rs]) => ({ type, rows: rs.map((r) => ({ r, i: i++ })) }));
    }, [results]);
    const flat = useMemo(() => groups.flatMap((g) => g.rows.map((x) => x.r)), [groups]);

    const go = (r: SearchResult) => {
        setOpen(false);
        setQ('');
        inputRef.current?.blur();
        router.push(`/${locale}${r.href}`);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
        if (!flat.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % flat.length); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + flat.length) % flat.length); }
        else if (e.key === 'Enter') { e.preventDefault(); const r = flat[active]; if (r) go(r); }
    };

    const typeLabel = (type: string) => (t.has(`types.${type}`) ? t(`types.${type}`) : type);

    return (
        <div className="relative flex-1 min-w-0 max-w-xl">
            <label className="flex items-center gap-2 border border-border rounded px-2.5 py-1.5 bg-muted text-sm focus-within:ring-2 focus-within:ring-[#635BFF]/30 focus-within:border-[#635BFF]">
                <Search size={14} className="text-muted-foreground flex-shrink-0" aria-hidden />
                <span className="sr-only">{t('label')}</span>
                <input
                    ref={inputRef}
                    type="search"
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 150)}
                    onKeyDown={onKeyDown}
                    placeholder={platform ? t('placeholderPlatform') : t('placeholder')}
                    className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground"
                    role="combobox"
                    aria-expanded={open && term.length >= 2}
                    aria-controls="global-search-results"
                    aria-autocomplete="list"
                    maxLength={100}
                />
                {loading ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : (
                    <kbd className="hidden md:inline font-mono text-[10px] border border-border rounded px-1 bg-white text-muted-foreground">/</kbd>
                )}
            </label>
            {open && term.length >= 2 && (
                <div id="global-search-results" role="listbox" className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-border rounded-md shadow-lg max-h-[70vh] overflow-y-auto">
                    {loading && <p className="px-3 py-3 text-[13px] text-muted-foreground">{t('searching')}</p>}
                    {!loading && state.failed && <p className="px-3 py-3 text-[13px] text-red-700">{t('failed')}</p>}
                    {!loading && !state.failed && flat.length === 0 && <p className="px-3 py-3 text-[13px] text-muted-foreground">{t('none', { q: term })}</p>}
                    {!loading && groups.map(({ type, rows }) => (
                        <div key={type} className="py-1 border-b border-border last:border-0">
                            <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{typeLabel(type)}</p>
                            {rows.map(({ r, i }) => {
                                return (
                                    <Link
                                        key={`${r.type}:${r.id}`}
                                        href={`/${locale}${r.href}`}
                                        role="option"
                                        aria-selected={i === active}
                                        onMouseDown={(e) => { e.preventDefault(); go(r); }}
                                        onMouseEnter={() => setActive(i)}
                                        className={`flex items-center justify-between gap-3 px-3 py-1.5 text-[13px] ${i === active ? 'bg-[#F0F5FF]' : ''}`}
                                    >
                                        <span className="min-w-0">
                                            <span className="block font-semibold text-foreground truncate">{r.title}</span>
                                            {r.subtitle && <span className="block text-[12px] text-muted-foreground truncate">{r.subtitle}</span>}
                                        </span>
                                        {r.status && <span className="flex-shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{r.status}</span>}
                                    </Link>
                                );
                            })}
                        </div>
                    ))}
                    <p className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/50">{t('hint')}</p>
                </div>
            )}
        </div>
    );
}
