import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@microloan/db';
import { encryptField, decryptField, isEncrypted, blindIndex } from '../common/field-crypto';
import { createTenantGuardMiddleware, TenantGuardMode } from './tenant-guard';
import { withDatabaseTenantContext } from './db-tenant-context';

// Model fields encrypted at rest on write, with optional deterministic blind
// index columns for exact-match lookup / uniqueness. Reads are decrypted
// universally (any `enc:`-prefixed string), so no per-read-site changes needed.
type EncSpec = { field: string; hash?: string; kind?: 'phone' | 'id' };
const ENCRYPTED_WRITE: Record<string, EncSpec[]> = {
  Borrower: [
    { field: 'idNumber', hash: 'idNumberHash', kind: 'id' },
    { field: 'phone', hash: 'phoneHash', kind: 'phone' },
    { field: 'address' },
    { field: 'email' },
  ],
};

const WRITE_ACTIONS = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany']);

/** Recursively decrypt any `enc:`-prefixed string in a query result. Safe on all
 *  shapes: the prefix disambiguates, and Decimal/Date/Buffer are left alone. */
function decryptDeep(value: any): any {
  if (value == null) return value;
  if (typeof value === 'string') return isEncrypted(value) ? decryptField(value) : value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = decryptDeep(value[i]);
    return value;
  }
  if (typeof value === 'object') {
    if (value instanceof Date || Buffer.isBuffer(value)) return value;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value; // Prisma.Decimal, etc.
    for (const k of Object.keys(value)) value[k] = decryptDeep(value[k]);
    return value;
  }
  return value;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Nest receives the *extended* client from this constructor, not the bare
   * one: every query made through it carries the database tenant context
   * (db-tenant-context.ts), which the row-level-security policies require —
   * without it no tenant-owned row is visible. The middlewares are registered
   * on the bare client first; an extended client shares them.
   */
  constructor() {
    super();
    // ── Tenant wall ─────────────────────────────────────────────────────────
    // Registered FIRST so it is the outermost middleware: a cross-tenant query
    // is rejected before any encryption work is done on its payload.
    //
    // TENANT_GUARD_MODE=warn downgrades unscoped-context queries from a 403 to
    // a log line. It exists as an operational escape hatch for rollout only —
    // production should run the default `enforce`.
    const guardMode: TenantGuardMode =
      process.env.TENANT_GUARD_MODE === 'warn' ? 'warn' : 'enforce';
    if (guardMode === 'warn' && process.env.NODE_ENV === 'production') {
      // The escape hatch is for rollout, never for production: one setting
      // must not be able to switch the tenant wall off.
      throw new Error('TENANT_GUARD_MODE=warn is not allowed in production.');
    }
    if (guardMode === 'warn') {
      this.logger.warn(
        'TENANT_GUARD_MODE=warn — cross-tenant isolation is NOT enforced by the Prisma guard.',
      );
    }
    // The guard's own ownership look-ups go through the extended client, so
    // they carry the (system) database context like any other query.
    let extended: PrismaClient = this;
    this.$use(createTenantGuardMiddleware(() => extended, { mode: guardMode, logger: this.logger }));

    this.$use(async (params, next) => {
      // ── Write: encrypt configured fields + populate blind-index hashes ──────
      const spec = params.model ? ENCRYPTED_WRITE[params.model] : undefined;
      if (spec && WRITE_ACTIONS.has(params.action)) {
        const apply = (data: any) => {
          if (!data || typeof data !== 'object') return;
          for (const s of spec) {
            if (!(s.field in data)) continue;
            const v = data[s.field];
            if (v === null) {
              if (s.hash) data[s.hash] = null;
              continue;
            }
            if (typeof v !== 'string' || isEncrypted(v)) continue;
            if (s.hash) data[s.hash] = blindIndex(v, s.kind);
            data[s.field] = encryptField(v);
          }
        };
        if (params.action === 'createMany') {
          const d = params.args?.data;
          Array.isArray(d) ? d.forEach(apply) : apply(d);
        } else if (params.action === 'upsert') {
          apply(params.args?.create);
          apply(params.args?.update);
        } else {
          apply(params.args?.data);
        }
      }

      const result = await next(params);
      return decryptDeep(result);
    });

    extended = withDatabaseTenantContext(this) as unknown as PrismaClient;
    // Returning an object from a constructor makes it the instance: the
    // extended client inherits this class's methods through its prototype.
    return extended as unknown as PrismaService;
  }

  async onModuleInit() {
    await this.checkRowLevelSecurityRole();
    await this.$connect();
  }

  /**
   * Row-level security is the second tenant wall, and PostgreSQL skips it
   * entirely for a superuser or a BYPASSRLS role. Say so loudly at startup;
   * with DB_ROLE_MUST_RESPECT_RLS=true, refuse to start.
   */
  private async checkRowLevelSecurityRole() {
    try {
      const [role] = await this.$queryRaw<
        { rolsuper: boolean; rolbypassrls: boolean; rolname: string }[]
      >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      if (role && (role.rolsuper || role.rolbypassrls)) {
        const message =
          `Database role "${role.rolname}" bypasses row-level security ` +
          `(superuser=${role.rolsuper}, bypassrls=${role.rolbypassrls}); ` +
          'the database tenant wall is inactive. Connect as a NOSUPERUSER NOBYPASSRLS role that does not own the tables.';
        if (process.env.DB_ROLE_MUST_RESPECT_RLS === 'true') throw new Error(message);
        this.logger.error(message);
      }
    } catch (e) {
      if (process.env.DB_ROLE_MUST_RESPECT_RLS === 'true') throw e;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
