import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { BorrowerAuthService } from './borrower-auth.service';
import { BorrowerPortalService } from './borrower-portal.service';
import { BorrowerJwtGuard } from './borrower-jwt.guard';
import { CurrentBorrower } from './current-borrower.decorator';
import type { BorrowerSession } from './borrower-jwt';
import { RequestOtpDto, VerifyOtpDto, UploadKycDto } from './dto/borrower-auth.dto';
import { SignAgreementDto } from '../agreements/dto/sign-agreement.dto';

@Controller('borrower')
export class BorrowerPortalController {
  constructor(
    private readonly auth: BorrowerAuthService,
    private readonly portal: BorrowerPortalService,
  ) {}

  // ── Public OTP auth (rate-limited by the global throttler) ────────────────
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  // ── Authenticated borrower portal ─────────────────────────────────────────
  @UseGuards(BorrowerJwtGuard)
  @Get('me')
  me(@CurrentBorrower() b: BorrowerSession) {
    return this.portal.me(b);
  }

  @UseGuards(BorrowerJwtGuard)
  @Get('loans')
  loans(@CurrentBorrower() b: BorrowerSession) {
    return this.portal.listLoans(b);
  }

  @UseGuards(BorrowerJwtGuard)
  @Get('loans/:id')
  loan(@CurrentBorrower() b: BorrowerSession, @Param('id') id: string) {
    return this.portal.getLoan(b, id);
  }

  @UseGuards(BorrowerJwtGuard)
  @Get('loans/:id/statement')
  async statement(
    @CurrentBorrower() b: BorrowerSession,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.portal.statementPdf(b, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="statement-${id}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }

  @UseGuards(BorrowerJwtGuard)
  @Get('loans/:id/key-facts')
  keyFacts(@CurrentBorrower() b: BorrowerSession, @Param('id') id: string) {
    return this.portal.keyFacts(b, id);
  }

  @UseGuards(BorrowerJwtGuard)
  @Post('loans/:id/sign')
  sign(
    @CurrentBorrower() b: BorrowerSession,
    @Param('id') id: string,
    @Body() dto: SignAgreementDto,
    @Ip() ip: string,
  ) {
    return this.portal.signAgreement(b, id, dto, ip);
  }

  @UseGuards(BorrowerJwtGuard)
  @Get('payment-qr')
  paymentQr(@CurrentBorrower() b: BorrowerSession) {
    return this.portal.paymentQr(b);
  }

  @UseGuards(BorrowerJwtGuard)
  @Get('kyc')
  kyc(@CurrentBorrower() b: BorrowerSession) {
    return this.portal.kyc(b);
  }

  @UseGuards(BorrowerJwtGuard)
  @Post('kyc/documents')
  uploadKyc(@CurrentBorrower() b: BorrowerSession, @Body() dto: UploadKycDto) {
    return this.portal.uploadKyc(b, dto);
  }
}
