// otplib is ESM-only under jest; the TOTP check is stubbed per test through ./totp.
jest.mock('otplib', () => ({ verify: jest.fn(), generateSecret: jest.fn() }));
jest.mock('./totp', () => ({ totpCodeMatches: jest.fn(), totpTimeStepFor: jest.fn() }));

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { totpTimeStepFor } from './totp';

/**
 * Sign-in factor hardening (D-129):
 *  - the login mfaToken is single-use (consumed in the database);
 *  - a TOTP code is accepted once (its time step is recorded);
 *  - sessions carry mfaAt, which a refresh never moves and a step-up renews.
 */
const ACCESS = 'unit-test-access-secret-long-enough-0123456789';
const REFRESH = 'unit-test-refresh-secret-long-enough-0123456789';

function build() {
  const user = {
    id: 'u1',
    email: 'admin@example.com',
    role: 'TENANT_ADMIN',
    tenantId: 't1',
    branchId: null,
    twoFactorEnabled: true,
    twoFactorSecret: 'enc',
    totpLastStep: 100 as number | null,
    lockedUntil: null,
    isActive: true,
  };
  const challenges = new Map<string, { id: string; userId: string; expiresAt: Date; consumedAt: Date | null }>();
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => ({ ...user })),
      update: jest.fn(async () => ({ loginAttempts: 1 })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        // The conditional claim of a time step, as the database would apply it.
        if (data.totpLastStep !== undefined) {
          const ok = user.totpLastStep === null || user.totpLastStep < data.totpLastStep;
          if (ok) user.totpLastStep = data.totpLastStep;
          return { count: ok ? 1 : 0 };
        }
        void where;
        return { count: 1 };
      }),
    },
    tenant: { findUnique: jest.fn(async () => ({ name: 'Acme' })) },
    mfaChallenge: {
      create: jest.fn(async ({ data }: any) => {
        challenges.set(data.id, { ...data, consumedAt: null });
        return data;
      }),
      findUnique: jest.fn(async ({ where }: any) => challenges.get(where.id) ?? null),
      updateMany: jest.fn(async ({ where }: any) => {
        const c = challenges.get(where.id);
        if (!c || c.consumedAt) return { count: 0 };
        c.consumedAt = new Date();
        return { count: 1 };
      }),
    },
    refreshToken: { create: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const audit = { logSecurityEvent: jest.fn(), logAction: jest.fn() };
  const jwt = new JwtService({ secret: ACCESS });
  const service = new AuthService(jwt, prisma, audit as any, {} as any, {} as any, {} as any, {} as any);
  return { service, prisma, audit, jwt, user, challenges };
}

describe('MFA sign-in, replay and step-up', () => {
  const env = { ...process.env };
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = ACCESS;
    process.env.JWT_REFRESH_SECRET = REFRESH;
  });
  afterAll(() => {
    process.env = env;
  });
  beforeEach(() => (totpTimeStepFor as jest.Mock).mockReset());

  const challengeToken = async (svc: AuthService) =>
    (svc as any).issueMfaChallenge('u1') as Promise<string>;

  it('the mfaToken is single-use: a second redemption is refused', async () => {
    const { service } = build();
    const token = await challengeToken(service);
    (totpTimeStepFor as jest.Mock).mockResolvedValueOnce(101).mockResolvedValueOnce(102);
    const first = await service.verifyMfa(token, '123456');
    expect(first.access_token).toBeDefined();
    await expect(service.verifyMfa(token, '654321')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('an mfaToken without a stored challenge (forged jti, old format) is refused', async () => {
    const { service, jwt } = build();
    const legacy = jwt.sign({ sub: 'u1', mfaChallenge: true }, { secret: ACCESS, expiresIn: '5m' });
    await expect(service.verifyMfa(legacy, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    const forged = jwt.sign({ sub: 'u1', mfaChallenge: true, jti: 'nope' }, { secret: ACCESS, expiresIn: '5m' });
    await expect(service.verifyMfa(forged, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a wrong code does not consume the challenge', async () => {
    const { service, challenges } = build();
    const token = await challengeToken(service);
    (totpTimeStepFor as jest.Mock).mockResolvedValue(null);
    await expect(service.verifyMfa(token, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    expect([...challenges.values()][0].consumedAt).toBeNull();
  });

  it('the MFA sign-in records mfaAt in the access token', async () => {
    const { service, jwt } = build();
    const token = await challengeToken(service);
    (totpTimeStepFor as jest.Mock).mockResolvedValue(101);
    const t = await service.verifyMfa(token, '123456');
    const claims: any = jwt.decode(t.access_token);
    expect(claims.amr).toBe('mfa');
    expect(Math.abs(claims.mfaAt - Date.now() / 1000)).toBeLessThan(5);
  });

  it('a TOTP code whose step was already used is rejected as a replay', async () => {
    const { service, audit } = build();
    // The code matches, but only at the step already recorded (100).
    (totpTimeStepFor as jest.Mock).mockImplementation(async (_c: unknown, _s: unknown, after?: number | null) =>
      after === undefined || after === null ? 100 : null,
    );
    await expect(service.stepUp('u1', '123456')).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MFA_STEP_UP_REPLAY_REJECTED' }),
    );
  });

  it('two requests racing with one code: only the first claims the step', async () => {
    const { service } = build();
    (totpTimeStepFor as jest.Mock).mockResolvedValue(150);
    await expect(service.stepUp('u1', '123456')).resolves.toHaveProperty('access_token');
    await expect(service.stepUp('u1', '123456')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('step-up renews mfaAt and revokes the refresh token it replaces', async () => {
    const { service, jwt, prisma } = build();
    (totpTimeStepFor as jest.Mock).mockResolvedValue(160);
    const old = jwt.sign({ sub: 'u1', typ: 'refresh', jti: 'rt-old' }, { secret: REFRESH, expiresIn: '1h' });
    const t = await service.stepUp('u1', '123456', old);
    const claims: any = jwt.decode(t.access_token);
    expect(claims.amr).toBe('mfa');
    expect(Math.abs(claims.mfaAt - Date.now() / 1000)).toBeLessThan(5);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'rt-old', userId: 'u1' }) }),
    );
  });

  it('a refresh keeps the original mfaAt instead of renewing it', async () => {
    const { service, jwt } = build();
    const mfaAt = Math.floor(Date.now() / 1000) - 20 * 86_400;
    const tokens = await (service as any).generateTokens('u1', 'admin@example.com', 'TENANT_ADMIN', 't1', null, undefined, 'mfa', mfaAt);
    const refreshClaims: any = jwt.decode(tokens.refresh_token);
    expect(refreshClaims.mfaAt).toBe(mfaAt);
  });
});
