import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient tenant context for the current async execution.
 *
 * This is the ground truth the Prisma tenant guard (see `tenant-guard.ts`)
 * uses to decide whether a query may touch tenant-owned rows. Every DB call
 * resolves to exactly one of these modes:
 *
 *  - `tenant`   — an authenticated tenant principal. Queries are hard-scoped
 *                 to `tenantId`; a cross-tenant read/write throws.
 *  - `platform` — SUPERADMIN, the platform owner. Unrestricted by design;
 *                 this is the only principal that may cross the wall.
 *  - `system`   — an explicitly-declared trusted path with no request
 *                 principal (login, token validation, cron jobs, bootstrap
 *                 scripts). Must be entered deliberately via `runAsSystem`
 *                 or `@SystemContext()`, and carries a reason for audit.
 *
 * Absence of any context is NOT a fourth permissive mode — it is denied.
 * That is what makes the wall fail-closed: forgetting to declare context is
 * a loud error at the first query, not a silent cross-tenant leak.
 */
export type TenantContext =
  | {
      mode: 'tenant';
      tenantId: string;
      actorId?: string;
      branchId?: string | null;
    }
  | { mode: 'platform'; actorId?: string }
  | { mode: 'system'; reason: string };

/** Mutable per-request holder, installed by `TenantContextMiddleware`. */
type RequestHolder = { ctx: TenantContext | null };

/**
 * Two stores, deliberately. The request store is created before guards run
 * and is *mutated* once the JWT strategy has verified the principal. The
 * override store is a nested scope used by `runAsSystem`.
 *
 * Keeping them separate is what lets `JwtStrategy.validate` run its own
 * lookups as `system` while still publishing the resolved tenant context to
 * the rest of the request — a single store would have the strategy writing
 * into the short-lived system scope and losing it on unwind.
 */
const requestStore = new AsyncLocalStorage<RequestHolder>();
const overrideStore = new AsyncLocalStorage<TenantContext>();

/** Wrap a request so downstream code shares one mutable context holder. */
export function runWithRequestContext<T>(fn: () => T): T {
  return requestStore.run({ ctx: null }, fn);
}

/**
 * Publish the verified principal for the remainder of the request. Called by
 * the JWT strategies once — and only once — the token has been validated
 * against the database.
 */
export function setRequestContext(ctx: TenantContext): void {
  const holder = requestStore.getStore();
  if (holder) holder.ctx = ctx;
}

/**
 * Run `fn` with the tenant wall lifted, for paths that legitimately have no
 * request principal. The `reason` is required so every bypass is greppable
 * and shows up in audit review.
 */
export function runAsSystem<T>(reason: string, fn: () => T): T {
  return overrideStore.run({ mode: 'system', reason }, fn);
}

/**
 * Run `fn` scoped to a specific tenant regardless of the ambient principal.
 * Used by cron jobs that iterate tenants: the outer loop is `system`, but
 * each tenant's work re-enters the wall so a bug inside the loop body cannot
 * bleed across tenants.
 */
export function runAsTenant<T>(tenantId: string, fn: () => T): T {
  return overrideStore.run({ mode: 'tenant', tenantId }, fn);
}

/** Resolve the effective context: an explicit override wins over the request. */
export function getTenantContext(): TenantContext | null {
  return overrideStore.getStore() ?? requestStore.getStore()?.ctx ?? null;
}

/**
 * Method decorator form of `runAsSystem`, for entry points where wrapping the
 * whole body would only add nesting — cron handlers, auth service methods and
 * passport strategies.
 */
export function SystemContext(reason: string): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as
      | ((...args: unknown[]) => unknown)
      | undefined;
    if (typeof original !== 'function') return descriptor;
    descriptor.value = function (this: unknown, ...args: unknown[]) {
      return runAsSystem(`${String(propertyKey)}: ${reason}`, () =>
        original.apply(this, args),
      );
    };
    return descriptor;
  };
}

/**
 * Method decorator form of `runAsTenant`, taking the tenant id from a
 * positional argument. For background workers (the Telegram bot) that are
 * handed a tenant id rather than deriving one from a request — the wall stays
 * up inside the handler instead of the whole worker running unscoped.
 */
export function TenantScopedByArg(index = 0): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as
      | ((...args: unknown[]) => unknown)
      | undefined;
    if (typeof original !== 'function') return descriptor;
    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const tenantId = args[index];
      if (typeof tenantId !== 'string' || !tenantId) {
        return original.apply(this, args);
      }
      return runAsTenant(tenantId, () => original.apply(this, args));
    };
    return descriptor;
  };
}
