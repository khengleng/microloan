import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem, runAsTenant } from '../../prisma/tenant-context';
import {
  JobClaimService,
  PLATFORM_JOB_SCOPE,
} from '../../prisma/job-claim.service';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { PrismaHealthIndicator } from '../../health/prisma.health';
import { operationalConfig, webOrigin } from '../../config/operational-config';
import {
  isEmailConfigured,
  sendEmailViaProvider,
} from '../../notifications/notification.providers';
import {
  LendingActor,
  localDateIn,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import {
  AlertFinding,
  OpenAlertState,
  alertRecipients,
  checkBacklog,
  checkDatabase,
  checkEndOfDay,
  checkFailedJobs,
  checkMonthEnd,
  checkReconciliation,
  planAlerts,
} from './operational-checks';

/** Job name of the monitor's run-once claims (ScheduledJobClaim). */
export const ALERT_MONITOR_JOB = 'ops.alert-monitor';

type Delivery = 'EMAIL' | 'LOG_ONLY' | 'FAILED';
type Notice = 'OPENED' | 'STILL OPEN' | 'RESOLVED';

export interface AlertRunResult {
  tenants: number;
  opened: number;
  reminded: number;
  resolved: number;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/**
 * The operational health monitor (DECISIONS D-150…D-152).
 *
 * Every ALERT_CHECK_INTERVAL_MINUTES (default 10) one API instance — the one
 * that claims the time slot in ScheduledJobClaim, never in-process state —
 * checks every tenant with lending loans (end of day, month end, outbox and
 * webhook backlog, reconciliation, failed scheduled jobs) and the platform
 * (the database), then brings OperationalAlert in line: a new problem opens
 * an alert, a problem that persists keeps it, a problem gone resolves it.
 *
 * E-mail (Resend, the platform's existing provider) goes to ALERT_EMAIL_TO
 * for every alert and to the tenant's `operations.alertEmails` for its own:
 * once when an alert opens, once when it resolves, and a reminder at most
 * every ALERT_REMINDER_HOURS (default 6) while it stays open. With no
 * recipients or no RESEND_API_KEY the notice is logged instead.
 *
 * Every write is conditional (the partial unique index on open alerts, and
 * updates that require the state they read), so even two runs at once
 * could not send the same notice twice.
 */
@Injectable()
export class OperationalAlertService {
  private readonly logger = new Logger(OperationalAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly claims: JobClaimService,
    private readonly settings: TenantSettingsService,
    private readonly db: PrismaHealthIndicator,
    private readonly policy: PolicyService,
  ) {}

  /** Every minute: run when this instance claims the current check slot. */
  @Cron('* * * * *', { name: 'operational-alert-monitor' })
  async scheduled(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.ALERT_MONITOR_DISABLED === 'true') return;
    try {
      const slotMs = operationalConfig().alerts.checkIntervalMinutes * 60_000;
      const now = Date.now();
      const slot = new Date(Math.floor(now / slotMs) * slotMs).toISOString();
      if (
        !(await this.claims.once(PLATFORM_JOB_SCOPE, ALERT_MONITOR_JOB, slot))
      )
        return;
      await this.run();
      await this.claims.prune(
        PLATFORM_JOB_SCOPE,
        ALERT_MONITOR_JOB,
        new Date(now - 2 * 86_400_000),
      );
    } catch (e) {
      this.logger.error(
        `Operational alert monitor failed: ${(e as Error).message}`,
      );
    }
  }

  /**
   * One check of everything. `tenantIds` limits the tenant checks (tests);
   * by default every tenant with active lending loans or an open alert.
   */
  async run(
    opts: { now?: Date; tenantIds?: string[] } = {},
  ): Promise<AlertRunResult> {
    const now = opts.now ?? new Date();
    const cfg = operationalConfig().alerts;
    const reminderMs = cfg.reminderHours * 3_600_000;
    const total: AlertRunResult = {
      tenants: 0,
      opened: 0,
      reminded: 0,
      resolved: 0,
    };
    const add = (r: Omit<AlertRunResult, 'tenants'>) => {
      total.opened += r.opened;
      total.reminded += r.reminded;
      total.resolved += r.resolved;
    };

    const tenantIds =
      opts.tenantIds ??
      (await runAsSystem(
        'operational alert monitor: tenants to check',
        async () => {
          const active = await this.prisma.loanAccount.groupBy({
            by: ['tenantId'],
            where: { status: 'ACTIVE' },
          });
          const open = await this.prisma.operationalAlert.groupBy({
            by: ['tenantId'],
            where: { status: 'OPEN', tenantId: { not: null } },
          });
          return [
            ...new Set([
              ...active.map((a) => a.tenantId),
              ...open.map((a) => a.tenantId!),
            ]),
          ];
        },
      ));

    for (const tenantId of tenantIds) {
      // One tenant's failure must not stop the others being checked.
      try {
        add(await this.checkTenant(tenantId, now, reminderMs));
        total.tenants++;
      } catch (e) {
        this.logger.error(
          `Operational alerts for tenant ${tenantId} failed: ${(e as Error).message}`,
        );
      }
    }
    try {
      add(await this.checkPlatform(now, reminderMs));
    } catch (e) {
      this.logger.error(`Platform alerts failed: ${(e as Error).message}`);
    }
    return total;
  }

  /** The tenant checks' findings, read inside the tenant's wall. */
  async tenantFindings(tenantId: string, now: Date): Promise<AlertFinding[]> {
    const cfg = operationalConfig().alerts;
    const p = this.prisma;
    return runAsTenant(tenantId, async () => {
      const today = localDateIn(now);
      const hasLoans =
        (await p.loanAccount.count({ where: { tenantId, status: 'ACTIVE' } })) >
        0;
      const findings: AlertFinding[] = [];
      if (hasLoans) {
        const bd = await p.tenantBusinessDate.findUnique({
          where: { tenantId },
          select: {
            businessDate: true,
            lastBatchDate: true,
            lastBatchFailures: true,
          },
        });
        findings.push(
          ...checkEndOfDay({
            today,
            businessDate: toLocalDate(bd?.businessDate ?? null),
            lastBatchDate: toLocalDate(bd?.lastBatchDate ?? null),
            lastBatchFailures: bd?.lastBatchFailures ?? 0,
            maxLagDays: cfg.eodMaxLagDays,
          }),
        );
        const first = await p.lendingJournalEntry.findFirst({
          where: { tenantId },
          orderBy: { entryDate: 'asc' },
          select: { entryDate: true },
        });
        const closed = await p.accountingPeriod.findMany({
          where: {
            tenantId,
            month: { gt: 0 },
            status: { in: ['CLOSED', 'REOPEN_PENDING'] },
          },
          select: { year: true, month: true },
        });
        findings.push(
          ...checkMonthEnd({
            today,
            firstPostingDate: toLocalDate(first?.entryDate ?? null),
            closedMonths: closed.map(
              (c) => `${c.year}-${String(c.month).padStart(2, '0')}`,
            ),
            graceDays: cfg.monthEndCloseDays,
          }),
        );
      }

      const outboxOldest = await p.outboxMessage.findFirst({
        where: { tenantId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      findings.push(
        ...checkBacklog({
          kind: 'outbox',
          now,
          oldestPendingAt: outboxOldest?.createdAt ?? null,
          pending: outboxOldest
            ? await p.outboxMessage.count({
                where: { tenantId, status: 'PENDING' },
              })
            : 0,
          maxAgeMinutes: cfg.backlogMaxAgeMinutes,
        }),
      );
      const webhookOldest = await p.webhookDelivery.findFirst({
        where: { tenantId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      findings.push(
        ...checkBacklog({
          kind: 'webhooks',
          now,
          oldestPendingAt: webhookOldest?.createdAt ?? null,
          pending: webhookOldest
            ? await p.webhookDelivery.count({
                where: { tenantId, status: 'PENDING' },
              })
            : 0,
          maxAgeMinutes: cfg.backlogMaxAgeMinutes,
        }),
      );

      const rec = await p.auditEvent.findFirst({
        where: { tenantId, action: 'accounting.reconciliation' },
        orderBy: { eventTime: 'desc' },
        select: { details: true, eventTime: true },
      });
      findings.push(
        ...checkReconciliation({
          lastRun: rec
            ? {
                at: rec.eventTime,
                breaks: Number(
                  (rec.details as { breaks?: number } | null)?.breaks ?? 0,
                ),
              }
            : null,
        }),
      );

      const failures = await p.auditEvent.findMany({
        where: {
          tenantId,
          outcome: 'FAILURE',
          actorType: 'SERVICE',
          actorId: { startsWith: 'system:' },
          eventTime: {
            gte: new Date(
              now.getTime() - cfg.jobFailureLookbackHours * 3_600_000,
            ),
          },
        },
        select: { action: true, eventTime: true },
        take: 500,
      });
      findings.push(
        ...checkFailedJobs({
          failures: failures.map((f) => ({
            action: f.action,
            at: f.eventTime,
          })),
          lookbackHours: cfg.jobFailureLookbackHours,
        }),
      );
      return findings;
    });
  }

  /** The platform checks' findings: the database, as the readiness probe sees it. */
  async platformFindings(): Promise<AlertFinding[]> {
    const cfg = operationalConfig();
    const reachable = await this.db.ping(cfg.readinessDbTimeoutMs);
    let connections: number | null = null;
    let maxConnections: number | null = null;
    if (reachable) {
      const [row] = await runAsSystem(
        'operational alert monitor: database',
        () =>
          this.prisma.$queryRaw<{ n: bigint; max: string }[]>`
          SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS n,
                 current_setting('max_connections') AS max`,
      );
      connections = Number(row.n);
      maxConnections = Number(row.max);
    }
    return checkDatabase({
      reachable,
      connections,
      maxConnections,
      maxPct: cfg.alerts.dbConnectionsPct,
    });
  }

  private async checkTenant(tenantId: string, now: Date, reminderMs: number) {
    const findings = await this.tenantFindings(tenantId, now);
    return runAsTenant(tenantId, async () => {
      const [tenant, settings] = await Promise.all([
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true },
        }),
        // Settings in force that no longer validate must not silence the
        // tenant's alerts: the operator is still told.
        this.settings.get(tenantId).catch((e: Error) => {
          this.logger.error(
            `Alerts for tenant ${tenantId}: lending settings unreadable, e-mailing the operator only — ${e.message}`,
          );
          return null;
        }),
      ]);
      return this.reconcile(
        tenantId,
        tenant?.name ?? tenantId,
        settings?.operations.alertEmails ?? [],
        findings,
        now,
        reminderMs,
      );
    });
  }

  private async checkPlatform(now: Date, reminderMs: number) {
    const findings = await this.platformFindings();
    return runAsSystem('operational alert monitor: platform alerts', () =>
      this.reconcile(null, null, [], findings, now, reminderMs),
    );
  }

  /** Bring one scope's open alerts in line with its findings, and notify. */
  private async reconcile(
    tenantId: string | null,
    tenantName: string | null,
    tenantEmails: string[],
    findings: AlertFinding[],
    now: Date,
    reminderMs: number,
  ) {
    const a = this.prisma.operationalAlert;
    const open: (OpenAlertState & { summary: string; severity: string })[] =
      await a.findMany({
        where: { tenantId, status: 'OPEN' },
        select: {
          id: true,
          key: true,
          lastNotifiedAt: true,
          summary: true,
          severity: true,
        },
      });
    const plan = planAlerts(open, findings, now, reminderMs);
    const to = alertRecipients(
      operationalConfig().alerts.emailTo,
      tenantId ? tenantEmails : [],
    );
    const result = { opened: 0, reminded: 0, resolved: 0 };
    const json = (d: Record<string, unknown>) => d as Prisma.InputJsonValue;

    for (const f of plan.open) {
      let id: string;
      try {
        id = (
          await a.create({
            data: {
              tenantId,
              key: f.key,
              severity: f.severity,
              summary: f.summary.slice(0, 500),
              details: json(f.details),
              openedAt: now,
              lastSeenAt: now,
              lastNotifiedAt: now,
            },
            select: { id: true },
          })
        ).id;
      } catch (e) {
        // Opened meanwhile by another run (one open alert per key): its notice is that run's.
        if ((e as { code?: string }).code === 'P2002') continue;
        throw e;
      }
      const delivery = await this.notify('OPENED', tenantName, f, to);
      await a.update({
        where: { id },
        data: { lastDelivery: delivery, notifyCount: 1 },
      });
      result.opened++;
    }

    for (const k of plan.keep) {
      await a.update({
        where: { id: k.alert.id },
        data: {
          lastSeenAt: now,
          severity: k.finding.severity,
          summary: k.finding.summary.slice(0, 500),
          details: json(k.finding.details),
        },
      });
      if (!k.remind) continue;
      // Claim the reminder: only if nobody sent one since this run read the alert.
      const claimed = await a.updateMany({
        where: {
          id: k.alert.id,
          status: 'OPEN',
          lastNotifiedAt: k.alert.lastNotifiedAt,
        },
        data: { lastNotifiedAt: now },
      });
      if (claimed.count !== 1) continue;
      const delivery = await this.notify(
        'STILL OPEN',
        tenantName,
        k.finding,
        to,
      );
      await a.update({
        where: { id: k.alert.id },
        data: { lastDelivery: delivery, notifyCount: { increment: 1 } },
      });
      result.reminded++;
    }

    for (const r of plan.resolve) {
      const done = await a.updateMany({
        where: { id: r.id, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAt: now, lastSeenAt: now },
      });
      if (done.count !== 1) continue;
      const was = open.find((o) => o.id === r.id)!;
      const delivery = await this.notify(
        'RESOLVED',
        tenantName,
        {
          key: r.key,
          severity: was.severity as AlertFinding['severity'],
          summary: was.summary,
          details: {},
        },
        to,
      );
      await a.update({
        where: { id: r.id },
        data: {
          lastDelivery: delivery,
          lastNotifiedAt: now,
          notifyCount: { increment: 1 },
        },
      });
      result.resolved++;
    }
    return result;
  }

  /**
   * E-mail one notice: the operator list and the tenant's own list get
   * separate messages, so neither sees the other's addresses. Logged only
   * when there is nobody to tell or no e-mail provider.
   */
  private async notify(
    notice: Notice,
    tenantName: string | null,
    f: AlertFinding,
    to: { operator: string[]; tenant: string[] },
  ): Promise<Delivery> {
    const platform = operationalConfig().platformName;
    const scope = tenantName ?? 'Platform';
    const label =
      notice === 'RESOLVED'
        ? 'Resolved'
        : notice === 'STILL OPEN'
          ? 'Still open'
          : f.severity === 'CRITICAL'
            ? 'ALERT'
            : 'Warning';
    const subject = `[${platform}] ${label}: ${f.summary} — ${scope}`;
    const line = `Operational alert ${notice} [${f.severity}] ${f.key} (${scope}): ${f.summary}`;
    const lists = [to.operator, to.tenant].filter((l) => l.length);
    if (!lists.length || !isEmailConfigured()) {
      this.logger.warn(
        `${line} — not e-mailed (${lists.length ? 'RESEND_API_KEY not set' : 'no recipients: set ALERT_EMAIL_TO'})`,
      );
      return 'LOG_ONLY';
    }
    this.logger.log(line);
    let failed = false;
    for (const list of lists) {
      // The lender's staff are sent to their operations page, the operator to the platform's.
      const html = this.html(notice, scope, f, list === to.tenant);
      try {
        const r = await sendEmailViaProvider(list, subject.slice(0, 250), html);
        if (!r.sent) {
          failed = true;
          this.logger.error(`Alert e-mail not sent: ${r.reason}`);
        }
      } catch (e) {
        failed = true;
        this.logger.error(`Alert e-mail not sent: ${(e as Error).message}`);
      }
    }
    return failed ? 'FAILED' : 'EMAIL';
  }

  private html(
    notice: Notice,
    scope: string,
    f: AlertFinding,
    tenantScoped: boolean,
  ): string {
    let link = '';
    try {
      link = `${webOrigin()}/en/${tenantScoped ? 'lending/operations' : 'tenants'}`;
    } catch {
      // No web origin configured: the e-mail goes out without a link.
    }
    const rows = Object.entries(f.details)
      .map(
        ([k, v]) =>
          `<tr><td style="padding:2px 8px;color:#697386">${escapeHtml(k)}</td><td style="padding:2px 8px;font-family:monospace">${escapeHtml(
            typeof v === 'string' ? v : (JSON.stringify(v) ?? ''),
          )}</td></tr>`,
      )
      .join('');
    return [
      `<p><strong>${escapeHtml(notice === 'RESOLVED' ? 'Resolved' : notice === 'OPENED' ? 'New alert' : 'Still open')}</strong> — ${escapeHtml(scope)}</p>`,
      `<p>${escapeHtml(f.summary)}</p>`,
      `<p style="color:#697386">Severity ${escapeHtml(f.severity)} · key <code>${escapeHtml(f.key)}</code></p>`,
      rows && notice !== 'RESOLVED' ? `<table>${rows}</table>` : '',
      link
        ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`
        : '',
      notice === 'RESOLVED'
        ? ''
        : `<p style="color:#697386">You will get one e-mail when it resolves, and a reminder every ${operationalConfig().alerts.reminderHours} h while it stays open.</p>`,
    ].join('\n');
  }

  // ── Screens ────────────────────────────────────────────────────────────────

  /** A tenant's open alerts and the last resolved ones (the operations page). */
  async forTenant(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'tenant_settings.read',
      tenantResource(tenantId),
    );
    return runAsTenant(tenantId, async () => ({
      open: await this.prisma.operationalAlert.findMany({
        where: { tenantId, status: 'OPEN' },
        orderBy: [{ severity: 'asc' }, { openedAt: 'asc' }],
        select: ALERT_FIELDS,
      }),
      recentlyResolved: await this.prisma.operationalAlert.findMany({
        where: { tenantId, status: 'RESOLVED' },
        orderBy: { resolvedAt: 'desc' },
        take: 10,
        select: ALERT_FIELDS,
      }),
    }));
  }

  /** Every open alert, platform and tenants, with tenant names (the platform home). */
  async forPlatform() {
    return runAsSystem('platform operator: operational alerts', async () => {
      const open = await this.prisma.operationalAlert.findMany({
        where: { status: 'OPEN' },
        orderBy: [{ severity: 'asc' }, { openedAt: 'asc' }],
        take: 500,
        select: {
          ...ALERT_FIELDS,
          tenant: { select: { id: true, name: true } },
        },
      });
      return {
        open,
        emailConfigured: isEmailConfigured(),
        recipients: operationalConfig().alerts.emailTo.length,
        checkIntervalMinutes: operationalConfig().alerts.checkIntervalMinutes,
      };
    });
  }
}

const ALERT_FIELDS = {
  id: true,
  key: true,
  severity: true,
  status: true,
  summary: true,
  details: true,
  openedAt: true,
  lastSeenAt: true,
  resolvedAt: true,
  lastNotifiedAt: true,
  lastDelivery: true,
} as const;
