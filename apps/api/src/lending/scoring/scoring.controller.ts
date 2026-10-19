import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { lending } from '@microloan/shared';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ApplicationsService } from '../origination/applications.service';
import { ScorecardsService } from './scorecards.service';
import { ScoreMonitoringService } from './score-monitoring.service';
import { AlternativeDataService } from './alternative-data.service';
import { AltDataProvidersService, PROVIDER_SOURCES } from './providers';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);

const scorecardCode = z
  .string()
  .regex(
    /^[A-Z0-9][A-Z0-9_.-]{1,47}$/,
    'codes are 2–48 chars: A-Z, 0-9, _ . -',
  );
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD');
const inputValue = z.union([
  z.string().max(60),
  z.number().int(),
  z.boolean(),
  z.null(),
]);

const SC = {
  create: z
    .object({
      code: scorecardCode,
      name: z.string().trim().min(2).max(120),
      description: z.string().max(1000).optional(),
      templateCode: scorecardCode.optional(),
      definition: z.unknown().optional(),
      changeSummary: z.string().max(500).optional(),
    })
    .strict(),
  version: z
    .object({
      definition: z.unknown().optional(),
      changeSummary: z.string().max(500).optional(),
    })
    .strict(),
  draft: z
    .object({
      definition: z.record(z.unknown()),
      changeSummary: z.string().max(500).optional(),
    })
    .strict(),
  reject: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  test: z
    .object({
      definition: z.unknown().optional(),
      versionId: z.string().uuid().optional(),
      templateCode: scorecardCode.optional(),
      inputs: z.record(inputValue),
    })
    .strict(),
  consent: z
    .object({
      source: z.enum(lending.ALT_DATA_SOURCES),
      purpose: z.string().trim().min(5).max(500),
      scope: z.string().max(500).optional(),
      method: z.enum(['SIGNED_FORM', 'RECORDED_VERBAL', 'BORROWER_PORTAL']),
      documentId: z.string().uuid().optional(),
      effectiveAt: z.string().datetime({ offset: true }).optional(),
      expiresAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  revoke: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  record: z
    .object({
      kind: z.enum(lending.OFFICER_DATA_KINDS),
      data: z.record(z.unknown()),
      periodFrom: date,
      periodTo: date,
      documentId: z.string().uuid(),
      note: z.string().max(500).optional(),
    })
    .strict(),
  decision: z
    .object({
      approve: z.boolean(),
      reason: z.string().max(500).optional(),
    })
    .strict(),
  provider: z
    .object({
      source: z.enum(PROVIDER_SOURCES),
      providerCode: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/),
      endpointUrl: z.string().trim().min(8).max(500),
      credentials: z.string().min(8).max(4000),
    })
    .strict(),
  providerDecision: z
    .object({ approve: z.boolean(), comment: z.string().max(500).optional() })
    .strict(),
};

const int = (v?: string) =>
  v === undefined || v === '' ? undefined : Math.trunc(Number(v));

/**
 * Scorecards and their monitoring, application scores, and the alternative
 * data that feeds thin-file scoring (consent, officer-captured records,
 * external providers).
 */
@Controller('lending')
export class ScoringController {
  constructor(
    private readonly scorecards: ScorecardsService,
    private readonly monitoring: ScoreMonitoringService,
    private readonly apps: ApplicationsService,
    private readonly altData: AlternativeDataService,
    private readonly providers: AltDataProvidersService,
  ) {}

  // ── Scorecards ────────────────────────────────────────────────────────────

  @LendingAction('scorecard.read')
  @Get('scorecards')
  list(@Req() req: Request) {
    return this.scorecards.catalogue(actor(req));
  }

  @LendingAction('scorecard.manage')
  @Post('scorecards')
  create(@Req() req: Request, @Body(new ZodPipe(SC.create)) b: never) {
    return this.scorecards.create(actor(req), b);
  }

  @LendingAction('scorecard.read')
  @Get('scorecards/:scorecardId')
  get(@Req() req: Request, @Param('scorecardId', ID) id: string) {
    return this.scorecards.get(actor(req), id);
  }

  @LendingAction('scorecard.manage')
  @Post('scorecards/:scorecardId/versions')
  addVersion(
    @Req() req: Request,
    @Param('scorecardId', ID) id: string,
    @Body(new ZodPipe(SC.version)) b: never,
  ) {
    return this.scorecards.addVersion(actor(req), id, b);
  }

  @LendingAction('scorecard.manage')
  @Put('scorecard-versions/:versionId')
  updateDraft(
    @Req() req: Request,
    @Param('versionId', ID) id: string,
    @Body(new ZodPipe(SC.draft)) b: never,
  ) {
    return this.scorecards.updateDraft(actor(req), id, b);
  }

  @LendingAction('scorecard.manage')
  @Post('scorecard-versions/:versionId/submit')
  submit(@Req() req: Request, @Param('versionId', ID) id: string) {
    return this.scorecards.transition(actor(req), id, 'submit');
  }

  @LendingAction('scorecard.approve')
  @Post('scorecard-versions/:versionId/approve')
  approve(@Req() req: Request, @Param('versionId', ID) id: string) {
    return this.scorecards.transition(actor(req), id, 'approve');
  }

  @LendingAction('scorecard.approve')
  @Post('scorecard-versions/:versionId/reject')
  reject(
    @Req() req: Request,
    @Param('versionId', ID) id: string,
    @Body(new ZodPipe(SC.reject)) b: { reason: string },
  ) {
    return this.scorecards.transition(actor(req), id, 'reject', b.reason);
  }

  @LendingAction('scorecard.approve')
  @Post('scorecard-versions/:versionId/activate')
  activate(@Req() req: Request, @Param('versionId', ID) id: string) {
    return this.scorecards.transition(actor(req), id, 'activate');
  }

  @LendingAction('scorecard.approve')
  @Post('scorecard-versions/:versionId/retire')
  retire(@Req() req: Request, @Param('versionId', ID) id: string) {
    return this.scorecards.transition(actor(req), id, 'retire');
  }

  @LendingAction('scorecard.read')
  @Post('scorecard-test')
  test(@Req() req: Request, @Body(new ZodPipe(SC.test)) b: never) {
    return this.scorecards.test(actor(req), b);
  }

  @LendingAction('scorecard.read')
  @Get('scorecard-monitoring')
  report(
    @Req() req: Request,
    @Query('scorecardCode') scorecardCode?: string,
    @Query('badDaysPastDue') badDaysPastDue?: string,
    @Query('performanceMonths') performanceMonths?: string,
    @Query('baselineFrom') baselineFrom?: string,
    @Query('baselineTo') baselineTo?: string,
    @Query('recentFrom') recentFrom?: string,
    @Query('recentTo') recentTo?: string,
  ) {
    return this.monitoring.report(actor(req), {
      scorecardCode: scorecardCode || undefined,
      badDaysPastDue: int(badDaysPastDue),
      performanceMonths: int(performanceMonths),
      baselineFrom: baselineFrom || undefined,
      baselineTo: baselineTo || undefined,
      recentFrom: recentFrom || undefined,
      recentTo: recentTo || undefined,
    });
  }

  // ── Application scores ────────────────────────────────────────────────────

  @LendingAction('credit_score.read')
  @Get('applications/:id/scores')
  scores(@Req() req: Request, @Param('id', ID) id: string) {
    return this.apps.scores(actor(req), id);
  }

  @LendingAction('credit_score.run')
  @Post('applications/:id/scores')
  rescore(@Req() req: Request, @Param('id', ID) id: string) {
    return this.apps.rescore(actor(req), id);
  }

  // ── Alternative data ──────────────────────────────────────────────────────

  @LendingAction('alt_data.read')
  @Get('customers/:borrowerId/alternative-data')
  overview(@Req() req: Request, @Param('borrowerId', ID) id: string) {
    return this.altData.overview(actor(req), id);
  }

  @LendingAction('alt_data.consent.manage')
  @Post('customers/:borrowerId/consents')
  grant(
    @Req() req: Request,
    @Param('borrowerId', ID) id: string,
    @Body(new ZodPipe(SC.consent)) b: never,
  ) {
    return this.altData.grant(actor(req), id, b);
  }

  @LendingAction('alt_data.consent.manage')
  @Post('consents/:consentId/revoke')
  revoke(
    @Req() req: Request,
    @Param('consentId', ID) id: string,
    @Body(new ZodPipe(SC.revoke)) b: { reason: string },
  ) {
    return this.altData.revoke(actor(req), id, b);
  }

  @LendingAction('alt_data.record')
  @Post('customers/:borrowerId/alternative-data')
  record(
    @Req() req: Request,
    @Param('borrowerId', ID) id: string,
    @Body(new ZodPipe(SC.record)) b: never,
  ) {
    return this.altData.record(actor(req), id, b);
  }

  @LendingAction('alt_data.verify')
  @Post('alternative-data/:recordId/decision')
  decide(
    @Req() req: Request,
    @Param('recordId', ID) id: string,
    @Body(new ZodPipe(SC.decision)) b: { approve: boolean; reason?: string },
  ) {
    return this.altData.decide(actor(req), id, b);
  }

  @LendingAction('alt_data.provider.read')
  @Get('alternative-data-providers')
  listProviders(@Req() req: Request) {
    return this.providers.list(actor(req));
  }

  @LendingAction('alt_data.provider.manage')
  @Post('alternative-data-providers')
  configure(@Req() req: Request, @Body(new ZodPipe(SC.provider)) b: never) {
    return this.providers.configure(actor(req), b);
  }

  @LendingAction('alt_data.provider.approve')
  @Post('alternative-data-providers/:configId/decision')
  decideProvider(
    @Req() req: Request,
    @Param('configId', ID) id: string,
    @Body(new ZodPipe(SC.providerDecision))
    b: { approve: boolean; comment?: string },
  ) {
    return this.providers.decide(actor(req), id, b);
  }
}
