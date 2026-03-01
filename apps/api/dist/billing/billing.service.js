"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var BillingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const stripe_1 = __importDefault(require("stripe"));
let BillingService = BillingService_1 = class BillingService {
    prisma;
    audit;
    stripe;
    logger = new common_1.Logger(BillingService_1.name);
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
        this.stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY || 'dummy_key', {
            apiVersion: '2024-12-18.acacia',
        });
    }
    async createSubscriptionCheckout(tenantId, actorId, plan) {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new common_1.BadRequestException('Stripe is not fully configured on this server.');
        }
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant)
            throw new common_1.BadRequestException('Tenant not found');
        let customerId = tenant.stripeCustomerId;
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
        const planPriceIds = {
            'PRO': process.env.STRIPE_PRICE_PRO || 'price_1234',
            'ENTERPRISE': process.env.STRIPE_PRICE_ENTERPRISE || 'price_5678',
        };
        const priceId = planPriceIds[plan];
        if (!priceId)
            throw new common_1.BadRequestException('Invalid plan selected');
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
    async handleStripeWebhook(signature, payload) {
        if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
            this.logger.warn('Stripe Webhook hit without env variables configured');
            return;
        }
        let event;
        try {
            event = this.stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
        }
        catch (err) {
            this.logger.error(`Webhook signature verification failed: ${err.message}`);
            throw new common_1.BadRequestException('Invalid signature');
        }
        switch (event.type) {
            case 'checkout.session.completed':
                await this.handleCheckoutSessionCompleted(event.data.object);
                break;
            case 'customer.subscription.deleted':
                await this.handleSubscriptionDeleted(event.data.object);
                break;
            case 'invoice.payment_failed':
                await this.handlePaymentFailed(event.data.object);
                break;
            default:
                this.logger.log(`Unhandled event type ${event.type}`);
        }
    }
    async handleCheckoutSessionCompleted(session) {
        if (session.payment_status === 'paid' && session.metadata?.tenantId) {
            await this.prisma.tenant.update({
                where: { id: session.metadata.tenantId },
                data: {
                    plan: session.metadata.plan || 'PRO',
                    stripeSubscriptionId: session.subscription,
                    status: 'ACTIVE',
                },
            });
            await this.audit.logAction(session.metadata.tenantId, session.metadata.actorId || 'webhook', 'UPDATE', 'Tenant', session.metadata.tenantId, { event: 'SUBSCRIPTION_ACTIVATED', plan: session.metadata.plan });
        }
    }
    async handleSubscriptionDeleted(subscription) {
        const tenant = await this.prisma.tenant.findFirst({ where: { stripeSubscriptionId: subscription.id } });
        if (tenant) {
            await this.prisma.tenant.update({
                where: { id: tenant.id },
                data: { plan: 'FREE', stripeSubscriptionId: null },
            });
            await this.audit.logAction(tenant.id, 'webhook', 'UPDATE', 'Tenant', tenant.id, { event: 'SUBSCRIPTION_CANCELED' });
        }
    }
    async handlePaymentFailed(invoice) {
        const tenant = await this.prisma.tenant.findFirst({ where: { stripeCustomerId: invoice.customer } });
        if (tenant) {
            await this.prisma.tenant.update({
                where: { id: tenant.id },
                data: { status: 'SUSPENDED' },
            });
            await this.audit.logAction(tenant.id, 'webhook', 'UPDATE', 'Tenant', tenant.id, { event: 'SUBSCRIPTION_PAYMENT_FAILED_SUSPENDED' });
        }
    }
};
exports.BillingService = BillingService;
exports.BillingService = BillingService = BillingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], BillingService);
//# sourceMappingURL=billing.service.js.map