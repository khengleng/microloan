import { NextRequest, NextResponse } from 'next/server';

function apiBaseUrl(): string {
    const url = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (url && url.trim()) return url.trim();
    if (process.env.NODE_ENV === 'production') {
        throw new Error('API_URL (or NEXT_PUBLIC_API_URL) is required in production.');
    }
    return 'http://localhost:3001/v1';
}

/**
 * POST /api/borrower/otp-verify
 * Verifies the OTP via the API and, on success, stores the borrower JWT in an
 * HttpOnly; Secure; SameSite=Strict cookie (never exposed to JavaScript).
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const res = await fetch(`${apiBaseUrl()}/borrower/otp/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return NextResponse.json(data, { status: res.status });

        const response = NextResponse.json({ ok: true, borrower: data.borrower });
        response.cookies.set('borrower_token', data.borrower_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/',
            maxAge: 2 * 60 * 60, // 2h (matches BORROWER_TOKEN_TTL)
        });
        return response;
    } catch {
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}
