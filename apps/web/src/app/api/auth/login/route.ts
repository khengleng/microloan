import { NextRequest, NextResponse } from 'next/server';

function apiBaseUrl(): string {
    const url = process.env.NEXT_PUBLIC_API_URL;
    if (url && url.trim()) return url.trim();
    if (process.env.NODE_ENV === 'production') {
        throw new Error('NEXT_PUBLIC_API_URL is required in production.');
    }
    return 'http://localhost:3001/v1';
}

/**
 * POST /api/auth/login
 *
 * Server-side proxy for the login flow.
 * Sets access_token and refresh_token as HttpOnly; Secure; SameSite=Strict cookies
 * so they are NEVER accessible from JavaScript (XSS-proof).
 *
 * The browser client calls this Next.js route — never the NestJS API directly.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const res = await fetch(`${apiBaseUrl()}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
            return NextResponse.json(data, { status: res.status });
        }

        // MFA step — return the mfaToken to the client; no cookies yet
        if (data.mfaRequired) {
            return NextResponse.json({ mfaRequired: true, mfaToken: data.mfaToken });
        }

        // Full login — set HttpOnly cookies and return minimal user info
        return setAuthCookies(data);
    } catch (err) {
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}

/** Shared helper: write tokens as server-set HttpOnly cookies */
export function setAuthCookies(data: { access_token: string; refresh_token: string }) {
    const response = NextResponse.json({ ok: true });
    const isProd = process.env.NODE_ENV === 'production';

    const cookieBase = {
        httpOnly: true,          // ← inaccessible to JS — XSS cannot steal these
        secure: isProd,          // ← HTTPS only in production
        sameSite: 'strict' as const,
        path: '/',
    };

    response.cookies.set('access_token', data.access_token, {
        ...cookieBase,
        maxAge: 15 * 60,       // 15 minutes (matches JWT_ACCESS_TTL)
    });

    response.cookies.set('refresh_token', data.refresh_token, {
        ...cookieBase,
        maxAge: 30 * 24 * 60 * 60, // 30 days (matches JWT_REFRESH_TTL)
    });

    return response;
}
