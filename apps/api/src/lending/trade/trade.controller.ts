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
import { InvoiceFinanceService } from './invoice-finance.service';
import { LettersOfCreditService } from './letters-of-credit.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rate = z.string().regex(/^0(\.\d{1,10})?$|^1(\.0+)?$/);

const registerInvoice = z
  .object({
    debtorName: z.string().trim().min(2).max(160),
    debtorReference: z.string().max(80).optional(),
    invoiceNumber: z.string().trim().min(1).max(60),
    amount: money,
    issueDate: date,
    dueDate: date,
  })
  .strict();
const reason = z.object({ reason: z.string().min(1).max(500) }).strict();
const release = z
  .object({ externalReference: z.string().min(1).max(120) })
  .strict();
const collection = z
  .object({
    source: z.enum(['DEBTOR', 'BORROWER']),
    amount: money,
    externalReference: z.string().max(120).optional(),
  })
  .strict();
const payoutProposal = z
  .object({ externalReference: z.string().max(120).optional() })
  .strict();
const decision = z
  .object({ approve: z.boolean(), comment: z.string().max(500).optional() })
  .strict();

const lcRequest = z
  .object({
    borrowerId: z.string().uuid(),
    productId: z.string().uuid(),
    amount: money,
    beneficiaryName: z.string().trim().min(2).max(160),
    beneficiaryBank: z.string().max(160).optional(),
    beneficiaryAccount: z.string().max(60).optional(),
    expiryDate: date,
    numberOfInstalments: z.number().int().min(1).max(600),
    annualRate: rate.optional(),
    portfolioId: z.string().uuid().optional(),
  })
  .strict();
const lcClose = z
  .object({
    action: z.enum(['EXPIRE', 'CANCEL']),
    reason: z.string().min(1).max(500),
  })
  .strict();
const drawingRequest = z
  .object({
    amount: money,
    documentsReference: z.string().trim().min(1).max(120),
    numberOfInstalments: z.number().int().min(1).max(600).optional(),
  })
  .strict();

/**
 * Invoice financing (LT-18, UC-67). Money endpoints (releasing an advance,
 * posting a collection, paying out a reserve) require an Idempotency-Key.
 */
@Controller('lending')
export class InvoiceFinanceController {
  constructor(private readonly svc: InvoiceFinanceService) {}

  @LendingAction('facility.read')
  @Get('facilities/:id/invoices')
  list(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.list(actor(req), id);
  }

  @LendingAction('trade.invoice.register')
  @Post('facilities/:id/invoices')
  register(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(registerInvoice)) b: never,
  ) {
    return this.svc.register(actor(req), id, b);
  }

  @LendingAction('facility.read')
  @Get('invoices/:invoiceId')
  get(@Req() req: Request, @Param('invoiceId', ID) invoiceId: string) {
    return this.svc.get(actor(req), invoiceId);
  }

  @LendingAction('facility.read')
  @Get('invoices/:invoiceId/quote')
  quote(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.svc.quote(actor(req), invoiceId, asOf);
  }

  @LendingAction('trade.invoice.approve')
  @Post('invoices/:invoiceId/approve')
  approve(@Req() req: Request, @Param('invoiceId', ID) invoiceId: string) {
    return this.svc.approve(actor(req), invoiceId);
  }

  @LendingAction('trade.invoice.reject')
  @Post('invoices/:invoiceId/reject')
  reject(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
    @Body(new ZodPipe(reason)) b: { reason: string },
  ) {
    return this.svc.reject(actor(req), invoiceId, b);
  }

  @LendingAction('trade.invoice.advance.request')
  @Post('invoices/:invoiceId/advance')
  requestAdvance(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
  ) {
    return this.svc.requestAdvance(actor(req), invoiceId);
  }

  @LendingAction('trade.invoice.advance.approve')
  @Post('invoices/:invoiceId/advance/approve')
  approveAdvance(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
  ) {
    return this.svc.approveAdvance(actor(req), invoiceId);
  }

  @LendingAction('trade.invoice.advance.release')
  @Post('invoices/:invoiceId/advance/release')
  releaseAdvance(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
    @Body(new ZodPipe(release)) b: { externalReference: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.releaseAdvance(actor(req), invoiceId, b, key);
  }

  @LendingAction('trade.invoice.collect')
  @Post('invoices/:invoiceId/collections')
  collect(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
    @Body(new ZodPipe(collection)) b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.collect(actor(req), invoiceId, b, key);
  }

  @LendingAction('trade.invoice.reserve.propose')
  @Post('invoices/:invoiceId/reserve-payouts')
  proposeReservePayout(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
    @Body(new ZodPipe(payoutProposal)) b: { externalReference?: string },
  ) {
    return this.svc.proposeReservePayout(actor(req), invoiceId, b);
  }

  @LendingAction('trade.invoice.reserve.approve')
  @Post('invoices/:invoiceId/reserve-payouts/:taskId/decision')
  decideReservePayout(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(decision)) b: { approve: boolean; comment?: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.decideReservePayout(actor(req), invoiceId, taskId, b, key);
  }
}

/**
 * Letters of credit (LT-19) and their conversion into loans (UC-53).
 */
@Controller('lending/letters-of-credit')
export class LettersOfCreditController {
  constructor(private readonly svc: LettersOfCreditService) {}

  @LendingAction('trade.lc.read')
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

  @LendingAction('trade.lc.request')
  @Post()
  request(@Req() req: Request, @Body(new ZodPipe(lcRequest)) b: never) {
    return this.svc.request(actor(req), b);
  }

  @LendingAction('trade.lc.read')
  @Get(':id')
  get(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.get(actor(req), id);
  }

  @LendingAction('trade.lc.issue')
  @Post(':id/issue')
  issue(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.issue(actor(req), id, key);
  }

  @LendingAction('trade.lc.reject')
  @Post(':id/reject')
  reject(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(reason)) b: { reason: string },
  ) {
    return this.svc.reject(actor(req), id, b);
  }

  @LendingAction('trade.lc.close')
  @Post(':id/close')
  close(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(lcClose)) b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.close(actor(req), id, b, key);
  }

  @LendingAction('trade.lc.drawing.request')
  @Post(':id/drawings')
  requestDrawing(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(drawingRequest)) b: never,
  ) {
    return this.svc.requestDrawing(actor(req), id, b);
  }

  @LendingAction('trade.lc.drawing.approve')
  @Post(':id/drawings/:drawingId/approve')
  approveDrawing(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('drawingId', ID) drawingId: string,
  ) {
    return this.svc.decideDrawing(actor(req), id, drawingId, 'APPROVE');
  }

  @LendingAction('trade.lc.drawing.reject')
  @Post(':id/drawings/:drawingId/reject')
  rejectDrawing(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('drawingId', ID) drawingId: string,
    @Body(new ZodPipe(reason)) b: { reason: string },
  ) {
    return this.svc.decideDrawing(
      actor(req),
      id,
      drawingId,
      'REJECT',
      b.reason,
    );
  }

  @LendingAction('trade.lc.drawing.pay')
  @Post(':id/drawings/:drawingId/pay')
  payDrawing(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('drawingId', ID) drawingId: string,
    @Body(new ZodPipe(release)) b: { externalReference: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.payDrawing(actor(req), id, drawingId, b, key);
  }
}
