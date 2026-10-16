import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsTenant } from '../../prisma/tenant-context';

export type Tx = Prisma.TransactionClient;

/**
 * Tenant-scoped transactions for lending writes.
 *
 * Inside the transaction the tenant is declared to PostgreSQL
 * (`app.tenant_id`), which activates the row-level-security policies on the
 * financial tables — a second wall behind the Prisma tenant guard that also
 * covers raw SQL. The ambient Prisma tenant context is pinned to the same
 * tenant for the whole callback.
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
        this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
            return fn(tx);
          },
          {
            isolationLevel: opts.isolationLevel,
            timeout: opts.timeoutMs ?? 20_000,
            maxWait: 10_000,
          },
        ),
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
