import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionGuard } from './permission.guard';
import { TenantScopeGuard } from './tenant-scope.guard';
import { BranchScopeGuard } from './branch-scope.guard';
import { AuthzService } from './authz.service';
import { Permission } from './permission.enum';
import { permissionsForRole } from './role-permissions';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from './require-permissions.decorator';
import { AnyAuthenticated, Public } from '../auth/auth-scope.decorator';
import { TenantsController } from '../tenants/tenants.controller';

const reflector = new Reflector();
const audit = { logSecurityEvent: jest.fn() } as any;
const authz = new AuthzService(audit);

/** Routes with every shape of authorization declaration the API allows. */
class Routes {
  @Roles('TENANT_ADMIN')
  roleOnly() {}

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  permissionOnly() {}

  @Public()
  publicRoute() {}

  @AnyAuthenticated()
  selfService() {}

  /** The dangerous case: a handler that declares nothing at all. */
  undeclared() {}
}

const ctx = (handler: keyof Routes, req: Record<string, unknown> = {}) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
  }) as any;

describe('RBAC — role gate', () => {
  const guard = new RolesGuard(reflector);

  it('admits a matching role', () => {
    expect(
      guard.canActivate(ctx('roleOnly', { user: { role: 'TENANT_ADMIN' } })),
    ).toBe(true);
  });

  it('canonicalises legacy role names on both sides', () => {
    // ADMIN is the legacy alias of TENANT_ADMIN — a user holding either name
    // must match a route declaring either name.
    expect(
      guard.canActivate(ctx('roleOnly', { user: { role: 'ADMIN' } })),
    ).toBe(true);
  });

  it('rejects a non-matching role', () => {
    expect(
      guard.canActivate(ctx('roleOnly', { user: { role: 'LOAN_OFFICER' } })),
    ).toBe(false);
  });

  it('does not admit SUPERADMIN to a tenant route it was not listed on', () => {
    // Platform identity is not a wildcard at the role gate; SUPERADMIN reaches
    // only routes that name it.
    expect(
      guard.canActivate(ctx('roleOnly', { user: { role: 'SUPERADMIN' } })),
    ).toBe(false);
  });

  it('FAILS CLOSED on a handler that declares no policy', () => {
    expect(
      guard.canActivate(ctx('undeclared', { user: { role: 'TENANT_ADMIN' } })),
    ).toBe(false);
  });

  it('defers to a permission declaration when no role is named', () => {
    expect(
      guard.canActivate(
        ctx('permissionOnly', { user: { role: 'LOAN_OFFICER' } }),
      ),
    ).toBe(true);
  });

  it('admits explicitly public and explicitly self-service routes', () => {
    expect(guard.canActivate(ctx('publicRoute'))).toBe(true);
    expect(
      guard.canActivate(ctx('selfService', { user: { role: 'AUDITOR' } })),
    ).toBe(true);
  });
});

describe('RBAC — permission gate', () => {
  const guard = new PermissionGuard(reflector, authz);

  it('admits a role holding the permission', () => {
    expect(
      guard.canActivate(
        ctx('permissionOnly', {
          user: { role: 'LOAN_OFFICER', tenantId: 't' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects a role lacking the permission', () => {
    expect(() =>
      guard.canActivate(
        ctx('permissionOnly', { user: { role: 'ACCOUNTANT', tenantId: 't' } }),
      ),
    ).not.toThrow(); // ACCOUNTANT does hold CUSTOMER_VIEW
    expect(() =>
      guard.canActivate(
        ctx('permissionOnly', { user: { role: 'BORROWER', tenantId: 't' } }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('FAILS CLOSED on a handler that declares no policy', () => {
    expect(
      guard.canActivate(ctx('undeclared', { user: { role: 'TENANT_ADMIN' } })),
    ).toBe(false);
  });
});

describe('ABAC — tenant scope', () => {
  const guard = new TenantScopeGuard(authz, reflector);

  it('rejects a tenant-less non-platform principal', () => {
    expect(() =>
      guard.canActivate(
        ctx('roleOnly', { user: { role: 'TENANT_ADMIN', tenantId: null } }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a tenantId in the query string that is not the caller own', () => {
    expect(() =>
      guard.canActivate(
        ctx('roleOnly', {
          user: { role: 'TENANT_ADMIN', tenantId: 'tenant-a' },
          query: { tenantId: 'tenant-b' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a tenantId smuggled through the request body', () => {
    expect(() =>
      guard.canActivate(
        ctx('roleOnly', {
          user: { role: 'LOAN_OFFICER', tenantId: 'tenant-a' },
          body: { tenantId: 'tenant-b' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a tenantId smuggled through a path parameter', () => {
    expect(() =>
      guard.canActivate(
        ctx('roleOnly', {
          user: { role: 'LOAN_OFFICER', tenantId: 'tenant-a' },
          params: { tenantId: 'tenant-b' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('permits the caller naming their own tenant', () => {
    expect(
      guard.canActivate(
        ctx('roleOnly', {
          user: { role: 'TENANT_ADMIN', tenantId: 'tenant-a' },
          query: { tenantId: 'tenant-a' },
        }),
      ),
    ).toBe(true);
  });

  it('permits SUPERADMIN to name any tenant', () => {
    expect(
      guard.canActivate(
        ctx('roleOnly', {
          user: { role: 'SUPERADMIN', tenantId: null },
          params: { tenantId: 'tenant-b' },
        }),
      ),
    ).toBe(true);
  });

  it('does not touch public routes', () => {
    expect(guard.canActivate(ctx('publicRoute'))).toBe(true);
  });
});

describe('ABAC — branch scope', () => {
  const guard = new BranchScopeGuard(authz, reflector);

  it('confines a branch-scoped role to its own branch', () => {
    expect(() =>
      guard.canActivate(
        ctx('roleOnly', {
          user: { role: 'LOAN_OFFICER', tenantId: 't', branchId: 'br-1' },
          params: { branchId: 'br-2' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('permits a branch-scoped role within its own branch', () => {
    expect(
      guard.canActivate(
        ctx('roleOnly', {
          user: { role: 'LOAN_OFFICER', tenantId: 't', branchId: 'br-1' },
          params: { branchId: 'br-1' },
        }),
      ),
    ).toBe(true);
  });

  it('does not confine a tenant-wide role', () => {
    expect(
      guard.canActivate(
        ctx('roleOnly', {
          user: { role: 'TENANT_ADMIN', tenantId: 't', branchId: 'br-1' },
          params: { branchId: 'br-2' },
        }),
      ),
    ).toBe(true);
  });
});

describe('AuthzService — service-layer invariants', () => {
  it('scopeWhere pins a tenant actor and leaves platform unscoped', () => {
    expect(
      authz.scopeWhere({ role: 'TENANT_ADMIN', tenantId: 'a' }, { id: 'x' }),
    ).toEqual({
      id: 'x',
      tenantId: 'a',
    });
    expect(
      authz.scopeWhere({ role: 'SUPERADMIN', tenantId: null }, { id: 'x' }),
    ).toEqual({
      id: 'x',
    });
  });

  it('scopeWhere refuses to build a query for a tenant-less non-platform actor', () => {
    expect(() =>
      authz.scopeWhere({ role: 'TENANT_ADMIN', tenantId: null }, {}),
    ).toThrow(ForbiddenException);
  });

  it('assertPlatformOnly admits only a tenant-less SUPERADMIN', () => {
    expect(() =>
      authz.assertPlatformOnly({ role: 'SUPERADMIN', tenantId: null }),
    ).not.toThrow();
    expect(() =>
      authz.assertPlatformOnly({ role: 'SUPERADMIN', tenantId: 'a' }),
    ).toThrow();
    expect(() =>
      authz.assertPlatformOnly({ role: 'TENANT_ADMIN', tenantId: 'a' }),
    ).toThrow();
  });

  it('assertMakerChecker blocks self-approval', () => {
    const actor = { id: 'u1', role: 'APPROVER', tenantId: 'a' };
    expect(() =>
      authz.assertMakerChecker(actor, 'u1', Permission.LOAN_APPROVE),
    ).toThrow(ForbiddenException);
    expect(() =>
      authz.assertMakerChecker(actor, 'u2', Permission.LOAN_APPROVE),
    ).not.toThrow();
  });

  it('blocks a tenant admin from minting a SUPERADMIN', () => {
    expect(() =>
      authz.assertCanAssignRole(
        { role: 'TENANT_ADMIN', tenantId: 'a' },
        'SUPERADMIN',
      ),
    ).toThrow(ForbiddenException);
  });
});

describe('Platform ownership — only SUPERADMIN acts on tenants', () => {
  const TENANT_PERMISSIONS = [
    Permission.TENANT_VIEW,
    Permission.TENANT_CREATE,
    Permission.TENANT_UPDATE,
    Permission.TENANT_SUSPEND,
  ];

  const TENANT_ROLES = [
    'TENANT_ADMIN',
    'BRANCH_MANAGER',
    'LOAN_OFFICER',
    'CREDIT_OFFICER',
    'APPROVER',
    'ACCOUNTANT',
    'AUDITOR',
    'CUSTOMER_SUPPORT',
    'BORROWER',
    // legacy aliases still accepted on existing tokens
    'ADMIN',
    'OPERATOR',
    'FINANCE',
    'SALES',
    'CX',
  ];

  it('grants SUPERADMIN every permission in the enum', () => {
    const held = permissionsForRole('SUPERADMIN');
    for (const permission of Object.values(Permission)) {
      expect(held.has(permission)).toBe(true);
    }
  });

  it.each(TENANT_ROLES)(
    'withholds every TENANT_* permission from %s',
    (role) => {
      const held = permissionsForRole(role);
      for (const permission of TENANT_PERMISSIONS) {
        expect(held.has(permission)).toBe(false);
      }
    },
  );

  it('declares @Roles(SUPERADMIN) on every route of the tenants controller', () => {
    const handlers = Object.getOwnPropertyNames(
      TenantsController.prototype,
    ).filter((name) => name !== 'constructor');
    expect(handlers.length).toBeGreaterThan(0);

    for (const name of handlers) {
      const roles = reflector.get<string[]>(
        'roles',
        (TenantsController.prototype as any)[name],
      );
      expect({ handler: name, roles }).toEqual({
        handler: name,
        roles: ['SUPERADMIN'],
      });
    }
  });

  it('grants no role other than SUPERADMIN a permission the tenants controller requires', () => {
    for (const role of TENANT_ROLES) {
      const held = permissionsForRole(role);
      expect(TENANT_PERMISSIONS.some((p) => held.has(p))).toBe(false);
    }
  });
});
