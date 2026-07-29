import { Controller, Get } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

@Controller('kpi')
export class KpiController {
  constructor(private readonly service: KpiService) {}

  @Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN', 'ACCOUNTANT', 'FINANCE', 'AUDITOR', 'BRANCH_MANAGER')
  @RequirePermissions(Permission.LEDGER_VIEW)
  @Get('overview')
  overview(@CurrentUser() user: JwtPayload) {
    return this.service.overview(user);
  }
}
