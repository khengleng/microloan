import { Controller, Post, Body, Req, Headers, Res, BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth-scope.decorator';
@Controller('billing')
export class BillingController {
    constructor(private readonly billingService: BillingService) { }

    @Roles('ADMIN', 'SUPERADMIN')
    @Post('checkout')
    async createCheckout(@CurrentUser() user: JwtPayload, @Body() body: { plan: string }) {
        if (!user.tenantId) throw new BadRequestException('Tenant-scoped billing requires tenantId');
        return this.billingService.createSubscriptionCheckout(user.tenantId, user.sub, body.plan);
    }

    // Fix 4: Stripe Customer Portal — manage / cancel subscription without contacting support
    @Roles('ADMIN', 'SUPERADMIN')
    @Post('portal')
    async billingPortal(@CurrentUser() user: JwtPayload) {
        if (!user.tenantId) throw new BadRequestException('Tenant-scoped billing requires tenantId');
        return this.billingService.createBillingPortal(user.tenantId, user.sub);
    }

    // Authenticated by Stripe signature verification inside the service,
    // not by a JWT — there is no user principal on a webhook.
    @Public()
    @Post('webhook')
    async stripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request, @Res() res: Response) {
        await this.billingService.handleStripeWebhook(signature, req.body);
        return res.status(200).send('Webhook received');
    }
}
