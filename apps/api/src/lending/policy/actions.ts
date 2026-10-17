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
  | 'DRAWDOWN';

export type ResourceType =
  | 'RESTRUCTURE_CASE'
  | 'FACILITY'
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
  A('facility.statement.generate', 'FACILITY', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE', 'SUSPENDED', 'EXPIRED'],
  }),
  // Re-pricing moves no money, but it changes a booked contract, so it is
  // gated like servicing rather than like a read.
  A('loan.rate_reset.apply', 'LOAN_ACCOUNT', 'SERVICING_MONEY', {
    workflowStates: ['ACTIVE'],
  }),
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
];

export const ACTION_BY_CODE: Record<string, ActionDefinition> =
  Object.fromEntries(ACTIONS.map((a) => [a.code, a]));

/** Actions the frontend asks about for a resource type (capabilities endpoint). */
export function actionsFor(resourceType: ResourceType): ActionDefinition[] {
  return ACTIONS.filter((a) => a.resourceType === resourceType);
}
