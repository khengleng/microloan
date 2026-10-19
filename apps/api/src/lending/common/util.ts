import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { mfaIsFresh } from '../../auth/mfa-policy';

/** The principal performing a lending action. Built server-side; nothing here comes from the client. */
export interface LendingActor {
  id: string;
  /** CUSTOMER: a borrower signed in to the portal (id = borrower id). */
  type: 'USER' | 'SERVICE' | 'PLATFORM' | 'CUSTOMER';
  tenantId: string | null;
  legacyRole?: string;
  branchId?: string | null;
  assurance: 'SINGLE_FACTOR' | 'MFA' | 'SERVICE_KEY' | 'OTP';
  channel: 'STAFF_PORTAL' | 'BORROWER_PORTAL' | 'API' | 'SYSTEM';
  /** Service-account scopes. */
  scopes?: string[];
}

export function actorFromJwt(
  user: JwtPayload & { id?: string; isPlatform?: boolean },
): LendingActor {
  const platform = user.role === 'SUPERADMIN' || user.isPlatform === true;
  return {
    id: user.id ?? user.sub,
    type: platform ? 'PLATFORM' : 'USER',
    tenantId: platform ? null : user.tenantId,
    legacyRole: user.role,
    branchId: user.branchId ?? null,
    // MFA only while the authenticator code is recent (AUTH_MFA_STEP_UP_MINUTES,
    // D-129): a refreshed session keeps amr=mfa for weeks, its mfaAt does not move.
    assurance: mfaIsFresh(user) ? 'MFA' : 'SINGLE_FACTOR',
    channel: 'STAFF_PORTAL',
  };
}

/** A borrower-portal principal. The tenant comes from the verified borrower token, never the client. */
export function actorFromBorrower(session: {
  borrowerId: string;
  tenantId: string;
}): LendingActor {
  return {
    id: session.borrowerId,
    type: 'CUSTOMER',
    tenantId: session.tenantId,
    assurance: 'OTP',
    channel: 'BORROWER_PORTAL',
  };
}

export function requireTenant(actor: LendingActor): string {
  if (!actor.tenantId)
    throw new ForbiddenException(
      'Platform administrators have no access to tenant lending data.',
    );
  return actor.tenantId;
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** A @db.Date column value → "YYYY-MM-DD". Prisma returns dates at UTC midnight. */
export function toLocalDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function fromLocalDate(s: string): Date {
  lending.parseDate(s);
  return new Date(`${s}T00:00:00.000Z`);
}

// ── Decimals ────────────────────────────────────────────────────────────────

/** Prisma.Decimal | number | string → decimal string. Never via a JS float. */
export function decStr(
  v: Prisma.Decimal | string | number | null | undefined,
): string {
  if (v === null || v === undefined) return '0';
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v))
      throw new Error(`Refusing to convert fractional number ${v} to money`);
    return String(v);
  }
  return new lending.D(v.toString()).toString();
}

export const D = (v: Prisma.Decimal | string | number | null | undefined) =>
  new lending.D(decStr(v));

// ── Errors ──────────────────────────────────────────────────────────────────

/** Map engine errors to 400s with their stable code; leave HTTP errors alone. */
export function engineCall<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw toHttp(e);
  }
}

export function toHttp(e: unknown): unknown {
  if (e instanceof HttpException) return e;
  if (e instanceof Error && e.name === 'EngineError') {
    return new BadRequestException({
      message: e.message,
      code: (e as Error & { code?: string }).code,
    });
  }
  return e;
}

/** Raised when an optimistic version check loses a race. */
export function concurrentModification(what: string): ConflictException {
  return new ConflictException(
    `${what} was changed by another request. Reload and try again.`,
  );
}

// ── Hashing ─────────────────────────────────────────────────────────────────

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function requestHash(body: unknown): string {
  return sha256(lending.canonicalJson(body ?? null));
}

export function newReference(prefix: string): string {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
