import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { lending } from '@microloan/shared';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { AmlScreeningService } from './aml-screening.service';
import { AmlCustomersService } from './aml-customers.service';
import { AmlReportsService } from './aml-reports.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD');

const AML = {
  status: z
    .object({
      status: z.enum(['CLEAR', 'FLAGGED']),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict(),
  decision: z
    .object({
      approve: z.boolean(),
      comment: z.string().max(500).optional(),
      reason: z.string().max(500).optional(),
    })
    .strict(),
  edd: z
    .object({
      sourceOfFunds: z.string().trim().min(5).max(2000),
      sourceOfWealth: z.string().trim().min(5).max(2000),
      documentReference: z.string().trim().min(2).max(200),
      documentId: z.string().uuid().optional(),
    })
    .strict(),
  watchList: z
    .object({
      listCode: z
        .string()
        .regex(/^[A-Z0-9_]{2,40}$/, 'list codes are 2–40 chars: A-Z, 0-9, _'),
      name: z.string().trim().min(2).max(120),
      fileName: z.string().trim().min(1).max(200),
      content: z.string().min(1).max(5_000_000),
    })
    .strict(),
  disposition: z
    .object({
      outcome: z.enum(['TRUE_MATCH', 'FALSE_POSITIVE']),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict(),
  ctr: z.object({ from: date, to: date }).strict(),
  str: z
    .object({
      borrowerId: z.string().uuid(),
      loanAccountId: z.string().uuid().optional(),
      financialEventId: z.string().uuid().optional(),
      grounds: z.string().trim().min(10).max(4000),
      indicators: z.array(z.enum(lending.STR_INDICATORS)).max(8).optional(),
    })
    .strict(),
  strReview: z
    .object({
      decision: z.enum(['NO_FURTHER_ACTION', 'TO_REPORT']),
      notes: z.string().trim().min(5).max(4000),
    })
    .strict(),
  strReported: z
    .object({
      cafiuReference: z.string().trim().min(2).max(120),
      reportedOn: date,
    })
    .strict(),
};

/**
 * AML/CFT (DECISIONS D-118…D-122): customers' AML standing, watch lists and
 * screening cases, enhanced due diligence, the cash transaction report and
 * suspicious transaction referrals. Every route names its lending action;
 * the services decide on the specific customer inside their transaction.
 */
@Controller('lending/aml')
export class AmlController {
  constructor(
    private readonly screening: AmlScreeningService,
    private readonly customers: AmlCustomersService,
    private readonly reports: AmlReportsService,
  ) {}

  // ── Customers ─────────────────────────────────────────────────────────────

  @LendingAction('aml.read')
  @Get('customers/:borrowerId')
  summary(@Req() req: Request, @Param('borrowerId', ID) id: string) {
    return this.customers.summary(actor(req), id);
  }

  @LendingAction('aml.screen')
  @Post('customers/:borrowerId/screen')
  screen(@Req() req: Request, @Param('borrowerId', ID) id: string) {
    return this.screening.screenNow(actor(req), id);
  }

  /** FLAGGED at once; CLEAR is recorded for a second person to approve. */
  @LendingAction('aml.screen')
  @Post('customers/:borrowerId/status')
  setStatus(
    @Req() req: Request,
    @Param('borrowerId', ID) id: string,
    @Body(new ZodPipe(AML.status))
    body: { status: 'CLEAR' | 'FLAGGED'; reason: string },
  ) {
    return this.customers.setStatus(actor(req), id, body);
  }

  @LendingAction('aml.status.approve')
  @Post('customers/:borrowerId/clearance/decision')
  decideClearance(
    @Req() req: Request,
    @Param('borrowerId', ID) id: string,
    @Body(new ZodPipe(AML.decision))
    body: { approve: boolean; comment?: string },
  ) {
    return this.customers.decideClearance(actor(req), id, body);
  }

  @LendingAction('aml.screen')
  @Post('customers/:borrowerId/risk-rating')
  rate(@Req() req: Request, @Param('borrowerId', ID) id: string) {
    return this.customers.rate(actor(req), id);
  }

  @LendingAction('aml.screen')
  @Post('customers/:borrowerId/edd')
  recordEdd(
    @Req() req: Request,
    @Param('borrowerId', ID) id: string,
    @Body(new ZodPipe(AML.edd))
    body: {
      sourceOfFunds: string;
      sourceOfWealth: string;
      documentReference: string;
      documentId?: string;
    },
  ) {
    return this.customers.recordEdd(actor(req), id, body);
  }

  @LendingAction('aml.edd.approve')
  @Post('edd/:eddId/decision')
  decideEdd(
    @Req() req: Request,
    @Param('eddId', ID) id: string,
    @Body(new ZodPipe(AML.decision))
    body: { approve: boolean; comment?: string },
  ) {
    return this.customers.decideEdd(actor(req), id, body);
  }

  @LendingAction('aml.case.read')
  @Get('risk-ratings')
  ratings(
    @Req() req: Request,
    @Query('rating') rating?: string,
    @Query('due') due?: string,
  ) {
    return this.customers.ratings(actor(req), {
      rating:
        typeof rating === 'string' &&
        (lending.AML_RISK_RATINGS as readonly string[]).includes(rating)
          ? rating
          : undefined,
      due: due === 'true',
    });
  }

  // ── Watch lists ───────────────────────────────────────────────────────────

  @LendingAction('aml.watchlist.read')
  @Get('watch-lists')
  watchLists(@Req() req: Request) {
    return this.screening.listVersions(actor(req));
  }

  @LendingAction('aml.watchlist.read')
  @Get('watch-lists/:versionId')
  watchList(
    @Req() req: Request,
    @Param('versionId', ID) id: string,
    @Query('page') page?: string,
  ) {
    return this.screening.getVersion(actor(req), id, Number(page) || 1);
  }

  @LendingAction('aml.watchlist.upload')
  @Post('watch-lists')
  upload(
    @Req() req: Request,
    @Body(new ZodPipe(AML.watchList))
    body: { listCode: string; name: string; fileName: string; content: string },
  ) {
    return this.screening.upload(actor(req), body);
  }

  @LendingAction('aml.watchlist.activate')
  @Post('watch-lists/:versionId/decision')
  decideWatchList(
    @Req() req: Request,
    @Param('versionId', ID) id: string,
    @Body(new ZodPipe(AML.decision))
    body: { approve: boolean; reason?: string },
  ) {
    return this.screening.decideVersion(actor(req), id, body);
  }

  /** Work queued re-screens now, instead of waiting for the scheduler. */
  @LendingAction('aml.rescreen.run')
  @Post('rescreen-jobs/run')
  runRescreen(@Req() req: Request) {
    return this.screening.runJobs(actor(req));
  }

  // ── Screening cases ───────────────────────────────────────────────────────

  @LendingAction('aml.case.read')
  @Get('cases')
  cases(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('borrowerId') borrowerId?: string,
  ) {
    return this.screening.listCases(actor(req), {
      status: typeof status === 'string' ? status : undefined,
      borrowerId:
        typeof borrowerId === 'string' && /^[0-9a-f-]{36}$/i.test(borrowerId)
          ? borrowerId
          : undefined,
    });
  }

  @LendingAction('aml.read')
  @Get('cases/:caseId')
  getCase(@Req() req: Request, @Param('caseId', ID) id: string) {
    return this.screening.getCase(actor(req), id);
  }

  @LendingAction('aml.case.propose')
  @Post('cases/:caseId/disposition')
  propose(
    @Req() req: Request,
    @Param('caseId', ID) id: string,
    @Body(new ZodPipe(AML.disposition))
    body: { outcome: 'TRUE_MATCH' | 'FALSE_POSITIVE'; reason: string },
  ) {
    return this.screening.proposeDisposition(actor(req), id, body);
  }

  @LendingAction('aml.case.decide')
  @Post('cases/:caseId/disposition/decision')
  decide(
    @Req() req: Request,
    @Param('caseId', ID) id: string,
    @Body(new ZodPipe(AML.decision))
    body: { approve: boolean; comment?: string },
  ) {
    return this.screening.decideDisposition(actor(req), id, body);
  }

  // ── Cash transaction report ───────────────────────────────────────────────

  @LendingAction('aml.ctr.read')
  @Get('ctr')
  ctr(
    @Req() req: Request,
    @Query(new ZodPipe(AML.ctr)) q: { from: string; to: string },
  ) {
    return this.reports.cashTransactionReport(actor(req), q);
  }

  @LendingAction('aml.ctr.read')
  @Get('ctr.csv')
  async ctrCsv(
    @Req() req: Request,
    @Res() res: Response,
    @Query(new ZodPipe(AML.ctr)) q: { from: string; to: string },
  ) {
    const report = await this.reports.cashTransactionReport(actor(req), q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cash-transactions-${q.from}-${q.to}.csv"`,
    );
    res.send(report.csv);
  }

  // ── Suspicious transaction referrals ──────────────────────────────────────

  @LendingAction('aml.str.raise')
  @Post('str')
  raiseStr(
    @Req() req: Request,
    @Body(new ZodPipe(AML.str))
    body: {
      borrowerId: string;
      loanAccountId?: string;
      financialEventId?: string;
      grounds: string;
      indicators?: string[];
    },
  ) {
    return this.reports.raiseStr(actor(req), body);
  }

  @LendingAction('aml.str.review')
  @Get('str')
  listStr(@Req() req: Request, @Query('status') status?: string) {
    return this.reports.listStr(actor(req), {
      status: typeof status === 'string' ? status : undefined,
    });
  }

  @LendingAction('aml.str.review')
  @Get('str/:strId')
  getStr(@Req() req: Request, @Param('strId', ID) id: string) {
    return this.reports.getStr(actor(req), id);
  }

  @LendingAction('aml.str.review')
  @Post('str/:strId/review')
  reviewStr(
    @Req() req: Request,
    @Param('strId', ID) id: string,
    @Body(new ZodPipe(AML.strReview))
    body: { decision: 'NO_FURTHER_ACTION' | 'TO_REPORT'; notes: string },
  ) {
    return this.reports.reviewStr(actor(req), id, body);
  }

  @LendingAction('aml.str.review')
  @Post('str/:strId/reported')
  reported(
    @Req() req: Request,
    @Param('strId', ID) id: string,
    @Body(new ZodPipe(AML.strReported))
    body: { cafiuReference: string; reportedOn: string },
  ) {
    return this.reports.markReported(actor(req), id, body);
  }
}
