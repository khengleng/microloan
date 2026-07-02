import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@microloan/db';
import { ROLES_KEY } from './roles.decorator';
import { canonicalRole } from '../authz/role-permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles() decorator → route is accessible to any authenticated user
    if (!requiredRoles) return true;

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
