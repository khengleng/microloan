import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@microloan/db';
import { ROLES_KEY } from './roles.decorator';
import { canonicalRole } from '../authz/role-permissions';
import { PERMISSIONS_KEY } from '../authz/require-permissions.decorator';
import { IS_ANY_AUTHENTICATED_KEY, IS_PUBLIC_KEY } from './auth-scope.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);

    if (!requiredRoles?.length) {
      // Fail closed. A missing @Roles() used to mean "any authenticated user",
      // which made an omission indistinguishable from a deliberate decision.
      // The route must now say what it allows — either explicitly public, or
      // gated on a permission instead of a role.
      if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
      if (this.reflector.getAllAndOverride<boolean>(IS_ANY_AUTHENTICATED_KEY, targets)) return true;
      const permissions = this.reflector.getAllAndOverride<unknown[]>(PERMISSIONS_KEY, targets);
      return (permissions?.length ?? 0) > 0;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user?.role) return false;

    // Canonicalize both sides so legacy (ADMIN/OPERATOR/…) and canonical
    // (TENANT_ADMIN/LOAN_OFFICER/…) names match consistently — otherwise
    // canonically-named users are silently locked out of routes whose
    // @Roles(...) still use legacy names.
    //
    // SUPERADMIN remains platform-only: it passes only where a route
    // explicitly declares @Roles('SUPERADMIN'); tenant routes never list it.
    const userRole = canonicalRole(user.role);
    return requiredRoles.some((r) => canonicalRole(r as unknown as string) === userRole);
  }
}
