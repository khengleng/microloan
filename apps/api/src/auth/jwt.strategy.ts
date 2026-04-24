import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../prisma/prisma.service';

export type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
  tenantName?: string;
  tenantPlan?: string;     // Added for quota checking
  isPlatform?: boolean;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => req?.cookies?.['access_token'] || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET!, // startup guard guarantees this is set
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.tenantId) {
      throw new UnauthorizedException('Invalid token');
    }

    // MANDATORY GLOBAL TENANT GUARD + DATA ISOLATION GUARD
    // Instantly drops access across all routes if the tenant is suspended.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { status: true, plan: true },
    });

    // ── MANDATORY GLOBAL TENANT GUARD ──────────────────────────────────────
    // Immediately blocks suspended organizations, EXCEPT for SUPERADMIN.
    // The superadmin (platform owner) must never be locked out from managing tenants.
    if (!tenant) {
      throw new UnauthorizedException('Organization not found');
    }

    if (tenant.status !== 'ACTIVE' && payload.role !== 'SUPERADMIN') {
      throw new ForbiddenException(
        `Organization Suspended. Please contact support or upgrade your subscription.`
      );
    }

    // ── ATOMIC USER GUARD ──────────────────────────────────────────────────
    // Ensures that if a user is manually suspended, their JWT access is
    // revoked INSTANTLY (next request), not when the 15min token expires.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, role: true, tenantId: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is suspended or no longer exists.');
    }

    // Security: reject stale/forged claims if user role or tenant changed since token issuance.
    if (user.role !== payload.role || user.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('Token claims are stale or invalid.');
    }

    // Explicit platform model: SUPERADMIN identities are platform users.
    const isPlatform = user.role === 'SUPERADMIN';

    return {
      id: payload.sub,
      sub: payload.sub,
      email: payload.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: payload.tenantName,
      tenantPlan: tenant.plan,
      isPlatform,
    };
  }
}
