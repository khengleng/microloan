import { AsyncLocalStorage } from 'node:async_hooks';
import { configuredPoolSize } from '../../prisma/pool-size';

/**
 * What one end-of-day run shares across the loans it processes, so tenant
 * level reads are made once per run instead of once per loan
 * (docs/lending/PERFORMANCE.md, DECISIONS D-051).
 *
 * Each loan is still its own transaction with its own row lock and
 * compare-and-set; only reads of tenant configuration are shared:
 *
 * - `openPeriods`: entry dates the posting service has already found open in
 *   this run. A month closed mid-run is still refused by the database trigger
 *   on every posting.
 * - `memo`: tenant settings read once at first use (restructure monitoring
 *   policy, the authorization context, which is still re-validated against the
 *   tenant's authorization version inside every loan's transaction).
 */
export interface BatchScope {
  tenantId: string;
  businessDate: string;
  openPeriods: Set<string>;
  memo: Map<string, unknown>;
}

const store = new AsyncLocalStorage<BatchScope>();

export function runInBatchScope<T>(
  tenantId: string,
  businessDate: string,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(
    { tenantId, businessDate, openPeriods: new Set(), memo: new Map() },
    fn,
  );
}

/** The end-of-day run in progress for `tenantId`, if any. */
export function currentBatch(tenantId: string): BatchScope | undefined {
  const s = store.getStore();
  return s && s.tenantId === tenantId ? s : undefined;
}

/**
 * Read a tenant-level value once per end-of-day run (`shared`, made outside
 * any loan's transaction); outside a run, `each` reads it every time (by
 * default the same read). Concurrent loans asking at once share one read.
 */
export function oncePerRun<T>(
  tenantId: string,
  key: string,
  shared: () => Promise<T>,
  each: () => Promise<T> = shared,
): Promise<T> {
  const s = currentBatch(tenantId);
  if (!s) return each();
  const read = shared;
  const hit = s.memo.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = read();
  s.memo.set(key, p);
  // A failed read is not remembered: the next loan tries again.
  p.catch(() => s.memo.delete(key));
  return p;
}

/**
 * How many loans end of day processes at once: LENDING_EOD_CONCURRENCY
 * (default 4), never more than the connection pool minus two — one is held
 * by the scheduler's advisory lock for the whole run and one is left for
 * everything else the instance does.
 */
export function eodConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const cap = Math.max(1, configuredPoolSize(env.DATABASE_URL ?? '') - 2);
  const raw = Number(env.LENDING_EOD_CONCURRENCY);
  const wanted = Number.isInteger(raw) && raw > 0 ? raw : 4;
  return Math.min(wanted, cap);
}
