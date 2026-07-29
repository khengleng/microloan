import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { KycReviewService } from './kyc-review.service';
import { KycReviewDto } from './dto/kyc-review.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

@Controller('kyc')
export class KycReviewController {
  constructor(private readonly service: KycReviewService) {}

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN', 'CREDIT_OFFICER', 'BRANCH_MANAGER', 'CUSTOMER_SUPPORT', 'LOAN_OFFICER', 'CX', 'OPERATOR')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get(':borrowerId/documents')
  list(@CurrentUser() user: JwtPayload, @Param('borrowerId') borrowerId: string) {
    return this.service.listDocuments(user, borrowerId);
  }

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN', 'CREDIT_OFFICER', 'BRANCH_MANAGER', 'CUSTOMER_SUPPORT', 'CX')
  @RequirePermissions(Permission.CUSTOMER_UPDATE)
  @Post(':borrowerId/verify')
  verify(
    @CurrentUser() user: JwtPayload,
    @Param('borrowerId') borrowerId: string,
    @Body() dto: KycReviewDto,
  ) {
    return this.service.setStatus(user, borrowerId, dto);
  }
}
