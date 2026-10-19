import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  fromLocalDate,
  newReference,
  requireTenant,
  sha256,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import type { Resource } from '../policy/decision';
import { tenantResource } from '../policy/resources';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { JobClaimService } from '../../prisma/job-claim.service';
import { AmlRiskService } from './aml-risk.service';

type Json = Prisma.InputJsonValue;

/** ApprovalTask records of the AML maker-checker steps. */
export const AML_SUBJECT = {
  CASE: 'AML_SCREENING_CASE',
  CUSTOMER: 'BORROWER',
} as const;
export const AML_ACTION = {
  DISPOSITION: 'AML_DISPOSITION',
  CLEAR: 'AML_CLEAR',
} as const;

export type ScreeningTrigger =
  | 'CUSTOMER_CREATE'
  | 'CUSTOMER_UPDATE'
  | 'ON_DEMAND'
  | 'LIST_ACTIVATION'
  | 'STATUS_CLEARANCE';

/** A hit as stored on a screening case. */
export interface StoredHit {
  entryId: string;
  entryType: string;
  listCode: string;
  versionId: string;
  listName: string;
  matchedName: string;
  normalizedListName: string;
  source: string;
  score: number;
  method: string;
  dobMismatch: boolean;
}

interface ActiveEntry extends lending.WatchListEntryForMatch {
  listCode: string;
  versionId: string;
  source: string;
  normalizedName: string;
}

/** The most serious entry type first. */
const SEVERITY = ['SANCTION', 'PEP', 'INTERNAL'];
const hitKey = (h: { entryType: string; normalizedListName: string }) =>
  `${h.entryType}|${h.normalizedListName}`;

/** Re-screening job name in ScheduledJobClaim. */
const RESCREEN_JOB = 'aml.rescreen';

export function amlSystemActor(tenantId: string): LendingActor {
  return {
    id: 'system:aml-screening',
    type: 'SERVICE',
    tenantId,
    assurance: 'SERVICE_KEY',
    channel: 'SYSTEM',
    scopes: [],
  };
}

/**
 * Watch lists, screening and screening cases (DECISIONS D-119):
 *
 *  - compliance uploads a CSV version of a watch list (sanctions, PEP or
 *    internal names); a second person activates it, which supersedes the
 *    list's previous version and queues a re-screen of every customer;
 *  - customers are screened at creation and when their name, date of birth
 *    or nationality changes, on demand, and by the re-screen job; a hit at
 *    or above the tenant's threshold opens a screening case (one open case
 *    per customer — later hits are added to it);
 *  - a compliance user proposes a disposition (TRUE_MATCH or
 *    FALSE_POSITIVE with a reason) and a second one approves it. A true
 *    match flags the customer; a PEP match marks them politically exposed
 *    (enhanced due diligence before lending); a sanctions or internal-list
 *    match also raises a suspicious transaction referral for compliance.
 *    An entry already disposed for the same name is not raised again.
 */
@Injectable()
export class AmlScreeningService {
  private readonly logger = new Logger(AmlScreeningService.name);

  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly settings: TenantSettingsService,
    private readonly risk: AmlRiskService,
    private readonly claims: JobClaimService,
  ) {}

  // ── Resources and scope ───────────────────────────────────────────────────

  /** The customer as an authorization resource: branch-scoped, as documents are (D-023). */
  async customerResource(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
    makerIds: string[] = [],
    id?: string,
  ): Promise<Resource> {
    const b = await tx.borrower.findFirst({
      where: { id: borrowerId, tenantId },
      select: { id: true, branchId: true },
    });
    if (!b) throw new NotFoundException('Customer not found');
    let branchId = b.branchId;
    if (!branchId) {
      const app = await tx.application.findFirst({
        where: { tenantId, borrowerId },
        orderBy: { createdAt: 'desc' },
        select: { branchId: true },
      });
      branchId = app?.branchId ?? null;
    }
    return {
      type: 'CUSTOMER_DOCUMENT',
      id: id ?? b.id,
      tenantId,
      branchId,
      ownerBorrowerId: b.id,
      dataClassification: 'CONFIDENTIAL',
      makerIds,
    } as Resource;
  }

  /**
   * A `where` on Borrower confining a list to the customers the actor's
   * grants for `permission` cover (branch scope). null: none.
   */
  async borrowerScope(
    actor: LendingActor,
    permission: string,
  ): Promise<Prisma.BorrowerWhereInput | null> {
    const scope = await this.policy.scopeFilter(actor, permission);
    if (!scope) return null;
    const or = (scope as { OR?: Record<string, unknown>[] }).OR;
    if (!or) return {};
    const branches: string[] = [];
    for (const part of or) {
      const b = part.branchId as { in?: string[] } | undefined;
      if (b?.in) branches.push(...b.in);
      // A grant across all branches (possibly limited to a legal entity,
      // which customers do not carry) covers every customer.
      else if (!part.portfolioId) return {};
    }
    return branches.length ? { branchId: { in: branches } } : null;
  }

  // ── Screening ─────────────────────────────────────────────────────────────

  private matchOptions(s: lending.TenantLendingSettings['aml']) {
    return {
      threshold: Number(s.screening.matchThreshold),
      tokenFloor: Number(s.screening.tokenFloor),
      singleTokenPenalty: Number(s.screening.singleTokenPenalty),
      ignoredTitles: s.screening.ignoredTitles,
    };
  }

  /** Every entry of every watch-list version in force. */
  async activeEntries(tx: Tx, tenantId: string): Promise<ActiveEntry[]> {
    const rows = await tx.amlWatchListEntry.findMany({
      where: { tenantId, version: { status: 'ACTIVE' } },
      select: {
        id: true,
        name: true,
        aliases: true,
        entryType: true,
        dateOfBirth: true,
        source: true,
        normalizedName: true,
        versionId: true,
        version: { select: { listCode: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      aliases: r.aliases,
      entryType: r.entryType,
      dateOfBirth: toLocalDate(r.dateOfBirth),
      source: r.source,
      normalizedName: r.normalizedName,
      versionId: r.versionId,
      listCode: r.version.listCode,
    }));
  }

  /**
   * Screen one customer against the lists in force. Hits not already
   * disposed for this name open a case, or are added to the customer's open
   * one. Records the screening on the customer and in the audit trail.
   */
  async screenInTx(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
    trigger: ScreeningTrigger,
    actor: Pick<LendingActor, 'id' | 'type' | 'tenantId'>,
    entries?: ActiveEntry[],
  ): Promise<{
    hits: number;
    caseId: string | null;
    reference: string | null;
    opened: boolean;
  }> {
    const b = await tx.borrower.findFirst({
      where: { id: borrowerId, tenantId },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
    });
    if (!b) throw new NotFoundException('Customer not found');
    const s = (await this.settings.get(tenantId, tx)).aml;
    const opts = this.matchOptions(s);
    const name = `${b.firstName} ${b.lastName}`;
    const screenedName = lending.normalizeName(name, opts.ignoredTitles);
    const list = entries ?? (await this.activeEntries(tx, tenantId));
    const byId = new Map(list.map((e) => [e.id, e]));
    const raw = lending.screenName(
      { name, dateOfBirth: toLocalDate(b.dateOfBirth) },
      list,
      opts,
    );
    const decided = await tx.amlScreeningCase.findMany({
      where: {
        tenantId,
        borrowerId,
        screenedName,
        status: { in: ['TRUE_MATCH', 'FALSE_POSITIVE'] },
      },
      select: { hits: true },
    });
    const disposed = new Set(
      decided.flatMap((c) => (c.hits as unknown as StoredHit[]).map(hitKey)),
    );
    const hits: StoredHit[] = raw
      .map((h) => {
        const e = byId.get(h.entryId)!;
        return {
          entryId: h.entryId,
          entryType: h.entryType,
          listCode: e.listCode,
          versionId: e.versionId,
          listName: h.listName,
          matchedName: h.matchedName,
          normalizedListName: e.normalizedName,
          source: e.source,
          score: h.score,
          method: h.method,
          dobMismatch: h.dobMismatch,
        };
      })
      .filter((h) => !disposed.has(hitKey(h)));

    await tx.borrower.update({
      where: { id: borrowerId },
      data: { amlScreenedAt: new Date() },
    });
    let caseRow: { id: string; reference: string } | null = null;
    let opened = false;
    if (hits.length) {
      const open = await tx.amlScreeningCase.findFirst({
        where: {
          tenantId,
          borrowerId,
          status: { in: ['OPEN', 'PENDING_APPROVAL'] },
        },
      });
      if (open) {
        caseRow = open;
        // A case awaiting its checker is not changed under them; the new
        // hits are raised again on the next screening if still undisposed.
        if (open.status === 'OPEN') {
          const existing = open.hits as unknown as StoredHit[];
          const known = new Set(existing.map(hitKey));
          const merged = [
            ...existing,
            ...hits.filter((h) => !known.has(hitKey(h))),
          ];
          if (merged.length > existing.length)
            await tx.amlScreeningCase.update({
              where: { id: open.id },
              data: { hits: merged as unknown as Json, ...summary(merged) },
            });
        }
      } else {
        caseRow = await tx.amlScreeningCase.create({
          data: {
            tenantId,
            reference: newReference('AMLC'),
            borrowerId,
            trigger,
            screenedName,
            hits: hits as unknown as Json,
            ...summary(hits),
            createdBy: actor.id,
          },
        });
        opened = true;
      }
    }
    await this.audit.write(
      {
        actor,
        action: 'aml.screen',
        resourceType: 'Borrower',
        resourceId: borrowerId,
        outcome: 'SUCCESS',
        details: {
          trigger,
          entriesScreened: list.length,
          hits: hits.length,
          case: caseRow?.reference ?? null,
        },
      },
      tx,
    );
    return {
      hits: hits.length,
      caseId: caseRow?.id ?? null,
      reference: caseRow?.reference ?? null,
      opened,
    };
  }

  /**
   * Screen and re-rate a customer after it is created or its identity
   * changes (legacy customer API). A failure is logged, never fails the
   * customer's save: the lending gate keeps an unscreened customer from
   * borrowing.
   */
  async onCustomerChanged(
    tenantId: string,
    borrowerId: string,
    trigger: 'CUSTOMER_CREATE' | 'CUSTOMER_UPDATE',
    actorId: string,
  ): Promise<void> {
    const actor = { id: actorId, type: 'USER' as const, tenantId };
    try {
      await this.lp.tenantTx(tenantId, async (tx) => {
        await this.screenInTx(tx, tenantId, borrowerId, trigger, actor);
        await this.risk.rateInTx(tx, tenantId, borrowerId, actor);
      });
    } catch (e) {
      this.logger.error(
        `AML screening of customer ${borrowerId} failed: ${(e as Error).message}`,
      );
    }
  }

  /** On-demand screening of one customer, with a fresh risk rating. */
  async screenNow(actor: LendingActor, borrowerId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'aml.screen',
        await this.customerResource(tx, tenantId, borrowerId),
        tx,
      );
      const result = await this.screenInTx(
        tx,
        tenantId,
        borrowerId,
        'ON_DEMAND',
        actor,
      );
      const rating = await this.risk.rateInTx(tx, tenantId, borrowerId, actor);
      return { ...result, rating: rating.rating };
    });
  }

  // ── Watch lists ───────────────────────────────────────────────────────────

  async listVersions(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'aml.watchlist.read',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const [versions, jobs] = await Promise.all([
        tx.amlWatchListVersion.findMany({
          where: { tenantId },
          orderBy: [{ listCode: 'asc' }, { version: 'desc' }],
        }),
        tx.amlRescreenJob.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);
      return { versions, jobs };
    });
  }

  async getVersion(actor: LendingActor, versionId: string, page = 1) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'aml.watchlist.read',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const version = await tx.amlWatchListVersion.findFirst({
        where: { id: versionId, tenantId },
      });
      if (!version) throw new NotFoundException('Watch-list version not found');
      const take = 100;
      const entries = await tx.amlWatchListEntry.findMany({
        where: { tenantId, versionId },
        orderBy: { lineNo: 'asc' },
        take,
        skip: (Math.max(1, page) - 1) * take,
      });
      return {
        version,
        entries: entries.map((e) => ({
          ...e,
          listDate: toLocalDate(e.listDate),
          dateOfBirth: toLocalDate(e.dateOfBirth),
        })),
        page: Math.max(1, page),
        pages: Math.max(1, Math.ceil(version.entryCount / take)),
      };
    });
  }

  /** Upload a new version of a list (maker). It is screened against only once a second person activates it. */
  async upload(
    actor: LendingActor,
    body: { listCode: string; name: string; fileName: string; content: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(
      tenantId,
      async (tx) => {
        await this.policy.enforce(
          actor,
          'aml.watchlist.upload',
          tenantResource(tenantId),
          tx,
        );
        const s = (await this.settings.get(tenantId, tx)).aml;
        const parsed = lending.parseWatchListFile(
          body.content,
          s.watchList.maxEntries,
        );
        if (parsed.errors.length)
          throw new BadRequestException({
            message: `The watch list has ${parsed.errors.length} problem(s); nothing was uploaded.`,
            code: 'WATCH_LIST_INVALID',
            issues: parsed.errors.slice(0, 200).map((e) => ({
              path: e.lineNo ? `line ${e.lineNo}` : '',
              message: e.message,
            })),
          });
        const fileHash = sha256(lending.normalizeFileText(body.content));
        const same = await tx.amlWatchListVersion.findFirst({
          where: {
            tenantId,
            listCode: body.listCode,
            fileHash,
            status: { in: ['PENDING', 'ACTIVE'] },
          },
          select: { version: true, status: true },
        });
        if (same)
          throw new ConflictException(
            `This file is already version ${same.version} of ${body.listCode} (${same.status.toLowerCase()}).`,
          );
        const last = await tx.amlWatchListVersion.findFirst({
          where: { tenantId, listCode: body.listCode },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const version = await tx.amlWatchListVersion.create({
          data: {
            tenantId,
            listCode: body.listCode,
            version: (last?.version ?? 0) + 1,
            name: body.name,
            fileName: body.fileName,
            fileHash,
            entryCount: parsed.entries.length,
            makerId: actor.id,
          },
        });
        await tx.amlWatchListEntry.createMany({
          data: parsed.entries.map((e) => ({
            tenantId,
            versionId: version.id,
            entryType: e.entryType,
            name: e.name,
            normalizedName: lending.normalizeName(
              e.name,
              s.screening.ignoredTitles,
            ),
            aliases: e.aliases,
            source: e.source,
            listDate: fromLocalDate(e.listDate),
            country: e.country,
            dateOfBirth: e.dateOfBirth ? fromLocalDate(e.dateOfBirth) : null,
            reference: e.reference,
            lineNo: e.lineNo,
          })),
        });
        await this.audit.write(
          {
            actor,
            action: 'aml.watchlist.upload',
            resourceType: 'AmlWatchListVersion',
            resourceId: version.id,
            outcome: 'SUCCESS',
            details: {
              listCode: body.listCode,
              version: version.version,
              entries: parsed.entries.length,
              fileHash,
            },
          },
          tx,
        );
        return version;
      },
      { timeoutMs: 120_000 },
    );
  }

  /** Activate (or reject) an uploaded version; a different person from the uploader. */
  async decideVersion(
    actor: LendingActor,
    versionId: string,
    body: { approve: boolean; reason?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const v = await tx.amlWatchListVersion.findFirst({
        where: { id: versionId, tenantId },
      });
      if (!v) throw new NotFoundException('Watch-list version not found');
      await this.policy.enforce(
        actor,
        'aml.watchlist.activate',
        tenantResource(tenantId, 'TENANT', v.id, [v.makerId], v.status),
        tx,
      );
      if (v.status !== 'PENDING')
        throw new ConflictException(
          `This version is already ${v.status.toLowerCase()}.`,
        );
      if (!body.approve && !body.reason?.trim())
        throw new BadRequestException('A reason is required to reject.');
      let jobId: string | null = null;
      if (body.approve) {
        await tx.amlWatchListVersion.updateMany({
          where: { tenantId, listCode: v.listCode, status: 'ACTIVE' },
          data: { status: 'SUPERSEDED' },
        });
        const job = await tx.amlRescreenJob.create({
          data: { tenantId, listVersionId: v.id, requestedBy: actor.id },
        });
        jobId = job.id;
      }
      const res = await tx.amlWatchListVersion.updateMany({
        where: { id: v.id, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'ACTIVE' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
          reason: (body.reason ?? '').trim().slice(0, 500),
        },
      });
      if (res.count !== 1)
        throw concurrentModification('This watch-list version');
      await this.audit.write(
        {
          actor,
          action: 'aml.watchlist.activate',
          resourceType: 'AmlWatchListVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: {
            approve: body.approve,
            listCode: v.listCode,
            version: v.version,
            rescreenJob: jobId,
          },
        },
        tx,
      );
      return {
        version: await tx.amlWatchListVersion.findFirst({
          where: { id: v.id, tenantId },
        }),
        rescreenJobId: jobId,
      };
    });
  }

  // ── Re-screening jobs ─────────────────────────────────────────────────────

  /** Work the tenant's queued re-screens now (staff, or the scheduler). */
  async runJobs(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'aml.rescreen.run',
      tenantResource(tenantId),
    );
    return this.processPending(tenantId);
  }

  /**
   * Work every queued or interrupted re-screen of a tenant, batch by batch.
   * Each job is worked only by the instance holding its lease
   * (ScheduledJobClaim); progress is committed per batch, so a job another
   * instance abandoned resumes from its cursor once the lease lapses.
   */
  async processPending(tenantId: string) {
    const leaseMs =
      Number(process.env.AML_RESCREEN_LEASE_SECONDS || 300) * 1000;
    const actor = amlSystemActor(tenantId);
    const jobs = await this.lp.tenantTx(tenantId, (tx) =>
      tx.amlRescreenJob.findMany({
        where: { tenantId, status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const done: {
      id: string;
      screened: number;
      casesOpened: number;
      status: string;
    }[] = [];
    for (const job of jobs) {
      if (!(await this.claims.lease(tenantId, RESCREEN_JOB, job.id, leaseMs)))
        continue;
      try {
        let finished = false;
        while (!finished) {
          finished = await this.lp.tenantTx(
            tenantId,
            async (tx) => {
              const current = await tx.amlRescreenJob.findFirst({
                where: { id: job.id, tenantId },
              });
              if (
                !current ||
                current.status === 'COMPLETED' ||
                current.status === 'FAILED'
              )
                return true;
              const s = (await this.settings.get(tenantId, tx)).aml;
              const batch = await tx.borrower.findMany({
                where: {
                  tenantId,
                  ...(current.cursor ? { id: { gt: current.cursor } } : {}),
                },
                orderBy: { id: 'asc' },
                take: s.screening.rescreenBatchSize,
                select: { id: true },
              });
              if (!batch.length) {
                await tx.amlRescreenJob.update({
                  where: { id: job.id },
                  data: { status: 'COMPLETED', completedAt: new Date() },
                });
                return true;
              }
              const entries = await this.activeEntries(tx, tenantId);
              let opened = 0;
              for (const b of batch) {
                const r = await this.screenInTx(
                  tx,
                  tenantId,
                  b.id,
                  'LIST_ACTIVATION',
                  actor,
                  entries,
                );
                if (r.opened) opened++;
              }
              await tx.amlRescreenJob.update({
                where: { id: job.id },
                data: {
                  status: 'RUNNING',
                  startedAt: current.startedAt ?? new Date(),
                  cursor: batch[batch.length - 1].id,
                  screened: { increment: batch.length },
                  casesOpened: { increment: opened },
                },
              });
              return false;
            },
            { timeoutMs: 300_000 },
          );
          await this.claims.lease(tenantId, RESCREEN_JOB, job.id, leaseMs);
        }
      } catch (e) {
        this.logger.error(
          `AML re-screen ${job.id} failed: ${(e as Error).message}`,
        );
        await this.lp.tenantTx(tenantId, (tx) =>
          tx.amlRescreenJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              error: (e as Error).message.slice(0, 500),
            },
          }),
        );
      } finally {
        await this.claims.release(tenantId, RESCREEN_JOB, job.id);
      }
      const final = await this.lp.tenantTx(tenantId, (tx) =>
        tx.amlRescreenJob.findFirst({ where: { id: job.id, tenantId } }),
      );
      if (final) {
        done.push({
          id: final.id,
          screened: final.screened,
          casesOpened: final.casesOpened,
          status: final.status,
        });
        await this.lp.tenantTx(tenantId, (tx) =>
          this.audit.write(
            {
              actor,
              action: 'aml.rescreen.run',
              resourceType: 'AmlRescreenJob',
              resourceId: final.id,
              outcome: final.status === 'COMPLETED' ? 'SUCCESS' : 'FAILURE',
              details: {
                screened: final.screened,
                casesOpened: final.casesOpened,
              },
            },
            tx,
          ),
        );
      }
    }
    return { jobs: done };
  }

  // ── Screening cases ───────────────────────────────────────────────────────

  async listCases(
    actor: LendingActor,
    q: { status?: string; borrowerId?: string },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'aml.case.read', tenantResource(tenantId));
    const scope = await this.borrowerScope(actor, 'aml.read');
    if (!scope) return { data: [] };
    return this.lp.tenantTx(tenantId, async (tx) => {
      const data = await tx.amlScreeningCase.findMany({
        where: {
          tenantId,
          ...(q.status ? { status: q.status } : {}),
          ...(q.borrowerId ? { borrowerId: q.borrowerId } : {}),
          borrower: scope,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          borrower: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              branchId: true,
              amlStatus: true,
            },
          },
        },
      });
      return { data };
    });
  }

  async getCase(actor: LendingActor, caseId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      await this.policy.enforce(
        actor,
        'aml.read',
        await this.customerResource(tx, tenantId, c.borrowerId, [], c.id),
        tx,
      );
      const task = await this.pendingDisposition(tx, tenantId, c.id);
      const borrower = await tx.borrower.findFirst({
        where: { id: c.borrowerId, tenantId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          nationality: true,
          amlStatus: true,
          pep: true,
        },
      });
      return {
        ...c,
        borrower: borrower && {
          ...borrower,
          dateOfBirth: toLocalDate(borrower.dateOfBirth),
        },
        pendingDisposition: task
          ? {
              taskId: task.id,
              proposedBy: task.makerId,
              proposedAt: task.createdAt,
              payload: task.payload,
            }
          : null,
      };
    });
  }

  /** Propose a disposition (maker). The case waits for a second compliance user. */
  async proposeDisposition(
    actor: LendingActor,
    caseId: string,
    body: { outcome: 'TRUE_MATCH' | 'FALSE_POSITIVE'; reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      await this.policy.enforce(
        actor,
        'aml.case.propose',
        await this.customerResource(tx, tenantId, c.borrowerId, [], c.id),
        tx,
      );
      if (c.status !== 'OPEN')
        throw new ConflictException(
          c.status === 'PENDING_APPROVAL'
            ? 'A disposition of this case is already awaiting approval.'
            : `This case is already disposed (${c.status.toLowerCase().replace('_', ' ')}).`,
        );
      const reason = body.reason?.trim();
      if (!reason || reason.length < 5)
        throw new BadRequestException(
          'Record why: the reviewer and the regulator read it.',
        );
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: AML_SUBJECT.CASE,
          subjectId: c.id,
          action: AML_ACTION.DISPOSITION,
          requiredPermission: 'aml.disposition',
          payload: { outcome: body.outcome, reason: reason.slice(0, 1000) },
          makerId: actor.id,
        },
      });
      const res = await tx.amlScreeningCase.updateMany({
        where: { id: c.id, tenantId, status: 'OPEN' },
        data: {
          status: 'PENDING_APPROVAL',
          disposition: body.outcome,
          dispositionNote: reason.slice(0, 1000),
          proposedBy: actor.id,
        },
      });
      if (res.count !== 1) throw concurrentModification('This screening case');
      await this.audit.write(
        {
          actor,
          action: 'aml.case.propose',
          resourceType: 'AmlScreeningCase',
          resourceId: c.id,
          outcome: 'SUCCESS',
          details: { outcome: body.outcome, task: task.id },
        },
        tx,
      );
      return { ...(await this.loadCase(tx, tenantId, c.id)), taskId: task.id };
    });
  }

  /** Approve or send back a proposed disposition (checker, not the proposer). */
  async decideDisposition(
    actor: LendingActor,
    caseId: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.loadCase(tx, tenantId, caseId);
      const task = await this.pendingDisposition(tx, tenantId, c.id);
      if (!task || c.status !== 'PENDING_APPROVAL')
        throw new ConflictException(
          'No disposition of this case is awaiting approval.',
        );
      await this.policy.enforce(
        actor,
        'aml.case.decide',
        await this.customerResource(
          tx,
          tenantId,
          c.borrowerId,
          [task.makerId],
          c.id,
        ),
        tx,
      );
      if (!body.approve && !body.comment?.trim())
        throw new BadRequestException('Say why the disposition is sent back.');
      const done = await tx.approvalTask.updateMany({
        where: {
          id: task.id,
          tenantId,
          status: 'PENDING',
          makerId: { not: actor.id },
        },
        data: {
          status: body.approve ? 'EXECUTED' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          comment: body.comment?.trim().slice(0, 500),
        },
      });
      if (done.count !== 1) throw concurrentModification('This disposition');
      const outcome = (
        task.payload as { outcome: 'TRUE_MATCH' | 'FALSE_POSITIVE' }
      ).outcome;
      let strReference: string | null = null;
      if (!body.approve) {
        await tx.amlScreeningCase.update({
          where: { id: c.id },
          data: { status: 'OPEN', disposition: null, proposedBy: null },
        });
      } else {
        await tx.amlScreeningCase.update({
          where: { id: c.id },
          data: { status: outcome, decidedBy: actor.id, decidedAt: new Date() },
        });
        if (outcome === 'TRUE_MATCH')
          strReference = await this.confirmMatch(tx, tenantId, c, actor);
      }
      await this.audit.write(
        {
          actor,
          action: 'aml.case.decide',
          resourceType: 'AmlScreeningCase',
          resourceId: c.id,
          outcome: 'SUCCESS',
          details: { approve: body.approve, outcome, task: task.id },
        },
        tx,
      );
      return { ...(await this.loadCase(tx, tenantId, c.id)), strReference };
    });
  }

  /**
   * A confirmed match: the customer is FLAGGED (and any clearance awaiting
   * approval withdrawn); a PEP match marks them politically exposed and the
   * rating is redone; a sanctions or internal-list match raises a suspicious
   * transaction referral for compliance.
   */
  private async confirmMatch(
    tx: Tx,
    tenantId: string,
    c: { id: string; reference: string; borrowerId: string; hits: unknown },
    actor: LendingActor,
  ): Promise<string | null> {
    const hits = c.hits as StoredHit[];
    const pep = hits.some((h) => h.entryType === 'PEP');
    await tx.borrower.update({
      where: { id: c.borrowerId },
      data: {
        amlStatus: 'FLAGGED',
        amlStatusChangedAt: new Date(),
        amlStatusChangedBy: actor.id,
        ...(pep ? { pep: true } : {}),
      },
    });
    await tx.approvalTask.updateMany({
      where: {
        tenantId,
        subjectType: AML_SUBJECT.CUSTOMER,
        subjectId: c.borrowerId,
        action: AML_ACTION.CLEAR,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
        decidedBy: actor.id,
        decidedAt: new Date(),
        comment: `Superseded: watch-list match ${c.reference} confirmed`,
      },
    });
    await this.risk.rateInTx(tx, tenantId, c.borrowerId, actor);
    const serious = hits.filter(
      (h) => h.entryType === 'SANCTION' || h.entryType === 'INTERNAL',
    );
    if (!serious.length) return null;
    const str = await tx.amlStrCase.create({
      data: {
        tenantId,
        reference: newReference('STR'),
        borrowerId: c.borrowerId,
        grounds:
          `Confirmed ${serious[0].entryType.toLowerCase()} watch-list match: ${serious
            .map((h) => `${h.listName} (${h.listCode}, ${h.source})`)
            .join('; ')} — screening case ${c.reference}.`.slice(0, 4000),
        indicators: ['WATCH_LIST_MATCH'],
        raisedBy: actor.id,
        screeningCaseId: c.id,
      },
    });
    await this.audit.write(
      {
        actor,
        action: 'aml.str.raise',
        resourceType: 'AmlStrCase',
        resourceId: str.id,
        outcome: 'SUCCESS',
        details: { reference: str.reference, source: 'SCREENING_CASE' },
      },
      tx,
    );
    return str.reference;
  }

  private async loadCase(tx: Tx, tenantId: string, caseId: string) {
    const c = await tx.amlScreeningCase.findFirst({
      where: { id: caseId, tenantId },
    });
    if (!c) throw new NotFoundException('Screening case not found');
    return c;
  }

  private pendingDisposition(tx: Tx, tenantId: string, caseId: string) {
    return tx.approvalTask.findFirst({
      where: {
        tenantId,
        subjectType: AML_SUBJECT.CASE,
        subjectId: caseId,
        action: AML_ACTION.DISPOSITION,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

/** A case's best score and most serious hit type. */
function summary(hits: StoredHit[]) {
  const topScore = Math.max(...hits.map((h) => h.score));
  const topType =
    SEVERITY.find((t) => hits.some((h) => h.entryType === t)) ??
    hits[0].entryType;
  return { topScore: topScore.toFixed(4), topType };
}
