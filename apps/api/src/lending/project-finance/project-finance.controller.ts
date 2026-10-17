import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectFinanceService } from './project-finance.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const receipts = z
  .object({
    receivedOn: date.optional(),
    revenue: money,
    operatingCosts: money,
    taxes: money,
    externalReference: z.string().trim().max(120).optional(),
  })
  .strict();

/**
 * Project finance in operation (LT-17): the project's reserve, lock-up and
 * cash waterfall. Construction and term-out run through
 * /lending/facilities; the loan itself is serviced through /lending/loans.
 */
@Controller('lending/loans')
export class ProjectFinanceController {
  constructor(private readonly svc: ProjectFinanceService) {}

  @LendingAction('loan.read')
  @Get(':id/project')
  overview(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.overview(actor(req), id);
  }

  /** What applying these receipts would do; posts nothing. */
  @LendingAction('loan.read')
  @Post(':id/project/waterfall-preview')
  preview(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(receipts)) body: z.infer<typeof receipts>,
  ) {
    return this.svc.preview(actor(req), id, body);
  }

  @LendingAction('project.waterfall.apply')
  @Post(':id/project/waterfall')
  apply(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(receipts)) body: z.infer<typeof receipts>,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.apply(actor(req), id, body, key);
  }
}
