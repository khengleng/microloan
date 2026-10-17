import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { SyndicationService } from './syndication.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const fraction = z.string().regex(/^0(\.\d{1,12})?$|^1(\.0+)?$/);

const participants = z
  .object({
    participants: z
      .array(
        z
          .object({
            lenderName: z.string().trim().min(2).max(160),
            isAgent: z.boolean(),
            share: fraction.optional(),
            amount: money.optional(),
            feeShare: fraction.optional(),
          })
          .strict(),
      )
      .min(2)
      .max(50),
  })
  .strict();
const funding = z
  .object({ externalReference: z.string().min(1).max(120) })
  .strict();
const payout = z
  .object({
    amount: money.optional(),
    externalReference: z.string().max(120).optional(),
  })
  .strict();
const decision = z
  .object({ approve: z.boolean(), comment: z.string().max(500).optional() })
  .strict();

/**
 * Syndicated loans (LT-24): participants, funding, sharing of collections
 * and payouts. The loan itself is serviced through /lending/loans.
 */
@Controller('lending/loans')
export class SyndicationController {
  constructor(private readonly svc: SyndicationService) {}

  @LendingAction('syndication.read')
  @Get(':id/syndicate')
  get(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.get(actor(req), id);
  }

  @LendingAction('syndication.manage')
  @Put(':id/syndicate')
  set(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(participants)) b: never,
  ) {
    return this.svc.setParticipants(actor(req), id, b);
  }

  @LendingAction('syndication.approve')
  @Post(':id/syndicate/approve')
  approve(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.approve(actor(req), id);
  }

  @LendingAction('syndication.fund')
  @Post(':id/syndicate/funding')
  fund(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(funding)) b: { externalReference: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.recordFunding(actor(req), id, b, key);
  }

  @LendingAction('syndication.distribute')
  @Post(':id/syndicate/distribute')
  distribute(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.distribute(actor(req), id);
  }

  @LendingAction('syndication.payout.propose')
  @Post(':id/syndicate/participants/:participantId/payouts')
  proposePayout(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('participantId', ID) participantId: string,
    @Body(new ZodPipe(payout)) b: never,
  ) {
    return this.svc.proposePayout(actor(req), id, participantId, b);
  }

  @LendingAction('syndication.payout.approve')
  @Post(':id/syndicate/payouts/:taskId/decision')
  decidePayout(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(decision)) b: { approve: boolean; comment?: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.decidePayout(actor(req), id, taskId, b, key);
  }
}
