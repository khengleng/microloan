import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthzService } from './authz.service';
import {
  IS_BORROWER_ROUTE_KEY,
  IS_PUBLIC_KEY,
} from '../auth/auth-scope.decorator';

/**
 * Inner wall: branch-level ABAC, applied globally.
 *
 * Branch-confined roles (BRANCH_MANAGER, LOAN_OFFICER, CUSTOMER_SUPPORT)
 * cannot name a branch other than their own in a request. Services still call
 * `assertBranchAccess` on the resources they load — this catches the parameter
 * before the lookup, and covers routes that forget to.
 */
@Injectable()
export class BranchScopeGuard implements CanActivate {
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
    if (!user?.role) return true;

    const branchId =
      req.params?.branchId ?? req.body?.branchId ?? req.query?.branchId;
    if (branchId) {
      this.authz.assertBranchAccess(user, branchId);
    }
    return true;
  }
}
