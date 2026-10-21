import { ForbiddenException, Logger } from '@nestjs/common';
import { Prisma as PrismaRuntime } from '@microloan/db';
import type { Prisma, PrismaClient } from '@microloan/db';
import { getTenantContext, runAsSystem, TenantContext } from './tenant-context';

/**
 * Database-level Chinese wall.
 *
 * Tenant isolation used to rest entirely on each service remembering to call
 * `AuthzService.scopeWhere()`. That is a convention, not a control: one query
 * written without it leaks across tenants silently and forever. This middleware
 * turns the convention into an enforced invariant — every query against a
 * tenant-owned table is either scoped to the caller's tenant or rejected.
 *
 * It is a backstop, not a replacement. Services should still scope explicitly
 * so that "not found" stays a 404 rather than surfacing here as a 403.
 *
 * KNOWN LIMIT: `$queryRaw` / `$executeRaw` are not scoped by this guard (it
 * only sees a model and its arguments). Raw SQL against tenant-owned tables
 * should still scope by hand; behind it, row-level security admits only the
 * declared tenant's rows to raw SQL too (db-tenant-context.ts,
 * docs/security/RLS.md, D-141).
 */

/** Models carrying their own `tenantId` column — scoped directly. */
const DIRECT_TENANT_MODELS = new Set([
  'Branch',
  'User',
  'Borrower',
  'BorrowerOtp',
  'KycDocument',
  'LoanProduct',
  'Loan',
  'CreditScore',
  'LoanRestructure',
  'Repayment',
  'AuditLog',
  'Document',
  'ExchangeRate',
  'LedgerAccount',
  'JournalEntry',
  'ProvisionRun',
  'CreditCheck',
  'PaymentInstrument',
  'LoanAgreement',
  'PromiseToPay',
  'PlanPayment',
  // Lending platform
  'LegalEntity',
  'Portfolio',
  'TenantBusinessDate',
  'HolidayCalendar',
  'AccessRole',
  'RoleAssignment',
  'Delegation',
  'ApprovalAuthority',
  'AccessPolicy',
  'PolicyVersion',
  'FlagRule',
  'FlagChangeApproval',
  'CohortMembership',
  'ServiceAccount',
  'WorkflowVersion',
  'LendingProduct',
  'ProductVersion',
  'LendingPolicy',
  'LendingPolicyVersion',
  'UnidentifiedPayment',
  'UnidentifiedPaymentMatch',
  'ImpairmentPolicy',
  'MarginCall',
  'PayoffQuote',
  'CollectionTask',
  'GuarantorDemand',
  'CollectionPromise',
  'LoanCovenant',
  'AccountingPeriod',
  'MigrationBatch',
  'WebhookEndpoint',
  'WebhookDelivery',
  'MigrationRow',
  'PeriodCloseLog',
  'RegulatoryReturn',
  'ProjectFinance',
  'ProjectWaterfallRun',
  'BorrowingBaseCertificate',
  'CovenantTest',
  // Payment channels (UC-16, UC-18, UC-19, UC-21)
  'PaymentChannelSettings',
  'DirectDebitMandate',
  'AutoDebitAttempt',
  'ChannelFile',
  'ChannelFileLine',
  'CustomerDocument',
  'CustomerDocumentVersion',
  'DocumentRequest',
  'DocumentRetentionRule',
  // Trade finance and syndication (LT-18, LT-19, LT-24)
  'TradeInvoice',
  'TradeInvoiceCollection',
  'LetterOfCredit',
  'LcDrawing',
  'Syndicate',
  'SyndicateParticipant',
  'ParticipationEntry',
  // Bought receivables and documentary trade loans
  'TradeReceivable',
  'TradeSupplier',
  'TradeTransaction',
  'TradeDocument',
  'TradeProceeds',
  // Specialised products: cards (LT-07), BNPL (LT-11), leases (LT-15)
  'CardAccount',
  'CardTransaction',
  'CardStatement',
  'CardInstalmentPlan',
  'BnplPlan',
  'BnplRefund',
  'LeaseAsset',
  // Institutional lending, income-contingent repayment, Murabaha
  'Counterparty',
  'ExposureLimit',
  'IncomeAssessment',
  'MurabahaContract',
  // Tenant lending settings (maker-checker) and durable scheduled-job claims
  'TenantLendingSettings',
  'ScheduledJobClaim',
  // Scorecards, score evaluations and alternative data (D-075…D-080)
  'Scorecard',
  'ScorecardVersion',
  'ScoreEvaluation',
  'AltDataConsent',
  'AltDataRecord',
  'AltDataProviderConfig',
  // Credit reports (in-house bureau), append-only per tenant (D-176…D-181)
  'CreditReport',
  // Learning centre progress, per person and lesson (D-094)
  'LearningProgress',
  // AML/CFT: watch lists, screening cases, re-screens, EDD, STR (D-118…D-122)
  'AmlWatchListVersion',
  'AmlWatchListEntry',
  'AmlScreeningCase',
  'AmlRescreenJob',
  'AmlEddRecord',
  'AmlStrCase',
  'PricingConfiguration',
  'RepaymentConfiguration',
  'RateObservation',
  'BorrowerGroup',
  'GroupMembership',
  'Application',
  'ApplicationDocument',
  'KeyFactsStatement',
  'CreditDecision',
  'ApprovalTask',
  'ConditionPrecedent',
  'CollateralAsset',
  'Valuation',
  'CollateralPledge',
  'Guarantee',
  'Facility',
  'Drawdown',
  'FacilityCondition',
  'FacilityStatement',
  'FacilityLimitChange',
  'RateReset',
  'LoanGroupMember',
  'GroupContribution',
  'PaymentHolidayProgramme',
  'PaymentHolidayEnrolment',
  'RefinanceRecord',
  'LendingAgreement',
  'AgreementVersion',
  'LoanAccount',
  'ScheduleInstalment',
  'AccrualEvent',
  'PenaltyAccrual',
  'FinancialEvent',
  'PaymentAllocation',
  'LendingJournalEntry',
  'LendingJournalLine',
  'OutboxMessage',
  // tenantId is null for platform-level events, which tenant principals never see.
  'AuditEvent',
  // Operational alerts (D-150): null tenantId for platform-wide alerts, likewise.
  'OperationalAlert',
  // Go-live setup: items a tenant administrator marked not applicable (D-172).
  'GoLiveSetupWaiver',
  'AffordabilityPolicy',
  'RestructureCase',
  'RestructureEvidence',
  'AffordabilityAssessment',
  'RestructureProposal',
  'RestructureApproval',
  'RestructureAcceptance',
  'RestructureCondition',
  'RestructureReviewTask',
  'LoanAmendment',
  // Recovery workflows
  'Repossession',
  'PawnItem',
  'InsurancePolicy',
  'InsuranceClaim',
  'DebtSale',
  'RecoveryRefund',
]);

/**
 * Models with no `tenantId` of their own. They are reachable directly through
 * Prisma even though the app only ever intends to reach them via their parent,
 * so they are scoped through the parent relation. Without this, a query on
 * `repaymentSchedule` or `journalLine` would sail straight past the wall.
 */
type RelationScope = { relation: string; fk: string; parentDelegate: string };
const RELATION_SCOPED_MODELS: Record<string, RelationScope> = {
  PasswordResetToken: {
    relation: 'user',
    fk: 'userId',
    parentDelegate: 'user',
  },
  RefreshToken: { relation: 'user', fk: 'userId', parentDelegate: 'user' },
  MfaChallenge: { relation: 'user', fk: 'userId', parentDelegate: 'user' },
  FederatedIdentity: { relation: 'user', fk: 'userId', parentDelegate: 'user' },
  LoanPolicy: {
    relation: 'product',
    fk: 'productId',
    parentDelegate: 'loanProduct',
  },
  Collateral: { relation: 'loan', fk: 'loanId', parentDelegate: 'loan' },
  Guarantor: { relation: 'loan', fk: 'loanId', parentDelegate: 'loan' },
  LoanInteraction: { relation: 'loan', fk: 'loanId', parentDelegate: 'loan' },
  RepaymentSchedule: { relation: 'loan', fk: 'loanId', parentDelegate: 'loan' },
  JournalLine: {
    relation: 'entry',
    fk: 'entryId',
    parentDelegate: 'journalEntry',
  },
  LoanProvision: {
    relation: 'run',
    fk: 'runId',
    parentDelegate: 'provisionRun',
  },
  RolePermission: {
    relation: 'role',
    fk: 'roleId',
    parentDelegate: 'accessRole',
  },
  Holiday: {
    relation: 'calendar',
    fk: 'calendarId',
    parentDelegate: 'holidayCalendar',
  },
};

/**
 * How a model without its own tenantId reaches its tenant (the tenant
 * archive written before a purge walks the same relations).
 */
export function relationScopeFor(model: string): RelationScope | undefined {
  return RELATION_SCOPED_MODELS[model];
}

/** The tenant row itself is scoped by primary key, not by a `tenantId` column. */
const TENANT_MODEL = 'Tenant';

/**
 * Platform-owned configuration: no tenantId, and no tenant principal may read
 * or write it at all.
 *
 * Listing these explicitly matters. A model that is simply absent from every
 * set falls through `isGuarded` and is waved past the wall — which is the
 * correct behaviour for genuinely tenant-neutral tables, and exactly the wrong
 * behaviour for platform secrets. Anything holding operator payment details
 * belongs here.
 */
const PLATFORM_ONLY_MODELS = new Set([
  'PlatformPaymentQr',
  // Second-super-administrator approvals and the archives a tenant purge needs (D-130, D-131).
  'PlatformApproval',
  'TenantArchive',
  // Stripe deliveries already handled (D-166): written by the webhook as system.
  'StripeWebhookEvent',
]);

/**
 * Platform-owned *catalogue*: written only by the platform, but legitimately
 * read by everyone — including unauthenticated callers.
 *
 * `PlanTier` cannot go in PLATFORM_ONLY_MODELS: the quota guard reads the
 * caller's own ceilings on every quota-checked write, and the signup page reads
 * the price list before anyone has an account. Nor can it be left unclassified,
 * because then a tenant principal could write it. So it is its own category —
 * the read is open, the write is not.
 */
const PLATFORM_CATALOGUE_MODELS = new Set([
  'PlanTier',
  // Lending platform catalogue: read by every tenant, written only by the platform (or the boot-time sync).
  'LoanFamily',
  'ProductTemplate',
  'AccessPermission',
  'FeatureFlag',
  'PlatformFlagRule',
]);

const READ_ACTIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const WHERE_SCOPED_ACTIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);
const UNIQUE_READ_ACTIONS = new Set(['findUnique', 'findUniqueOrThrow']);
const SINGLE_WRITE_ACTIONS = new Set(['update', 'delete']);

export type TenantGuardMode = 'enforce' | 'warn';

/** The single delegate method the guard needs for its ownership look-ups. */
type OwnershipDelegate = {
  findUnique: (args: {
    where: unknown;
    select?: Record<string, boolean>;
  }) => Promise<Record<string, unknown> | null>;
};

/** Resolve a Prisma delegate by model name without widening to `any`. */
function delegateFor(
  prisma: PrismaClient | (() => PrismaClient),
  delegateName: string,
): OwnershipDelegate {
  // A function is resolved per call: the service hands the guard the client
  // that carries the database tenant context, which exists only after the
  // guard has been registered on the base client.
  const client = typeof prisma === 'function' ? prisma() : prisma;
  return (client as unknown as Record<string, OwnershipDelegate>)[delegateName];
}

/** Exposed for the coverage test: is this model classified by the guard at all? */
export function isClassifiedModel(model: string): boolean {
  return isGuarded(model) || PLATFORM_CATALOGUE_MODELS.has(model);
}

/**
 * Whether a model's table sits behind row-level security, so a query on it
 * must carry the database tenant context (db-tenant-context.ts). The same
 * set the guard walls off: every tenant-owned model, the tenant row itself
 * and platform-only configuration.
 */
export function needsDatabaseContext(model: string): boolean {
  return isGuarded(model);
}

function isGuarded(model: string): boolean {
  return (
    model === TENANT_MODEL ||
    PLATFORM_ONLY_MODELS.has(model) ||
    DIRECT_TENANT_MODELS.has(model) ||
    model in RELATION_SCOPED_MODELS
  );
}

/** The `where` fragment that confines a model to one tenant. */
function scopeFilter(model: string, tenantId: string): Record<string, unknown> {
  if (model === TENANT_MODEL) return { id: tenantId };
  const rel = RELATION_SCOPED_MODELS[model];
  if (rel) return { [rel.relation]: { tenantId } };
  return { tenantId };
}

function mergeWhere(
  existing: unknown,
  scope: Record<string, unknown>,
): Record<string, unknown> {
  if (
    !existing ||
    typeof existing !== 'object' ||
    Object.keys(existing).length === 0
  ) {
    return scope;
  }
  return { AND: [existing as Record<string, unknown>, scope] };
}

function deny(model: string, action: string, detail: string): never {
  throw new ForbiddenException(
    `Cross-tenant access is forbidden (${model}.${action}: ${detail}).`,
  );
}

/** A relation field of a model, as the guard needs it. */
interface RelationInfo {
  /** Related model name. */
  type: string;
  /** Scalar columns on this model holding the reference, if this side owns it. */
  from: string[];
  /** Columns on the related model they reference. */
  to: string[];
}

let relationIndex: Map<string, Map<string, RelationInfo>> | null = null;

/** model → relation field name → relation, from the generated client's schema. */
function relationsOf(model: string): Map<string, RelationInfo> {
  if (!relationIndex) {
    relationIndex = new Map();
    for (const m of PrismaRuntime.dmmf.datamodel.models) {
      const rels = new Map<string, RelationInfo>();
      for (const f of m.fields)
        if (f.kind === 'object')
          rels.set(f.name, {
            type: f.type,
            from: [...(f.relationFromFields ?? [])],
            to: [...(f.relationToFields ?? [])],
          });
      relationIndex.set(m.name, rels);
    }
  }
  return relationIndex.get(model) ?? new Map();
}

/** Nested relation operations that act on rows the payload does not name by tenant. */
const NESTED_WRITE_OPS = [
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'set',
  'disconnect',
];

export function createTenantGuardMiddleware(
  prisma: PrismaClient | (() => PrismaClient),
  options: { mode: TenantGuardMode; logger?: Logger } = { mode: 'enforce' },
): Prisma.Middleware {
  const logger = options.logger ?? new Logger('TenantGuard');

  /**
   * Resolve a row's owning tenant. Direct models carry it; relation-scoped
   * models require one indexed lookup on the parent. Runs as system so the
   * lookup does not re-enter this middleware and recurse.
   */
  /** The column tenantIdOfRow reads to find a row's owner. */
  function ownershipColumn(model: string): string | undefined {
    if (model === TENANT_MODEL) return 'id';
    if (DIRECT_TENANT_MODELS.has(model)) return 'tenantId';
    return RELATION_SCOPED_MODELS[model]?.fk;
  }

  async function tenantIdOfRow(
    model: string,
    row: Record<string, unknown> | null,
  ): Promise<string | null | undefined> {
    if (!row) return undefined;
    if (model === TENANT_MODEL) return row.id as string;
    if (DIRECT_TENANT_MODELS.has(model))
      return (row.tenantId as string) ?? null;

    const rel = RELATION_SCOPED_MODELS[model];
    if (!rel) return undefined;
    const fkValue = row[rel.fk];
    if (!fkValue) return null;
    const parent = await runAsSystem(
      'tenant-guard: parent ownership lookup',
      () =>
        delegateFor(prisma, rel.parentDelegate).findUnique({
          where: { id: fkValue },
          select: { tenantId: true },
        }),
    );
    return (parent?.tenantId as string | undefined) ?? null;
  }

  /** The tenant owning the row of `model` matched by a unique `where`. */
  async function ownerOf(
    model: string,
    where: Record<string, unknown>,
  ): Promise<string | null | undefined> {
    if (model === TENANT_MODEL)
      return typeof where.id === 'string' ? where.id : undefined;
    if (!isGuarded(model) || PLATFORM_ONLY_MODELS.has(model)) return undefined;
    const rel = RELATION_SCOPED_MODELS[model];
    const select = rel ? { [rel.fk]: true } : { tenantId: true };
    const row = await runAsSystem('tenant-guard: reference ownership', () =>
      delegateFor(
        prisma,
        model.charAt(0).toLowerCase() + model.slice(1),
      ).findUnique({ where, select }),
    );
    if (!row) return undefined;
    return tenantIdOfRow(model, row);
  }

  /**
   * The references a write payload makes must stay inside the caller's
   * tenant: a scalar foreign key or a nested `connect` may not name another
   * tenant's row, a nested `create` is checked like a top-level one, and
   * nested writes that act on already-linked rows are refused outright (the
   * code base has no use for them, so they fail closed). `tenantId` itself may
   * not be changed to another tenant.
   */
  async function assertReferences(
    model: string,
    action: string,
    data: unknown,
    tenantId: string,
    seen = new Map<string, string | null | undefined>(),
  ): Promise<void> {
    if (!data || typeof data !== 'object') return;
    const record = data as Record<string, unknown>;
    if (
      'tenantId' in record &&
      record.tenantId !== undefined &&
      record.tenantId !== tenantId &&
      model !== TENANT_MODEL
    ) {
      deny(
        model,
        action,
        `payload tenantId=${JSON.stringify(record.tenantId)}`,
      );
    }
    const check = async (related: string, where: Record<string, unknown>) => {
      const k = `${related}:${JSON.stringify(where)}`;
      if (!seen.has(k)) seen.set(k, await ownerOf(related, where));
      const owner = seen.get(k);
      // A reference to nothing is the database's to refuse; a reference to
      // another tenant's row is ours.
      if (owner !== undefined && owner !== null && owner !== tenantId)
        deny(model, action, `references ${related} of another tenant`);
    };
    for (const [field, rel] of relationsOf(model)) {
      // Scalar foreign keys. A composite key that includes tenantId is already
      // pinned to one tenant by the database.
      if (rel.from.length && !rel.from.includes('tenantId')) {
        const values = rel.from.map((c) => record[c]);
        if (values.every((v) => typeof v === 'string'))
          await check(
            rel.type,
            Object.fromEntries(rel.to.map((c, i) => [c, values[i]])),
          );
      }
      const nested = record[field];
      if (!nested || typeof nested !== 'object') continue;
      const ops = nested as Record<string, unknown>;
      for (const op of NESTED_WRITE_OPS)
        if (op in ops && isGuarded(rel.type))
          deny(model, action, `nested ${op} on ${rel.type}`);
      for (const w of [ops.connect].flat())
        if (w && typeof w === 'object')
          await check(rel.type, w as Record<string, unknown>);
      const coc = [ops.connectOrCreate].flat() as
        | { where?: Record<string, unknown>; create?: unknown }[]
        | undefined;
      for (const c of coc ?? [])
        if (c?.where) {
          await check(rel.type, c.where);
          await assertCreatePayload(rel.type, action, c.create, tenantId);
        }
      for (const c of [ops.create].flat())
        if (c) await assertCreatePayload(rel.type, action, c, tenantId);
      const many = (ops.createMany as { data?: unknown } | undefined)?.data;
      for (const c of [many].flat())
        if (c) await assertCreatePayload(rel.type, action, c, tenantId);
    }
  }

  /** Ownership check for a create payload, before the row exists. */
  async function assertCreatePayload(
    model: string,
    action: string,
    data: unknown,
    tenantId: string,
  ): Promise<void> {
    if (!data || typeof data !== 'object') return;
    const record = data as Record<string, unknown>;

    if (model === TENANT_MODEL) {
      deny(model, action, 'tenant principals cannot create organizations');
    }

    if (DIRECT_TENANT_MODELS.has(model)) {
      if (record.tenantId === undefined || record.tenantId === null) {
        // Fill it in rather than reject: the row is unambiguously the
        // caller's, and this is what makes the guard safe to adopt against
        // existing call sites that relied on the service layer.
        record.tenantId = tenantId;
      } else if (record.tenantId !== tenantId) {
        deny(
          model,
          action,
          `payload tenantId=${JSON.stringify(record.tenantId)}`,
        );
      }
      await assertReferences(model, action, record, tenantId);
      return;
    }

    const rel = RELATION_SCOPED_MODELS[model];
    if (!rel) return;
    await assertReferences(model, action, record, tenantId);
    const fkValue = record[rel.fk];
    // Nested under a parent write (`{ lines: { create: [...] } }`) the child
    // carries no scalar FK: the parent's ownership was checked already.
    if (!fkValue || typeof fkValue !== 'string') return;
    const owner = await tenantIdOfRow(model, record);
    if (owner !== tenantId) {
      deny(
        model,
        action,
        `parent ${rel.parentDelegate}=${fkValue} belongs to another tenant`,
      );
    }
  }

  return async (params, next) => {
    const model = params.model;
    if (!model) return next(params);

    const ctx: TenantContext | null = getTenantContext();

    // ── Platform catalogue: open to read, closed to tenant writes ─────────
    // Checked before `isGuarded` so an unauthenticated read (the signup price
    // list) succeeds while a tenant-authored write still fails closed.
    if (PLATFORM_CATALOGUE_MODELS.has(model)) {
      if (READ_ACTIONS.has(params.action as string)) return next(params);
      if (ctx?.mode === 'platform' || ctx?.mode === 'system') {
        return next(params);
      }
      return deny(
        model,
        params.action,
        'platform catalogue is read-only for tenant principals',
      );
    }

    if (!isGuarded(model)) return next(params);

    // SUPERADMIN — the platform owner is the one principal permitted to cross
    // the wall. This is the deliberate hole, and it is the only one.
    if (ctx?.mode === 'platform') return next(params);

    // Explicitly-declared trusted path (login, cron, bootstrap).
    if (ctx?.mode === 'system') return next(params);

    if (!ctx) {
      const message =
        `Unscoped query on tenant-owned model ${model}.${params.action} — ` +
        `no tenant context. Wrap trusted callers in runAsSystem()/@SystemContext().`;
      if (options.mode === 'warn') {
        logger.warn(message);
        return next(params);
      }
      throw new ForbiddenException(message);
    }

    if (PLATFORM_ONLY_MODELS.has(model)) {
      return deny(
        model,
        params.action,
        'platform-owned configuration is not readable by tenant principals',
      );
    }

    const { tenantId } = ctx;
    const action = params.action as string;
    params.args = params.args ?? {};

    // ── Reads and bulk writes: scope the `where` ──────────────────────────
    if (WHERE_SCOPED_ACTIONS.has(action)) {
      if (action === 'updateMany')
        await assertReferences(model, action, params.args.data, tenantId);
      params.args.where = mergeWhere(
        params.args.where,
        scopeFilter(model, tenantId),
      );
      return next(params);
    }

    // ── Creates: scope the payload ────────────────────────────────────────
    if (action === 'create') {
      await assertCreatePayload(model, action, params.args.data, tenantId);
      return next(params);
    }
    if (action === 'createMany') {
      const data = params.args.data;
      const rows = Array.isArray(data) ? data : [data];
      for (const row of rows)
        await assertCreatePayload(model, action, row, tenantId);
      return next(params);
    }

    // ── Unique reads: verify after the fact ───────────────────────────────
    // Rewriting `findUnique` into `findFirst` would break compound-unique
    // lookups (`where: { tenantId_code: {...} }`), so the row is fetched and
    // then checked. It is never returned to a foreign tenant.
    if (UNIQUE_READ_ACTIONS.has(action)) {
      // The check reads the ownership column from the row, so a `select`
      // that leaves it out (`select: { twoFactorEnabled: true }`) would make
      // every row look foreign and the caller's own row read as null. Ask
      // for the column and hand back only what the caller selected.
      const ownerColumn = ownershipColumn(model) ?? '';
      const select = params.args.select as Record<string, unknown> | undefined;
      const added =
        ownerColumn !== '' &&
        !!select &&
        typeof select === 'object' &&
        !select[ownerColumn];
      if (added) params.args.select = { ...select, [ownerColumn]: true };
      const result = await next(params);
      if (!result) return result;
      const owner = await tenantIdOfRow(
        model,
        result as Record<string, unknown>,
      );
      if (owner !== tenantId) {
        if (action === 'findUniqueOrThrow') {
          deny(model, action, `row belongs to tenant ${String(owner)}`);
        }
        return null;
      }
      if (added) {
        const { [ownerColumn]: _owner, ...rest } = result as Record<
          string,
          unknown
        >;
        return rest;
      }
      return result;
    }

    // ── Single-row writes: verify ownership before mutating ───────────────
    // `where` on update/delete accepts only unique fields, so the scope cannot
    // be merged in. One indexed pre-flight read establishes ownership instead.
    if (SINGLE_WRITE_ACTIONS.has(action) || action === 'upsert') {
      // Select only the ownership column. Keeps the extra round trip cheap and
      // avoids pulling encrypted PII through the decryption middleware just to
      // answer "whose row is this?".
      const rel = RELATION_SCOPED_MODELS[model];
      const select: Record<string, boolean> = rel
        ? { [rel.fk]: true }
        : model === TENANT_MODEL
          ? { id: true }
          : { tenantId: true };

      const existing = await runAsSystem(
        'tenant-guard: write ownership pre-flight',
        () =>
          delegateFor(
            prisma,
            model.charAt(0).toLowerCase() + model.slice(1),
          ).findUnique({ where: params.args.where, select }),
      );

      if (existing) {
        const owner = await tenantIdOfRow(model, existing);
        if (owner !== tenantId) {
          deny(model, action, `row belongs to tenant ${String(owner)}`);
        }
        // An update may not repoint the row at another tenant's records, nor
        // hand the row itself to another tenant.
        await assertReferences(
          model,
          action,
          action === 'upsert' ? params.args.update : params.args.data,
          tenantId,
        );
      } else if (action === 'upsert') {
        // No existing row — the upsert will insert, so validate the create arm.
        await assertCreatePayload(model, action, params.args.create, tenantId);
      }
      return next(params);
    }

    // Unrecognised action against a guarded model: fail closed rather than
    // assume it is safe. New Prisma actions must be classified deliberately.
    if (options.mode === 'warn') {
      logger.warn(
        `Unclassified action ${model}.${action} allowed in warn mode.`,
      );
      return next(params);
    }
    return deny(
      model,
      action,
      'unclassified action against a tenant-owned model',
    );
  };
}
