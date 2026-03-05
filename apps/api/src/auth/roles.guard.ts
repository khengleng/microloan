import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@microloan/db';
import { ROLES_KEY } from './roles.decorator';

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

    // SUPERADMIN is a platform-level role. It only passes when the route
    // explicitly declares @Roles('SUPERADMIN'). Tenant-level routes
    // (borrowers, loans, repayments, etc.) do NOT list SUPERADMIN, so the
    // platform operator is correctly blocked from reading or writing
    // inside any tenant's operational data.
    return requiredRoles.includes(user?.role);
  }
}
