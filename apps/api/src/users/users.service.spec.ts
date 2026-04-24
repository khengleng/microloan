import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { Role } from '@microloan/db';
import { UsersService } from './users.service';
import { AuthzService } from '../authz/authz.service';

describe('UsersService security', () => {
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const audit: any = {
    logSecurityEvent: jest.fn(),
    logAction: jest.fn(),
  };
  const authz = new AuthzService(audit);
  const service = new UsersService(prisma, audit, authz);

  beforeEach(() => {
    jest.clearAllMocks();
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
});

