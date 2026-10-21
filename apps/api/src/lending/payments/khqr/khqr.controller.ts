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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  LendingAction,
  lendingActorOf,
} from '../../policy/lending-action.guard';
import { ZodPipe } from '../../common/zod.pipe';
import { BorrowerRoute } from '../../../auth/auth-scope.decorator';
import { BorrowerJwtGuard } from '../../../borrower-portal/borrower-jwt.guard';
import { KQ } from './khqr.schemas';
import { KhqrCodesService } from './khqr-codes.service';
import { KhqrReceiptsService } from './khqr-receipts.service';
import { KhqrStatementsService } from './khqr-statements.service';
import { KhqrHowToPayService, payLanguages } from './khqr-how-to-pay.service';

type Req_ = Request & { user?: unknown };
const actor = (req: Req_) => lendingActorOf(req as never);
const ID = new ParseUUIDPipe();

/**
 * Repayments to the lender's static KHQR code (D-160…D-165): the codes
 * (maker-checker), the receipts awaiting verification, and bank statement
 * imports.
 */
@Controller('lending/khqr')
export class KhqrController {
  constructor(
    private readonly codes: KhqrCodesService,
    private readonly receipts: KhqrReceiptsService,
    private readonly statements: KhqrStatementsService,
  ) {}

  @LendingAction('khqr.read')
  @Get('codes')
  listCodes(@Req() req: Req_) {
    return this.codes.list(actor(req));
  }

  /** Read an uploaded QR image or payload; nothing is saved. */
  @LendingAction('khqr.propose')
  @Post('codes/preview')
  previewCode(
    @Req() req: Req_,
    @Body(new ZodPipe(KQ.previewCode)) body: never,
  ) {
    return this.codes.preview(actor(req), body);
  }

  @LendingAction('khqr.propose')
  @Post('codes')
  proposeCode(
    @Req() req: Req_,
    @Body(new ZodPipe(KQ.proposeCode)) body: never,
  ) {
    return this.codes.propose(actor(req), body);
  }

  @LendingAction('khqr.approve')
  @Post('codes/:codeId/decision')
  decideCode(
    @Req() req: Req_,
    @Param('codeId', ID) codeId: string,
    @Body(new ZodPipe(KQ.decide)) body: never,
  ) {
    return this.codes.decide(actor(req), codeId, body);
  }

  /** The reconciliation queue: receipts by status and source, in the reader's scope. */
  @LendingAction('payment.channel.read')
  @Get('receipts')
  queue(
    @Req() req: Req_,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
  ) {
    return this.receipts.queue(actor(req), { status, source, search });
  }

  @LendingAction('payment.receipt.verify')
  @Post('receipts/:receiptId/verify')
  verify(
    @Req() req: Req_,
    @Param('receiptId', ID) receiptId: string,
    @Body(new ZodPipe(KQ.verify)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.receipts.verify(actor(req), receiptId, body, key);
  }

  @LendingAction('payment.receipt.reject')
  @Post('receipts/:receiptId/reject')
  reject(
    @Req() req: Req_,
    @Param('receiptId', ID) receiptId: string,
    @Body(new ZodPipe(KQ.reject)) body: never,
  ) {
    return this.receipts.reject(actor(req), receiptId, body);
  }

  @LendingAction('payment.channel.read')
  @Get('statement-mappings')
  mappings(@Req() req: Req_) {
    return this.statements.mappings(actor(req));
  }

  /** Import a bank / Bakong merchant statement (CSV or XLSX); `dryRun` only previews it. */
  @LendingAction('payment.channel_file.import')
  @Post('statements')
  importStatement(
    @Req() req: Req_,
    @Body(new ZodPipe(KQ.statement)) body: never,
  ) {
    return this.statements.importStatement(actor(req), body);
  }
}

/** One loan's KHQR receipts, recording one, and its printable "How to pay" card. */
@Controller('lending/loans')
export class LoanKhqrController {
  constructor(
    private readonly receipts: KhqrReceiptsService,
    private readonly howToPay: KhqrHowToPayService,
  ) {}

  @LendingAction('payment.receipt.read')
  @Get(':id/khqr-receipts')
  list(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.receipts.forLoan(actor(req), id);
  }

  @LendingAction('payment.receipt.record')
  @Post(':id/khqr-receipts')
  record(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(KQ.staffReceipt)) body: never,
  ) {
    return this.receipts.record(actor(req), id, body);
  }

  @LendingAction('payment.receipt.read')
  @Get(':id/how-to-pay')
  async card(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Res() res: Response,
    @Query('lang') lang?: string,
  ) {
    const { pdf, reference } = await this.howToPay.staffCard(
      actor(req),
      id,
      payLanguages(lang),
    );
    sendPdf(res, pdf, `how-to-pay-${reference}.pdf`);
  }
}

/** The borrower's "I have paid" (portal). */
@BorrowerRoute()
@UseGuards(BorrowerJwtGuard)
@Controller('lending/portal')
export class KhqrPortalController {
  constructor(private readonly receipts: KhqrReceiptsService) {}

  @LendingAction('payment.claim.submit_own')
  @Post('loans/:loanId/khqr-claims')
  claim(
    @Req() req: Req_,
    @Param('loanId', ID) loanId: string,
    @Body(new ZodPipe(KQ.claim)) body: never,
  ) {
    return this.receipts.claim(actor(req), loanId, body);
  }
}

export function sendPdf(res: Response, pdf: Buffer, fileName: string) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${fileName.replace(/[^\w.-]/g, '_')}"`,
    'Content-Length': pdf.length,
    'Cache-Control': 'no-store',
  });
  res.send(pdf);
}
