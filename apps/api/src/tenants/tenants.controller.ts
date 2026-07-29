import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, BadRequestException, Query } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

import { PlatformGuard } from '../auth/platform.guard';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

/**
 * Platform-owner surface. Every route is SUPERADMIN-only, enforced in three
 * independent places: PlatformGuard (role + tenantId === null), the
 * TENANT_* permissions (held by no other role), and `assertPlatformOnly` in
 * the service. No tenant principal can reach any of this.
 */
@UseGuards(PlatformGuard)
@Controller('tenants')
export class TenantsController {
    constructor(private readonly tenantsService: TenantsService) { }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_VIEW)
    @Get('stats/platform')
    platformStats(@CurrentUser() user: JwtPayload) {
        return this.tenantsService.platformStats(user);
    }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_VIEW)
    @Get()
    findAll(@CurrentUser() user: JwtPayload, @Query('archived') archived?: string) {
        return this.tenantsService.findAll(user, archived === 'true');
    }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_VIEW)
    @Get(':id')
    findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        return this.tenantsService.findOne(user, id);
    }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_CREATE)
    @Post()
    create(@CurrentUser() user: JwtPayload, @Body() data: { name: string; adminEmail?: string; adminPassword?: string }) {
        return this.tenantsService.create(user, data);
    }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_UPDATE)
    @Put(':id')
    update(
        @Param('id') id: string,
        @CurrentUser() user: JwtPayload,
        // Fix 5: allow penaltyRatePerDay to be configured per-tenant via superadmin panel
        @Body() data: { name?: string; plan?: string; status?: string; penaltyRatePerDay?: number },
    ) {
        if (id === user.tenantId) {
            throw new BadRequestException('Cannot modify the platform organization.');
        }
        return this.tenantsService.update(user, id, data);
    }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_SUSPEND)
    @Put(':id/suspend')
    suspend(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
        if (id === user.tenantId) {
            throw new BadRequestException('Cannot suspend the platform organization.');
        }
        return this.tenantsService.setStatus(user, id, 'SUSPENDED');
    }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_SUSPEND)
    @Put(':id/activate')
    activate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
        return this.tenantsService.setStatus(user, id, 'ACTIVE');
    }

    // Fix 9 – Phase 1: Request erasure (suspends + marks deletedAt for 30-day retention)
    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_SUSPEND)
    @Delete(':id')
    remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
        if (id === user.tenantId) {
            throw new BadRequestException('Cannot remove the platform organization.');
        }
        return this.tenantsService.remove(user, id);
    }

    // Fix 9 – Phase 2: Irreversible GDPR hard-delete + PII anonymization
    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_SUSPEND)
    @Delete(':id/hard')
    hardDelete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
        if (id === user.tenantId) {
            throw new BadRequestException('Cannot delete the platform organization.');
        }
        return this.tenantsService.hardDelete(user, id);
    }

    // ── Signup payment gate (self-serve workspace activation) ──────────────
    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_VIEW)
    @Get('plan-payments/list')
    planPayments(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
        return this.tenantsService.listPlanPayments(user, status || 'PENDING');
    }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_UPDATE)
    @Put('plan-payments/:paymentId/confirm')
    confirmPlanPayment(@CurrentUser() user: JwtPayload, @Param('paymentId') paymentId: string) {
        return this.tenantsService.confirmPlanPayment(user, paymentId);
    }

    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_UPDATE)
    @Put('plan-payments/:paymentId/reject')
    rejectPlanPayment(
        @CurrentUser() user: JwtPayload,
        @Param('paymentId') paymentId: string,
        @Body() body: { reason?: string },
    ) {
        return this.tenantsService.rejectPlanPayment(user, paymentId, body?.reason || '');
    }

    // Platform user management
    @Roles('SUPERADMIN')
    @RequirePermissions(Permission.TENANT_VIEW)
    @Get(':id/users')
    tenantUsers(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        return this.tenantsService.getTenantUsers(user, id);
    }
}
