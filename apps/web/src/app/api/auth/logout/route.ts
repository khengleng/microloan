import { NextResponse } from 'next/server';

/**
 * POST /api/auth/logout
 *
 * Clears the HttpOnly auth cookies server-side.
 * Client JS cannot clear HttpOnly cookies directly — it must call this route.
 */
export async function POST() {
    const response = NextResponse.json({ ok: true });

    response.cookies.set('access_token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 0, // Expire immediately
    });

    response.cookies.set('refresh_token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 0,
    });

    return response;
}
