/**
 * Silent renewal of the staff session.
 *
 * The access token is short-lived; the HttpOnly refresh_token cookie trades
 * for a new pair at POST /api/auth/refresh. Refresh tokens ROTATE and the API
 * treats a rotated token presented again as theft (it revokes every session
 * of the user). So refreshes must never overlap:
 *   - within a tab, concurrent 401s share one in-flight refresh;
 *   - across tabs, refreshes run under a Web Lock, and a tab that waited for
 *     the lock first checks whether another tab already refreshed after its
 *     request was sent — if so it just retries with the new cookie.
 * Nothing here ever sees a token; the cookies are HttpOnly.
 */

export type RefreshOutcome = 'refreshed' | 'rejected' | 'unavailable';

const LOCK_NAME = 'microloan-session-refresh';
const STAMP_KEY = 'microloan.session.renewedAt';

/** Injected so the logic can be unit-tested without a browser. */
export interface RefreshDeps {
    /** POST /api/auth/refresh; resolves to the HTTP status (0 when unreachable). */
    callRefresh: () => Promise<number>;
    /** Run `fn` while holding a lock shared by every tab of this origin. */
    withLock: <T>(fn: () => Promise<T>) => Promise<T>;
    /** When any tab last renewed the session (ms), or 0 if unknown. */
    readStamp: () => number;
    writeStamp: (at: number) => void;
    now: () => number;
}

export function createSessionRefresher(deps: RefreshDeps) {
    let inflight: Promise<RefreshOutcome> | null = null;

    /**
     * Make the session usable again for a request that was SENT at `sentAt`
     * and came back 401. Resolves 'refreshed' when the caller should retry.
     */
    return function renew(sentAt: number): Promise<RefreshOutcome> {
        if (inflight) return inflight;
        inflight = deps
            .withLock(async () => {
                // Another tab renewed after this request left: the cookie is
                // already fresh; refreshing again would only rotate needlessly.
                if (deps.readStamp() > sentAt) return 'refreshed' as const;
                const status = await deps.callRefresh();
                if (status >= 200 && status < 300) {
                    deps.writeStamp(deps.now());
                    return 'refreshed' as const;
                }
                return status === 401 || status === 403 ? ('rejected' as const) : ('unavailable' as const);
            })
            .finally(() => { inflight = null; });
        return inflight;
    };
}

function browserDeps(): RefreshDeps {
    return {
        callRefresh: () =>
            fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            }).then((r) => r.status, () => 0),
        withLock: (fn) => {
            const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
            // Every supported browser has Web Locks; without them a tab still
            // single-flights its own refreshes and relies on the stamp check.
            return locks?.request ? (locks.request(LOCK_NAME, fn) as Promise<Awaited<ReturnType<typeof fn>>>) : fn();
        },
        readStamp: () => {
            try { return Number(window.localStorage.getItem(STAMP_KEY)) || 0; } catch { return 0; }
        },
        writeStamp: (at) => {
            try { window.localStorage.setItem(STAMP_KEY, String(at)); } catch { /* storage blocked */ }
        },
        now: () => Date.now(),
    };
}

let browserRefresher: ((sentAt: number) => Promise<RefreshOutcome>) | null = null;

/** The page-wide refresher used by the API client. */
export function renewSession(sentAt: number): Promise<RefreshOutcome> {
    if (!browserRefresher) browserRefresher = createSessionRefresher(browserDeps());
    return browserRefresher(sentAt);
}

/**
 * Run a call that ROTATES the session cookies itself (authenticator step-up,
 * finishing authenticator setup) under the same cross-tab lock as a refresh,
 * so it never overlaps a refresh presenting the same refresh token. A 2xx
 * answer stamps the renewal for other tabs.
 */
export function rotateSessionWith<T extends { status: number }>(fn: () => Promise<T>): Promise<T> {
    const deps = browserDeps();
    return deps.withLock(async () => {
        const out = await fn();
        if (out.status >= 200 && out.status < 300) deps.writeStamp(deps.now());
        return out;
    });
}
