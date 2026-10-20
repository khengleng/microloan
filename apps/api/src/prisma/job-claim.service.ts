import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from './prisma.service';
import { runAsTenant } from './tenant-context';

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
 * given. Each call declares that tenant (runAsTenant), so the database tenant
 * wall admits the claim row whatever the caller's context — a cron loop runs
 * as system, a shutdown hook with no context at all (D-142).
 */
/**
 * The claim scope of platform-wide jobs, which belong to no tenant (the
 * operational health monitor, D-150). Not a tenant id — tenant ids are
 * UUIDs — and ScheduledJobClaim has no foreign key to Tenant; the row is
 * declared and walled like any other claim.
 */
export const PLATFORM_JOB_SCOPE = 'platform';

@Injectable()
export class JobClaimService {
  /** This process, as recorded on the claims it makes. */
  readonly holder = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  constructor(private readonly prisma: PrismaService) {}

  /** Claim a run for good. True only for the first caller. */
  async once(tenantId: string, job: string, runKey: string): Promise<boolean> {
    const rows = await runAsTenant(
      tenantId,
      () => this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "ScheduledJobClaim" ("id", "tenantId", "job", "runKey", "holder", "claimedAt", "leaseUntil")
      VALUES (${randomUUID()}, ${tenantId}, ${job}, ${runKey}, ${this.holder}, ${new Date()}, NULL)
      ON CONFLICT ("tenantId", "job", "runKey") DO NOTHING
      RETURNING "id"`,
    );
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
    const rows = await runAsTenant(
      tenantId,
      () => this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "ScheduledJobClaim" ("id", "tenantId", "job", "runKey", "holder", "claimedAt", "leaseUntil")
      VALUES (${randomUUID()}, ${tenantId}, ${job}, ${runKey}, ${this.holder}, ${now}, ${until})
      ON CONFLICT ("tenantId", "job", "runKey") DO UPDATE
        SET "holder" = EXCLUDED."holder", "claimedAt" = EXCLUDED."claimedAt", "leaseUntil" = EXCLUDED."leaseUntil"
        WHERE "ScheduledJobClaim"."leaseUntil" IS NOT NULL
          AND ("ScheduledJobClaim"."leaseUntil" <= ${now} OR "ScheduledJobClaim"."holder" = EXCLUDED."holder")
      RETURNING "id"`,
    );
    return rows.length === 1;
  }

  /**
   * Delete one job's run-once claims made before `before` (a job claimed
   * every few minutes would otherwise keep a row per run for good).
   */
  async prune(tenantId: string, job: string, before: Date): Promise<number> {
    return runAsTenant(
      tenantId,
      () => this.prisma.$executeRaw`
      DELETE FROM "ScheduledJobClaim"
      WHERE "tenantId" = ${tenantId} AND "job" = ${job}
        AND "leaseUntil" IS NULL AND "claimedAt" < ${before}`,
    );
  }

  /** Give up a lease this instance holds (shutdown), so another can take it at once. */
  async release(tenantId: string, job: string, runKey: string): Promise<void> {
    await runAsTenant(
      tenantId,
      () => this.prisma.$executeRaw`
      UPDATE "ScheduledJobClaim" SET "leaseUntil" = ${new Date(0)}
      WHERE "tenantId" = ${tenantId} AND "job" = ${job} AND "runKey" = ${runKey}
        AND "holder" = ${this.holder} AND "leaseUntil" IS NOT NULL`,
    );
  }
}
