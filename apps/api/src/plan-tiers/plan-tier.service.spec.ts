import { BadRequestException, ConflictException } from '@nestjs/common';
import { PlanTierService } from './plan-tier.service';

/**
 * Subscription tiers as platform-owner configuration.
 *
 * The risky part of moving tiers from a compile-time union into rows is what
 * happens at the edges the union used to make impossible: a tier that no longer
 * exists, a tier nobody can select, a tier a paying customer is still on. Those
 * are what this covers.
 */

type Row = Record<string, any>;

const SEED: Row[] = [
  {
    id: 'tier-free',
    name: 'FREE',
    displayName: 'Free',
    description: null,
    priceAmount: 0,
    currency: 'USD',
    maxUsers: 3,
    maxBorrowers: 50,
    maxLoanProducts: 2,
    maxLoans: 100,
    sortOrder: 10,
    isActive: true,
  },
  {
    id: 'tier-basic',
    name: 'BASIC',
    displayName: 'Basic',
    description: null,
    priceAmount: 49,
    currency: 'USD',
    maxUsers: 10,
    maxBorrowers: 500,
    maxLoanProducts: 5,
    maxLoans: 1000,
    sortOrder: 20,
    isActive: true,
  },
  {
    id: 'tier-ent',
    name: 'ENTERPRISE',
    displayName: 'Enterprise',
    description: null,
    priceAmount: 499,
    currency: 'USD',
    // Unlimited, expressed as NULL rather than a sentinel integer.
    maxUsers: null,
    maxBorrowers: null,
    maxLoanProducts: null,
    maxLoans: null,
    sortOrder: 40,
    isActive: true,
  },
];

function buildService(
  rows: Row[] = SEED,
  tenantCounts: Record<string, number> = {},
) {
  const state = { rows: rows.map((r) => ({ ...r })) };

  const prisma = {
    planTier: {
      findMany: jest.fn(async () =>
        [...state.rows].sort(
          (a, b) =>
            a.sortOrder - b.sortOrder ||
            Number(a.priceAmount) - Number(b.priceAmount) ||
            a.name.localeCompare(b.name),
        ),
      ),
      findUnique: jest.fn(
        async ({ where }: any) =>
          state.rows.find((r) => r.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `tier-${state.rows.length + 1}`, ...data };
        state.rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.rows.find((r) => r.id === where.id);
        for (const [k, v] of Object.entries(data)) {
          if (v !== undefined) row![k] = v;
        }
        return row;
      }),
      delete: jest.fn(async ({ where }: any) => {
        state.rows = state.rows.filter((r) => r.id !== where.id);
        return {};
      }),
    },
    tenant: {
      count: jest.fn(async ({ where }: any) => tenantCounts[where.plan] ?? 0),
      groupBy: jest.fn(async () =>
        Object.entries(tenantCounts).map(([plan, n]) => ({
          plan,
          _count: { _all: n },
        })),
      ),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { service: new PlanTierService(prisma as any), prisma, state };
}

describe('PlanTierService — quota resolution', () => {
  it('returns the configured ceilings for a tenant on a known tier', async () => {
    const { service } = buildService();
    await expect(service.ceilingsFor('BASIC')).resolves.toEqual({
      maxUsers: 10,
      maxBorrowers: 500,
      maxLoanProducts: 5,
      maxLoans: 1000,
    });
  });

  it('carries NULL through as unlimited rather than as zero', async () => {
    // A ceiling of 0 would lock an ENTERPRISE tenant out of creating anything;
    // this is the difference between "no limit" and "no allowance".
    const { service } = buildService();
    const ceilings = await service.ceilingsFor('ENTERPRISE');
    expect(ceilings).toEqual({
      maxUsers: null,
      maxBorrowers: null,
      maxLoanProducts: null,
      maxLoans: null,
    });
  });

  it('keeps honouring a retired tier for tenants already on it', async () => {
    // Retiring a tier must not demote the customers paying for it.
    const { service } = buildService([
      SEED[0],
      { ...SEED[1], isActive: false },
    ]);
    await expect(service.ceilingsFor('BASIC')).resolves.toMatchObject({
      maxUsers: 10,
    });
  });

  it('falls back to the cheapest tier for an unrecognised plan', async () => {
    const { service } = buildService();
    await expect(service.ceilingsFor('PLATINUM')).resolves.toMatchObject({
      maxUsers: 3,
    });
  });

  it('falls back to minimum quotas — never unlimited — when no tier exists', async () => {
    // Failing open here would be a billing hole, so an empty or unmigrated
    // table must produce the most restrictive answer, not the most permissive.
    const { service } = buildService([]);
    const ceilings = await service.ceilingsFor('BASIC');
    expect(ceilings.maxUsers).toBe(3);
    expect(Object.values(ceilings)).not.toContain(null);
  });
});

describe('PlanTierService — signup selection', () => {
  it('offers only active tiers', async () => {
    const { service } = buildService([
      SEED[0],
      { ...SEED[1], isActive: false },
      SEED[2],
    ]);
    await expect(service.selectableNames()).resolves.toEqual([
      'FREE',
      'ENTERPRISE',
    ]);
  });

  it('rejects an unknown plan', async () => {
    const { service } = buildService();
    await expect(service.requireSelectable('PLATINUM')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a retired plan for new signups', async () => {
    const { service } = buildService([{ ...SEED[1], isActive: false }]);
    await expect(service.requireSelectable('BASIC')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('marks any priced tier as gated and any zero-priced tier as not', async () => {
    const { service } = buildService();
    await expect(service.byName('FREE')).resolves.toMatchObject({
      requiresPayment: false,
    });
    await expect(service.byName('BASIC')).resolves.toMatchObject({
      requiresPayment: true,
    });
  });

  it('picks the free tier as the default regardless of its name', async () => {
    const { service } = buildService([
      { ...SEED[1], sortOrder: 5 },
      { ...SEED[0], name: 'TRIAL', sortOrder: 30 },
    ]);
    // Sorted first is the paid one; the default still has to be the free tier.
    await expect(service.defaultTier()).resolves.toMatchObject({
      name: 'TRIAL',
    });
  });

  it('returns no default when every tier is retired', async () => {
    const { service } = buildService([{ ...SEED[0], isActive: false }]);
    await expect(service.defaultTier()).resolves.toBeNull();
  });
});

describe('PlanTierService — operator edits', () => {
  it('normalises a new tier key to uppercase', async () => {
    const { service } = buildService();
    const created = await service.create({
      name: 'starter',
      displayName: 'Starter',
      amount: 29,
      currency: 'USD',
    } as any);
    expect(created.name).toBe('STARTER');
  });

  it('rejects a key that would be unusable as a stored plan value', async () => {
    const { service } = buildService();
    await expect(
      service.create({
        name: 'my plan!',
        displayName: 'My Plan',
        amount: 10,
        currency: 'USD',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate key', async () => {
    const { service } = buildService();
    await expect(
      service.create({
        name: 'BASIC',
        displayName: 'Basic Again',
        amount: 59,
        currency: 'USD',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts null as an explicit "unlimited" on update', async () => {
    // null and undefined mean different things here: one sets unlimited, the
    // other leaves the field alone. Collapsing them would make a tier
    // impossible to un-cap through the UI.
    const { service, state } = buildService();
    await service.update('tier-basic', { maxLoans: null } as any);
    expect(state.rows.find((r) => r.id === 'tier-basic')!.maxLoans).toBeNull();
  });

  it('leaves untouched fields alone on a partial update', async () => {
    const { service, state } = buildService();
    await service.update('tier-basic', { amount: 59 } as any);
    const row = state.rows.find((r) => r.id === 'tier-basic')!;
    expect(row.priceAmount).toBe(59);
    expect(row.maxUsers).toBe(10);
  });

  it('reflects a price change immediately rather than serving a stale cache', async () => {
    const { service } = buildService();
    await service.byName('BASIC'); // populate the cache
    await service.update('tier-basic', { amount: 59 } as any);
    await expect(service.byName('BASIC')).resolves.toMatchObject({
      amount: 59,
    });
  });

  it('refuses to delete a tier that organizations are on', async () => {
    // Those rows store the tier by name; deleting it would silently downgrade
    // them to the cheapest tier at their next quota check.
    const { service } = buildService(SEED, { BASIC: 4 });
    await expect(service.remove('tier-basic')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deletes a tier nobody is on', async () => {
    const { service, state } = buildService(SEED, { BASIC: 0 });
    await service.remove('tier-basic');
    expect(state.rows.find((r) => r.id === 'tier-basic')).toBeUndefined();
  });

  it('retires a tier that is in use, since that is always safe', async () => {
    const { service } = buildService(SEED, { BASIC: 4 });
    await expect(service.retire('tier-basic')).resolves.toMatchObject({
      isActive: false,
    });
  });

  it('reports how many organizations each tier holds', async () => {
    const { service } = buildService(SEED, { BASIC: 4 });
    const listed = await service.listWithUsage();
    expect(listed.find((t) => t.name === 'BASIC')!.organizations).toBe(4);
    expect(listed.find((t) => t.name === 'FREE')!.organizations).toBe(0);
  });

  it('renumbers display order from the ids it is given', async () => {
    const { service, state } = buildService();
    await service.reorder({ ids: ['tier-ent', 'tier-free', 'tier-basic'] });
    expect(state.rows.find((r) => r.id === 'tier-ent')!.sortOrder).toBe(10);
    expect(state.rows.find((r) => r.id === 'tier-basic')!.sortOrder).toBe(30);
  });
});
