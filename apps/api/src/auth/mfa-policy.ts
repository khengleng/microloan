import { ForbiddenException } from '@nestjs/common';
import { lending } from '@microloan/shared';
import { operationalConfig } from '../config/operational-config';
import { canonicalRole } from '../authz/role-permissions';

/**
 * Who must use an authenticator, and how recent a code has to be.
 *
 * Two error codes reach the web client, which reacts to each:
 *  - MFA_ENROLMENT_REQUIRED: the person must enrol an authenticator (and sign
 *    in with it) before anything but the enrolment routes answers; the web
 *    sends them to My account (D-128).
 *  - MFA_STEP_UP_REQUIRED: the session was signed in with an authenticator,
 *    but not recently enough for this action; the web asks for a fresh code
 *    (POST /auth/mfa/step-up) and retries (D-129).
 */
export const MFA_ENROLMENT_REQUIRED = 'MFA_ENROLMENT_REQUIRED';
export const MFA_STEP_UP_REQUIRED = 'MFA_STEP_UP_REQUIRED';

export interface MfaClaims {
  amr?: 'pwd' | 'mfa' | string;
  /** Seconds since the epoch when an authenticator code was last verified. */
  mfaAt?: number | null;
}

/** The freshness window for MFA-gated actions, in milliseconds. */
export function mfaStepUpWindowMs(): number {
  return operationalConfig().auth.mfaStepUpMinutes * 60_000;
}

/**
 * Whether the session's authenticator code is recent enough for an
 * MFA-gated action. A session without `mfaAt` (issued before this check
 * existed) is never fresh.
 */
export function mfaIsFresh(claims: MfaClaims, now = Date.now()): boolean {
  if (claims.amr !== 'mfa') return false;
  if (typeof claims.mfaAt !== 'number' || !Number.isFinite(claims.mfaAt))
    return false;
  const at = claims.mfaAt * 1000;
  // A timestamp from the future is not trusted as fresh.
  if (at > now + 60_000) return false;
  return now - at <= mfaStepUpWindowMs();
}

export function stepUpRequired(
  message = 'Confirm it is you: enter a fresh code from your authenticator app.',
): ForbiddenException {
  return new ForbiddenException({ message, code: MFA_STEP_UP_REQUIRED });
}

/** Refuse unless the caller's authenticator code is recent enough. */
export function assertFreshMfa(claims: MfaClaims, message?: string): void {
  if (!mfaIsFresh(claims)) throw stepUpRequired(message);
}

export function enrolmentRequired(): ForbiddenException {
  return new ForbiddenException({
    code: MFA_ENROLMENT_REQUIRED,
    message:
      'Your role requires an authenticator. Set one up under My account, then continue.',
  });
}

/**
 * Whether this role must use an authenticator for every route but enrolment.
 * SUPERADMIN follows the deployment setting; a tenant administrator follows
 * the tenant's lending settings (`security.requireMfaForAdmins`), passed in
 * already parsed — or `undefined` when unreadable, which fails closed.
 */
export function roleRequiresMfa(
  role: string,
  tenantSettings?: { security?: { requireMfaForAdmins?: boolean } } | null,
): boolean {
  const r = canonicalRole(role);
  if (r === 'SUPERADMIN') return operationalConfig().auth.mfaRequiredSuperadmin;
  if (r === 'TENANT_ADMIN')
    return tenantSettings?.security?.requireMfaForAdmins ?? true;
  return false;
}

/**
 * The tenant setting from a stored settings document; an unreadable document
 * fails closed (the requirement stays on).
 */
export function adminMfaSettingFrom(raw: unknown): {
  security: { requireMfaForAdmins: boolean };
} {
  if (raw === undefined || raw === null)
    return lending.defaultTenantLendingSettings();
  const parsed = lending.tenantLendingSettingsSchema.safeParse(raw);
  return parsed.success
    ? parsed.data
    : { security: { requireMfaForAdmins: true } };
}
