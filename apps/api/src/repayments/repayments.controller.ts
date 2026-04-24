import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { RepaymentsService } from './repayments.service';
import { PostRepaymentDto } from './dto/post-repayment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PermissionGuard } from '../authz/permission.guard';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('repayments')
export class RepaymentsController {
  constructor(private readonly repaymentsService: RepaymentsService) { }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE')
  @RequirePermissions(Permission.LOAN_REPAYMENT_POST)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: PostRepaymentDto) {
    return this.repaymentsService.postRepayment(user, dto);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'CX')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('loanId') loanId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.repaymentsService.findAll(
      user,
      loanId,
      startDate,
      endDate,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }
}
