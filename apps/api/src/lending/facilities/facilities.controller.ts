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
import { FacilitiesService } from './facilities.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const code = z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{1,47}$/);

const drawdownRequest = z
  .object({
    amount: money,
    valueDate: date.optional(),
    trancheCode: code.optional(),
    purpose: z.string().max(200).optional(),
  })
  .strict();

const release = z
  .object({ externalReference: z.string().min(1).max(120) })
  .strict();
const rejection = z.object({ reason: z.string().min(1).max(500) }).strict();

const satisfyCondition = z
  .object({ evidence: z.string().min(1).max(500) })
  .strict();
const waiveCondition = z
  .object({ reason: z.string().min(1).max(500) })
  .strict();

const limitRequest = z
  .object({
    newLimit: money,
    changeType: z.enum([
      'INCREASE',
      'DECREASE',
      'EXTENSION',
      'SUSPENSION',
      'REINSTATEMENT',
    ]),
    reason: z.string().min(1).max(500),
    effectiveDate: date.optional(),
  })
  .strict();

const limitDecision = z
  .object({ outcome: z.enum(['APPROVE', 'REJECT']) })
  .strict();
const statementRequest = z.object({ periodEnd: date }).strict();
const repayment = z
  .object({
    amount: money,
    valueDate: date.optional(),
    externalReference: z.string().max(120).optional(),
  })
  .strict();
const statusChange = z
  .object({
    action: z.enum(['SUSPEND', 'REINSTATE', 'EXPIRE']),
    reason: z.string().max(500).optional(),
  })
  .strict();

/**
 * Facility administration. Money endpoints (releasing a drawdown, raising a
 * period's charges) require an Idempotency-Key, like every other money
 * endpoint on the platform.
 */
@Controller('lending/facilities')
export class LendingFacilitiesController {
  constructor(private readonly svc: FacilitiesService) {}

  @LendingAction('facility.read')
  @Get()
  list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.svc.list(actor(req), {
      status,
      type,
      search,
      page: page ? Number(page) : 1,
    });
  }

  @LendingAction('facility.read')
  @Get(':id')
  get(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.get(actor(req), id);
  }

  @LendingAction('facility.read')
  @Get(':id/drawdown-simulation')
  simulate(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Query('amount') amount: string,
    @Query('valueDate') valueDate?: string,
    @Query('trancheCode') trancheCode?: string,
  ) {
    return this.svc.simulateDrawdown(actor(req), id, {
      amount,
      valueDate,
      trancheCode,
    });
  }

  @LendingAction('facility.drawdown.request')
  @Post(':id/drawdowns')
  requestDrawdown(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(drawdownRequest)) b: never,
  ) {
    return this.svc.requestDrawdown(actor(req), id, b);
  }

  @LendingAction('facility.drawdown.approve')
  @Post(':id/drawdowns/:drawdownId/approve')
  approveDrawdown(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('drawdownId', ID) drawdownId: string,
  ) {
    return this.svc.approveDrawdown(actor(req), id, drawdownId);
  }

  @LendingAction('facility.drawdown.reject')
  @Post(':id/drawdowns/:drawdownId/reject')
  rejectDrawdown(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('drawdownId', ID) drawdownId: string,
    @Body(new ZodPipe(rejection)) b: { reason: string },
  ) {
    return this.svc.rejectDrawdown(actor(req), id, drawdownId, b);
  }

  @LendingAction('facility.drawdown.cancel')
  @Post(':id/drawdowns/:drawdownId/cancel')
  cancelDrawdown(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('drawdownId', ID) drawdownId: string,
  ) {
    return this.svc.cancelDrawdown(actor(req), id, drawdownId);
  }

  @LendingAction('facility.drawdown.release')
  @Post(':id/drawdowns/:drawdownId/release')
  releaseDrawdown(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('drawdownId', ID) drawdownId: string,
    @Body(new ZodPipe(release)) b: { externalReference: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.releaseDrawdown(actor(req), id, drawdownId, b, key);
  }

  // Satisfying and waiving are different permissions, so they are different
  // routes: the action guard resolves one action per route.
  @LendingAction('facility.condition.manage')
  @Post(':id/conditions/:conditionId/satisfy')
  satisfyCondition(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('conditionId', ID) conditionId: string,
    @Body(new ZodPipe(satisfyCondition)) b: { evidence: string },
  ) {
    return this.svc.decideCondition(actor(req), id, conditionId, {
      outcome: 'SATISFY',
      evidence: b.evidence,
    });
  }

  @LendingAction('facility.condition.waive')
  @Post(':id/conditions/:conditionId/waive')
  waiveCondition(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('conditionId', ID) conditionId: string,
    @Body(new ZodPipe(waiveCondition)) b: { reason: string },
  ) {
    return this.svc.decideCondition(actor(req), id, conditionId, {
      outcome: 'WAIVE',
      reason: b.reason,
    });
  }

  @LendingAction('facility.statement.generate')
  @Post(':id/statements')
  generateStatement(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(statementRequest)) b: { periodEnd: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.generateStatement(actor(req), id, b, key);
  }

  @LendingAction('loan.repayment.post')
  @Post(':id/repayments')
  repay(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(repayment)) b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.postRepayment(actor(req), id, b, key);
  }

  @LendingAction('facility.limit.request')
  @Post(':id/limit-changes')
  requestLimitChange(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(limitRequest)) b: never,
  ) {
    return this.svc.requestLimitChange(actor(req), id, b);
  }

  @LendingAction('facility.limit.approve')
  @Post(':id/limit-changes/:changeId/decide')
  decideLimitChange(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('changeId', ID) changeId: string,
    @Body(new ZodPipe(limitDecision)) b: { outcome: 'APPROVE' | 'REJECT' },
  ) {
    return this.svc.decideLimitChange(actor(req), id, changeId, b);
  }

  @LendingAction('facility.manage')
  @Post(':id/status')
  changeStatus(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(statusChange)) b: never,
  ) {
    return this.svc.changeStatus(actor(req), id, b);
  }

  @LendingAction('facility.manage')
  @Post(':id/term-out')
  termOut(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.termOut(actor(req), id);
  }
}
