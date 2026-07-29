import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlanTierService } from './plan-tier.service';
import {
  CreatePlanTierDto,
  ReorderPlanTiersDto,
  UpdatePlanTierDto,
} from './dto/plan-tier.dto';
import { PlatformGuard } from '../auth/platform.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

/**
 * Subscription tier management, for the platform owner only.
 *
 * Same three controls as the other platform surfaces: `PlatformGuard` (role is
 * SUPERADMIN *and* tenantId is null), a TENANT_* permission no tenant role
 * holds, and the global guard chain. The Prisma guard is the backstop — it
 * treats PlanTier as a platform catalogue, so a tenant principal can read the
 * tiers but any write from one is refused at the ORM even if a route were
 * mis-guarded.
 *
 * The public, unauthenticated catalogue lives on `GET /auth/plans` instead;
 * a prospective customer needs the prices before they have an account.
 */
@UseGuards(PlatformGuard)
@Controller('platform/plan-tiers')
export class PlanTierController {
  constructor(private readonly service: PlanTierService) {}

  /** All tiers, retired included, with how many organizations are on each. */
  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_VIEW)
  @Get()
  list() {
    return this.service.listWithUsage();
  }

  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Post()
  create(@Body() dto: CreatePlanTierDto) {
    return this.service.create(dto);
  }

  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Patch('reorder')
  reorder(@Body() dto: ReorderPlanTiersDto) {
    return this.service.reorder(dto);
  }

  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanTierDto,
  ) {
    return this.service.update(id, dto);
  }

  /**
   * Retire: removed from signup, still honoured for existing organizations.
   * The safe operation, and the one the UI offers first.
   */
  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Patch(':id/retire')
  retire(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.retire(id);
  }

  /** Hard delete. Refused by the service while any organization is on it. */
  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
