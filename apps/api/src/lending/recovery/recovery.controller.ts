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
import { RecoveryService } from './recovery.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const money = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'amount must be a decimal string');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD');
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

const R = {
  decision: z
    .object({ approve: z.boolean(), comment: z.string().max(500).optional() })
    .strict(),
  repossession: z
    .object({
      collateralId: z.string().uuid(),
      location: text(2, 200),
      seizedOn: date,
      reason: text(3, 500),
    })
    .strict(),
  valuation: z
    .object({ marketValue: money, valuer: text(2, 120), valuationDate: date })
    .strict(),
  sale: z
    .object({
      salePrice: money,
      costs: money.optional(),
      buyer: text(2, 120),
      saleDate: date,
      externalReference: z.string().max(120).optional(),
    })
    .strict(),
  pawn: z
    .object({
      description: text(2, 300),
      itemType: z.enum(['GOLD', 'JEWELLERY', 'OTHER']),
      weightGrams: z.string().regex(/^\d+(\.\d{1,4})?$/),
      karat: z.number().int().min(1).max(24).optional(),
      purity: z
        .string()
        .regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/)
        .optional(),
      pricePerGram: money,
      custodyLocation: text(2, 200),
      sealNumber: z.string().max(60).optional(),
      receivedOn: date,
      redemptionDeadline: date,
    })
    .strict(),
  forfeiture: z.object({ reason: text(3, 500) }).strict(),
  pawnReturn: z.object({ reference: text(2, 120) }).strict(),
  policy: z
    .object({
      insurer: text(2, 120),
      policyNumber: text(2, 60),
      coverType: z.enum(['DEATH_AND_DISABILITY', 'DEATH', 'DISABILITY']),
      premium: money.optional(),
      premiumTreatment: z.enum(['FINANCED', 'PAID']),
      startDate: date,
      externalReference: z.string().max(120).optional(),
    })
    .strict(),
  remittance: z
    .object({ amount: money.optional(), reference: text(2, 120) })
    .strict(),
  claim: z
    .object({
      eventType: z.enum(['DEATH', 'DISABILITY']),
      eventDate: date,
      evidenceReference: text(2, 200),
      amountClaimed: money.optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
  claimReceipt: z
    .object({ amount: money, externalReference: text(2, 120) })
    .strict(),
  debtSale: z
    .object({
      buyer: text(2, 120),
      price: money,
      saleDate: date,
      reason: text(3, 500),
      externalReference: z.string().max(120).optional(),
    })
    .strict(),
  refundPayout: z.object({ payee: text(2, 120).optional() }).strict(),
};

/** The recovery desk: recovery work across the caller's loans. */
@Controller('lending/recovery')
export class RecoveryDeskController {
  constructor(private readonly recovery: RecoveryService) {}

  @LendingAction('recovery.read')
  @Get()
  desk(@Req() req: Request) {
    return this.recovery.desk(actor(req));
  }
}

/**
 * Recovery on a loan (UC-65, UC-66, UC-68, UC-71). Each route names the
 * action it performs; decisions on recovery tasks name `loan.read` at the
 * door because the task itself carries the action the service enforces.
 */
@Controller('lending/loans')
export class RecoveryController {
  constructor(private readonly recovery: RecoveryService) {}

  @LendingAction('loan.read')
  @Get(':id/recovery')
  view(@Req() req: Request, @Param('id', ID) id: string) {
    return this.recovery.view(actor(req), id);
  }

  @LendingAction('loan.read')
  @Post(':id/recovery-tasks/:taskId/decision')
  decide(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(R.decision)) body: z.infer<typeof R.decision>,
    @Headers('idempotency-key') key: string,
  ) {
    return this.recovery.decide(actor(req), id, taskId, body, key);
  }

  // ── UC-65 Repossession ────────────────────────────────────────────────────

  @LendingAction('loan.repossession.propose')
  @Post(':id/repossessions')
  proposeRepossession(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(R.repossession)) body: z.infer<typeof R.repossession>,
  ) {
    return this.recovery.proposeRepossession(actor(req), id, body);
  }

  @LendingAction('loan.repossession.value')
  @Post(':id/repossessions/:repossessionId/valuation')
  valueRepossession(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('repossessionId', ID) repossessionId: string,
    @Body(new ZodPipe(R.valuation)) body: z.infer<typeof R.valuation>,
  ) {
    return this.recovery.valueRepossession(
      actor(req),
      id,
      repossessionId,
      body,
    );
  }

  @LendingAction('loan.repossession.sell')
  @Post(':id/repossessions/:repossessionId/sale')
  sellRepossession(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('repossessionId', ID) repossessionId: string,
    @Body(new ZodPipe(R.sale)) body: z.infer<typeof R.sale>,
    @Headers('idempotency-key') key: string,
  ) {
    return this.recovery.sellRepossession(
      actor(req),
      id,
      repossessionId,
      body,
      key,
    );
  }

  // ── UC-66 / LT-09 Pawn and gold ───────────────────────────────────────────

  @LendingAction('loan.pawn.custody')
  @Post(':id/pawn-items')
  receivePawn(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(R.pawn)) body: z.infer<typeof R.pawn>,
  ) {
    return this.recovery.receivePawn(actor(req), id, body);
  }

  @LendingAction('loan.pawn.forfeit.propose')
  @Post(':id/pawn-items/:itemId/forfeiture')
  forfeit(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('itemId', ID) itemId: string,
    @Body(new ZodPipe(R.forfeiture)) body: z.infer<typeof R.forfeiture>,
  ) {
    return this.recovery.proposeForfeiture(actor(req), id, itemId, body);
  }

  @LendingAction('loan.pawn.sell')
  @Post(':id/pawn-items/:itemId/sale')
  sellPawn(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('itemId', ID) itemId: string,
    @Body(new ZodPipe(R.sale)) body: z.infer<typeof R.sale>,
    @Headers('idempotency-key') key: string,
  ) {
    return this.recovery.sellPawn(actor(req), id, itemId, body, key);
  }

  @LendingAction('loan.pawn.return')
  @Post(':id/pawn-items/:itemId/return')
  returnPawn(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('itemId', ID) itemId: string,
    @Body(new ZodPipe(R.pawnReturn)) body: z.infer<typeof R.pawnReturn>,
  ) {
    return this.recovery.returnPawn(actor(req), id, itemId, body);
  }

  // ── UC-68 / UC-06 Credit insurance ────────────────────────────────────────

  @LendingAction('loan.insurance.manage')
  @Post(':id/insurance-policies')
  recordPolicy(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(R.policy)) body: z.infer<typeof R.policy>,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.recovery.recordPolicy(actor(req), id, body, key);
  }

  @LendingAction('loan.insurance.remit.propose')
  @Post(':id/insurance-policies/:policyId/remittances')
  remit(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('policyId', ID) policyId: string,
    @Body(new ZodPipe(R.remittance)) body: z.infer<typeof R.remittance>,
  ) {
    return this.recovery.proposeRemittance(actor(req), id, policyId, body);
  }

  @LendingAction('loan.insurance.claim.propose')
  @Post(':id/insurance-policies/:policyId/claims')
  fileClaim(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('policyId', ID) policyId: string,
    @Body(new ZodPipe(R.claim)) body: z.infer<typeof R.claim>,
  ) {
    return this.recovery.fileClaim(actor(req), id, policyId, body);
  }

  @LendingAction('loan.insurance.claim.receive')
  @Post(':id/insurance-claims/:claimId/receipts')
  claimReceipt(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('claimId', ID) claimId: string,
    @Body(new ZodPipe(R.claimReceipt)) body: z.infer<typeof R.claimReceipt>,
    @Headers('idempotency-key') key: string,
  ) {
    return this.recovery.receiveClaimPayment(actor(req), id, claimId, body, key);
  }

  // ── UC-71 Debt sale ───────────────────────────────────────────────────────

  @LendingAction('loan.debt_sale.propose')
  @Post(':id/debt-sales')
  proposeDebtSale(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(R.debtSale)) body: z.infer<typeof R.debtSale>,
  ) {
    return this.recovery.proposeDebtSale(actor(req), id, body);
  }

  // ── Surplus payout ────────────────────────────────────────────────────────

  @LendingAction('loan.recovery_refund.propose')
  @Post(':id/recovery-refunds/:refundId/payout')
  refundPayout(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('refundId', ID) refundId: string,
    @Body(new ZodPipe(R.refundPayout)) body: z.infer<typeof R.refundPayout>,
  ) {
    return this.recovery.proposeRefundPayout(actor(req), id, refundId, body);
  }
}
