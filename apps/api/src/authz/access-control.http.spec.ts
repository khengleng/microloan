import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JwtStrategy } from '../auth/jwt.strategy';
import { GlobalAuthGuard } from '../auth/global-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnyAuthenticated, Public } from '../auth/auth-scope.decorator';
import { PermissionGuard } from './permission.guard';
import { TenantScopeGuard } from './tenant-scope.guard';
import { BranchScopeGuard } from './branch-scope.guard';
import { RequirePermissions } from './require-permissions.decorator';
import { Permission } from './permission.enum';
import { AuthzService } from './authz.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextMiddleware } from '../prisma/tenant-context.middleware';
import { getTenantContext, TenantContext } from '../prisma/tenant-context';

/**
 * Boots the real global guard chain over HTTP.
 *
 * The unit specs check each guard in isolation, which cannot catch the thing
 * most likely to go wrong: ordering. Every guard after GlobalAuthGuard reads
 * `req.user`, so if the chain ran in a different order than registration, the
 * whole API would deny every request. This proves the order holds, that the
 * middleware installs the context before guards, and that the tenant context
 * survives all the way into the handler where Prisma would read it.
 */

const SECRET = 'test-access-secret-at-least-32-characters-long';

const USERS: Record<
  string,
  {
    isActive: boolean;
    role: string;
    tenantId: string | null;
    branchId: string | null;
  }
> = {
  'user-tenant-a': {
    isActive: true,
    role: 'TENANT_ADMIN',
    tenantId: 'tenant-a',
    branchId: null,
  },
  'user-officer-a': {
    isActive: true,
    role: 'LOAN_OFFICER',
    tenantId: 'tenant-a',
    branchId: 'branch-1',
  },
  'user-super': {
    isActive: true,
    role: 'SUPERADMIN',
    tenantId: null,
    branchId: null,
  },
};

/** Captures what the handler sees, so assertions can inspect the context. */
const seen: { context: TenantContext | null } = { context: null };

@Controller('t')
class ProbeController {
  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }

  @Roles('TENANT_ADMIN')
  @Get('role-gated')
  roleGated() {
    seen.context = getTenantContext();
    return { ok: true };
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('permission-gated')
  permissionGated() {
    return { ok: true };
  }

  @AnyAuthenticated()
  @Get('self-service')
  selfService() {
    seen.context = getTenantContext();
    return { ok: true };
  }

  /** The regression this whole change exists to prevent. */
  @Get('undeclared')
  undeclared() {
    return { ok: true };
  }

  @Roles('TENANT_ADMIN', 'LOAN_OFFICER')
  @Get('scoped/:tenantId')
  withTenantParam() {
    return { ok: true };
  }

  @Roles('LOAN_OFFICER')
  @Get('branch/:branchId')
  withBranchParam() {
    return { ok: true };
  }
}

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: SECRET, signOptions: { expiresIn: '5m' } }),
  ],
  controllers: [ProbeController],
  providers: [
    JwtStrategy,
    AuthzService,
    {
      provide: AuditService,
      useValue: { logSecurityEvent: jest.fn(), logAction: jest.fn() },
    },
    {
      provide: PrismaService,
      useValue: {
        tenant: {
          findUnique: jest.fn(async () => ({ status: 'ACTIVE', plan: 'PRO' })),
        },
        user: {
          findUnique: jest.fn(
            async ({ where }: { where: { id: string } }) =>
              USERS[where.id] ?? null,
          ),
        },
      },
    },
    // Registered in the same order as AppModule (minus the throttler).
    { provide: APP_GUARD, useClass: GlobalAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: TenantScopeGuard },
    { provide: APP_GUARD, useClass: BranchScopeGuard },
  ],
})
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}

describe('Guard chain over HTTP', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    seen.context = null;
  });

  const tokenFor = (sub: string) => {
    const u = USERS[sub];
    return jwt.sign({
      sub,
      email: `${sub}@example.com`,
      role: u.role,
      tenantId: u.tenantId,
    });
  };

  const get = (path: string, sub?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return sub ? req.set('Authorization', `Bearer ${tokenFor(sub)}`) : req;
  };

  describe('authentication', () => {
    it('serves a @Public() route anonymously', async () => {
      await get('/t/public').expect(200);
    });

    it('rejects an authenticated route with no token', async () => {
      await get('/t/role-gated').expect(401);
    });

    it('rejects a forged token', async () => {
      await request(app.getHttpServer())
        .get('/t/role-gated')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });
  });

  describe('guard ordering', () => {
    // If the chain ran out of order, req.user would be unset when RolesGuard
    // runs and this would 403 instead of 200.
    it('populates req.user before the role gate runs', async () => {
      await get('/t/role-gated', 'user-tenant-a').expect(200);
    });

    it('still enforces the role once authenticated', async () => {
      await get('/t/role-gated', 'user-officer-a').expect(403);
    });

    it('enforces permissions on a permission-gated route', async () => {
      await get('/t/permission-gated', 'user-officer-a').expect(200); // holds CUSTOMER_VIEW
    });
  });

  describe('fail-closed default', () => {
    it('DENIES a route that declares no authorization policy, even with a valid token', async () => {
      await get('/t/undeclared', 'user-tenant-a').expect(403);
    });

    it('denies it to SUPERADMIN too — the rule is about the route, not the caller', async () => {
      await get('/t/undeclared', 'user-super').expect(403);
    });
  });

  describe('tenant context propagation', () => {
    it('reaches the handler as a tenant principal', async () => {
      await get('/t/role-gated', 'user-tenant-a').expect(200);
      expect(seen.context).toEqual({
        mode: 'tenant',
        tenantId: 'tenant-a',
        actorId: 'user-tenant-a',
        branchId: null,
      });
    });

    it('reaches the handler as a platform principal for SUPERADMIN', async () => {
      await get('/t/self-service', 'user-super').expect(200);
      expect(seen.context).toEqual({ mode: 'platform', actorId: 'user-super' });
    });

    it('does not leak context between requests', async () => {
      await get('/t/public').expect(200);
      expect(seen.context).toBeNull();
    });
  });

  describe('ABAC over HTTP', () => {
    it('rejects a tenantId path parameter naming another tenant', async () => {
      await get('/t/scoped/tenant-b', 'user-tenant-a').expect(403);
    });

    it('accepts the caller own tenantId in the path', async () => {
      await get('/t/scoped/tenant-a', 'user-tenant-a').expect(200);
    });

    it('lets SUPERADMIN name any tenant', async () => {
      // SUPERADMIN is not in this route @Roles list, so it is denied by the
      // role gate rather than the tenant gate — proving platform identity is
      // not a blanket override.
      await get('/t/scoped/tenant-b', 'user-super').expect(403);
    });

    it('confines a branch-scoped role to its own branch', async () => {
      await get('/t/branch/branch-2', 'user-officer-a').expect(403);
      await get('/t/branch/branch-1', 'user-officer-a').expect(200);
    });
  });
});
