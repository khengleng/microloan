import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';
import { apiBaseUrl } from '@/lib/server-api-url';
import { apiJsonHeaders } from '@/lib/upstream-headers';

/**
 * Server-only: verify an authenticator code at the API for the signed-in
 * session and store the fresh MFA session it answers with.
 *
 * The access token (Authorization) and refresh token (body) are read from the
 * HttpOnly cookies here, never from the browser; the new pair is written back
 * as HttpOnly cookies and the browser only sees { ok: true }. Errors (wrong or
 * replayed code, lockout) pass through with the API's status and body.
 */
export async function forwardSessionCode(req: NextRequest, apiPath: string): Promise<NextResponse> {
    const accessToken = req.cookies.get('access_token')?.value;
    if (!accessToken) {
        return NextResponse.json({ message: 'Your session has ended. Please sign in again.' }, { status: 401 });
    }
    const refreshToken = req.cookies.get('refresh_token')?.value;

    let code = '';
    try {
        const body = await req.json();
        if (typeof body?.code === 'string') code = body.code.replace(/\s+/g, '');
    } catch {
        /* empty or malformed body: the API refuses the empty code */
    }

    let res: Response;
    try {
        res = await fetch(`${apiBaseUrl()}${apiPath}`, {
            method: 'POST',
            headers: { ...apiJsonHeaders(req.headers), Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ code, ...(refreshToken ? { refreshToken } : {}) }),
            cache: 'no-store',
        });
    } catch {
        return NextResponse.json({ message: 'Gateway error' }, { status: 502 });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    if (typeof data?.access_token === 'string' && typeof data?.refresh_token === 'string') {
        return setAuthCookies(data);
    }
    // An API that does not issue a new session yet: the code was still accepted.
    return NextResponse.json({ ok: true });
}
