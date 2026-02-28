import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { RepaymentsService } from './repayments.service';
import { PostRepaymentDto } from './dto/post-repayment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('repayments')
export class RepaymentsController {
  constructor(private readonly repaymentsService: RepaymentsService) { }

  @Roles('ADMIN', 'OPS')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: PostRepaymentDto) {
    return this.repaymentsService.postRepayment(user.tenantId, user.sub, dto);
  }

  @Roles('ADMIN', 'OPS', 'AUDITOR')
  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('loanId') loanId?: string) {
    return this.repaymentsService.findAll(user.tenantId, loanId);
  }
}
