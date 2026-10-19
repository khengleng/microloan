import { NextRequest } from 'next/server';
import { forwardSessionCode } from '@/lib/session-code-route';

/**
 * POST /api/auth/mfa/enable
 *
 * Finishes authenticator setup with { code }. The API answers with a fresh
 * MFA session, which is stored as HttpOnly cookies (lib/session-code-route).
 */
export function POST(req: NextRequest) {
    return forwardSessionCode(req, '/auth/mfa/enable');
}
