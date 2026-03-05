import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Smart rate-limiter that keys on the authenticated user's ID for all
 * requests that carry a valid JWT, and falls back to the real client IP
 * for unauthenticated endpoints (login, register, MFA).
 *
 * WHY: The Next.js proxy forwards all browser traffic from a single server
 * IP. If we key solely on IP, every user on the platform shares one bucket
 * and legitimate page loads produce 429s.
 *
 * NOTE: Only getTracker() is overridden — the parent's canActivate() already
 * handles @SkipThrottle() correctly. Do NOT override shouldSkip() or
 * canActivate(), as that breaks @SkipThrottle() on routes like GET /auth/me.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
    protected async getTracker(req: Record<string, any>): Promise<string> {
        // req.user is populated by JwtStrategy after token verification.
        const userId: string | undefined = req.user?.sub ?? req.user?.id;
        if (userId) return `user:${userId}`;

        // Unauthenticated routes (login / register / MFA):
        // use the real client IP forwarded by the Next.js proxy.
        const forwarded = req.headers?.['x-forwarded-for'];
        const ip: string =
            (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) ||
            req.headers?.['x-real-ip'] ||
            req.ip ||
            '0.0.0.0';

        return `ip:${ip}`;
    }
}
