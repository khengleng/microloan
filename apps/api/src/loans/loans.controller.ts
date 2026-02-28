import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { LoansService } from './loans.service';
import { CreateLoanDto, ChangeLoanStatusDto } from './dto/create-loan.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) { }

  @Roles('ADMIN', 'OPERATOR', 'SALES')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLoanDto) {
    return this.loansService.create(user.tenantId, user.sub, dto);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES', 'CX')
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.loansService.findAll(user.tenantId);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES', 'CX')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.loansService.findOne(user.tenantId, id);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE')
  @Put(':id/status')
  changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ChangeLoanStatusDto,
  ) {
    return this.loansService.changeStatus(user.tenantId, user.sub, id, dto);
  }

  @Roles('ADMIN', 'OPERATOR')
  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.loansService.remove(user.tenantId, user.sub, id);
  }

  @Roles('ADMIN', 'OPERATOR', 'SALES')
  @Post(':id/documents')
  addDocument(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: { name: string; content: string; type: string },
  ) {
    return this.loansService.addDocument(user.tenantId, user.sub, id, dto);
  }

  @Roles('ADMIN', 'OPERATOR')
  @Delete(':id/documents/:documentId')
  removeDocument(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.loansService.removeDocument(user.tenantId, user.sub, id, documentId);
  }
}
