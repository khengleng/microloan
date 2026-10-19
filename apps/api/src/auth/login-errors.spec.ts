// otplib ships ESM-only deps the jest transform does not process; nothing
// here touches TOTP.
jest.mock('otplib', () => ({ verify: jest.fn(), generateSecret: jest.fn() }));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

/**
 * Password login must not tell an anonymous caller anything about an account
 * before the password is proven: unknown email, wrong password, a locked
 * account and a Google-only account all answer identically.
 */
describe('password login — uniform refusals', () => {
  const PASSWORD = 'correct horse battery staple';
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash(PASSWORD, 4);
  });

  function build(user: any) {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => user),
        update: jest.fn(async ({ data }: any) => ({
          loginAttempts:
            data.loginAttempts?.increment !== undefined
              ? (user?.loginAttempts ?? 0) + 1
              : data.loginAttempts,
        })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      tenant: { findUnique: jest.fn(async () => ({ name: 'Acme' })) },
      refreshToken: { create: jest.fn(async () => ({})) },
    };
    const audit = { logSecurityEvent: jest.fn(), logAction: jest.fn() };
    const service = new AuthService(
      { sign: jest.fn(() => 'signed-token') } as any,
      prisma as any,
      audit as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  const account = (extra: any = {}) => ({
    id: 'u1',
    email: 'staff@acme.test',
    role: 'ADMIN',
    tenantId: 't1',
    branchId: null,
    isActive: true,
    passwordHash: hash,
    loginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    tenant: { status: 'ACTIVE', name: 'Acme' },
    ...extra,
  });

  async function refusal(user: any, password: string) {
    const { service } = build(user);
    try {
      await service.login({ email: 'staff@acme.test', password } as any, '1.2.3.4');
    } catch (err) {
      return err as Error;
    }
    throw new Error('login unexpectedly succeeded');
  }

  it('answers unknown email, wrong password, locked and Google-only alike', async () => {
    const results = await Promise.all([
      refusal(null, 'whatever'),
      refusal(account(), 'wrong password'),
      refusal(account({ loginAttempts: 3 }), 'wrong password'),
      refusal(account({ lockedUntil: new Date(Date.now() + 60_000) }), PASSWORD),
      refusal(account({ passwordHash: null }), 'whatever'),
      // Status of the workspace / account is not revealed to a wrong password.
      refusal(account({ tenant: { status: 'SUSPENDED', name: 'Acme' } }), 'wrong'),
      refusal(account({ isActive: false }), 'wrong'),
    ]);
    const first = results[0];
    expect(first).toBeInstanceOf(UnauthorizedException);
    for (const err of results) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe(first.message);
    }
    expect(first.message).not.toMatch(/remaining|Google|suspended/i);
  });

  it('does not reveal the lock even to the correct password', async () => {
    const err = await refusal(
      account({ lockedUntil: new Date(Date.now() + 60_000) }),
      PASSWORD,
    );
    expect(err).toBeInstanceOf(UnauthorizedException);
  });

  it('reveals workspace status only after the password verifies', async () => {
    const err = await refusal(
      account({ tenant: { status: 'PENDING_PAYMENT', name: 'Acme' } }),
      PASSWORD,
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toMatch(/awaiting plan payment/i);
  });

  it('reveals a suspended staff account only after the password verifies', async () => {
    const err = await refusal(account({ isActive: false }), PASSWORD);
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  it('starts a fresh count once a lock has expired', async () => {
    const { service, prisma } = build(
      account({ loginAttempts: 5, lockedUntil: new Date(Date.now() - 1_000) }),
    );
    await expect(
      service.login({ email: 'staff@acme.test', password: 'wrong' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', lockedUntil: { lte: expect.any(Date) } },
      data: { loginAttempts: 0, lockedUntil: null },
    });
  });
});
