import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
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

  async registerTenant(dto: RegisterTenantDto) {
    const existing = await this.usersService.findOneByEmail(dto.adminEmail);
    if (existing) {
      throw new ConflictException('User with this email already exists.');
    }

    const salt = await bcrypt.genSalt();
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
          role: role
        }
      });

      // Audit after TX completes
      await this.audit.logAction(tenant.id, user.id, 'CREATE', 'Tenant', tenant.id, {
        organizationName: dto.organizationName,
        adminEmail: dto.adminEmail,
        role,
        event: 'TENANT_REGISTERED',
      });

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        adminEmail: user.email,
        message: 'Organization registered successfully. You can now log in.'
      };
    });
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findOneByEmail(loginDto.email);

    // Audit failed login attempt (security compliance)
    if (!user) {
      await this.auditLoginFail(null, loginDto.email, 'USER_NOT_FOUND');
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isMatch) {
      await this.auditLoginFail(user.tenantId, loginDto.email, 'WRONG_PASSWORD', user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.twoFactorEnabled) {
      await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
        email: user.email,
        event: 'MFA_CHALLENGE_ISSUED',
        role: user.role,
      });
      return {
        mfaRequired: true,
        userId: user.id,
        message: 'Please provide your TOTP code'
      };
    }

    // Successful login
    await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
      email: user.email,
      event: 'LOGIN_SUCCESS',
      role: user.role,
    });

    return this.generateTokens(user.id, user.email, user.role, user.tenantId);
  }

  async verifyMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new UnauthorizedException();

    const isValid = verify({
      token: code,
      secret: user.twoFactorSecret
    });

    if (!isValid) {
      await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
        email: user.email,
        event: 'MFA_FAILED',
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
      email: user.email,
      event: 'MFA_SUCCESS',
      role: user.role,
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
      data: { twoFactorSecret: secret }
    });

    await this.audit.logAction(user.tenantId, user.id, 'UPDATE', 'User', user.id, {
      email: user.email,
      event: 'MFA_SETUP_INITIATED',
    });

    return { secret, qrCodeDataUrl };
  }

  async enableMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new UnauthorizedException('MFA not initiated');

    const isValid = verify({
      token: code,
      secret: user.twoFactorSecret
    });

    if (!isValid) throw new UnauthorizedException('Invalid verification code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true }
    });

    await this.audit.logAction(user.tenantId, user.id, 'UPDATE', 'User', user.id, {
      email: user.email,
      event: 'MFA_ENABLED',
    });

    return { success: true };
  }

  async promoteSuperadmin(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException(`No user found with email: ${email}`);
    const updated = await this.prisma.user.update({
      where: { email },
      data: { role: Role.SUPERADMIN },
      select: { id: true, email: true, role: true, tenantId: true },
    });

    await this.audit.logAction(updated.tenantId, updated.id, 'UPDATE', 'User', updated.id, {
      email: updated.email,
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
        secret: process.env.JWT_REFRESH_SECRET || 'refreshSecret',
      });
      return this.generateTokens(payload.sub, payload.email, payload.role, payload.tenantId);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async auditLoginFail(tenantId: string | null, email: string, reason: string, userId?: string) {
    try {
      // For unknown users, we use a system tenant log (best effort)
      if (!tenantId) {
        const systemTenant = await this.prisma.tenant.findFirst();
        tenantId = systemTenant?.id || 'unknown';
      }
      await this.audit.logAction(tenantId, userId || 'anonymous', 'LOGIN', 'User', userId || email, {
        email,
        event: 'LOGIN_FAILED',
        reason,
        timestamp: new Date().toISOString(),
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
        secret: process.env.JWT_REFRESH_SECRET || 'refreshSecret',
        expiresIn: (process.env.JWT_REFRESH_TTL || '30d') as any,
      }),
    };
  }
}
