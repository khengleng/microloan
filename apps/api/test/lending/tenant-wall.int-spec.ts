/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: routes and rows are untyped by nature here. */
/**
 * The tenant wall, end to end.
 *
 * Every registered HTTP route is replayed by principals of another tenant —
 * a staff user holding every lending role, a borrower-portal session, a
 * service account and a platform administrator — with path parameters
 * pointing at the victim tenant's records, plus body and header injection of
 * foreign ids. Afterwards:
 *
 *  1. every row owned by any other tenant is byte-for-byte unchanged, and
 *  2. no response carried the id of a row owned by another tenant, other than
 *     ids the caller itself sent.
 *
 * A route whose parameters this suite cannot map fails the suite, so a new
 * route cannot be added without being put through the wall.
 */
import { createHmac } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ModulesContainer } from '@nestjs/core';
import { NotificationsService } from '../../src/notifications/notifications.service';
import {
  Fixture,
  TEST_DB,
  authority,
  bootstrap,
  borrower,
  expectOk,
  grant,
  key,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const ALL_LENDING_ROLES = [
  'TENANT_ADMIN',
  'PRODUCT_MAKER',
  'PRODUCT_CHECKER',
  'RELATIONSHIP_OFFICER',
  'CREDIT_ANALYST',
  'CREDIT_APPROVER',
  'LOAN_OPS_MAKER',
  'LOAN_OPS_CHECKER',
  'COLLECTIONS_OFFICER',
  'RESTRUCTURE_COMMITTEE',
  'FINANCE_OFFICER',
  'RISK_COMPLIANCE',
  'AUDITOR',
];

/** Path parameter → the model whose victim row it names, by route context. */
function modelFor(path: string, prev: string, param: string): string | null {
  const lending = path.startsWith('/v1/lending');
  const p = `${prev}/:${param}`;
  if (lending) {
    const access = path.includes('/lending/access/');
    const table: Record<string, string> = {
      'loans/:id': 'loanAccount',
      'loans/:loanId': 'loanAccount',
      'applications/:id': 'application',
      'groups/:id': 'borrowerGroup',
      'members/:borrowerId': 'borrower',
      'facilities/:id': 'facility',
      'drawdowns/:drawdownId': 'drawdown',
      'conditions/:conditionId': 'facilityCondition',
      'limit-changes/:changeId': 'facilityLimitChange',
      'events/:eventId': 'financialEvent',
      'disbursements/:taskId': 'approvalTask',
      'write-offs/:taskId': 'approvalTask',
      'payment-holidays/:programmeId': 'paymentHolidayProgramme',
      'payment-holiday-programmes/:id': 'paymentHolidayProgramme',
      'products/:id': 'lendingProduct',
      'product-versions/:id': 'productVersion',
      'policy-versions/:id': 'lendingPolicyVersion',
      'restructures/:id': 'restructureCase',
      'proposals/:proposalId': 'restructureProposal',
      'tasks/:id': 'restructureReviewTask',
      'policy/:id': 'affordabilityPolicy',
      'workflows/:id': 'workflowVersion',
      'assignments/:id': 'roleAssignment',
      'authorities/:id': 'approvalAuthority',
      'delegations/:id': 'delegation',
      'changes/:id': 'flagChangeApproval',
      'rules/:id': 'flagRule',
      'service-accounts/:id': 'serviceAccount',
      'suspense/:id': 'unidentifiedPayment',
      'refunds/:taskId': 'approvalTask',
      'advance-refunds/:taskId': 'approvalTask',
      'fee-waivers/:taskId': 'approvalTask',
      'impairment-policy/:id': 'impairmentPolicy',
      'collateral/:collateralId': 'collateralAsset',
      'collateral-releases/:taskId': 'approvalTask',
      'payoff-quotes/:quoteId': 'payoffQuote',
      'tasks/:taskId': 'collectionTask',
      'guarantor-demands/:demandId': 'guarantorDemand',
      'covenants/:covenantId': 'loanCovenant',
      'set-offs/:taskId': 'approvalTask',
      'repossessions/:repossessionId': 'repossession',
      'pawn-items/:itemId': 'pawnItem',
      'insurance-policies/:policyId': 'insurancePolicy',
      'insurance-claims/:claimId': 'insuranceClaim',
      'recovery-tasks/:taskId': 'approvalTask',
      'recovery-refunds/:refundId': 'recoveryRefund',
      'mandates/:mandateId': 'directDebitMandate',
      'files/:fileId': 'channelFile',
      'customers/:borrowerId': 'borrower',
      'documents/:documentId': 'customerDocument',
      'document-requests/:requestId': 'documentRequest',
      // Trade finance and syndication (trade.int-spec, syndication.int-spec create the victims).
      'invoices/:invoiceId': 'tradeInvoice',
      'reserve-payouts/:taskId': 'approvalTask',
      'letters-of-credit/:id': 'letterOfCredit',
      'drawings/:drawingId': 'lcDrawing',
      'participants/:participantId': 'syndicateParticipant',
      'payouts/:taskId': 'approvalTask',
      'cards/:cardId': 'cardAccount',
      'transactions/:transactionId': 'cardTransaction',
      'refunds/:bnplRefundId': 'bnplRefund',
      ':resourceType/:id': 'loanAccount',
    };
    if (p === 'policies/:id') return access ? 'policyVersion' : 'lendingPolicy';
    if (p === 'policies/:versionId') return 'policyVersion';
    return table[p] ?? null;
  }
  const table: Record<string, string> = {
    'loan/:loanId': 'loan',
    'loans/:id': 'loan',
    'loans/:loanId': 'loan',
    'for-loan/:loanId': 'loan',
    'upload/:loanId': 'loan',
    'borrowers/:id': 'borrower',
    'borrower/:borrowerId': 'borrower',
    'kyc/:borrowerId': 'borrower',
    'promises/:promiseId': 'promiseToPay',
    'download/:documentId': 'document',
    'documents/:documentId': 'document',
    'loan-products/:id': 'loanProduct',
    'payment-instruments/:id': 'paymentInstrument',
    'runs/:id': 'provisionRun',
    'repayments/:id': 'repayment',
    'users/:id': 'user',
    'tenants/:id': 'tenant',
    'plan-payments/:paymentId': 'planPayment',
    'document-requests/:requestId': 'documentRequest',
    'my-documents/:documentId': 'customerDocument',
  };
  return table[p] ?? null;
}

/** Literal (non-row) parameters. */
const LITERALS: Record<string, string> = {
  'templates/:code': 'PERSONAL_INSTALMENT',
  'conditions/:code': 'AGREEMENT_SIGNED',
  'capabilities/:resourceType': 'LOAN_ACCOUNT',
  'payment/:reference': 'PAY-0000',
  'periods/:year': '2026',
  ':year/:month': '1',
  'years/:year': '2026',
  'document-links/:token': 'not-a-signed-document-link',
};

/** Global (platform) rows: not tenant data, so no victim to name. */
const PLATFORM_ROWS: Record<string, string> = {
  'plan-tiers/:id': 'planTier',
};

/** Routes outside the wall's subject matter: sign-in flows and health. */
const SKIP = [/^\/v1\/auth\//, /^\/v1\/health/, /^\/v1\/?$/];

/** Plausible bodies, so mutating routes get past validation to the lookup. */
function bodyFor(method: string, path: string): Record<string, unknown> {
  const m = `${method} ${path}`;
  const rules: [RegExp, Record<string, unknown>][] = [
    [/repayments$/, { amount: '10.00' }],
    [/settlement$/, { amount: '10.00' }],
    [/negotiated-settlement$/, { agreedAmount: '10.00', reason: 'wall test' }],
    [/recoveries$/, { amount: '10.00' }],
    [/reverse$/, { reason: 'wall test reversal' }],
    [/write-offs$/, { reason: 'wall test write-off' }],
    [/write-offs\/:taskId\/decision$/, { approve: true }],
    [/disbursements\/:taskId\/decision$/, { approve: true }],
    [/disbursements\/execute$/, { externalReference: 'WALL-TEST' }],
    [
      /applications\/:id\/(approve|reject)$/,
      { rationale: 'wall test rationale' },
    ],
    [
      /applications\/:id\/recommend$/,
      { recommendation: 'APPROVE', rationale: 'wall test rationale' },
    ],
    [/\/(decision|decide)$/, { approve: true, comment: 'wall test' }],
    [/\/reject$/, { reason: 'wall test reason' }],
    [/\/status$/, { status: 'ACTIVE', reason: 'wall test' }],
    [/drawdowns$/, { amount: '10.00' }],
    // Legacy class-validator DTOs.
    [/^PATCH .*promises\/:promiseId$/, { status: 'KEPT' }],
    [/^PATCH .*users\/:id\/password$/, { password: 'Wall-Test-Password-123!' }],
    [/^PUT .*users\/:id\/role$/, { role: 'LOAN_OFFICER' }],
    [
      /agreements\/loan\/:loanId\/sign$/,
      { acceptTerms: true, signatureName: 'Wall Test' },
    ],
    [/kyc\/:borrowerId\/verify$/, { status: 'VERIFIED' }],
    [/loans\/:id\/interactions$/, { notes: 'wall test' }],
    [
      /risk\/loan\/:loanId\/restructure$/,
      { newTermMonths: 12, reason: 'wall test' },
    ],
    [
      /^POST \/v1\/fx\/rates$/,
      { fromCurrency: 'USD', toCurrency: 'KHR', rate: 4100 },
    ],
    [/limit-changes$/, { newLimit: '10.00', reason: 'wall test' }],
  ];
  if (method === 'GET' || method === 'DELETE') return {};
  return rules.find(([r]) => r.test(m))?.[1] ?? {};
}

/**
 * A body that passes the route's own validation, generated from its Zod
 * schema, so the request reaches the record lookup instead of stopping at
 * the door. Ids in the body are random: body injection is tested separately.
 */
function sample(schema: any, keyName = ''): unknown {
  const def = schema?._def;
  switch (def?.typeName) {
    case 'ZodOptional':
    case 'ZodNullable':
      return sample(def.innerType, keyName);
    case 'ZodDefault':
      return def.defaultValue();
    case 'ZodEffects':
      return sample(def.schema, keyName);
    case 'ZodPipeline':
      return sample(def.in, keyName);
    case 'ZodLazy':
      return sample(def.getter(), keyName);
    case 'ZodObject': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(def.shape()))
        if ((v as any)._def.typeName !== 'ZodOptional') out[k] = sample(v, k);
      return out;
    }
    case 'ZodArray': {
      const n = Math.max(1, def.minLength?.value ?? 0);
      return Array.from({ length: n }, () => sample(def.type, keyName));
    }
    case 'ZodRecord':
      return {};
    case 'ZodEnum':
      return def.values[0];
    case 'ZodNativeEnum':
      return Object.values(def.values)[0];
    case 'ZodLiteral':
      return def.value;
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return sample([...(def.options.values?.() ?? def.options)][0], keyName);
    case 'ZodBoolean':
      return true;
    case 'ZodNumber': {
      const min = def.checks?.find((c: any) => c.kind === 'min')?.value;
      return Math.max(1, min ?? 1);
    }
    case 'ZodString': {
      const candidates = [
        '10.00',
        '2026-02-05',
        '0.05',
        'WALL_TEST',
        'WALL-TEST',
        '00000000-0000-4000-8000-000000000001',
        'wall-test@example.com',
        'Wall test reason text',
      ];
      const ok = candidates.find((c) => schema.safeParse(c).success);
      if (/id$/i.test(keyName) && schema.safeParse(candidates[5]).success)
        return candidates[5];
      return ok ?? 'Wall test reason text';
    }
    case 'ZodUnknown':
    case 'ZodAny':
      return {};
    default:
      return undefined;
  }
}

/** METHOD path → the Zod schema validating its body, read from route metadata. */
function zodBodies(app: any): Map<string, any> {
  const methods = [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'ALL',
    'OPTIONS',
    'HEAD',
  ];
  const out = new Map<string, any>();
  for (const mod of app.get(ModulesContainer).values())
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype;
      if (!ctrl?.prototype) continue;
      const base = [].concat(
        Reflect.getMetadata('path', ctrl) ?? '',
      )[0] as string;
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const fn = ctrl.prototype[name];
        if (
          typeof fn !== 'function' ||
          Reflect.getMetadata('method', fn) === undefined
        )
          continue;
        const sub = [].concat(
          Reflect.getMetadata('path', fn) ?? '',
        )[0] as string;
        const verb = methods[Reflect.getMetadata('method', fn)];
        const args =
          Reflect.getMetadata('__routeArguments__', ctrl, name) ?? {};
        for (const [k, a] of Object.entries<any>(args))
          if (k.startsWith('3:'))
            for (const pipe of a.pipes ?? [])
              if (pipe?.schema)
                out.set(
                  `${verb} ${`/v1/${base}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, '')}`,
                  pipe.schema,
                );
      }
    }
  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

d('Tenant wall (integration)', () => {
  let f: Fixture;
  let attacker: string;
  let borrowerToken: string;
  let serviceKey: string;
  const findings: string[] = [];
  const exercised = new Set<string>();
  const unexercised = new Set<string>();

  beforeAll(async () => {
    f = await bootstrap();
    attacker = f.t2;
    // ── The victim: tenant 1 with a live loan, a policy and the usual paperwork.
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'WALL-PL',
    );
    const { loanId, borrowerId: victimBorrowerId } = await originateAndDisburse(
      f,
      productId,
      {
        principal: '5000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      },
    );
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/repayments`,
          { amount: '50.00' },
          key('w'),
        ),
    );
    // A document the victim asked its customer for (DOC-10); the library
    // already holds the application's ID document and the key facts.
    expectOk(
      await f
        .as('ro')
        .post(`/lending/customers/${victimBorrowerId}/document-requests`, {
          category: 'KYC',
          typeCode: 'PROOF_OF_ADDRESS',
          label: 'Proof of address',
        }),
    );
    // An unidentified receipt held for the victim.
    expectOk(
      await f.as('opsMaker').post(
        '/lending/suspense',
        {
          amount: '25.00',
          currency: 'USD',
          channel: 'BANK_TRANSFER',
          externalReference: 'VICTIM-UNID',
        },
        key('vsus'),
      ),
    );
    // A direct-debit mandate and an imported settlement file (UC-16, UC-18).
    expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/mandates`, {
        mandateReference: `WALL-DD-${key('m')}`.slice(0, 60),
        bankCode: 'ABA',
        accountNumber: '0001234567',
        accountName: 'Victim Borrower',
        consentDate: '2026-01-05',
      }),
    );
    expectOk(
      await f
        .as('opsMaker')
        .post('/lending/payment-channels/settlement-files', {
          channel: 'WALLET',
          fileName: 'victim-wallet.csv',
          content: `reference,loan_ref,amount,currency,value_date,channel_txn_id\nV1,,5.00,USD,2026-01-05,${key('vtx')}\n`,
        }),
    );
    expectOk(
      await f.as('maker').post('/lending/policies', {
        kind: 'LATE_CHARGES',
        code: 'L-WALL',
        name: 'Wall test late charges',
        body: { penalty: { type: 'NONE' } },
      }),
    );
    // Victim records the API has no quick path to: the legacy loan book and
    // tenant configuration awaiting approval.
    await f.system(async () => {
      const t = f.t1;
      const p = f.prisma;
      const b = await borrower(f, t, f.b1, { firstName: 'Victim' });
      const product = await p.loanProduct.create({
        data: {
          tenantId: t,
          name: 'Victim daily loan',
          interestMethod: 'FLAT',
        },
      });
      const loan = await p.loan.create({
        data: {
          tenantId: t,
          borrowerId: b.id,
          productId: product.id,
          branchId: f.b1,
          principal: '1000',
          annualInterestRate: '12',
          termMonths: 6,
          interestMethod: 'FLAT',
          startDate: new Date(Date.UTC(2026, 0, 5)),
        },
      });
      await p.repayment.create({
        data: { tenantId: t, loanId: loan.id, amount: '10' },
      });
      await p.document.create({
        data: {
          tenantId: t,
          loanId: loan.id,
          name: 'victim.pdf',
          content: 'data:application/pdf;base64,AAAA',
          type: 'application/pdf',
        },
      });
      await p.promiseToPay.create({
        data: {
          tenantId: t,
          loanId: loan.id,
          amount: '10',
          promisedDate: new Date(Date.UTC(2026, 1, 1)),
        },
      });
      await p.provisionRun.create({ data: { tenantId: t } });
      await p.paymentInstrument.create({
        data: { tenantId: t, label: 'Victim bank' },
      });
      await p.planPayment.create({
        data: {
          tenantId: t,
          plan: 'BASIC',
          amount: '10',
          reference: `PAY-${key('v')}`,
          qrPayload: 'qr',
          expiresAt: new Date(Date.UTC(2030, 0, 1)),
        },
      });
      await p.workflowVersion.create({
        data: {
          tenantId: t,
          code: 'VICTIM_FLOW',
          version: 1,
          name: 'Victim workflow',
          definition: {},
          makerId: f.users.admin1.id,
        },
      });
      const policy = await p.accessPolicy.create({
        data: { tenantId: t, code: 'VICTIM_POLICY', name: 'Victim policy' },
      });
      await p.policyVersion.create({
        data: {
          tenantId: t,
          policyId: policy.id,
          version: 1,
          rules: [],
          makerId: f.users.admin1.id,
        },
      });
      await p.affordabilityPolicy.create({
        data: {
          tenantId: t,
          version: 1,
          settings: {},
          makerId: f.users.admin1.id,
        },
      });
    });
    // ── The attacker: tenant 2's admin holding every lending role there.
    for (const role of ALL_LENDING_ROLES)
      await grant(f, attacker, 't2admin', role);
    for (const p of [
      'credit_decision.approve',
      'loan.disbursement.approve',
      'loan.writeoff.approve',
    ])
      await authority(f, attacker, 't2admin', p, 'USD', '100000000');
    const own = await borrower(f, attacker, f.b3);
    borrowerToken = new JwtService({
      secret: createHmac('sha256', process.env.JWT_ACCESS_SECRET!)
        .update('borrower-portal-v1')
        .digest('hex'),
    }).sign(
      { sub: own.id, typ: 'borrower', tenantId: attacker },
      { expiresIn: '1h' },
    );
    serviceKey = expectOk(
      await f.as('t2admin').post('/lending/access/service-accounts', {
        name: 'Attacker feed',
        scopes: ['loan.repayment.post', 'loan.read'],
      }),
    ).key;
  }, 120_000);
  afterAll(async () => f?.app.close());

  /** Every row owned by a tenant other than the attacker, hashed per table. */
  async function fingerprint(): Promise<Record<string, string>> {
    return f.system(async () => {
      const tables: { table_name: string }[] = await f.prisma.$queryRawUnsafe(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenantId'
            AND table_name <> 'AuditEvent'`,
      );
      const out: Record<string, string> = {};
      for (const { table_name: t } of tables) {
        const [row]: { n: bigint; h: string | null }[] =
          await f.prisma.$queryRawUnsafe(
            `SELECT count(*) AS n, md5(string_agg(md5(x::text), '' ORDER BY md5(x::text))) AS h
               FROM "${t}" x WHERE x."tenantId" IS DISTINCT FROM $1`,
            attacker,
          );
        out[t] = `${row.n}:${row.h}`;
      }
      const [tenants]: { h: string }[] = await f.prisma.$queryRawUnsafe(
        `SELECT md5(string_agg(md5(x::text), '' ORDER BY x.id)) AS h FROM "Tenant" x WHERE x.id <> $1`,
        attacker,
      );
      out.Tenant = tenants.h;
      return out;
    });
  }

  /** id → owning tenant, for every tenant-owned row. */
  async function owners(): Promise<Map<string, string>> {
    return f.system(async () => {
      const tables: { table_name: string }[] = await f.prisma.$queryRawUnsafe(
        `SELECT c.table_name FROM information_schema.columns c
          JOIN information_schema.columns i
            ON i.table_name = c.table_name AND i.table_schema = c.table_schema AND i.column_name = 'id'
          WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'`,
      );
      const map = new Map<string, string>();
      for (const { table_name: t } of tables) {
        const rows: { id: string; tenantId: string | null }[] =
          await f.prisma.$queryRawUnsafe(
            `SELECT id::text AS id, "tenantId" FROM "${t}" WHERE "tenantId" IS NOT NULL`,
          );
        for (const r of rows) map.set(r.id, r.tenantId!);
      }
      return map;
    });
  }

  async function victimId(model: string): Promise<string | null> {
    if (model === 'tenant') return f.t1;
    if (model === 'user') return f.users.admin1.id;
    return f.system(async () => {
      const delegate = f.prisma[model];
      if (!delegate) throw new Error(`No Prisma model ${model}`);
      const row =
        (await delegate.findFirst({
          where: { tenantId: f.t1 },
          select: { id: true },
        })) ??
        (await delegate.findFirst({
          where: { tenantId: { notIn: [attacker] } },
          select: { id: true },
        }));
      return row?.id ?? null;
    });
  }

  function routes(): { method: string; path: string }[] {
    const inst = f.app.getHttpAdapter().getInstance();
    const stack = (inst.router ?? inst._router).stack;
    const out: { method: string; path: string }[] = [];
    for (const l of stack)
      if (l.route)
        for (const m of Object.keys(l.route.methods))
          out.push({ method: m.toUpperCase(), path: l.route.path });
    return out.filter(({ path }) => !SKIP.some((s) => s.test(path)));
  }

  async function call(
    who: 'staff' | 'borrower' | 'service' | 'platform',
    method: string,
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    let r = f.http()[method.toLowerCase() as 'get'](url);
    if (who === 'staff')
      r = r.set('Authorization', `Bearer ${f.tokens.t2admin}`);
    if (who === 'platform')
      r = r.set('Authorization', `Bearer ${f.tokens.platform}`);
    if (who === 'borrower')
      r = r.set('Authorization', `Bearer ${borrowerToken}`);
    if (who === 'service') r = r.set('X-Service-Key', serviceKey);
    r = r.set('Idempotency-Key', key('wall'));
    for (const [h, v] of Object.entries(headers)) r = r.set(h, v);
    return method === 'GET' || method === 'DELETE' ? r : r.send(body);
  }

  it('maps every route parameter to a victim record (no route escapes the wall)', () => {
    const unmapped: string[] = [];
    for (const { method, path } of routes()) {
      const segs = path.split('/');
      segs.forEach((s, i) => {
        if (!s.startsWith(':')) return;
        const prev = segs[i - 1];
        const p = `${prev}/${s}`;
        if (LITERALS[p] || PLATFORM_ROWS[p]) return;
        if (!modelFor(path, prev, s.slice(1)))
          unmapped.push(`${method} ${path} (${p})`);
      });
    }
    expect(unmapped).toEqual([]);
  });

  it('no principal of another tenant can read or change the victim through any route', async () => {
    const before = await fingerprint();
    const own = await owners();
    const bodies = zodBodies(f.app);
    const whoFor = (
      path: string,
    ): ('staff' | 'borrower' | 'service' | 'platform')[] => {
      if (
        path.startsWith('/v1/borrower') ||
        path.startsWith('/v1/lending/portal')
      )
        return ['borrower', 'staff'];
      if (path.startsWith('/v1/lending/integrations'))
        return ['service', 'staff'];
      // Platform administrators legitimately manage tenants; they must still
      // never see a tenant's lending data.
      if (path.startsWith('/v1/lending')) return ['staff', 'platform'];
      return ['staff'];
    };
    for (const { method, path } of routes()) {
      const sent = new Set<string>();
      let url = path;
      let skip = false;
      const segs = path.split('/');
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (!s.startsWith(':')) continue;
        const prev = segs[i - 1];
        const p = `${prev}/${s}`;
        let value = LITERALS[p];
        if (!value && PLATFORM_ROWS[p])
          value = '00000000-0000-4000-8000-000000000000';
        if (!value) {
          const model = modelFor(path, prev, s.slice(1))!;
          const id = await victimId(model);
          if (!id) {
            unexercised.add(
              `${method} ${path}: no ${model} row in another tenant`,
            );
            skip = true;
            break;
          }
          value = id;
        }
        sent.add(value);
        url = url.replace(s, value);
      }
      if (skip) continue;
      // Exports take their format in the query; without it they stop at validation.
      if (/\/export$/.test(path)) url += '?format=csv';
      for (const who of whoFor(path)) {
        const schema = bodies.get(`${method} ${path}`);
        const body = schema
          ? (sample(schema) as Record<string, unknown>)
          : bodyFor(method, path);
        const res = await call(who, method, url, body);
        exercised.add(`${method} ${path}`);
        if (process.env.WALL_DEBUG)
          console.log(
            `WALL ${who} ${res.status} ${method} ${path} ${(res.body?.message ?? '').toString().slice(0, 90)}`,
          );
        const text = res.text ?? '';
        for (const id of text.match(UUID) ?? []) {
          const owner = own.get(id);
          if (owner && owner !== attacker && !sent.has(id))
            findings.push(
              `${who} ${method} ${url} → ${res.status} leaked ${id} of tenant ${owner}`,
            );
        }
        // 503 is a feature switched off (billing provider unconfigured), not a fault.
        if (res.status >= 500 && res.status !== 503)
          findings.push(
            `${who} ${method} ${url} → ${res.status} ${text.slice(0, 160)}`,
          );
      }
    }
    expect(findings).toEqual([]);
    expect(await fingerprint()).toEqual(before);
    // In the full suite (WALL_STRICT=1, run last) every route must have been
    // attacked with a real victim row; run alone, the gaps are only reported.
    if (process.env.WALL_STRICT === '1') expect([...unexercised]).toEqual([]);
    if (unexercised.size)
      // Rows that only other suites create; exercised when the whole suite runs.
      console.info(
        `Tenant wall: ${exercised.size} routes exercised; not exercised:\n  ${[...unexercised].join('\n  ')}`,
      );
  }, 600_000);

  it('a foreign id smuggled in a request body is refused', async () => {
    const before = await fingerprint();
    const victimBorrower = await victimId('borrower');
    const victimProduct = await victimId('lendingProduct');
    const victimLoan = await victimId('loanAccount');
    const victimUser = f.users.admin1.id;
    const victimRole = await victimId('accessRole');
    const ownProduct = (await activeProductFor(f, 't2admin', 'WALL-T2'))
      .productId;
    const ownBorrower = (await borrower(f, attacker, f.b3)).id;
    const cases: [string, string, Record<string, unknown>][] = [
      [
        'POST',
        '/v1/lending/applications',
        {
          borrowerId: victimBorrower,
          productId: ownProduct,
          terms: {
            principal: '1000',
            numberOfInstalments: 6,
            disbursementDate: '2026-01-05',
          },
        },
      ],
      [
        'POST',
        '/v1/lending/applications',
        {
          borrowerId: ownBorrower,
          productId: victimProduct,
          terms: {
            principal: '1000',
            numberOfInstalments: 6,
            disbursementDate: '2026-01-05',
          },
        },
      ],
      [
        'POST',
        '/v1/lending/applications',
        {
          borrowerId: ownBorrower,
          productId: ownProduct,
          refinancesLoanId: victimLoan,
          terms: {
            principal: '1000',
            numberOfInstalments: 6,
            disbursementDate: '2026-01-05',
          },
        },
      ],
      [
        'POST',
        '/v1/lending/applications',
        {
          borrowerId: ownBorrower,
          productId: ownProduct,
          branchId: f.b1,
          terms: {
            principal: '1000',
            numberOfInstalments: 6,
            disbursementDate: '2026-01-05',
          },
        },
      ],
      [
        'POST',
        '/v1/lending/access/assignments',
        { userId: victimUser, roleId: victimRole, allBranches: true },
      ],
      [
        'POST',
        '/v1/lending/access/assignments',
        { userId: f.users.t2ops.id, roleId: victimRole, allBranches: true },
      ],
      [
        'POST',
        '/v1/lending/access/delegations',
        {
          delegateId: victimUser,
          permissions: ['loan.read'],
          expiresAt: '2030-01-01',
        },
      ],
      [
        'POST',
        '/v1/lending/applications/groups',
        {
          name: 'Wall group',
          branchId: f.b1,
          members: [{ borrowerId: victimBorrower }],
        },
      ],
      [
        'POST',
        '/v1/loans',
        {
          borrowerId: victimBorrower,
          productId: victimProduct,
          principal: 1000,
        },
      ],
      ['POST', '/v1/repayments', { loanId: victimLoan, amount: 10 }],
      [
        'POST',
        '/v1/users',
        {
          email: 'wall@test.local',
          role: 'LOAN_OFFICER',
          branchId: f.b1,
          password: 'Sup3r-secret-pass!',
        },
      ],
    ];
    // A document on the attacker's own loan pointing at the victim's file.
    const ownLoan = await f.system(async () => {
      const lp = await f.prisma.loanProduct.create({
        data: {
          tenantId: attacker,
          name: 'Attacker product',
          interestMethod: 'FLAT',
        },
      });
      return f.prisma.loan.create({
        data: {
          tenantId: attacker,
          borrowerId: ownBorrower,
          productId: lp.id,
          branchId: f.b3,
          principal: '100',
          annualInterestRate: '12',
          termMonths: 3,
          interestMethod: 'FLAT',
          startDate: new Date(Date.UTC(2026, 0, 5)),
        },
      });
    });
    const victimLegacyLoan = await victimId('loan');
    cases.push([
      'POST',
      `/v1/loans/${ownLoan.id}/documents`,
      {
        name: 'x.pdf',
        type: 'application/pdf',
        content: `tenants/${f.t1}/loans/${victimLegacyLoan}/1_victim.pdf`,
      },
    ]);
    // DOC-1: a document filed for the attacker's own customer may not be
    // linked to the victim's application or loan, nor ask for its documents.
    const victimApplication = await victimId('application');
    const pdf = Buffer.from('%PDF-1.4 wall').toString('base64');
    for (const link of [
      { applicationId: victimApplication },
      { loanAccountId: victimLoan },
    ])
      cases.push([
        'POST',
        `/v1/lending/customers/${ownBorrower}/documents`,
        {
          category: 'OTHER',
          typeCode: 'WALL_TEST',
          fileName: 'x.pdf',
          mimeType: 'application/pdf',
          contentBase64: pdf,
          ...link,
        },
      ]);
    cases.push([
      'POST',
      `/v1/lending/customers/${ownBorrower}/document-requests`,
      {
        category: 'OTHER',
        typeCode: 'WALL_TEST',
        label: 'Wall test',
        applicationId: victimApplication,
      },
    ]);
    const own = await owners();
    for (const [method, url, body] of cases) {
      const res = await call('staff', method, url, body);
      expect([400, 403, 404, 409, 422]).toContain(res.status);
      for (const id of res.text.match(UUID) ?? []) {
        const owner = own.get(id);
        const sentIds = JSON.stringify(body);
        if (owner && owner !== attacker && !sentIds.includes(id))
          findings.push(`${method} ${url} leaked ${id}`);
      }
    }
    expect(findings).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  }, 120_000);

  it('a tenant named in a header, query or body is ignored or refused, never obeyed', async () => {
    const victimLoan = await victimId('loanAccount');
    for (const [h, v] of [
      ['X-Tenant-Id', f.t1],
      ['X-Tenant', f.t1],
      ['Tenant-Id', f.t1],
    ]) {
      const list = await call(
        'staff',
        'GET',
        '/v1/lending/loans',
        {},
        { [h]: v },
      );
      expect(list.text).not.toContain(victimLoan!);
    }
    const q = await call(
      'staff',
      'GET',
      `/v1/lending/loans?tenantId=${f.t1}`,
      {},
    );
    expect(q.status).toBe(403);
    const b = await call('staff', 'POST', '/v1/lending/loans/batch/run', {
      tenantId: f.t1,
    });
    expect(b.status).toBe(403);
  });

  it('a borrower token cannot be replayed as staff, nor re-scoped to another tenant', async () => {
    const asStaff = await f
      .http()
      .get('/v1/lending/loans')
      .set('Authorization', `Bearer ${borrowerToken}`);
    expect([401, 403]).toContain(asStaff.status);
    const victimBorrower = await victimId('borrower');
    const forged = new JwtService({
      secret: createHmac('sha256', process.env.JWT_ACCESS_SECRET!)
        .update('borrower-portal-v1')
        .digest('hex'),
    }).sign(
      { sub: victimBorrower, typ: 'borrower', tenantId: attacker },
      { expiresIn: '1h' },
    );
    const res = await f
      .http()
      .get('/v1/borrower/loans')
      .set('Authorization', `Bearer ${forged}`);
    expect([401, 403]).toContain(res.status);
  });

  it('a phone shared by two organisations signs in only where its code was issued, with guesses capped', async () => {
    const sms: string[] = [];
    const spy = jest
      .spyOn(f.app.get(NotificationsService), 'sendSms')
      .mockImplementation(async (_to: string, body: string) => {
        sms.push(body);
        return undefined as never;
      });
    try {
      // Unique per run: issuance is capped per phone across runs too.
      const phone = `+8551${String(Date.now()).slice(-8)}`;
      const a = await borrower(f, f.t1, f.b1, { phone, firstName: 'Shared' });
      const b = await borrower(f, attacker, f.b3, {
        phone,
        firstName: 'Shared',
      });
      // The attacker's record is the most recently touched one.
      await f.system(() =>
        f.prisma.borrower.update({
          where: { id: b.id },
          data: { firstName: 'Touched' },
        }),
      );
      expectOk(await f.http().post('/v1/borrower/otp/request').send({ phone }));
      expect(sms).toHaveLength(1);
      const codes = [...sms[0].matchAll(/: (\d{6})/g)].map((m) => m[1]);
      expect(codes).toHaveLength(2);
      const tenantOf = async (code: string) => {
        const r = await f
          .http()
          .post('/v1/borrower/otp/verify')
          .send({ phone, code });
        return r.status === 201 || r.status === 200
          ? (r.body.borrower.id as string)
          : r.status;
      };
      // Wrong guesses spend attempts; the victim's own code still signs in to
      // the victim's organisation, never the attacker's.
      expect(await tenantOf('000000')).toBe(401);
      const signedIn = await tenantOf(codes[0]);
      // Codes are listed oldest borrower first: the first is the victim's.
      expect(signedIn).toBe(a.id);
      // Codes are single-use: the other organisation's code is consumed too.
      expect(await tenantOf(codes[1])).toBe(401);

      // Re-requesting cannot reset the attempt limit indefinitely.
      for (let i = 0; i < 5; i++)
        await f.http().post('/v1/borrower/otp/request').send({ phone });
      expect(sms.length).toBeLessThanOrEqual(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('the database itself hides and refuses other tenants’ rows (row-level security, raw SQL)', async () => {
    // Raw SQL skips the Prisma guard entirely: this is the second wall alone.
    const [role]: { rolsuper: boolean; rolbypassrls: boolean }[] =
      await f.prisma.$queryRawUnsafe(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

    const victimLoan = await victimId('loanAccount');
    const victimProduct = await victimId('lendingProduct');
    const asAttacker = <T>(fn: (tx: any) => Promise<T>) =>
      f.prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true)`,
          attacker,
        );
        return fn(tx);
      });
    const seen = await asAttacker((tx) =>
      tx.$queryRawUnsafe(
        'SELECT id FROM "LoanAccount" WHERE id = $1 UNION ALL SELECT id FROM "LendingProduct" WHERE id = $2',
        victimLoan,
        victimProduct,
      ),
    );
    expect(seen).toEqual([]);
    const changed = await asAttacker((tx) =>
      tx.$executeRawUnsafe(
        'UPDATE "LendingProduct" SET name = name WHERE id = $1',
        victimProduct,
      ),
    );
    expect(changed).toBe(0);
    await expect(
      asAttacker((tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "LegalEntity" (id, "tenantId", code, name) VALUES (gen_random_uuid()::text, $1, 'WALL', 'Wall')`,
          f.t1,
        ),
      ),
    ).rejects.toThrow(/row-level security/);

    // Every tenant-owned lending, access and configuration table is covered.
    const uncovered: { relname: string }[] = await f.prisma.$queryRawUnsafe(`
      SELECT c.relname FROM pg_class c
        JOIN information_schema.columns col
          ON col.table_name = c.relname AND col.column_name = 'tenantId' AND col.table_schema = 'public'
       WHERE c.relkind = 'r'
         AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
       ORDER BY 1`);
    const legacy = new Set([
      // The legacy core app's tables: guarded by the Prisma tenant guard;
      // row-level security for them is tracked in docs/security/TENANT_ISOLATION.md.
      'AuditEvent',
      'AuditLog',
      'Borrower',
      'BorrowerOtp',
      'Branch',
      'Collateral',
      'CreditCheck',
      'CreditScore',
      'Document',
      'ExchangeRate',
      'FederatedIdentity',
      'Guarantor',
      'JournalEntry',
      'JournalLine',
      'KycDocument',
      'LedgerAccount',
      'Loan',
      'LoanAgreement',
      'LoanProduct',
      'LoanProvision',
      'LoanRestructure',
      'PasswordResetToken',
      'PaymentInstrument',
      'PlanPayment',
      'PromiseToPay',
      'ProvisionRun',
      'RefreshToken',
      'Repayment',
      'RepaymentSchedule',
      'User',
    ]);
    expect(
      uncovered.map((r) => r.relname).filter((t) => !legacy.has(t)),
    ).toEqual([]);
  });

  it('a staff token whose tenant claim is swapped cannot reach the victim', async () => {
    const victimLoan = await victimId('loanAccount');
    const forged = new JwtService({
      secret: process.env.JWT_ACCESS_SECRET,
    }).sign(
      {
        sub: f.users.t2admin.id,
        email: 'x@test.local',
        role: 'TENANT_ADMIN',
        tenantId: f.t1,
        amr: 'mfa',
      },
      { expiresIn: '1h' },
    );
    const res = await f
      .http()
      .get(`/v1/lending/loans/${victimLoan}`)
      .set('Authorization', `Bearer ${forged}`);
    expect([401, 403, 404]).toContain(res.status);
  });
});

/** A product in the attacker's own tenant, made and approved there. */
async function activeProductFor(f: Fixture, user: string, code: string) {
  const tpl = expectOk(
    await f.as(user).get('/lending/templates/PERSONAL_INSTALMENT'),
  );
  const created = expectOk(
    await f.as(user).post('/lending/products', {
      templateCode: 'PERSONAL_INSTALMENT',
      code,
      name: `${code} product`,
      config: tpl.defaultConfig,
    }),
  );
  return { productId: created.product.id as string };
}
