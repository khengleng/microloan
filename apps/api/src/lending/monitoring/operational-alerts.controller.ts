import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformGuard } from '../../auth/platform.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePermissions } from '../../authz/require-permissions.decorator';
import { Permission } from '../../authz/permission.enum';
import { OperationalAlertService } from './operational-alerts.service';

/**
 * Every open operational alert — the platform's and each tenant's — for the
 * platform operator's home (D-150). Same controls as the other platform
 * surfaces: PlatformGuard (SUPERADMIN with no tenant), a TENANT_* permission
 * no tenant role holds, and the global guard chain. A tenant's own alerts
 * are GET /lending/ops/alerts.
 */
@UseGuards(PlatformGuard)
@Controller('platform/operational-alerts')
export class PlatformOperationalAlertsController {
  constructor(private readonly alerts: OperationalAlertService) {}

  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_VIEW)
  @Get()
  list() {
    return this.alerts.forPlatform();
  }
}
