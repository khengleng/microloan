import { NextRequest, NextResponse } from 'next/server';

function apiUrl(): string {
    const configured = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (configured && configured.trim()) return configured.trim();
    if (process.env.NODE_ENV === 'production') {
        throw new Error('API_URL (or NEXT_PUBLIC_API_URL) is required in production.');
    }
    return 'http://localhost:3001/v1';
}

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
    const targetUrl = `${apiUrl()}/${path}${url.search}`;

    // 1. Extract tokens from cookies. Staff access_token takes precedence; the
    //    borrower-portal token is forwarded when no staff session is present.
    //    Both are fully verified by the API (distinct secrets + guards), so
    //    forwarding whichever exists is safe — cross-use is rejected server-side.
    const accessToken =
        req.cookies.get('access_token')?.value ||
        req.cookies.get('borrower_token')?.value;

    // 2. Prepare headers — forward select originals, add real-IP and user identity
    const headers = new Headers();
    req.headers.forEach((value, key) => {
        // Skip host and other sensitive/incompatible headers
        if (!['host', 'connection', 'cookie'].includes(key.toLowerCase())) {
            headers.set(key, value);
        }
    });

    if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);

        // Forward the JWT user-ID so the API throttler can rate-limit per user
        // instead of treating all traffic as one IP (the Next.js server IP).
        // We decode WITHOUT verifying here — the API will fully verify the JWT.
        // This is safe: the API never trusts this header for auth decisions.
        try {
            const [, payload] = accessToken.split('.');
            const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
            if (decoded?.sub) headers.set('X-User-ID', decoded.sub);
        } catch { /* malformed JWT — ignore */ }
    }

    // 3. Forward the real browser IP so the API throttler/audit get an IP that a
    //    client cannot spoof. The platform edge APPENDS the true client IP as the
    //    LAST entry of X-Forwarded-For; any values a client injects are prepended
    //    (left) and must be ignored. So take the rightmost entry, not [0].
    //    We overwrite (not echo) XFF downstream so the API sees a single clean IP.
    const xffChain = (req.headers.get('x-forwarded-for') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const realIp =
        (xffChain.length ? xffChain[xffChain.length - 1] : undefined) ||
        req.headers.get('x-real-ip')?.trim() ||
        '127.0.0.1';
    headers.set('X-Forwarded-For', realIp);
    headers.set('X-Real-IP', realIp);

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
        return NextResponse.json({ message: 'Gateway error' }, { status: 502 });
    }
}
