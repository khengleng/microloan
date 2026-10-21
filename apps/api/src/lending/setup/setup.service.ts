import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { learning, lending } from '@microloan/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';
import { operationalConfig } from '../../config/operational-config';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../ledger/chart-of-accounts';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  localDateIn,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import {
  tenantResource,
  configFlags,
  facilityFlags,
} from '../policy/resources';
import { evaluateFlag } from '../policy/flags';
import { familyFlagKey } from '../policy/catalogue';
import { KhqrCodesService } from '../payments/khqr/khqr-codes.service';
import {
  CREDIT_APPROVAL_PERMISSION,
  SETUP_ITEM_BY_KEY,
  SetupSnapshot,
  SetupStatus,
  SnapshotProductVersion,
  evaluateSetup,
} from './setup-checks';

/** Product version states the checklist looks at (live, or on their way to it). */
const VERSION_STATES = ['ACTIVE', 'APPROVED', 'SUBMITTED'];

/**
 * The go-live setup checklist (D-171…D-175): GET /lending/setup/status reads
 * everything the checks need in one transaction and one round of queries,
 * under the caller's tenant (row-level security applies), and evaluates the
 * pure checks in setup-checks.ts. Nothing about progress is stored; the only
 * write is a tenant administrator's "not applicable" mark on a waivable
 * item, audited.
 */
@Injectable()
export class GoLiveSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly khqrCodes: KhqrCodesService,
  ) {}

  async status(
    actor: LendingActor,
  ): Promise<SetupStatus & { generatedAt: string }> {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'tenant_setup.read',
      tenantResource(tenantId),
    );
    return this.forTenant(tenantId);
  }

  /** The checklist for one tenant (also used for the platform overview). */
  async forTenant(
    tenantId: string,
  ): Promise<SetupStatus & { generatedAt: string }> {
    const now = new Date();
    const snapshot = await this.lp.tenantTx(tenantId, (tx) =>
      this.snapshot(tx, tenantId, now),
    );
    return { ...evaluateSetup(snapshot), generatedAt: now.toISOString() };
  }

  /**
   * Each tenant's progress for the platform operator's Organisations page:
   * the counts only, never the items' facts. Every tenant is read in its own
   * tenant transaction, one after the other.
   */
  async platformOverview() {
    const tenants = await runAsSystem('platform operator: go-live setup', () =>
      this.prisma.tenant.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, status: true },
        orderBy: { name: 'asc' },
      }),
    );
    const out: {
      tenantId: string;
      name: string;
      status: string;
      progress: SetupStatus['progress'] | null;
      open: { key: string; status: string }[];
    }[] = [];
    for (const t of tenants) {
      try {
        const s = await this.forTenant(t.id);
        out.push({
          tenantId: t.id,
          name: t.name,
          status: t.status,
          progress: s.progress,
          open: s.items
            .filter((i) => i.status === 'TODO' || i.status === 'BLOCKED')
            .map((i) => ({ key: i.key, status: i.status })),
        });
      } catch {
        // One unreadable tenant must not hide the rest.
        out.push({
          tenantId: t.id,
          name: t.name,
          status: t.status,
          progress: null,
          open: [],
        });
      }
    }
    return { tenants: out };
  }

  async markNotApplicable(actor: LendingActor, key: string, reason: string) {
    const tenantId = requireTenant(actor);
    const def = SETUP_ITEM_BY_KEY[key];
    if (!def) throw new NotFoundException('No such go-live setup item.');
    if (!def.waivable)
      throw new BadRequestException(
        'This item cannot be marked not applicable: every lender needs it.',
      );
    const text = (reason ?? '').trim();
    if (text.length < 5)
      throw new BadRequestException(
        'Say why the item does not apply (at least 5 characters).',
      );
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'tenant_setup.manage',
        tenantResource(tenantId),
        tx,
      );
      const row = await tx.goLiveSetupWaiver.upsert({
        where: { tenantId_itemKey: { tenantId, itemKey: key } },
        create: {
          tenantId,
          itemKey: key,
          reason: text.slice(0, 500),
          markedBy: actor.id,
        },
        update: { reason: text.slice(0, 500), markedBy: actor.id },
      });
      await this.audit.write(
        {
          actor,
          action: 'tenant_setup.not_applicable',
          resourceType: 'GoLiveSetupWaiver',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { item: key, reason: row.reason },
        },
        tx,
      );
      return {
        key,
        reason: row.reason,
        markedBy: row.markedBy,
        markedAt: row.createdAt,
      };
    });
  }

  async clearNotApplicable(actor: LendingActor, key: string) {
    const tenantId = requireTenant(actor);
    if (!SETUP_ITEM_BY_KEY[key])
      throw new NotFoundException('No such go-live setup item.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'tenant_setup.manage',
        tenantResource(tenantId),
        tx,
      );
      const row = await tx.goLiveSetupWaiver.findFirst({
        where: { tenantId, itemKey: key },
      });
      if (!row) return { key, cleared: false };
      await tx.goLiveSetupWaiver.deleteMany({
        where: { tenantId, id: row.id },
      });
      await this.audit.write(
        {
          actor,
          action: 'tenant_setup.applicable',
          resourceType: 'GoLiveSetupWaiver',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { item: key, previousReason: row.reason },
        },
        tx,
      );
      return { key, cleared: true };
    });
  }

  // ── The snapshot ──────────────────────────────────────────────────────────

  private async snapshot(
    tx: Tx,
    tenantId: string,
    now: Date,
  ): Promise<SetupSnapshot> {
    const live = {
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    };
    const [
      tenant,
      settingsRows,
      branches,
      users,
      assignments,
      authorities,
      businessDate,
      ledger,
      migrations,
      versions,
      impairments,
      scorecards,
      watchLists,
      lessons,
      waivers,
      context,
    ] = await Promise.all([
      tx.tenant.findFirst({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          baseCurrency: true,
          maxAnnualInterestRatePct: true,
        },
      }),
      tx.tenantLendingSettings.findMany({
        where: { tenantId, status: { in: ['ACTIVE', 'PENDING'] } },
        orderBy: { version: 'desc' },
        select: { status: true, settings: true },
      }),
      tx.branch.count({ where: { tenantId, isActive: true } }),
      tx.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, email: true, role: true, twoFactorEnabled: true },
      }),
      tx.roleAssignment.findMany({
        where: {
          tenantId,
          revokedAt: null,
          OR: [{ status: 'ACTIVE', ...live }, { status: 'PENDING' }],
        },
        select: {
          userId: true,
          status: true,
          role: { select: { code: true } },
        },
      }),
      tx.approvalAuthority.findMany({
        where: {
          tenantId,
          permission: CREDIT_APPROVAL_PERMISSION,
          status: { in: ['ACTIVE', 'PENDING'] },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
        },
        select: { permission: true, currency: true, status: true },
      }),
      tx.tenantBusinessDate.findFirst({
        where: { tenantId },
        select: { businessDate: true },
      }),
      tx.ledgerAccount.findMany({
        where: { tenantId, isActive: true },
        select: { code: true },
      }),
      tx.migrationBatch.findMany({
        where: { tenantId },
        distinct: ['status'],
        select: { status: true },
      }),
      tx.productVersion.findMany({
        where: { tenantId, status: { in: VERSION_STATES } },
        select: {
          status: true,
          config: true,
          product: { select: { code: true, familyCode: true } },
        },
      }),
      tx.impairmentPolicy.findMany({
        where: { tenantId, status: { in: ['ACTIVE', 'PENDING'] } },
        distinct: ['status'],
        select: { status: true },
      }),
      tx.scorecardVersion.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { scorecard: { select: { code: true } } },
      }),
      tx.amlWatchListVersion.findMany({
        where: { tenantId, status: { in: ['ACTIVE', 'PENDING'] } },
        select: { status: true },
      }),
      tx.learningProgress.findMany({
        where: { tenantId, completedAt: { not: null } },
        select: { userId: true, lessonId: true },
      }),
      tx.goLiveSetupWaiver.findMany({ where: { tenantId } }),
      this.policy.context(tenantId, tx),
    ]);
    // The lender's static KHQR repayment code (D-160), from its own service.
    const khqr = await this.khqrCodes.hasActiveStaticKhqr(tx, tenantId);
    if (!tenant) throw new NotFoundException('Organisation not found');

    // Lending settings: the version in force (over the defaults) and the
    // latest proposal waiting for its checker.
    const parse = (raw: unknown) => {
      const p = lending.tenantLendingSettingsSchema.safeParse(raw);
      return p.success ? p.data : null;
    };
    const activeRow = settingsRows.find((x) => x.status === 'ACTIVE');
    const pendingRow = settingsRows.find((x) => x.status === 'PENDING');
    const activeSettings = activeRow ? parse(activeRow.settings) : null;
    const effective = activeSettings ?? lending.defaultTenantLendingSettings();

    const calendarToday = localDateIn(now);
    const asOf = businessDate
      ? toLocalDate(businessDate.businessDate)!
      : calendarToday;

    // Product versions: currency, scorecard, accounts, the rate cap (D-110)
    // and the flags new business needs, for the ACTIVE ones.
    const cfg = operationalConfig();
    const regulatorCeiling = lending.pctToFraction(
      cfg.regulatoryMaxAnnualRatePct,
    );
    const tenantCap = lending.pctToFraction(
      tenant.maxAnnualInterestRatePct?.toString(),
    );
    const capPolicy = lending.rateCapPolicyOf(effective);
    const snapshotVersions: SnapshotProductVersion[] = versions.map((v) => {
      const parsed = lending.validateProductConfig(v.config);
      const config = parsed.ok ? parsed.config : null;
      const base = {
        productCode: v.product.code,
        familyCode: v.product.familyCode,
        status: v.status,
        currency: config?.identity.currency ?? null,
        championScorecard: config?.scoring.championCode ?? null,
        accountCodes: config
          ? [
              ...Object.values(config.accounting),
              ...Object.values(config.trade?.accounts ?? {}),
            ].map(String)
          : [],
        rateCapFindings: [] as string[],
        flags: [] as { key: string; enabled: boolean }[],
      };
      if (v.status !== 'ACTIVE') return base;
      if (!config)
        return {
          ...base,
          rateCapFindings: [
            `${v.product.code}: the stored configuration no longer validates.`,
          ],
        };
      let findings: string[];
      try {
        const cap = lending.resolveRateCap({
          regulatorCeiling,
          tenantCap,
          productCap: config.pricing.regulatoryCapAnnualRate ?? null,
        });
        findings = lending
          .productRateCapReport(config, cap, capPolicy, {
            asOf,
            benchmarkRate: null,
          })
          .findings.map((f) => f.message);
      } catch (e) {
        findings = [
          `${v.product.code}: the rates could not be checked (${(e as Error).message}).`,
        ];
      }
      const keys = [
        'lending.origination',
        familyFlagKey(v.product.familyCode),
        ...configFlags(config),
        ...facilityFlags(config),
      ];
      const flags = [...new Set(keys)].map((key) => ({
        key,
        enabled: evaluateFlag(
          key,
          { productCode: v.product.code, channel: 'STAFF_PORTAL', cohorts: [] },
          context.flags,
          now,
        ).enabled,
      }));
      return { ...base, rateCapFindings: findings, flags };
    });

    // Learning: lessons on each role-holding member's suggested paths.
    const rolesByUser = new Map<string, Set<string>>();
    for (const a of assignments)
      if (a.status === 'ACTIVE') {
        if (!rolesByUser.has(a.userId)) rolesByUser.set(a.userId, new Set());
        rolesByUser.get(a.userId)!.add(a.role.code);
      }
    const doneBy = new Map<string, Set<string>>();
    for (const l of lessons) {
      if (!doneBy.has(l.userId)) doneBy.set(l.userId, new Set());
      doneBy.get(l.userId)!.add(l.lessonId);
    }
    let required = 0;
    let completed = 0;
    let members = 0;
    for (const u of users) {
      const roles = [...(rolesByUser.get(u.id) ?? [])];
      if (!roles.length) continue;
      members += 1;
      const lessonIds = new Set(
        learning.pathsForRoles(roles).flatMap((p) => p.lessonIds),
      );
      required += lessonIds.size;
      const mine = doneBy.get(u.id);
      for (const id of lessonIds) if (mine?.has(id)) completed += 1;
    }

    return {
      calendarToday,
      eod: {
        timeZone: process.env.LENDING_EOD_TZ || 'Asia/Phnom_Penh',
        schedule: process.env.LENDING_EOD_CRON || '15 0 * * *',
        maxLagDays: cfg.alerts.eodMaxLagDays,
      },
      tenant: { name: tenant.name, baseCurrency: String(tenant.baseCurrency) },
      settings: {
        approved: !!activeSettings,
        invalid: !!activeRow && !activeSettings,
        effective,
        pending: pendingRow ? parse(pendingRow.settings) : null,
      },
      branches: { active: branches },
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: String(u.role),
        twoFactorEnabled: u.twoFactorEnabled,
      })),
      assignments: assignments.map((a) => ({
        userId: a.userId,
        roleCode: a.role.code,
        status: a.status,
      })),
      authorities: authorities.map((a) => ({
        permission: a.permission,
        currency: a.currency,
        status: a.status,
      })),
      businessDate: businessDate ? asOf : null,
      // The FX table in force, from the policy context (effective dates up to now).
      fxPairs: [...context.fx.keys()],
      ledgerCodes: ledger.map((a) => a.code),
      defaultChartCodes: DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code),
      migrationStatuses: migrations.map((m) => m.status),
      versions: snapshotVersions,
      impairmentStatuses: impairments.map((i) => i.status),
      activeScorecards: [...new Set(scorecards.map((s) => s.scorecard.code))],
      watchListStatuses: watchLists.map((w) => w.status),
      khqr: { active: khqr.active },
      learning: { members, required, completed },
      waivers: Object.fromEntries(
        waivers.map((w) => [
          w.itemKey,
          {
            reason: w.reason,
            markedBy: w.markedBy,
            markedAt: w.createdAt.toISOString(),
          },
        ]),
      ),
    };
  }
}
