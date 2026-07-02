import { NextRequest, NextResponse } from 'next/server';

function apiBaseUrl(): string {
    const url = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (url && url.trim()) return url.trim();
    if (process.env.NODE_ENV === 'production') {
        throw new Error('API_URL (or NEXT_PUBLIC_API_URL) is required in production.');
    }
    return 'http://localhost:3001/v1';
}

/** POST /api/borrower/otp-request — forwards to the API; never sets a cookie. */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const res = await fetch(`${apiBaseUrl()}/borrower/otp/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch {
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}
