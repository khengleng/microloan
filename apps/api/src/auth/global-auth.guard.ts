import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PERMISSIONS_KEY } from '../authz/require-permissions.decorator';
import { ROLES_KEY } from './roles.decorator';
import {
  IS_ANY_AUTHENTICATED_KEY,
  IS_BORROWER_ROUTE_KEY,
  IS_MFA_ENROLMENT_ROUTE_KEY,
  IS_PUBLIC_KEY,
} from './auth-scope.decorator';
import { enrolmentRequired, stepUpRequired } from './mfa-policy';

/**
 * Global, fail-closed authentication + authorization-declaration gate.
 *
 * Previously the only global guard was the rate limiter; authentication was
 * opted into per controller with `@UseGuards(JwtAuthGuard, ...)`. A controller
 * that forgot the decorator was fully anonymous, and one that had JwtAuthGuard
 * but neither `@Roles()` nor `@RequirePermissions()` was open to every
 * authenticated user in every tenant.
 *
 * This guard inverts both defaults. A route reaches its handler only if it:
 *   1. is explicitly `@Public()`, or
 *   2. is explicitly `@BorrowerRoute()` (authenticated by BorrowerJwtGuard), or
 *   3. carries a valid staff JWT *and* declares its authorization with at
 *      least one of `@Roles()` / `@RequirePermissions()`.
 *
 * Rule 3 is the important one: forgetting to declare authorization is now a
 * 403 on first request rather than an unnoticed open endpoint.
 */
@Injectable()
export class GlobalAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    // The borrower portal supplies its own principal via BorrowerJwtGuard,
    // which also publishes the tenant context for the Prisma wall.
    if (
      this.reflector.getAllAndOverride<boolean>(IS_BORROWER_ROUTE_KEY, targets)
    ) {
      return true;
    }

    // Authenticate first — this runs JwtStrategy.validate, which is what
    // establishes the request's tenant context.
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    // A role that must use an authenticator (SUPERADMIN; TENANT_ADMIN unless
    // the tenant turned it off) reaches only the enrolment routes until it
    // has one enrolled and the session was signed in with it (D-128).
    const user = context.switchToHttp().getRequest()?.user as
      | { mfaRequired?: boolean; mfaEnrolled?: boolean; amr?: string }
      | undefined;
    if (
      user?.mfaRequired &&
      !(user.mfaEnrolled && user.amr === 'mfa') &&
      !this.reflector.getAllAndOverride<boolean>(IS_MFA_ENROLMENT_ROUTE_KEY, targets)
    ) {
      if (!user.mfaEnrolled) throw enrolmentRequired();
      // Enrolled, but this session predates it: a fresh code upgrades it.
      throw stepUpRequired(
        'Your role requires signing in with your authenticator. Enter a code from your authenticator app to continue.',
      );
    }

    if (
      this.reflector.getAllAndOverride<boolean>(
        IS_ANY_AUTHENTICATED_KEY,
        targets,
      )
    ) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<unknown[]>(
      ROLES_KEY,
      targets,
    );
    const permissions = this.reflector.getAllAndOverride<unknown[]>(
      PERMISSIONS_KEY,
      targets,
    );
    if ((roles?.length ?? 0) === 0 && (permissions?.length ?? 0) === 0) {
      throw new ForbiddenException(
        'This endpoint declares no authorization policy. Add @Roles() or ' +
          '@RequirePermissions(), or mark it @Public() if it is intentionally open.',
      );
    }

    return true;
  }
}
