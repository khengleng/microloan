/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Integration harness: boots the real AppModule (all global guards, the JWT
 * strategy and the Prisma tenant guard) against a migrated PostgreSQL
 * database, creates a fixture organisation, and issues real access tokens.
 *
 * Requires LENDING_TEST_DATABASE_URL pointing at a database migrated with
 * `prisma migrate deploy`. The suites skip themselves when it is not set.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

export const TEST_DB = process.env.LENDING_TEST_DATABASE_URL;

/**
 * The API under test connects as the unprivileged role created by
 * scripts/lending-test-db.mjs, so row-level security applies to it exactly
 * as it would to a correctly configured production role.
 */
export function appDatabaseUrl(): string | undefined {
  if (process.env.LENDING_TEST_APP_DATABASE_URL)
    return process.env.LENDING_TEST_APP_DATABASE_URL;
  if (!TEST_DB) return undefined;
  const u = new URL(TEST_DB);
  u.username = 'lending_app_test';
  u.password = 'lending_app_test';
  return u.toString();
}

export function configureEnv() {
  process.env.DATABASE_URL = appDatabaseUrl();
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET ||
    'test-access-secret-test-access-secret-0123456789';
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET ||
    'test-refresh-secret-test-refresh-secret-012345678';
  process.env.JWT_REFRESH_TOKEN_PEPPER =
    process.env.JWT_REFRESH_TOKEN_PEPPER || 'test-pepper-0123456789';
  process.env.FIELD_ENCRYPTION_KEY =
    process.env.FIELD_ENCRYPTION_KEY || 'a'.repeat(64);
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.LENDING_OUTBOX_DISABLED = 'true';
}

export interface Fixture {
  app: INestApplication;
  prisma: any;
  system: (fn: () => Promise<any>) => Promise<any>;
  tokens: Record<string, string>;
  users: Record<
    string,
    {
      id: string;
      tenantId: string | null;
      role: string;
      branchId?: string | null;
    }
  >;
  t1: string;
  t2: string;
  b1: string;
  b2: string;
  b3: string;
  http: () => ReturnType<typeof request>;
  as: (user: string) => {
    get: (url: string) => request.Test;
    post: (url: string, body?: unknown, key?: string) => request.Test;
    put: (url: string, body?: unknown) => request.Test;
  };
}

export async function bootstrap(): Promise<Fixture> {
  configureEnv();
  // Imported after env is configured: modules read env at import time.
  const { AppModule } = require('../../src/app.module');
  const { PrismaService } = require('../../src/prisma/prisma.service');
  const { runAsSystem } = require('../../src/prisma/tenant-context');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: ['error'],
  });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useBodyParser('json', { limit: '5mb' });
  await app.init();
  // Bind one port for the whole suite. Left unbound, supertest opens a fresh
  // ephemeral port per request, and another local process can take it between
  // requests and answer instead of the app.
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  const system = (fn: () => Promise<any>): Promise<any> =>
    runAsSystem('integration test fixture', fn);

  const suffix = randomUUID().slice(0, 8);
  const { t1, t2, b1, b2, b3, users } = await system(async () => {
    const t1 = (
      await prisma.tenant.create({
        data: { name: `Test Lender ${suffix}`, status: 'ACTIVE' },
      })
    ).id;
    const t2 = (
      await prisma.tenant.create({
        data: { name: `Other Lender ${suffix}`, status: 'ACTIVE' },
      })
    ).id;
    const b1 = (
      await prisma.branch.create({
        data: { tenantId: t1, name: 'Phnom Penh', code: 'PNH' },
      })
    ).id;
    const b2 = (
      await prisma.branch.create({
        data: { tenantId: t1, name: 'Siem Reap', code: 'REP' },
      })
    ).id;
    const b3 = (
      await prisma.branch.create({
        data: { tenantId: t2, name: 'Battambang', code: 'BTB' },
      })
    ).id;
    for (const t of [t1, t2])
      await prisma.tenantBusinessDate.create({
        data: { tenantId: t, businessDate: new Date(Date.UTC(2026, 0, 5)) },
      });
    const mk = async (
      key: string,
      tenantId: string | null,
      role: string,
      branchId: string | null = null,
    ) => {
      const u = await prisma.user.create({
        data: {
          email: `${key}-${suffix}@test.local`,
          tenantId,
          branchId,
          role,
          passwordHash: 'x',
          twoFactorEnabled: true,
        },
      });
      return [key, { id: u.id, tenantId, role, branchId }] as const;
    };
    const entries = await Promise.all([
      mk('admin1', t1, 'TENANT_ADMIN'),
      mk('admin2', t1, 'TENANT_ADMIN'),
      mk('maker', t1, 'LOAN_OFFICER', b1),
      mk('checker', t1, 'LOAN_OFFICER', b1),
      mk('ro', t1, 'LOAN_OFFICER', b1),
      mk('ro2', t1, 'LOAN_OFFICER', b2),
      mk('analyst', t1, 'LOAN_OFFICER', b1),
      mk('approver', t1, 'LOAN_OFFICER', b1),
      mk('approver2', t1, 'LOAN_OFFICER', b1),
      mk('opsMaker', t1, 'LOAN_OFFICER', b1),
      mk('opsChecker', t1, 'LOAN_OFFICER', b1),
      mk('finance', t1, 'LOAN_OFFICER', b1),
      mk('financeB2', t1, 'LOAN_OFFICER', b2),
      mk('nobody', t1, 'LOAN_OFFICER', b1),
      mk('t2admin', t2, 'TENANT_ADMIN'),
      mk('t2ops', t2, 'LOAN_OFFICER', b3),
      mk('platform', null, 'SUPERADMIN'),
    ]);
    return { t1, t2, b1, b2, b3, users: Object.fromEntries(entries) };
  });

  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tokens: Record<string, string> = {};
  for (const [k, u] of Object.entries(users as Fixture['users'])) {
    tokens[k] = jwt.sign(
      {
        sub: u.id,
        email: `${k}-${suffix}@test.local`,
        role: u.role,
        tenantId: u.tenantId,
        branchId: u.branchId,
        amr: 'mfa',
        // When the authenticator code was verified (D-129): MFA-gated actions
        // need it within AUTH_MFA_STEP_UP_MINUTES.
        mfaAt: Math.floor(Date.now() / 1000),
      },
      { expiresIn: '1h' },
    );
  }
  tokens.approverNoMfa = jwt.sign(
    {
      sub: users.approver.id,
      email: `approver-${suffix}@test.local`,
      role: 'LOAN_OFFICER',
      tenantId: t1,
      branchId: b1,
      amr: 'pwd',
    },
    { expiresIn: '1h' },
  );

  const http = () => request(app.getHttpServer());
  const as = (user: string) => ({
    get: (url: string) =>
      http().get(`/v1${url}`).set('Authorization', `Bearer ${tokens[user]}`),
    post: (url: string, body?: unknown, key?: string) => {
      const r = http()
        .post(`/v1${url}`)
        .set('Authorization', `Bearer ${tokens[user]}`);
      if (key) r.set('Idempotency-Key', key);
      return r.send((body ?? {}) as object);
    },
    put: (url: string, body?: unknown) =>
      http()
        .put(`/v1${url}`)
        .set('Authorization', `Bearer ${tokens[user]}`)
        .send((body ?? {}) as object),
  });
  return { app, prisma, system, tokens, users, t1, t2, b1, b2, b3, http, as };
}

/** Grant lending roles directly (fixture shortcut; the assignment approval flow is tested separately). */
export async function grant(
  f: Fixture,
  tenantId: string,
  user: string,
  roleCode: string,
  scope: { allBranches?: boolean; branchIds?: string[] } = {
    allBranches: true,
  },
) {
  const {
    AccessAdminService,
  } = require('../../src/lending/access/access-admin.service');
  const access = f.app.get(AccessAdminService);
  await f.system(async () => {
    await access.ensureSystemRoles(tenantId);
    const role = await f.prisma.accessRole.findFirst({
      where: { tenantId, code: roleCode },
    });
    await f.prisma.roleAssignment.create({
      data: {
        tenantId,
        userId: f.users[user].id,
        roleId: role.id,
        allBranches: !!scope.allBranches,
        branchIds: scope.branchIds ?? [],
        status: 'ACTIVE',
        requestedBy: 'fixture',
        approvedBy: 'fixture',
      },
    });
    await f.prisma.tenant.update({
      where: { id: tenantId },
      data: { authzVersion: { increment: 1 } },
    });
  });
}

/**
 * Opt a tenant out of the legacy freeze (D-097): an ACTIVE TENANT rule that
 * switches `lending.legacy_loans.readonly` off, as two administrators would
 * approve it (fixture shortcut; the approval flow is tested in
 * legacy-freeze.int-spec). Returns the rule id.
 */
export async function openLegacyBook(
  f: Fixture,
  tenantId: string,
): Promise<string> {
  return f.system(async () => {
    const rule = await f.prisma.flagRule.create({
      data: {
        tenantId,
        flagKey: 'lending.legacy_loans.readonly',
        scopeType: 'TENANT',
        enabled: false,
        status: 'ACTIVE',
      },
    });
    return rule.id as string;
  });
}

/** Undo openLegacyBook: the tenant falls back to the frozen default. */
export async function closeLegacyBook(f: Fixture, ruleId: string) {
  await f.system(() =>
    f.prisma.flagRule.update({
      where: { id: ruleId },
      data: { status: 'SUPERSEDED' },
    }),
  );
}

export async function authority(
  f: Fixture,
  tenantId: string,
  user: string,
  permission: string,
  currency: string,
  maxAmount: string,
) {
  await f.system(async () => {
    await f.prisma.approvalAuthority.create({
      data: {
        tenantId,
        userId: f.users[user].id,
        permission,
        currency,
        maxAmount,
        status: 'ACTIVE',
        requestedBy: 'fixture',
        approvedBy: 'fixture',
      },
    });
    await f.prisma.tenant.update({
      where: { id: tenantId },
      data: { authzVersion: { increment: 1 } },
    });
  });
}

export async function borrower(
  f: Fixture,
  tenantId: string,
  branchId: string,
  over: Record<string, unknown> = {},
) {
  return f.system(() =>
    f.prisma.borrower.create({
      data: {
        tenantId,
        branchId,
        firstName: 'Sok',
        lastName: 'Dara',
        kycStatus: 'VERIFIED',
        dateOfBirth: new Date(Date.UTC(1985, 3, 12)),
        monthlyIncome: '3000',
        ...over,
      },
    }),
  );
}

let keySeq = 0;
export const key = (p = 'k') =>
  `${p}-${Date.now()}-${++keySeq}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Price a suite in a jurisdiction with a higher interest-rate cap than the
 * NBC's (DECISIONS D-105): its test vectors (a 24% line, a 12% flat loan that
 * is 21.45% on a reducing balance, a 30% over-limit rate) are textbook
 * figures, not Cambodian ones. Raises the deployment ceiling and the
 * fixture tenant's own cap; the returned function restores both.
 */
export async function raiseRateCap(
  f: Fixture,
  pct: string,
): Promise<() => Promise<void>> {
  const before = process.env.REGULATORY_MAX_ANNUAL_RATE_PCT;
  process.env.REGULATORY_MAX_ANNUAL_RATE_PCT = pct;
  const previous = await f.system(() =>
    f.prisma.tenant.findUnique({
      where: { id: f.t1 },
      select: { maxAnnualInterestRatePct: true },
    }),
  );
  await f.system(() =>
    f.prisma.tenant.update({
      where: { id: f.t1 },
      data: { maxAnnualInterestRatePct: pct },
    }),
  );
  return async () => {
    if (before === undefined) delete process.env.REGULATORY_MAX_ANNUAL_RATE_PCT;
    else process.env.REGULATORY_MAX_ANNUAL_RATE_PCT = before;
    await f.system(() =>
      f.prisma.tenant.update({
        where: { id: f.t1 },
        data: { maxAnnualInterestRatePct: previous.maxAnnualInterestRatePct },
      }),
    );
  };
}

export function expectOk(res: request.Response, status = [200, 201]) {
  if (!status.includes(res.status)) {
    throw new Error(
      `Expected ${status.join('/')} but got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body;
}

/**
 * A service account through its maker-checker flow: `maker` requests it,
 * `checker` approves it, and the maker collects the key once.
 */
export async function serviceAccount(
  f: Pick<Fixture, 'as'>,
  maker: string,
  checker: string,
  body: { name: string; scopes: string[]; expiresInDays?: number },
): Promise<{ id: string; key: string; scopes: string[] }> {
  const req = expectOk(
    await f.as(maker).post('/lending/access/service-accounts', body),
  );
  expectOk(
    await f
      .as(checker)
      .post(`/lending/access/service-account-requests/${req.id}/decision`, {
        approve: true,
      }),
  );
  return expectOk(
    await f
      .as(maker)
      .post(`/lending/access/service-account-requests/${req.id}/issue`),
  );
}
