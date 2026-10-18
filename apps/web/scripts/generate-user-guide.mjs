#!/usr/bin/env node
/**
 * Builds the in-app user guide from the Markdown manual in docs/user-guide.
 *
 * The manual lives outside the web app, so it is read once here — before
 * `next dev`, `next build` and `tsc` — and written into git-ignored modules
 * under src/generated/. The production server then never touches the file
 * system for help pages, whatever its working directory or image layout.
 *
 *   user-guide.ts          server only: groups, chapters, headings, HTML
 *   user-guide-slugs.ts    the chapter slugs (tiny; used by HelpLink everywhere)
 *   user-guide-search.ts   plain-text sections, loaded lazily by the search box
 *
 * Chapters are discovered from the directory; README.md supplies the grouping
 * and reading order. Raw HTML in the Markdown is escaped, and only http(s),
 * mailto, in-page and chapter links survive as links.
 *
 * Usage: node scripts/generate-user-guide.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(here, '../../../docs/user-guide');
const OUT_DIR = path.resolve(here, '../src/generated');
/** Replaced with the request's locale when a page is served. */
const LOCALE_TOKEN = '__LOCALE__';
const OTHER_GROUP = 'More';

const escapeHtml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const decodeEntities = (s) =>
    s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&amp;/g, '&');

const stripTags = (html) => decodeEntities(html.replace(/<[^>]*>/g, ''));

/** GitHub's heading anchors, so links written for GitHub keep working. */
const githubSlug = (text) =>
    text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
        .replace(/ /g, '-');

const chapterSlug = (file) => file.replace(/\.md$/i, '');

/** Markdown → safe HTML for one document, collecting its headings. */
function renderDocument(markdown, resolveSlug = (s) => s) {
    const headings = [];
    const seen = new Map();
    const uniqueId = (base) => {
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        return n === 0 ? base : `${base}-${n}`;
    };

    const rewriteHref = (href) => {
        const h = (href || '').trim();
        if (h.startsWith('#')) return { href: h, external: false };
        if (/^(https?:|mailto:)/i.test(h)) return { href: h, external: true };
        const m = /^(?:\.\/)?([A-Za-z0-9._-]+)\.md(#[^\s]*)?$/i.exec(h);
        if (m) {
            const slug = resolveSlug(chapterSlug(m[1])) ?? chapterSlug(m[1]);
            const hash = m[2] ?? '';
            if (slug.toLowerCase() === 'readme') return { href: `/${LOCALE_TOKEN}/help${hash}`, external: false };
            // Unknown chapters still route to the help area, which falls back to the contents.
            return { href: `/${LOCALE_TOKEN}/help/${slug}${hash}`, external: false };
        }
        return null; // other repository files: keep the text, drop the link
    };

    const marked = new Marked({ gfm: true, async: false });
    marked.use({
        renderer: {
            heading({ tokens, depth }) {
                const inner = this.parser.parseInline(tokens);
                const text = stripTags(inner).trim();
                const id = uniqueId(githubSlug(text));
                headings.push({ id, text, depth });
                const anchor = depth > 1 ? `<a class="guide-anchor" href="#${escapeHtml(id)}" aria-hidden="true" tabindex="-1">#</a>` : '';
                return `<h${depth} id="${escapeHtml(id)}">${inner}${anchor}</h${depth}>\n`;
            },
            link({ href, title, tokens }) {
                const inner = this.parser.parseInline(tokens);
                const target = rewriteHref(href);
                if (!target) return `<span>${inner}</span>`;
                const t = title ? ` title="${escapeHtml(title)}"` : '';
                const ext = target.external ? ' target="_blank" rel="noopener noreferrer"' : '';
                return `<a href="${escapeHtml(target.href)}"${t}${ext}>${inner}</a>`;
            },
            image({ text }) {
                return escapeHtml(text || '');
            },
            html({ text }) {
                return escapeHtml(text);
            },
        },
    });

    let html = marked.parse(markdown);
    html = html.replace(/<table>/g, '<div class="guide-table"><table>').replace(/<\/table>/g, '</table></div>');

    // Plain-text sections for search: a section starts at each heading.
    const sections = [];
    let current = null;
    const textRenderer = new Marked({ gfm: true, async: false });
    textRenderer.use({ renderer: { html: ({ text }) => escapeHtml(text) } });
    let headingIndex = 0;
    for (const token of marked.lexer(markdown)) {
        if (token.type === 'heading') {
            const h = headings[headingIndex++];
            current = { id: h.depth === 1 ? '' : h.id, title: h.text, text: '' };
            sections.push(current);
            continue;
        }
        if (!current) {
            current = { id: '', title: '', text: '' };
            sections.push(current);
        }
        const plain = stripTags(textRenderer.parser([token])).replace(/\s+/g, ' ').trim();
        if (plain) current.text += (current.text ? ' ' : '') + plain;
    }

    return { html, headings, sections };
}

/** Groups and reading order from the README's "Contents" section. */
function parseContents(readme) {
    const groups = [];
    const order = new Map();
    let inContents = false;
    let group = null;
    for (const line of readme.split(/\r?\n/)) {
        if (/^##\s+/.test(line)) {
            inContents = /^##\s+contents\b/i.test(line);
            continue;
        }
        if (!inContents) continue;
        const g = /^\*\*(.+?)\*\*\s*$/.exec(line.trim());
        if (g) {
            group = { title: g[1], slugs: [] };
            groups.push(group);
            continue;
        }
        const item = /^\s*[-*]\s+.*?\[[^\]]+\]\(([^)#\s]+\.md)(?:#[^)]*)?\)(.*)$/i.exec(line);
        if (item && group) {
            const slug = chapterSlug(path.basename(item[1]));
            if (order.has(slug)) continue;
            const summary = item[2].replace(/^\s*[—–-]\s*/, '').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim().replace(/^[.\s]+$/, '');
            order.set(slug, { group: group.title, summary });
            group.slugs.push(slug);
        }
    }
    return { groups, order };
}

function writeModule(file, body) {
    const banner = '// Generated by scripts/generate-user-guide.mjs from docs/user-guide. Do not edit.\n/* eslint-disable */\n';
    fs.writeFileSync(path.join(OUT_DIR, file), banner + body);
}

function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const files = fs.existsSync(DOCS_DIR) ? fs.readdirSync(DOCS_DIR).filter((f) => /\.md$/i.test(f)).sort() : [];
    if (files.length === 0) console.warn(`[user-guide] no Markdown found in ${DOCS_DIR}; the help area will be empty.`);

    const readmeFile = files.find((f) => f.toLowerCase() === 'readme.md');
    const chapterFiles = files.filter((f) => f !== readmeFile);
    const slugs = chapterFiles.map(chapterSlug);
    const known = new Set(slugs);
    // A link to a renamed chapter ("x.md" → "24-x.md") still finds it.
    const unnumbered = (s) => s.replace(/^\d+-/, '');
    const resolve = (s) => (known.has(s) ? s : slugs.find((k) => unnumbered(k) === unnumbered(s)));

    const readmeSrc = readmeFile ? fs.readFileSync(path.join(DOCS_DIR, readmeFile), 'utf8') : '';
    const { groups: readmeGroups, order } = parseContents(readmeSrc);
    const readme = renderDocument(readmeSrc, resolve);

    // Reading order: README groups first (only chapters that exist), then the rest.
    for (const [s, meta] of [...order]) {
        const r = resolve(s);
        if (r && r !== s && !order.has(r)) order.set(r, meta);
    }
    const groups = readmeGroups
        .map((g) => ({ title: g.title, slugs: [...new Set(g.slugs.map(resolve).filter(Boolean))] }))
        .filter((g) => g.slugs.length > 0);
    const listed = new Set(groups.flatMap((g) => g.slugs));
    const rest = slugs.filter((s) => !listed.has(s));
    if (rest.length) groups.push({ title: OTHER_GROUP, slugs: rest });

    const chapters = [];
    const html = {};
    const search = [];
    for (const g of groups) {
        for (const slug of g.slugs) {
            const src = fs.readFileSync(path.join(DOCS_DIR, `${slug}.md`), 'utf8');
            const doc = renderDocument(src, resolve);
            const h1 = doc.headings.find((h) => h.depth === 1);
            const num = /^(\d+)-/.exec(slug);
            chapters.push({
                slug,
                number: num ? num[1] : null,
                title: h1 ? h1.text : slug,
                group: g.title,
                summary: order.get(slug)?.summary ?? '',
                headings: doc.headings.filter((h) => h.depth === 2 || h.depth === 3).map(({ id, text, depth }) => ({ id, text, depth })),
            });
            html[slug] = doc.html;
            for (const s of doc.sections) {
                if (!s.title && !s.text) continue;
                search.push({ slug, id: s.id, title: s.title, text: s.text });
            }
        }
    }
    const readmeTitle = readme.headings.find((h) => h.depth === 1)?.text ?? 'User guide';
    for (const s of readme.sections) if (s.title || s.text) search.push({ slug: '', id: s.id, title: s.title || readmeTitle, text: s.text });

    const J = (v) => JSON.stringify(v, null, 1);

    writeModule(
        'user-guide-slugs.ts',
        `/** Slugs of the chapters in the user guide, in reading order. */\nexport const GUIDE_SLUGS: readonly string[] = ${J(chapters.map((c) => c.slug))};\n`,
    );

    writeModule(
        'user-guide.ts',
        `import type { GuideChapter, GuideGroup } from '@/lib/user-guide-types';

export const GUIDE_LOCALE_TOKEN = ${J(LOCALE_TOKEN)};
export const GUIDE_TITLE: string = ${J(readmeTitle)};
export const GUIDE_GROUPS: readonly GuideGroup[] = ${J(groups)};
export const GUIDE_CHAPTERS: readonly GuideChapter[] = ${J(chapters)};
/** Rendered, sanitised chapter HTML. Links carry GUIDE_LOCALE_TOKEN in place of the locale. */
export const GUIDE_HTML: Readonly<Record<string, string>> = ${J(html)};
export const GUIDE_CONTENTS_HTML: string = ${J(readme.html)};
`,
    );

    writeModule(
        'user-guide-search.ts',
        `import type { GuideSection } from '@/lib/user-guide-types';

/** Plain-text sections of the guide; slug '' is the contents page. */
export const GUIDE_SECTIONS: readonly GuideSection[] = ${J(search)};
`,
    );

    console.log(`[user-guide] ${chapters.length} chapters, ${search.length} sections → ${path.relative(process.cwd(), OUT_DIR)}`);
}

main();
