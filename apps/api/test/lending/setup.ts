import {
  acceptKeyFacts,
  Fixture,
  authority,
  borrower,
  expectOk,
  grant,
} from './harness';

/** Standard role layout used by the integration suites. */
export async function standardRoles(f: Fixture) {
  const t = f.t1;
  await grant(f, t, 'maker', 'PRODUCT_MAKER');
  await grant(f, t, 'checker', 'PRODUCT_CHECKER');
  await grant(f, t, 'ro', 'RELATIONSHIP_OFFICER', { branchIds: [f.b1] });
  await grant(f, t, 'ro2', 'RELATIONSHIP_OFFICER', { branchIds: [f.b2] });
  await grant(f, t, 'analyst', 'CREDIT_ANALYST');
  await grant(f, t, 'approver', 'CREDIT_APPROVER');
  await grant(f, t, 'approver2', 'CREDIT_APPROVER');
  await grant(f, t, 'opsMaker', 'LOAN_OPS_MAKER');
  await grant(f, t, 'opsChecker', 'LOAN_OPS_CHECKER');
  await grant(f, t, 'finance', 'FINANCE_OFFICER');
  await grant(f, t, 'financeB2', 'FINANCE_OFFICER', { branchIds: [f.b2] });
  await authority(f, t, 'approver', 'credit_decision.approve', 'USD', '200000');
  await authority(
    f,
    t,
    'approver2',
    'credit_decision.approve',
    'USD',
    '1000000',
  );
  await authority(
    f,
    t,
    'opsChecker',
    'loan.disbursement.approve',
    'USD',
    '1000000',
  );
  await authority(
    f,
    t,
    'opsChecker',
    'loan.writeoff.approve',
    'USD',
    '1000000',
  );
  // Holiday calendar used by the seasonal agriculture template.
  expectOk(
    await f.as('finance').post('/lending/ops/calendars', {
      code: 'KH',
      name: 'Cambodia',
      weekendDays: [6, 7],
      holidays: [{ date: '2026-04-14', name: 'Khmer New Year' }],
    }),
  );
}

/** Maker drafts and submits; a different checker approves and activates. */
export async function activeProduct(
  f: Fixture,
  templateCode: string,
  code: string,
  mutate?: (config: any) => void,
) {
  const tpl = expectOk(
    await f.as('maker').get(`/lending/templates/${templateCode}`),
  );
  const config = structuredClone(tpl.defaultConfig);
  if (mutate) mutate(config);
  const created = expectOk(
    await f.as('maker').post('/lending/products', {
      templateCode,
      code,
      name: `${code} product`,
      config,
    }),
  );
  const vid = created.version.id;
  expectOk(await f.as('maker').post(`/lending/product-versions/${vid}/submit`));
  expectOk(
    await f.as('checker').post(`/lending/product-versions/${vid}/approve`),
  );
  expectOk(
    await f.as('checker').post(`/lending/product-versions/${vid}/activate`),
  );
  return { productId: created.product.id as string, versionId: vid as string };
}

export const PDF = Buffer.from('%PDF-1.4 test document').toString('base64');

export async function docs(f: Fixture, appId: string, codes: string[]) {
  for (const code of codes) {
    expectOk(
      await f.as('ro').post(`/lending/applications/${appId}/documents`, {
        code,
        fileName: `${code}.pdf`,
        mimeType: 'application/pdf',
        contentBase64: PDF,
      }),
    );
  }
}

/** Application → submit → recommend → approve → book → conditions → disbursement. Returns the loan account id. */
export async function originateAndDisburse(
  f: Fixture,
  productId: string,
  terms: Record<string, unknown>,
  opts: {
    docs?: string[];
    collateral?: Record<string, unknown>;
    guarantee?: boolean;
    borrowerOver?: Record<string, unknown>;
    approvers?: string[];
    /** Lend to an existing borrower instead of a new one. */
    borrowerId?: string;
    /** Payees for the payout (UC-05); default: the borrower. */
    payees?: Record<string, unknown>[];
    /** Called after booking, before disbursement (e.g. to record a down payment). */
    beforeDisbursement?: (loanId: string) => Promise<void>;
  } = {},
) {
  const b = opts.borrowerId
    ? { id: opts.borrowerId }
    : await borrower(f, f.t1, f.b1, opts.borrowerOver);
  const app = expectOk(
    await f
      .as('ro')
      .post('/lending/applications', { borrowerId: b.id, productId, terms }),
  );
  await docs(f, app.id, opts.docs ?? ['ID_DOCUMENT']);
  if (opts.collateral)
    expectOk(
      await f
        .as('ro')
        .post(`/lending/applications/${app.id}/collateral`, opts.collateral),
    );
  if (opts.guarantee)
    expectOk(
      await f.as('ro').post(`/lending/applications/${app.id}/guarantees`, {
        guarantorName: 'Chan Sopheap',
        type: 'PERSONAL',
        amount: '1000',
      }),
    );
  expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
  expectOk(
    await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
      recommendation: 'APPROVE',
      rationale: 'Affordable and within policy',
    }),
  );
  for (const approver of opts.approvers ?? ['approver']) {
    expectOk(
      await f.as(approver).post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approved within authority',
      }),
    );
  }
  await acceptKeyFacts(f, app.id);
  const booked = expectOk(
    await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
  );
  const appView = expectOk(
    await f.as('opsMaker').get(`/lending/applications/${app.id}`),
  );
  for (const cp of appView.conditions) {
    expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/applications/${app.id}/conditions/${cp.code}`, {
          resolution: 'SATISFIED',
          evidence: `Evidence for ${cp.code}`,
        }),
    );
  }
  const loanId = booked.account.id as string;
  if (opts.beforeDisbursement) await opts.beforeDisbursement(loanId);
  const task = expectOk(
    await f.as('opsMaker').post(`/lending/loans/${loanId}/disbursements`, {}),
  );
  expectOk(
    await f
      .as('opsChecker')
      .post(`/lending/loans/${loanId}/disbursements/${task.id}/decision`, {
        approve: true,
      }),
  );
  expectOk(
    await f.as('opsChecker').post(
      `/lending/loans/${loanId}/disbursements/execute`,
      {
        externalReference: `BANK-${loanId.slice(0, 8)}`,
        ...(opts.payees ? { payees: opts.payees } : {}),
      },
      `disb-${loanId}`,
    ),
  );
  return {
    loanId,
    applicationId: app.id as string,
    borrowerId: b.id as string,
    booked,
  };
}
