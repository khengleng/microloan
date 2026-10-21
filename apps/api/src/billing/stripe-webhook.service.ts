import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../prisma/prisma.service';
import { runAsSystem } from '../prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { PlanTierService } from '../plan-tiers/plan-tier.service';

export type WebhookOutcome = 'PROCESSED' | 'IGNORED' | 'NEEDS_REVIEW';

export interface WebhookResult {
  eventId: string;
  type: string;
  outcome: WebhookOutcome;
  /** True when this event id was handled before: nothing was applied again. */
  duplicate: boolean;
  detail: string;
}

/** What one handler decided, and the audit entry to write once it is committed. */
interface Decision {
  outcome: WebhookOutcome;
  tenantRef: string | null;
  detail: string;
  audit?: { tenantId: string; event: string; data: Record<string, unknown> };
}

/** Tenant statuses a webhook may change a plan on without a person looking. */
const SELF_SERVE_STATUS = 'ACTIVE';

/**
 * Stripe subscription webhooks (DECISIONS D-166).
 *
 * - **Signature**: verified over the raw request body (`req.rawBody`, kept
 *   for this route only); the parsed JSON re-serialised is not the bytes
 *   Stripe signed, so every delivery used to fail with 400.
 * - **Idempotent**: each Stripe event id is recorded in StripeWebhookEvent in
 *   the same transaction as its effect. A redelivery finds the row and
 *   changes nothing; if applying fails, the row is rolled back with the
 *   effect, so Stripe's retry applies it once.
 * - **Never reactivates**: no webhook sets an organisation ACTIVE. A payment
 *   for a SUSPENDED, PENDING_PAYMENT or erasure-pending organisation, for an
 *   unknown organisation or plan, or from a Stripe customer that is not the
 *   organisation's, is recorded as NEEDS_REVIEW (an operational alert for
 *   the platform operator) and left for a person; the plan of a suspended
 *   organisation is still recorded, its status is not touched.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planTiers: PlanTierService,
  ) {}

  /**
   * Verify and parse a delivery. Uses the static verifier, so no API key is
   * needed to check a signature — only the endpoint's signing secret.
   */
  static verify(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    secret: string,
  ): Stripe.Event {
    if (!Buffer.isBuffer(rawBody) || !rawBody.length)
      throw new BadRequestException('Webhook body missing');
    if (!signature) throw new BadRequestException('Invalid signature');
    try {
      return Stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid signature');
    }
  }

  /** Handle one delivery. Returns null when webhooks are not configured. */
  async handle(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<WebhookResult | null> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      this.logger.warn('Stripe webhook received but STRIPE_WEBHOOK_SECRET is not set');
      return null;
    }
    let event: Stripe.Event;
    try {
      event = StripeWebhookService.verify(rawBody, signature, secret);
    } catch (e) {
      this.logger.warn(`Stripe webhook refused: ${(e as Error).message}`);
      throw e;
    }
    return this.apply(event);
  }

  /** Apply a verified event exactly once. */
  async apply(event: Stripe.Event): Promise<WebhookResult> {
    const result = await runAsSystem('webhook: Stripe subscription events', () =>
      this.prisma.$transaction(async (tx) => {
        // The claim: the first delivery of this id inserts the row; a
        // concurrent duplicate waits on the key and then finds it taken.
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "StripeWebhookEvent" ("id", "type", "livemode", "outcome", "receivedAt")
          VALUES (${event.id}, ${event.type}, ${Boolean(event.livemode)}, 'PROCESSED', ${new Date()})
          ON CONFLICT ("id") DO NOTHING
          RETURNING "id"`;
        if (!claimed.length) {
          const prior = await tx.stripeWebhookEvent.findUnique({
            where: { id: event.id },
          });
          return {
            duplicate: true,
            decision: {
              outcome: (prior?.outcome ?? 'PROCESSED') as WebhookOutcome,
              tenantRef: prior?.tenantRef ?? null,
              detail: prior?.detail ?? '',
            } satisfies Decision,
          };
        }
        const decision = await this.decide(tx, event);
        await tx.stripeWebhookEvent.update({
          where: { id: event.id },
          data: {
            outcome: decision.outcome,
            tenantRef: decision.tenantRef,
            detail: decision.detail.slice(0, 1000),
          },
        });
        return { duplicate: false, decision };
      }),
    );
    const { decision, duplicate } = result;
    if (!duplicate) {
      const entry = decision.audit;
      if (entry)
        await runAsSystem('webhook: Stripe subscription audit', () =>
          this.audit.logAction(entry.tenantId, null, 'UPDATE', 'Tenant', entry.tenantId, {
            event: entry.event,
            stripeEvent: event.id,
            ...entry.data,
          }),
        );
      if (decision.outcome === 'NEEDS_REVIEW')
        this.logger.error(
          `Stripe event ${event.id} (${event.type}) needs review: ${decision.detail}`,
        );
    }
    return {
      eventId: event.id,
      type: event.type,
      outcome: decision.outcome,
      duplicate,
      detail: decision.detail,
    };
  }

  private async decide(
    tx: Prisma.TransactionClient,
    event: Stripe.Event,
  ): Promise<Decision> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.checkoutCompleted(
          tx,
          event.data.object as Stripe.Checkout.Session,
        );
      case 'customer.subscription.deleted':
        return this.subscriptionDeleted(
          tx,
          event.data.object as Stripe.Subscription,
        );
      case 'invoice.payment_failed':
        return this.paymentFailed(tx, event.data.object as Stripe.Invoice);
      default:
        return {
          outcome: 'IGNORED',
          tenantRef: null,
          detail: `Event type ${event.type} is not used.`,
        };
    }
  }

  private static idOf(v: string | { id: string } | null | undefined) {
    if (!v) return null;
    return typeof v === 'string' ? v : v.id;
  }

  private async checkoutCompleted(
    tx: Prisma.TransactionClient,
    session: Stripe.Checkout.Session,
  ): Promise<Decision> {
    const tenantId = session.metadata?.tenantId ?? null;
    if (session.payment_status !== 'paid' || !tenantId)
      return {
        outcome: 'IGNORED',
        tenantRef: tenantId,
        detail: `Checkout not paid (${session.payment_status}) or not for an organisation.`,
      };
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        plan: true,
        stripeCustomerId: true,
      },
    });
    if (!tenant)
      return {
        outcome: 'NEEDS_REVIEW',
        tenantRef: tenantId,
        detail: 'Paid checkout for an organisation that does not exist (purged?). Refund or reconcile in Stripe.',
      };
    if (tenant.deletedAt)
      return {
        outcome: 'NEEDS_REVIEW',
        tenantRef: tenant.id,
        detail: 'Paid checkout for an organisation whose erasure is pending. Nothing was changed; refund or cancel the subscription in Stripe.',
      };
    const customer = StripeWebhookService.idOf(session.customer);
    if (!tenant.stripeCustomerId || customer !== tenant.stripeCustomerId)
      return {
        outcome: 'NEEDS_REVIEW',
        tenantRef: tenant.id,
        detail: `Paid checkout from Stripe customer ${customer ?? '(none)'}, which is not this organisation's customer. Nothing was changed.`,
      };
    const plan = session.metadata?.plan ?? '';
    const tier = plan ? await this.planTiers.byName(plan) : null;
    if (!tier)
      return {
        outcome: 'NEEDS_REVIEW',
        tenantRef: tenant.id,
        detail: `Paid checkout for plan "${plan}", which is not a tier in the catalogue. Nothing was changed.`,
      };
    const subscription = StripeWebhookService.idOf(session.subscription);
    // The plan and subscription are facts of the payment and are recorded;
    // the organisation's status is never changed here.
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { plan: tier.name, stripeSubscriptionId: subscription },
    });
    const audit = {
      tenantId: tenant.id,
      event: 'SUBSCRIPTION_ACTIVATED',
      data: { plan: tier.name, from: tenant.plan, status: tenant.status },
    };
    if (tenant.status !== SELF_SERVE_STATUS)
      return {
        outcome: 'NEEDS_REVIEW',
        tenantRef: tenant.id,
        detail: `Paid checkout for the ${tier.name} plan while the organisation is ${tenant.status}. The plan was recorded; the organisation was NOT reactivated — reactivate it by hand if appropriate.`,
        audit,
      };
    return {
      outcome: 'PROCESSED',
      tenantRef: tenant.id,
      detail: `Plan ${tenant.plan} → ${tier.name}.`,
      audit,
    };
  }

  private async subscriptionDeleted(
    tx: Prisma.TransactionClient,
    subscription: Stripe.Subscription,
  ): Promise<Decision> {
    const tenant = await tx.tenant.findFirst({
      where: { stripeSubscriptionId: subscription.id },
      select: { id: true, plan: true },
    });
    if (!tenant)
      return {
        outcome: 'IGNORED',
        tenantRef: null,
        detail: `No organisation holds subscription ${subscription.id}.`,
      };
    const fallback = await this.planTiers.defaultTier();
    if (!fallback)
      return {
        outcome: 'NEEDS_REVIEW',
        tenantRef: tenant.id,
        detail: 'Subscription cancelled but no default tier is on offer to move the organisation to.',
      };
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { plan: fallback.name, stripeSubscriptionId: null },
    });
    return {
      outcome: 'PROCESSED',
      tenantRef: tenant.id,
      detail: `Subscription cancelled: plan ${tenant.plan} → ${fallback.name}.`,
      audit: {
        tenantId: tenant.id,
        event: 'SUBSCRIPTION_CANCELED',
        data: { plan: fallback.name, from: tenant.plan },
      },
    };
  }

  private async paymentFailed(
    tx: Prisma.TransactionClient,
    invoice: Stripe.Invoice,
  ): Promise<Decision> {
    const customer = StripeWebhookService.idOf(invoice.customer);
    const tenant = customer
      ? await tx.tenant.findFirst({
          where: { stripeCustomerId: customer },
          select: { id: true, status: true },
        })
      : null;
    if (!tenant)
      return {
        outcome: 'IGNORED',
        tenantRef: null,
        detail: `No organisation is Stripe customer ${customer ?? '(none)'}.`,
      };
    // Suspension only ever moves an ACTIVE organisation down; anything else
    // is left as it is.
    const res = await tx.tenant.updateMany({
      where: { id: tenant.id, status: SELF_SERVE_STATUS },
      data: { status: 'SUSPENDED' },
    });
    if (!res.count)
      return {
        outcome: 'IGNORED',
        tenantRef: tenant.id,
        detail: `Payment failed; the organisation is already ${tenant.status}.`,
      };
    return {
      outcome: 'PROCESSED',
      tenantRef: tenant.id,
      detail: 'Payment failed: organisation suspended.',
      audit: {
        tenantId: tenant.id,
        event: 'SUBSCRIPTION_PAYMENT_FAILED_SUSPENDED',
        data: {},
      },
    };
  }

  // ── The operator's review ────────────────────────────────────────────────

  /** Webhook events, newest first; by default the ones waiting for review. */
  async list(q: { outcome?: string; all?: boolean }) {
    return runAsSystem('platform operator: Stripe webhook events', () =>
      this.prisma.stripeWebhookEvent.findMany({
        where: q.all
          ? q.outcome
            ? { outcome: q.outcome }
            : {}
          : { outcome: 'NEEDS_REVIEW', reviewedAt: null },
        orderBy: { receivedAt: 'desc' },
        take: 200,
      }),
    );
  }

  /** The operator has dealt with an event that needed review. */
  async markReviewed(id: string, operatorId: string) {
    return runAsSystem('platform operator: Stripe webhook review', async () => {
      const res = await this.prisma.stripeWebhookEvent.updateMany({
        where: { id, outcome: 'NEEDS_REVIEW', reviewedAt: null },
        data: { reviewedAt: new Date(), reviewedBy: operatorId },
      });
      if (res.count !== 1)
        throw new NotFoundException('No event waiting for review has that id.');
      await this.audit.logAction(null, operatorId, 'UPDATE', 'StripeWebhookEvent', id, {
        event: 'STRIPE_EVENT_REVIEWED',
      });
      return this.prisma.stripeWebhookEvent.findUnique({ where: { id } });
    });
  }

  /** Events waiting for review, for the operational alert monitor. */
  async pendingReview(): Promise<{ count: number; oldest: Date | null }> {
    return runAsSystem('operational alert monitor: Stripe events', async () => {
      const agg = await this.prisma.stripeWebhookEvent.aggregate({
        where: { outcome: 'NEEDS_REVIEW', reviewedAt: null },
        _count: { _all: true },
        _min: { receivedAt: true },
      });
      return { count: agg._count._all, oldest: agg._min.receivedAt ?? null };
    });
  }
}
