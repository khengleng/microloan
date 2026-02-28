import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Request } from '@nestjs/common';
import { LoanProductsService } from './loan-products.service';
import { CreateLoanProductDto } from './dto/create-loan-product.dto';
import { UpdateLoanProductDto } from './dto/update-loan-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('loan-products')
export class LoanProductsController {
    constructor(private readonly loanProductsService: LoanProductsService) { }

    @Roles('ADMIN', 'OPS')
    @Post()
    create(@Request() req, @Body() createLoanProductDto: CreateLoanProductDto) {
        return this.loanProductsService.create(req.user.tenantId, createLoanProductDto);
    }

    @Get()
    findAll(@Request() req) {
        return this.loanProductsService.findAll(req.user.tenantId);
    }

    @Get(':id')
    findOne(@Request() req, @Param('id') id: string) {
        return this.loanProductsService.findOne(req.user.tenantId, id);
    }

    @Roles('ADMIN', 'OPS')
    @Put(':id')
    update(@Request() req, @Param('id') id: string, @Body() updateLoanProductDto: UpdateLoanProductDto) {
        return this.loanProductsService.update(req.user.tenantId, id, updateLoanProductDto);
    }

    @Roles('ADMIN', 'OPS')
    @Delete(':id')
    remove(@Request() req, @Param('id') id: string) {
        return this.loanProductsService.remove(req.user.tenantId, id);
    }
}
