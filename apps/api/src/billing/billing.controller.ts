import { Controller, Post, Get, Delete, Body, Req, Headers, BadRequestException, HttpCode, Param, Query, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { BillingService } from './billing.service';
import { PlanChangeService } from './plan-change.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Public } from '../auth/auth-scope.decorator';
import { PlatformGuard } from '../auth/platform.guard';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';
import { PlanQuotaService } from '../plan-tiers/plan-quota.service';
import { StripeWebhookService } from './stripe-webhook.service';
import type { RawBodyRequest } from './raw-body';
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
        private readonly webhooks: StripeWebhookService,
        private readonly quotas: PlanQuotaService,
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

    /**
     * The tenant's use of its plan's quotas (D-167), for the usage meter on
     * the subscription screen.
     */
    @Roles('TENANT_ADMIN')
    @Get('usage')
    async usage(@CurrentUser() user: JwtPayload) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        return this.quotas.usage(user.tenantId);
    }

    // Authenticated by Stripe signature verification over the raw body
    // (req.rawBody, kept for this route only — raw-body.ts), not by a JWT:
    // there is no user principal on a webhook (D-166).
    @Public()
    @Post('webhook')
    @HttpCode(200)
    async stripeWebhook(@Headers('stripe-signature') signature: string | undefined, @Req() req: RawBodyRequest) {
        const result = await this.webhooks.handle(signature, req.rawBody);
        return result
            ? { received: true, duplicate: result.duplicate, outcome: result.outcome }
            : { received: true };
    }
}

/**
 * The platform operator's view of Stripe deliveries the platform did not
 * apply on its own (a payment for a suspended or erasure-pending
 * organisation, an unknown plan or customer). Each stays an operational
 * alert until marked reviewed.
 */
@UseGuards(PlatformGuard)
@Controller('billing/webhook-events')
export class BillingWebhookReviewController {
    constructor(private readonly webhooks: StripeWebhookService) { }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_VIEW)
    @Get()
    list(@Query('all') all?: string, @Query('outcome') outcome?: string) {
        return this.webhooks.list({ all: all === 'true', outcome });
    }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_UPDATE)
    @Post(':eventId/review')
    @HttpCode(200)
    review(@CurrentUser() user: JwtPayload, @Param('eventId') eventId: string) {
        return this.webhooks.markReviewed(eventId, user.sub);
    }
}
