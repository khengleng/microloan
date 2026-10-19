import { NextRequest } from 'next/server';
import { forwardSessionCode } from '@/lib/session-code-route';

/**
 * POST /api/auth/step-up
 *
 * Re-verifies the signed-in person with an authenticator code { code } before
 * a sensitive action. The API answers with a fresh MFA session, which is
 * stored as HttpOnly cookies (lib/session-code-route).
 */
export function POST(req: NextRequest) {
    return forwardSessionCode(req, '/auth/mfa/step-up');
}
