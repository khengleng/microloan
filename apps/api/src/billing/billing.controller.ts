import { Controller, Post, Get, Delete, Body, Req, Headers, Res, BadRequestException } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { BillingService } from './billing.service';
import { PlanChangeService } from './plan-change.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth-scope.decorator';
export class RequestPlanChangeDto {
    /** Tier name, checked against the live catalogue by the service. */
    @IsNotEmpty()
    @IsString()
    @MaxLength(32)
    plan: string;
}

@Controller('billing')
export class BillingController {
    constructor(
        private readonly billingService: BillingService,
        private readonly planChange: PlanChangeService,
    ) { }

    /**
     * Plan changes for an existing workspace, paid by KHQR.
     *
     * Separate from the Stripe routes below: Stripe is unconfigured on this
     * deployment, which is why the settings screen said "online billing coming
     * soon" while the KHQR gate worked perfectly well at signup.
     */
    @Roles('TENANT_ADMIN')
    @Get('plan-change')
    async planChangeOptions(@CurrentUser() user: JwtPayload) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        return this.planChange.options(user.tenantId);
    }

    @Roles('TENANT_ADMIN')
    @Post('plan-change')
    async requestPlanChange(@CurrentUser() user: JwtPayload, @Body() dto: RequestPlanChangeDto) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        return this.planChange.request(user.tenantId, dto.plan);
    }

    @Roles('TENANT_ADMIN')
    @Delete('plan-change')
    async cancelPlanChange(@CurrentUser() user: JwtPayload) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        return this.planChange.cancel(user.tenantId);
    }

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
