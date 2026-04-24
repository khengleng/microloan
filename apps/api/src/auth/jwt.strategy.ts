import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../prisma/prisma.service';
import { Permission } from '../authz/permission.enum';
import { permissionsForRole } from '../authz/role-permissions';

export type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  tenantId: string | null;
  branchId?: string | null;
  tenantName?: string;
  tenantPlan?: string;     // Added for quota checking
  isPlatform?: boolean;
  permissions?: Permission[];
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
    if (!payload.sub || !payload.email || !payload.role) {
      throw new UnauthorizedException('Invalid token');
    }

    // MANDATORY GLOBAL TENANT GUARD + DATA ISOLATION GUARD
    // Instantly drops access across all routes if the tenant is suspended.
    const tenant = payload.tenantId
      ? await this.prisma.tenant.findUnique({
        where: { id: payload.tenantId },
        select: { status: true, plan: true },
      })
      : null;

    // ── MANDATORY GLOBAL TENANT GUARD ──────────────────────────────────────
    // Immediately blocks suspended organizations, EXCEPT for SUPERADMIN.
    // The superadmin (platform owner) must never be locked out from managing tenants.
    if (payload.role === 'SUPERADMIN' && payload.tenantId !== null) {
      throw new UnauthorizedException('SUPERADMIN must be platform-scoped (tenantId=null).');
    }
    if (payload.role !== 'SUPERADMIN' && !payload.tenantId) {
      throw new UnauthorizedException('Tenant-scoped users must include tenantId.');
    }
    if (payload.role !== 'SUPERADMIN' && !tenant) {
      throw new UnauthorizedException('Organization not found');
    }
    if (tenant && tenant.status !== 'ACTIVE' && payload.role !== 'SUPERADMIN') {
      throw new ForbiddenException(
        `Organization Suspended. Please contact support or upgrade your subscription.`
      );
    }

    // ── ATOMIC USER GUARD ──────────────────────────────────────────────────
    // Ensures that if a user is manually suspended, their JWT access is
    // revoked INSTANTLY (next request), not when the 15min token expires.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, role: true, tenantId: true, branchId: true },
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
    if (isPlatform && user.tenantId !== null) {
      throw new UnauthorizedException('Invalid SUPERADMIN account scope.');
    }
    if (!isPlatform && !user.tenantId) {
      throw new UnauthorizedException('Invalid tenant user scope.');
    }

    return {
      id: payload.sub,
      sub: payload.sub,
      email: payload.email,
      role: user.role,
      tenantId: user.tenantId,
      branchId: user.branchId,
      tenantName: payload.tenantName,
      tenantPlan: tenant?.plan || null,
      isPlatform,
      permissions: Array.from(permissionsForRole(user.role)),
    };
  }
}
