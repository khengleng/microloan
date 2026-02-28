import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { LoanProductsService } from './loan-products.service';
import type { CreateLoanProductDto } from './dto/create-loan-product.dto';
import type { UpdateLoanProductDto } from './dto/update-loan-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('loan-products')
export class LoanProductsController {
    constructor(private readonly loanProductsService: LoanProductsService) { }

    @Roles('ADMIN', 'OPERATOR')
    @Post()
    create(@CurrentUser() user: JwtPayload, @Body() createLoanProductDto: CreateLoanProductDto) {
        return this.loanProductsService.create(user.tenantId, createLoanProductDto);
    }

    @Get()
    findAll(@CurrentUser() user: JwtPayload) {
        return this.loanProductsService.findAll(user.tenantId);
    }

    @Get(':id')
    findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        return this.loanProductsService.findOne(user.tenantId, id);
    }

    @Roles('ADMIN', 'OPERATOR')
    @Put(':id')
    update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() updateLoanProductDto: UpdateLoanProductDto) {
        return this.loanProductsService.update(user.tenantId, id, updateLoanProductDto);
    }

    @Roles('ADMIN', 'OPERATOR')
    @Delete(':id')
    remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        return this.loanProductsService.remove(user.tenantId, id);
    }
}
