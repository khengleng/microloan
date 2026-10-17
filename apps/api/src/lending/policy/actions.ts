/**
 * Protected lending actions and the conditions each one carries beyond its
 * permission. The decision engine reads this table; services name the action
 * they are about to perform and never re-implement the checks.
 */

export type ActionKind =
  /** New business: gated by origination and family availability flags. */
  | 'ORIGINATION'
  /** Money movement on booked loans: gated by servicing + accounting-posting flags, never by origination flags. */
  | 'SERVICING_MONEY'
  /** Disbursement: new money out, so origination *and* posting must be available. */
  | 'DISBURSEMENT'
  /** Reading tenant data. */
  | 'READ'
  /** Tenant configuration (products, workflows). */
  | 'CONFIG'
  /** Access governance (roles, policies, flags). */
  | 'ACCESS'
  /** Platform catalogue actions, open to platform administrators. */
  | 'PLATFORM'
  /** Restructuring workflow: gated by restructure flags, never by origination flags. */
  | 'RESTRUCTURE'
  /** Drawing against a limit: new money out, like a disbursement. */
  | 'DRAWDOWN'
  /** Customer documents (DOC-1..10): no money, no product flags. */
  | 'DOCUMENT';

export type ResourceType =
  | 'CUSTOMER_DOCUMENT'
  | 'RESTRUCTURE_CASE'
  | 'FACILITY'
  | 'LETTER_OF_CREDIT'
  | 'BORROWER_GROUP'
  | 'APPLICATION'
  | 'LOAN_ACCOUNT'
  | 'PRODUCT'
  | 'PRODUCT_VERSION'
  | 'WORKFLOW'
  | 'ACCESS'
  | 'FLAG'
  | 'TENANT'
  | 'CATALOGUE';

export interface ActionDefinition {
  code: string;
  permission: string;
  resourceType: ResourceType;
  kind: ActionKind;
  /** Branch / portfolio / legal-entity scope must cover the resource. */
  scoped: boolean;
  /** Allowed workflow states of the resource; absent = any. */
  workflowStates?: string[];
  /** The actor must not be among the resource's makers. */
  makerChecker?: boolean;
  /** Resource amount must be within the actor's approval authority for this permission. */
  approvalAuthority?: boolean;
  /** Requires multi-factor authentication at sign-in. */
  minAssurance?: 'MFA';
  /** The product version must be ACTIVE (new business) rather than merely booked. */
  requiresActiveProduct?: boolean;
}

const A = (
  code: string,
  resourceType: ResourceType,
  kind: ActionKind,
  opts: Partial<ActionDefinition> = {},
): ActionDefinition => ({
  code,
  permission: opts.permission ?? code,
  resourceType,
  kind,
  scoped:
    opts.scoped ??
    (resourceType === 'APPLICATION' ||
      resourceType === 'LOAN_ACCOUNT' ||
      resourceType === 'RESTRUCTURE_CASE' ||
      resourceType === 'FACILITY' ||
      resourceType === 'LETTER_OF_CREDIT' ||
      resourceType === 'BORROWER_GROUP'),
  ...opts,
});

export const ACTIONS: ActionDefinition[] = [
  // Products
  A('loan_product.read', 'PRODUCT', 'READ'),
  A('loan_product.create', 'PRODUCT', 'CONFIG'),
  A('loan_product.update', 'PRODUCT_VERSION', 'CONFIG', {
    workflowStates: ['DRAFT'],
  }),
  A('loan_product.submit', 'PRODUCT_VERSION', 'CONFIG', {
    workflowStates: ['DRAFT'],
  }),
  A('loan_product.approve', 'PRODUCT_VERSION', 'CONFIG', {
    workflowStates: ['SUBMITTED'],
    makerChecker: true,
  }),
  A('loan_product.reject', 'PRODUCT_VERSION', 'CONFIG', {
    permission: 'loan_product.approve',
    workflowStates: ['SUBMITTED'],
    makerChecker: true,
  }),
  A('loan_product.activate', 'PRODUCT_VERSION', 'CONFIG', {
    workflowStates: ['APPROVED'],
    makerChecker: true,
  }),
  A('loan_product.retire', 'PRODUCT_VERSION', 'CONFIG', {
    workflowStates: ['ACTIVE'],
  }),
  // Policy library (POLICY_MODEL.md): governed exactly like product versions.
  A('lending_policy.read', 'PRODUCT', 'READ', {
    permission: 'loan_product.read',
  }),
  A('lending_policy.create', 'PRODUCT', 'CONFIG', {
    permission: 'loan_product.create',
  }),
  A('lending_policy.submit', 'PRODUCT_VERSION', 'CONFIG', {
    permission: 'loan_product.submit',
    workflowStates: ['DRAFT'],
  }),
  A('lending_policy.approve', 'PRODUCT_VERSION', 'CONFIG', {
    permission: 'loan_product.approve',
    workflowStates: ['SUBMITTED'],
    makerChecker: true,
  }),
  A('lending_policy.reject', 'PRODUCT_VERSION', 'CONFIG', {
    permission: 'loan_product.approve',
    workflowStates: ['SUBMITTED'],
    makerChecker: true,
  }),
  A('lending_policy.retire', 'PRODUCT_VERSION', 'CONFIG', {
    permission: 'loan_product.retire',
    workflowStates: ['APPROVED'],
  }),
  // Unidentified payments and refunds (UC-28, UC-74): tenant-level money.
  A('payment.suspense.read', 'TENANT', 'READ', { permission: 'loan.read' }),
  A('payment.suspense.receive', 'TENANT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('payment.refund.propose', 'TENANT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('payment.refund.approve', 'TENANT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
    makerChecker: true,
  }),
  // Payment channels (UC-16, UC-18, UC-19, UC-21).
  A('payment.channel.read', 'TENANT', 'READ', { permission: 'loan.read' }),
  A('payment.channel_file.import', 'TENANT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('payment.channel.configure', 'TENANT', 'CONFIG', {
    permission: 'rate_observation.manage',
  }),
  // Revoking stays possible on a closed loan; the service allows new mandates on live loans only.
  A('loan.mandate.manage', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  // Collateral on running loans (UC-51, UC-73).
  A('loan.collateral.revalue', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'collateral.manage',
  }),
  A('loan.collateral.release.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'collateral.manage',
  }),
  A('loan.collateral.release.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.disbursement.approve',
    makerChecker: true,
  }),
  A('loan.down_payment.record', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.payoff_quote.issue', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.guarantor_demand.issue', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.covenant.manage', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.covenant.waive', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
  }),
  // Project finance (LT-17): applying a period's receipts through the cash
  // waterfall posts debt service, reserve and lock-up movements — money on a
  // booked loan, authorised like a repayment.
  A('project.waterfall.apply', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.set_off.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.set_off.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
    makerChecker: true,
  }),
  A('collection.task.work', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.fee_waiver.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.fee_waiver.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
    makerChecker: true,
  }),
  A('loan.advance_refund.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.advance_refund.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
    makerChecker: true,
  }),
  // Classification and impairment policy (OPS-5).
  A('impairment.read', 'TENANT', 'READ', { permission: 'accounting.read' }),
  A('impairment.manage', 'TENANT', 'CONFIG'),
  A('impairment.approve', 'TENANT', 'CONFIG', { makerChecker: true }),
  // Month-end and year-end close (OPS-6): finance prepares, someone else locks.
  A('accounting.period.close', 'TENANT', 'CONFIG'),
  // Loan-book migration: one person loads and checks the file,
  // another approves posting it.
  A('loan.migration.manage', 'TENANT', 'CONFIG'),
  // Webhooks send the organisation's events to its own systems: one
  // administrator registers an endpoint, another activates it.
  A('integration.webhook.read', 'ACCESS', 'ACCESS', {
    permission: 'access_policy.read',
  }),
  A('integration.webhook.manage', 'ACCESS', 'ACCESS', {
    permission: 'access_policy.manage',
  }),
  A('integration.webhook.approve', 'ACCESS', 'ACCESS', {
    permission: 'access_policy.approve',
    makerChecker: true,
  }),
  A('loan.migration.approve', 'TENANT', 'CONFIG', { makerChecker: true }),
  A('accounting.period.approve', 'TENANT', 'CONFIG', { makerChecker: true }),
  // Regulatory returns (OPS-7): read with accounting; submission is maker-checker.
  A('regulatory.read', 'TENANT', 'READ', { permission: 'accounting.read' }),
  A('regulatory.prepare', 'TENANT', 'CONFIG'),
  A('regulatory.submit', 'TENANT', 'CONFIG', { makerChecker: true }),
  A('workflow.manage', 'WORKFLOW', 'CONFIG'),
  A('workflow.approve', 'WORKFLOW', 'CONFIG', {
    workflowStates: ['SUBMITTED'],
    makerChecker: true,
  }),
  A('catalogue.read', 'CATALOGUE', 'PLATFORM', {
    permission: 'loan_product.read',
  }),
  // Origination
  A('loan_application.create', 'APPLICATION', 'ORIGINATION', {
    requiresActiveProduct: true,
  }),
  A('loan_application.read', 'APPLICATION', 'READ'),
  A('loan_application.update', 'APPLICATION', 'ORIGINATION', {
    workflowStates: ['DRAFT', 'SUBMITTED'],
  }),
  A('loan_application.submit', 'APPLICATION', 'ORIGINATION', {
    workflowStates: ['DRAFT'],
    requiresActiveProduct: true,
  }),
  A('credit_decision.recommend', 'APPLICATION', 'ORIGINATION', {
    workflowStates: ['SUBMITTED'],
    makerChecker: true,
  }),
  A('credit_decision.approve', 'APPLICATION', 'ORIGINATION', {
    workflowStates: ['RECOMMENDED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
    requiresActiveProduct: true,
  }),
  A('credit_decision.reject', 'APPLICATION', 'ORIGINATION', {
    workflowStates: ['SUBMITTED', 'RECOMMENDED'],
    makerChecker: true,
  }),
  A('collateral.manage', 'APPLICATION', 'ORIGINATION', {
    workflowStates: ['DRAFT', 'SUBMITTED', 'RECOMMENDED'],
  }),
  // Conditions precedent: operations satisfy them with evidence; waiving one is a credit concession.
  A('condition.satisfy', 'APPLICATION', 'ORIGINATION', {
    permission: 'loan.disbursement.prepare',
    workflowStates: ['APPROVED', 'BOOKED'],
  }),
  A('condition.waive', 'APPLICATION', 'ORIGINATION', {
    permission: 'credit_decision.approve',
    workflowStates: ['APPROVED', 'BOOKED'],
    makerChecker: true,
  }),
  A('loan.agreement.book', 'APPLICATION', 'ORIGINATION', {
    workflowStates: ['APPROVED'],
    requiresActiveProduct: true,
  }),
  // Solidarity groups
  A('borrower_group.read', 'BORROWER_GROUP', 'READ'),
  A('borrower_group.manage', 'BORROWER_GROUP', 'ORIGINATION', {
    workflowStates: ['FORMING', 'ACTIVE', 'DORMANT'],
  }),
  // Servicing
  A('loan.read', 'LOAN_ACCOUNT', 'READ'),
  A('loan.disbursement.prepare', 'LOAN_ACCOUNT', 'DISBURSEMENT', {
    workflowStates: ['BOOKED'],
    requiresActiveProduct: true,
  }),
  A('loan.disbursement.approve', 'LOAN_ACCOUNT', 'DISBURSEMENT', {
    workflowStates: ['BOOKED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
    requiresActiveProduct: true,
  }),
  A('loan.disbursement.execute', 'LOAN_ACCOUNT', 'DISBURSEMENT', {
    workflowStates: ['BOOKED'],
    makerChecker: true,
    requiresActiveProduct: true,
  }),
  A('loan.repayment.post', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE'],
  }),
  A('loan.repayment.reverse', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE', 'CLOSED'],
    makerChecker: true,
    minAssurance: 'MFA',
  }),
  // Payment holidays. Publishing a programme is maker-checker, like a
  // product version: it is an offer made to a whole book.
  A('payment_holiday.read', 'TENANT', 'READ'),
  A('payment_holiday.manage', 'TENANT', 'CONFIG'),
  A('payment_holiday.approve', 'TENANT', 'CONFIG', {
    workflowStates: ['DRAFT', 'OPEN'],
    makerChecker: true,
  }),
  A('payment_holiday.grant', 'LOAN_ACCOUNT', 'RESTRUCTURE', {
    workflowStates: ['ACTIVE'],
  }),
  // Settling for less and forgiving principal are different credit calls, so
  // they carry different authorities. The amount measured is the concession.
  A('loan.settlement.negotiate', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE'],
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  A('loan.settlement.negotiate_principal', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE'],
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  // A recovery arrives on a loan that is already written off, which is the
  // only state it is permitted in.
  A('loan.recovery.post', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    workflowStates: ['WRITTEN_OFF'],
  }),
  A('loan.writeoff.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE'],
  }),
  A('loan.writeoff.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  // Restructuring. Resource state is the case status, except request (the loan status).
  A('restructure.request', 'LOAN_ACCOUNT', 'RESTRUCTURE', {
    workflowStates: ['ACTIVE'],
  }),
  A('restructure.read', 'RESTRUCTURE_CASE', 'READ', {
    permission: 'loan.read',
  }),
  A('restructure.withdraw', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    permission: 'restructure.request',
    workflowStates: [
      'REQUESTED',
      'MORE_INFO_REQUIRED',
      'AFFORDABILITY_ASSESSED',
      'SPECIALIST_REVIEW',
      'OPTIONS_PROPOSED',
      'APPROVED',
    ],
  }),
  A('restructure.assess', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: [
      'REQUESTED',
      'MORE_INFO_REQUIRED',
      'AFFORDABILITY_ASSESSED',
      'SPECIALIST_REVIEW',
      'OPTIONS_PROPOSED',
    ],
  }),
  A('restructure.simulate', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: [
      'REQUESTED',
      'MORE_INFO_REQUIRED',
      'AFFORDABILITY_ASSESSED',
      'SPECIALIST_REVIEW',
      'OPTIONS_PROPOSED',
      'APPROVED',
      'CUSTOMER_ACCEPTED',
    ],
  }),
  A('restructure.propose', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: [
      'AFFORDABILITY_ASSESSED',
      'SPECIALIST_REVIEW',
      'OPTIONS_PROPOSED',
      'APPROVED',
      'CUSTOMER_ACCEPTED',
    ],
  }),
  A('restructure.approve', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: ['OPTIONS_PROPOSED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  A('restructure.reject', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    permission: 'restructure.approve',
    workflowStates: [
      'REQUESTED',
      'MORE_INFO_REQUIRED',
      'AFFORDABILITY_ASSESSED',
      'SPECIALIST_REVIEW',
      'OPTIONS_PROPOSED',
    ],
    makerChecker: true,
  }),
  A('restructure.waive_charges', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: ['OPTIONS_PROPOSED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  A('restructure.forgive_principal', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: ['OPTIONS_PROPOSED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  A('restructure.record_acceptance', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: ['APPROVED'],
  }),
  A('restructure.accept_own', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: ['APPROVED'],
  }),
  A('restructure.read_own', 'RESTRUCTURE_CASE', 'READ'),
  A('restructure.satisfy_condition', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    permission: 'restructure.execute',
    workflowStates: ['APPROVED', 'CUSTOMER_ACCEPTED'],
  }),
  A('restructure.execute', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: ['CUSTOMER_ACCEPTED', 'CONDITIONS_SATISFIED'],
    makerChecker: true,
    minAssurance: 'MFA',
  }),
  A('restructure.reverse', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    permission: 'restructure.execute',
    workflowStates: ['MONITORING'],
    makerChecker: true,
    minAssurance: 'MFA',
  }),
  A('restructure.monitor', 'RESTRUCTURE_CASE', 'RESTRUCTURE', {
    workflowStates: ['MONITORING', 'COMPLETED'],
  }),
  // Facilities. Resource state is the facility status, except the drawdown
  // decisions, whose state is the drawdown's own status.
  A('facility.read', 'FACILITY', 'READ'),
  A('facility.drawdown.request', 'FACILITY', 'DRAWDOWN', {
    workflowStates: ['ACTIVE'],
    requiresActiveProduct: true,
  }),
  A('facility.drawdown.approve', 'FACILITY', 'DRAWDOWN', {
    workflowStates: ['REQUESTED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
    requiresActiveProduct: true,
  }),
  A('facility.drawdown.release', 'FACILITY', 'DRAWDOWN', {
    workflowStates: ['APPROVED'],
    makerChecker: true,
    requiresActiveProduct: true,
  }),
  A('facility.drawdown.reject', 'FACILITY', 'DRAWDOWN', {
    permission: 'facility.drawdown.approve',
    workflowStates: ['REQUESTED'],
    makerChecker: true,
  }),
  A('facility.drawdown.cancel', 'FACILITY', 'DRAWDOWN', {
    permission: 'facility.drawdown.request',
    workflowStates: ['REQUESTED'],
  }),
  A('facility.condition.manage', 'FACILITY', 'ORIGINATION', {
    workflowStates: ['PENDING', 'ACTIVE'],
  }),
  A('facility.condition.waive', 'FACILITY', 'ORIGINATION', {
    workflowStates: ['PENDING', 'ACTIVE'],
    makerChecker: true,
    minAssurance: 'MFA',
  }),
  A('facility.limit.request', 'FACILITY', 'CONFIG', {
    workflowStates: ['PENDING', 'ACTIVE', 'SUSPENDED'],
  }),
  A('facility.limit.approve', 'FACILITY', 'CONFIG', {
    workflowStates: ['REQUESTED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  A('facility.limit.reject', 'FACILITY', 'CONFIG', {
    permission: 'facility.limit.approve',
    workflowStates: ['REQUESTED'],
    makerChecker: true,
  }),
  A('facility.manage', 'FACILITY', 'SERVICING_MONEY', {
    workflowStates: ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED'],
  }),
  // Borrowing base (LT-14): a certificate decides how much new money can be
  // drawn, so it is gated like origination and accepted by a second person.
  // The resource state is the facility's status for submission and the
  // certificate's own status for the decision.
  A('facility.borrowing_base.submit', 'FACILITY', 'ORIGINATION', {
    permission: 'facility.drawdown.request',
    workflowStates: ['PENDING', 'ACTIVE', 'SUSPENDED'],
  }),
  A('facility.borrowing_base.decide', 'FACILITY', 'ORIGINATION', {
    permission: 'facility.drawdown.approve',
    workflowStates: ['SUBMITTED'],
    makerChecker: true,
  }),
  A('facility.statement.generate', 'FACILITY', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE', 'SUSPENDED', 'EXPIRED'],
  }),
  // Invoice financing (LT-18, UC-67). The resource is the facility; its
  // state is the invoice's own status for the invoice steps. Advancing is new
  // money out, so it is gated like a disbursement (origination, family and
  // product flags, posting) and carries the drawdown authorities.
  A('trade.invoice.register', 'FACILITY', 'ORIGINATION', {
    permission: 'trade.invoice.manage',
    workflowStates: ['ACTIVE', 'PENDING'],
  }),
  A('trade.invoice.approve', 'FACILITY', 'ORIGINATION', {
    workflowStates: ['SUBMITTED'],
    makerChecker: true,
  }),
  A('trade.invoice.reject', 'FACILITY', 'ORIGINATION', {
    permission: 'trade.invoice.approve',
    workflowStates: ['SUBMITTED', 'APPROVED', 'ADVANCE_REQUESTED'],
    makerChecker: true,
  }),
  A('trade.invoice.advance.request', 'FACILITY', 'DISBURSEMENT', {
    permission: 'facility.drawdown.request',
    workflowStates: ['APPROVED'],
    requiresActiveProduct: true,
  }),
  A('trade.invoice.advance.approve', 'FACILITY', 'DISBURSEMENT', {
    permission: 'facility.drawdown.approve',
    workflowStates: ['ADVANCE_REQUESTED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
    requiresActiveProduct: true,
  }),
  A('trade.invoice.advance.release', 'FACILITY', 'DISBURSEMENT', {
    permission: 'facility.drawdown.release',
    workflowStates: ['ADVANCE_APPROVED'],
    makerChecker: true,
    requiresActiveProduct: true,
  }),
  A('trade.invoice.collect', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['FUNDED', 'RECOURSE', 'DEFAULTED', 'SETTLED'],
  }),
  A('trade.invoice.reserve.propose', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['FUNDED', 'RECOURSE', 'DEFAULTED', 'SETTLED'],
  }),
  A('trade.invoice.reserve.approve', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
    workflowStates: ['FUNDED', 'RECOURSE', 'DEFAULTED', 'SETTLED'],
    makerChecker: true,
  }),
  // Bought receivables — factoring, supply-chain finance, forfaiting — reuse
  // the register's permissions. Recording the debtor's notice, the buyer's
  // approval or the aval is the register maker's; onboarding a supplier is
  // maker-checker like an invoice; writing off the lender's share of a
  // defaulted receivable is a write-off, with the write-off authorities.
  A('trade.receivable.acknowledge', 'FACILITY', 'ORIGINATION', {
    permission: 'trade.invoice.manage',
    workflowStates: ['SUBMITTED', 'APPROVED'],
  }),
  A('trade.receivable.write_off.propose', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.propose',
    workflowStates: ['RECOURSE', 'DEFAULTED'],
  }),
  A('trade.receivable.write_off.approve', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.approve',
    workflowStates: ['RECOURSE', 'DEFAULTED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  A('trade.supplier.manage', 'FACILITY', 'ORIGINATION', {
    permission: 'trade.invoice.manage',
    workflowStates: ['PENDING', 'ACTIVE'],
  }),
  A('trade.supplier.approve', 'FACILITY', 'ORIGINATION', {
    permission: 'trade.invoice.approve',
    workflowStates: ['PENDING'],
    makerChecker: true,
  }),
  A('trade.supplier.reject', 'FACILITY', 'ORIGINATION', {
    permission: 'trade.invoice.approve',
    workflowStates: ['PENDING', 'ACTIVE'],
    makerChecker: true,
  }),
  A('trade.programme.close', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'facility.manage',
    workflowStates: ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED'],
  }),
  // Documentary (import / export) trade loans. The resource is the loan
  // account: recording the trade and receiving documents is the
  // disbursement maker's; verifying them, a disbursement checker's (never
  // the receiver); the proceeds are a repayment.
  A('trade.documentary.read', 'LOAN_ACCOUNT', 'READ', {
    permission: 'loan.read',
  }),
  A('trade.documentary.manage', 'LOAN_ACCOUNT', 'ORIGINATION', {
    permission: 'loan.disbursement.prepare',
    workflowStates: ['BOOKED', 'ACTIVE'],
  }),
  A('trade.documentary.verify', 'LOAN_ACCOUNT', 'ORIGINATION', {
    permission: 'loan.disbursement.approve',
    workflowStates: ['BOOKED', 'ACTIVE'],
    makerChecker: true,
  }),
  A('trade.documentary.proceeds', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE'],
  }),
  // Letters of credit (LT-19, UC-53). Issuing commits the bank, so it is a
  // credit decision within authority; paying under the credit lends money
  // to the importer, so it carries the disbursement authorities.
  A('trade.lc.read', 'LETTER_OF_CREDIT', 'READ'),
  A('trade.lc.request', 'LETTER_OF_CREDIT', 'ORIGINATION', {
    requiresActiveProduct: true,
  }),
  A('trade.lc.issue', 'LETTER_OF_CREDIT', 'DISBURSEMENT', {
    workflowStates: ['REQUESTED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
    requiresActiveProduct: true,
  }),
  A('trade.lc.reject', 'LETTER_OF_CREDIT', 'ORIGINATION', {
    permission: 'trade.lc.issue',
    workflowStates: ['REQUESTED'],
    makerChecker: true,
  }),
  A('trade.lc.drawing.request', 'LETTER_OF_CREDIT', 'SERVICING_MONEY', {
    permission: 'trade.lc.request',
    workflowStates: ['ISSUED', 'PARTIALLY_DRAWN'],
  }),
  A('trade.lc.drawing.approve', 'LETTER_OF_CREDIT', 'DISBURSEMENT', {
    permission: 'loan.disbursement.approve',
    workflowStates: ['REQUESTED'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  A('trade.lc.drawing.reject', 'LETTER_OF_CREDIT', 'SERVICING_MONEY', {
    permission: 'loan.disbursement.approve',
    workflowStates: ['REQUESTED', 'APPROVED'],
    makerChecker: true,
  }),
  A('trade.lc.drawing.pay', 'LETTER_OF_CREDIT', 'DISBURSEMENT', {
    permission: 'loan.disbursement.execute',
    workflowStates: ['APPROVED'],
    makerChecker: true,
  }),
  A('trade.lc.close', 'LETTER_OF_CREDIT', 'SERVICING_MONEY', {
    permission: 'trade.lc.issue',
    workflowStates: ['ISSUED', 'PARTIALLY_DRAWN'],
  }),
  // Syndicated loans (LT-24). The resource is the loan account.
  A('syndication.read', 'LOAN_ACCOUNT', 'READ', { permission: 'loan.read' }),
  A('syndication.manage', 'LOAN_ACCOUNT', 'ORIGINATION', {
    workflowStates: ['BOOKED'],
  }),
  A('syndication.approve', 'LOAN_ACCOUNT', 'ORIGINATION', {
    workflowStates: ['BOOKED'],
    makerChecker: true,
    minAssurance: 'MFA',
  }),
  A('syndication.fund', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.disbursement.prepare',
    workflowStates: ['BOOKED'],
  }),
  A('syndication.distribute', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE', 'CLOSED'],
  }),
  A('syndication.payout.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE', 'CLOSED'],
  }),
  A('syndication.payout.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
    workflowStates: ['ACTIVE', 'CLOSED'],
    makerChecker: true,
    minAssurance: 'MFA',
  }),
  // Credit cards (LT-07, UC-39, UC-40, UC-44). A card is a facility, so its
  // actions are facility actions reusing the facility and servicing
  // permissions: card transactions are posted by whoever posts repayments
  // (the processor feed's operator), statements by whoever states facilities.
  A('card.read', 'FACILITY', 'READ', { permission: 'facility.read' }),
  A('card.purchase.post', 'FACILITY', 'DRAWDOWN', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE'],
  }),
  A('card.cash_advance.post', 'FACILITY', 'DRAWDOWN', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE'],
  }),
  A('card.statement.generate', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'facility.statement.generate',
    workflowStates: ['ACTIVE', 'SUSPENDED', 'EXPIRED'],
  }),
  A('card.payment.post', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE', 'SUSPENDED', 'EXPIRED'],
  }),
  A('card.instalment_plan.convert', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE'],
  }),
  A('card.close', 'FACILITY', 'SERVICING_MONEY', {
    permission: 'facility.manage',
    workflowStates: ['ACTIVE', 'SUSPENDED', 'EXPIRED'],
  }),
  // BNPL (LT-11, UC-52): a merchant refund moves money both ways, so it is
  // posted like a repayment; it may arrive after the plan is paid off.
  A('loan.bnpl.refund', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE', 'CLOSED'],
  }),
  A('loan.bnpl.clawback.collect', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  // Leases (LT-15): the asset is registered before the purchase is paid out.
  A('loan.lease.register', 'LOAN_ACCOUNT', 'DISBURSEMENT', {
    permission: 'loan.disbursement.prepare',
    workflowStates: ['BOOKED'],
  }),
  A('loan.lease.return', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE'],
  }),
  A('loan.lease.transfer_title', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['CLOSED'],
  }),
  // Institutional lending: counterparties and their exposure limits. Credit
  // analysts register counterparties, record ratings and propose limits; a
  // credit approver — another person, within approval authority for the
  // limit amount — approves them.
  A('counterparty.read', 'TENANT', 'READ', { permission: 'loan.read' }),
  A('counterparty.manage', 'TENANT', 'CONFIG', {
    permission: 'credit_decision.recommend',
  }),
  A('counterparty.limit.approve', 'TENANT', 'CONFIG', {
    permission: 'credit_decision.approve',
    workflowStates: ['PENDING'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  // Income-contingent repayment: an assessment re-sets the instalment of a
  // booked contract, so it is proposed by servicing and approved by a
  // different checker, like re-pricing and reversals.
  A('income_contingent.read', 'TENANT', 'READ', { permission: 'loan.read' }),
  A('loan.income_assessment.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.rate_reset.apply',
    workflowStates: ['ACTIVE'],
  }),
  A('loan.income_assessment.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
    workflowStates: ['ACTIVE'],
    makerChecker: true,
  }),
  // Murabaha: the asset is identified before the financier pays for it.
  A('loan.murabaha.register', 'LOAN_ACCOUNT', 'DISBURSEMENT', {
    permission: 'loan.disbursement.prepare',
    workflowStates: ['BOOKED'],
  }),
  // Re-pricing moves no money, but it changes a booked contract, so it is
  // gated like servicing rather than like a read.
  A('loan.rate_reset.apply', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE'],
  }),
  // Customer documents (DOC-1..10). The resource is the customer: tenant,
  // the borrower's branch, and the uploader of the version under review.
  A('document.read', 'CUSTOMER_DOCUMENT', 'DOCUMENT', { scoped: true }),
  A('document.upload', 'CUSTOMER_DOCUMENT', 'DOCUMENT', { scoped: true }),
  A('document.review', 'CUSTOMER_DOCUMENT', 'DOCUMENT', {
    scoped: true,
    makerChecker: true,
  }),
  A('document.manage', 'CUSTOMER_DOCUMENT', 'DOCUMENT', { scoped: true }),
  A('document.retention.manage', 'TENANT', 'DOCUMENT', {
    permission: 'document.manage',
  }),
  A('document.expiry.run', 'TENANT', 'DOCUMENT', {
    permission: 'document.manage',
  }),
  // The borrower, in the portal, on their own documents only.
  A('document.read_own', 'CUSTOMER_DOCUMENT', 'DOCUMENT'),
  A('document.upload_own', 'CUSTOMER_DOCUMENT', 'DOCUMENT'),
  A('servicing.batch.run', 'TENANT', 'SERVICING_MONEY'),
  A('loan_data.export', 'TENANT', 'READ'),
  A('accounting.read', 'TENANT', 'READ'),
  A('business_date.manage', 'TENANT', 'CONFIG'),
  A('rate_observation.manage', 'TENANT', 'CONFIG'),
  A('audit.read', 'TENANT', 'READ'),
  // Access governance
  A('access_policy.read', 'ACCESS', 'ACCESS'),
  A('access_policy.manage', 'ACCESS', 'ACCESS'),
  A('access_policy.approve', 'ACCESS', 'ACCESS', { makerChecker: true }),
  A('policy.simulate', 'ACCESS', 'ACCESS'),
  A('feature_flag.read', 'FLAG', 'ACCESS'),
  A('feature_flag.manage', 'FLAG', 'ACCESS'),
  A('feature_flag.approve', 'FLAG', 'ACCESS', { makerChecker: true }),
  // Recovery workflows (UC-65, UC-66, UC-68, UC-71). They reuse the servicing
  // permissions: proposing a loss is a write-off maker's job, approving one
  // a write-off checker's (with authority); money in is a repayment poster's,
  // money back out a reversal checker's.
  A('recovery.read', 'TENANT', 'READ', { permission: 'loan.read' }),
  A('loan.repossession.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.propose',
    workflowStates: ['ACTIVE'],
  }),
  A('loan.repossession.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.approve',
    workflowStates: ['ACTIVE'],
    makerChecker: true,
    minAssurance: 'MFA',
  }),
  A('loan.repossession.value', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.propose',
    workflowStates: ['ACTIVE'],
  }),
  A('loan.repossession.sell', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE'],
  }),
  A('loan.pawn.custody', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['BOOKED', 'ACTIVE'],
  }),
  A('loan.pawn.forfeit.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.propose',
    workflowStates: ['ACTIVE'],
  }),
  A('loan.pawn.forfeit.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.approve',
    workflowStates: ['ACTIVE'],
    makerChecker: true,
    minAssurance: 'MFA',
  }),
  A('loan.pawn.sell', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE'],
  }),
  A('loan.pawn.return', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['CLOSED'],
  }),
  A('loan.insurance.manage', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE'],
  }),
  A('loan.insurance.remit.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.insurance.remit.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
    makerChecker: true,
  }),
  A('loan.insurance.claim.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
    workflowStates: ['ACTIVE'],
  }),
  A('loan.insurance.claim.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.approve',
    workflowStates: ['ACTIVE'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  A('loan.insurance.claim.receive', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.debt_sale.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.propose',
    workflowStates: ['ACTIVE', 'WRITTEN_OFF'],
  }),
  A('loan.debt_sale.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.writeoff.approve',
    workflowStates: ['ACTIVE', 'WRITTEN_OFF'],
    makerChecker: true,
    approvalAuthority: true,
    minAssurance: 'MFA',
  }),
  A('loan.recovery_refund.propose', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.post',
  }),
  A('loan.recovery_refund.approve', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    permission: 'loan.repayment.reverse',
    makerChecker: true,
  }),
];

export const ACTION_BY_CODE: Record<string, ActionDefinition> =
  Object.fromEntries(ACTIONS.map((a) => [a.code, a]));

/** Actions the frontend asks about for a resource type (capabilities endpoint). */
export function actionsFor(resourceType: ResourceType): ActionDefinition[] {
  return ACTIONS.filter((a) => a.resourceType === resourceType);
}
