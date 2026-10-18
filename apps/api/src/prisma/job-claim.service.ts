import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from './prisma.service';

/**
 * Durable, cross-instance claims on scheduled work (ScheduledJobClaim).
 *
 * Every API instance runs the same cron schedule. An in-process flag stops
 * one instance from overlapping itself but not two instances from both
 * sending the 8 a.m. reminders; a Postgres advisory lock stops them
 * overlapping but not one starting after the other finished. A row keyed by
 * (tenant, job, run key) does both: the first instance to insert it does the
 * work, the others see it taken — including after a restart.
 *
 * - `once(tenant, job, runKey)`: true for exactly one caller, ever (e.g. the
 *   reminders of one tenant for one day).
 * - `lease(tenant, job, runKey, ms)`: true while this instance holds an
 *   expiring lease it keeps renewing (e.g. which instance polls a tenant's
 *   chat bot). Another instance takes over once a lease lapses.
 *
 * The claim is raw SQL (INSERT … ON CONFLICT), scoped by the tenant id it is
 * given; it runs outside a tenant transaction, where the row-level-security
 * policy admits system work.
 */
@Injectable()
export class JobClaimService {
  /** This process, as recorded on the claims it makes. */
  readonly holder = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  constructor(private readonly prisma: PrismaService) {}

  /** Claim a run for good. True only for the first caller. */
  async once(tenantId: string, job: string, runKey: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "ScheduledJobClaim" ("id", "tenantId", "job", "runKey", "holder", "claimedAt", "leaseUntil")
      VALUES (${randomUUID()}, ${tenantId}, ${job}, ${runKey}, ${this.holder}, ${new Date()}, NULL)
      ON CONFLICT ("tenantId", "job", "runKey") DO NOTHING
      RETURNING "id"`;
    return rows.length === 1;
  }

  /**
   * Take or renew an expiring lease. True when this instance holds it until
   * now + ms; false while another instance's lease is still running.
   */
  async lease(
    tenantId: string,
    job: string,
    runKey: string,
    ms: number,
  ): Promise<boolean> {
    // Times are passed in (not now()) so they compare in the same UTC
    // representation Prisma stores, whatever the session time zone.
    const now = new Date();
    const until = new Date(now.getTime() + ms);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "ScheduledJobClaim" ("id", "tenantId", "job", "runKey", "holder", "claimedAt", "leaseUntil")
      VALUES (${randomUUID()}, ${tenantId}, ${job}, ${runKey}, ${this.holder}, ${now}, ${until})
      ON CONFLICT ("tenantId", "job", "runKey") DO UPDATE
        SET "holder" = EXCLUDED."holder", "claimedAt" = EXCLUDED."claimedAt", "leaseUntil" = EXCLUDED."leaseUntil"
        WHERE "ScheduledJobClaim"."leaseUntil" IS NOT NULL
          AND ("ScheduledJobClaim"."leaseUntil" <= ${now} OR "ScheduledJobClaim"."holder" = EXCLUDED."holder")
      RETURNING "id"`;
    return rows.length === 1;
  }

  /** Give up a lease this instance holds (shutdown), so another can take it at once. */
  async release(tenantId: string, job: string, runKey: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "ScheduledJobClaim" SET "leaseUntil" = ${new Date(0)}
      WHERE "tenantId" = ${tenantId} AND "job" = ${job} AND "runKey" = ${runKey}
        AND "holder" = ${this.holder} AND "leaseUntil" IS NOT NULL`;
  }
}
