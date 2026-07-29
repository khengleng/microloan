import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthzService } from './authz.service';
import {
  IS_BORROWER_ROUTE_KEY,
  IS_PUBLIC_KEY,
} from '../auth/auth-scope.decorator';

/**
 * Request-level tenant wall, applied globally.
 *
 * Two jobs the Prisma guard cannot do, because they are about the request
 * rather than the query:
 *
 *  1. Every authenticated non-platform principal must carry a tenant. A
 *     tenant-less staff token has no wall to stand behind.
 *  2. A tenant id supplied by the client — in the path, body or query — must
 *     match the principal's own. Only SUPERADMIN may name another tenant.
 *
 * Rule 2 is what stops the classic `?tenantId=<victim>` parameter swap before
 * it ever reaches a service that might trust the value.
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  constructor(
    private readonly authz: AuthzService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;
    if (
      this.reflector.getAllAndOverride<boolean>(IS_BORROWER_ROUTE_KEY, targets)
    )
      return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    // Unauthenticated here means GlobalAuthGuard already rejected, or the
    // route is anonymous by another path — nothing to scope either way.
    if (!user?.role) return true;

    const isPlatform = this.authz.isPlatform(user);
    if (!isPlatform && !user.tenantId) {
      throw new ForbiddenException(
        'Tenant scope is required for this principal.',
      );
    }

    const claimed =
      req.params?.tenantId ?? req.body?.tenantId ?? req.query?.tenantId;
    if (claimed && !isPlatform && claimed !== user.tenantId) {
      throw new ForbiddenException('Cross-tenant access is forbidden.');
    }

    return true;
  }
}
