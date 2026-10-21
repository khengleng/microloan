import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import {
  CREDIT_REPORT_PURPOSES,
  CreditReportService,
} from './credit-report.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);

const PullBody = z
  .object({
    purpose: z.enum(CREDIT_REPORT_PURPOSES),
    applicationId: z.string().uuid().optional(),
  })
  .strict();

/**
 * Credit reports (DECISIONS D-176…D-181): a customer's reports, pulling a
 * fresh one (an enquiry, under the customer's CREDIT_REPORT consent), one
 * report in full, its printable PDF, and an application's latest report.
 */
@Controller('lending')
export class CreditReportController {
  constructor(private readonly reports: CreditReportService) {}

  @LendingAction('credit_report.read')
  @Get('customers/:borrowerId/credit-reports')
  list(@Req() req: Request, @Param('borrowerId', ID) id: string) {
    return this.reports.list(actor(req), id);
  }

  @LendingAction('credit_report.pull')
  @Post('customers/:borrowerId/credit-reports')
  pull(
    @Req() req: Request,
    @Param('borrowerId', ID) id: string,
    @Body(new ZodPipe(PullBody)) b: z.infer<typeof PullBody>,
  ) {
    return this.reports.pull(actor(req), id, b);
  }

  @LendingAction('credit_report.read')
  @Get('credit-reports/:reportId')
  get(@Req() req: Request, @Param('reportId', ID) id: string) {
    return this.reports.get(actor(req), id);
  }

  @LendingAction('credit_report.read')
  @Get('credit-reports/:reportId/pdf')
  async pdf(
    @Req() req: Request,
    @Param('reportId', ID) id: string,
    @Res() res: Response,
  ) {
    const { fileName, body } = await this.reports.pdf(actor(req), id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }

  @LendingAction('credit_report.read')
  @Get('applications/:id/credit-report')
  forApplication(@Req() req: Request, @Param('id', ID) id: string) {
    return this.reports.forApplication(actor(req), id);
  }
}
