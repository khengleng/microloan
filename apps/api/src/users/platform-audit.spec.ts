import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';

/**
 * A platform super-administrator acting on a tenant's user is recorded in
 * that tenant's audit log, with the super-administrator as actor and the
 * entry flagged as a platform-operator action (D-130).
 */
describe('platform actions on tenant users are audited in the tenant', () => {
  const written: any[] = [];
  const prisma: any = {
    user: {
      findFirst: jest.fn(async () => ({
        id: 'u2', email: 'staff@lender.test', role: 'LOAN_OFFICER', tenantId: 't1', branchId: null,
        isActive: false, twoFactorEnabled: true, twoFactorSecret: 'enc',
      })),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({ id: 'u2', email: 'staff@lender.test', role: 'LOAN_OFFICER', isActive: true })),
      create: jest.fn(),
      count: jest.fn(async () => 0),
    },
    refreshToken: { updateMany: jest.fn() },
    auditLog: { create: jest.fn(async ({ data }: any) => written.push(data)) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const audit = new AuditService(prisma);
  const authz = new AuthzService(audit);
  const grants: any = { requestForNewAccount: jest.fn() };
  const service = new UsersService(prisma, audit, authz, { assertRoom: jest.fn() } as any, grants);
  const platform: any = {
    sub: 'sa1', role: 'SUPERADMIN', tenantId: null, branchId: null, permissions: [],
    amr: 'mfa', mfaAt: Math.floor(Date.now() / 1000),
  };

  beforeEach(() => {
    written.length = 0;
  });

  it.each([
    ['password reset', () => service.resetPassword(platform, 'u2', 'a-long-enough-password'), 'USER_PASSWORD_RESET'],
    ['authenticator reset', () => service.resetMfa(platform, 'u2'), 'USER_MFA_RESET'],
    ['reactivation', () => service.reactivate(platform, 'u2'), 'USER_REACTIVATE'],
  ])('%s', async (_label, run, action) => {
    await run();
    const entry = written.find((w) => w.action === action);
    expect(entry).toBeDefined();
    expect(entry.tenantId).toBe('t1');
    expect(entry.userId).toBe('sa1');
    expect(entry.metadata).toMatchObject({ actorRole: 'SUPERADMIN', platformOperator: true });
  });

  it('a tenant administrator acting in their own tenant is not flagged', async () => {
    const admin: any = { sub: 'a1', role: 'TENANT_ADMIN', tenantId: 't1', branchId: null, permissions: [] };
    await service.resetPassword(admin, 'u2', 'a-long-enough-password');
    const entry = written.find((w) => w.action === 'USER_PASSWORD_RESET');
    expect(entry.tenantId).toBe('t1');
    expect(entry.metadata.platformOperator).toBeUndefined();
  });

  it('granting SUPERADMIN by a role edit is refused (it needs a second approval)', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'u2', email: 'x', role: 'LOAN_OFFICER', isActive: true, tenantId: 't1' });
    await expect(service.updateRole(platform, 'u2', 'SUPERADMIN')).rejects.toBeInstanceOf(BadRequestException);
  });
});
