import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { S, ZodPipe } from '../common/zod.pipe';
import { IncomeContingentService } from './income-contingent.service';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);

/**
 * Income-contingent education loans: the plan, a preview of what an income
 * would make the instalment, and income reassessment under maker-checker.
 */
@Controller('lending')
export class IncomeContingentController {
  constructor(private readonly svc: IncomeContingentService) {}

  @LendingAction('income_contingent.read')
  @Get('income-contingent/reviews')
  reviews(@Req() req: Request) {
    return this.svc.reviews(actor(req));
  }

  @LendingAction('loan.read')
  @Get('loans/:loanId/income-contingent')
  plan(@Req() req: Request, @Param('loanId', ID) loanId: string) {
    return this.svc.plan(actor(req), loanId);
  }

  @LendingAction('loan.read')
  @Get('loans/:loanId/income-contingent/preview')
  preview(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Query('income') income: string,
  ) {
    return this.svc.preview(actor(req), loanId, income);
  }

  @LendingAction('loan.income_assessment.propose')
  @Post('loans/:loanId/income-assessments')
  propose(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Body(new ZodPipe(S.incomeAssessment)) b: never,
  ) {
    return this.svc.propose(actor(req), loanId, b);
  }

  @LendingAction('loan.income_assessment.approve')
  @Post('loans/:loanId/income-assessments/:assessmentId/decision')
  decide(
    @Req() req: Request,
    @Param('loanId', ID) loanId: string,
    @Param('assessmentId', ID) assessmentId: string,
    @Body(new ZodPipe(S.assessmentDecision))
    b: { approve: boolean; comment?: string },
  ) {
    return this.svc.decide(actor(req), loanId, assessmentId, b);
  }
}
