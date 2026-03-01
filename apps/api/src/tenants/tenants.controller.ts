import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tenants')
export class TenantsController {
    constructor(private readonly tenantsService: TenantsService) { }

    @Roles('SUPERADMIN')
    @Get('stats/platform')
    platformStats() {
        return this.tenantsService.platformStats();
    }

    @Roles('SUPERADMIN')
    @Get()
    findAll() {
        return this.tenantsService.findAll();
    }

    @Roles('SUPERADMIN')
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.tenantsService.findOne(id);
    }

    @Roles('SUPERADMIN')
    @Post()
    create(@Body() data: { name: string }) {
        return this.tenantsService.create(data);
    }

    @Roles('SUPERADMIN')
    @Put(':id')
    update(@Param('id') id: string, @Body() data: { name?: string; plan?: string; status?: string }) {
        return this.tenantsService.update(id, data);
    }

    @Roles('SUPERADMIN')
    @Put(':id/suspend')
    suspend(@Param('id') id: string) {
        return this.tenantsService.setStatus(id, 'SUSPENDED');
    }

    @Roles('SUPERADMIN')
    @Put(':id/activate')
    activate(@Param('id') id: string) {
        return this.tenantsService.setStatus(id, 'ACTIVE');
    }

    @Roles('SUPERADMIN')
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.tenantsService.remove(id);
    }

    // SUPERADMIN user management (for PaaS team)
    @Roles('SUPERADMIN')
    @Get(':id/users')
    tenantUsers(@Param('id') id: string) {
        return this.tenantsService.getTenantUsers(id);
    }
}
