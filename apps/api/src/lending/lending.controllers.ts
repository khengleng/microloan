import { AnyAuthenticated } from '../auth/auth-scope.decorator';
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
import { ReportingService } from './reporting/reporting.service';
import { PeriodCloseService } from './accounting/period-close.service';
import { LoanMigrationService } from './migration/loan-migration.service';
import { WebhooksService } from './integrations/webhooks.service';
import { CollectionsService } from './collections/collections.service';
import { CovenantsService } from './covenants/covenants.service';
import { CollateralService } from './collateral/collateral.service';
import { ImpairmentService } from './accounting/impairment.service';
import { LendingSettingsService } from './accounting/lending-settings.service';
import { RateResetService } from './servicing/rate-reset.service';
import { PaymentHolidayService } from './restructuring/payment-holiday.service';
import { AccessAdminService } from './access/access-admin.service';
import { LendingOperationsService } from './accounting/operations.service';
import { PolicyService } from './policy/policy.service';
import type { ResourceType } from './policy/actions';
import { GeneratedDocumentsService } from './documents/generated-documents.service';
import { RegulatoryReturnService } from './reporting/regulatory-return.service';

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
    private readonly generated: GeneratedDocumentsService,
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
  async book(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.book)) body: never,
  ) {
    const booked = await this.apps.book(actor(req), id, body);
    // DOC-9: the key facts statement is filed in the customer's library.
    await this.generated.fileKeyFacts(
      booked.account.tenantId,
      booked.account.id,
      actor(req).id,
    );
    return booked;
  }
}

@Controller('lending/loans')
export class LendingLoansController {
  constructor(
    private readonly servicing: ServicingService,
    private readonly rateResets: RateResetService,
    private readonly groups: GroupsService,
    private readonly holidays: PaymentHolidayService,
    private readonly collateral: CollateralService,
    private readonly reporting: ReportingService,
    private readonly collections: CollectionsService,
    private readonly generated: GeneratedDocumentsService,
    private readonly covenants: CovenantsService,
  ) {}

  /** Covenants on the loan and their tests (LT-16). */
  @LendingAction('loan.read')
  @Get(':id/covenants')
  covenantList(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.covenants.list(actor(req), id);
  }

  @LendingAction('loan.covenant.manage')
  @Post(':id/covenants')
  addCovenant(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.covenant)) body: never,
  ) {
    return this.covenants.add(actor(req), id, body);
  }

  @LendingAction('loan.covenant.manage')
  @Post(':id/covenants/:covenantId/tests')
  testCovenant(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('covenantId', ID) covenantId: string,
    @Body(new ZodPipe(S.covenantTest)) body: never,
  ) {
    return this.covenants.test(actor(req), id, covenantId, body);
  }

  @LendingAction('loan.covenant.waive')
  @Post(':id/covenants/:covenantId/waive')
  waiveCovenant(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('covenantId', ID) covenantId: string,
    @Body(new ZodPipe(S.covenantWaiver)) body: never,
  ) {
    return this.covenants.waive(actor(req), id, covenantId, body);
  }

  /** Guarantees on the loan and the demands made under them (UC-60). */
  @LendingAction('loan.read')
  @Get(':id/guarantor-demands')
  guarantorDemands(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.collections.demands(actor(req), id);
  }

  @LendingAction('loan.guarantor_demand.issue')
  @Post(':id/guarantor-demands')
  issueGuarantorDemand(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.guarantorDemand)) body: never,
  ) {
    return this.collections.issueDemand(actor(req), id, body);
  }

  @LendingAction('loan.repayment.post')
  @Post(':id/guarantor-demands/:demandId/payments')
  guarantorPayment(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('demandId', ID) demandId: string,
    @Body(new ZodPipe(S.guarantorPayment)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.collections.guarantorPayment(
      actor(req),
      id,
      demandId,
      body,
      key,
    );
  }

  @LendingAction('loan.guarantor_demand.issue')
  @Post(':id/guarantor-demands/:demandId/withdraw')
  withdrawGuarantorDemand(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('demandId', ID) demandId: string,
  ) {
    return this.collections.withdrawDemand(actor(req), id, demandId);
  }

  /** Apply the borrower's deposit to the arrears, maker-checker (UC-61). */
  @LendingAction('loan.set_off.propose')
  @Post(':id/set-offs')
  proposeSetOff(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.setOff)) body: never,
  ) {
    return this.collections.proposeSetOff(actor(req), id, body);
  }

  @LendingAction('loan.set_off.approve')
  @Post(':id/set-offs/:taskId/decision')
  decideSetOff(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(S.approve)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.collections.decideSetOff(actor(req), id, taskId, body, key);
  }

  /** Loan statement for a period (OPS-4). */
  @LendingAction('loan.read')
  @Get(':id/statement')
  statement(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reporting.statement(actor(req), id, { from, to });
  }

  /** Confirmation that a closed loan is repaid (UC-75). */
  @LendingAction('loan.read')
  @Get(':id/closure-letter')
  closureLetter(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.reporting.closureLetter(actor(req), id);
  }

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
  async settle(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.settlement)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    const settled = await this.servicing.settle(actor(req), id, body, key);
    // DOC-9: a settled loan's closure letter is filed in the customer's library.
    await this.generated.afterSettlement(actor(req), id);
    return settled;
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

  // ── Collateral on a running loan (UC-51, UC-73) ───────────────────────────

  @LendingAction('loan.read')
  @Get(':id/collateral')
  loanCollateral(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.collateral.view(actor(req), id);
  }

  @LendingAction('loan.collateral.revalue')
  @Post(':id/collateral')
  pledgeCollateral(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.collateral)) body: never,
  ) {
    return this.collateral.pledge(actor(req), id, body);
  }

  @LendingAction('loan.collateral.revalue')
  @Post(':id/collateral/:collateralId/valuations')
  revalueCollateral(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('collateralId', ID) collateralId: string,
    @Body(new ZodPipe(S.revaluation)) body: never,
  ) {
    return this.collateral.revalue(actor(req), id, collateralId, body);
  }

  @LendingAction('loan.collateral.release.propose')
  @Post(':id/collateral/:collateralId/release')
  proposeCollateralRelease(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('collateralId', ID) collateralId: string,
    @Body(new ZodPipe(S.collateralRelease)) body: never,
  ) {
    return this.collateral.proposeRelease(actor(req), id, collateralId, body);
  }

  @LendingAction('loan.collateral.release.approve')
  @Post(':id/collateral-releases/:taskId/decision')
  decideCollateralRelease(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(S.approve)) body: never,
  ) {
    return this.collateral.decideRelease(actor(req), id, taskId, body);
  }

  @LendingAction('loan.payoff_quote.issue')
  @Post(':id/payoff-quotes')
  issuePayoffQuote(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.payoffQuote)) body: never,
  ) {
    return this.servicing.issuePayoffQuote(actor(req), id, body);
  }

  @LendingAction('loan.read')
  @Get(':id/payoff-quotes')
  payoffQuotes(@Req() req: Req_, @Param('id', ID) id: string) {
    return this.servicing.listPayoffQuotes(actor(req), id);
  }

  @LendingAction('loan.read')
  @Get(':id/payoff-quotes/:quoteId/letter')
  payoffLetter(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('quoteId', ID) quoteId: string,
  ) {
    return this.servicing.payoffLetter(actor(req), id, quoteId);
  }

  @LendingAction('loan.down_payment.record')
  @Post(':id/down-payments')
  recordDownPayment(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.downPayment)) body: never,
    @Headers('idempotency-key') key: string,
  ) {
    return this.servicing.recordDownPayment(actor(req), id, body, key);
  }

  @LendingAction('loan.fee_waiver.propose')
  @Post(':id/fee-waivers')
  proposeFeeWaiver(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.feeWaiver)) body: never,
  ) {
    return this.servicing.proposeFeeWaiver(actor(req), id, body);
  }

  @LendingAction('loan.fee_waiver.approve')
  @Post(':id/fee-waivers/:taskId/decision')
  decideFeeWaiver(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(S.approve)) body: never,
  ) {
    return this.servicing.decideFeeWaiver(actor(req), id, taskId, body);
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
/** Webhooks: the organisation's events delivered to its own systems. */
@Controller('lending/webhooks')
export class LendingWebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @LendingAction('integration.webhook.read')
  @Get()
  list(@Req() req: Req_) {
    return this.webhooks.list(actor(req));
  }

  @LendingAction('integration.webhook.manage')
  @Post()
  create(@Req() req: Req_, @Body(new ZodPipe(S.webhookCreate)) body: never) {
    return this.webhooks.create(actor(req), body);
  }

  @LendingAction('integration.webhook.approve')
  @Post(':endpointId/decision')
  decide(
    @Req() req: Req_,
    @Param('endpointId', ID) id: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean },
  ) {
    return this.webhooks.decide(actor(req), id, body);
  }

  @LendingAction('integration.webhook.manage')
  @Post(':endpointId/disable')
  disable(@Req() req: Req_, @Param('endpointId', ID) id: string) {
    return this.webhooks.disable(actor(req), id);
  }

  @LendingAction('integration.webhook.manage')
  @Post(':endpointId/enable')
  enable(@Req() req: Req_, @Param('endpointId', ID) id: string) {
    return this.webhooks.reenable(actor(req), id);
  }

  @LendingAction('integration.webhook.manage')
  @Post(':endpointId/rotate-secret')
  rotate(@Req() req: Req_, @Param('endpointId', ID) id: string) {
    return this.webhooks.rotateSecret(actor(req), id);
  }

  @LendingAction('integration.webhook.manage')
  @Post(':endpointId/ping')
  ping(@Req() req: Req_, @Param('endpointId', ID) id: string) {
    return this.webhooks.ping(actor(req), id);
  }

  @LendingAction('integration.webhook.read')
  @Get(':endpointId/deliveries')
  deliveries(
    @Req() req: Req_,
    @Param('endpointId', ID) id: string,
    @Query('status') status?: string,
  ) {
    return this.webhooks.deliveries(actor(req), id, { status });
  }

  @LendingAction('integration.webhook.manage')
  @Post(':endpointId/deliveries/:deliveryId/retry')
  retry(
    @Req() req: Req_,
    @Param('endpointId', ID) id: string,
    @Param('deliveryId', ID) deliveryId: string,
  ) {
    return this.webhooks.retry(actor(req), id, deliveryId);
  }
}

/** Taking over a loan book from another system. */
@Controller('lending/migrations')
export class LendingMigrationController {
  constructor(private readonly migration: LoanMigrationService) {}

  @LendingAction('loan.migration.manage')
  @Get('template.csv')
  template(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="loan-migration-template.csv"',
    );
    res.send(this.migration.template());
  }

  /** The legacy module's running loans as a migration file, to move them onto this platform. */
  @LendingAction('loan.migration.manage')
  @Get('legacy-export.csv')
  async legacyExport(
    @Req() req: Req_,
    @Res() res: Response,
    @Query('productCode') productCode?: string,
  ) {
    const csv = await this.migration.legacyExport(actor(req), productCode);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="legacy-loans-migration.csv"',
    );
    res.send(csv);
  }

  // Read by the maker or the approver; the service checks which.
  @AnyAuthenticated()
  @Get()
  list(@Req() req: Req_) {
    return this.migration.list(actor(req));
  }

  @LendingAction('loan.migration.manage')
  @Post()
  upload(@Req() req: Req_, @Body(new ZodPipe(S.migrationUpload)) body: never) {
    return this.migration.upload(actor(req), body);
  }

  @AnyAuthenticated()
  @Get(':batchId')
  get(
    @Req() req: Req_,
    @Param('batchId', ID) batchId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.migration.get(actor(req), batchId, {
      status,
      page: page ? Number(page) : undefined,
    });
  }

  @LendingAction('loan.migration.manage')
  @Get(':batchId/issues.csv')
  async issues(
    @Req() req: Req_,
    @Param('batchId', ID) batchId: string,
    @Res() res: Response,
  ) {
    const csv = await this.migration.issuesCsv(actor(req), batchId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="migration-issues.csv"',
    );
    res.send(csv);
  }

  @LendingAction('loan.migration.approve')
  @Post(':batchId/decision')
  decide(
    @Req() req: Req_,
    @Param('batchId', ID) batchId: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean; comment?: string },
  ) {
    return this.migration.decide(actor(req), batchId, body);
  }

  @LendingAction('loan.migration.manage')
  @Post(':batchId/cancel')
  cancel(@Req() req: Req_, @Param('batchId', ID) batchId: string) {
    return this.migration.cancel(actor(req), batchId);
  }
}

/** Collector work queues fed by the escalation ladder (UC-58). */
@Controller('lending/collections')
export class LendingCollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @LendingAction('loan.read')
  @Get('tasks')
  tasks(
    @Req() req: Req_,
    @Query('queue') queue?: string,
    @Query('status') status?: string,
    @Query('loanAccountId') loanAccountId?: string,
  ) {
    return this.collections.tasks(actor(req), { queue, status, loanAccountId });
  }

  @LendingAction('collection.task.work')
  @Post('tasks/:taskId/claim')
  claim(@Req() req: Req_, @Param('taskId', ID) taskId: string) {
    return this.collections.claim(actor(req), taskId);
  }

  @LendingAction('collection.task.work')
  @Post('tasks/:taskId/complete')
  complete(
    @Req() req: Req_,
    @Param('taskId', ID) taskId: string,
    @Body(new ZodPipe(S.collectionTaskComplete)) body: never,
  ) {
    return this.collections.complete(actor(req), taskId, body);
  }
}

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
    private readonly impairment: ImpairmentService,
    private readonly reporting: ReportingService,
    private readonly periods: PeriodCloseService,
    private readonly lendingSettings: LendingSettingsService,
  ) {}

  // ── The lender's own operating parameters (D-071) ─────────────────────────

  @LendingAction('tenant_settings.read')
  @Get('settings')
  tenantSettings(@Req() req: Req_) {
    return this.lendingSettings.list(actor(req));
  }

  @LendingAction('tenant_settings.manage')
  @Post('settings')
  proposeTenantSettings(
    @Req() req: Req_,
    @Body(new ZodPipe(S.tenantSettings)) body: never,
  ) {
    return this.lendingSettings.propose(actor(req), body);
  }

  @LendingAction('tenant_settings.approve')
  @Post('settings/:id/decision')
  decideTenantSettings(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.approve)) body: never,
  ) {
    return this.lendingSettings.decide(actor(req), id, body);
  }

  // ── Month-end and year-end close (OPS-6) ──────────────────────────────────

  /** The year at a glance: every month's close state and the year's. */
  @LendingAction('accounting.read')
  @Get('periods')
  periodOverview(@Req() req: Req_, @Query('year') year?: string) {
    return this.periods.overview(actor(req), year ? Number(year) : undefined);
  }

  @LendingAction('accounting.read')
  @Get('periods/:year/:month')
  periodMonth(
    @Req() req: Req_,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.periods.month(actor(req), Number(year), Number(month));
  }

  @LendingAction('accounting.period.close')
  @Post('periods/:year/:month/prepare')
  prepareMonth(
    @Req() req: Req_,
    @Param('year') year: string,
    @Param('month') month: string,
    @Body(new ZodPipe(S.periodComment)) body: { comment?: string },
  ) {
    return this.periods.prepareMonth(
      actor(req),
      Number(year),
      Number(month),
      body,
    );
  }

  @LendingAction('accounting.period.approve')
  @Post('periods/:year/:month/decision')
  decideMonth(
    @Req() req: Req_,
    @Param('year') year: string,
    @Param('month') month: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean; comment?: string },
  ) {
    return this.periods.decideMonth(
      actor(req),
      Number(year),
      Number(month),
      body,
    );
  }

  @LendingAction('accounting.period.close')
  @Post('periods/:year/:month/reopen')
  reopenMonth(
    @Req() req: Req_,
    @Param('year') year: string,
    @Param('month') month: string,
    @Body(new ZodPipe(S.periodReopen)) body: { reason: string },
  ) {
    return this.periods.requestReopen(
      actor(req),
      Number(year),
      Number(month),
      body,
    );
  }

  @LendingAction('accounting.period.approve')
  @Post('periods/:year/:month/reopen-decision')
  decideReopen(
    @Req() req: Req_,
    @Param('year') year: string,
    @Param('month') month: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean; comment?: string },
  ) {
    return this.periods.decideReopen(
      actor(req),
      Number(year),
      Number(month),
      body,
    );
  }

  @LendingAction('accounting.read')
  @Get('years/:year')
  yearView(@Req() req: Req_, @Param('year') year: string) {
    return this.periods.yearView(actor(req), Number(year));
  }

  @LendingAction('accounting.period.close')
  @Post('years/:year/prepare')
  prepareYear(
    @Req() req: Req_,
    @Param('year') year: string,
    @Body(new ZodPipe(S.periodComment)) body: { comment?: string },
  ) {
    return this.periods.prepareYear(actor(req), Number(year), body);
  }

  @LendingAction('accounting.period.approve')
  @Post('years/:year/decision')
  decideYear(
    @Req() req: Req_,
    @Param('year') year: string,
    @Body(new ZodPipe(S.approve)) body: { approve: boolean; comment?: string },
  ) {
    return this.periods.decideYear(actor(req), Number(year), body);
  }

  /** Due-soon reminders and overdue notices, with the text to send (OPS-7). */
  @LendingAction('loan.read')
  @Get('notices')
  notices(
    @Req() req: Req_,
    @Query('kind') kind?: string,
    @Query('days') days?: string,
  ) {
    return this.reporting.notices(actor(req), {
      kind,
      days: days ? Number(days) : undefined,
    });
  }

  /** Journal lines for the general ledger (OPS-6). */
  @LendingAction('accounting.read')
  @Get('gl-export.csv')
  async glExport(
    @Req() req: Req_,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const out = await this.reporting.glExport(actor(req), { from, to });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gl-${from}-${to}.csv"`,
    );
    res.setHeader('X-Total-Debit', out.totals.debit);
    res.setHeader('X-Total-Credit', out.totals.credit);
    res.send(out.csv);
  }

  /** The credit bureau reporting file (UC-75). */
  @LendingAction('loan_data.export')
  @Get('bureau-export.csv')
  async bureauExport(@Req() req: Req_, @Res() res: Response) {
    const out = await this.reporting.bureauExport(actor(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="credit-bureau.csv"',
    );
    res.send(out);
  }

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
  @LendingAction('impairment.read')
  @Get('impairment-policy')
  impairmentPolicies(@Req() req: Req_) {
    return this.impairment.list(actor(req));
  }

  @LendingAction('impairment.manage')
  @Post('impairment-policy')
  proposeImpairmentPolicy(
    @Req() req: Req_,
    @Body(new ZodPipe(S.impairmentPolicy)) body: never,
  ) {
    return this.impairment.propose(actor(req), body);
  }

  @LendingAction('impairment.approve')
  @Post('impairment-policy/:id/decision')
  decideImpairmentPolicy(
    @Req() req: Req_,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(S.approve)) body: never,
  ) {
    return this.impairment.decide(actor(req), id, body);
  }

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

/**
 * Regulatory returns (OPS-7) and the consolidated views of the lending and
 * legacy books.
 */
@Controller('lending/regulatory')
export class LendingRegulatoryController {
  constructor(private readonly returns: RegulatoryReturnService) {}

  /** The year's months, their close state and the returns generated for each. */
  @LendingAction('regulatory.read')
  @Get('returns')
  list(@Req() req: Req_, @Query('year') year?: string) {
    return this.returns.list(actor(req), year ? Number(year) : undefined);
  }

  /** A month's return computed now, not stored (also for months not closed yet). */
  @LendingAction('regulatory.read')
  @Get('preview')
  preview(
    @Req() req: Req_,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.returns.preview(actor(req), Number(year), Number(month));
  }

  /** The combined trial balance: legacy and lending journals side by side. */
  @LendingAction('accounting.read')
  @Get('combined-trial-balance')
  combinedTrialBalance(@Req() req: Req_, @Query('asOf') asOf?: string) {
    return this.returns.combinedTrialBalance(actor(req), asOf || undefined);
  }

  @LendingAction('regulatory.prepare')
  @Post('returns')
  generate(
    @Req() req: Req_,
    @Body(new ZodPipe(S.regulatoryGenerate))
    body: { year: number; month: number; comment?: string },
  ) {
    return this.returns.generate(actor(req), body);
  }

  @LendingAction('regulatory.read')
  @Get('returns/:returnId')
  get(@Req() req: Req_, @Param('returnId', ID) id: string) {
    return this.returns.get(actor(req), id);
  }

  @LendingAction('regulatory.read')
  @Get('returns/:returnId/export.csv')
  async exportCsv(
    @Req() req: Req_,
    @Res() res: Response,
    @Param('returnId', ID) id: string,
    @Query('table') table?: string,
  ) {
    const out = await this.returns.csv(actor(req), id, table || undefined);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.filename}"`,
    );
    // A byte-order mark so spreadsheet programs read the file as UTF-8.
    res.send(`\ufeff${out.csv}`);
  }

  @LendingAction('regulatory.read')
  @Get('returns/:returnId/export.xlsx')
  async exportXlsx(
    @Req() req: Req_,
    @Res() res: Response,
    @Param('returnId', ID) id: string,
  ) {
    const out = await this.returns.xlsx(actor(req), id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.filename}"`,
    );
    res.send(out.buffer);
  }

  @LendingAction('regulatory.prepare')
  @Post('returns/:returnId/request-submission')
  requestSubmission(
    @Req() req: Req_,
    @Param('returnId', ID) id: string,
    @Body(new ZodPipe(S.regulatoryRequest)) body: { comment?: string },
  ) {
    return this.returns.requestSubmission(actor(req), id, body);
  }

  @LendingAction('regulatory.submit')
  @Post('returns/:returnId/decision')
  decide(
    @Req() req: Req_,
    @Param('returnId', ID) id: string,
    @Body(new ZodPipe(S.regulatoryDecision))
    body: { approve: boolean; reference?: string; comment?: string },
  ) {
    return this.returns.decide(actor(req), id, body);
  }
}
