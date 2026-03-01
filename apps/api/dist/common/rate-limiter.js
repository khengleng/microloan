"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
const store = new Map();
function check(key, limit, windowMs) {
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
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) {
        if (now > v.resetAt)
            store.delete(k);
    }
}, 10 * 60 * 1000);
exports.RateLimiter = {
    login: (ip) => check(`login:${ip}`, 10, 15 * 60 * 1000),
    register: (ip) => check(`reg:${ip}`, 5, 60 * 60 * 1000),
    mfa: (ip) => check(`mfa:${ip}`, 10, 15 * 60 * 1000),
};
//# sourceMappingURL=rate-limiter.js.map