import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RiskService } from './risk.service';
import { RestructureDto } from './dto/restructure.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

@Controller('risk')
export class RiskController {
  constructor(private readonly service: RiskService) {}

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN', 'CREDIT_OFFICER', 'BRANCH_MANAGER', 'APPROVER', 'LOAN_OFFICER', 'OPERATOR')
  @RequirePermissions(Permission.LOAN_APPLICATION_REVIEW)
  @Post('loan/:loanId/score')
  score(@CurrentUser() user: JwtPayload, @Param('loanId') loanId: string) {
    return this.service.score(user, loanId);
  }

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN', 'CREDIT_OFFICER', 'BRANCH_MANAGER', 'APPROVER', 'LOAN_OFFICER', 'OPERATOR', 'ACCOUNTANT', 'AUDITOR', 'CX', 'FINANCE', 'CUSTOMER_SUPPORT')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('loan/:loanId/scores')
  scores(@CurrentUser() user: JwtPayload, @Param('loanId') loanId: string) {
    return this.service.scores(user, loanId);
  }

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN', 'APPROVER', 'BRANCH_MANAGER')
  @RequirePermissions(Permission.LOAN_APPROVE)
  @Post('loan/:loanId/restructure')
  restructure(
    @CurrentUser() user: JwtPayload,
    @Param('loanId') loanId: string,
    @Body() dto: RestructureDto,
  ) {
    return this.service.restructure(user, loanId, dto);
  }
}
