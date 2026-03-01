import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
export declare class BillingService {
    private prisma;
    private audit;
    private stripe;
    private readonly logger;
    constructor(prisma: PrismaService, audit: AuditService);
    createSubscriptionCheckout(tenantId: string, actorId: string, plan: string): Promise<{
        url: string | null;
    }>;
    handleStripeWebhook(signature: string, payload: Buffer): Promise<void>;
    private handleCheckoutSessionCompleted;
    private handleSubscriptionDeleted;
    private handlePaymentFailed;
}
