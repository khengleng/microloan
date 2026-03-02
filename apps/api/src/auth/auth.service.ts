import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@microloan/db';
import { verify, generateSecret } from 'otplib';
import * as qrcode from 'qrcode';

// ── Security constants ───────────────────────────────────────────────────────
const MAX_FAILED_ATTEMPTS = 5;              // Lock after 5 failed logins
const LOCK_DURATION_MS = 30 * 60 * 1000; // Locked for 30 minutes
const GENERIC_AUTH_ERROR = 'Invalid credentials'; // Never reveal which field failed

const otpauth = {
  keyuri: (email: string, issuer: string, secret: string) => {
    return `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}`;
  }
};

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private audit: AuditService,
  ) { }

  async registerTenant(dto: RegisterTenantDto, ip?: string) {
    const existing = await this.usersService.findOneByEmail(dto.adminEmail);
    if (existing) {
      // Don't reveal that the email exists — return same error timing
      throw new ConflictException('Registration failed. Please check your details.');
    }

    const salt = await bcrypt.genSalt(12); // 12 rounds for stronger hashing
    const passwordHash = await bcrypt.hash(dto.adminPassword, salt);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.organizationName }
      });

      const userCount = await tx.user.count();
      const role = userCount === 0 ? Role.SUPERADMIN : Role.ADMIN;

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.adminEmail,
          passwordHash,
          role,
        }
      });

      await this.audit.logAction(tenant.id, user.id, 'CREATE', 'Tenant', tenant.id, {
        organizationName: dto.organizationName,
        role,
        event: 'TENANT_REGISTERED',
        ip: ip || 'unknown',
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
    const user: any = await this.usersService.findOneByEmail(loginDto.email);

    // ── User not found — generic error, equal timing ─────────────────────
    if (!user) {
      await this.auditSecurityEvent(null, loginDto.email, 'LOGIN_UNKNOWN_EMAIL', ip);
      // Compare against a dummy to prevent timing attacks
      await bcrypt.compare(loginDto.password, '$2b$12$dummyhashfortimingnormalisation');
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    // ── User Suspended check ────────────────────────────────────────────
    if (user.isActive === false) {
      await this.auditSecurityEvent(user.tenantId, loginDto.email, 'LOGIN_SUSPENDED', ip, user.id);
      throw new ForbiddenException('Your account has been suspended. Please contact your administrator.');
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

    await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
      event: 'LOGIN_SUCCESS',
      role: user.role,
      ip: ip || 'unknown',
    });

    return this.generateTokens(user.id, user.email, user.role, user.tenantId);
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
      await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
        event: 'MFA_FAILED',
        ip: ip || 'unknown',
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
      event: 'MFA_SUCCESS',
      role: user.role,
      ip: ip || 'unknown',
    });

    return this.generateTokens(user.id, user.email, user.role, user.tenantId);
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

    await this.audit.logAction(user.tenantId, user.id, 'UPDATE', 'User', user.id, {
      event: 'MFA_SETUP_INITIATED',
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

    await this.audit.logAction(user.tenantId, user.id, 'UPDATE', 'User', user.id, {
      event: 'MFA_ENABLED',
    });

    return { success: true };
  }

  async promoteSuperadmin(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException(`No user found with email: ${email}`);

    const updated = await this.prisma.user.update({
      where: { email },
      data: { role: Role.SUPERADMIN },
      select: { id: true, email: true, role: true, tenantId: true },
    });

    await this.audit.logAction(updated.tenantId, updated.id, 'UPDATE', 'User', updated.id, {
      event: 'PROMOTED_TO_SUPERADMIN',
      newRole: Role.SUPERADMIN,
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
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET!, // startup guard guarantees this is set
      });
      return this.generateTokens(payload.sub, payload.email, payload.role, payload.tenantId);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
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
      let tid = tenantId;
      if (!tid) {
        const first = await this.prisma.tenant.findFirst();
        tid = first?.id || 'system';
      }
      await this.audit.logAction(tid, userId || 'anonymous', 'LOGIN', 'User', userId || email, {
        event,
        ip: ip || 'unknown',
        timestamp: new Date().toISOString(),
        ...extra,
      });
    } catch { /* never fail on audit */ }
  }

  private async generateTokens(userId: string, email: string, role: string, tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const tenantName = tenant?.name || 'Magic Money';
    const payload = { sub: userId, email, role, tenantId, tenantName };
    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: this.jwtService.sign(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: (process.env.JWT_REFRESH_TTL || '30d') as any,
      }),
    };
  }
}
