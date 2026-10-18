import en from '../../messages/en.json';
import km from '../../messages/km.json';

/**
 * Download links (statements, letters, CSV and Excel exports…) are plain
 * browser navigations through /api/proxy. When the API refuses one, the
 * browser would otherwise show the raw JSON error body. For a navigation —
 * never for the app's own fetch/axios calls, which read the JSON themselves —
 * the proxy answers with a small readable page instead.
 */
export function isBrowserNavigation(headers: Headers): boolean {
    const mode = headers.get('sec-fetch-mode');
    if (mode) return mode === 'navigate';
    // Browsers without Fetch Metadata: an HTML-accepting request that is not an XHR.
    return (headers.get('accept') ?? '').includes('text/html') && !headers.get('x-requested-with');
}

type Copy = typeof en.Servicing.downloadError;

function localeOf(headers: Headers, cookieLocale: string | undefined): 'en' | 'km' {
    if (cookieLocale === 'km' || cookieLocale === 'en') return cookieLocale;
    return /^\/km(\/|$)/.test(sameOriginPath(headers) ?? '') ? 'km' : 'en';
}

/** The page the link was clicked on, if it was on this site (for "Go back"). */
function sameOriginPath(headers: Headers): string | null {
    try {
        const ref = new URL(headers.get('referer') ?? '');
        const host = headers.get('x-forwarded-host') ?? headers.get('host');
        return host && ref.host === host ? `${ref.pathname}${ref.search}` : null;
    } catch {
        return null;
    }
}

const escape = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The API's own explanation from a JSON error body, if it gave one. */
function messageOf(body: ArrayBuffer, contentType: string | null): string | null {
    if (!contentType?.includes('json')) return null;
    try {
        const d = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
        const inner = d.message && typeof d.message === 'object' && !Array.isArray(d.message) ? (d.message as Record<string, unknown>) : d;
        const m = inner.message ?? d.message;
        if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join('; ') || null;
        return typeof m === 'string' ? m : null;
    } catch {
        return null;
    }
}

export function errorPage(opts: {
    status: number;
    body: ArrayBuffer | null;
    contentType: string | null;
    headers: Headers;
    cookieLocale: string | undefined;
}): Response {
    const locale = localeOf(opts.headers, opts.cookieLocale);
    const t: Copy = locale === 'km' ? km.Servicing.downloadError : en.Servicing.downloadError;
    const back = sameOriginPath(opts.headers) ?? `/${locale}/home`;
    const title = opts.status === 401 ? t.signedOutTitle : opts.status === 403 ? t.forbiddenTitle : opts.status === 404 ? t.notFoundTitle : t.title;
    const detail = (opts.body && messageOf(opts.body, opts.contentType)) || (opts.status === 401 ? t.signedOutBody : t.body);
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F7FAFC;color:#1A1F36;margin:0;padding:48px 16px}
main{max-width:520px;margin:0 auto;background:#fff;border:1px solid #E3E8EE;border-radius:8px;padding:24px}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:#3C4257;margin:0 0 16px}
a{color:#635BFF;font-weight:600;font-size:14px;text-decoration:none;margin-right:16px}small{color:#8792A2;font-size:12px}</style></head>
<body><main><h1>${escape(title)}</h1><p>${escape(detail)}</p>
<a href="${escape(back)}">${escape(t.back)}</a>${opts.status === 401 ? `<a href="/${locale}/login">${escape(t.signIn)}</a>` : ''}
<p><small>${escape(t.code)} ${opts.status}</small></p></main></body></html>`;
    return new Response(html, {
        status: opts.status,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}
