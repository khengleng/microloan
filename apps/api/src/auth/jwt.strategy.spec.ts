import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy scope validation', () => {
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret';
  const prisma: any = {
    tenant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const strategy = new JwtStrategy(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects SUPERADMIN token with tenantId', async () => {
    await expect(
      strategy.validate({
        sub: 'u1',
        email: 'root@example.com',
        role: 'SUPERADMIN',
        tenantId: 't1',
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects non-SUPERADMIN token without tenantId', async () => {
    await expect(
      strategy.validate({
        sub: 'u1',
        email: 'admin@example.com',
        role: 'TENANT_ADMIN',
        tenantId: null,
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
