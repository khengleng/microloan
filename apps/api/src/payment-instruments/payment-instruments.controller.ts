import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  } from '@nestjs/common';
import { PaymentInstrumentsService } from './payment-instruments.service';
import {
  CreatePaymentInstrumentDto,
  UpdatePaymentInstrumentDto,
} from './dto/payment-instrument.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

@Controller('payment-instruments')
export class PaymentInstrumentsController {
  constructor(private readonly service: PaymentInstrumentsService) {}

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN', 'ACCOUNTANT', 'FINANCE', 'BRANCH_MANAGER', 'CUSTOMER_SUPPORT', 'CX')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'CX', 'TENANT_ADMIN', 'ACCOUNTANT', 'LOAN_OFFICER', 'BRANCH_MANAGER', 'CUSTOMER_SUPPORT')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('for-loan/:loanId')
  forLoan(@CurrentUser() user: JwtPayload, @Param('loanId') loanId: string) {
    return this.service.resolveForLoan(user, loanId);
  }

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN')
  @RequirePermissions(Permission.CONFIG_UPDATE)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePaymentInstrumentDto) {
    return this.service.create(user, dto);
  }

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN')
  @RequirePermissions(Permission.CONFIG_UPDATE)
  @Put(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentInstrumentDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN')
  @RequirePermissions(Permission.CONFIG_UPDATE)
  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
