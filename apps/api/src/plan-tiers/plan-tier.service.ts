import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { runAsSystem } from '../prisma/tenant-context';
import type {
  CreatePlanTierDto,
  ReorderPlanTiersDto,
  UpdatePlanTierDto,
} from './dto/plan-tier.dto';

/** Quota ceilings for one tier. `null` means unlimited. */
export type QuotaCeilings = {
  maxUsers: number | null;
  maxBorrowers: number | null;
  maxLoanProducts: number | null;
  maxLoans: number | null;
};

export type PlanTierView = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  amount: number;
  /** Mirrors the Prisma `Currency` enum; narrowed so KHQR minting type-checks. */
  currency: 'USD' | 'KHR';
  sortOrder: number;
  isActive: boolean;
  /** Derived from price, not from the name: any priced tier is gated. */
  requiresPayment: boolean;
  limits: QuotaCeilings;
};

/**
 * Last-resort ceilings, used only when the tier table is empty or unreachable —
 * a database that has not run the plan-tier migration yet, which in practice
 * means a boot in the window between `migrate deploy` and the first request.
 *
 * Deliberately the old FREE numbers rather than "unlimited": failing open on
 * quota is a billing hole, and a tenant briefly capped low is recoverable
 * while a tenant that minted 10,000 loans for free is not.
 */
const EMERGENCY_CEILINGS: QuotaCeilings = {
  maxUsers: 3,
  maxBorrowers: 50,
  maxLoanProducts: 2,
  maxLoans: 100,
};

/**
 * How long a tier read is served from memory.
 *
 * The quota guard consults this on every quota-checked write, so an uncached
 * read would add a round trip to each of those. Tiers change roughly never, and
 * every write through this service busts the cache, so the window only matters
 * for a second API instance — where 30s of stale pricing is harmless because
 * the price is re-read when the QR is actually minted.
 */
const CACHE_TTL_MS = 30_000;

/** The env vars this table replaced. Their presence now means "misconfigured". */
const SUPERSEDED_PRICE_ENV = [
  'PLAN_PRICE_BASIC',
  'PLAN_PRICE_PROFESSIONAL',
  'PLAN_PRICE_ENTERPRISE',
  'PLAN_PRICE_CURRENCY',
];

type TierRow = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  priceAmount: unknown;
  currency: string;
  maxUsers: number | null;
  maxBorrowers: number | null;
  maxLoanProducts: number | null;
  maxLoans: number | null;
  sortOrder: number;
  isActive: boolean;
};

/**
 * The subscription tier catalogue, owned by the platform operator.
 *
 * Tiers used to be a compile-time union with prices in environment variables.
 * They are rows now: the operator adds, reprices, reorders and retires them
 * from the SUPERADMIN panel, and signup, quota enforcement and KHQR minting all
 * read from here so there is exactly one source of truth.
 */
@Injectable()
export class PlanTierService implements OnModuleInit {
  private readonly logger = new Logger(PlanTierService.name);
  private cache: { rows: TierRow[]; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Warn once at boot if a deployment still carries the pricing env vars. The
   * migration seeds code defaults because SQL cannot read the environment, so
   * an operator who had overridden a price would otherwise discover the
   * reversion when a customer scans a QR for the wrong amount.
   */
  onModuleInit(): void {
    const stale = SUPERSEDED_PRICE_ENV.filter((k) => process.env[k]?.trim());
    if (stale.length) {
      this.logger.warn(
        `${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} set but no longer used — ` +
          `plan prices now live in the PlanTier table. Confirm the prices under ` +
          `Platform → Subscription Plans, then remove ${stale.length === 1 ? 'this variable' : 'these variables'}.`,
      );
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  /**
   * Every tier, newest cache or a fresh read.
   *
   * Runs as system: the catalogue is read on the pre-auth signup page and by
   * the quota guard mid-request, and it is not tenant-owned. The Prisma guard
   * classifies PlanTier as a platform catalogue — readable by anyone, writable
   * only by the platform — so this is about being explicit, not about lifting a
   * restriction.
   */
  private async rows(): Promise<TierRow[]> {
    const fresh = this.cache && Date.now() - this.cache.at < CACHE_TTL_MS;
    if (fresh) return this.cache!.rows;

    const rows = (await runAsSystem('plan tier catalogue read', () =>
      this.prisma.planTier.findMany({
        orderBy: [{ sortOrder: 'asc' }, { priceAmount: 'asc' }, { name: 'asc' }],
      }),
    )) as unknown as TierRow[];

    this.cache = { rows, at: Date.now() };
    return rows;
  }

  private invalidate(): void {
    this.cache = null;
  }

  private static toView(row: TierRow): PlanTierView {
    const amount = Number(row.priceAmount ?? 0);
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      amount,
      currency: row.currency as 'USD' | 'KHR',
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      requiresPayment: amount > 0,
      limits: {
        maxUsers: row.maxUsers,
        maxBorrowers: row.maxBorrowers,
        maxLoanProducts: row.maxLoanProducts,
        maxLoans: row.maxLoans,
      },
    };
  }

  /** Every tier including retired ones — the operator's management view. */
  async list(): Promise<PlanTierView[]> {
    return (await this.rows()).map(PlanTierService.toView);
  }

  /**
   * The management view: every tier plus how many organizations are on it, so
   * the operator can see what a retire or delete would affect before doing it.
   * One `groupBy` rather than a count per tier.
   */
  async listWithUsage(): Promise<(PlanTierView & { organizations: number })[]> {
    const [tiers, grouped] = await Promise.all([
      this.list(),
      this.prisma.tenant.groupBy({ by: ['plan'], _count: { _all: true } }),
    ]);
    const counts = new Map(
      grouped.map((g) => [g.plan, g._count._all] as const),
    );
    return tiers.map((t) => ({
      ...t,
      organizations: counts.get(t.name) ?? 0,
    }));
  }

  /** Tiers a new customer may choose. Retired tiers are not offered. */
  async catalogue(): Promise<PlanTierView[]> {
    return (await this.rows())
      .filter((r) => r.isActive)
      .map(PlanTierService.toView);
  }

  /** One tier by its stable name, retired or not. */
  async byName(name: string): Promise<PlanTierView | null> {
    const row = (await this.rows()).find((r) => r.name === name);
    return row ? PlanTierService.toView(row) : null;
  }

  /** Valid tier names for signup: active tiers only. */
  async selectableNames(): Promise<string[]> {
    return (await this.catalogue()).map((t) => t.name);
  }

  /**
   * The tier a signup request may actually be provisioned on.
   *
   * Rejects unknown and retired names rather than quietly falling back to a
   * free tier, because the caller is choosing what to pay for — a silent
   * downgrade here would take money for one tier and grant another.
   */
  async requireSelectable(name: string): Promise<PlanTierView> {
    const tier = await this.byName(name);
    if (!tier) {
      const available = (await this.selectableNames()).join(', ');
      throw new BadRequestException(
        `Unknown plan "${name}". Available plans: ${available || 'none'}.`,
      );
    }
    if (!tier.isActive) {
      throw new BadRequestException(
        `The ${tier.displayName} plan is no longer available for new signups.`,
      );
    }
    return tier;
  }

  /**
   * The tier a workspace gets when the applicant chose nothing, and the one a
   * paid workspace parks on while it sits in PENDING_PAYMENT.
   *
   * The cheapest free active tier, falling back to the cheapest active tier of
   * any price. Returns null only when the operator has retired everything — the
   * caller turns that into a clear "signup is closed" rather than inventing a
   * tier that does not exist.
   */
  async defaultTier(): Promise<PlanTierView | null> {
    const active = await this.catalogue();
    if (!active.length) return null;
    const free = active.filter((t) => !t.requiresPayment);
    const pool = free.length ? free : active;
    return [...pool].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.amount - b.amount,
    )[0];
  }

  /**
   * Quota ceilings for a tenant's current plan.
   *
   * Never throws and never fails open. A retired tier still resolves — a tenant
   * already on it keeps its ceilings, because retiring a tier must not demote
   * paying customers. An unrecognised plan falls back to the cheapest tier,
   * which is the closest thing to "no entitlement" the catalogue offers.
   */
  async ceilingsFor(plan?: string | null): Promise<QuotaCeilings> {
    const rows = await this.rows();
    if (!rows.length) {
      this.logger.error(
        'No plan tiers are defined — falling back to minimum quotas. ' +
          'Run the plan-tier migration and configure tiers under Platform → Subscription Plans.',
      );
      return EMERGENCY_CEILINGS;
    }

    const exact = plan ? rows.find((r) => r.name === plan) : undefined;
    if (exact) return PlanTierService.toView(exact).limits;

    const cheapest = [...rows].sort(
      (a, b) => Number(a.priceAmount ?? 0) - Number(b.priceAmount ?? 0),
    )[0];
    this.logger.warn(
      `Tenant plan ${JSON.stringify(plan)} matches no tier — applying ${cheapest.name} quotas.`,
    );
    return PlanTierService.toView(cheapest).limits;
  }

  // ── Writes (SUPERADMIN only, enforced at the controller) ─────────────────

  async create(dto: CreatePlanTierDto): Promise<PlanTierView> {
    const name = dto.name.trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,32}$/.test(name)) {
      throw new BadRequestException(
        'Plan key must be 2–32 characters, A–Z, 0–9 or underscore. It is stored on every organization and cannot be changed later.',
      );
    }
    if (await this.byName(name)) {
      throw new ConflictException(`A plan named ${name} already exists.`);
    }

    const row = await this.prisma.planTier.create({
      data: {
        name,
        displayName: dto.displayName.trim(),
        description: dto.description?.trim() || null,
        priceAmount: dto.amount,
        currency: dto.currency,
        maxUsers: dto.maxUsers ?? null,
        maxBorrowers: dto.maxBorrowers ?? null,
        maxLoanProducts: dto.maxLoanProducts ?? null,
        maxLoans: dto.maxLoans ?? null,
        sortOrder: dto.sortOrder ?? 100,
        isActive: dto.isActive ?? true,
      },
    });
    this.invalidate();
    this.logger.log(`Plan tier created: ${name}`);
    return PlanTierService.toView(row as unknown as TierRow);
  }

  /**
   * Update everything except `name`, which is immutable: it is stored on
   * `Tenant.plan` and `PlanPayment.plan` as a value rather than a foreign key,
   * so renaming would orphan every organization already on the tier.
   */
  async update(id: string, dto: UpdatePlanTierDto): Promise<PlanTierView> {
    const existing = await this.prisma.planTier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Plan tier not found.');

    const row = await this.prisma.planTier.update({
      where: { id },
      data: {
        displayName: dto.displayName?.trim() ?? undefined,
        description:
          dto.description === undefined
            ? undefined
            : dto.description.trim() || null,
        priceAmount: dto.amount ?? undefined,
        currency: dto.currency ?? undefined,
        // `null` is meaningful here (unlimited), so only `undefined` is skipped.
        maxUsers: dto.maxUsers === undefined ? undefined : dto.maxUsers,
        maxBorrowers:
          dto.maxBorrowers === undefined ? undefined : dto.maxBorrowers,
        maxLoanProducts:
          dto.maxLoanProducts === undefined ? undefined : dto.maxLoanProducts,
        maxLoans: dto.maxLoans === undefined ? undefined : dto.maxLoans,
        sortOrder: dto.sortOrder ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
    this.invalidate();
    return PlanTierService.toView(row as unknown as TierRow);
  }

  /** How many organizations are on a tier — the guard against destroying one. */
  async usageOf(name: string): Promise<number> {
    return this.prisma.tenant.count({ where: { plan: name } });
  }

  /**
   * Retire a tier: it disappears from signup but keeps serving quotas to the
   * organizations already on it. This is the safe counterpart to deletion and
   * is always allowed.
   */
  async retire(id: string): Promise<PlanTierView> {
    return this.update(id, { isActive: false });
  }

  /**
   * Hard-delete a tier. Refused while any organization is on it — those rows
   * store the tier by name, so deleting it would leave them resolving to the
   * cheapest tier at their next quota check, silently downgrading a customer
   * who may be paying.
   */
  async remove(id: string): Promise<{ success: true }> {
    const existing = await this.prisma.planTier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Plan tier not found.');

    const inUse = await this.usageOf(existing.name);
    if (inUse > 0) {
      throw new ConflictException(
        `${existing.name} cannot be deleted: ${inUse} organization${inUse === 1 ? ' is' : 's are'} on it. ` +
          `Retire it instead — retired plans stay valid for existing customers but cannot be chosen at signup.`,
      );
    }

    await this.prisma.planTier.delete({ where: { id } });
    this.invalidate();
    this.logger.log(`Plan tier deleted: ${existing.name}`);
    return { success: true };
  }

  /** Set display order in one shot, so the UI can persist a drag-and-drop. */
  async reorder(dto: ReorderPlanTiersDto): Promise<PlanTierView[]> {
    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.planTier.update({
          where: { id },
          data: { sortOrder: (index + 1) * 10 },
        }),
      ),
    );
    this.invalidate();
    return this.list();
  }
}
