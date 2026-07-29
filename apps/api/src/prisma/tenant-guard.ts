import { ForbiddenException, Logger } from '@nestjs/common';
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
 * KNOWN LIMIT: `$queryRaw` / `$executeRaw` bypass Prisma middleware entirely
 * and therefore bypass this guard. Raw SQL against tenant-owned tables must
 * scope by hand. `scripts/security-scan.mjs` is the place to add a lint for it.
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
};

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
const PLATFORM_ONLY_MODELS = new Set(['PlatformPaymentQr']);

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
const PLATFORM_CATALOGUE_MODELS = new Set(['PlanTier']);

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
  prisma: PrismaClient,
  delegateName: string,
): OwnershipDelegate {
  return (prisma as unknown as Record<string, OwnershipDelegate>)[delegateName];
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

export function createTenantGuardMiddleware(
  prisma: PrismaClient,
  options: { mode: TenantGuardMode; logger?: Logger } = { mode: 'enforce' },
): Prisma.Middleware {
  const logger = options.logger ?? new Logger('TenantGuard');

  /**
   * Resolve a row's owning tenant. Direct models carry it; relation-scoped
   * models require one indexed lookup on the parent. Runs as system so the
   * lookup does not re-enter this middleware and recurse.
   */
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
        return;
      }
      if (record.tenantId !== tenantId) {
        deny(
          model,
          action,
          `payload tenantId=${JSON.stringify(record.tenantId)}`,
        );
      }
      return;
    }

    const rel = RELATION_SCOPED_MODELS[model];
    if (!rel) return;
    const fkValue = record[rel.fk];
    // Nested writes (`{ loan: { connect: ... } }`) carry no scalar FK; those
    // are already reached through a scoped parent write, so skip them.
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
