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
import { DocumentaryTradeService } from './documentary.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rate = z.string().regex(/^0(\.\d{1,10})?$|^1(\.0+)?$/);

const docCode = z.string().regex(/^[A-Z0-9][A-Z0-9_]{1,47}$/);
const registerInvoice = z
  .object({
    /** The debtor (invoice finance, factoring) or obligor (forfaiting); a supply-chain invoice names its supplier instead. */
    debtorName: z.string().trim().min(2).max(160).optional(),
    debtorReference: z.string().max(80).optional(),
    invoiceNumber: z.string().trim().min(1).max(60),
    amount: money,
    issueDate: date,
    dueDate: date,
    supplierId: z.string().uuid().optional(),
    instrumentType: z.enum(['BILL_OF_EXCHANGE', 'PROMISSORY_NOTE']).optional(),
    guarantorName: z.string().trim().min(2).max(160).optional(),
  })
  .strict();
const acknowledgement = z
  .object({
    method: z.enum([
      'NOTICE_LETTER',
      'EMAIL',
      'DEBTOR_ACKNOWLEDGED',
      'BUYER_PORTAL',
      'BUYER_LETTER',
      'AVAL_ON_INSTRUMENT',
      'SEPARATE_GUARANTEE',
    ]),
    reference: z.string().trim().min(1).max(120),
    guarantorName: z.string().trim().min(2).max(160).optional(),
  })
  .strict();
const writeOffProposal = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
const supplier = z
  .object({
    name: z.string().trim().min(2).max(160),
    taxId: z.string().max(60).optional(),
    bankName: z.string().max(160).optional(),
    accountNumber: z.string().max(60).optional(),
    sublimit: money.optional(),
  })
  .strict();
const tradeTransaction = z
  .object({
    counterpartyName: z.string().trim().min(2).max(160),
    counterpartyCountry: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .optional(),
    goodsDescription: z.string().trim().min(2).max(500),
    transactionValue: money,
    cycleStartDate: date,
    expectedProceedsDate: date,
  })
  .strict();
const tradeDocument = z
  .object({
    code: docCode,
    reference: z.string().trim().min(1).max(120),
    description: z.string().max(500).optional(),
  })
  .strict();
const proceeds = z
  .object({
    amount: money,
    payerName: z.string().trim().min(2).max(160),
    externalReference: z.string().max(120).optional(),
    remitReference: z.string().max(120).optional(),
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
  @Get('trade/receivables')
  programmes(@Req() req: Request) {
    return this.svc.programmes(actor(req));
  }

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

  @LendingAction('trade.receivable.acknowledge')
  @Post('invoices/:invoiceId/acknowledge')
  acknowledge(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
    @Body(new ZodPipe(acknowledgement)) b: never,
  ) {
    return this.svc.acknowledge(actor(req), invoiceId, b);
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

  @LendingAction('trade.receivable.write_off.propose')
  @Post('invoices/:invoiceId/write-offs')
  proposeWriteOff(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
    @Body(new ZodPipe(writeOffProposal)) b: { reason: string },
  ) {
    return this.svc.proposeWriteOff(actor(req), invoiceId, b);
  }

  @LendingAction('trade.receivable.write_off.approve')
  @Post('invoices/:invoiceId/write-offs/:taskId/decision')
  decideWriteOff(
    @Req() req: Request,
    @Param('invoiceId', ID) invoiceId: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(decision)) b: { approve: boolean; comment?: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.decideWriteOff(actor(req), invoiceId, taskId, b, key);
  }

  @LendingAction('trade.supplier.manage')
  @Post('facilities/:id/suppliers')
  addSupplier(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(supplier)) b: never,
  ) {
    return this.svc.addSupplier(actor(req), id, b);
  }

  @LendingAction('trade.supplier.approve')
  @Post('suppliers/:supplierId/approve')
  approveSupplier(
    @Req() req: Request,
    @Param('supplierId', ID) supplierId: string,
  ) {
    return this.svc.decideSupplier(actor(req), supplierId, 'APPROVE');
  }

  @LendingAction('trade.supplier.reject')
  @Post('suppliers/:supplierId/reject')
  rejectSupplier(
    @Req() req: Request,
    @Param('supplierId', ID) supplierId: string,
    @Body(new ZodPipe(reason)) b: { reason: string },
  ) {
    return this.svc.decideSupplier(actor(req), supplierId, 'REJECT', b.reason);
  }

  @LendingAction('trade.programme.close')
  @Post('facilities/:id/receivables/close')
  closeProgramme(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.closeProgramme(actor(req), id);
  }
}

/**
 * Documentary trade loans: import loans and export working capital. The
 * trade and its documents gate disbursement; the proceeds repay the loan.
 * Posting proceeds requires an Idempotency-Key.
 */
@Controller('lending')
export class DocumentaryTradeController {
  constructor(private readonly svc: DocumentaryTradeService) {}

  @LendingAction('trade.documentary.read')
  @Get('trade/transactions')
  list(@Req() req: Request) {
    return this.svc.list(actor(req));
  }

  @LendingAction('trade.documentary.read')
  @Get('loans/:loanId/trade')
  get(@Req() req: Request, @Param('loanId', ID) loanId: string) {
    return this.svc.get(actor(req), loanId);
  }

  @LendingAction('trade.documentary.manage')
  @Post('loans/:loanId/trade')
  record(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Body(new ZodPipe(tradeTransaction)) b: never,
  ) {
    return this.svc.record(actor(req), loanId, b);
  }

  @LendingAction('trade.documentary.manage')
  @Post('trade-transactions/:transactionId/documents')
  receive(
    @Req() req: Request,
    @Param('transactionId', ID) transactionId: string,
    @Body(new ZodPipe(tradeDocument)) b: never,
  ) {
    return this.svc.receiveDocument(actor(req), transactionId, b);
  }

  @LendingAction('trade.documentary.verify')
  @Post('trade-documents/:tradeDocumentId/verify')
  verify(
    @Req() req: Request,
    @Param('tradeDocumentId', ID) documentId: string,
  ) {
    return this.svc.decideDocument(actor(req), documentId, 'VERIFY');
  }

  @LendingAction('trade.documentary.verify')
  @Post('trade-documents/:tradeDocumentId/reject')
  rejectDocument(
    @Req() req: Request,
    @Param('tradeDocumentId', ID) documentId: string,
    @Body(new ZodPipe(reason)) b: { reason: string },
  ) {
    return this.svc.decideDocument(actor(req), documentId, 'REJECT', b.reason);
  }

  @LendingAction('trade.documentary.proceeds')
  @Post('trade-transactions/:transactionId/proceeds')
  proceeds(
    @Req() req: Request,
    @Param('transactionId', ID) transactionId: string,
    @Body(new ZodPipe(proceeds)) b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.postProceeds(actor(req), transactionId, b, key);
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
