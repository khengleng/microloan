import {
  Global,
  Injectable,
  InternalServerErrorException,
  Module,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../prisma/prisma.service';
import { oncePerRun } from '../lending/servicing/batch-scope';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Reads the lending settings in force for a tenant (TenantLendingSettings):
 * the approved version, with every field it does not set at its documented
 * default — or all defaults when none is approved. Proposing and approving
 * a version is LendingSettingsService (lending/accounting).
 *
 * Nothing is cached in the process: each call is one indexed read, shared
 * only within one end-of-day run (oncePerRun), so an approval on any API
 * instance applies to the next request on every instance.
 */
@Injectable()
export class TenantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, tx?: Db): Promise<lending.TenantLendingSettings> {
    return oncePerRun(
      tenantId,
      'tenant-lending-settings',
      () => this.read(this.prisma, tenantId),
      () => this.read(tx ?? this.prisma, tenantId),
    );
  }

  private async read(
    db: Db,
    tenantId: string,
  ): Promise<lending.TenantLendingSettings> {
    const row = await db.tenantLendingSettings.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, version: true, settings: true },
    });
    if (!row) return lending.defaultTenantLendingSettings();
    const parsed = lending.tenantLendingSettingsSchema.safeParse(row.settings);
    // Settings in force that no longer parse fail closed: nothing is posted
    // or reported on a guess.
    if (!parsed.success)
      throw new InternalServerErrorException(
        `The lending settings in force (version ${row.version}) no longer validate: ${parsed.error.issues[0]?.message}. Propose a corrected version.`,
      );
    return parsed.data;
  }
}

/** Global so the original loan book's services can read the same settings. */
@Global()
@Module({
  providers: [TenantSettingsService],
  exports: [TenantSettingsService],
})
export class TenantSettingsModule {}
