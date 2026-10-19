import { ForbiddenException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@microloan/db';
import { UsersService } from './users.service';
import { AuthzService } from '../authz/authz.service';

describe('UsersService security', () => {
  const prisma: any = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    refreshToken: { updateMany: jest.fn() },
    // Array-form transaction: the operations were already built; resolve them.
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const audit: any = {
    logSecurityEvent: jest.fn(),
    logAction: jest.fn(),
  };
  const authz = new AuthzService(audit);
  const planTiers: any = { ceilingsFor: jest.fn() };
  const grants: any = { requestForNewAccount: jest.fn() };
  const service = new UsersService(prisma, audit, authz, planTiers, grants);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('the platform team lists only platform operators, not every organisation\'s users', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.findAll({ sub: 'p1', role: 'SUPERADMIN', tenantId: null, branchId: null, permissions: [] } as any);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ tenantId: null });
    await service.findAll({ sub: 'a1', role: 'TENANT_ADMIN', tenantId: 't1', branchId: null, permissions: [] } as any);
    expect(prisma.user.findMany.mock.calls[1][0].where).toEqual({ tenantId: 't1' });
  });

  it('TENANT_ADMIN cannot create SUPERADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.create(
        { sub: 'u1', role: 'TENANT_ADMIN', tenantId: 't1', branchId: null, permissions: [] } as any,
        { email: 'x@example.com', plainPassword: 'Password!1', role: Role.SUPERADMIN },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('TENANT_ADMIN create ignores body tenantId and enforces actor tenant', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'u2',
      email: 'x@example.com',
      role: Role.LOAN_OFFICER,
      tenantId: 't1',
      branchId: null,
    });

    await service.create(
      { sub: 'u1', role: 'TENANT_ADMIN', tenantId: 't1', branchId: null, permissions: [] } as any,
      { email: 'x@example.com', plainPassword: 'Password!1', role: Role.LOAN_OFFICER, tenantId: null as any },
    );

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't1',
        }),
      }),
    );
  });

  it('TENANT_ADMIN cannot manage SUPERADMIN user', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u2',
      role: Role.SUPERADMIN,
      tenantId: null,
      isActive: true,
      email: 'root@example.com',
    });

    await expect(
      service.updateRole(
        { sub: 'u1', role: 'TENANT_ADMIN', tenantId: 't1', branchId: null, permissions: [] } as any,
        'u2',
        Role.LOAN_OFFICER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SUPERADMIN cannot self-demote', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      role: Role.SUPERADMIN,
      tenantId: null,
      isActive: true,
      email: 'root@example.com',
    });

    await expect(
      service.updateRole(
        { sub: 'u1', role: 'SUPERADMIN', tenantId: null, branchId: null, permissions: [] } as any,
        'u1',
        Role.TENANT_ADMIN,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('reset authenticator (lost phone)', () => {
    const admin = (amr: 'mfa' | 'pwd' = 'mfa') =>
      ({ sub: 'admin1', role: 'TENANT_ADMIN', tenantId: 't1', branchId: null, permissions: [], amr, mfaAt: Math.floor(Date.now() / 1000) }) as any;
    const officer = {
      id: 'u2',
      email: 'officer@example.com',
      role: Role.LOAN_OFFICER,
      tenantId: 't1',
      branchId: null,
      twoFactorEnabled: true,
      twoFactorSecret: 'enc',
    };

    it('clears the factor, signs the person out everywhere and audits it', async () => {
      prisma.user.findFirst.mockResolvedValue(officer);
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.resetMfa(admin(), 'u2')).resolves.toEqual({ success: true });

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u2', tenantId: 't1' } }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u2' },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u2', revokedAt: null } }),
      );
      expect(audit.logSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_MFA_RESET', targetId: 'u2', result: 'SUCCESS' }),
      );
    });

    it('requires the actor to have signed in with their own code (step-up)', async () => {
      prisma.user.findFirst.mockResolvedValue(officer);
      await expect(service.resetMfa(admin('pwd'), 'u2')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.logSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_MFA_RESET', result: 'FAILURE' }),
      );
    });

    it('refuses to reset the actor\'s own factor', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...officer, id: 'admin1', role: Role.TENANT_ADMIN });
      await expect(service.resetMfa(admin(), 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses without USER_UPDATE', async () => {
      await expect(
        service.resetMfa({ sub: 'x', role: 'LOAN_OFFICER', tenantId: 't1', branchId: null, permissions: [], amr: 'mfa' } as any, 'u2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('a tenant admin cannot reset another tenant admin', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...officer, id: 'admin2', role: Role.TENANT_ADMIN });
      await expect(service.resetMfa(admin(), 'admin2')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('answers 404 for someone outside the tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.resetMfa(admin(), 'other')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('says so when there is nothing to reset', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...officer, twoFactorEnabled: false, twoFactorSecret: null });
      await expect(service.resetMfa(admin(), 'u2')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('reactivate a suspended account', () => {
    const admin = { sub: 'admin1', role: 'TENANT_ADMIN', tenantId: 't1', branchId: null, permissions: [], tenantPlan: 'BASIC' } as any;
    const suspended = { id: 'u2', email: 'o@example.com', role: Role.LOAN_OFFICER, isActive: false, tenantId: 't1', branchId: null };

    it('reactivates within the seat ceiling, revokes old sessions and audits', async () => {
      prisma.user.findFirst.mockResolvedValue(suspended);
      planTiers.ceilingsFor.mockResolvedValue({ maxUsers: 5 });
      prisma.user.count.mockResolvedValue(4);
      prisma.user.update.mockResolvedValue({ id: 'u2', isActive: true });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reactivate(admin, 'u2')).resolves.toMatchObject({ isActive: true });
      expect(planTiers.ceilingsFor).toHaveBeenCalledWith('BASIC');
      expect(prisma.user.count).toHaveBeenCalledWith({ where: { tenantId: 't1', isActive: true } });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u2' }, data: expect.objectContaining({ isActive: true }) }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(audit.logSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_REACTIVATE', targetId: 'u2' }),
      );
    });

    it('refuses when the active seats are full', async () => {
      prisma.user.findFirst.mockResolvedValue(suspended);
      planTiers.ceilingsFor.mockResolvedValue({ maxUsers: 3 });
      prisma.user.count.mockResolvedValue(3);
      await expect(service.reactivate(admin, 'u2')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not count seats on an unlimited plan', async () => {
      prisma.user.findFirst.mockResolvedValue(suspended);
      planTiers.ceilingsFor.mockResolvedValue({ maxUsers: null });
      prisma.user.update.mockResolvedValue({ id: 'u2', isActive: true });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      await service.reactivate(admin, 'u2');
      expect(prisma.user.count).not.toHaveBeenCalled();
    });

    it('refuses an account that is already active', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...suspended, isActive: true });
      await expect(service.reactivate(admin, 'u2')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses without USER_DISABLE', async () => {
      await expect(
        service.reactivate({ sub: 'x', role: 'BRANCH_MANAGER', tenantId: 't1', branchId: null, permissions: [] } as any, 'u2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a tenant admin cannot reactivate another tenant admin', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...suspended, id: 'admin2', role: Role.TENANT_ADMIN });
      await expect(service.reactivate(admin, 'admin2')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('suspending an account also ends its sessions', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: Role.LOAN_OFFICER, tenantId: 't1', isActive: true });
    prisma.user.update.mockResolvedValue({ id: 'u2', isActive: false });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    await service.remove({ sub: 'admin1', role: 'TENANT_ADMIN', tenantId: 't1', branchId: null, permissions: [] } as any, 'u2');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u2', revokedAt: null } }),
    );
  });
});
