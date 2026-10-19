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
import { BnplLeaseService } from './bnpl-lease.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const code = z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{1,47}$/);

const refund = z
  .object({
    amount: money,
    merchantReference: z.string().trim().min(2).max(120),
    reason: z.string().trim().min(2).max(500),
    /** Required when part of the refund is paid back to the customer. */
    externalReference: z.string().trim().min(2).max(120).optional(),
  })
  .strict();
const collect = z
  .object({ externalReference: z.string().trim().min(2).max(120) })
  .strict();
const asset = z
  .object({
    assetType: code,
    description: z.string().trim().min(2).max(200),
    serialNumber: z.string().trim().max(80).optional(),
    supplierName: z.string().trim().min(2).max(120),
    cost: money,
  })
  .strict();
const leaseReturn = z
  .object({
    condition: z.string().trim().min(2).max(500),
    externalReference: z.string().trim().min(2).max(120),
  })
  .strict();

/**
 * Purchase-linked loans: BNPL merchant refunds (UC-52) and the leased asset
 * of a lease (LT-15). Money endpoints require an Idempotency-Key.
 */
@Controller('lending/loans/:loanId')
export class LendingBnplLeaseController {
  constructor(private readonly svc: BnplLeaseService) {}

  @LendingAction('loan.read')
  @Get('bnpl')
  bnpl(@Req() req: Request, @Param('loanId', ID) loanId: string) {
    return this.svc.getBnpl(actor(req), loanId);
  }

  @LendingAction('loan.bnpl.refund')
  @Post('bnpl/refunds')
  refund(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Body(new ZodPipe(refund)) b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.refund(actor(req), loanId, b, key);
  }

  @LendingAction('loan.bnpl.clawback.collect')
  @Post('bnpl/refunds/:bnplRefundId/collect')
  collect(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Param('bnplRefundId', ID) refundId: string,
    @Body(new ZodPipe(collect)) b: { externalReference: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.collectClawback(actor(req), loanId, refundId, b, key);
  }

  @LendingAction('loan.read')
  @Get('lease')
  lease(@Req() req: Request, @Param('loanId', ID) loanId: string) {
    return this.svc.getLease(actor(req), loanId);
  }

  @LendingAction('loan.lease.register')
  @Post('lease')
  register(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Body(new ZodPipe(asset)) b: never,
  ) {
    return this.svc.registerAsset(actor(req), loanId, b);
  }

  @LendingAction('loan.lease.return')
  @Post('lease/return')
  returnAsset(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Body(new ZodPipe(leaseReturn)) b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.returnAsset(actor(req), loanId, b, key);
  }

  @LendingAction('loan.lease.transfer_title')
  @Post('lease/transfer-title')
  transferTitle(@Req() req: Request, @Param('loanId', ID) loanId: string) {
    return this.svc.transferTitle(actor(req), loanId);
  }
}
