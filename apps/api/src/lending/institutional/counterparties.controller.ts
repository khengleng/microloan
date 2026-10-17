import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { S, ZodPipe } from '../common/zod.pipe';
import { CounterpartiesService } from './counterparties.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);

/**
 * Institutional lending: counterparties, their ratings and exposure limits
 * per counterparty and per country (maker-checker), and the exposure view.
 */
@Controller('lending')
export class CounterpartiesController {
  constructor(private readonly svc: CounterpartiesService) {}

  @LendingAction('counterparty.read')
  @Get('counterparties')
  list(@Req() req: Request) {
    return this.svc.list(actor(req));
  }

  @LendingAction('counterparty.read')
  @Get('counterparties/exposure')
  exposure(@Req() req: Request) {
    return this.svc.exposure(actor(req));
  }

  @LendingAction('counterparty.manage')
  @Post('counterparties')
  create(
    @Req() req: Request,
    @Body(new ZodPipe(S.counterpartyCreate)) b: never,
  ) {
    return this.svc.create(actor(req), b);
  }

  @LendingAction('counterparty.read')
  @Get('counterparties/:counterpartyId')
  get(@Req() req: Request, @Param('counterpartyId', ID) id: string) {
    return this.svc.get(actor(req), id);
  }

  @LendingAction('counterparty.manage')
  @Post('counterparties/:counterpartyId/rating')
  rating(
    @Req() req: Request,
    @Param('counterpartyId', ID) id: string,
    @Body(new ZodPipe(S.counterpartyRating)) b: never,
  ) {
    return this.svc.setRating(actor(req), id, b);
  }

  @LendingAction('counterparty.manage')
  @Post('counterparties/:counterpartyId/status')
  status(
    @Req() req: Request,
    @Param('counterpartyId', ID) id: string,
    @Body(new ZodPipe(S.counterpartyStatus)) b: never,
  ) {
    return this.svc.setStatus(actor(req), id, b);
  }

  @LendingAction('counterparty.manage')
  @Post('counterparties/:counterpartyId/limits')
  proposeLimit(
    @Req() req: Request,
    @Param('counterpartyId', ID) id: string,
    @Body(new ZodPipe(S.exposureLimitPropose)) b: never,
  ) {
    return this.svc.proposeCounterpartyLimit(actor(req), id, b);
  }

  @LendingAction('counterparty.read')
  @Get('exposure-limits')
  limits(@Req() req: Request, @Query('status') status?: string) {
    return this.svc.listLimits(actor(req), {
      status:
        status &&
        ['PENDING', 'ACTIVE', 'REJECTED', 'SUPERSEDED'].includes(status)
          ? status
          : undefined,
    });
  }

  @LendingAction('counterparty.manage')
  @Post('exposure-limits/country')
  proposeCountryLimit(
    @Req() req: Request,
    @Body(new ZodPipe(S.countryLimitPropose)) b: never,
  ) {
    return this.svc.proposeCountryLimit(actor(req), b);
  }

  @LendingAction('counterparty.limit.approve')
  @Post('exposure-limits/:limitId/decision')
  decide(
    @Req() req: Request,
    @Param('limitId', ID) id: string,
    @Body(new ZodPipe(S.limitDecision))
    b: { approve: boolean; comment?: string },
  ) {
    return this.svc.decideLimit(actor(req), id, b);
  }
}
