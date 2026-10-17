import { lending } from '@microloan/shared';
import type { Resource } from './decision';
import { decStr } from '../common/util';

type ProductConfig = lending.ProductConfig;

/** Flags a product's configuration depends on, beyond origination and family. */
export function configFlags(config: ProductConfig | null): string[] {
  if (!config) return [];
  const flags: string[] = [];
  if (config.repayment.method === 'BALLOON')
    flags.push('lending.repayment.balloon');
  if (config.attributes.rateType === 'FLOATING')
    flags.push('lending.pricing.floating_rate');
  if (config.operations.integrations.creditBureau === 'REQUIRED')
    flags.push('lending.integration.credit_bureau');
  if (config.identity.liability !== 'INDIVIDUAL')
    flags.push('lending.group.joint_liability');
  if (config.trade?.invoice) flags.push('lending.trade.invoice_finance');
  if (config.trade?.letterOfCredit)
    flags.push('lending.trade.letters_of_credit');
  if (config.syndication) flags.push('lending.syndication');
  if (config.projectFinance) flags.push('lending.project_finance');
  if (config.borrowingBase) flags.push('lending.collateral.borrowing_base');
  return flags;
}

export function parseConfig(raw: unknown): {
  config: ProductConfig | null;
  valid: boolean;
} {
  const r = lending.validateProductConfig(raw);
  return r.ok
    ? { config: r.config, valid: true }
    : { config: null, valid: false };
}

export function applicationResource(
  app: {
    id: string;
    tenantId: string;
    branchId: string;
    portfolioId: string | null;
    legalEntityId: string | null;
    status: string;
    requestedAmount: unknown;
    currency: string;
    createdBy: string;
    segmentCode: string | null;
    terms: unknown;
  },
  version: { status: string; config: unknown } | null,
  product: { code: string; familyCode: string } | null,
  makerIds: string[],
  amountOverride?: string,
): Resource {
  const { config, valid } = parseConfig(version?.config);
  const terms = (app.terms ?? {}) as { riskCategory?: string };
  return {
    type: 'APPLICATION',
    id: app.id,
    tenantId: app.tenantId,
    branchId: app.branchId,
    portfolioId: app.portfolioId,
    legalEntityId: app.legalEntityId,
    productCode: product?.code ?? null,
    familyCode: product?.familyCode ?? null,
    productStatus: version?.status ?? null,
    productConfigValid: valid,
    amount: amountOverride ?? decStr(app.requestedAmount as string),
    currency: app.currency,
    riskCategory: terms.riskCategory ?? null,
    dataClassification: 'CONFIDENTIAL',
    workflowState: app.status,
    segment: app.segmentCode,
    makerIds: [...new Set([app.createdBy, ...makerIds])],
    requiredFlags: configFlags(config),
  };
}

export function loanAccountResource(
  acct: {
    id: string;
    tenantId: string;
    branchId: string;
    portfolioId: string | null;
    legalEntityId: string | null;
    status: string;
    bookedPrincipal: unknown;
    currency: string;
    familyCode: string;
  },
  productCode: string | null,
  productVersionStatus: string | null,
  agreementConfigValid: boolean,
  makerIds: string[],
  amount?: string,
): Resource {
  return {
    type: 'LOAN_ACCOUNT',
    id: acct.id,
    tenantId: acct.tenantId,
    branchId: acct.branchId,
    portfolioId: acct.portfolioId,
    legalEntityId: acct.legalEntityId,
    productCode,
    familyCode: acct.familyCode,
    productStatus: productVersionStatus,
    productConfigValid: agreementConfigValid,
    amount: amount ?? decStr(acct.bookedPrincipal as string),
    currency: acct.currency,
    dataClassification: 'CONFIDENTIAL',
    workflowState: acct.status,
    makerIds,
  };
}

export function productVersionResource(
  v: { id: string; tenantId: string; status: string; makerId: string },
  product: { code: string; familyCode: string },
): Resource {
  return {
    type: 'PRODUCT_VERSION',
    id: v.id,
    tenantId: v.tenantId,
    productCode: product.code,
    familyCode: product.familyCode,
    workflowState: v.status,
    makerIds: [v.makerId],
  };
}

export function tenantResource(
  tenantId: string | null,
  type = 'TENANT',
  id?: string,
  makerIds: string[] = [],
  workflowState?: string,
): Resource {
  return {
    type,
    id: id ?? tenantId ?? 'platform',
    tenantId,
    makerIds,
    workflowState: workflowState ?? null,
  };
}

/**
 * A facility as the decision engine sees it.
 *
 * `workflowState` is the facility's own status for governance actions, but a
 * drawdown decision is about the *drawdown*, so the caller passes that status
 * instead — the action table names the states it accepts and never has to
 * know which of the two it is looking at.
 */
export function facilityResource(
  f: {
    id: string;
    tenantId: string;
    branchId: string;
    portfolioId: string | null;
    legalEntityId: string | null;
    status: string;
    limitAmount: unknown;
    currency: string;
    familyCode: string;
  },
  productCode: string | null,
  productVersionStatus: string | null,
  config: ProductConfig | null,
  configValid: boolean,
  makerIds: string[] = [],
  opts: { workflowState?: string; amount?: string } = {},
): Resource {
  return {
    type: 'FACILITY',
    id: f.id,
    tenantId: f.tenantId,
    branchId: f.branchId,
    portfolioId: f.portfolioId,
    legalEntityId: f.legalEntityId,
    productCode,
    familyCode: f.familyCode,
    productStatus: productVersionStatus,
    productConfigValid: configValid,
    amount: opts.amount ?? decStr(f.limitAmount as string),
    currency: f.currency,
    dataClassification: 'CONFIDENTIAL',
    workflowState: opts.workflowState ?? f.status,
    makerIds,
    requiredFlags: [...configFlags(config), ...facilityFlags(config)],
  };
}

/** Facility behaviour is flag-gated on top of the product's own flags. */
function facilityFlags(config: ProductConfig | null): string[] {
  switch (config?.facility.type) {
    case 'REVOLVING':
      return ['lending.revolving.drawdown'];
    case 'OVERDRAFT':
      return ['lending.facility.overdraft'];
    case 'STAGED_DRAWDOWN':
      return ['lending.facility.staged_drawdown'];
    default:
      return [];
  }
}
