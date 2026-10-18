import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/server-api-url';

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
