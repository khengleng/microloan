import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { isIP } from 'net';

/**
 * The browser's IP address, derived once per request.
 *
 * Staff and borrower traffic reaches the API through the Next.js server's
 * route handlers (login, MFA, Google sign-in, borrower OTP, refresh, logout
 * and the /api/proxy pass-through). Seen from the API those are server-to-
 * server calls, so `req.ip` is the web server's address: keying throttles or
 * audit rows on it would put every user of every tenant in one bucket.
 *
 * The web server therefore states the browser's address in `X-Client-IP` and
 * proves it is the web server with `X-Web-Proxy-Secret` (WEB_PROXY_SECRET,
 * set to the same value on both services). The header is believed only when
 * that secret matches; otherwise — no secret configured, header missing or
 * wrong, or a malformed address — the API falls back to `req.ip`, which
 * `trust proxy` derives from the platform edge and a client cannot choose.
 */
export const CLIENT_IP_HEADER = 'x-client-ip';
export const WEB_PROXY_SECRET_HEADER = 'x-web-proxy-secret';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time comparison of the presented secret with WEB_PROXY_SECRET. */
export function isTrustedWebProxy(
  req: { headers?: Record<string, unknown> },
  secret: string | undefined = process.env.WEB_PROXY_SECRET,
): boolean {
  const expected = secret?.trim();
  if (!expected) return false;
  const presented = req.headers?.[WEB_PROXY_SECRET_HEADER];
  if (typeof presented !== 'string' || !presented) return false;
  // Hash both sides so the comparison is fixed-length and leaks nothing about
  // the secret's length.
  return timingSafeEqual(digest(presented), digest(expected));
}

export function clientIp(
  req: Record<string, any>,
  secret: string | undefined = process.env.WEB_PROXY_SECRET,
): string {
  const fallback: string =
    req.ip || req.socket?.remoteAddress || 'unknown';
  if (!isTrustedWebProxy(req, secret)) return fallback;
  const stated = req.headers?.[CLIENT_IP_HEADER];
  const ip = typeof stated === 'string' ? stated.trim() : '';
  return ip && isIP(ip) ? ip : fallback;
}

/** `@ClientIp()` — the request's client IP, as `clientIp()` derives it. */
export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    clientIp(ctx.switchToHttp().getRequest()),
);
