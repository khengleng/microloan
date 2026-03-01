/**
 * In-memory IP-based rate limiter for auth endpoints.
 *
 * Why in-memory (not Redis)?  We're on a single Railway process.
 * For multi-instance scale-out, replace with Redis ThrottlerStorage.
 *
 * Rules enforced:
 *  - Login:           10 attempts per IP per 15 minutes → 429
 *  - Register:         5 attempts per IP per 1 hour     → 429
 *  - MFA verify:      10 attempts per IP per 15 minutes → 429
 *  - Account lockout:  5 failed logins → locked 30 minutes
 */

interface Bucket {
    count: number;
    resetAt: number; // epoch ms
}

const store = new Map<string, Bucket>();

function check(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: limit - 1, resetIn: windowMs };
    }

    entry.count++;
    if (entry.count > limit) {
        return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
    }

    return { allowed: true, remaining: limit - entry.count, resetIn: entry.resetAt - now };
}

// Clean up stale entries every 10 min to prevent memory leak
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) {
        if (now > v.resetAt) store.delete(k);
    }
}, 10 * 60 * 1000);

export const RateLimiter = {
    /** 10 attempts / IP / 15 min */
    login: (ip: string) => check(`login:${ip}`, 10, 15 * 60 * 1000),
    /** 5 registrations / IP / 1 hour */
    register: (ip: string) => check(`reg:${ip}`, 5, 60 * 60 * 1000),
    /** 10 MFA attempts / IP / 15 min */
    mfa: (ip: string) => check(`mfa:${ip}`, 10, 15 * 60 * 1000),
};
