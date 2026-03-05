import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

/**
 * Smart rate-limiter that keys on the authenticated user's ID for all
 * requests that carry a valid JWT, and falls back to the real client IP
 * for unauthenticated endpoints (login, register, MFA).
 *
 * WHY: The Next.js proxy forwards all browser traffic from a single server
 * IP. If we key solely on IP, every user on the platform shares one bucket
 * and legitimate page loads produce 429s. Switching to user-ID means each
 * of the N tenants gets their own independent bucket.
 *
 * SECURITY: We use the user ID that was already set on req.user by
 * JwtStrategy.validate() — this is fully verified. We do NOT trust the
 * raw X-User-ID header for security decisions; it is only used here as a
 * cache key to separate rate-limit buckets.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
    protected async getTracker(req: Record<string, any>): Promise<string> {
        // req.user is populated by JwtStrategy after token verification.
        // For authenticated routes this is guaranteed to be trusted.
        const userId: string | undefined = req.user?.sub ?? req.user?.id;
        if (userId) return `user:${userId}`;

        // Unauthenticated routes (login / register / MFA / health):
        // use the real client IP forwarded by the Next.js proxy.
        const forwarded = req.headers?.['x-forwarded-for'];
        const ip: string =
            (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) ||
            req.headers?.['x-real-ip'] ||
            req.ip ||
            '0.0.0.0';

        return `ip:${ip}`;
    }

    /**
     * Override to pass the tracker key into the ThrottlerRequest.
     * @nestjs/throttler v5+ calls getTracker then canActivate; we just
     * need to ensure the tracker is correctly resolved.
     */
    protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
        return false; // let the parent class / @SkipThrottle() handle skipping
    }
}
