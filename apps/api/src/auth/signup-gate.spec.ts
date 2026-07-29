// otplib ships ESM-only deps (@scure/base) that this project's jest transform
// does not process. Nothing under test here touches TOTP generation, so it is
// stubbed rather than paying for a transformIgnorePatterns change.
jest.mock('otplib', () => ({ verify: jest.fn(), generateSecret: jest.fn() }));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleIdentityService } from './google-identity.service';

/**
 * The self-serve signup gate.
 *
 * Two invariants matter here and neither is visible from a unit test of the
 * pieces in isolation:
 *   1. A paid workspace is created inert (PENDING_PAYMENT) AND on FREE quota
 *      limits — storing the paid plan on the tenant before payment would hand
 *      out paid capacity for free.
 *   2. The gate cannot be sidestepped by choosing the other signup path;
 *      password and Google both funnel through provisionTenant.
 */

type Captured = { tenant?: any; user?: any; identity?: any };

/** A tier as `PlanTierService` hands it to the rest of the app. */
function tier(name: string, amount: number, extra: any = {}) {
  return {
    id: `tier-${name.toLowerCase()}`,
    name,
    displayName: name[0] + name.slice(1).toLowerCase(),
    description: null,
    amount,
    currency: 'USD',
    sortOrder: 10,
    isActive: true,
    requiresPayment: amount > 0,
    limits: {
      maxUsers: 3,
      maxBorrowers: 50,
      maxLoanProducts: 2,
      maxLoans: 100,
    },
    ...extra,
  };
}

function buildService(
  overrides: {
    khqrConfigured?: boolean;
    existingUser?: any;
    existingIdentity?: any;
    googleProfile?: any;
    /** Simulate an operator who has retired or never created any tier. */
    tiers?: Record<string, any>;
  } = {},
) {
  const captured: Captured = {};

  const tx = {
    tenant: {
      create: jest.fn(async ({ data }: any) => {
        captured.tenant = data;
        return {
          id: 'tenant-1',
          name: data.name,
          status: data.status,
          plan: data.plan,
        };
      }),
    },
    user: {
      create: jest.fn(async ({ data }: any) => {
        captured.user = data;
        return {
          id: 'user-1',
          email: data.email,
          role: data.role,
          tenantId: data.tenantId,
        };
      }),
    },
    federatedIdentity: {
      create: jest.fn(async ({ data }: any) => {
        captured.identity = data;
        return { id: 'fed-1', ...data };
      }),
    },
  };

  const prisma = {
    // Interactive-transaction stand-in: hand the callback our fake tx client.
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    user: {
      findUnique: jest.fn(async () => overrides.existingUser ?? null),
      update: jest.fn(async () => ({})),
    },
    federatedIdentity: {
      findUnique: jest.fn(async () => overrides.existingIdentity ?? null),
      create: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({})),
    },
  };

  const signupPayments = {
    isConfigured: jest.fn(() => overrides.khqrConfigured ?? true),
    createForTenant: jest.fn(async () => ({
      reference: 'REF123',
      qrPayload: '000201...6304ABCD',
      amount: 149,
      currency: 'USD',
    })),
    renderQr: jest.fn(async () => 'data:image/png;base64,fake'),
  };

  const google = {
    verify: jest.fn(
      async () =>
        overrides.googleProfile ?? {
          subject: 'google-sub-1',
          email: 'founder@acme.com',
        },
    ),
    isConfigured: jest.fn(() => true),
    clientId: 'client-id',
  };

  const audit = { logSecurityEvent: jest.fn(), logAction: jest.fn() };

  // Stands in for the DB-backed tier catalogue the operator configures.
  const tiers = overrides.tiers ?? {
    FREE: tier('FREE', 0),
    BASIC: tier('BASIC', 49),
    PROFESSIONAL: tier('PROFESSIONAL', 149),
    ENTERPRISE: tier('ENTERPRISE', 499),
  };
  const planTiers = {
    byName: jest.fn(async (name: string) => tiers[name] ?? null),
    catalogue: jest.fn(async () =>
      Object.values(tiers).filter((t: any) => t.isActive),
    ),
    defaultTier: jest.fn(async () => {
      const active = Object.values(tiers).filter((t: any) => t.isActive);
      return active.find((t: any) => !t.requiresPayment) ?? active[0] ?? null;
    }),
    requireSelectable: jest.fn(async (name: string) => {
      const found = tiers[name];
      if (!found) throw new BadRequestException(`Unknown plan "${name}".`);
      if (!found.isActive) {
        throw new BadRequestException(`${name} is no longer available.`);
      }
      return found;
    }),
    ceilingsFor: jest.fn(async () => tier('FREE', 0).limits),
  };

  const service = new AuthService(
    { sign: jest.fn(() => 'signed-token') } as any,
    prisma as any,
    audit as any,
    { sendEmail: jest.fn() } as any,
    google as any,
    signupPayments as any,
    planTiers as any,
  );

  return {
    service,
    prisma,
    signupPayments,
    google,
    audit,
    captured,
    tx,
    planTiers,
  };
}

describe('Self-serve signup — payment gate', () => {
  describe('FREE plan', () => {
    it('activates the workspace immediately with no payment', async () => {
      const { service, captured, signupPayments } = buildService();

      const result: any = await service.registerTenant(
        {
          organizationName: 'Acme',
          adminEmail: 'Founder@Acme.com',
          adminPassword: 'a-very-long-password',
          plan: 'FREE',
        } as any,
        '1.2.3.4',
      );

      expect(captured.tenant).toMatchObject({ status: 'ACTIVE', plan: 'FREE' });
      expect(signupPayments.createForTenant).not.toHaveBeenCalled();
      expect(result.paymentRequired).toBe(false);
    });

    it('defaults an omitted plan to FREE rather than skipping the gate', async () => {
      const { service, captured } = buildService();
      await service.registerTenant({
        organizationName: 'Acme',
        adminEmail: 'a@b.co',
        adminPassword: 'x'.repeat(12),
      } as any);
      expect(captured.tenant).toMatchObject({ status: 'ACTIVE', plan: 'FREE' });
    });

    it('lowercases the admin email so Google matching cannot be case-dodged', async () => {
      const { service, captured } = buildService();
      await service.registerTenant({
        organizationName: 'Acme',
        adminEmail: 'Founder@Acme.COM',
        adminPassword: 'x'.repeat(12),
      } as any);
      expect(captured.user.email).toBe('founder@acme.com');
    });
  });

  describe('paid plan', () => {
    it('creates the workspace INERT and on FREE limits until payment clears', async () => {
      const { service, captured, signupPayments } = buildService();

      const result: any = await service.registerTenant({
        organizationName: 'Acme',
        adminEmail: 'a@b.co',
        adminPassword: 'x'.repeat(12),
        plan: 'PROFESSIONAL',
      } as any);

      expect(captured.tenant.status).toBe('PENDING_PAYMENT');
      // The requested plan is deliberately NOT written to the tenant yet.
      expect(captured.tenant.plan).toBe('FREE');
      // Handed the resolved tier, not just its name: the price the QR is
      // minted for comes from the row the operator configured.
      expect(signupPayments.createForTenant).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ name: 'PROFESSIONAL', amount: 149 }),
        expect.anything(),
      );
      expect(result.paymentRequired).toBe(true);
      expect(result.payment).toMatchObject({
        reference: 'REF123',
        amount: 149,
      });
    });

    it('refuses before creating anything when no KHQR merchant is configured', async () => {
      const { service, prisma } = buildService({ khqrConfigured: false });

      await expect(
        service.registerTenant({
          organizationName: 'Acme',
          adminEmail: 'a@b.co',
          adminPassword: 'x'.repeat(12),
          plan: 'BASIC',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a duplicate admin email', async () => {
      const { service } = buildService({ existingUser: { id: 'u9' } });
      await expect(
        service.registerTenant({
          organizationName: 'A',
          adminEmail: 'a@b.co',
          adminPassword: 'x'.repeat(12),
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  /**
   * Tiers are rows the platform owner edits, not a compile-time union. These
   * cover what that makes possible — and what it must not make possible.
   */
  describe('operator-defined tiers', () => {
    it('gates a custom tier and mints its configured price', async () => {
      const { service, captured, signupPayments } = buildService({
        tiers: { FREE: tier('FREE', 0), STARTER: tier('STARTER', 29) },
      });

      await service.registerTenant({
        organizationName: 'Acme',
        adminEmail: 'a@b.co',
        adminPassword: 'x'.repeat(12),
        plan: 'STARTER',
      } as any);

      expect(captured.tenant.status).toBe('PENDING_PAYMENT');
      expect(signupPayments.createForTenant).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ name: 'STARTER', amount: 29 }),
        expect.anything(),
      );
    });

    it('treats a second zero-priced tier as free, not as an unpaid paid tier', async () => {
      // The gate is derived from price, not from the name "FREE". An operator
      // who adds a $0 NGO tier must not have their customers stranded in
      // PENDING_PAYMENT waiting to pay nothing.
      const { service, captured, signupPayments } = buildService({
        tiers: { FREE: tier('FREE', 0), NGO: tier('NGO', 0) },
      });

      await service.registerTenant({
        organizationName: 'Acme',
        adminEmail: 'a@b.co',
        adminPassword: 'x'.repeat(12),
        plan: 'NGO',
      } as any);

      expect(captured.tenant).toMatchObject({ status: 'ACTIVE', plan: 'NGO' });
      expect(signupPayments.createForTenant).not.toHaveBeenCalled();
    });

    it('refuses an unknown plan instead of silently downgrading to free', async () => {
      // A silent fallback would take a signup for a tier the applicant thinks
      // they are buying and hand them a different one.
      const { service, prisma } = buildService();

      await expect(
        service.registerTenant({
          organizationName: 'Acme',
          adminEmail: 'a@b.co',
          adminPassword: 'x'.repeat(12),
          plan: 'PLATINUM',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a retired tier for new signups', async () => {
      const { service, prisma } = buildService({
        tiers: {
          FREE: tier('FREE', 0),
          LEGACY: tier('LEGACY', 99, { isActive: false }),
        },
      });

      await expect(
        service.registerTenant({
          organizationName: 'Acme',
          adminEmail: 'a@b.co',
          adminPassword: 'x'.repeat(12),
          plan: 'LEGACY',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses signup entirely when no tier is configured', async () => {
      const { service, prisma } = buildService({ tiers: {} });

      await expect(
        service.registerTenant({
          organizationName: 'Acme',
          adminEmail: 'a@b.co',
          adminPassword: 'x'.repeat(12),
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('parks a paid signup on the free tier, whatever the operator named it', async () => {
      const { service, captured } = buildService({
        tiers: { TRIAL: tier('TRIAL', 0), PRO: tier('PRO', 199) },
      });

      await service.registerTenant({
        organizationName: 'Acme',
        adminEmail: 'a@b.co',
        adminPassword: 'x'.repeat(12),
        plan: 'PRO',
      } as any);

      // Not 'FREE' — that tier does not exist here. The holding plan has to be
      // a tier that resolves, or the tenant's first quota check falls back.
      expect(captured.tenant).toMatchObject({
        status: 'PENDING_PAYMENT',
        plan: 'TRIAL',
      });
    });
  });

  describe('Google signup uses the same gate', () => {
    it('applies PENDING_PAYMENT to a paid plan exactly as the password path does', async () => {
      const { service, captured } = buildService();

      const result: any = await service.registerTenantWithGoogle({
        idToken: 'tok',
        organizationName: 'Acme',
        plan: 'ENTERPRISE',
      } as any);

      expect(captured.tenant.status).toBe('PENDING_PAYMENT');
      expect(captured.tenant.plan).toBe('FREE');
      expect(result.paymentRequired).toBe(true);
    });

    it('creates the account with no password and a linked identity', async () => {
      const { service, captured } = buildService();
      await service.registerTenantWithGoogle({
        idToken: 'tok',
        organizationName: 'Acme',
        plan: 'FREE',
      } as any);

      expect(captured.user.passwordHash).toBeNull();
      expect(captured.identity).toMatchObject({
        provider: 'GOOGLE',
        providerAccountId: 'google-sub-1',
        email: 'founder@acme.com',
      });
    });

    it('refuses to re-register an already linked Google account', async () => {
      const { service } = buildService({ existingIdentity: { id: 'fed-9' } });
      await expect(
        service.registerTenantWithGoogle({
          idToken: 'tok',
          organizationName: 'Acme',
          plan: 'FREE',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses when the Google email already owns an account', async () => {
      const { service } = buildService({ existingUser: { id: 'u9' } });
      await expect(
        service.registerTenantWithGoogle({
          idToken: 'tok',
          organizationName: 'Acme',
          plan: 'FREE',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

describe('Google sign-in', () => {
  it('does not auto-provision an account for an unknown email', async () => {
    // Staff accounts belong to a tenant and are created by that tenant's
    // admin — a valid Google token is not by itself grounds for an account.
    const { service } = buildService();
    await expect(
      service.loginWithGoogle('tok', '1.2.3.4'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('links an existing account on first Google sign-in and issues a session', async () => {
    const { service, prisma } = buildService({
      existingUser: {
        id: 'u1',
        email: 'founder@acme.com',
        role: 'TENANT_ADMIN',
        tenantId: 't1',
        branchId: null,
        isActive: true,
        twoFactorEnabled: false,
        tenant: { status: 'ACTIVE', name: 'Acme' },
      },
    });
    (prisma as any).tenant = {
      findUnique: jest.fn(async () => ({ name: 'Acme' })),
    };
    (prisma as any).refreshToken = { create: jest.fn(async () => ({})) };

    await service.loginWithGoogle('tok', '1.2.3.4');

    expect(prisma.federatedIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', provider: 'GOOGLE' }),
    });
  });

  it('blocks sign-in to a workspace still awaiting payment, with a distinct message', async () => {
    const { service } = buildService({
      existingUser: {
        id: 'u1',
        email: 'founder@acme.com',
        role: 'TENANT_ADMIN',
        tenantId: 't1',
        isActive: true,
        tenant: { status: 'PENDING_PAYMENT', name: 'Acme' },
      },
    });

    await expect(service.loginWithGoogle('tok')).rejects.toThrow(
      /awaiting plan payment confirmation/i,
    );
    await expect(service.loginWithGoogle('tok')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('still demands MFA when the account has TOTP enrolled', async () => {
    const { service } = buildService({
      existingUser: {
        id: 'u1',
        email: 'founder@acme.com',
        role: 'TENANT_ADMIN',
        tenantId: 't1',
        isActive: true,
        twoFactorEnabled: true,
        tenant: { status: 'ACTIVE', name: 'Acme' },
      },
    });

    const result: any = await service.loginWithGoogle('tok');
    expect(result).toMatchObject({
      mfaRequired: true,
      mfaToken: 'signed-token',
    });
  });
});

describe('GoogleIdentityService', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('reports unconfigured and refuses to verify without a client id', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const svc = new GoogleIdentityService();
    expect(svc.isConfigured()).toBe(false);
    await expect(svc.verify('tok')).rejects.toThrow(/not configured/i);
  });
});
