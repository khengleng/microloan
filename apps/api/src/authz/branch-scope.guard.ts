import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthzService } from './authz.service';

@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(private readonly authz: AuthzService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    const branchId = req.params?.branchId || req.body?.branchId || req.query?.branchId;
    if (branchId) {
      this.authz.assertBranchAccess(user, branchId);
    }
    return true;
  }
}

