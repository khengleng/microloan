import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  LendingAction,
  ServiceAccountRoute,
  lendingActorOf,
} from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { PC } from './payment-channels.schemas';
import { PaymentChannelsService } from './payment-channels.service';
import { ChannelFilesService } from './channel-files.service';

type Req_ = Request & { user?: unknown; serviceActor?: never };
const actor = (req: Req_) => lendingActorOf(req as never);
const ID = new ParseUUIDPipe();

/** Settlement and payroll files, reconciliation, auto-debit attempts and channel settings (UC-16, UC-18, UC-19, UC-21). */
@Controller('lending/payment-channels')
export class PaymentChannelsController {
  constructor(
    private readonly channels: PaymentChannelsService,
    private readonly files: ChannelFilesService,
  ) {}

  @LendingAction('payment.channel.read')
  @Get('settings')
  settings(@Req() req: Req_) {
    return this.channels.settings(actor(req));
  }

  @LendingAction('payment.channel.configure')
  @Put('settings')
  updateSettings(
    @Req() req: Req_,
    @Body(new ZodPipe(PC.settings)) body: never,
  ) {
    return this.channels.updateSettings(actor(req), body);
  }

  /** Import a mobile / QR / wallet / agent settlement file (CSV; see docs/lending/OPERATIONS.md). */
  @LendingAction('payment.channel_file.import')
  @Post('settlement-files')
  importSettlement(
    @Req() req: Req_,
    @Body(new ZodPipe(PC.settlementFile)) body: never,
  ) {
    return this.files.importSettlement(actor(req), body);
  }

  /** Import an employer's payroll remittance file. */
  @LendingAction('payment.channel_file.import')
  @Post('payroll-files')
  importPayroll(
    @Req() req: Req_,
    @Body(new ZodPipe(PC.payrollFile)) body: never,
  ) {
    return this.files.importPayroll(actor(req), body);
  }

  @LendingAction('payment.channel.read')
  @Get('files')
  list(
    @Req() req: Req_,
    @Query('kind') kind?: string,
    @Query('channel') channel?: string,
  ) {
    return this.files.list(actor(req), { kind, channel });
  }

  @LendingAction('payment.channel.read')
  @Get('files/:fileId')
  get(@Req() req: Req_, @Param('fileId', ID) fileId: string) {
    return this.files.get(actor(req), fileId);
  }

  @LendingAction('payment.channel.read')
  @Get('reconciliation')
  reconciliation(
    @Req() req: Req_,
    @Query('date') date?: string,
    @Query('channel') channel?: string,
  ) {
    return this.files.reconciliation(actor(req), { date, channel });
  }

  @LendingAction('payment.channel.read')
  @Get('payroll-summary')
  payrollSummary(
    @Req() req: Req_,
    @Query('employer') employer?: string,
    @Query('period') period?: string,
  ) {
    return this.files.payrollSummary(actor(req), { employer, period });
  }

  @LendingAction('payment.channel.read')
  @Get('auto-debit/attempts')
  attempts(@Req() req: Req_, @Query('status') status?: string) {
    return this.channels.attempts(actor(req), status);
  }
}

/** Mandates and cross-currency payments on one loan (UC-16, UC-21). */
@Controller('lending/loans')
export class LoanPaymentChannelsController {
  constructor(private readonly channels: PaymentChannelsService) {}

  @LendingAction('loan.read')
  @Get(':id/mandates')
  mandates(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.channels.mandates(actor(req), id);
  }

  @LendingAction('loan.mandate.manage')
  @Post(':id/mandates')
  createMandate(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(PC.mandate)) body: never,
  ) {
    return this.channels.createMandate(actor(req), id, body);
  }

  @LendingAction('loan.mandate.manage')
  @Post(':id/mandates/:mandateId/revoke')
  revokeMandate(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('mandateId', ID) mandateId: string,
    @Body(new ZodPipe(PC.revokeMandate)) body: never,
  ) {
    return this.channels.revokeMandate(actor(req), id, mandateId, body);
  }

  /** Preview a payment in another currency: rate, converted amount, FX gain or loss. */
  @LendingAction('loan.read')
  @Get(':id/fx-quote')
  fxQuote(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Query('amount') amount?: string,
    @Query('currency') currency?: string,
    @Query('valueDate') valueDate?: string,
  ) {
    return this.channels.fxQuote(actor(req), id, {
      amount,
      currency,
      valueDate,
    });
  }

  @LendingAction('loan.repayment.post')
  @Post(':id/fx-repayments')
  fxRepayment(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(PC.fxRepayment)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.channels.fxRepayment(actor(req), id, body, key);
  }
}

/** Channel files pushed by an integration with a service-account key (UC-18, UC-19). */
@Controller('lending/integrations')
export class ChannelIntegrationsController {
  constructor(private readonly files: ChannelFilesService) {}

  @ServiceAccountRoute('payment.channel_file.import')
  @Post('settlement-files')
  importSettlement(
    @Req() req: Req_,
    @Body(new ZodPipe(PC.settlementFile)) body: never,
  ) {
    return this.files.importSettlement(actor(req), body);
  }

  @ServiceAccountRoute('payment.channel_file.import')
  @Post('payroll-files')
  importPayroll(
    @Req() req: Req_,
    @Body(new ZodPipe(PC.payrollFile)) body: never,
  ) {
    return this.files.importPayroll(actor(req), body);
  }
}
