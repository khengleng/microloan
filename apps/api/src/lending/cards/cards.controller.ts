import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { CardsService } from './cards.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const purchase = z
  .object({
    amount: money,
    merchantName: z.string().trim().min(2).max(120),
    description: z.string().max(200).optional(),
  })
  .strict();
const cashAdvance = z
  .object({
    amount: money,
    externalReference: z.string().trim().min(2).max(120),
  })
  .strict();
const statement = z.object({ periodEnd: date }).strict();
const payment = z
  .object({
    amount: money,
    externalReference: z.string().max(120).optional(),
  })
  .strict();
const plan = z.object({ months: z.number().int().min(2).max(60) }).strict();
const closing = z
  .object({ reason: z.string().trim().min(2).max(500) })
  .strict();

/**
 * Credit cards (LT-07). A card rides on a REVOLVING facility; the limit and
 * its governance stay on /lending/facilities, card money moves here. Money
 * endpoints require an Idempotency-Key.
 */
@Controller('lending/cards')
export class LendingCardsController {
  constructor(private readonly svc: CardsService) {}

  @LendingAction('card.read')
  @Get()
  list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.svc.list(actor(req), {
      status,
      page: page ? Number(page) : 1,
    });
  }

  @LendingAction('card.read')
  @Get(':cardId')
  get(@Req() req: Request, @Param('cardId', ID) cardId: string) {
    return this.svc.get(actor(req), cardId);
  }

  @LendingAction('card.purchase.post')
  @Post(':cardId/purchases')
  purchase(
    @Req() req: Request,
    @Param('cardId', ID) cardId: string,
    @Body(new ZodPipe(purchase)) b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.purchase(actor(req), cardId, b, key);
  }

  @LendingAction('card.cash_advance.post')
  @Post(':cardId/cash-advances')
  cashAdvance(
    @Req() req: Request,
    @Param('cardId', ID) cardId: string,
    @Body(new ZodPipe(cashAdvance)) b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.cashAdvance(actor(req), cardId, b, key);
  }

  @LendingAction('card.statement.generate')
  @Post(':cardId/statements')
  statement(
    @Req() req: Request,
    @Param('cardId', ID) cardId: string,
    @Body(new ZodPipe(statement)) b: { periodEnd: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.generateStatement(actor(req), cardId, b, key);
  }

  @LendingAction('card.payment.post')
  @Post(':cardId/payments')
  payment(
    @Req() req: Request,
    @Param('cardId', ID) cardId: string,
    @Body(new ZodPipe(payment)) b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.payment(actor(req), cardId, b, key);
  }

  @LendingAction('card.instalment_plan.convert')
  @Post(':cardId/transactions/:transactionId/instalment-plan')
  convert(
    @Req() req: Request,
    @Param('cardId', ID) cardId: string,
    @Param('transactionId', ID) transactionId: string,
    @Body(new ZodPipe(plan)) b: { months: number },
  ) {
    return this.svc.convertToPlan(actor(req), cardId, transactionId, b);
  }

  @LendingAction('card.close')
  @Post(':cardId/close')
  close(
    @Req() req: Request,
    @Param('cardId', ID) cardId: string,
    @Body(new ZodPipe(closing)) b: { reason: string },
  ) {
    return this.svc.close(actor(req), cardId, b);
  }
}
