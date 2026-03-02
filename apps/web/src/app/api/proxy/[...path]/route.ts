import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';

/**
 * Next.js API Proxy Route
 * 
 * Since auth tokens are stored in HttpOnly cookies on this domain (magicmoney.cambobia.com),
 * client-side JavaScript cannot read them. The browser would only send them to the SAME domain.
 * 
 * This proxy route receives requests from the client, extracts the 'access_token' cookie,
 * and forwards the request to the real NestJS API with the token in the Authorization header.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return proxy(req, await params);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return proxy(req, await params);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return proxy(req, await params);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return proxy(req, await params);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return proxy(req, await params);
}

async function proxy(req: NextRequest, params: { path: string[] }) {
    const path = params.path.join('/');
    const url = new URL(req.url);
    const targetUrl = `${API_BASE}/${path}${url.search}`;

    // 1. Extract tokens from cookies
    const accessToken = req.cookies.get('access_token')?.value;

    // 2. Prepare headers
    const headers = new Headers();
    req.headers.forEach((value, key) => {
        // Skip host and other sensitive/incompatible headers
        if (!['host', 'connection', 'cookie'].includes(key.toLowerCase())) {
            headers.set(key, value);
        }
    });

    if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
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
