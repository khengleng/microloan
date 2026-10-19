import { BadRequestException, Injectable } from '@nestjs/common';
import { lending } from '@microloan/shared';
import { LendingPrisma } from '../common/lending-prisma';
import { BusinessDateService } from '../common/business-date.service';
import {
  LendingActor,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { instalmentHistories } from './repayment-history';

const APPROVED = new Set(['APPROVED', 'BOOKED']);

/**
 * Scorecard monitoring on the lender's own data (DECISIONS D-080). For each
 * scorecard version — champions and silent challengers alike — on the latest
 * evaluation of each application: the score distribution by grade, approval
 * rates, and for booked loans with a known outcome the bad rate by grade,
 * Gini/AUC and KS; plus population stability between a baseline and a recent
 * window. The bad definition and windows come from the tenant's lending
 * settings and may be overridden per request.
 */
@Injectable()
export class ScoreMonitoringService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly businessDate: BusinessDateService,
    private readonly settings: TenantSettingsService,
  ) {}

  async report(
    actor: LendingActor,
    q: {
      scorecardCode?: string;
      badDaysPastDue?: number;
      performanceMonths?: number;
      baselineFrom?: string;
      baselineTo?: string;
      recentFrom?: string;
      recentTo?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'scorecard.read',
      tenantResource(tenantId, 'TENANT', 'scorecards'),
    );
    return this.lp.tenantTx(
      tenantId,
      async (tx) => {
        const s = (await this.settings.get(tenantId, tx)).scoring.monitoring;
        const asOf = await this.businessDate.get(tenantId, tx);
        const badDpd = q.badDaysPastDue ?? s.badDaysPastDue;
        const months = q.performanceMonths ?? s.performanceMonths;
        const recentTo = q.recentTo ?? asOf;
        const recentFrom =
          q.recentFrom ?? lending.addDays(recentTo, -s.recentWindowDays + 1);
        const baselineTo = q.baselineTo ?? lending.addDays(recentFrom, -1);
        const baselineFrom =
          q.baselineFrom ??
          lending.addDays(baselineTo, -s.baselineWindowDays + 1);
        for (const [a, b] of [
          [baselineFrom, baselineTo],
          [recentFrom, recentTo],
        ]) {
          lending.parseDate(a);
          lending.parseDate(b);
          if (lending.compareDates(a, b) > 0)
            throw new BadRequestException(
              'A window must start before it ends.',
            );
        }

        const rows = await tx.scoreEvaluation.findMany({
          where: {
            tenantId,
            ...(q.scorecardCode ? { scorecardCode: q.scorecardCode } : {}),
          },
          select: {
            applicationId: true,
            role: true,
            scorecardCode: true,
            version: true,
            source: true,
            score: true,
            grade: true,
            outcome: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });
        // The latest evaluation of each application per scorecard version and role.
        const groups = new Map<string, typeof rows>();
        const seen = new Set<string>();
        for (const r of rows) {
          const g = `${r.scorecardCode}|${r.version}|${r.role}`;
          const k = `${g}|${r.applicationId}`;
          if (seen.has(k)) continue;
          seen.add(k);
          groups.set(g, [...(groups.get(g) ?? []), r]);
        }
        const appIds = [...new Set(rows.map((r) => r.applicationId))];
        const [apps, loans] = await Promise.all([
          tx.application.findMany({
            where: { tenantId, id: { in: appIds } },
            select: { id: true, status: true },
          }),
          tx.loanAccount.findMany({
            where: { tenantId, applicationId: { in: appIds } },
            select: {
              id: true,
              applicationId: true,
              status: true,
              disbursementDate: true,
            },
          }),
        ]);
        const statusOf = new Map(apps.map((a) => [a.id, a.status]));
        const disbursed = loans.filter((l) => l.disbursementDate);
        const histories = await instalmentHistories(
          tx,
          tenantId,
          disbursed.map((l) => l.id),
        );
        const outcomeOf = new Map(
          disbursed.map((l) => [
            l.applicationId,
            lending.performanceOutcome({
              disbursementDate: toLocalDate(l.disbursementDate)!,
              instalments: histories.get(l.id) ?? [],
              writtenOff: ['WRITTEN_OFF', 'SOLD'].includes(l.status),
              asOf,
              badDaysPastDue: badDpd,
              performanceMonths: months,
            }),
          ]),
        );

        const inWindow = (d: Date, from: string, to: string) =>
          d >= fromLocalDate(from) && d < fromLocalDate(lending.addDays(to, 1));
        const versions = [...groups.entries()].map(([key, list]) => {
          const [code, version, role] = key.split('|');
          const grades = [...new Set(list.map((r) => r.grade))].sort();
          const byGrade = grades.map((grade) => {
            const g = list.filter((r) => r.grade === grade);
            const approved = g.filter((r) =>
              APPROVED.has(statusOf.get(r.applicationId) ?? ''),
            ).length;
            const rejected = g.filter(
              (r) => statusOf.get(r.applicationId) === 'REJECTED',
            ).length;
            const known = g
              .map((r) => outcomeOf.get(r.applicationId))
              .filter((o): o is NonNullable<typeof o> => !!o && o.mature);
            const bad = known.filter((o) => o.bad).length;
            return {
              grade,
              count: g.length,
              share: lending.share(g.length, list.length),
              minScore: Math.min(...g.map((r) => r.score)),
              maxScore: Math.max(...g.map((r) => r.score)),
              outcomes: {
                AUTO_APPROVE: g.filter((r) => r.outcome === 'AUTO_APPROVE')
                  .length,
                REFER: g.filter((r) => r.outcome === 'REFER').length,
                DECLINE: g.filter((r) => r.outcome === 'DECLINE').length,
              },
              approved,
              rejected,
              approvalRate: lending.share(approved, approved + rejected),
              matureLoans: known.length,
              bad,
              badRate: lending.share(bad, known.length),
            };
          });
          const performance = list
            .map((r) => ({ r, o: outcomeOf.get(r.applicationId) }))
            .filter((x) => x.o?.mature)
            .map((x) => ({ score: x.r.score, bad: x.o!.bad }));
          const count = (from: string, to: string) => {
            const c: Record<string, number> = {};
            for (const r of list)
              if (inWindow(r.createdAt, from, to))
                c[r.grade] = (c[r.grade] ?? 0) + 1;
            return c;
          };
          const baseline = count(baselineFrom, baselineTo);
          const recent = count(recentFrom, recentTo);
          const approved = list.filter((r) =>
            APPROVED.has(statusOf.get(r.applicationId) ?? ''),
          ).length;
          const rejected = list.filter(
            (r) => statusOf.get(r.applicationId) === 'REJECTED',
          ).length;
          return {
            scorecardCode: code,
            version: Number(version),
            source: list[0].source,
            role,
            applications: list.length,
            averageScore: list.length
              ? new lending.D(list.reduce((t, r) => t + r.score, 0))
                  .div(list.length)
                  .toDecimalPlaces(1)
                  .toString()
              : null,
            approvalRate: lending.share(approved, approved + rejected),
            byGrade,
            discrimination: {
              matureLoans: performance.length,
              ...(lending.aucGini(performance) ?? {
                auc: null,
                gini: null,
                goods: performance.filter((p) => !p.bad).length,
                bads: performance.filter((p) => p.bad).length,
              }),
              ks: lending.ksStatistic(performance),
            },
            stability: {
              baseline,
              recent,
              ...(lending.populationStability(
                baseline,
                recent,
                s.psiEpsilon,
              ) ?? { psi: null, bins: [] }),
            },
          };
        });
        versions.sort(
          (a, b) =>
            a.scorecardCode.localeCompare(b.scorecardCode) ||
            b.version - a.version ||
            a.role.localeCompare(b.role),
        );
        return {
          asOf,
          parameters: {
            badDaysPastDue: badDpd,
            performanceMonths: months,
            baseline: { from: baselineFrom, to: baselineTo },
            recent: { from: recentFrom, to: recentTo },
            psiEpsilon: s.psiEpsilon,
          },
          versions,
        };
      },
      { timeoutMs: 60_000 },
    );
  }
}
