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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { BorrowerRoute } from '../../auth/auth-scope.decorator';
import { BorrowerJwtGuard } from '../../borrower-portal/borrower-jwt.guard';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { RestructuringService } from './restructuring.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rate = z.string().regex(/^\d+(\.\d+)?$/);

const requestSchema = z
  .object({
    trigger: z
      .enum(['STAFF_ON_CUSTOMER_REQUEST', 'COLLECTIONS', 'CREDIT_REVIEW'])
      .optional(),
    hardshipCategory: z.enum([
      'ILLNESS',
      'JOB_LOSS',
      'INCOME_REDUCTION',
      'BUSINESS_DOWNTURN',
      'DELAYED_HARVEST',
      'DISASTER',
      'FAMILY_EVENT',
      'ARREARS',
      'OTHER',
    ]),
    difficultyType: z.enum(['TEMPORARY', 'PERSISTENT']),
    customerStatement: z.string().max(2000).optional(),
    requestedRelief: z
      .object({
        lowerInstalment: money.optional(),
        longerTermMonths: z.number().int().min(1).max(600).optional(),
        paymentBreakMonths: z.number().int().min(1).max(24).optional(),
        note: z.string().max(500).optional(),
      })
      .strict(),
    consentRecorded: z.boolean().optional(),
    consentReference: z.string().max(120).optional(),
    expectedRecoveryDate: date.optional(),
  })
  .strict();

const debts = z
  .array(
    z
      .object({
        description: z.string().max(120),
        monthlyPayment: money,
        isThisLoan: z.boolean().optional(),
      })
      .strict(),
  )
  .max(30);
const inputsSchema = z.discriminatedUnion('template', [
  z
    .object({
      template: z.literal('INDIVIDUAL'),
      verifiedNetIncome: money,
      essentialLivingExpenses: money,
      debts,
    })
    .strict(),
  z
    .object({
      template: z.literal('HOUSEHOLD'),
      members: z
        .array(
          z
            .object({ name: z.string().max(80), verifiedNetIncome: money })
            .strict(),
        )
        .min(1)
        .max(12),
      essentialLivingExpenses: money,
      debts,
    })
    .strict(),
  z
    .object({
      template: z.literal('BUSINESS'),
      operatingCashInflows: money,
      operatingCashOutflows: money,
      taxes: money,
      essentialCapitalExpenditure: money,
      requiredWorkingCapitalIncrease: money,
      debts,
    })
    .strict(),
  z
    .object({
      template: z.literal('SEASONAL'),
      forecast: z
        .array(
          z.object({ month: date, inflows: money, outflows: money }).strict(),
        )
        .min(1)
        .max(24),
      debts,
    })
    .strict(),
]);
const assessSchema = z
  .object({
    inputs: inputsSchema,
    evidenceQuality: z.enum([
      'VERIFIED',
      'PARTIALLY_VERIFIED',
      'SELF_DECLARED',
    ]),
    assumptions: z.string().min(3).max(1000),
    verificationDate: date,
    comments: z.string().max(1000).optional(),
  })
  .strict();
const optionsSchema = z
  .object({
    effectiveDate: date,
    numberOfInstalments: z.number().int().min(1).max(1200).optional(),
    targetInstalment: money.optional(),
    annualRate: rate.optional(),
    temporaryRate: z
      .object({
        annualRate: rate,
        instalments: z.number().int().min(1).max(120),
      })
      .strict()
      .optional(),
    interestOnlyInstalments: z.number().int().min(1).max(60).optional(),
    paymentDeferralInstalments: z.number().int().min(1).max(24).optional(),
    deferredInterestTreatment: z
      .enum([
        'PAY_SEPARATELY',
        'DEFER_NO_CAPITALIZATION',
        'CAPITALIZE',
        'WAIVE',
      ])
      .optional(),
    capitalize: z
      .object({
        overdueInterest: z.boolean().optional(),
        accruedInterest: z.boolean().optional(),
        fees: z.boolean().optional(),
        penalties: z.boolean().optional(),
      })
      .strict()
      .optional(),
    arrearsTreatment: z
      .enum(['PAY_AT_EFFECTIVE_DATE', 'SPREAD_OVER_TERM'])
      .optional(),
    waive: z
      .object({
        interest: money.optional(),
        fees: money.optional(),
        penalties: money.optional(),
      })
      .strict()
      .optional(),
    principalForgiveness: money.optional(),
    principalPaymentAtRestructure: money.optional(),
    method: z
      .enum(['EQUAL_INSTALMENT', 'EQUAL_PRINCIPAL', 'BALLOON'])
      .optional(),
    frequency: z
      .enum([
        'WEEKLY',
        'FORTNIGHTLY',
        'MONTHLY',
        'QUARTERLY',
        'SEMI_ANNUAL',
        'ANNUAL',
      ])
      .optional(),
    balloonAmount: money.optional(),
    firstDueDate: date.optional(),
    explicitSchedule: z
      .array(z.object({ dueDate: date, principal: money }).strict())
      .max(60)
      .optional(),
  })
  .strict();
const proposeSchema = z
  .object({
    options: optionsSchema,
    conditions: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
            label: z.string().max(160),
          })
          .strict(),
      )
      .max(10)
      .optional(),
  })
  .strict();
const note = z.object({ note: z.string().min(3).max(500) }).strict();
const acceptSchema = z
  .object({
    proposalHash: z.string().length(64),
    method: z.enum(['SIGNED_FORM', 'WITNESSED_VERBAL']).optional(),
    evidence: z.string().max(500).optional(),
  })
  .strict();
const evidenceSchema = z
  .object({
    type: z.enum([
      'INCOME',
      'EXPENSES',
      'DEBTS',
      'BUSINESS_CASHFLOW',
      'HARVEST_FORECAST',
      'MEDICAL',
      'EMPLOYMENT',
      'OTHER',
    ]),
    description: z.string().min(3).max(500),
    quality: z.enum(['VERIFIED', 'PARTIALLY_VERIFIED', 'SELF_DECLARED']),
    documentRef: z.string().max(200).optional(),
  })
  .strict();

const fraction = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/);
/** Only the known affordability settings, each typed, may be proposed. */
const affordabilityPolicySchema = z
  .object({
    bufferFractionOfIncome: fraction.optional(),
    bufferMinimum: z
      .record(z.string().regex(/^[A-Z]{3}$/), z.string().regex(/^\d+(\.\d+)?$/))
      .optional(),
    minDscr: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,4})?$/)
      .optional(),
    seasonalBufferFraction: fraction.optional(),
    evidenceMaxAgeDays: z.number().int().min(1).max(3650).optional(),
    requireVerifiedEvidence: z.boolean().optional(),
    referralDpd: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

@Controller('lending/restructures')
export class RestructuringController {
  constructor(private readonly svc: RestructuringService) {}

  @LendingAction('restructure.read')
  @Get()
  list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('loanAccountId') loanAccountId?: string,
  ) {
    return this.svc.list(actor(req), { status, loanAccountId });
  }

  @LendingAction('restructure.monitor')
  @Get('tasks')
  tasks(@Req() req: Request, @Query('status') status?: string) {
    return this.svc.tasks(actor(req), { status });
  }

  @LendingAction('restructure.monitor')
  @Post('tasks/:id/close')
  closeTask(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(note)) b: { note: string },
  ) {
    return this.svc.closeTask(actor(req), id, b.note);
  }

  @LendingAction('restructure.request')
  @Post('loans/:loanId')
  request(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Body(new ZodPipe(requestSchema)) b: never,
  ) {
    return this.svc.request(actor(req), loanId, b);
  }

  @LendingAction('restructure.read')
  @Get(':id')
  get(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.get(actor(req), id);
  }

  @LendingAction('restructure.assess')
  @Post(':id/evidence')
  evidence(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(evidenceSchema)) b: never,
  ) {
    return this.svc.addEvidence(actor(req), id, b);
  }

  @LendingAction('restructure.assess')
  @Post(':id/more-info')
  moreInfo(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(note)) b: { note: string },
  ) {
    return this.svc.requestMoreInfo(actor(req), id, b.note);
  }

  @LendingAction('restructure.assess')
  @Post(':id/assessments')
  assess(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(assessSchema)) b: never,
  ) {
    return this.svc.assess(actor(req), id, b);
  }

  @LendingAction('restructure.simulate')
  @Post(':id/simulate')
  simulate(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(optionsSchema)) b: never,
  ) {
    return this.svc.simulate(actor(req), id, b);
  }

  @LendingAction('restructure.propose')
  @Post(':id/proposals')
  propose(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(proposeSchema)) b: never,
  ) {
    return this.svc.propose(actor(req), id, b);
  }

  @LendingAction('restructure.approve')
  @Post(':id/proposals/:proposalId/approve')
  approve(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('proposalId', ID) pid: string,
    @Body(new ZodPipe(note)) b: { note: string },
  ) {
    return this.svc.approve(actor(req), id, pid, b.note);
  }

  @LendingAction('restructure.approve')
  @Post(':id/reject')
  reject(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(note)) b: { note: string },
  ) {
    return this.svc.reject(actor(req), id, b.note);
  }

  @LendingAction('restructure.record_acceptance')
  @Post(':id/proposals/:proposalId/acceptance')
  accept(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('proposalId', ID) pid: string,
    @Body(new ZodPipe(acceptSchema)) b: never,
  ) {
    return this.svc.accept(actor(req), id, pid, b);
  }

  @LendingAction('restructure.execute')
  @Post(':id/conditions/:code')
  condition(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('code') code: string,
    @Body(new ZodPipe(note)) b: { note: string },
  ) {
    return this.svc.satisfyCondition(actor(req), id, code, b.note);
  }

  @LendingAction('restructure.execute')
  @Post(':id/execute')
  execute(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(
      new ZodPipe(
        z
          .object({ externalReference: z.string().max(120).optional() })
          .strict(),
      ),
    )
    b: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.execute(actor(req), id, b, key);
  }

  @LendingAction('restructure.execute')
  @Post(':id/reverse')
  reverse(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(note)) b: { note: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.svc.reverse(actor(req), id, b.note, key);
  }

  @LendingAction('restructure.request')
  @Post(':id/withdraw')
  withdraw(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(note)) b: { note: string },
  ) {
    return this.svc.withdraw(actor(req), id, b.note);
  }

  @LendingAction('access_policy.read')
  @Get('policy/current')
  async currentPolicy(@Req() req: Request) {
    const a = actor(req);
    return this.svc.policySettings(a.tenantId!);
  }

  @LendingAction('access_policy.manage')
  @Post('policy')
  proposePolicy(
    @Req() req: Request,
    @Body(new ZodPipe(affordabilityPolicySchema)) b: never,
  ) {
    return this.svc.proposePolicy(actor(req), b);
  }

  @LendingAction('access_policy.approve')
  @Post('policy/:id/decision')
  decidePolicy(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(z.object({ approve: z.boolean() }).strict()))
    b: { approve: boolean },
  ) {
    return this.svc.decidePolicy(actor(req), id, b.approve);
  }
}

/**
 * Customer self-service in the borrower portal. Customers may request a
 * review of their own loan, see the proposals offered to them, and accept
 * one. They cannot enter verified figures, approve or execute anything.
 */
@BorrowerRoute()
@UseGuards(BorrowerJwtGuard)
@Controller('lending/portal')
export class RestructuringPortalController {
  constructor(private readonly svc: RestructuringService) {}

  @LendingAction('restructure.request')
  @Post('loans/:loanId/restructure-requests')
  request(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Body(
      new ZodPipe(
        requestSchema.omit({
          trigger: true,
          consentRecorded: true,
          consentReference: true,
        }),
      ),
    )
    b: never,
  ) {
    return this.svc.request(actor(req), loanId, b);
  }

  @LendingAction('restructure.read_own')
  @Get('restructures')
  list(@Req() req: Request) {
    return this.svc.list(actor(req), {});
  }

  /** The borrower's own active loans, to pick one when asking for help. */
  @LendingAction('restructure.read_own')
  @Get('loans')
  myLoans(@Req() req: Request) {
    return this.svc.portalLoans(actor(req));
  }

  @LendingAction('restructure.read_own')
  @Get('restructures/:id')
  get(@Req() req: Request, @Param('id', ID) id: string) {
    return this.svc.get(actor(req), id);
  }

  @LendingAction('restructure.accept_own')
  @Post('restructures/:id/proposals/:proposalId/accept')
  accept(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Param('proposalId', ID) pid: string,
    @Body(
      new ZodPipe(z.object({ proposalHash: z.string().length(64) }).strict()),
    )
    b: { proposalHash: string },
  ) {
    return this.svc.accept(actor(req), id, pid, {
      proposalHash: b.proposalHash,
    });
  }
}
