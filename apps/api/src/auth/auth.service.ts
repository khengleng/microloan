import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@microloan/db';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
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

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.adminEmail,
          passwordHash,
          role: Role.ADMIN
        }
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
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    if (user.twoFactorEnabled) {
      return {
        mfaRequired: true,
        userId: user.id,
        message: 'Please provide your TOTP code'
      };
    }

    return this.generateTokens(user.id, user.email, user.role, user.tenantId);
  }

  async verifyMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new UnauthorizedException();

    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret
    });

    if (!isValid) throw new UnauthorizedException('Invalid MFA code');

    return this.generateTokens(user.id, user.email, user.role, user.tenantId);
  }

  async generateMfaSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'MicroLend OS', secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    // Save secret temporarily but don't enable yet
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret }
    });

    return { secret, qrCodeDataUrl };
  }

  async enableMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new UnauthorizedException('MFA not initiated');

    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret
    });

    if (!isValid) throw new UnauthorizedException('Invalid verification code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true }
    });

    return { success: true };
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

  private generateTokens(userId: string, email: string, role: string, tenantId: string) {
    const payload = { sub: userId, email, role, tenantId };
    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: this.jwtService.sign(payload, {
        secret: process.env.JWT_REFRESH_SECRET || 'refreshSecret',
        expiresIn: (process.env.JWT_REFRESH_TTL || '30d') as any,
      }),
    };
  }
}
