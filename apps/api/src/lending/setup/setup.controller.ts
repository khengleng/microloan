import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { PlatformGuard } from '../../auth/platform.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePermissions } from '../../authz/require-permissions.decorator';
import { Permission } from '../../authz/permission.enum';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { GoLiveSetupService } from './setup.service';

const actor = (req: Request) => lendingActorOf(req as never);

const notApplicable = z
  .object({ reason: z.string().trim().min(5).max(500) })
  .strict();

/** Item keys are content ids (setup-checks.ts), never row ids. */
const itemKey = (v: string) => (/^[a-z][a-z0-9_]{1,59}$/.test(v) ? v : '');

/**
 * The go-live setup checklist for a new lender (D-171…D-175): computed from
 * real data on every read; a tenant administrator may mark a waivable item
 * not applicable with a reason.
 */
@Controller('lending/setup')
export class GoLiveSetupController {
  constructor(private readonly setup: GoLiveSetupService) {}

  @LendingAction('tenant_setup.read')
  @Get('status')
  status(@Req() req: Request) {
    return this.setup.status(actor(req));
  }

  @LendingAction('tenant_setup.manage')
  @Put('items/:key/not-applicable')
  markNotApplicable(
    @Req() req: Request,
    @Param('key') key: string,
    @Body(new ZodPipe(notApplicable)) body: { reason: string },
  ) {
    return this.setup.markNotApplicable(actor(req), itemKey(key), body.reason);
  }

  @LendingAction('tenant_setup.manage')
  @Delete('items/:key/not-applicable')
  clearNotApplicable(@Req() req: Request, @Param('key') key: string) {
    return this.setup.clearNotApplicable(actor(req), itemKey(key));
  }
}

/**
 * Each organisation's go-live setup progress for the platform operator's
 * Organisations page — counts and open item keys only. Same controls as the
 * other platform surfaces: PlatformGuard, SUPERADMIN, TENANT_VIEW.
 */
@UseGuards(PlatformGuard)
@Controller('platform/setup-progress')
export class PlatformGoLiveSetupController {
  constructor(private readonly setup: GoLiveSetupService) {}

  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_VIEW)
  @Get()
  list() {
    return this.setup.platformOverview();
  }
}
