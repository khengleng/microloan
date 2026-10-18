import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/server-api-url';
import { clearAuthCookies, clientIp, setAuthCookies } from '@/lib/auth-cookies';

/**
 * POST /api/auth/refresh
 *
 * Silent session renewal. Reads the HttpOnly refresh_token cookie on the
 * server, trades it at the API (POST /auth/refresh — rotating, with reuse
 * detection) and writes the new pair back as HttpOnly cookies. The token
 * never passes through browser JavaScript.
 *
 * The browser serialises calls to this route across tabs (lib/session-refresh)
 * because presenting an already-rotated token is treated as theft and ends
 * every session of the user.
 */
export async function POST(req: NextRequest) {
    const refreshToken = req.cookies.get('refresh_token')?.value;
    if (!refreshToken) {
        return clearAuthCookies(NextResponse.json({ message: 'No session to refresh' }, { status: 401 }));
    }

    let res: Response;
    try {
        const ip = clientIp(req);
        res = await fetch(`${apiBaseUrl()}/auth/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // The API throttles this public route per client IP.
                'X-Forwarded-For': ip,
                'X-Real-IP': ip,
            },
            body: JSON.stringify({ refreshToken }),
            cache: 'no-store',
        });
    } catch {
        // API unreachable: keep the cookies, the session may still be good.
        return NextResponse.json({ message: 'Gateway error' }, { status: 502 });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const out = NextResponse.json(data, { status: res.status });
        // Refused (expired, revoked, reused, account or workspace suspended):
        // the refresh token is dead, so drop both cookies. Anything else
        // (throttled, server error) is transient — leave them alone.
        return res.status === 401 || res.status === 403 ? clearAuthCookies(out) : out;
    }
    return setAuthCookies(data);
}
