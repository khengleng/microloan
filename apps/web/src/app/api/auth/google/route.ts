import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '../login/route';

function apiBaseUrl(): string {
    const url = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (url && url.trim()) return url.trim();
    if (process.env.NODE_ENV === 'production') {
        throw new Error('API_URL (or NEXT_PUBLIC_API_URL) is required in production.');
    }
    return 'http://localhost:3001/v1';
}

/**
 * POST /api/auth/google
 *
 * Server-side exchange of a Google ID token for a session. Mirrors
 * /api/auth/login exactly: the ID token goes to the NestJS API from the
 * server, and the resulting tokens come back as HttpOnly cookies that
 * JavaScript can never read.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const res = await fetch(`${apiBaseUrl()}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: body?.idToken }),
        });

        const data = await res.json();
        if (!res.ok) {
            return NextResponse.json(data, { status: res.status });
        }

        // Google sign-in does not skip MFA — the API still issues a challenge
        // when the account has TOTP enrolled.
        if (data.mfaRequired) {
            return NextResponse.json({ mfaRequired: true, mfaToken: data.mfaToken });
        }

        return setAuthCookies(data);
    } catch {
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}
