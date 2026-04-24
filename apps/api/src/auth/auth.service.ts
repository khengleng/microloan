import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@microloan/db';
import { verify, generateSecret } from 'otplib';
import * as qrcode from 'qrcode';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@microloan/db';
import { permissionsForRole } from '../authz/role-permissions';

// ── Security constants ───────────────────────────────────────────────────────
const MAX_FAILED_ATTEMPTS = 5;              // Lock after 5 failed logins
const LOCK_DURATION_MS = 30 * 60 * 1000; // Locked for 30 minutes
const GENERIC_AUTH_ERROR = 'Invalid credentials'; // Never reveal which field failed
const REFRESH_TOKEN_TYPE = 'refresh';

const otpauth = {
  keyuri: (email: string, issuer: string, secret: string) => {
    return `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}`;
  }
};

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private audit: AuditService,
  ) { }

  async registerTenant(dto: RegisterTenantDto, ip?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.adminEmail } });
    if (existing) {
      throw new ConflictException('Registration failed. This email is already tied to an existing organization (possibly suspended or in the Trash). To reuse this email, the organization must be permanently PURGED from the platform by a Superadmin.');
    }

    const salt = await bcrypt.genSalt(12); // 12 rounds for stronger hashing
    const passwordHash = await bcrypt.hash(dto.adminPassword, salt);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.organizationName }
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.adminEmail,
          passwordHash,
          role: Role.TENANT_ADMIN,
        }
      });

      await this.audit.logSecurityEvent({
        actorUserId: user.id,
        actorRole: user.role,
        actorTenantId: tenant.id,
        targetType: 'Tenant',
        targetId: tenant.id,
        action: 'TENANT_CREATE',
        newValue: { organizationName: dto.organizationName },
        ipAddress: ip || 'unknown',
        result: 'SUCCESS',
      });

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        adminEmail: user.email,
        message: 'Organization registered successfully. You can now log in.',
      };
    });
  }

  async login(loginDto: LoginDto, ip?: string) {
    const user: any = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
      include: { tenant: { select: { status: true, name: true } } }
    });

    // ── User not found — generic error, equal timing ─────────────────────
    if (!user) {
      await this.auditSecurityEvent(null, loginDto.email, 'LOGIN_UNKNOWN_EMAIL', ip);
      // Compare against a dummy to prevent timing attacks
      await bcrypt.compare(loginDto.password, '$2b$12$dummyhashfortimingnormalisation');
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    // ── Organization Suspended check ─────────────────────────────────────
    if (user.role !== Role.SUPERADMIN && user.tenant?.status !== 'ACTIVE') {
      throw new ForbiddenException(`Organization ${user.tenant?.name || 'Isolated Environment'} has been suspended or is pending data erasure. Please contact platform support.`);
    }

    // ── User Suspended check ────────────────────────────────────────────
    if (user.isActive === false) {
      await this.auditSecurityEvent(user.tenantId, loginDto.email, 'LOGIN_SUSPENDED', ip, user.id);
      throw new ForbiddenException('Your staff account has been suspended by your administrator.');
    }

    // ── Account lockout check ────────────────────────────────────────────
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      await this.auditSecurityEvent(user.tenantId, loginDto.email, 'LOGIN_ACCOUNT_LOCKED', ip, user.id);
      throw new ForbiddenException(
        `Account is temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`
      );
    }

    // ── Password check ───────────────────────────────────────────────────
    const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);

    if (!isMatch) {
      // Increment failed attempts
      const newAttempts = (user.loginAttempts || 0) + 1;
      const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;

      await (this.prisma.user as any).update({
        where: { id: user.id },
        data: {
          loginAttempts: newAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
        },
      });

      await this.auditSecurityEvent(user.tenantId, loginDto.email, 'LOGIN_FAILED', ip, user.id, {
        attempt: newAttempts,
        locked: shouldLock,
      });

      if (shouldLock) {
        throw new ForbiddenException(
          `Account locked for 30 minutes after ${MAX_FAILED_ATTEMPTS} failed attempts.`
        );
      }

      const remaining = MAX_FAILED_ATTEMPTS - newAttempts;
      throw new UnauthorizedException(
        remaining > 0
          ? `${GENERIC_AUTH_ERROR}. ${remaining} attempt(s) remaining before lockout.`
          : GENERIC_AUTH_ERROR,
      );
    }

    // ── Success: reset failed attempts, update last login ────────────────
    await (this.prisma.user as any).update({
      where: { id: user.id },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip || null,
      },
    });

    if (user.twoFactorEnabled) {
      await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
        event: 'MFA_CHALLENGE_ISSUED',
        role: user.role,
        ip: ip || 'unknown',
      });
      // Issue a short-lived, single-purpose token — never expose the raw userId
      const mfaToken = this.jwtService.sign(
        { sub: user.id, mfaChallenge: true },
        {
          secret: process.env.JWT_ACCESS_SECRET!,
          expiresIn: '5m',
        },
      );
      return {
        mfaRequired: true,
        mfaToken,
        message: 'Please provide your TOTP code',
      };
    }

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'LOGIN',
      ipAddress: ip || 'unknown',
      result: 'SUCCESS',
    });

    return this.generateTokens(user.id, user.email, user.role, user.tenantId || null, user.branchId || null);
  }

  async verifyMfa(mfaToken: string, code: string, ip?: string) {
    // Verify the short-lived MFA challenge token — never accept a raw userId directly
    let userId: string;
    try {
      const payload = this.jwtService.verify<{ sub: string; mfaChallenge: boolean }>(
        mfaToken,
        { secret: process.env.JWT_ACCESS_SECRET! },
      );
      if (!payload.mfaChallenge) throw new Error('Not an MFA token');
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA session. Please log in again.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new UnauthorizedException();

    const isValid = verify({ token: code, secret: user.twoFactorSecret });

    if (!isValid) {
      await this.audit.logSecurityEvent({
        actorUserId: user.id,
        actorRole: user.role,
        actorTenantId: user.tenantId || null,
        targetType: 'User',
        targetId: user.id,
        action: 'LOGIN_MFA_FAILED',
        ipAddress: ip || 'unknown',
        result: 'FAILURE',
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'LOGIN_MFA',
      ipAddress: ip || 'unknown',
      result: 'SUCCESS',
    });

    return this.generateTokens(user.id, user.email, user.role, user.tenantId || null, user.branchId || null);
  }

  async generateMfaSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const secret = generateSecret();
    const otpauthUrl = otpauth.keyuri(user.email, 'Magic Money', secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'MFA_SETUP_INITIATED',
      result: 'SUCCESS',
    });

    return { secret, qrCodeDataUrl };
  }

  async enableMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new UnauthorizedException('MFA not initiated');

    const isValid = verify({ token: code, secret: user.twoFactorSecret });
    if (!isValid) throw new UnauthorizedException('Invalid verification code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    await this.audit.logSecurityEvent({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId || null,
      targetType: 'User',
      targetId: user.id,
      action: 'MFA_ENABLED',
      result: 'SUCCESS',
    });

    return { success: true };
  }

  async promoteSuperadmin(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException(`No user found with email: ${email}`);

    const updated = await this.prisma.user.update({
      where: { email },
      data: { role: Role.SUPERADMIN, tenantId: null, branchId: null },
      select: { id: true, email: true, role: true, tenantId: true },
    });

    await this.audit.logSecurityEvent({
      actorUserId: updated.id,
      actorRole: updated.role,
      actorTenantId: updated.tenantId || null,
      targetType: 'User',
      targetId: updated.id,
      action: 'PROMOTED_TO_SUPERADMIN',
      newValue: { newRole: Role.SUPERADMIN },
      result: 'SUCCESS',
    });

    return { success: true, message: `${email} has been promoted to SUPERADMIN`, user: updated };
  }

  async listSuperadmins() {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.SUPERADMIN },
      select: { id: true, email: true, role: true, createdAt: true, tenant: { select: { name: true } } },
    });
    return { superadmins: admins, count: admins.length };
  }

  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    type RefreshPayload = {
      sub: string;
      email: string;
      role: string;
      tenantId: string | null;
      branchId?: string | null;
      jti?: string;
      typ?: string;
    };

    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify<RefreshPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET!, // startup guard guarantees this is set
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!payload.jti || payload.typ !== REFRESH_TOKEN_TYPE) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
      include: {
        user: {
          include: { tenant: { select: { status: true, name: true } } },
        },
      },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Reuse detection: a revoked token being presented again indicates replay.
    if (tokenRecord.revokedAt) {
      await this.revokeAllUserSessions(tokenRecord.userId);
      await this.audit.logSecurityEvent({
        actorUserId: tokenRecord.userId,
        actorRole: tokenRecord.user.role,
        actorTenantId: tokenRecord.user.tenantId || null,
        targetType: 'RefreshToken',
        targetId: tokenRecord.id,
        action: 'REFRESH_TOKEN_REUSE',
        reason: 'Revoked token replayed',
        result: 'FAILURE',
      });
      throw new UnauthorizedException('Refresh token reuse detected. Please log in again.');
    }

    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revokedAt: new Date() },
      }).catch(() => { });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const incomingHash = this.hashRefreshToken(refreshToken);
    if (incomingHash !== tokenRecord.hashedToken) {
      await this.revokeAllUserSessions(tokenRecord.userId);
      await this.audit.logSecurityEvent({
        actorUserId: tokenRecord.userId,
        actorRole: tokenRecord.user.role,
        actorTenantId: tokenRecord.user.tenantId || null,
        targetType: 'RefreshToken',
        targetId: tokenRecord.id,
        action: 'REFRESH_TOKEN_REUSE',
        reason: 'Token hash mismatch',
        result: 'FAILURE',
      });
      throw new UnauthorizedException('Refresh token reuse detected. Please log in again.');
    }

    if (!tokenRecord.user.isActive) {
      await this.revokeAllUserSessions(tokenRecord.userId);
      throw new UnauthorizedException('User account is suspended or no longer exists.');
    }

    if (tokenRecord.user.tenant?.status !== 'ACTIVE' && tokenRecord.user.role !== Role.SUPERADMIN) {
      await this.revokeAllUserSessions(tokenRecord.userId);
      throw new ForbiddenException(
        `Organization ${tokenRecord.user.tenant?.name || 'Unknown'} has been suspended or is pending data erasure.`
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const revoke = await tx.refreshToken.updateMany({
        where: { id: tokenRecord.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Concurrent replay: token was consumed by another request first.
      if (revoke.count !== 1) {
        await tx.refreshToken.updateMany({
          where: { userId: tokenRecord.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.logSecurityEvent({
          actorUserId: tokenRecord.userId,
          actorRole: tokenRecord.user.role,
          actorTenantId: tokenRecord.user.tenantId || null,
          targetType: 'RefreshToken',
          targetId: tokenRecord.id,
          action: 'REFRESH_TOKEN_REUSE',
          reason: 'Concurrent reuse detected during rotation',
          result: 'FAILURE',
        });
        throw new UnauthorizedException('Refresh token reuse detected. Please log in again.');
      }

      return this.generateTokens(
        tokenRecord.user.id,
        tokenRecord.user.email,
        tokenRecord.user.role,
        tokenRecord.user.tenantId,
        tokenRecord.user.branchId || null,
        tx,
      );
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async auditSecurityEvent(
    tenantId: string | null,
    email: string,
    event: string,
    ip?: string,
    userId?: string,
    extra?: any,
  ) {
    try {
      await this.audit.logSecurityEvent({
        actorUserId: userId || null,
        actorRole: null,
        actorTenantId: tenantId,
        targetType: 'User',
        targetId: userId || email,
        action: event,
        newValue: extra,
        ipAddress: ip || 'unknown',
        result: 'FAILURE',
      });
    } catch { /* never fail on audit */ }
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    tenantId: string | null,
    branchId: string | null = null,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const tenant = tenantId
      ? await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
      : null;
    const tenantName = tenant?.name || 'Magic Money';
    const payload = {
      sub: userId,
      email,
      role,
      tenantId,
      branchId,
      tenantName,
      permissions: Array.from(permissionsForRole(role)),
    };

    const refreshTokenId = randomUUID();
    const refreshTtlRaw = process.env.JWT_REFRESH_TTL || '30d';
    const refreshToken = this.jwtService.sign(
      { ...payload, typ: REFRESH_TOKEN_TYPE, jti: refreshTokenId },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: refreshTtlRaw as any,
      },
    );

    await db.refreshToken.create({
      data: {
        id: refreshTokenId,
        userId,
        hashedToken: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + this.parseDurationMs(refreshTtlRaw)),
      },
    });

    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: refreshToken,
    };
  }

  private hashRefreshToken(token: string): string {
    const pepper = process.env.JWT_REFRESH_TOKEN_PEPPER || '';
    return createHash('sha256').update(`${token}.${pepper}`).digest('hex');
  }

  private parseDurationMs(expiresIn: string | number): number {
    if (typeof expiresIn === 'number') {
      return expiresIn * 1000;
    }

    const raw = String(expiresIn).trim();
    if (/^\d+$/.test(raw)) {
      return parseInt(raw, 10) * 1000;
    }

    const match = raw.match(/^(\d+)([smhd])$/i);
    if (!match) {
      // Safe fallback to 30 days if misconfigured.
      return 30 * 24 * 60 * 60 * 1000;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return value * 24 * 60 * 60 * 1000;
  }

  private async revokeAllUserSessions(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }).catch(() => { });
  }
}
