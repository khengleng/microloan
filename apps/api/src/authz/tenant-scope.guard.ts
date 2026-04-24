import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthzService } from './authz.service';

@Injectable()
export class TenantScopeGuard implements CanActivate {
  constructor(private readonly authz: AuthzService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!this.authz.isPlatform(user) && !user?.tenantId) {
      this.authz.assertTenantAccess(user, null);
    }
    return true;
  }
}

