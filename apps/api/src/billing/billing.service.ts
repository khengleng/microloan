import { Injectable, BadRequestException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import Stripe from 'stripe';

@Injectable()
export class BillingService {
    private stripe: Stripe;
    private readonly logger = new Logger(BillingService.name);

    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
    ) {
        this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'dummy_key', {
            apiVersion: '2024-12-18.acacia' as any,
        });
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

        const planPriceIds: Record<string, string> = {
            'PRO': process.env.STRIPE_PRICE_PRO || 'price_1234',
            'ENTERPRISE': process.env.STRIPE_PRICE_ENTERPRISE || 'price_5678',
        };

        const priceId = planPriceIds[plan];
        if (!priceId) throw new BadRequestException('Invalid plan selected');

        const session = await this.stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            success_url: `${process.env.WEB_URL || 'http://localhost:3000'}/settings?billing_status=success`,
            cancel_url: `${process.env.WEB_URL || 'http://localhost:3000'}/settings?billing_status=cancelled`,
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
            return_url: `${process.env.WEB_URL || 'http://localhost:3000'}/settings`,
        });

        await this.audit.logAction(tenantId, actorId, 'READ', 'Tenant', tenantId, { event: 'BILLING_PORTAL_ACCESSED' });

        return { url: session.url };
    }

    async handleStripeWebhook(signature: string, payload: Buffer) {
        if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
            this.logger.warn('Stripe Webhook hit without env variables configured');
            return;
        }

        let event: Stripe.Event;
        try {
            event = this.stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
        } catch (err: any) {
            this.logger.error(`Webhook signature verification failed: ${err.message}`);
            throw new BadRequestException('Invalid signature');
        }

        switch (event.type) {
            case 'checkout.session.completed':
                await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            case 'customer.subscription.deleted':
                await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;
            case 'invoice.payment_failed':
                await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
                break;
            default:
                this.logger.log(`Unhandled event type ${event.type}`);
        }
    }

    private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
        if (session.payment_status === 'paid' && session.metadata?.tenantId) {
            await this.prisma.tenant.update({
                where: { id: session.metadata.tenantId },
                data: {
                    plan: session.metadata.plan || 'PRO',
                    stripeSubscriptionId: session.subscription as string,
                    status: 'ACTIVE', // Ensure they are active if they were suspended
                },
            });
            await this.audit.logAction(session.metadata.tenantId, session.metadata.actorId || 'webhook', 'UPDATE', 'Tenant', session.metadata.tenantId, { event: 'SUBSCRIPTION_ACTIVATED', plan: session.metadata.plan });
        }
    }

    private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
        const tenant = await this.prisma.tenant.findFirst({ where: { stripeSubscriptionId: subscription.id } });
        if (tenant) {
            await this.prisma.tenant.update({
                where: { id: tenant.id },
                data: { plan: 'FREE', stripeSubscriptionId: null },
            });
            await this.audit.logAction(tenant.id, 'webhook', 'UPDATE', 'Tenant', tenant.id, { event: 'SUBSCRIPTION_CANCELED' });
        }
    }

    private async handlePaymentFailed(invoice: Stripe.Invoice) {
        const tenant = await this.prisma.tenant.findFirst({ where: { stripeCustomerId: invoice.customer as string } });
        if (tenant) {
            await this.prisma.tenant.update({
                where: { id: tenant.id },
                data: { status: 'SUSPENDED' },
            });
            await this.audit.logAction(tenant.id, 'webhook', 'UPDATE', 'Tenant', tenant.id, { event: 'SUBSCRIPTION_PAYMENT_FAILED_SUSPENDED' });
        }
    }
}
