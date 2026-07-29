import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PlanChangeService } from './plan-change.service';

/**
 * Upgrading a workspace that already exists.
 *
 * The gate at signup is about letting nobody in until they pay. This one is the
 * opposite problem: the customer is already inside and working, so the risk is
 * taking that away from them. These cover the ways that could happen.
 */

const HOUR = 60 * 60 * 1000;

function tier(name: string, amount: number, extra: Record<string, unknown> = {}) {
  return {
    id: `tier-${name.toLowerCase()}`,
    name,
    displayName: name[0] + name.slice(1).toLowerCase(),
    description: null,
    amount,
    currency: 'USD' as const,
    sortOrder: 10,
    isActive: true,
    requiresPayment: amount > 0,
    limits: { maxUsers: 3, maxBorrowers: 50, maxLoanProducts: 2, maxLoans: 100 },
    ...extra,
  };
}

const TIERS: Record<string, ReturnType<typeof tier>> = {
  FREE: tier('FREE', 0),
  BASIC: tier('BASIC', 49),
  PROFESSIONAL: tier('PROFESSIONAL', 149),
};

function build(opts: {
  currentPlan?: string;
  pending?: Record<string, unknown> | null;
  khqrConfigured?: boolean;
} = {}) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const prisma = {
    tenant: {
      findUnique: jest.fn(async () => ({
        plan: opts.currentPlan ?? 'FREE',
        status: 'ACTIVE',
      })),
    },
    planPayment: {
      findFirst: jest.fn(async () => opts.pending ?? null),
      findUnique: jest.fn(async () => ({
        reference: 'REF1',
        plan: 'BASIC',
        amount: { toString: () => '49' },
        currency: 'USD',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + HOUR),
        qrPayload: '000201...',
      })),
      update: jest.fn(async (args: Record<string, unknown>) => {
        updated.push(args);
        return {};
      }),
    },
  };

  const planTiers = {
    catalogue: jest.fn(async () => Object.values(TIERS)),
    byName: jest.fn(async (n: string) => TIERS[n] ?? null),
    requireSelectable: jest.fn(async (n: string) => {
      const t = TIERS[n];
      if (!t) throw new BadRequestException(`Unknown plan "${n}".`);
      return t;
    }),
  };

  const signupPayments = {
    isConfigured: jest.fn(async () => opts.khqrConfigured ?? true),
    createForTenant: jest.fn(async (tenantId: string, t: { name: string }) => {
      created.push({ tenantId, plan: t.name });
      return { reference: 'REF1', qrPayload: '000201...', amount: 49, currency: 'USD' };
    }),
    renderQr: jest.fn(async () => 'data:image/png;base64,fake'),
  };

  const service = new PlanChangeService(
    prisma as never,
    planTiers as never,
    signupPayments as never,
  );
  return { service, prisma, planTiers, signupPayments, created, updated };
}

describe('PlanChangeService — requesting an upgrade', () => {
  it('mints a KHQR for a paid tier', async () => {
    const { service, created } = build({ currentPlan: 'FREE' });
    const res = await service.request('t1', 'BASIC');

    expect(created).toEqual([{ tenantId: 't1', plan: 'BASIC' }]);
    expect(res).toMatchObject({ reference: 'REF1', plan: 'BASIC' });
    expect(res.qrImage).toMatch(/^data:image\/png/);
  });

  it('never touches tenant status — an upgrade must not lock anyone out', async () => {
    // Signup parks a workspace in PENDING_PAYMENT because it has not been paid
    // for at all. Doing that here would take a working system away from a
    // customer in order to sell them more of it.
    const { service, prisma } = build({ currentPlan: 'FREE' });
    await service.request('t1', 'BASIC');
    expect(
      (prisma.tenant as unknown as { update?: unknown }).update,
    ).toBeUndefined();
  });

  it('refuses the plan the tenant is already on', async () => {
    const { service } = build({ currentPlan: 'BASIC' });
    await expect(service.request('t1', 'BASIC')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses an unknown plan', async () => {
    const { service } = build();
    await expect(service.request('t1', 'PLATINUM')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a downgrade to a free tier', async () => {
    // The tenant may already exceed the free ceilings. QuotaGuard only blocks
    // creating past a limit, so nothing would break loudly — they would simply
    // sit over quota with no way back but deleting their own data.
    const { service } = build({ currentPlan: 'BASIC' });
    await expect(service.request('t1', 'FREE')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns the existing code instead of minting a second one', async () => {
    // Two live QRs for one workspace means the operator has to guess which
    // transfer belongs to which row.
    const { service, created } = build({
      currentPlan: 'FREE',
      pending: {
        id: 'p1',
        reference: 'REF-OLD',
        plan: 'BASIC',
        amount: { toString: () => '49' },
        currency: 'USD',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + HOUR),
        qrPayload: 'old-payload',
      },
    });

    const res = await service.request('t1', 'BASIC');
    expect(res.reference).toBe('REF-OLD');
    expect(created).toHaveLength(0);
  });

  it('refuses a different plan while one is already awaiting payment', async () => {
    const { service } = build({
      currentPlan: 'FREE',
      pending: {
        id: 'p1',
        reference: 'REF-OLD',
        plan: 'BASIC',
        amount: { toString: () => '49' },
        currency: 'USD',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + HOUR),
        qrPayload: 'old-payload',
      },
    });
    await expect(service.request('t1', 'PROFESSIONAL')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('treats an expired request as gone and mints a fresh one', async () => {
    const { service, created } = build({
      currentPlan: 'FREE',
      pending: {
        id: 'p1',
        reference: 'REF-OLD',
        plan: 'BASIC',
        amount: { toString: () => '49' },
        currency: 'USD',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - HOUR),
        qrPayload: 'old-payload',
      },
    });
    const res = await service.request('t1', 'BASIC');
    expect(created).toHaveLength(1);
    expect(res.reference).toBe('REF1');
  });
});

describe('PlanChangeService — the options screen', () => {
  it('excludes the current plan and every free tier', async () => {
    const { service } = build({ currentPlan: 'BASIC' });
    const res = await service.options('t1');
    expect(res.options.map(o => o.name)).toEqual(['PROFESSIONAL']);
    expect(res.currentPlan).toBe('BASIC');
  });

  it('reports khqrConfigured so the UI can explain itself', async () => {
    const { service } = build({ khqrConfigured: false });
    await expect(service.options('t1')).resolves.toMatchObject({
      khqrConfigured: false,
    });
  });

  it('surfaces a live pending request with its QR', async () => {
    const { service } = build({
      currentPlan: 'FREE',
      pending: {
        id: 'p1',
        reference: 'REF-OLD',
        plan: 'BASIC',
        amount: { toString: () => '49' },
        currency: 'USD',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + HOUR),
        qrPayload: 'old-payload',
      },
    });
    const res = await service.options('t1');
    expect(res.pending).toMatchObject({ reference: 'REF-OLD', plan: 'BASIC' });
  });
});

describe('PlanChangeService — cancelling', () => {
  it('withdraws a pending request so another plan can be chosen', async () => {
    const { service, updated } = build({
      currentPlan: 'FREE',
      pending: {
        id: 'p1',
        reference: 'REF-OLD',
        plan: 'BASIC',
        amount: { toString: () => '49' },
        currency: 'USD',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + HOUR),
        qrPayload: 'old-payload',
      },
    });
    await service.cancel('t1');
    expect(updated[0]).toMatchObject({
      where: { id: 'p1' },
      data: { status: 'REJECTED' },
    });
  });

  it('404s when there is nothing to cancel', async () => {
    const { service } = build();
    await expect(service.cancel('t1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
