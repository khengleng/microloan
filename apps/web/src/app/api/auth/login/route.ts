import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/server-api-url';
import { setAuthCookies } from '@/lib/auth-cookies';

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
