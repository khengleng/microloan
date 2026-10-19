/**
 * Headers for the web server's server-to-server calls to the API.
 *
 * Every route handler that calls the API (login, MFA, Google sign-in,
 * borrower OTP, refresh, logout and the /api/proxy pass-through) does so from
 * this server, so the API would otherwise see this server's address for every
 * browser: one throttle bucket and one audit IP for everyone. Instead the
 * browser's address is stated in X-Client-IP, and WEB_PROXY_SECRET (the same
 * value on both services) proves to the API that this server said it. Without
 * the secret the API ignores X-Client-IP.
 *
 * No Next.js imports here, so node:test can load it directly.
 */

type HeaderSource = { get(name: string): string | null };

/** Headers only this server may set; anything a browser sends is dropped. */
export const INTERNAL_HEADERS = ['x-client-ip', 'x-web-proxy-secret', 'x-user-id'];

/**
 * The browser's IP. The platform edge APPENDS the true client address as the
 * LAST X-Forwarded-For entry; anything to its left is client-supplied, so the
 * rightmost entry is the one to trust.
 */
export function clientIpFrom(headers: HeaderSource): string {
    const chain = (headers.get('x-forwarded-for') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return (chain.length ? chain[chain.length - 1] : undefined)
        || headers.get('x-real-ip')?.trim()
        || '127.0.0.1';
}

/**
 * The client-identity headers for a call to the API on behalf of the browser
 * whose request headers are `incoming`. `secret` defaults to WEB_PROXY_SECRET.
 */
export function upstreamIdentity(
    incoming: HeaderSource,
    secret: string | undefined = process.env.WEB_PROXY_SECRET,
): Record<string, string> {
    const ip = clientIpFrom(incoming);
    const out: Record<string, string> = {
        'X-Client-IP': ip,
        // Kept for an API reached without the edge in between (private
        // networking), where `trust proxy` reads it.
        'X-Forwarded-For': ip,
        'X-Real-IP': ip,
    };
    const proof = secret?.trim();
    if (proof) out['X-Web-Proxy-Secret'] = proof;
    return out;
}

/** JSON request headers plus the client identity. */
export function apiJsonHeaders(incoming: HeaderSource): Record<string, string> {
    return { 'Content-Type': 'application/json', ...upstreamIdentity(incoming) };
}
