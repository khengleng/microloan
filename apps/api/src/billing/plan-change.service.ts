import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanTierService, PlanTierView } from '../plan-tiers/plan-tier.service';
import { SignupPaymentService } from './signup-payment.service';

/**
 * Plan changes for a workspace that already exists.
 *
 * The KHQR gate was built for signup only: `createForTenant` had exactly one
 * caller, in `AuthService`. An existing tenant admin had no way to move to a
 * paid tier — the settings screen offered a Stripe portal that is not
 * configured, so it read "online billing coming soon" forever.
 *
 * This reuses the signup machinery rather than inventing a second payment
 * concept: the same `PlanPayment` row, the same minted KHQR, and the same
 * SUPERADMIN confirmation that signup uses. `TenantsService.confirmPlanPayment`
 * already sets `status: 'ACTIVE'` alongside the new plan, so confirming an
 * upgrade leaves a working workspace working.
 *
 * The tenant is never moved to PENDING_PAYMENT for an upgrade. Signup does that
 * because the workspace has not been paid for at all; doing it here would lock
 * a paying customer out of a system they are already using in order to sell
 * them more of it.
 */
@Injectable()
export class PlanChangeService {
  private readonly logger = new Logger(PlanChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planTiers: PlanTierService,
    private readonly signupPayments: SignupPaymentService,
  ) {}

  /** The pending request for this tenant, if one is still live. */
  private async livePending(tenantId: string) {
    const pending = await this.prisma.planPayment.findFirst({
      where: { tenantId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return null;
    // An expired row is not "pending" to a user staring at a dead QR.
    if (pending.expiresAt.getTime() < Date.now()) return null;
    return pending;
  }

  /**
   * What this tenant can move to, plus anything already in flight.
   *
   * Retired tiers are excluded, and so is the tenant's current plan — the
   * screen is for changing plan, not for re-buying the one you have.
   */
  async options(tenantId: string) {
    const [tenant, catalogue, khqrConfigured, pending] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { plan: true },
      }),
      this.planTiers.catalogue(),
      this.signupPayments.isConfigured(),
      this.livePending(tenantId),
    ]);
    if (!tenant) throw new NotFoundException('Organization not found.');

    const current = await this.planTiers.byName(tenant.plan);

    return {
      currentPlan: tenant.plan,
      current: current
        ? {
            name: current.name,
            displayName: current.displayName,
            amount: current.amount,
            currency: current.currency,
            limits: current.limits,
          }
        : null,
      khqrConfigured,
      // Only priced tiers are self-service. See `request()`.
      options: catalogue
        .filter((t) => t.requiresPayment && t.name !== tenant.plan)
        .map((t) => ({
          name: t.name,
          displayName: t.displayName,
          description: t.description,
          amount: t.amount,
          currency: t.currency,
          limits: t.limits,
        })),
      pending: pending
        ? {
            reference: pending.reference,
            plan: pending.plan,
            amount: pending.amount.toString(),
            currency: pending.currency,
            expiresAt: pending.expiresAt,
            qrPayload: pending.qrPayload,
            qrImage: await this.signupPayments.renderQr(pending.qrPayload),
          }
        : null,
    };
  }

  /**
   * Mint a KHQR for moving to `planName`.
   *
   * Idempotent by design: if a request is already pending, the existing code is
   * returned rather than a second one minted. Two live QRs for one workspace
   * means the operator has to guess which transfer belongs to which row.
   */
  async request(tenantId: string, planName: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Organization not found.');

    const existing = await this.livePending(tenantId);
    if (existing) {
      if (existing.plan !== planName) {
        throw new ConflictException(
          `A payment for the ${existing.plan} plan is already awaiting confirmation. ` +
            `Cancel it or wait for it to be confirmed before choosing a different plan.`,
        );
      }
      return this.view(existing);
    }

    const tier: PlanTierView = await this.planTiers.requireSelectable(planName);

    if (tier.name === tenant.plan) {
      throw new BadRequestException(
        `This organization is already on the ${tier.displayName} plan.`,
      );
    }

    /*
     * Free tiers are deliberately not self-service.
     *
     * Moving down to one would put the workspace under ceilings it may already
     * exceed — ten staff accounts against a three-user cap. `QuotaGuard` only
     * blocks *creating* past a limit, so nothing would be deleted and nothing
     * would break loudly; the tenant would simply sit over quota with no way
     * back except deleting their own data. That is a support conversation, not
     * a button.
     */
    if (!tier.requiresPayment) {
      throw new BadRequestException(
        `Moving to the ${tier.displayName} plan may put this organization over its limits. ` +
          `Contact platform support to arrange it.`,
      );
    }

    const payment = await this.signupPayments.createForTenant(tenantId, tier);
    this.logger.log(
      `Plan change requested: tenant=${tenantId} ${tenant.plan} -> ${tier.name} ref=${payment.reference}`,
    );

    const row = await this.prisma.planPayment.findUnique({
      where: { reference: payment.reference },
    });
    return this.view(row!);
  }

  /** Withdraw a pending request so a different plan can be chosen. */
  async cancel(tenantId: string) {
    const pending = await this.livePending(tenantId);
    if (!pending) {
      throw new NotFoundException('No plan change is awaiting payment.');
    }
    await this.prisma.planPayment.update({
      where: { id: pending.id },
      data: { status: 'REJECTED', rejectedReason: 'Cancelled by the customer' },
    });
    return { success: true as const };
  }

  private async view(row: {
    reference: string;
    plan: string;
    amount: { toString: () => string };
    currency: string;
    expiresAt: Date;
    qrPayload: string;
    status: string;
  }) {
    return {
      reference: row.reference,
      plan: row.plan,
      amount: row.amount.toString(),
      currency: row.currency,
      status: row.status,
      expiresAt: row.expiresAt,
      qrPayload: row.qrPayload,
      qrImage: await this.signupPayments.renderQr(row.qrPayload),
    };
  }
}
