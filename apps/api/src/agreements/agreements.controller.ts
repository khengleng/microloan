import { Body, Controller, Get, Ip, Param, Post } from '@nestjs/common';
import { AgreementsService } from './agreements.service';
import { SignAgreementDto } from './dto/sign-agreement.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';

@Controller('agreements')
export class AgreementsController {
  constructor(
    private readonly service: AgreementsService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'CX', 'TENANT_ADMIN', 'ACCOUNTANT', 'LOAN_OFFICER', 'BRANCH_MANAGER', 'CUSTOMER_SUPPORT', 'CREDIT_OFFICER', 'APPROVER')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('loan/:loanId/key-facts')
  keyFacts(@CurrentUser() user: JwtPayload, @Param('loanId') loanId: string) {
    return this.service.keyFacts(this.authz.scopeWhere(user as any, { id: loanId }));
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'CX', 'TENANT_ADMIN', 'LOAN_OFFICER', 'BRANCH_MANAGER', 'CREDIT_OFFICER')
  @RequirePermissions(Permission.CUSTOMER_UPDATE)
  @Post('loan/:loanId/sign')
  async sign(
    @CurrentUser() user: JwtPayload,
    @Param('loanId') loanId: string,
    @Body() dto: SignAgreementDto,
    @Ip() ip: string,
  ) {
    const agreement = await this.service.sign({
      where: this.authz.scopeWhere(user as any, { id: loanId }),
      tenantId: user.tenantId as string,
      signerRole: 'STAFF',
      signedByUserId: user.sub,
      signatureName: dto.signatureName,
      signatureImage: dto.signatureImage,
      ip,
    });
    await this.audit.logAction(
      user.tenantId as string,
      this.authz.actorId(user as any),
      'AGREEMENT_SIGN',
      'Loan',
      loanId,
      { version: agreement.version, hash: agreement.agreementHash, signer: 'STAFF' },
    );
    return agreement;
  }
}
