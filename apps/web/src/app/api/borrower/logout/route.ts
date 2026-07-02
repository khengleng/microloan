import { NextResponse } from 'next/server';

/** POST /api/borrower/logout — clears the borrower session cookie. */
export async function POST() {
    const response = NextResponse.json({ ok: true });
    response.cookies.set('borrower_token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 0,
    });
    return response;
}
