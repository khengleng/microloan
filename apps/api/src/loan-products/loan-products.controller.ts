import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { LoanProductsService } from './loan-products.service';
import { CreateLoanProductDto } from './dto/create-loan-product.dto';
import { UpdateLoanProductDto } from './dto/update-loan-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { BadRequestException } from '@nestjs/common';
import { PermissionGuard } from '../authz/permission.guard';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

// Loan products are tenant configuration: reads require CUSTOMER_VIEW, writes
// require CONFIG_UPDATE (TENANT_ADMIN). Enforced by PermissionGuard so access
// can't be granted by the coarse legacy role names alone.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('loan-products')
export class LoanProductsController {
    constructor(private readonly loanProductsService: LoanProductsService) { }

    @Roles('TENANT_ADMIN', 'ADMIN')
    @RequirePermissions(Permission.CONFIG_UPDATE)
    @Post()
    create(@CurrentUser() user: JwtPayload, @Body() createLoanProductDto: CreateLoanProductDto) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        return this.loanProductsService.create(user.tenantId, createLoanProductDto);
    }

    @RequirePermissions(Permission.CUSTOMER_VIEW)
    @Get()
    findAll(@CurrentUser() user: JwtPayload) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        return this.loanProductsService.findAll(user.tenantId);
    }

    @RequirePermissions(Permission.CUSTOMER_VIEW)
    @Get(':id')
    findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        return this.loanProductsService.findOne(user.tenantId, id);
    }

    @Roles('TENANT_ADMIN', 'ADMIN')
    @RequirePermissions(Permission.CONFIG_UPDATE)
    @Put(':id')
    update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() updateLoanProductDto: UpdateLoanProductDto) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        return this.loanProductsService.update(user.tenantId, id, updateLoanProductDto);
    }

    @Roles('TENANT_ADMIN', 'ADMIN')
    @RequirePermissions(Permission.CONFIG_UPDATE)
    @Delete(':id')
    remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        return this.loanProductsService.remove(user.tenantId, id);
    }
}
