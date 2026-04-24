import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { LoansService } from './loans.service';
import { CreateLoanDto, ChangeLoanStatusDto, CreateInteractionDto } from './dto/create-loan.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { QuotaGuard, CheckQuota } from '../common/quota.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PermissionGuard } from '../authz/permission.guard';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, QuotaGuard)
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) { }

  @Roles('ADMIN', 'OPERATOR', 'SALES')
  @CheckQuota('loans')
  @RequirePermissions(Permission.LOAN_APPLICATION_CREATE)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLoanDto) {
    return this.loansService.create(user, dto);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES', 'CX')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loansService.findAll(
      user,
      search,
      status,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('overdue')
  findOverdue(@CurrentUser() user: JwtPayload) {
    return this.loansService.findOverdue(user);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES', 'CX')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.loansService.findOne(user, id);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES')
  @RequirePermissions(Permission.LOAN_APPLICATION_REVIEW)
  @Put(':id/status')
  changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ChangeLoanStatusDto,
  ) {
    return this.loansService.changeStatus(user, id, dto);
  }

  @Roles('ADMIN', 'OPERATOR')
  @RequirePermissions(Permission.USER_DELETE)
  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.loansService.remove(user, id);
  }

  @Roles('ADMIN', 'OPERATOR', 'SALES')
  @RequirePermissions(Permission.DOCUMENT_UPLOAD)
  @Post(':id/documents')
  addDocument(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: { name: string; content: string; type: string },
  ) {
    return this.loansService.addDocument(user, id, dto);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES')
  @RequirePermissions(Permission.CUSTOMER_UPDATE)
  @Post(':id/interactions')
  addInteraction(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateInteractionDto,
  ) {
    return this.loansService.addInteraction(user, id, dto.notes, dto.title, dto.type);
  }

  @Roles('ADMIN', 'OPERATOR')
  @RequirePermissions(Permission.DOCUMENT_DELETE)
  @Delete(':id/documents/:documentId')
  removeDocument(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.loansService.removeDocument(user, id, documentId);
  }
}
