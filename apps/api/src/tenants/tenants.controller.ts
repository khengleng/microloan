import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

import { PlatformGuard } from '../auth/platform.guard';

@UseGuards(JwtAuthGuard, RolesGuard, PlatformGuard)
@Controller('tenants')
export class TenantsController {
    constructor(private readonly tenantsService: TenantsService) { }

    @Roles('SUPERADMIN', 'ADMIN', 'FINANCE', 'SALES')
    @Get('stats/platform')
    platformStats() {
        return this.tenantsService.platformStats();
    }

    @Roles('SUPERADMIN', 'ADMIN', 'FINANCE', 'SALES', 'CX')
    @Get()
    findAll() {
        return this.tenantsService.findAll();
    }

    @Roles('SUPERADMIN', 'ADMIN', 'FINANCE', 'SALES', 'CX')
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.tenantsService.findOne(id);
    }

    @Roles('SUPERADMIN', 'ADMIN', 'SALES')
    @Post()
    create(@CurrentUser() user: JwtPayload, @Body() data: { name: string; adminEmail?: string; adminPassword?: string }) {
        return this.tenantsService.create(data, user.sub);
    }

    @Roles('SUPERADMIN', 'ADMIN')
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
        return this.tenantsService.update(id, data, user.sub);
    }

    @Roles('SUPERADMIN', 'ADMIN')
    @Put(':id/suspend')
    suspend(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
        if (id === user.tenantId) {
            throw new BadRequestException('Cannot suspend the platform organization.');
        }
        return this.tenantsService.setStatus(id, 'SUSPENDED', user.sub);
    }

    @Roles('SUPERADMIN', 'ADMIN')
    @Put(':id/activate')
    activate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
        if (id === user.tenantId) {
            throw new BadRequestException('Cannot modify the platform organization.');
        }
        return this.tenantsService.setStatus(id, 'ACTIVE', user.sub);
    }

    // Fix 9 – Phase 1: Request erasure (suspends + marks deletedAt for 30-day retention)
    @Roles('SUPERADMIN')
    @Delete(':id')
    remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
        if (id === user.tenantId) {
            throw new BadRequestException('Cannot remove the platform organization.');
        }
        return this.tenantsService.remove(id, user.sub);
    }

    // Fix 9 – Phase 2: Irreversible GDPR hard-delete + PII anonymization
    @Roles('SUPERADMIN')
    @Delete(':id/hard')
    hardDelete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
        if (id === user.tenantId) {
            throw new BadRequestException('Cannot delete the platform organization.');
        }
        return this.tenantsService.hardDelete(id, user.sub);
    }

    // Platform user management
    @Roles('SUPERADMIN', 'ADMIN', 'FINANCE', 'SALES', 'CX')
    @Get(':id/users')
    tenantUsers(@Param('id') id: string) {
        return this.tenantsService.getTenantUsers(id);
    }
}
