import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsTenant } from '../../prisma/tenant-context';

export type Tx = Prisma.TransactionClient;

/**
 * Tenant-scoped transactions for lending writes.
 *
 * The ambient tenant context is pinned to the tenant for the whole callback,
 * and the transaction opens by declaring that tenant to PostgreSQL
 * (`app.tenant_id`, transaction-local — PrismaService does it for every
 * interactive transaction, see prisma/db-tenant-context.ts). Row-level
 * security then admits only that tenant's rows — a second wall behind the
 * Prisma tenant guard that also covers raw SQL.
 */
@Injectable()
export class LendingPrisma {
  constructor(readonly prisma: PrismaService) {}

  async tenantTx<T>(
    tenantId: string,
    fn: (tx: Tx) => Promise<T>,
    opts: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    try {
      return await runAsTenant(tenantId, () =>
        this.prisma.$transaction((tx) => fn(tx), {
          isolationLevel: opts.isolationLevel,
          timeout: opts.timeoutMs ?? 20_000,
          maxWait: 10_000,
        }),
      );
    } catch (e) {
      // A lost race (unique version, serialization failure, deadlock) is a
      // conflict the client can retry, never a 500. Idempotency-key races are
      // resolved by the caller before reaching here.
      const code = (e as { code?: string }).code;
      const target = JSON.stringify(
        (e as { meta?: { target?: unknown } }).meta?.target ?? '',
      );
      if (
        (code === 'P2002' && !target.includes('idempotencyKey')) ||
        code === 'P2034' ||
        /deadlock detected|could not serialize/i.test(
          (e as Error).message ?? '',
        )
      ) {
        throw new ConflictException(
          'A concurrent change was made to this record. Reload and try again.',
        );
      }
      throw e;
    }
  }
}
