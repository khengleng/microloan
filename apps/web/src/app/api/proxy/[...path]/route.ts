import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';

/**
 * Next.js API Proxy Route
 * 
 * Bridging HttpOnly cookies from the browser to the NestJS API.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    console.log(`[Proxy] GET ${resolvedParams.path.join('/')}`);
    return proxy(req, resolvedParams);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    console.log(`[Proxy] POST ${resolvedParams.path.join('/')}`);
    return proxy(req, resolvedParams);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    console.log(`[Proxy] PUT ${resolvedParams.path.join('/')}`);
    return proxy(req, resolvedParams);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    console.log(`[Proxy] PATCH ${resolvedParams.path.join('/')}`);
    return proxy(req, resolvedParams);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const resolvedParams = await params;
    console.log(`[Proxy] DELETE ${resolvedParams.path.join('/')}`);
    return proxy(req, resolvedParams);
}

async function proxy(req: NextRequest, params: { path: string[] }) {
    const path = params.path.join('/');
    const url = new URL(req.url);
    const targetUrl = `${API_URL}/${path}${url.search}`;

    // 1. Extract tokens from cookies
    const accessToken = req.cookies.get('access_token')?.value;

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

    // 3. Forward the real browser IP so the throttler works for unauthenticated routes
    const realIp =
        req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        req.headers.get('x-real-ip') ||
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
