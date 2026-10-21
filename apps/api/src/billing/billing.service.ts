import { Injectable, BadRequestException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import Stripe from 'stripe';
import { PlanTierService } from '../plan-tiers/plan-tier.service';
import { webOrigin } from '../config/operational-config';

@Injectable()
export class BillingService {
    private readonly logger = new Logger(BillingService.name);

    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
        private planTiers: PlanTierService,
    ) { }

    /**
     * The Stripe client for the configured key. Every caller has already
     * refused the request when STRIPE_SECRET_KEY is unset, so no placeholder
     * key is ever used.
     */
    private get stripe(): Stripe {
        const key = process.env.STRIPE_SECRET_KEY?.trim();
        if (!key) throw new ServiceUnavailableException('Online billing is not configured.');
        return new Stripe(key, { apiVersion: '2024-12-18.acacia' as any });
    }

    async createSubscriptionCheckout(tenantId: string, actorId: string, plan: string) {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new ServiceUnavailableException('Online billing is not yet configured for this platform. Please contact your administrator.');
        }

        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new BadRequestException('Tenant not found');

        let customerId = tenant.stripeCustomerId;

        // If no customer exists, create one
        if (!customerId) {
            const customer = await this.stripe.customers.create({
                metadata: { tenantId },
                name: tenant.name,
            });
            customerId = customer.id;
            await this.prisma.tenant.update({
                where: { id: tenantId },
                data: { stripeCustomerId: customerId },
            });
        }

        // The plan key MUST be a tier that exists, because it is what gets
        // written to Tenant.plan and therefore what the quota guard resolves
        // ceilings from. Checkout once accepted "PRO" while quotas only knew
        // "PROFESSIONAL", and paying tenants silently ran on free-tier limits.
        // Checking against the tier table closes that off permanently — there
        // is no second list to drift from.
        const tier = await this.planTiers.byName(plan);
        if (!tier || !tier.requiresPayment) {
            throw new BadRequestException('Invalid plan selected');
        }

        const planPriceIds: Record<string, string | undefined> = {
            BASIC: process.env.STRIPE_PRICE_BASIC,
            PROFESSIONAL: process.env.STRIPE_PRICE_PROFESSIONAL || process.env.STRIPE_PRICE_PRO,
            ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE,
        };

        const priceId = planPriceIds[plan];
        if (!priceId) {
            throw new ServiceUnavailableException(
                `No Stripe price is configured for the ${plan} plan.`,
            );
        }

        const session = await this.stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            success_url: `${webOrigin()}/settings?billing_status=success`,
            cancel_url: `${webOrigin()}/settings?billing_status=cancelled`,
            metadata: { tenantId, plan, actorId },
        });

        await this.audit.logAction(tenantId, actorId, 'UPDATE', 'Tenant', tenantId, { event: 'SUBSCRIPTION_CHECKOUT_INITIATED', plan });

        return { url: session.url };
    }

    // Fix 4: Stripe Customer Portal — lets tenants manage/cancel their own subscription
    async createBillingPortal(tenantId: string, actorId: string) {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new ServiceUnavailableException('Online billing is not yet configured for this platform. Please contact your administrator.');
        }

        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new BadRequestException('Tenant not found');
        if (!tenant.stripeCustomerId) {
            throw new BadRequestException('No active subscription found. Please subscribe first.');
        }

        const session = await this.stripe.billingPortal.sessions.create({
            customer: tenant.stripeCustomerId,
            return_url: `${webOrigin()}/settings`,
        });

        await this.audit.logAction(tenantId, actorId, 'READ', 'Tenant', tenantId, { event: 'BILLING_PORTAL_ACCESSED' });

        return { url: session.url };
    }

}
