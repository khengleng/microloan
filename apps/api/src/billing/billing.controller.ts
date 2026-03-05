import { Controller, Post, Body, Req, Headers, UseGuards, Res } from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Request, Response } from 'express';

@Controller('billing')
export class BillingController {
    constructor(private readonly billingService: BillingService) { }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN', 'SUPERADMIN')
    @Post('checkout')
    async createCheckout(@CurrentUser() user: JwtPayload, @Body() body: { plan: string }) {
        return this.billingService.createSubscriptionCheckout(user.tenantId, user.sub, body.plan);
    }

    // Fix 4: Stripe Customer Portal — manage / cancel subscription without contacting support
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN', 'SUPERADMIN')
    @Post('portal')
    async billingPortal(@CurrentUser() user: JwtPayload) {
        return this.billingService.createBillingPortal(user.tenantId, user.sub);
    }

    @Post('webhook')
    async stripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request, @Res() res: Response) {
        await this.billingService.handleStripeWebhook(signature, req.body);
        return res.status(200).send('Webhook received');
    }
}
