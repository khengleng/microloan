import { Injectable, ExecutionContext, SetMetadata } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { clientIp } from './client-ip';
import { IS_PUBLIC_KEY } from '../auth/auth-scope.decorator';
import { borrowerJwtSecret } from '../borrower-portal/borrower-jwt';

/**
 * What a credential route is attacked THROUGH, besides the caller's address:
 *   email — the account a password / reset is tried against (body.email)
 *   phone — the borrower an OTP is requested or tried for (body.phone)
 *   mfa   — the account behind a verified MFA challenge token (body.mfaToken)
 */
export type ThrottleIdentityField = 'email' | 'phone' | 'mfa';
export const THROTTLE_IDENTITY_KEY = 'throttle:identity';

/**
 * Give a credential route a second budget keyed by the identity it targets,
 * with the same limit and window as its per-IP budget. The per-IP budget
 * stops one address trying many accounts; this one stops many addresses
 * hammering one account. Both must have room for the request to proceed.
 */
export const ThrottleIdentity = (field: ThrottleIdentityField) =>
  SetMetadata(THROTTLE_IDENTITY_KEY, field);

const fingerprint = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * Rate limiter keyed on who is calling, not on the hop that delivered it.
 *
 *   authenticated route + valid access token → `user:<sub>` (staff) or
 *                                              `borrower:<sub>` (portal)
 *   anything else                            → `ip:<client ip>`
 *
 * It runs BEFORE GlobalAuthGuard (guards run in registration order), so
 * `req.user` is never set yet. Instead the token is verified here — signature
 * and expiry only, no database read; a token that verifies but belongs to a
 * suspended account is still refused by the auth guard right after. Public
 * routes ignore any token: login and friends are budgeted by address (and by
 * target identity, see @ThrottleIdentity) so a valid session cannot buy an
 * attacker a fresh bucket.
 *
 * The client IP is the one the web server states when it authenticates with
 * WEB_PROXY_SECRET, else `req.ip` (common/client-ip.ts).
 *
 * NOTE: @SkipThrottle() is honoured by the parent's canActivate(); do not
 * override shouldSkip() or canActivate().
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService();

  protected async getTracker(
    req: Record<string, any>,
    context?: ExecutionContext,
  ): Promise<string> {
    const isPublic =
      context &&
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    if (!isPublic) {
      const principal = this.principalOf(req);
      if (principal) return principal;
    }
    return `ip:${clientIp(req)}`;
  }

  /**
   * After the per-caller budget, charge the per-identity budget on routes that
   * declare one. Reuses the parent's handling (headers, 429) with a tracker
   * that names the identity instead of the caller.
   */
  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    await super.handleRequest(props);
    const field = this.reflector.get<ThrottleIdentityField | undefined>(
      THROTTLE_IDENTITY_KEY,
      props.context.getHandler(),
    );
    if (!field) return true;
    const req = props.context.switchToHttp().getRequest();
    const identity = this.identityOf(req, field);
    if (!identity) return true;
    return super.handleRequest({
      ...props,
      getTracker: () => `${field}:${fingerprint(identity)}`,
    });
  }

  /** `user:<sub>` / `borrower:<sub>` for a verified access token, else null. */
  principalOf(req: Record<string, any>): string | null {
    const token = bearerToken(req) ?? cookieToken(req);
    if (!token) return null;
    const staffSecret = process.env.JWT_ACCESS_SECRET;
    if (!staffSecret) return null;
    const staff = this.verify(token, staffSecret);
    // An MFA challenge token is signed with the same secret but is not a session.
    if (staff?.sub && !staff.mfaChallenge && !staff.typ) return `user:${staff.sub}`;
    const borrower = this.verify(token, borrowerJwtSecret());
    if (borrower?.sub && borrower.typ === 'borrower') return `borrower:${borrower.sub}`;
    return null;
  }

  identityOf(req: Record<string, any>, field: ThrottleIdentityField): string | null {
    const body = req.body ?? {};
    if (field === 'email') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      return email || null;
    }
    if (field === 'phone') {
      const phone = typeof body.phone === 'string' ? body.phone.replace(/[^\d]/g, '') : '';
      return phone || null;
    }
    // mfa: only a challenge token this API issued names an account.
    const secret = process.env.JWT_ACCESS_SECRET;
    const token = typeof body.mfaToken === 'string' ? body.mfaToken : '';
    if (!secret || !token) return null;
    const payload = this.verify(token, secret);
    return payload?.mfaChallenge && payload.sub ? String(payload.sub) : null;
  }

  private verify(token: string, secret: string): Record<string, any> | null {
    try {
      return this.jwt.verify(token, { secret });
    } catch {
      return null;
    }
  }
}

function bearerToken(req: Record<string, any>): string | null {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function cookieToken(req: Record<string, any>): string | null {
  const value = req.cookies?.access_token;
  return typeof value === 'string' && value ? value : null;
}
