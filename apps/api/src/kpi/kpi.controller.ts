import { Controller, Get, UseGuards } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PermissionGuard } from '../authz/permission.guard';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
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
