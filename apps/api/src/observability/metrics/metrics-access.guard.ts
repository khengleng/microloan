import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Who may read /metrics. Closed unless configured:
 *
 * - METRICS_BEARER_TOKEN: a scraper sends `Authorization: Bearer <token>`
 *   (compared in constant time). Use this whenever the API is reachable
 *   through a proxy or load balancer.
 * - METRICS_ALLOW_PRIVATE_NETWORK=true: a request arriving directly (no
 *   X-Forwarded-For, so not through the public proxy) from a loopback or
 *   private address is allowed without a token — for a scraper on the same
 *   private network as the API.
 *
 * Anything else gets a 404, so the endpoint does not advertise itself.
 */
@Injectable()
export class MetricsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (metricsAccessAllowed(req)) return true;
    throw new NotFoundException();
  }
}

export function metricsAccessAllowed(
  req: Pick<Request, 'headers'> & { socket?: { remoteAddress?: string } },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const token = env.METRICS_BEARER_TOKEN?.trim();
  const header = req.headers.authorization;
  if (token && token.length >= 16 && typeof header === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (m && sameSecret(m[1], token)) return true;
  }
  if (env.METRICS_ALLOW_PRIVATE_NETWORK === 'true') {
    // Through a proxy the socket peer is the proxy itself, which is usually
    // on a private network: a forwarded request is never "internal".
    if (req.headers['x-forwarded-for'] || req.headers.forwarded) return false;
    return isPrivateAddress(req.socket?.remoteAddress ?? '');
  }
  return false;
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function isPrivateAddress(raw: string): boolean {
  const addr = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  const kind = isIP(addr);
  if (kind === 4) {
    const [a, b] = addr.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (kind === 6) {
    const lower = addr.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80:')
    );
  }
  return false;
}
