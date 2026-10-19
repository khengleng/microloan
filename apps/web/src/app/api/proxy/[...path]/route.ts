import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/server-api-url';
import { INTERNAL_HEADERS, upstreamIdentity } from '@/lib/upstream-headers';
import { errorPage, isBrowserNavigation } from '@/lib/proxy-error-page';

/**
 * Next.js API Proxy Route
 * 
 * Bridging HttpOnly cookies from the browser to the NestJS API.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    return proxy(req, resolvedParams);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    return proxy(req, resolvedParams);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    return proxy(req, resolvedParams);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    return proxy(req, resolvedParams);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    return proxy(req, resolvedParams);
}

async function proxy(req: NextRequest, params: { path: string[] }) {
    const path = params.path.join('/');
    const url = new URL(req.url);
    const targetUrl = `${apiBaseUrl()}/${path}${url.search}`;

    // 1. Extract tokens from cookies. Staff access_token takes precedence; the
    //    borrower-portal token is forwarded when no staff session is present.
    //    Both are fully verified by the API (distinct secrets + guards), so
    //    forwarding whichever exists is safe — cross-use is rejected server-side.
    const accessToken =
        req.cookies.get('access_token')?.value ||
        req.cookies.get('borrower_token')?.value;

    // 2. Prepare headers — forward select originals, then the client identity.
    //    Headers only this server may set (X-Client-IP, X-Web-Proxy-Secret …)
    //    are dropped from the browser's request, never echoed.
    const headers = new Headers();
    req.headers.forEach((value, key) => {
        const name = key.toLowerCase();
        if (!['host', 'connection', 'cookie'].includes(name) && !INTERNAL_HEADERS.includes(name)) {
            headers.set(key, value);
        }
    });

    // The API verifies this token and keys its rate limit on the user it names.
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

    // 3. State the real browser IP (rightmost X-Forwarded-For hop, appended by
    //    the platform edge) with the shared-secret proof, overwriting whatever
    //    forwarding headers the browser sent.
    for (const [key, value] of Object.entries(upstreamIdentity(req.headers))) {
        headers.set(key, value);
    }

    try {
        const body = req.method !== 'GET' && req.method !== 'HEAD'
            ? await req.arrayBuffer()
            : undefined;

        const res = await fetch(targetUrl, {
            method: req.method,
            headers,
            body,
            cache: 'no-store',
        });

        // 3. Handle response
        const responseData = await res.arrayBuffer();

        // A download link opened in the browser: show a readable page, not raw JSON.
        if (res.status >= 400 && req.method === 'GET' && isBrowserNavigation(req.headers)) {
            return errorPage({ status: res.status, body: responseData, contentType: res.headers.get('content-type'), headers: req.headers, cookieLocale: req.cookies.get('NEXT_LOCALE')?.value });
        }

        // Special case: if NestJS returns 401, it means the token is expired.
        // The interceptor on the client will handle the redirect.

        const responseHeaders = new Headers();
        res.headers.forEach((value, key) => {
            if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
                responseHeaders.set(key, value);
            }
        });

        return new NextResponse(responseData, {
            status: res.status,
            headers: responseHeaders,
        });
    } catch (error) {
        console.error(`[Proxy Error] ${req.method} ${targetUrl}:`, error);
        if (req.method === 'GET' && isBrowserNavigation(req.headers)) {
            return errorPage({ status: 502, body: null, contentType: null, headers: req.headers, cookieLocale: req.cookies.get('NEXT_LOCALE')?.value });
        }
        return NextResponse.json({ message: 'Gateway error' }, { status: 502 });
    }
}
