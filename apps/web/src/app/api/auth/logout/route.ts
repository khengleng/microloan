import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/server-api-url';
import { clearAuthCookies, clientIp } from '@/lib/auth-cookies';

/**
 * POST /api/auth/logout
 *
 * Revokes the refresh token at the API (best effort) and clears the HttpOnly
 * auth cookies server-side — client JS cannot clear HttpOnly cookies itself.
 * The cookies are cleared whatever the API answers, so signing out always
 * works on this device.
 */
export async function POST(req: NextRequest) {
    const refreshToken = req.cookies.get('refresh_token')?.value;
    if (refreshToken) {
        try {
            const ip = clientIp(req);
            await fetch(`${apiBaseUrl()}/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'X-Real-IP': ip },
                body: JSON.stringify({ refreshToken }),
                cache: 'no-store',
            });
        } catch { /* revocation is best effort; the cookies go regardless */ }
    }
    return clearAuthCookies(NextResponse.json({ ok: true }));
}
