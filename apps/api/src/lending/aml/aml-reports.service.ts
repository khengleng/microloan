import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  fromLocalDate,
  newReference,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { maskIdNumber } from '../../common/mask';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { AmlScreeningService } from './aml-screening.service';
import { channelledEvents } from './aml-cash';

/**
 * AML/CFT reports (DECISIONS D-121, D-122):
 *
 *  - the cash transaction report: cash repayments and disbursements at or
 *    above the tenant's threshold per currency, single or aggregated per
 *    customer and business day, for a period — a CSV extract for CAFIU;
 *  - suspicious transaction referrals: any staff member raises one on a
 *    customer (optionally a loan and a payment); only compliance sees them,
 *    records the review, and records the report to CAFIU with its reference
 *    and date. The person raising it gets a reference back and nothing more
 *    (tipping-off).
 */
@Injectable()
export class AmlReportsService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly settings: TenantSettingsService,
    private readonly screening: AmlScreeningService,
  ) {}

  // ── Cash transaction report ───────────────────────────────────────────────

  async cashTransactionReport(
    actor: LendingActor,
    q: { from: string; to: string },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'aml.ctr.read', tenantResource(tenantId));
    if (lending.compareDates(q.from, q.to) > 0)
      throw new BadRequestException('The period starts after it ends.');
    if (lending.compareDates(lending.addDays(q.from, 366), q.to) < 0)
      throw new BadRequestException('Report at most a year at a time.');
    const scope = await this.screening.borrowerScope(actor, 'aml.read');
    const fullIds = await this.policy.holdsPermission(actor, 'aml.str.review');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const s = (await this.settings.get(tenantId, tx)).aml.ctr;
      const events = scope
        ? await channelledEvents(tx, tenantId, {
            businessDate: {
              gte: fromLocalDate(q.from),
              lte: fromLocalDate(q.to),
            },
          })
        : [];
      const inScope = new Set(
        scope && events.length
          ? (
              await tx.borrower.findMany({
                where: {
                  tenantId,
                  id: { in: [...new Set(events.map((e) => e.borrowerId))] },
                  ...scope,
                },
                select: { id: true },
              })
            ).map((b) => b.id)
          : [],
      );
      const mine = events.filter((e) => inScope.has(e.borrowerId));
      const cash = mine.filter(
        (e) => e.channel && s.cashChannels.includes(e.channel as never),
      );
      const report = lending.cashTransactionReport(
        cash.map((e) => ({
          id: e.id,
          borrowerId: e.borrowerId,
          date: e.businessDate,
          currency: e.currency,
          amount: e.amount,
          direction:
            e.type === 'REPAYMENT' ? ('IN' as const) : ('OUT' as const),
        })),
        s.thresholds,
      );
      const ids = [...new Set(report.groups.map((g) => g.borrowerId))];
      const customers = ids.length
        ? await tx.borrower.findMany({
            where: { tenantId, id: { in: ids } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              idType: true,
              idNumber: true,
              branch: { select: { name: true, code: true } },
            },
          })
        : [];
      const byId = new Map(
        customers.map((c) => [
          c.id,
          {
            name: `${c.firstName} ${c.lastName}`.trim(),
            idType: c.idType,
            idNumberHint: c.idNumber
              ? fullIds
                ? c.idNumber
                : maskIdNumber(c.idNumber)
              : null,
            branch: c.branch?.code ?? c.branch?.name ?? null,
          },
        ]),
      );
      const customer = (id: string) =>
        byId.get(id) ?? {
          name: id,
          idType: null,
          idNumberHint: null,
          branch: null,
        };
      await this.audit.write(
        {
          actor,
          action: 'aml.ctr.read',
          resourceType: 'Tenant',
          resourceId: tenantId,
          outcome: 'SUCCESS',
          details: { from: q.from, to: q.to, groups: report.groups.length },
        },
        tx,
      );
      return {
        from: q.from,
        to: q.to,
        thresholds: s.thresholds,
        cashChannels: s.cashChannels,
        groups: report.groups.map((g) => ({
          ...g,
          customer: customer(g.borrowerId),
        })),
        unassessedCurrencies: report.unassessedCurrencies,
        // Postings with no channel on record cannot be classed as cash or not.
        withoutChannel: mine.filter((e) => !e.channel).length,
        cashTransactions: cash.length,
        csv: lending.cashTransactionReportCsv(report.groups, customer),
      };
    });
  }

  // ── Suspicious transaction referrals ──────────────────────────────────────

  async raiseStr(
    actor: LendingActor,
    body: {
      borrowerId: string;
      loanAccountId?: string;
      financialEventId?: string;
      grounds: string;
      indicators?: string[];
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'aml.str.raise',
        await this.screening.customerResource(tx, tenantId, body.borrowerId),
        tx,
      );
      if (body.loanAccountId) {
        const loan = await tx.loanAccount.findFirst({
          where: {
            id: body.loanAccountId,
            tenantId,
            borrowerId: body.borrowerId,
          },
          select: { id: true },
        });
        if (!loan)
          throw new BadRequestException(
            'The loan must be one of this customer’s loans.',
          );
      }
      if (body.financialEventId) {
        const ev = await tx.financialEvent.findFirst({
          where: {
            id: body.financialEventId,
            tenantId,
            loanAccount: body.loanAccountId
              ? { id: body.loanAccountId }
              : { borrowerId: body.borrowerId },
          },
          select: { id: true },
        });
        if (!ev)
          throw new BadRequestException(
            'The payment must be one of this customer’s loan postings.',
          );
      }
      const row = await tx.amlStrCase.create({
        data: {
          tenantId,
          reference: newReference('STR'),
          borrowerId: body.borrowerId,
          loanAccountId: body.loanAccountId ?? null,
          financialEventId: body.financialEventId ?? null,
          grounds: body.grounds.trim(),
          indicators: [...new Set(body.indicators ?? [])],
          raisedBy: actor.id,
        },
      });
      // The trail says a referral was raised, not on whom or why.
      await this.audit.write(
        {
          actor,
          action: 'aml.str.raise',
          resourceType: 'AmlStrCase',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { reference: row.reference },
        },
        tx,
      );
      return { id: row.id, reference: row.reference, status: 'SUBMITTED' };
    });
  }

  async listStr(actor: LendingActor, q: { status?: string }) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'aml.str.review',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => ({
      data: await tx.amlStrCase.findMany({
        where: { tenantId, ...(q.status ? { status: q.status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          borrower: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              branchId: true,
            },
          },
        },
      }),
    }));
  }

  async getStr(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'aml.str.review',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.amlStrCase.findFirst({
        where: { id, tenantId },
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
      if (!row) throw new NotFoundException('Referral not found');
      await this.audit.write(
        {
          actor,
          action: 'aml.str.read',
          resourceType: 'AmlStrCase',
          resourceId: row.id,
          outcome: 'SUCCESS',
        },
        tx,
      );
      return { ...row, cafiuReportedOn: toLocalDate(row.cafiuReportedOn) };
    });
  }

  /** Compliance records its review: no further action, or to be reported to CAFIU. */
  async reviewStr(
    actor: LendingActor,
    id: string,
    body: { decision: 'NO_FURTHER_ACTION' | 'TO_REPORT'; notes: string },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'aml.str.review',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.amlStrCase.findFirst({ where: { id, tenantId } });
      if (!row) throw new NotFoundException('Referral not found');
      if (row.status !== 'OPEN')
        throw new ConflictException(
          `This referral is already reviewed (${row.status.toLowerCase().replace(/_/g, ' ')}).`,
        );
      const res = await tx.amlStrCase.updateMany({
        where: { id, tenantId, status: 'OPEN' },
        data: {
          status: body.decision,
          reviewNotes: body.notes.trim(),
          reviewedBy: actor.id,
          reviewedAt: new Date(),
        },
      });
      if (res.count !== 1) throw concurrentModification('This referral');
      await this.audit.write(
        {
          actor,
          action: 'aml.str.review',
          resourceType: 'AmlStrCase',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { decision: body.decision },
        },
        tx,
      );
      return this.getRow(tx, tenantId, id);
    });
  }

  /** Record that the referral was reported to CAFIU, with its reference and date. */
  async markReported(
    actor: LendingActor,
    id: string,
    body: { cafiuReference: string; reportedOn: string },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'aml.str.review',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.amlStrCase.findFirst({ where: { id, tenantId } });
      if (!row) throw new NotFoundException('Referral not found');
      if (row.status !== 'TO_REPORT')
        throw new ConflictException(
          'Only a referral reviewed as "to report" can be marked reported.',
        );
      if (
        lending.compareDates(
          body.reportedOn,
          new Date().toISOString().slice(0, 10),
        ) > 0
      )
        throw new BadRequestException(
          'The report date cannot be in the future.',
        );
      const res = await tx.amlStrCase.updateMany({
        where: { id, tenantId, status: 'TO_REPORT' },
        data: {
          status: 'REPORTED',
          cafiuReference: body.cafiuReference.trim(),
          cafiuReportedOn: fromLocalDate(body.reportedOn),
          reportedBy: actor.id,
        },
      });
      if (res.count !== 1) throw concurrentModification('This referral');
      await this.audit.write(
        {
          actor,
          action: 'aml.str.report',
          resourceType: 'AmlStrCase',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { reportedOn: body.reportedOn },
        },
        tx,
      );
      return this.getRow(tx, tenantId, id);
    });
  }

  private async getRow(tx: Tx, tenantId: string, id: string) {
    const row = await tx.amlStrCase.findFirst({ where: { id, tenantId } });
    return row && { ...row, cafiuReportedOn: toLocalDate(row.cafiuReportedOn) };
  }
}
