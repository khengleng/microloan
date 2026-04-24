import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, BadRequestException, Query } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

import { PlatformGuard } from '../auth/platform.guard';
import { PermissionGuard } from '../authz/permission.guard';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

@UseGuards(JwtAuthGuard, RolesGuard, PlatformGuard, PermissionGuard)
@Controller('tenants')
export class TenantsController {
    constructor(private readonly tenantsService: TenantsService) { }

    @Roles('SUPERADMIN', 'ADMIN', 'FINANCE', 'SALES')
    @RequirePermissions(Permission.TENANT_UPDATE)
    @Get('stats/platform')
    platformStats(@CurrentUser() user: JwtPayload) {
        return this.tenantsService.platformStats(user);
    }

    @Roles('SUPERADMIN', 'ADMIN', 'FINANCE', 'SALES', 'CX')
    @RequirePermissions(Permission.TENANT_UPDATE)
    @Get()
    findAll(@CurrentUser() user: JwtPayload, @Query('archived') archived?: string) {
        return this.tenantsService.findAll(user, archived === 'true');
    }

    @Roles('SUPERADMIN', 'ADMIN', 'FINANCE', 'SALES', 'CX')
    @RequirePermissions(Permission.TENANT_UPDATE)
    @Get(':id')
    findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        return this.tenantsService.findOne(user, id);
    }

    @Roles('SUPERADMIN', 'ADMIN', 'SALES')
    @RequirePermissions(Permission.TENANT_CREATE)
    @Post()
    create(@CurrentUser() user: JwtPayload, @Body() data: { name: string; adminEmail?: string; adminPassword?: string }) {
        return this.tenantsService.create(user, data);
    }

    @Roles('SUPERADMIN', 'ADMIN')
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

    @Roles('SUPERADMIN', 'ADMIN')
    @RequirePermissions(Permission.TENANT_SUSPEND)
    @Put(':id/suspend')
    suspend(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
        if (id === user.tenantId) {
            throw new BadRequestException('Cannot suspend the platform organization.');
        }
        return this.tenantsService.setStatus(user, id, 'SUSPENDED');
    }

    @Roles('SUPERADMIN', 'ADMIN')
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

    // Platform user management
    @Roles('SUPERADMIN', 'ADMIN', 'FINANCE', 'SALES', 'CX')
    @RequirePermissions(Permission.USER_UPDATE)
    @Get(':id/users')
    tenantUsers(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        return this.tenantsService.getTenantUsers(user, id);
    }
}
