import { BillingService } from './billing.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Request, Response } from 'express';
export declare class BillingController {
    private readonly billingService;
    constructor(billingService: BillingService);
    createCheckout(user: JwtPayload, body: {
        plan: string;
    }): Promise<{
        url: string | null;
    }>;
    stripeWebhook(signature: string, req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
}
