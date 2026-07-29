import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthzService } from './authz.service';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { Permission } from './permission.enum';
import { ROLES_KEY } from '../auth/roles.decorator';
import { IS_ANY_AUTHENTICATED_KEY, IS_PUBLIC_KEY } from '../auth/auth-scope.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);

    if (!required?.length) {
      // Mirror of RolesGuard: no permission declared is only acceptable when
      // the route is explicitly public or gated on a role instead.
      if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
      if (this.reflector.getAllAndOverride<boolean>(IS_ANY_AUTHENTICATED_KEY, targets)) return true;
      const roles = this.reflector.getAllAndOverride<unknown[]>(ROLES_KEY, targets);
      return (roles?.length ?? 0) > 0;
    }

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    for (const permission of required) {
      this.authz.assertPermission(user, permission);
    }
    return true;
  }
}

