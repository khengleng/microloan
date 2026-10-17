import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { AdapterRegistry } from '../integrations/adapters';

/** Account codes whose GL balance must equal a loan-account balance field. */
const SUBLEDGER_FIELDS: {
  field:
    | 'principalOutstanding'
    | 'interestReceivable'
    | 'feesReceivable'
    | 'penaltyReceivable'
    | 'advanceBalance'
    | 'interestInSuspense'
    | 'allowance';
  mapping: string;
  /** Credit-balance accounts: the GL balance is credits − debits. */
  credit?: true;
  /** Code used when an agreement predates the mapping key. */
  fallback?: string;
}[] = [
  { field: 'principalOutstanding', mapping: 'loansReceivable' },
  { field: 'interestReceivable', mapping: 'interestReceivable' },
  { field: 'feesReceivable', mapping: 'feesReceivable' },
  { field: 'penaltyReceivable', mapping: 'penaltyReceivable' },
  {
    field: 'advanceBalance',
    mapping: 'customerAdvances',
    credit: true,
    fallback: '2300',
  },
  {
    field: 'interestInSuspense',
    mapping: 'interestSuspense',
    credit: true,
    fallback: '2400',
  },
  // The loss allowance is a contra-asset: a credit balance per loan.
  {
    field: 'allowance',
    mapping: 'loanLossAllowance',
    credit: true,
    fallback: '1300',
  },
];

@Injectable()
export class LendingOperationsService {
  private readonly logger = new Logger(LendingOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly adapters: AdapterRegistry,
  ) {}

  // ── Business date, calendars, rates ───────────────────────────────────────

  async getBusinessDate(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    // Not sensitive: any principal holding lending permissions in this tenant may read it.
    const subject = await this.policy.subject(actor);
    if (!subject.active || subject.grants.length === 0)
      throw new ForbiddenException(
        'You have no lending access in this organisation.',
      );
    return { businessDate: await this.businessDate.get(tenantId) };
  }

  async advanceBusinessDate(actor: LendingActor, to: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'business_date.manage',
      tenantResource(tenantId),
    );
    const before = await this.businessDate.get(tenantId);
    const after = await this.businessDate.advance(tenantId, to, actor.id);
    await this.audit.write({
      actor,
      action: 'business_date.manage',
      resourceType: 'Tenant',
      resourceId: tenantId,
      outcome: 'SUCCESS',
      details: { from: before, to: after },
      businessDate: fromLocalDate(after),
    });
    return {
      businessDate: after,
      note: 'Run the servicing batch to accrue interest and assess delinquency for the new date.',
    };
  }

  async upsertCalendar(
    actor: LendingActor,
    body: {
      code: string;
      name: string;
      weekendDays: number[];
      holidays: { date: string; name: string }[];
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'business_date.manage',
      tenantResource(tenantId),
    );
    if (!/^[A-Z0-9_]{2,20}$/.test(body.code ?? ''))
      throw new BadRequestException('Invalid calendar code.');
    if (
      !Array.isArray(body.weekendDays) ||
      body.weekendDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
    )
      throw new BadRequestException('weekendDays are ISO days 1–7.');
    for (const h of body.holidays ?? [])
      lending.parseDate(h.date, 'holiday.date');
    const cal = await this.prisma.holidayCalendar.upsert({
      where: { tenantId_code: { tenantId, code: body.code } },
      create: {
        tenantId,
        code: body.code,
        name: body.name.slice(0, 80),
        weekendDays: body.weekendDays,
      },
      update: { name: body.name.slice(0, 80), weekendDays: body.weekendDays },
    });
    for (const h of body.holidays ?? []) {
      await this.prisma.holiday.upsert({
        where: {
          calendarId_date: { calendarId: cal.id, date: fromLocalDate(h.date) },
        },
        create: {
          calendarId: cal.id,
          date: fromLocalDate(h.date),
          name: h.name.slice(0, 80),
        },
        update: { name: h.name.slice(0, 80) },
      });
    }
    await this.audit.write({
      actor,
      action: 'calendar.update',
      resourceType: 'HolidayCalendar',
      resourceId: cal.id,
      outcome: 'SUCCESS',
      details: { code: body.code, holidays: body.holidays?.length ?? 0 },
    });
    return this.prisma.holidayCalendar.findFirst({
      where: { id: cal.id, tenantId },
      include: { holidays: { orderBy: { date: 'asc' } } },
    });
  }

  async calendars(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_product.read',
      tenantResource(tenantId, 'PRODUCT', 'calendars'),
    );
    const cals = await this.prisma.holidayCalendar.findMany({
      where: { tenantId },
      include: { holidays: { orderBy: { date: 'asc' } } },
    });
    return cals.map((c) => ({
      ...c,
      holidays: c.holidays.map((h) => ({ ...h, date: toLocalDate(h.date) })),
    }));
  }

  async recordRate(
    actor: LendingActor,
    body: {
      benchmarkCode: string;
      observationDate: string;
      rate: string;
      source: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'rate_observation.manage',
      tenantResource(tenantId),
    );
    if (!/^[A-Z0-9_]{2,20}$/.test(body.benchmarkCode ?? ''))
      throw new BadRequestException('Invalid benchmark code.');
    const rate = lending.dec(body.rate, 'rate');
    if (rate.lt(-0.05) || rate.gt(1))
      throw new BadRequestException('Rates are decimal fractions (0.05 = 5%).');
    // Observations are history: a correction is a new observation for the same date, refused here so a reset stays auditable.
    try {
      const row = await this.prisma.rateObservation.create({
        data: {
          tenantId,
          benchmarkCode: body.benchmarkCode,
          observationDate: fromLocalDate(body.observationDate),
          rate: rate.toString(),
          source: body.source.slice(0, 120),
          recordedBy: actor.id,
        },
      });
      await this.audit.write({
        actor,
        action: 'rate_observation.manage',
        resourceType: 'RateObservation',
        resourceId: row.id,
        outcome: 'SUCCESS',
        details: body,
      });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new BadRequestException(
          'An observation for this benchmark and date already exists.',
        );
      throw e;
    }
  }

  async rates(actor: LendingActor, benchmarkCode?: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_product.read',
      tenantResource(tenantId, 'PRODUCT', 'rates'),
    );
    const rows = await this.prisma.rateObservation.findMany({
      where: { tenantId, ...(benchmarkCode ? { benchmarkCode } : {}) },
      orderBy: { observationDate: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      ...r,
      observationDate: toLocalDate(r.observationDate),
      rate: r.rate.toString(),
    }));
  }

  // ── Accounting ────────────────────────────────────────────────────────────

  async journal(
    actor: LendingActor,
    q: { loanAccountId?: string; from?: string; to?: string; page?: number },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'accounting.read',
      tenantResource(tenantId),
    );
    const where: Prisma.LendingJournalEntryWhereInput = { tenantId };
    if (q.loanAccountId) where.loanAccountId = q.loanAccountId;
    if (q.from || q.to)
      where.entryDate = {
        ...(q.from ? { gte: fromLocalDate(q.from) } : {}),
        ...(q.to ? { lte: fromLocalDate(q.to) } : {}),
      };
    const take = 100;
    const [data, total] = await Promise.all([
      this.prisma.lendingJournalEntry.findMany({
        where,
        include: {
          lines: true,
          event: { select: { type: true, status: true, reversalOfId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip: (Math.max(1, q.page ?? 1) - 1) * take,
      }),
      this.prisma.lendingJournalEntry.count({ where }),
    ]);
    return {
      data: data.map((e) => ({
        ...e,
        entryDate: toLocalDate(e.entryDate),
        lines: e.lines.map((l) => ({
          ...l,
          debit: l.debit.toString(),
          credit: l.credit.toString(),
        })),
      })),
      total,
    };
  }

  async trialBalance(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'accounting.read',
      tenantResource(tenantId),
    );
    const entries = await this.prisma.lendingJournalEntry.findMany({
      where: { tenantId },
      select: {
        currency: true,
        lines: { select: { accountCode: true, debit: true, credit: true } },
      },
    });
    const byCurrency = new Map<
      string,
      Map<
        string,
        {
          debit: InstanceType<typeof lending.D>;
          credit: InstanceType<typeof lending.D>;
        }
      >
    >();
    for (const e of entries) {
      const m: Map<
        string,
        {
          debit: InstanceType<typeof lending.D>;
          credit: InstanceType<typeof lending.D>;
        }
      > = byCurrency.get(e.currency) ?? new Map();
      byCurrency.set(e.currency, m);
      for (const l of e.lines) {
        const row = m.get(l.accountCode) ?? {
          debit: new lending.D(0),
          credit: new lending.D(0),
        };
        row.debit = row.debit.plus(l.debit.toString());
        row.credit = row.credit.plus(l.credit.toString());
        m.set(l.accountCode, row);
      }
    }
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { tenantId },
      select: { code: true, name: true, type: true },
    });
    const names = new Map(accounts.map((a) => [a.code, a]));
    return [...byCurrency.entries()].map(([currency, m]) => {
      const rows = [...m.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, v]) => ({
          code,
          name: names.get(code)?.name ?? code,
          type: names.get(code)?.type ?? null,
          debit: v.debit.toString(),
          credit: v.credit.toString(),
          balance: v.debit.minus(v.credit).toString(),
        }));
      const debit = rows.reduce((s, r) => s.plus(r.debit), new lending.D(0));
      const credit = rows.reduce((s, r) => s.plus(r.credit), new lending.D(0));
      return {
        currency,
        rows,
        totals: {
          debit: debit.toString(),
          credit: credit.toString(),
          balanced: debit.eq(credit),
        },
      };
    });
  }

  /**
   * Sub-ledger ↔ general ledger reconciliation. For every loan account the
   * balance fields (principal, accrued interest, fees, penalties) must equal
   * the net of the journal lines posted to the mapped GL accounts for that
   * loan; the schedule's unpaid principal must equal the principal balance.
   * A facility has no schedule, so its principal is reconciled against its
   * posted drawdowns and repayments instead.
   * Any difference is reported as a break — nothing is auto-corrected.
   */
  async reconciliation(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'accounting.read',
      tenantResource(tenantId),
    );
    const accounts = await this.prisma.loanAccount.findMany({
      where: { tenantId, status: { not: 'BOOKED' } },
    });
    const lines = await this.prisma.lendingJournalLine.groupBy({
      by: ['loanAccountId', 'accountCode'],
      where: { tenantId },
      _sum: { debit: true, credit: true },
    });
    const gl = new Map(
      lines.map((l) => [
        `${l.loanAccountId}:${l.accountCode}`,
        D(l._sum.debit ?? '0').minus(D(l._sum.credit ?? '0')),
      ]),
    );
    // A facility has no schedule: its principal is governed by drawdowns and
    // repayments, so it is reconciled against those instead.
    const facilities = await this.prisma.facility.findMany({
      where: { tenantId },
      select: { agreementId: true, reference: true, totalDrawn: true },
    });
    const facilityByAgreement = new Map(
      facilities.map((x) => [x.agreementId, x]),
    );
    const breaks: Record<string, unknown>[] = [];
    for (const a of accounts) {
      const version = await this.prisma.agreementVersion.findFirst({
        where: { tenantId, agreementId: a.agreementId },
        orderBy: { version: 'desc' },
        select: { productConfig: true },
      });
      const mapping = (
        version?.productConfig as
          | { accounting?: Record<string, string> }
          | undefined
      )?.accounting;
      if (!mapping) {
        breaks.push({
          loanAccountId: a.id,
          reference: a.reference,
          check: 'mapping',
          detail: 'agreement has no accounting mapping',
        });
        continue;
      }
      for (const f of SUBLEDGER_FIELDS) {
        const sub = D(a[f.field]);
        const code = mapping[f.mapping] ?? f.fallback;
        const net = gl.get(`${a.id}:${code}`) ?? new lending.D(0);
        const ledger = f.credit ? net.negated() : net;
        if (!sub.eq(ledger))
          breaks.push({
            loanAccountId: a.id,
            reference: a.reference,
            check: f.field,
            subledger: sub.toString(),
            ledger: ledger.toString(),
            difference: sub.minus(ledger).toString(),
          });
      }
      const facility = facilityByAgreement.get(a.agreementId);
      if (facility) {
        // Drawn − repaid must be the principal balance. Capitalized charges
        // raise principal too, so they count as advances here.
        const movements = await this.prisma.financialEvent.groupBy({
          by: ['type'],
          where: {
            tenantId,
            loanAccountId: a.id,
            status: 'POSTED',
            type: {
              in: ['DISBURSEMENT', 'REPAYMENT', 'SETTLEMENT', 'CAPITALIZATION'],
            },
          },
          _sum: { amount: true },
        });
        const movedBy = (t: string) =>
          D(movements.find((m) => m.type === t)?._sum.amount ?? '0');
        const expected = movedBy('DISBURSEMENT')
          .plus(movedBy('CAPITALIZATION'))
          .minus(movedBy('REPAYMENT'))
          .minus(movedBy('SETTLEMENT'));
        if (!expected.eq(D(a.principalOutstanding)))
          breaks.push({
            loanAccountId: a.id,
            reference: a.reference,
            check: 'facilityDrawn',
            facility: facility.reference,
            subledger: D(a.principalOutstanding).toString(),
            movements: expected.toString(),
          });
      } else if (a.status === 'ACTIVE') {
        const sched = await this.prisma.scheduleInstalment.findMany({
          where: { tenantId, loanAccountId: a.id, status: 'DUE' },
          select: {
            principalDue: true,
            principalPaid: true,
            capitalizedInterest: true,
          },
        });
        const unpaid = sched.reduce(
          (s, l) =>
            s
              .plus(D(l.principalDue))
              .minus(D(l.principalPaid))
              .minus(D(l.capitalizedInterest)),
          new lending.D(0),
        );
        if (!unpaid.eq(D(a.principalOutstanding)))
          breaks.push({
            loanAccountId: a.id,
            reference: a.reference,
            check: 'schedulePrincipal',
            subledger: D(a.principalOutstanding).toString(),
            schedule: unpaid.toString(),
          });
      }
    }
    const tb = await this.trialBalance(actor);
    const result = {
      accountsChecked: accounts.length,
      breaks,
      trialBalanceBalanced: tb.every((c) => c.totals.balanced),
      checkedAt: new Date().toISOString(),
    };
    await this.audit.write({
      actor,
      action: 'accounting.reconciliation',
      resourceType: 'Tenant',
      resourceId: tenantId,
      outcome: breaks.length ? 'FAILURE' : 'SUCCESS',
      details: { accounts: accounts.length, breaks: breaks.length },
    });
    return result;
  }

  // ── Audit explorer ────────────────────────────────────────────────────────

  async auditEvents(
    actor: LendingActor,
    q: {
      resourceType?: string;
      resourceId?: string;
      action?: string;
      outcome?: string;
      page?: number;
    },
  ) {
    await this.policy.enforce(
      actor,
      'audit.read',
      tenantResource(actor.tenantId, 'TENANT'),
    );
    // Tenants see their own trail; the platform sees only platform-level events.
    const where: Prisma.AuditEventWhereInput = {
      tenantId: actor.tenantId ?? null,
    };
    if (q.resourceType) where.resourceType = q.resourceType;
    if (q.resourceId) where.resourceId = q.resourceId;
    if (q.action) where.action = { contains: q.action };
    if (q.outcome) where.outcome = q.outcome;
    const take = 100;
    const [data, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { eventTime: 'desc' },
        take,
        skip: (Math.max(1, q.page ?? 1) - 1) * take,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return {
      data: data.map((e) => ({
        ...e,
        businessDate: toLocalDate(e.businessDate),
      })),
      total,
    };
  }

  integrations() {
    return this.adapters.status();
  }

  // ── Outbox delivery ───────────────────────────────────────────────────────

  /**
   * Delivers outbox messages written in the same transaction as the financial
   * change. Mock adapters are refused in production, so there messages stay
   * PENDING with the reason recorded rather than being marked sent.
   */
  @Interval('lending-outbox', 60_000)
  async deliverOutbox(): Promise<void> {
    if (process.env.LENDING_OUTBOX_DISABLED === 'true') return;
    await runAsSystem('lending outbox delivery', async () => {
      const batch = await this.prisma.outboxMessage.findMany({
        where: { status: 'PENDING', availableAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const m of batch) {
        try {
          await this.adapters
            .notifications()
            .send({ tenantId: m.tenantId, topic: m.topic, payload: m.payload });
          await this.prisma.outboxMessage.update({
            where: { id: m.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              attempts: { increment: 1 },
            },
          });
        } catch (e) {
          const attempts = m.attempts + 1;
          await this.prisma.outboxMessage.update({
            where: { id: m.id },
            data: {
              attempts,
              lastError: (e as Error).message.slice(0, 300),
              status: attempts >= 20 ? 'FAILED' : 'PENDING',
              availableAt: new Date(
                Date.now() +
                  Math.min(3_600_000, 60_000 * 2 ** Math.min(attempts, 6)),
              ),
            },
          });
        }
      }
    }).catch((e) =>
      this.logger.warn(`Outbox delivery skipped: ${(e as Error).message}`),
    );
  }
}
