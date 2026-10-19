// otplib ships ESM-only deps the jest transform does not process; the TOTP
// check itself is stubbed per test through ./totp.
jest.mock('otplib', () => ({ verify: jest.fn(), generateSecret: jest.fn() }));
jest.mock('./totp', () => ({ totpCodeMatches: jest.fn() }));

import { BadRequestException, ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { totpCodeMatches } from './totp';

/**
 * Sign-in housekeeping the web client depends on:
 *  - mistakes in a form (wrong setup code, dead reset link) are not 401s,
 *    because the client treats 401 as "session over" and signs the person out;
 *  - sign-out revokes the refresh token server-side, idempotently.
 */
const SECRET = 'unit-test-refresh-secret-long-enough-0123456789';

function build() {
  const prisma: any = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    passwordResetToken: { findUnique: jest.fn(), update: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { logSecurityEvent: jest.fn(), logAction: jest.fn() };
  const jwt = new JwtService({});
  const service = new AuthService(
    jwt,
    prisma,
    audit as any,
    { sendEmail: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, prisma, audit, jwt };
}

describe('authenticator setup errors are not session failures', () => {
  it('a wrong setup code is 400, not 401', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', twoFactorSecret: 'enc', twoFactorEnabled: false });
    (totpCodeMatches as jest.Mock).mockResolvedValue(false);
    await expect(service.enableMfa('u1', '000000')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('setup that was never started is 400, not 401', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', twoFactorSecret: null, twoFactorEnabled: false });
    await expect(service.enableMfa('u1', '123456')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an already-enrolled factor is still a conflict', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', twoFactorSecret: 'enc', twoFactorEnabled: true });
    await expect(service.enableMfa('u1', '123456')).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports enrolment status', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ twoFactorEnabled: true });
    await expect(service.mfaStatus('u1')).resolves.toEqual({ enabled: true });
  });
});

describe('password reset link errors', () => {
  it('an unknown or used link is 410 Gone', async () => {
    const { service, prisma } = build();
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(service.resetPassword('nope', 'a-long-enough-password')).rejects.toBeInstanceOf(GoneException);
    prisma.passwordResetToken.findUnique.mockResolvedValue({ id: 'r', userId: 'u1', usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    await expect(service.resetPassword('used', 'a-long-enough-password')).rejects.toBeInstanceOf(GoneException);
  });

  it('an expired link is 410 Gone', async () => {
    const { service, prisma } = build();
    prisma.passwordResetToken.findUnique.mockResolvedValue({ id: 'r', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() - 1000) });
    await expect(service.resetPassword('old', 'a-long-enough-password')).rejects.toBeInstanceOf(GoneException);
  });

  it('a missing token or short password is 400', async () => {
    const { service } = build();
    await expect(service.resetPassword('', 'a-long-enough-password')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.resetPassword('tok', 'short')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('sign-out revokes the refresh token', () => {
  const original = process.env.JWT_REFRESH_SECRET;
  beforeAll(() => { process.env.JWT_REFRESH_SECRET = SECRET; });
  afterAll(() => { process.env.JWT_REFRESH_SECRET = original; });

  const token = (jwt: JwtService, claims: Record<string, unknown>, opts: Record<string, unknown> = {}) =>
    jwt.sign({ sub: 'u1', typ: 'refresh', jti: 'rt-1', ...claims }, { secret: SECRET, expiresIn: '1h', ...opts });

  it('revokes exactly the presented token, bound to its hash, and audits', async () => {
    const { service, prisma, audit, jwt } = build();
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'LOAN_OFFICER', tenantId: 't1' });

    await expect(service.logout(token(jwt, {}), '1.2.3.4')).resolves.toEqual({ success: true });

    const where = prisma.refreshToken.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'rt-1', revokedAt: null });
    expect(typeof where.hashedToken).toBe('string');
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGOUT', actorUserId: 'u1' }));
  });

  it('is idempotent: an already-revoked token still answers success and is not treated as reuse', async () => {
    const { service, prisma, audit, jwt } = build();
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.logout(token(jwt, {}))).resolves.toEqual({ success: true });
    // Only the single-token revoke ran — no revoke-all, no reuse alarm.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(audit.logSecurityEvent).not.toHaveBeenCalled();
  });

  it('still revokes an expired token', async () => {
    const { service, prisma, jwt } = build();
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue(null);
    const expired = jwt.sign(
      { sub: 'u1', typ: 'refresh', jti: 'rt-1', exp: Math.floor(Date.now() / 1000) - 60 },
      { secret: SECRET },
    );
    await service.logout(expired);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
  });

  it('ignores missing, forged and non-refresh tokens without touching the database', async () => {
    const { service, prisma, jwt } = build();
    await expect(service.logout(undefined)).resolves.toEqual({ success: true });
    await expect(service.logout('not-a-jwt')).resolves.toEqual({ success: true });
    const forged = jwt.sign({ sub: 'u1', typ: 'refresh', jti: 'rt-1' }, { secret: 'some-other-secret-0123456789abcdef' });
    await expect(service.logout(forged)).resolves.toEqual({ success: true });
    await expect(service.logout(token(jwt, { typ: 'access' }))).resolves.toEqual({ success: true });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('sign out everywhere revokes every live refresh token of the caller', async () => {
    const { service, prisma, audit } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'LOAN_OFFICER', tenantId: 't1' });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.revokeAllSessions('u1')).resolves.toEqual({ success: true, revoked: 3 });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'SESSIONS_REVOKED_ALL' }));
  });
});

describe("changing one's own password", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bcrypt = require('bcryptjs');
  const actor = { sub: 'u1', amr: 'pwd' as const };
  async function withUser(extra: Record<string, unknown> = {}) {
    const ctx = build();
    ctx.prisma.user.findUnique.mockResolvedValue({
      id: 'u1', role: 'ADMIN', tenantId: 't1', twoFactorEnabled: false,
      passwordHash: await bcrypt.hash('the-current-password', 4), ...extra,
    });
    return ctx;
  }

  it('a wrong current password is 400 and is audited, never 401', async () => {
    const { service, prisma, audit } = await withUser();
    await expect(service.changePassword(actor, 'not-the-password', 'a-brand-new-password')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_CHANGE_REJECTED' }));
  });

  it('a short or unchanged new password is 400', async () => {
    const { service } = await withUser();
    await expect(service.changePassword(actor, 'the-current-password', 'short')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.changePassword(actor, 'the-current-password', 'the-current-password')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('someone with an authenticator must be in a session signed in with it', async () => {
    const { service } = await withUser({ twoFactorEnabled: true });
    await expect(service.changePassword(actor, 'the-current-password', 'a-brand-new-password')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a correct change updates the hash and revokes every session', async () => {
    const { service, prisma, audit } = await withUser({ twoFactorEnabled: true });
    await expect(service.changePassword({ sub: 'u1', amr: 'mfa' }, 'the-current-password', 'a-brand-new-password')).resolves.toEqual({ success: true });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }));
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_CHANGED' }));
  });
});
