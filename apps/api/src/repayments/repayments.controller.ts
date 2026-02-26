import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { RepaymentsService } from './repayments.service';
import { PostRepaymentDto } from './dto/post-repayment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard)
@Controller('repayments')
export class RepaymentsController {
  constructor(private readonly repaymentsService: RepaymentsService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: PostRepaymentDto) {
    return this.repaymentsService.postRepayment(user.tenantId, user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('loanId') loanId?: string) {
    return this.repaymentsService.findAll(user.tenantId, loanId);
  }
}
