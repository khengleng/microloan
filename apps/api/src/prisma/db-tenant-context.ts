import { Prisma as PrismaRuntime } from '@microloan/db';
import type { PrismaClient } from '@microloan/db';
import { getTenantContext, TenantContext } from './tenant-context';
import { needsDatabaseContext } from './tenant-guard';

/**
 * Database tenant context: the second tenant wall (DECISIONS D-141…D-143,
 * docs/security/RLS.md).
 *
 * Row-level security on every tenant-owned table admits a row only when
 *
 *   - `app.tenant_id` (transaction-local) names the row's tenant, or
 *   - `app.system` (transaction-local) is `on` — a declared system or
 *     platform path,
 *
 * and nothing otherwise. This module is what tells PostgreSQL which of the
 * two applies, from the same ambient context the Prisma tenant guard uses:
 *
 *   tenant   → app.tenant_id = <tenant>, app.system = off
 *   platform → app.system = on (the SUPERADMIN crosses the wall by design)
 *   system   → app.system = on (login, cron, bootstrap — declared paths)
 *   none     → nothing is set, so every tenant-owned row is invisible
 *
 * Both settings are made with `set_config(…, is_local => true)` inside a
 * transaction, so they end with it and never travel to the next user of a
 * pooled connection.
 *
 *   - A query outside a transaction is sent as a two-statement batch
 *     transaction `[set_config, query]`.
 *   - An interactive transaction (`$transaction(async (tx) => …)`) gets the
 *     settings as its first statement, from the context at the moment it
 *     opens; queries on `tx` then run as they are.
 *   - A batch transaction (`$transaction([…])`) gets the settings prepended.
 */

/** The transaction-local settings for one context, or null for none. */
export interface DbContextSettings {
  tenantId: string;
  system: 'on' | 'off';
}

export function dbSettingsFor(
  ctx: TenantContext | null,
): DbContextSettings | null {
  if (!ctx) return null;
  if (ctx.mode === 'tenant') return { tenantId: ctx.tenantId, system: 'off' };
  // Platform and system both cross the wall; the Prisma guard already lets
  // them through, and the database has no finer notion to offer.
  return { tenantId: '', system: 'on' };
}

type RawRunner = Pick<PrismaClient, '$executeRaw'>;

/** The one statement that declares the context to PostgreSQL. */
export function declareContext(client: RawRunner, s: DbContextSettings) {
  return client.$executeRaw`SELECT set_config('app.tenant_id', ${s.tenantId}, true), set_config('app.system', ${s.system}, true)`;
}

const READ_ONLY = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

/** model → its relation field names, from the generated client's schema (read-only). */
const RELATION_FIELDS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  PrismaRuntime.dmmf.datamodel.models.map((m) => [
    m.name,
    new Set(m.fields.filter((f) => f.kind === 'object').map((f) => f.name)),
  ]),
);
function relationFieldsOf(model: string): ReadonlySet<string> {
  return RELATION_FIELDS.get(model) ?? new Set();
}

/**
 * Whether a query needs the database context. Raw SQL always does (it can
 * name any table); so does anything on a tenant-owned model. A plain read of
 * a tenant-neutral catalogue (plan tiers, feature flags, templates) touches
 * no walled table and is sent as it is — unless it reaches a relation, which
 * might be a walled one.
 */
export function queryNeedsContext(
  model: string | undefined,
  operation: string,
  args: unknown,
): boolean {
  if (!model) return true;
  if (needsDatabaseContext(model)) return true;
  if (!READ_ONLY.has(operation)) return true;
  const a = (args ?? {}) as { include?: unknown; select?: unknown };
  if (a.include) return true;
  if (a.select && typeof a.select === 'object') {
    const rels = relationFieldsOf(model);
    if (Object.keys(a.select).some((k) => k === '_count' || rels.has(k)))
      return true;
  }
  return false;
}

type TxArg = ((tx: unknown) => Promise<unknown>) | unknown[];

/**
 * The client every service uses: `base` with its middlewares, extended so
 * each query carries the database tenant context.
 */
export function withDatabaseTenantContext<C extends PrismaClient>(base: C) {
  return base.$extends({
    name: 'database-tenant-context',
    client: {
      $transaction(arg: TxArg, options?: unknown): Promise<unknown> {
        const settings = dbSettingsFor(getTenantContext());
        const run = base.$transaction.bind(base) as (
          a: TxArg,
          o?: unknown,
        ) => Promise<unknown>;
        if (typeof arg === 'function') {
          return run(async (tx: unknown) => {
            if (settings) await declareContext(tx as RawRunner, settings);
            return arg(tx);
          }, options);
        }
        if (!settings) return run(arg, options);
        return run([declareContext(base, settings), ...arg], options).then(
          (results) => (results as unknown[]).slice(1),
        );
      },
    },
    query: {
      async $allOperations({ model, operation, args, query, ...rest }) {
        // Already part of a transaction (a batch, or an interactive one
        // opened through this client): the transaction carries the context.
        const internal = (
          rest as { __internalParams?: { transaction?: unknown } }
        ).__internalParams;
        if (internal?.transaction) return query(args);
        if (!queryNeedsContext(model, operation, args)) return query(args);
        const settings = dbSettingsFor(getTenantContext());
        // No context: run as is. Row-level security then shows no
        // tenant-owned row, which is the point.
        if (!settings) return query(args);
        const [, result] = await base.$transaction([
          declareContext(base, settings),
          query(args) as never,
        ]);
        return result;
      },
    },
  });
}
