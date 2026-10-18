import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-only helpers for the staff session cookies. The tokens live in
 * HttpOnly; SameSite=Strict cookies (Secure in production) written by the
 * Next.js server, so browser JavaScript can never read them.
 */

const cookieBase = () => ({
    httpOnly: true,          // inaccessible to JS — XSS cannot steal these
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict' as const,
    path: '/',
});

/**
 * Seconds until the JWT's own `exp`, so the cookie lives exactly as long as
 * the token the API issued (JWT_ACCESS_TTL / JWT_REFRESH_TTL) instead of a
 * copy of those settings. The payload is only decoded, not verified: the API
 * verifies every token it is handed, and a wrong lifetime here can only make
 * the browser drop a cookie early.
 */
export function secondsUntilExpiry(jwt: string): number | undefined {
    try {
        const [, payload] = jwt.split('.');
        const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (typeof exp !== 'number') return undefined;
        return Math.max(0, Math.floor(exp - Date.now() / 1000));
    } catch {
        return undefined;
    }
}

/** Write tokens as server-set HttpOnly cookies on a `{ ok: true }` response. */
export function setAuthCookies(data: { access_token: string; refresh_token: string }) {
    const response = NextResponse.json({ ok: true });
    // A token without a readable `exp` gets a session cookie (no maxAge):
    // it ends with the browser, and the API still enforces the real expiry.
    response.cookies.set('access_token', data.access_token, {
        ...cookieBase(),
        maxAge: secondsUntilExpiry(data.access_token),
    });
    response.cookies.set('refresh_token', data.refresh_token, {
        ...cookieBase(),
        maxAge: secondsUntilExpiry(data.refresh_token),
    });
    return response;
}

/** Expire both session cookies on the given response. */
export function clearAuthCookies<T extends NextResponse>(response: T): T {
    response.cookies.set('access_token', '', { ...cookieBase(), maxAge: 0 });
    response.cookies.set('refresh_token', '', { ...cookieBase(), maxAge: 0 });
    return response;
}

/**
 * The browser's IP for the API's per-IP throttle on unauthenticated routes.
 * Same rule as the API proxy: the platform edge appends the true client IP as
 * the LAST X-Forwarded-For entry; anything to its left is client-supplied.
 */
export function clientIp(req: NextRequest): string {
    const chain = (req.headers.get('x-forwarded-for') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return (chain.length ? chain[chain.length - 1] : undefined)
        || req.headers.get('x-real-ip')?.trim()
        || '127.0.0.1';
}
