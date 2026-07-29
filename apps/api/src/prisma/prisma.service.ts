import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@microloan/db';
import { encryptField, decryptField, isEncrypted, blindIndex } from '../common/field-crypto';
import { createTenantGuardMiddleware, TenantGuardMode } from './tenant-guard';

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

  async onModuleInit() {
    // ── Tenant wall ─────────────────────────────────────────────────────────
    // Registered FIRST so it is the outermost middleware: a cross-tenant query
    // is rejected before any encryption work is done on its payload.
    //
    // TENANT_GUARD_MODE=warn downgrades unscoped-context queries from a 403 to
    // a log line. It exists as an operational escape hatch for rollout only —
    // production should run the default `enforce`.
    const guardMode: TenantGuardMode =
      process.env.TENANT_GUARD_MODE === 'warn' ? 'warn' : 'enforce';
    if (guardMode === 'warn') {
      this.logger.warn(
        'TENANT_GUARD_MODE=warn — cross-tenant isolation is NOT enforced at the database layer.',
      );
    }
    this.$use(createTenantGuardMiddleware(this, { mode: guardMode, logger: this.logger }));

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

    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
