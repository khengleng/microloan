import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../prisma/prisma.service';
import { runAsSystem } from '../prisma/tenant-context';
import { PlanTierService, QuotaCeilings } from './plan-tier.service';

/**
 * What a plan's quotas count (DECISIONS D-167):
 *
 * - `users`: active staff accounts — a suspended account holds no seat;
 * - `borrowers`: customers;
 * - `loanProducts`: lending products with a version that is not retired or
 *   rejected (a product whose every version is retired no longer counts);
 * - `loans`: lending loan accounts that are BOOKED or ACTIVE — the running
 *   book, not every loan ever made. Closed and written-off loans free room.
 */
export const QUOTA_RESOURCES = [
  'users',
  'borrowers',
  'loanProducts',
  'loans',
] as const;
export type QuotaResource = (typeof QUOTA_RESOURCES)[number];

/** Which ceiling on the tier governs which resource. */
export const CEILING_FIELD: Record<QuotaResource, keyof QuotaCeilings> = {
  users: 'maxUsers',
  borrowers: 'maxBorrowers',
  loanProducts: 'maxLoanProducts',
  loans: 'maxLoans',
};

/** Loan account statuses that occupy the `loans` quota. */
export const RUNNING_LOAN_STATUSES = ['BOOKED', 'ACTIVE'];
/** Product version statuses that no longer make a product count. */
const FINISHED_VERSION_STATUSES = ['RETIRED', 'REJECTED'];

const LABEL: Record<QuotaResource, string> = {
  users: 'active staff accounts',
  borrowers: 'customers',
  loanProducts: 'loan products',
  loans: 'running loans (booked or active)',
};

/** Client (or transaction) the counts run on. */
type Db = Prisma.TransactionClient | PrismaService;

export interface QuotaUsageItem {
  resource: QuotaResource;
  used: number;
  /** null: unlimited. */
  limit: number | null;
}

export interface TenantQuotaUsage {
  tenantId: string;
  plan: string;
  displayName: string;
  items: QuotaUsageItem[];
}

/**
 * The plan's quotas, counted and enforced where the lending platform creates
 * what they limit. Ceilings are the tier's (PlanTier, the platform operator's
 * catalogue); only creating past a ceiling is refused — a tenant already over
 * one (after a downgrade) keeps everything and can still work it.
 */
@Injectable()
export class PlanQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planTiers: PlanTierService,
  ) {}

  /** How many of `resource` the tenant has, as the quota counts them. */
  count(db: Db, tenantId: string, resource: QuotaResource): Promise<number> {
    switch (resource) {
      case 'users':
        return db.user.count({ where: { tenantId, isActive: true } });
      case 'borrowers':
        return db.borrower.count({ where: { tenantId } });
      case 'loanProducts':
        return db.lendingProduct.count({
          where: {
            tenantId,
            versions: {
              some: { status: { notIn: FINISHED_VERSION_STATUSES } },
            },
          },
        });
      case 'loans':
        return db.loanAccount.count({
          where: { tenantId, status: { in: RUNNING_LOAN_STATUSES } },
        });
    }
  }

  private async planOf(db: Db, tenantId: string) {
    const t = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });
    return t?.plan ?? null;
  }

  /**
   * Refuse to add `adding` more of `resource` when that would pass the plan's
   * ceiling. Inside a transaction (`db` with `$executeRaw`), concurrent
   * creations of the same resource for the tenant are serialised by a
   * transaction-scoped advisory lock, so two bookings cannot both take the
   * last place.
   */
  async assertRoom(
    tenantId: string,
    resource: QuotaResource,
    db: Db = this.prisma,
    adding = 1,
  ): Promise<void> {
    const plan = await this.planOf(db, tenantId);
    const ceilings = await this.planTiers.ceilingsFor(plan);
    const limit = ceilings[CEILING_FIELD[resource]];
    // Unlimited: skip the count (on a large book it is not free).
    if (limit === null) return;
    if (db !== this.prisma)
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan-quota:${tenantId}:${resource}`}))`;
    const used = await this.count(db, tenantId, resource);
    if (used + adding > limit) {
      const tier = plan ? await this.planTiers.byName(plan) : null;
      throw PlanQuotaService.limitReached(
        resource,
        limit,
        used,
        plan ?? '',
        tier?.displayName ?? plan ?? '',
      );
    }
  }

  /** The refusal: a stable code and the numbers, so the screen can say it in the reader's language. */
  static limitReached(
    resource: QuotaResource,
    limit: number,
    used: number,
    plan: string,
    displayName: string,
  ) {
    return new ForbiddenException({
      message: `Your ${displayName || 'current'} plan allows ${limit} ${LABEL[resource]} and ${used} are in use. Upgrade the plan (Settings › Subscription) to add more.`,
      code: 'PLAN_LIMIT_REACHED',
      resource,
      limit,
      used,
      plan,
      planName: displayName,
    });
  }

  /** One tenant's usage against its plan, for the subscription screen. */
  async usage(tenantId: string, db: Db = this.prisma): Promise<TenantQuotaUsage> {
    const plan = await this.planOf(db, tenantId);
    const [tier, ceilings] = await Promise.all([
      plan ? this.planTiers.byName(plan) : Promise.resolve(null),
      this.planTiers.ceilingsFor(plan),
    ]);
    const items: QuotaUsageItem[] = [];
    for (const resource of QUOTA_RESOURCES)
      items.push({
        resource,
        used: await this.count(db, tenantId, resource),
        limit: ceilings[CEILING_FIELD[resource]],
      });
    return {
      tenantId,
      plan: plan ?? '',
      displayName: tier?.displayName ?? plan ?? '',
      items,
    };
  }

  /**
   * Every organisation's usage, for the platform operator: four grouped
   * counts across tenants rather than four counts per tenant.
   */
  async usageForAll(): Promise<
    (TenantQuotaUsage & { name: string; status: string; overLimit: boolean })[]
  > {
    return runAsSystem('platform operator: plan usage', async () => {
      const [tenants, users, borrowers, products, loans, tiers] =
        await Promise.all([
          this.prisma.tenant.findMany({
            where: { deletedAt: null },
            select: { id: true, name: true, plan: true, status: true },
            orderBy: { name: 'asc' },
          }),
          this.prisma.user.groupBy({
            by: ['tenantId'],
            where: { isActive: true, tenantId: { not: null } },
            _count: { _all: true },
          }),
          this.prisma.borrower.groupBy({
            by: ['tenantId'],
            _count: { _all: true },
          }),
          this.prisma.lendingProduct.groupBy({
            by: ['tenantId'],
            where: {
              versions: {
                some: { status: { notIn: FINISHED_VERSION_STATUSES } },
              },
            },
            _count: { _all: true },
          }),
          this.prisma.loanAccount.groupBy({
            by: ['tenantId'],
            where: { status: { in: RUNNING_LOAN_STATUSES } },
            _count: { _all: true },
          }),
          this.planTiers.list(),
        ]);
      const byTenant = (rows: { tenantId: string | null; _count: { _all: number } }[]) =>
        new Map(rows.map((r) => [r.tenantId, r._count._all] as const));
      const counts: Record<QuotaResource, Map<string | null, number>> = {
        users: byTenant(users),
        borrowers: byTenant(borrowers),
        loanProducts: byTenant(products),
        loans: byTenant(loans),
      };
      const tierByName = new Map(tiers.map((t) => [t.name, t] as const));
      const out: (TenantQuotaUsage & {
        name: string;
        status: string;
        overLimit: boolean;
      })[] = [];
      for (const t of tenants) {
        const tier = tierByName.get(t.plan);
        const ceilings = tier
          ? tier.limits
          : await this.planTiers.ceilingsFor(t.plan);
        const items = QUOTA_RESOURCES.map((resource) => ({
          resource,
          used: counts[resource].get(t.id) ?? 0,
          limit: ceilings[CEILING_FIELD[resource]],
        }));
        out.push({
          tenantId: t.id,
          name: t.name,
          status: t.status,
          plan: t.plan,
          displayName: tier?.displayName ?? t.plan,
          items,
          overLimit: items.some((i) => i.limit !== null && i.used > i.limit),
        });
      }
      return out;
    });
  }
}
