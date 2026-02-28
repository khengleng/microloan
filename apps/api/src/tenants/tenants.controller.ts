import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tenants')
export class TenantsController {
    constructor(private readonly tenantsService: TenantsService) { }

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
    update(@Param('id') id: string, @Body() data: { name: string }) {
        return this.tenantsService.update(id, data);
    }

    @Roles('SUPERADMIN')
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.tenantsService.remove(id);
    }
}
