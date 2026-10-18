import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';
import { apiBaseUrl } from '@/lib/server-api-url';

/**
 * POST /api/auth/mfa
 *
 * Server-side proxy for the MFA step-2 verification.
 * Accepts { mfaToken, code }, verifies with the NestJS API,
 * and sets HttpOnly cookies on success — same as the login route.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const res = await fetch(`${apiBaseUrl()}/auth/mfa/authenticate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
            return NextResponse.json(data, { status: res.status });
        }

        return setAuthCookies(data);
    } catch {
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}
