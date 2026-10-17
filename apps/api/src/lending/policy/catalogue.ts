/**
 * Action-based permissions, system roles and feature flags for the lending
 * platform. These are seeded into the database (platform catalogue tables)
 * and are the vocabulary every authorization decision is expressed in.
 */

export interface PermissionDefinition {
  code: string;
  description: string;
  category: string;
  /** Moves money or changes a booked financial record. */
  financial?: boolean;
  /** May be held by a platform administrator (catalogue-level actions only). */
  platformAllowed?: boolean;
}

export const PERMISSIONS: PermissionDefinition[] = [
  // Products and workflows
  {
    code: 'loan_product.read',
    description: 'View products, versions and the capability matrix',
    category: 'Products',
    platformAllowed: true,
  },
  {
    code: 'loan_product.create',
    description: 'Create products and draft versions',
    category: 'Products',
  },
  {
    code: 'loan_product.update',
    description: 'Edit draft product versions',
    category: 'Products',
  },
  {
    code: 'loan_product.submit',
    description: 'Submit a draft version for approval',
    category: 'Products',
  },
  {
    code: 'loan_product.approve',
    description: 'Approve or reject a submitted version (checker)',
    category: 'Products',
  },
  {
    code: 'loan_product.activate',
    description: 'Activate an approved version',
    category: 'Products',
  },
  {
    code: 'loan_product.retire',
    description: 'Retire a product for new origination',
    category: 'Products',
  },
  {
    code: 'workflow.manage',
    description: 'Draft and submit workflow versions',
    category: 'Products',
  },
  {
    code: 'workflow.approve',
    description: 'Approve workflow versions',
    category: 'Products',
  },
  {
    code: 'catalogue.manage',
    description: 'Maintain platform loan families and templates',
    category: 'Platform',
    platformAllowed: true,
  },
  // Origination
  {
    code: 'loan_application.create',
    description: 'Create applications',
    category: 'Origination',
  },
  {
    code: 'loan_application.read',
    description: 'View applications',
    category: 'Origination',
  },
  {
    code: 'loan_application.update',
    description: 'Edit applications, documents, collateral and guarantees',
    category: 'Origination',
  },
  {
    code: 'loan_application.submit',
    description: 'Submit applications for assessment',
    category: 'Origination',
  },
  {
    code: 'credit_decision.recommend',
    description: 'Record a credit recommendation',
    category: 'Credit',
  },
  {
    code: 'credit_decision.approve',
    description: 'Approve credit within approval authority',
    category: 'Credit',
  },
  {
    code: 'credit_decision.reject',
    description: 'Reject an application',
    category: 'Credit',
  },
  {
    code: 'collateral.manage',
    description: 'Record collateral and valuations',
    category: 'Credit',
  },
  {
    code: 'loan.agreement.book',
    description: 'Book an approved application as a loan agreement',
    category: 'Operations',
  },
  // Servicing
  {
    code: 'loan.read',
    description: 'View loan accounts, schedules and events',
    category: 'Servicing',
  },
  {
    code: 'loan.disbursement.prepare',
    description: 'Prepare a disbursement (maker)',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.disbursement.approve',
    description: 'Approve a disbursement (checker)',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.disbursement.execute',
    description: 'Execute an approved disbursement',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.repayment.post',
    description: 'Post repayments, prepayments and settlements',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.repayment.reverse',
    description: 'Reverse a posted repayment',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.restructure.propose',
    description: 'Propose a restructure',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.restructure.approve',
    description: 'Approve a restructure',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.writeoff.propose',
    description: 'Propose a write-off',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.writeoff.approve',
    description: 'Approve a write-off',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'servicing.batch.run',
    description: 'Run accrual and delinquency for the business date',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'business_date.manage',
    description: 'Advance the tenant business date',
    category: 'Operations',
  },
  {
    code: 'rate_observation.manage',
    description: 'Record benchmark rate observations',
    category: 'Operations',
  },
  {
    code: 'impairment.manage',
    description:
      'Propose loan classification and impairment (provisioning) policies',
    category: 'Operations',
  },
  {
    code: 'impairment.approve',
    description: 'Approve an impairment policy proposed by someone else',
    category: 'Operations',
  },
  // Restructuring and hardship
  {
    code: 'restructure.request',
    description:
      'Open a restructuring review on a documented customer request or difficulty',
    category: 'Restructuring',
  },
  {
    code: 'restructure.assess',
    description: 'Record verified evidence and affordability assessments',
    category: 'Restructuring',
  },
  {
    code: 'restructure.simulate',
    description: 'Run side-effect-free restructure simulations',
    category: 'Restructuring',
  },
  {
    code: 'restructure.propose',
    description: 'Propose restructure options',
    category: 'Restructuring',
  },
  {
    code: 'restructure.approve',
    description:
      'Approve or reject a restructure proposal within authority (checker)',
    category: 'Restructuring',
    financial: true,
  },
  {
    code: 'restructure.record_acceptance',
    description: 'Record a customer acceptance taken in branch',
    category: 'Restructuring',
  },
  {
    code: 'restructure.execute',
    description: 'Execute an approved and accepted amendment',
    category: 'Restructuring',
    financial: true,
  },
  {
    code: 'restructure.monitor',
    description: 'Monitor restructured loans and work review tasks',
    category: 'Restructuring',
  },
  {
    code: 'restructure.waive_charges',
    description:
      'Approve interest, fee and penalty waivers and rate concessions within authority',
    category: 'Restructuring',
    financial: true,
  },
  {
    code: 'restructure.forgive_principal',
    description: 'Approve partial principal forgiveness within authority',
    category: 'Restructuring',
    financial: true,
  },
  // Accounting, data and audit
  {
    code: 'accounting.read',
    description: 'View lending journals and reconciliation',
    category: 'Accounting',
  },
  {
    code: 'loan_data.export',
    description: 'Export loan data',
    category: 'Data',
  },
  {
    code: 'audit.read',
    description: 'Read the audit trail',
    category: 'Audit',
    platformAllowed: true,
  },
  // Access governance
  {
    code: 'access_policy.read',
    description: 'View roles, assignments, authorities and ABAC policies',
    category: 'Access',
  },
  {
    code: 'access_policy.manage',
    description:
      'Propose role assignments, delegations, authorities and ABAC policies',
    category: 'Access',
  },
  {
    code: 'access_policy.approve',
    description: 'Approve access-policy changes (checker)',
    category: 'Access',
  },
  {
    code: 'policy.simulate',
    description: 'Run the side-effect-free access-policy simulator',
    category: 'Access',
  },
  {
    code: 'feature_flag.read',
    description: 'View feature flags and their evaluation',
    category: 'Flags',
    platformAllowed: true,
  },
  {
    code: 'feature_flag.manage',
    description: 'Propose feature-flag rule changes',
    category: 'Flags',
    platformAllowed: true,
  },
  {
    code: 'feature_flag.approve',
    description: 'Approve feature-flag rule changes (checker)',
    category: 'Flags',
    platformAllowed: true,
  },
  {
    code: 'payment_holiday.read',
    description: 'View payment-holiday programmes and enrolments',
    category: 'Restructuring',
  },
  {
    code: 'payment_holiday.manage',
    description: 'Draft payment-holiday programmes',
    category: 'Restructuring',
  },
  {
    code: 'payment_holiday.approve',
    description: 'Open or close a payment-holiday programme (checker)',
    category: 'Restructuring',
    financial: true,
  },
  {
    code: 'payment_holiday.grant',
    description: 'Grant a payment holiday to a loan under an open programme',
    category: 'Restructuring',
    financial: true,
  },
  {
    code: 'loan.refinance.execute',
    description: 'Replace a loan with a new one whose proceeds settle it',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.settlement.negotiate',
    description: 'Close a loan for less than it owes, waiving charges',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.settlement.negotiate_principal',
    description: 'Negotiate a settlement that forgives principal',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'loan.recovery.post',
    description: 'Post money recovered on a written-off loan',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'borrower_group.read',
    description: 'View solidarity groups and their membership',
    category: 'Origination',
  },
  {
    code: 'borrower_group.manage',
    description: 'Form groups, admit and remove members',
    category: 'Origination',
  },
  {
    code: 'loan.rate_reset.apply',
    description: 'Apply contractual floating-rate resets to booked loans',
    category: 'Servicing',
    financial: true,
  },
  {
    code: 'facility.read',
    description: 'View facilities, drawdowns and statements',
    category: 'Facilities',
  },
  {
    code: 'facility.drawdown.request',
    description: 'Request a drawdown against a facility (maker)',
    category: 'Facilities',
    financial: true,
  },
  {
    code: 'facility.drawdown.approve',
    description: 'Approve a drawdown (checker)',
    category: 'Facilities',
    financial: true,
  },
  {
    code: 'facility.drawdown.release',
    description: 'Release an approved drawdown',
    category: 'Facilities',
    financial: true,
  },
  {
    code: 'facility.condition.manage',
    description: 'Satisfy a tranche condition with evidence',
    category: 'Facilities',
  },
  {
    code: 'facility.condition.waive',
    description: 'Waive a tranche condition (a credit concession)',
    category: 'Facilities',
    financial: true,
  },
  {
    code: 'facility.limit.request',
    description: 'Request a change to a facility limit (maker)',
    category: 'Facilities',
  },
  {
    code: 'facility.limit.approve',
    description: 'Approve a facility limit change (checker)',
    category: 'Facilities',
    financial: true,
  },
  {
    code: 'facility.manage',
    description: 'Suspend, reinstate, expire or term out a facility',
    category: 'Facilities',
    financial: true,
  },
  {
    code: 'facility.statement.generate',
    description: 'Raise facility interest, fees and period statements',
    category: 'Facilities',
    financial: true,
  },
  // Customer documents (DOC-1..10)
  {
    code: 'document.read',
    description:
      'View customer documents and download them (every access is audited)',
    category: 'Documents',
  },
  {
    code: 'document.upload',
    description:
      'Upload and replace customer documents; request documents from customers',
    category: 'Documents',
  },
  {
    code: 'document.review',
    description:
      'Accept or reject a document uploaded by someone else (checker)',
    category: 'Documents',
  },
  {
    code: 'document.manage',
    description: 'Legal hold, retention rules and deletion after retention',
    category: 'Documents',
  },
  {
    code: 'trade.invoice.manage',
    description: 'Register invoices in an invoice-finance register (maker)',
    category: 'Trade finance',
  },
  {
    code: 'trade.invoice.approve',
    description:
      'Approve or reject invoices as eligible for an advance (checker)',
    category: 'Trade finance',
    financial: true,
  },
  {
    code: 'trade.lc.read',
    description: 'View letters of credit and their drawings',
    category: 'Trade finance',
  },
  {
    code: 'trade.lc.request',
    description: 'Request letters of credit and record presentations (maker)',
    category: 'Trade finance',
    financial: true,
  },
  {
    code: 'trade.lc.issue',
    description: 'Issue, reject, expire or cancel letters of credit (checker)',
    category: 'Trade finance',
    financial: true,
  },
  {
    code: 'syndication.manage',
    description: 'Set up the participants of a syndicated loan (maker)',
    category: 'Syndication',
    financial: true,
  },
  {
    code: 'syndication.approve',
    description: 'Approve a syndicate (checker)',
    category: 'Syndication',
    financial: true,
  },
];

export const PERMISSION_CODES = new Set(PERMISSIONS.map((p) => p.code));

/** What a borrower (customer principal) may do — always on their own loans only. */
export const CUSTOMER_PERMISSIONS = [
  'restructure.request',
  'restructure.read_own',
  'restructure.accept_own',
  'document.read_own',
  'document.upload_own',
];

/** Permissions a platform administrator holds. None touch tenant borrower data or money. */
export const PLATFORM_PERMISSIONS = PERMISSIONS.filter(
  (p) => p.platformAllowed,
).map((p) => p.code);

export interface RoleDefinition {
  code: string;
  name: string;
  description: string;
  permissions: string[];
}

const READ_ALL = [
  'document.read',
  'loan.read',
  'loan_application.read',
  'loan_product.read',
  'borrower_group.read',
];

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    code: 'TENANT_ADMIN',
    name: 'Tenant administrator',
    description:
      'Governs access, flags and configuration. Cannot approve credit or move money.',
    permissions: [
      'access_policy.read',
      'access_policy.manage',
      'access_policy.approve',
      'feature_flag.read',
      'feature_flag.manage',
      'feature_flag.approve',
      'loan_product.read',
      'audit.read',
      'policy.simulate',
      'business_date.manage',
    ],
  },
  {
    code: 'PRODUCT_MAKER',
    name: 'Product maker',
    description: 'Drafts products, versions and workflows.',
    permissions: [
      'loan_product.read',
      'loan_product.create',
      'loan_product.update',
      'loan_product.submit',
      'workflow.manage',
      'policy.simulate',
    ],
  },
  {
    code: 'PRODUCT_CHECKER',
    name: 'Product checker',
    description:
      'Approves, activates and retires product and workflow versions.',
    permissions: [
      'loan_product.read',
      'loan_product.approve',
      'loan_product.activate',
      'loan_product.retire',
      'workflow.approve',
    ],
  },
  {
    code: 'RELATIONSHIP_OFFICER',
    name: 'Relationship officer',
    description:
      'Originates applications and runs solidarity groups for borrowers in their scope.',
    permissions: [
      'document.read',
      'document.upload',
      'borrower_group.read',
      'borrower_group.manage',
      'loan_application.create',
      'loan_application.read',
      'loan_application.update',
      'loan_application.submit',
      'collateral.manage',
      'loan.read',
      'loan_product.read',
      'restructure.request',
      'restructure.simulate',
      'restructure.record_acceptance',
    ],
  },
  {
    code: 'CREDIT_ANALYST',
    name: 'Credit analyst',
    description: 'Assesses applications and recommends decisions.',
    permissions: [
      'document.read',
      'document.upload',
      'document.review',
      'borrower_group.read',
      'loan_application.read',
      'credit_decision.recommend',
      'collateral.manage',
      'loan.read',
      'loan_product.read',
      'restructure.assess',
      'restructure.simulate',
      'restructure.propose',
    ],
  },
  {
    code: 'CREDIT_APPROVER',
    name: 'Credit approver',
    description: 'Approves or rejects credit within approval authority.',
    permissions: [
      'document.read',
      'loan_application.read',
      'credit_decision.approve',
      'credit_decision.reject',
      'loan.read',
      'loan_product.read',
      'restructure.simulate',
      'restructure.approve',
      'facility.read',
      'facility.limit.approve',
      'facility.condition.waive',
      'trade.invoice.approve',
      'trade.lc.read',
      'trade.lc.issue',
      'syndication.approve',
    ],
  },
  {
    code: 'LOAN_OPS_MAKER',
    name: 'Loan operations maker',
    description:
      'Books agreements, prepares disbursements, posts repayments, proposes write-offs.',
    permissions: [
      'document.upload',
      'document.review',
      ...READ_ALL,
      'loan.agreement.book',
      'loan.disbursement.prepare',
      'loan.repayment.post',
      'loan.writeoff.propose',
      'servicing.batch.run',
      'loan.rate_reset.apply',
      'facility.read',
      'facility.drawdown.request',
      'facility.condition.manage',
      'facility.limit.request',
      'facility.statement.generate',
      'trade.invoice.manage',
      'trade.lc.read',
      'trade.lc.request',
      'syndication.manage',
    ],
  },
  {
    code: 'LOAN_OPS_CHECKER',
    name: 'Loan operations checker',
    description:
      'Approves and executes disbursements, reverses repayments, approves write-offs.',
    permissions: [
      'document.review',
      ...READ_ALL,
      'loan.disbursement.approve',
      'loan.disbursement.execute',
      'loan.repayment.reverse',
      'loan.writeoff.approve',
      'restructure.execute',
      'restructure.monitor',
      'facility.read',
      'facility.drawdown.approve',
      'facility.drawdown.release',
      'facility.manage',
      'trade.lc.read',
    ],
  },
  {
    code: 'COLLECTIONS_OFFICER',
    name: 'Collections officer',
    description: 'Works delinquent accounts and posts collections.',
    permissions: [
      'document.read',
      'document.upload',
      'loan.read',
      'loan.repayment.post',
      'loan.recovery.post',
      'payment_holiday.read',
      'payment_holiday.grant',
      'restructure.request',
      'restructure.simulate',
      'restructure.monitor',
    ],
  },
  {
    code: 'RESTRUCTURE_COMMITTEE',
    name: 'Restructure committee',
    description:
      'Approves restructures with concessions: waivers, rate reductions, principal forgiveness and negotiated settlements, within authority.',
    permissions: [
      'loan.settlement.negotiate',
      'loan.settlement.negotiate_principal',
      'payment_holiday.read',
      'payment_holiday.manage',
      'payment_holiday.approve',
      'loan.read',
      'restructure.simulate',
      'restructure.approve',
      'restructure.waive_charges',
      'restructure.forgive_principal',
      'restructure.monitor',
    ],
  },
  {
    code: 'FINANCE_OFFICER',
    name: 'Finance officer',
    description: 'Accounting, reconciliation, business date and rates.',
    permissions: [
      'loan.read',
      'accounting.read',
      'business_date.manage',
      'rate_observation.manage',
      'impairment.manage',
      'servicing.batch.run',
      'loan_data.export',
    ],
  },
  {
    code: 'RISK_COMPLIANCE',
    name: 'Risk / compliance reviewer',
    description: 'Read access across lending with the policy simulator.',
    permissions: [
      'document.manage',
      ...READ_ALL,
      'audit.read',
      'accounting.read',
      'impairment.approve',
      'feature_flag.read',
      'access_policy.read',
      'policy.simulate',
      'loan_data.export',
    ],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description: 'Read-only access including the audit trail.',
    permissions: [
      ...READ_ALL,
      'audit.read',
      'accounting.read',
      'feature_flag.read',
      'access_policy.read',
    ],
  },
  {
    code: 'INTEGRATION_SERVICE',
    name: 'Integration service account',
    description:
      'Template scopes for integration principals (repayment posting).',
    permissions: ['loan.read', 'loan.repayment.post'],
  },
];

/** A role is sensitive if it can move money or approve anything; assigning it needs a checker. */
export function isSensitiveRole(permissions: string[]): boolean {
  const financial = new Set(
    PERMISSIONS.filter((p) => p.financial).map((p) => p.code),
  );
  return permissions.some(
    (p) =>
      financial.has(p) ||
      p.endsWith('.approve') ||
      p === 'access_policy.manage',
  );
}

export interface FlagDefinition {
  key: string;
  description: string;
  category: string;
  sensitive: boolean;
  defaultEnabled: boolean;
}

const FAMILY_FLAGS: FlagDefinition[] = [
  'PERSONAL',
  'PROPERTY',
  'VEHICLE_ASSET',
  'EDUCATION',
  'MICROFINANCE',
  'SME_COMMERCIAL',
  'AGRICULTURE',
  'CORPORATE_PROJECT',
  'TRADE_RECEIVABLES',
  'INSTITUTIONAL_PUBLIC',
].map((f) => ({
  key: familyFlagKey(f),
  description: `New origination in the ${f} family`,
  category: 'Families',
  sensitive: true,
  defaultEnabled: true,
}));

export function familyFlagKey(familyCode: string): string {
  return `lending.family.${familyCode.toLowerCase()}.enabled`;
}

export const FLAG_DEFINITIONS: FlagDefinition[] = [
  {
    key: 'lending.origination',
    description:
      'New applications, approvals, bookings and disbursements (scope by product, branch, channel, segment or cohort)',
    category: 'Availability',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.servicing',
    description:
      'Repayments, accruals, statements and servicing of existing loans',
    category: 'Availability',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.accounting.posting',
    description:
      'Ledger posting. When off, every financial operation is refused rather than left unposted.',
    category: 'Availability',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.revolving.drawdown',
    description: 'New drawdowns on revolving facilities',
    category: 'Capabilities',
    sensitive: true,
    defaultEnabled: false,
  },
  {
    key: 'lending.facility.overdraft',
    description: 'Overdraft facilities',
    category: 'Capabilities',
    sensitive: true,
    defaultEnabled: false,
  },
  {
    key: 'lending.facility.staged_drawdown',
    description: 'Staged (construction) drawdown facilities',
    category: 'Capabilities',
    sensitive: true,
    defaultEnabled: false,
  },
  {
    key: 'lending.trade.invoice_finance',
    description:
      'Invoice financing: registers, advances and debtor collections',
    category: 'Capabilities',
    sensitive: true,
    defaultEnabled: false,
  },
  {
    key: 'lending.trade.letters_of_credit',
    description: 'Letters of credit and their conversion to loans',
    category: 'Capabilities',
    sensitive: true,
    defaultEnabled: false,
  },
  {
    key: 'lending.syndication',
    description: 'Syndicated loans with participants',
    category: 'Capabilities',
    sensitive: true,
    defaultEnabled: false,
  },
  {
    key: 'lending.group.joint_liability',
    description: 'Group / joint-liability lending',
    category: 'Capabilities',
    sensitive: true,
    defaultEnabled: false,
  },
  {
    key: 'lending.pricing.floating_rate',
    description: 'Floating-rate pricing and contractual resets',
    category: 'Capabilities',
    sensitive: true,
    defaultEnabled: false,
  },
  {
    key: 'lending.repayment.balloon',
    description: 'Balloon repayment schedules',
    category: 'Capabilities',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.request',
    description: 'New restructuring requests (customer and staff)',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.simulation',
    description: 'Restructure simulation and proposals',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.execution',
    description:
      'Executing approved amendments (never affects amendments already executed)',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.term_extension',
    description: 'Term extension and instalment reduction',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.payment_deferral',
    description: 'Full payment deferral',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.interest_only',
    description: 'Temporary interest-only / principal grace',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.rate_reduction',
    description: 'Permanent or temporary rate reduction',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.capitalization',
    description: 'Capitalization of eligible unpaid amounts',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.charge_waiver',
    description: 'Interest, fee and penalty waivers',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: true,
  },
  {
    key: 'lending.restructure.principal_forgiveness',
    description: 'Partial principal forgiveness',
    category: 'Restructuring',
    sensitive: true,
    defaultEnabled: false,
  },
  {
    key: 'lending.integration.credit_bureau',
    description: 'Live credit bureau enquiries',
    category: 'Integrations',
    sensitive: true,
    defaultEnabled: false,
  },
  ...FAMILY_FLAGS,
];
