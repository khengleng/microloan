import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionGuard } from '../authz/permission.guard';
import { AuthzService } from '../authz/authz.service';
import { LoansController } from './loans.controller';

/**
 * PUT /loans/:id/status admits every role that decides a step of a loan;
 * the service then requires the step's own permission.
 */
describe('PUT /loans/:id/status route guards', () => {
  const reflector = new Reflector();
  const roles = new RolesGuard(reflector);
  const perms = new PermissionGuard(reflector, new AuthzService({} as any));
  const ctx = (role: string) =>
    ({
      getHandler: () => LoansController.prototype.changeStatus,
      getClass: () => LoansController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 'u', role, tenantId: 't1', permissions: [] } }),
      }),
    }) as any;
  const passes = (role: string) => {
    try {
      return roles.canActivate(ctx(role)) && perms.canActivate(ctx(role));
    } catch {
      return false;
    }
  };

  it.each(['APPROVER', 'ACCOUNTANT', 'FINANCE', 'TENANT_ADMIN', 'BRANCH_MANAGER'])(
    '%s reaches the service',
    (role) => expect(passes(role)).toBe(true),
  );

  it('platform operators and borrowers do not', () => {
    expect(passes('SUPERADMIN')).toBe(false);
    expect(passes('BORROWER')).toBe(false);
  });
});
