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
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  LendingAction,
  ServiceAccountRoute,
  lendingActorOf,
} from './policy/lending-action.guard';
import { ZodPipe, S } from './common/zod.pipe';
import { ProductsService } from './products/products.service';
import { WorkflowsService } from './products/workflows.service';
import { LendingPoliciesService } from './products/lending-policies.service';
import { ApplicationsService } from './origination/applications.service';
import { GroupsService } from './origination/groups.service';
import { ServicingService } from './servicing/servicing.service';
import { SuspenseService } from './payments/suspense.service';
import { RateResetService } from './servicing/rate-reset.service';
import { PaymentHolidayService } from './restructuring/payment-holiday.service';
import { AccessAdminService } from './access/access-admin.service';
import { LendingOperationsService } from './accounting/operations.service';
import { PolicyService } from './policy/policy.service';
import type { ResourceType } from './policy/actions';

type Req_ = Request & { user?: unknown; serviceActor?: never };
const actor = (req: Req_) => lendingActorOf(req as never);
const ID = new ParseUUIDPipe();

/**
 * Every route declares its lending action. The route guard only checks that
 * the caller holds the permission somewhere; the service then makes the full
 * decision on the specific resource inside its transaction.
 */

@Controller('lending')
export class LendingProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly workflows: WorkflowsService,
    private readonly policies: LendingPoliciesService,
  ) {}

  // ── Policy library (POLICY_MODEL.md) ──────────────────────────────────────

  @LendingAction('lending_policy.read')
  @Get('policies')
  listPolicies(@Req() req: Req_, @Query('kind') kind?: string) {
    return this.policies.list(actor(req), kind);
  }

  @LendingAction('lending_policy.read')
  @Get('policies/:id')
  getPolicy(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.policies.get(actor(req), id);
  }

  @LendingAction('lending_policy.create')
  @Post('policies')
  createPolicy(
    @Req() req: Req_,
    @Body(new ZodPipe(S.createPolicy)) body: never,
  ) {
    return this.policies.create(actor(req), body);
  }

  @LendingAction('lending_policy.create')
  @Post('policies/:id/versions')
  addPolicyVersion(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.policyVersion)) body: never,
  ) {
    return this.policies.addVersion(actor(req), id, body);
  }

  @LendingAction('lending_policy.submit')
  @Post('policy-versions/:id/submit')
  submitPolicy(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.policies.transition(actor(req), id, 'submit');
  }

  @LendingAction('lending_policy.approve')
  @Post('policy-versions/:id/approve')
  approvePolicy(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.policies.transition(actor(req), id, 'approve');
  }

  @LendingAction('lending_policy.reject')
  @Post('policy-versions/:id/reject')
  rejectPolicy(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.reason)) body: { reason?: string },
  ) {
    return this.policies.transition(actor(req), id, 'reject', body.reason);
  }

  @LendingAction('lending_policy.retire')
  @Post('policy-versions/:id/retire')
  retirePolicy(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.policies.transition(actor(req), id, 'retire');
  }

  @LendingAction('loan_product.read')
  @Get('catalogue')
  catalogue(@Req() req: Req_) {
    return this.products.catalogue(actor(req));
  }

  @LendingAction('loan_product.read')
  @Get('capability-matrix')
  matrix(@Req() req: Req_) {
    return this.products.capabilityMatrix(actor(req));
  }

  @LendingAction('loan_product.read')
  @Get('templates/:code')
  template(@Param('code') code: string) {
    return this.products.template(code);
  }

  @LendingAction('loan_product.read')
  @Get('products')
  list(@Req() req: Req_) {
    return this.products.list(actor(req));
  }

  @LendingAction('loan_product.create')
  @Post('products')
  create(
    @Req() req: Req_,
    @Body(new ZodPipe(S.createProduct))
    body: {
      templateCode: string;
      code: string;
      name: string;
      config?: unknown;
    },
  ) {
    return this.products.create(actor(req), body);
  }

  @LendingAction('loan_product.create')
  @Post('products/:id/versions')
  newVersion(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.products.newVersion(actor(req), id);
  }

  @LendingAction('loan_product.read')
  @Get('product-versions/:id')
  version(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.products.getVersion(actor(req), id);
  }

  @LendingAction('loan_product.update')
  @Put('product-versions/:id')
  update(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.updateDraft))
    body: { config: unknown; changeSummary?: string },
  ) {
    return this.products.updateDraft(actor(req), id, body);
  }

  @LendingAction('loan_product.submit')
  @Post('product-versions/:id/submit')
  submit(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.products.transition(actor(req), id, 'submit');
  }

  @LendingAction('loan_product.approve')
  @Post('product-versions/:id/approve')
  approve(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.products.transition(actor(req), id, 'approve');
  }

  @LendingAction('loan_product.reject')
  @Post('product-versions/:id/reject')
  reject(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.reason)) body: { reason?: string },
  ) {
    return this.products.transition(actor(req), id, 'reject', body.reason);
  }

  @LendingAction('loan_product.activate')
  @Post('product-versions/:id/activate')
  activate(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.products.transition(actor(req), id, 'activate');
  }

  @LendingAction('loan_product.retire')
  @Post('product-versions/:id/retire')
  retire(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.products.transition(actor(req), id, 'retire');
  }

  @LendingAction('loan_product.read')
  @Post('product-versions/:id/simulate')
  simulate(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.simulate)) body: never,
  ) {
    return this.products.simulate(actor(req), id, body);
  }

  @LendingAction('loan_product.read')
  @Get('workflows')
  workflowsList(@Req() req: Req_) {
    return this.workflows.list(actor(req));
  }

  @LendingAction('workflow.manage')
  @Post('workflows')
  workflowDraft(
    @Req() req: Req_,
    @Body(new ZodPipe(S.workflow))
    body: { code: string; name: string; definition: unknown },
  ) {
    return this.workflows.draft(actor(req), body);
  }

  @LendingAction('workflow.approve')
  @Post('workflows/:id/decision')
  workflowDecide(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean },
  ) {
    return this.workflows.decide(actor(req), id, body.approve);
  }
}

@Controller('lending/applications')
export class LendingApplicationsController {
  constructor(
    private readonly apps: ApplicationsService,
    private readonly groups: GroupsService,
  ) {}

  // ── Solidarity groups ─────────────────────────────────────────────────────

  @LendingAction('borrower_group.read')
  @Get('groups')
  listGroups(
    @Req() req: Req_,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.groups.list(actor(req), {
      status,
      search,
      page: page ? Number(page) : 1,
    });
  }

  @LendingAction('borrower_group.manage')
  @Post('groups')
  createGroup(@Req() req: Req_, @Body(new ZodPipe(S.createGroup)) b: never) {
    return this.groups.create(actor(req), b);
  }

  @LendingAction('borrower_group.read')
  @Get('groups/:id')
  getGroup(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.groups.get(actor(req), id);
  }

  @LendingAction('borrower_group.manage')
  @Post('groups/:id/members')
  addGroupMember(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.addGroupMember)) b: never,
  ) {
    return this.groups.addMember(actor(req), id, b);
  }

  @LendingAction('borrower_group.manage')
  @Post('groups/:id/members/:borrowerId/remove')
  removeGroupMember(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('borrowerId', ID) borrowerId: string,
    @Body(new ZodPipe(S.removeGroupMember)) b: { reason: string },
  ) {
    return this.groups.removeMember(actor(req), id, borrowerId, b);
  }

  @LendingAction('borrower_group.manage')
  @Post('groups/:id/status')
  setGroupStatus(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.groupStatus)) b: never,
  ) {
    return this.groups.changeStatus(actor(req), id, b);
  }

  @LendingAction('loan_application.read')
  @Get()
  list(
    @Req() req: Req_,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.apps.list(actor(req), {
      status,
      search,
      page: page ? Number(page) : 1,
    });
  }

  @LendingAction('loan_application.create')
  @Post()
  create(
    @Req() req: Req_,
    @Body(new ZodPipe(S.createApplication)) body: never,
  ) {
    return this.apps.create(actor(req), body);
  }

  @LendingAction('loan_application.read')
  @Get(':id')
  get(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.apps.get(actor(req), id);
  }

  @LendingAction('loan_application.update')
  @Put(':id/terms')
  terms(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.updateTerms)) body: never,
  ) {
    return this.apps.updateTerms(actor(req), id, body);
  }

  @LendingAction('loan_application.submit')
  @Post(':id/submit')
  submit(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.apps.submit(actor(req), id);
  }

  @LendingAction('loan_application.update')
  @Post(':id/documents')
  document(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.document)) body: never,
  ) {
    return this.apps.uploadDocument(actor(req), id, body);
  }

  @LendingAction('collateral.manage')
  @Post(':id/collateral')
  collateral(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.collateral)) body: never,
  ) {
    return this.apps.addCollateral(actor(req), id, body);
  }

  @LendingAction('collateral.manage')
  @Post(':id/guarantees')
  guarantee(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.guarantee)) body: never,
  ) {
    return this.apps.addGuarantee(actor(req), id, body);
  }

  @LendingAction('loan_application.read')
  @Post(':id/conditions/:code')
  condition(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('code') code: string,
    @Body(new ZodPipe(S.condition)) body: never,
  ) {
    return this.apps.resolveCondition(actor(req), id, code, body);
  }

  @LendingAction('loan_application.read')
  @Post(':id/simulate')
  simulate(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.apps.simulate(actor(req), id);
  }

  @LendingAction('credit_decision.recommend')
  @Post(':id/recommend')
  recommend(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.recommend)) body: never,
  ) {
    return this.apps.recommend(actor(req), id, body);
  }

  @LendingAction('credit_decision.approve')
  @Post(':id/approve')
  approve(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.rationale)) body: never,
  ) {
    return this.apps.approve(actor(req), id, body);
  }

  @LendingAction('credit_decision.reject')
  @Post(':id/reject')
  reject(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.rationale)) body: never,
  ) {
    return this.apps.reject(actor(req), id, body);
  }

  @LendingAction('loan.agreement.book')
  @Post(':id/book')
  book(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.book)) body: never,
  ) {
    return this.apps.book(actor(req), id, body);
  }
}

@Controller('lending/loans')
export class LendingLoansController {
  constructor(
    private readonly servicing: ServicingService,
    private readonly rateResets: RateResetService,
    private readonly groups: GroupsService,
    private readonly holidays: PaymentHolidayService,
  ) {}

  /** Reset history, the full reset cycle, and what is currently due. */
  /** Who is bound to this loan, what each agreed to carry, and who has paid. */
  @LendingAction('loan.read')
  @Get(':id/group-members')
  groupMembers(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.groups.loanMembers(actor(req), id);
  }

  @LendingAction('loan.read')
  @Get(':id/rate-resets')
  rateResets_(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.rateResets.history(actor(req), id);
  }

  /** Apply every reset that has fallen due, oldest first. */
  @LendingAction('loan.rate_reset.apply')
  @Post(':id/rate-resets')
  applyRateResets(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.rateResets.applyDue(actor(req), id);
  }

  @LendingAction('loan.read')
  @Get()
  list(
    @Req() req: Req_,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.servicing.list(actor(req), {
      status,
      search,
      page: page ? Number(page) : 1,
    });
  }

  @LendingAction('loan_data.export')
  @Get('export.csv')
  async export(@Req() req: Req_, @Res() res: Response) {
    const csv = await this.servicing.exportLoanBook(actor(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="loan-book.csv"',
    );
    res.send(csv);
  }

  @LendingAction('servicing.batch.run')
  @Post('batch/run')
  batch(@Req() req: Req_) {
    return this.servicing.runBatch(actor(req));
  }

  @LendingAction('loan.read')
  @Get(':id')
  get(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.servicing.get(actor(req), id);
  }

  @LendingAction('loan.read')
  @Get(':id/settlement-quote')
  quote(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.servicing.settlementQuote(actor(req), id, asOf);
  }

  @LendingAction('loan.disbursement.prepare')
  @Post(':id/disbursements')
  prepare(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.prepareDisbursement)) body: never,
  ) {
    return this.servicing.prepareDisbursement(actor(req), id, body);
  }

  @LendingAction('loan.disbursement.approve')
  @Post(':id/disbursements/:taskId/decision')
  approveDisbursement(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(S.approve)) body: never,
  ) {
    return this.servicing.approveDisbursement(actor(req), id, taskId, body);
  }

  @LendingAction('loan.disbursement.execute')
  @Post(':id/disbursements/execute')
  execute(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.executeDisbursement)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.executeDisbursement(actor(req), id, body, key);
  }

  @LendingAction('loan.repayment.post')
  @Post(':id/repayments')
  repay(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.repayment)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.postRepayment(actor(req), id, body, key);
  }

  /** Holidays granted on this loan. */
  @LendingAction('loan.read')
  @Get(':id/payment-holidays')
  holidayHistory(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.holidays.history(actor(req), id);
  }

  /** Whether this loan qualifies under a programme, and what it would cost. */
  @LendingAction('loan.read')
  @Get(':id/payment-holidays/:programmeId/eligibility')
  holidayEligibility(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('programmeId', ID) programmeId: string,
  ) {
    return this.holidays.checkEligibility(actor(req), programmeId, id);
  }

  @LendingAction('payment_holiday.grant')
  @Post(':id/payment-holidays/:programmeId')
  grantHoliday(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('programmeId', ID) programmeId: string,
    @Body(new ZodPipe(S.holidayEnrol)) body: never,
  ) {
    return this.holidays.enrol(actor(req), programmeId, id, body);
  }

  /** What a settlement at this amount gives up. Nothing is posted. */
  @LendingAction('loan.read')
  @Get(':id/negotiated-settlement-quote')
  negotiatedQuote(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Query('agreedAmount') agreedAmount: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.servicing.negotiatedSettlementQuote(actor(req), id, {
      agreedAmount,
      asOf,
    });
  }

  @LendingAction('loan.settlement.negotiate')
  @Post(':id/negotiated-settlement')
  negotiatedSettlement(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.negotiatedSettlement)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.negotiatedSettlement(actor(req), id, body, key);
  }

  @LendingAction('loan.recovery.post')
  @Post(':id/recoveries')
  recovery(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.recovery)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.recordRecovery(actor(req), id, body, key);
  }

  @LendingAction('loan.repayment.post')
  @Post(':id/settlement')
  settle(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.settlement)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.settle(actor(req), id, body, key);
  }

  @LendingAction('loan.repayment.reverse')
  @Post(':id/events/:eventId/reverse')
  reverse(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('eventId', ID) eventId: string,
    @Body(new ZodPipe(S.reversal)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.reverse(actor(req), id, eventId, body, key);
  }

  @LendingAction('loan.writeoff.propose')
  @Post(':id/write-offs')
  proposeWriteOff(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.writeOff)) body: never,
  ) {
    return this.servicing.proposeWriteOff(actor(req), id, body);
  }

  @LendingAction('loan.advance_refund.propose')
  @Post(':id/advance-refunds')
  proposeAdvanceRefund(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.refundProposal)) body: never,
  ) {
    return this.servicing.proposeAdvanceRefund(actor(req), id, body);
  }

  @LendingAction('loan.advance_refund.approve')
  @Post(':id/advance-refunds/:taskId/decision')
  decideAdvanceRefund(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(S.approve)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.decideAdvanceRefund(
      actor(req),
      id,
      taskId,
      body,
      key,
    );
  }

  @LendingAction('loan.writeoff.approve')
  @Post(':id/write-offs/:taskId/decision')
  decideWriteOff(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(S.approve)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.decideWriteOff(actor(req), id, taskId, body, key);
  }
}

/** Unidentified payments: held in suspense, matched to loans or refunded (UC-28, UC-74). */
@Controller('lending/suspense')
export class LendingSuspenseController {
  constructor(private readonly suspense: SuspenseService) {}

  @LendingAction('payment.suspense.read')
  @Get()
  list(@Req() req: Req_, @Query('status') status?: string) {
    return this.suspense.list(actor(req), status);
  }

  @LendingAction('payment.suspense.receive')
  @Post()
  receive(
    @Req() req: Req_,
    @Body(new ZodPipe(S.suspenseReceive)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.suspense.receive(actor(req), body, key);
  }

  @LendingAction('payment.suspense.receive')
  @Post(':id/matches')
  match(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.suspenseMatch)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.suspense.match(actor(req), id, body, key);
  }

  @LendingAction('payment.refund.propose')
  @Post(':id/refunds')
  proposeRefund(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.refundProposal)) body: never,
  ) {
    return this.suspense.proposeRefund(actor(req), id, body);
  }

  @LendingAction('payment.refund.approve')
  @Post(':id/refunds/:taskId/decision')
  decideRefund(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(S.approve)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.suspense.decideRefund(actor(req), id, taskId, body, key);
  }
}

/** Integration endpoints authenticated by a tenant-bound, narrowly scoped service-account key. */
@Controller('lending/integrations')
export class LendingIntegrationsController {
  constructor(private readonly servicing: ServicingService) {}

  @ServiceAccountRoute('loan.repayment.post')
  @Post('loans/:id/repayments')
  repay(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.repayment)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.postRepayment(actor(req), id, body, key);
  }
}

@Controller('lending/access')
export class LendingAccessController {
  constructor(
    private readonly access: AccessAdminService,
    private readonly policy: PolicyService,
  ) {}

  @LendingAction('access_policy.read')
  @Get()
  overview(@Req() req: Req_) {
    return this.access.overview(actor(req));
  }

  @LendingAction('access_policy.manage')
  @Post('roles')
  role(@Req() req: Req_, @Body(new ZodPipe(S.role)) body: never) {
    return this.access.createRole(actor(req), body);
  }

  @LendingAction('access_policy.manage')
  @Post('assignments')
  assign(@Req() req: Req_, @Body(new ZodPipe(S.assignment)) body: never) {
    return this.access.requestAssignment(actor(req), body);
  }

  @LendingAction('access_policy.approve')
  @Post('assignments/:id/decision')
  decideAssignment(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean },
  ) {
    return this.access.decideAssignment(actor(req), id, body.approve);
  }

  @LendingAction('access_policy.manage')
  @Post('assignments/:id/revoke')
  revoke(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.revoke)) body: { reason: string },
  ) {
    return this.access.revokeAssignment(actor(req), id, body.reason);
  }

  @LendingAction('loan.read')
  @Post('delegations')
  delegate(@Req() req: Req_, @Body(new ZodPipe(S.delegation)) body: never) {
    return this.access.requestDelegation(actor(req), body);
  }

  @LendingAction('access_policy.approve')
  @Post('delegations/:id/decision')
  decideDelegation(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean },
  ) {
    return this.access.decideDelegation(actor(req), id, body.approve);
  }

  @LendingAction('loan.read')
  @Post('delegations/:id/revoke')
  revokeDelegation(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.access.revokeDelegation(actor(req), id);
  }

  @LendingAction('access_policy.manage')
  @Post('authorities')
  authority(@Req() req: Req_, @Body(new ZodPipe(S.authority)) body: never) {
    return this.access.requestAuthority(actor(req), body);
  }

  @LendingAction('access_policy.approve')
  @Post('authorities/:id/decision')
  decideAuthority(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean },
  ) {
    return this.access.decideAuthority(actor(req), id, body.approve);
  }

  @LendingAction('access_policy.manage')
  @Post('policies')
  policyDraft(@Req() req: Req_, @Body(new ZodPipe(S.policy)) body: never) {
    return this.access.draftPolicy(actor(req), body);
  }

  @LendingAction('access_policy.approve')
  @Post('policies/:versionId/decision')
  policyDecide(
    @Req() req: Req_,
    @Param('versionId', ID) id: string,
    @Body(new ZodPipe(S.policyDecision))
    body: { approve: boolean; reason?: string },
  ) {
    return this.access.decidePolicy(actor(req), id, body.approve, body.reason);
  }

  @LendingAction('feature_flag.read')
  @Get('flags')
  flags(@Req() req: Req_, @Query() q: Record<string, string>) {
    return this.access.flags(actor(req), {
      productCode: q.productCode,
      branchId: q.branchId,
      channel: q.channel,
      segment: q.segment,
      cohort: q.cohort,
    });
  }

  @LendingAction('feature_flag.manage')
  @Post('flags/rules')
  flagRule(@Req() req: Req_, @Body(new ZodPipe(S.flagRule)) body: never) {
    return this.access.proposeFlagRule(actor(req), body);
  }

  @LendingAction('feature_flag.manage')
  @Post('flags/rules/:id/remove')
  flagRuleRemove(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.revoke)) body: { reason: string },
  ) {
    return this.access.proposeFlagRuleRemoval(actor(req), id, body.reason);
  }

  @LendingAction('feature_flag.approve')
  @Post('flags/changes/:id/decision')
  flagDecide(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean },
  ) {
    return this.access.decideFlagChange(actor(req), id, body.approve);
  }

  @LendingAction('feature_flag.approve')
  @Post('cohorts')
  cohort(@Req() req: Req_, @Body(new ZodPipe(S.cohort)) body: never) {
    return this.access.setCohortMembership(actor(req), body);
  }

  @LendingAction('access_policy.read')
  @Get('service-accounts')
  serviceAccounts(@Req() req: Req_) {
    return this.access.listServiceAccounts(actor(req));
  }

  @LendingAction('access_policy.approve')
  @Post('service-accounts')
  createServiceAccount(
    @Req() req: Req_,
    @Body(new ZodPipe(S.serviceAccount)) body: never,
  ) {
    return this.access.createServiceAccount(actor(req), body);
  }

  @LendingAction('access_policy.manage')
  @Post('service-accounts/:id/disable')
  disableServiceAccount(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.access.disableServiceAccount(actor(req), id);
  }

  @LendingAction('policy.simulate')
  @Post('simulate')
  simulate(@Req() req: Req_, @Body(new ZodPipe(S.simulatePolicy)) body: never) {
    return this.access.simulate(actor(req), body);
  }

  /** Permitted actions for the current user on one resource. Server enforcement remains authoritative. */
  @LendingAction('loan.read')
  @Get('capabilities/:resourceType/:id')
  async capabilities(
    @Req() req: Req_,
    @Param('resourceType') type: string,
    @Param('id', ID) id: string,
  ) {
    const a = actor(req);
    const resourceTypes: Record<string, ResourceType> = {
      APPLICATION: 'APPLICATION',
      LOAN_ACCOUNT: 'LOAN_ACCOUNT',
      PRODUCT_VERSION: 'PRODUCT_VERSION',
    };
    const rt = resourceTypes[type];
    if (!rt || !a.tenantId) return {};
    const resource = await this.access.loadResource(
      a.tenantId,
      rt,
      id,
      'loan.read',
    );
    return this.policy.capabilities(a, rt, resource);
  }
}

@Controller('lending/ops')
export class LendingOperationsController {
  constructor(
    private readonly ops: LendingOperationsService,
    private readonly servicing: ServicingService,
    private readonly holidays: PaymentHolidayService,
  ) {}

  @LendingAction('loan.read')
  @Get('business-date')
  businessDate(@Req() req: Req_) {
    return this.ops.getBusinessDate(actor(req));
  }

  @LendingAction('business_date.manage')
  @Post('business-date')
  advance(
    @Req() req: Req_,
    @Body(new ZodPipe(S.businessDate)) body: { businessDate: string },
  ) {
    return this.ops.advanceBusinessDate(actor(req), body.businessDate);
  }

  @LendingAction('loan_product.read')
  @Get('calendars')
  calendars(@Req() req: Req_) {
    return this.ops.calendars(actor(req));
  }

  @LendingAction('business_date.manage')
  @Post('calendars')
  calendar(@Req() req: Req_, @Body(new ZodPipe(S.calendar)) body: never) {
    return this.ops.upsertCalendar(actor(req), body);
  }

  @LendingAction('loan_product.read')
  @Get('rates')
  rates(@Req() req: Req_, @Query('benchmarkCode') code?: string) {
    return this.ops.rates(actor(req), code);
  }

  @LendingAction('payment_holiday.read')
  @Get('payment-holiday-programmes')
  holidayProgrammes(@Req() req: Req_, @Query('status') status?: string) {
    return this.holidays.listProgrammes(actor(req), { status });
  }

  @LendingAction('payment_holiday.manage')
  @Post('payment-holiday-programmes')
  createHolidayProgramme(
    @Req() req: Req_,
    @Body(new ZodPipe(S.holidayProgramme)) body: never,
  ) {
    return this.holidays.createProgramme(actor(req), body);
  }

  @LendingAction('payment_holiday.approve')
  @Post('payment-holiday-programmes/:id/status')
  setHolidayProgrammeStatus(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.holidayStatus)) body: never,
  ) {
    return this.holidays.setProgrammeStatus(actor(req), id, body);
  }

  @LendingAction('rate_observation.manage')
  @Post('rates')
  rate(@Req() req: Req_, @Body(new ZodPipe(S.rate)) body: never) {
    return this.ops.recordRate(actor(req), body);
  }

  @LendingAction('accounting.read')
  @Get('journal')
  journal(@Req() req: Req_, @Query() q: Record<string, string>) {
    return this.ops.journal(actor(req), {
      loanAccountId: q.loanAccountId,
      from: q.from,
      to: q.to,
      page: q.page ? Number(q.page) : 1,
    });
  }

  @LendingAction('accounting.read')
  @Get('trial-balance')
  trialBalance(@Req() req: Req_) {
    return this.ops.trialBalance(actor(req));
  }

  @LendingAction('accounting.read')
  @Get('reconciliation')
  reconciliation(@Req() req: Req_) {
    return this.ops.reconciliation(actor(req));
  }

  @LendingAction('audit.read')
  @Get('audit')
  audit(@Req() req: Req_, @Query() q: Record<string, string>) {
    return this.ops.auditEvents(actor(req), {
      resourceType: q.resourceType,
      resourceId: q.resourceId,
      action: q.action,
      outcome: q.outcome,
      page: q.page ? Number(q.page) : 1,
    });
  }

  @LendingAction('loan_product.read')
  @Get('integrations')
  integrations() {
    return this.ops.integrations();
  }
}
