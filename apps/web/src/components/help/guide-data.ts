import {
    GUIDE_CHAPTERS, GUIDE_CONTENTS_HTML, GUIDE_GROUPS, GUIDE_HTML, GUIDE_LOCALE_TOKEN, GUIDE_TITLE,
} from '@/generated/user-guide';
import type { GuideHeading } from '@/lib/user-guide-types';

/** Server-side: the props a help page needs, without shipping the whole guide to the browser. */
export interface GuideNavChapter {
    slug: string;
    number: string | null;
    title: string;
    summary: string;
}

export interface GuidePageProps {
    locale: string;
    /** '' for the contents page. */
    slug: string;
    guideTitle: string;
    title: string;
    html: string;
    groups: { title: string; chapters: GuideNavChapter[] }[];
    headings: GuideHeading[];
    prev: GuideNavChapter | null;
    next: GuideNavChapter | null;
}

const navChapter = (c: (typeof GUIDE_CHAPTERS)[number]): GuideNavChapter => ({ slug: c.slug, number: c.number, title: c.title, summary: c.summary });

/** Locale-specific links: the generator writes a placeholder in place of the locale. */
function localise(html: string, locale: string): string {
    const safeLocale = /^[a-z]{2}$/.test(locale) ? locale : 'en';
    return html.split(`/${GUIDE_LOCALE_TOKEN}/`).join(`/${safeLocale}/`);
}

export function guideTitle(slug: string): string {
    return GUIDE_CHAPTERS.find((c) => c.slug === slug)?.title ?? GUIDE_TITLE;
}

export function guidePage(locale: string, slug: string): GuidePageProps | null {
    const order = GUIDE_CHAPTERS;
    const index = slug ? order.findIndex((c) => c.slug === slug) : -1;
    if (slug && index < 0) return null;
    const chapter = index >= 0 ? order[index] : null;
    const groups = GUIDE_GROUPS.map((g) => ({
        title: g.title,
        chapters: g.slugs.map((s) => order.find((c) => c.slug === s)).filter((c): c is (typeof order)[number] => !!c).map(navChapter),
    }));
    return {
        locale,
        slug,
        guideTitle: GUIDE_TITLE,
        title: chapter?.title ?? GUIDE_TITLE,
        html: localise(chapter ? GUIDE_HTML[chapter.slug] ?? '' : GUIDE_CONTENTS_HTML, locale),
        groups,
        headings: chapter ? chapter.headings : [],
        prev: index > 0 ? navChapter(order[index - 1]) : null,
        next: index + 1 < order.length ? navChapter(order[index + 1]) : null,
    };
}
