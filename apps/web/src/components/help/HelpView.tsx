"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Notice, Spinner } from '@/components/lending/ui';
import type { GuideSection } from '@/lib/user-guide-types';
import type { GuideNavChapter, GuidePageProps } from './guide-data';

const MIN_QUERY = 2;
const MAX_RESULTS = 60;
const SNIPPET = 150;

const label = (c: GuideNavChapter) => (c.number ? `${c.number} · ${c.title}` : c.title);

function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function Highlight({ text, terms }: { text: string; terms: string[] }): ReactNode {
    if (!terms.length) return text;
    const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig');
    return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i} className="bg-[#FFF3C4] text-inherit rounded-sm">{part}</mark> : part));
}

function snippet(text: string, term: string): string {
    const at = text.toLowerCase().indexOf(term);
    if (at < 0) return text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text;
    const start = Math.max(0, at - 50);
    const end = Math.min(text.length, start + SNIPPET);
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** The in-app user guide: contents, search, one chapter and previous / next. */
export function HelpView({ locale, slug, guideTitle, title, html, groups, headings, prev, next }: GuidePageProps) {
    const t = useTranslations('Help');
    const router = useRouter();
    const base = `/${locale}/help`;
    const hrefFor = (s: string, id?: string) => `${s ? `${base}/${s}` : base}${id ? `#${id}` : ''}`;

    const [query, setQuery] = useState('');
    const [sections, setSections] = useState<readonly GuideSection[] | null>(null);
    const [tocOpen, setTocOpen] = useState(false);
    const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
    const searching = query.trim().length >= MIN_QUERY;

    // The full text is loaded only when someone searches.
    useEffect(() => {
        if (!searching || sections) return;
        let live = true;
        import('@/generated/user-guide-search').then((m) => { if (live) setSections(m.GUIDE_SECTIONS); });
        return () => { live = false; };
    }, [searching, sections]);

    const titles = useMemo(() => {
        const m = new Map<string, string>([['', guideTitle]]);
        for (const g of groups) for (const c of g.chapters) m.set(c.slug, label(c));
        return m;
    }, [groups, guideTitle]);

    const results = useMemo(() => {
        if (!searching || !sections) return [];
        const hits: { s: GuideSection; score: number }[] = [];
        for (const s of sections) {
            const title = s.title.toLowerCase();
            const hay = `${title} ${s.text.toLowerCase()} ${(titles.get(s.slug) ?? '').toLowerCase()}`;
            if (!terms.every((term) => hay.includes(term))) continue;
            hits.push({ s, score: terms.filter((term) => title.includes(term)).length });
        }
        return hits.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS).map((h) => h.s);
    }, [searching, sections, terms, titles]);

    /** Chapter links inside the guide navigate in-app instead of reloading the page. */
    const onArticleClick = (e: MouseEvent<HTMLElement>) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = (e.target as HTMLElement).closest('a');
        const href = a?.getAttribute('href');
        if (!a || !href || a.target === '_blank') return;
        if (href === base || href.startsWith(`${base}/`) || href.startsWith(`${base}#`)) {
            e.preventDefault();
            router.push(href);
        }
    };

    const toc = (
        <nav aria-label={t('contents')} className="space-y-3">
            <Link href={base} className={`flex items-center gap-2 px-2 py-1.5 rounded text-[13px] font-semibold ${slug === '' ? 'bg-[#F0F5FF] text-[#635BFF]' : 'text-[#1A1F36] hover:bg-[#F6F8FA]'}`}>
                <BookOpen size={14} /> {t('contents')}
            </Link>
            {groups.map((g) => (
                <div key={g.title}>
                    <p className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-[#8792A2]">{g.title}</p>
                    <ul className="space-y-0.5">
                        {g.chapters.map((c) => {
                            const active = c.slug === slug;
                            return (
                                <li key={c.slug}>
                                    <Link
                                        href={hrefFor(c.slug)}
                                        onClick={() => setTocOpen(false)}
                                        aria-current={active ? 'page' : undefined}
                                        className={`block px-2 py-1 rounded text-[13px] leading-snug ${active ? 'bg-[#F0F5FF] text-[#635BFF] font-semibold' : 'text-[#3C4257] hover:bg-[#F6F8FA] hover:text-[#1A1F36]'}`}
                                    >
                                        {label(c)}
                                    </Link>
                                    {active && headings.length > 0 && (
                                        <ul className="mt-1 mb-2 ml-2 border-l border-[#E3E8EE] space-y-0.5">
                                            {headings.filter((h) => h.depth === 2).map((h) => (
                                                <li key={h.id}>
                                                    <a href={`#${h.id}`} onClick={() => setTocOpen(false)} className="block pl-3 pr-1 py-0.5 text-[12px] text-[#697386] hover:text-[#635BFF] leading-snug">
                                                        {h.text}
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </nav>
    );

    const searchResults = (
        <div aria-live="polite" className="space-y-2">
            {!sections ? (
                <Spinner label={t('searching')} />
            ) : results.length === 0 ? (
                <p className="px-2 py-4 text-[13px] text-[#697386]">{t('noResults', { query: query.trim() })}</p>
            ) : (
                <>
                    <p className="px-2 text-[11px] font-semibold text-[#8792A2]">{t('results', { count: results.length })}</p>
                    <ul className="space-y-1">
                        {results.map((s) => (
                            <li key={`${s.slug}#${s.id}`}>
                                <Link href={hrefFor(s.slug, s.id)} onClick={() => setTocOpen(false)} className="block rounded px-2 py-1.5 hover:bg-[#F6F8FA]">
                                    <span className="block text-[11px] text-[#8792A2] truncate">{titles.get(s.slug) ?? s.slug}</span>
                                    <span className="block text-[13px] font-semibold text-[#1A1F36] leading-snug"><Highlight text={s.title} terms={terms} /></span>
                                    {s.text && <span className="block text-[12px] text-[#697386] leading-snug mt-0.5"><Highlight text={snippet(s.text, terms[0] ?? '')} terms={terms} /></span>}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );

    return (
        <div className="max-w-[1280px] mx-auto pb-10 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)] items-start">
            <aside className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm p-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
                <div className="relative mb-3">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8792A2]" aria-hidden="true" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                        aria-label={t('searchLabel')}
                        className="w-full rounded-md border border-[#E3E8EE] bg-white pl-8 pr-8 py-1.5 text-[13px] text-[#1A1F36] outline-none focus:border-[#635BFF] focus:ring-2 focus:ring-[#635BFF]/20"
                    />
                    {query && (
                        <button type="button" onClick={() => setQuery('')} aria-label={t('clear')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8792A2] hover:text-[#1A1F36]">
                            <X size={14} />
                        </button>
                    )}
                </div>
                {searching ? searchResults : (
                    <>
                        <button
                            type="button"
                            onClick={() => setTocOpen((o) => !o)}
                            aria-expanded={tocOpen}
                            className="lg:hidden w-full flex items-center justify-between px-2 py-1.5 rounded text-[13px] font-semibold text-[#1A1F36] hover:bg-[#F6F8FA]"
                        >
                            {t('allChapters')}
                            <ChevronRight size={14} className={`transition-transform ${tocOpen ? 'rotate-90' : ''}`} />
                        </button>
                        <div className={`${tocOpen ? 'block mt-2' : 'hidden'} lg:block`}>{toc}</div>
                    </>
                )}
            </aside>

            <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center gap-1 text-[12px] text-[#697386]">
                    <Link href={base} className="font-semibold text-[#635BFF] hover:underline">{guideTitle}</Link>
                    {slug && (<><ChevronRight size={12} /><span className="truncate">{title}</span></>)}
                </div>
                {locale !== 'en' && <Notice>{t('englishOnly')}</Notice>}
                <section className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm px-5 py-6 sm:px-8">
                    {html ? (
                        <article lang="en" className="guide-prose" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: html }} />
                    ) : (
                        <p className="text-[13px] text-[#697386]">{t('unavailable')}</p>
                    )}
                </section>
                {(prev || next) && (
                    <nav className="grid gap-3 sm:grid-cols-2" aria-label={`${t('previous')} / ${t('next')}`}>
                        {prev ? (
                            <Link href={hrefFor(prev.slug)} className="group bg-white border border-[#E3E8EE] rounded-lg px-4 py-3 hover:border-[#635BFF]">
                                <span className="flex items-center gap-1 text-[11px] font-semibold text-[#8792A2]"><ChevronLeft size={12} /> {t('previous')}</span>
                                <span className="block text-[14px] font-semibold text-[#1A1F36] group-hover:text-[#635BFF]">{label(prev)}</span>
                            </Link>
                        ) : <span className="hidden sm:block" />}
                        {next && (
                            <Link href={hrefFor(next.slug)} className="group bg-white border border-[#E3E8EE] rounded-lg px-4 py-3 text-right hover:border-[#635BFF]">
                                <span className="flex items-center justify-end gap-1 text-[11px] font-semibold text-[#8792A2]">{t('next')} <ChevronRight size={12} /></span>
                                <span className="block text-[14px] font-semibold text-[#1A1F36] group-hover:text-[#635BFF]">{label(next)}</span>
                            </Link>
                        )}
                    </nav>
                )}
            </div>
        </div>
    );
}
