import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { LendingOverviewService } from './overview.service';

/** The lending book at a glance for the home dashboard, within the caller's loan scope. */
@Controller('lending/overview')
export class LendingOverviewController {
  constructor(private readonly overview: LendingOverviewService) {}

  @LendingAction('loan.read')
  @Get()
  summary(@Req() req: Request) {
    return this.overview.summary(lendingActorOf(req as never));
  }
}
