import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  LendingActor,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { loadLoanState, resourceOf } from '../servicing/loan-state';

const D = (v: Prisma.Decimal | string | number | null | undefined) =>
  new lending.D(v === null || v === undefined ? 0 : v.toString());

/** One CSV cell, neutralised against spreadsheet formula injection. */
function cell(v: unknown): string {
  const s =
    v === null || v === undefined
      ? ''
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v as string | number | boolean);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const csv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';

const MONEY_EVENTS = [
  'DISBURSEMENT',
  'REPAYMENT',
  'SETTLEMENT',
  'PREPAYMENT',
  'RECOVERY',
  'WRITE_OFF',
  'FEE',
  'PENALTY',
  'REVERSAL',
  'DOWN_PAYMENT',
  'ADVANCE_REFUND',
  'CAPITALIZATION',
];

/**
 * Customer and regulatory outputs built from the books: loan statements
 * (OPS-4), due and overdue notices (OPS-7), closure letters (UC-75), the
 * general-ledger export (OPS-6) and the credit bureau file (UC-75, OPS-2).
 * Read-only: nothing here posts.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
  ) {}

  private async names(tx: Tx, tenantId: string, borrowerId: string) {
    const [tenant, b] = await Promise.all([
      tx.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
      tx.borrower.findFirst({
        where: { id: borrowerId, tenantId },
        select: { firstName: true, lastName: true, address: true },
      }),
    ]);
    return {
      lender: tenant?.name ?? '',
      borrower: `${b?.firstName ?? ''} ${b?.lastName ?? ''}`.trim(),
      address: b?.address ?? '',
    };
  }

  /** OPS-4: what happened on the loan in a period, with the balances either side. */
  async statement(
    actor: LendingActor,
    id: string,
    q: { from?: string; to?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const a = state.account;
      const to = q.to ?? businessDate;
      const from =
        q.from ?? toLocalDate(a.disbursementDate) ?? toLocalDate(a.createdAt)!;
      for (const [k, v] of [
        ['from', from],
        ['to', to],
      ] as const)
        lending.parseDate(v, k);
      if (lending.compareDates(from, to) > 0)
        throw new BadRequestException(
          'The statement must start before it ends.',
        );

      const events = await tx.financialEvent.findMany({
        where: {
          tenantId,
          loanAccountId: id,
          type: { in: MONEY_EVENTS },
          valueDate: { lte: fromLocalDate(to) },
        },
        include: { allocations: true },
        orderBy: [{ valueDate: 'asc' }, { createdAt: 'asc' }],
      });
      // Principal movements: disbursed principal up, allocations to principal down.
      const principalEffect = (e: (typeof events)[number]) => {
        if (e.status === 'REVERSED' && e.type !== 'REVERSAL') return D(0);
        if (e.type === 'DISBURSEMENT') return D(a.bookedPrincipal);
        if (e.type === 'CAPITALIZATION') return D(e.amount);
        if (e.type === 'WRITE_OFF') {
          const c = e.components as { principal?: string };
          return D(c.principal ?? 0).negated();
        }
        return e.allocations
          .filter((x) => x.component === 'PRINCIPAL')
          .reduce((s, x) => s.minus(D(x.amount)), D(0));
      };
      let opening = D(0);
      const rows: {
        date: string;
        type: string;
        reference: string;
        amount: string;
        principal: string;
        interest: string;
        fees: string;
        penalties: string;
        principalBalance: string;
        reversed: boolean;
      }[] = [];
      let running = D(0);
      for (const e of events) {
        const date = toLocalDate(e.valueDate)!;
        const effect = principalEffect(e);
        if (lending.compareDates(date, from) < 0) {
          opening = opening.plus(effect);
          running = opening;
          continue;
        }
        running = running.plus(effect);
        const by = (c: string) =>
          e.allocations
            .filter((x) => x.component === c)
            .reduce((s, x) => s.plus(D(x.amount)), D(0))
            .toString();
        rows.push({
          date,
          type: e.type,
          reference: e.externalReference ?? '',
          amount: e.amount.toString(),
          principal: by('PRINCIPAL'),
          interest: by('INTEREST'),
          fees: by('FEE'),
          penalties: by('PENALTY'),
          principalBalance: running.toString(),
          reversed: e.status === 'REVERSED',
        });
      }
      const next = state.lines
        .filter((l) => l.status === 'DUE')
        .sort((x, y) => x.number - y.number)[0];
      const owed = next
        ? D(next.principalDue)
            .plus(D(next.interestDue))
            .plus(D(next.feeDue))
            .plus(D(next.taxDue))
            .plus(D(next.penaltyDue))
            .minus(D(next.principalPaid))
            .minus(D(next.interestPaid))
            .minus(D(next.feePaid))
            .minus(D(next.taxPaid))
            .minus(D(next.penaltyPaid))
        : null;
      const n = await this.names(tx, tenantId, a.borrowerId);
      const closing = {
        principal: a.principalOutstanding.toString(),
        interest: a.interestReceivable.toString(),
        fees: a.feesReceivable.toString(),
        penalties: a.penaltyReceivable.toString(),
        daysPastDue: a.daysPastDue,
      };
      const text = [
        n.lender,
        `Loan statement — ${a.reference}`,
        `${n.borrower}${n.address ? `, ${n.address}` : ''}`,
        `Period ${from} to ${to} · currency ${a.currency} · status ${a.status}`,
        '',
        `Opening principal ${opening.toString()}`,
        ...rows.map(
          (r) =>
            `${r.date}  ${r.type.padEnd(13)} ${r.amount.padStart(12)}  principal ${r.principal}  interest ${r.interest}  fees ${r.fees}  penalties ${r.penalties}  balance ${r.principalBalance}${r.reversed ? '  (reversed)' : ''}`,
        ),
        '',
        `Closing: principal ${closing.principal}, interest ${closing.interest}, fees ${closing.fees}, penalties ${closing.penalties}.`,
        next
          ? `Next instalment: ${owed!.toString()} ${a.currency} due ${toLocalDate(next.dueDate)}.`
          : 'No instalments outstanding.',
        a.daysPastDue > 0
          ? `Your loan is ${a.daysPastDue} days past due. Please pay the overdue amount promptly.`
          : '',
      ]
        .filter((x) => x !== '')
        .join('\n');
      return {
        loanAccountId: id,
        reference: a.reference,
        currency: a.currency,
        from,
        to,
        opening: { principal: opening.toString() },
        transactions: rows,
        closing,
        nextInstalment: next
          ? {
              number: next.number,
              dueDate: toLocalDate(next.dueDate),
              amount: owed!.toString(),
            }
          : null,
        text,
      };
    });
  }

  /** UC-75: confirmation that a loan is repaid and closed. */
  async closureLetter(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const a = state.account;
      if (a.status !== 'CLOSED')
        throw new ConflictException(
          `A closure letter is issued only for a closed loan; this one is ${a.status}.`,
        );
      const last = await tx.financialEvent.findFirst({
        where: {
          tenantId,
          loanAccountId: id,
          status: 'POSTED',
          type: { in: ['REPAYMENT', 'SETTLEMENT', 'PREPAYMENT'] },
        },
        orderBy: [{ valueDate: 'desc' }, { createdAt: 'desc' }],
      });
      const pledges = await tx.collateralPledge.findMany({
        where: { tenantId, applicationId: a.applicationId },
        include: { collateral: { select: { type: true, description: true } } },
      });
      const n = await this.names(tx, tenantId, a.borrowerId);
      const closedOn = last
        ? toLocalDate(last.valueDate)!
        : await this.businessDate.get(tenantId, tx);
      const text = [
        n.lender,
        `Loan closure letter — ${a.reference}`,
        '',
        `To: ${n.borrower}${n.address ? `, ${n.address}` : ''}`,
        '',
        `This confirms that loan ${a.reference} (${a.currency} ${a.bookedPrincipal.toString()}, disbursed ${toLocalDate(a.disbursementDate) ?? '—'}) was repaid in full on ${closedOn} and is closed. Nothing further is owed on it.`,
        pledges.length
          ? `Security released: ${pledges.map((p) => `${p.collateral.type.toLowerCase().replace(/_/g, ' ')}${p.collateral.description ? ` (${p.collateral.description})` : ''}`).join('; ')}. Any original title documents we hold will be returned to you.`
          : 'No security was held against this loan.',
        'The credit bureau will be told that the loan is closed and paid in the next reporting file.',
      ].join('\n');
      await this.audit.write(
        {
          actor,
          action: 'loan.read',
          resourceType: 'LoanAccount',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { document: 'closure-letter' },
        },
        tx,
      );
      return { loanAccountId: id, reference: a.reference, closedOn, text };
    });
  }

  /**
   * OPS-7: instalments falling due within `days` (DUE_SOON) or already
   * overdue (OVERDUE), each with the notice text to send.
   */
  async notices(actor: LendingActor, q: { kind?: string; days?: number }) {
    const tenantId = requireTenant(actor);
    const kind = q.kind === 'OVERDUE' ? 'OVERDUE' : 'DUE_SOON';
    const days = Math.min(Math.max(Number(q.days ?? 7) || 7, 1), 60);
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    if (!scope) return { kind, days, notices: [] };
    return this.lp.tenantTx(tenantId, async (tx) => {
      const businessDate = await this.businessDate.get(tenantId, tx);
      const until = lending.addDays(businessDate, days);
      const lines = await tx.scheduleInstalment.findMany({
        where: {
          tenantId,
          status: 'DUE',
          dueDate:
            kind === 'OVERDUE'
              ? { lt: fromLocalDate(businessDate) }
              : { gte: fromLocalDate(businessDate), lte: fromLocalDate(until) },
          loanAccount: {
            status: 'ACTIVE',
            ...(scope as Prisma.LoanAccountWhereInput),
          },
        },
        include: {
          loanAccount: {
            select: {
              id: true,
              reference: true,
              currency: true,
              borrowerId: true,
              daysPastDue: true,
            },
          },
        },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
        take: 500,
      });
      const owed = (l: (typeof lines)[number]) =>
        D(l.principalDue)
          .plus(D(l.interestDue))
          .plus(D(l.feeDue))
          .plus(D(l.taxDue))
          .plus(D(l.penaltyDue))
          .minus(D(l.principalPaid))
          .minus(D(l.interestPaid))
          .minus(D(l.feePaid))
          .minus(D(l.taxPaid))
          .minus(D(l.penaltyPaid));
      const borrowers = await tx.borrower.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(lines.map((l) => l.loanAccount.borrowerId))] },
        },
        select: { id: true, firstName: true, lastName: true, phone: true },
      });
      const byId = new Map(borrowers.map((b) => [b.id, b]));
      const notices = lines
        .filter((l) => owed(l).gt(0))
        .map((l) => {
          const b = byId.get(l.loanAccount.borrowerId);
          const name = `${b?.firstName ?? ''} ${b?.lastName ?? ''}`.trim();
          const due = toLocalDate(l.dueDate)!;
          const amount = owed(l).toString();
          return {
            loanAccountId: l.loanAccount.id,
            reference: l.loanAccount.reference,
            borrower: name,
            phone: b?.phone ?? null,
            instalment: l.number,
            dueDate: due,
            amount,
            currency: l.loanAccount.currency,
            daysPastDue: l.loanAccount.daysPastDue,
            text:
              kind === 'OVERDUE'
                ? `Dear ${name}, instalment ${l.number} of loan ${l.loanAccount.reference} (${l.loanAccount.currency} ${amount}) was due on ${due} and is unpaid. Please pay now to avoid further charges.`
                : `Dear ${name}, a reminder that instalment ${l.number} of loan ${l.loanAccount.reference} (${l.loanAccount.currency} ${amount}) is due on ${due}.`,
          };
        });
      return { kind, days, businessDate, notices };
    });
  }

  /** OPS-6: journal lines in a period for the general ledger. */
  async glExport(actor: LendingActor, q: { from?: string; to?: string }) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'accounting.read',
      tenantResource(tenantId),
    );
    if (!q.from || !q.to)
      throw new BadRequestException('Give the period: from and to.');
    lending.parseDate(q.from, 'from');
    lending.parseDate(q.to, 'to');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const entries = await tx.lendingJournalEntry.findMany({
        where: {
          tenantId,
          entryDate: { gte: fromLocalDate(q.from!), lte: fromLocalDate(q.to!) },
        },
        include: {
          lines: true,
          event: { select: { type: true, externalReference: true } },
        },
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
      });
      const loanIds = [
        ...new Set(
          entries.map((e) => e.loanAccountId).filter((x): x is string => !!x),
        ),
      ];
      const loans = await tx.loanAccount.findMany({
        where: { tenantId, id: { in: loanIds } },
        select: { id: true, reference: true },
      });
      const refOf = new Map(loans.map((l) => [l.id, l.reference]));
      const rows: unknown[][] = [];
      let debit = D(0);
      let credit = D(0);
      for (const e of entries)
        for (const l of e.lines) {
          debit = debit.plus(D(l.debit));
          credit = credit.plus(D(l.credit));
          rows.push([
            toLocalDate(e.entryDate),
            e.id,
            e.event.type,
            e.loanAccountId ? (refOf.get(e.loanAccountId) ?? '') : '',
            l.accountCode,
            e.currency,
            l.debit.toString(),
            l.credit.toString(),
            e.description,
            e.event.externalReference ?? '',
          ]);
        }
      await this.audit.write(
        {
          actor,
          action: 'accounting.read',
          resourceType: 'Tenant',
          resourceId: tenantId,
          outcome: 'SUCCESS',
          details: { export: 'gl', from: q.from, to: q.to, lines: rows.length },
        },
        tx,
      );
      return {
        csv: csv(
          [
            'entryDate',
            'entryId',
            'eventType',
            'loanReference',
            'accountCode',
            'currency',
            'debit',
            'credit',
            'description',
            'externalReference',
          ],
          rows,
        ),
        totals: {
          debit: debit.toString(),
          credit: credit.toString(),
          lines: rows.length,
        },
      };
    });
  }

  /**
   * The credit bureau file: one record per loan the actor may export, with
   * its status, balance and arrears as at the business date.
   */
  async bureauExport(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_data.export',
      tenantResource(tenantId),
    );
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const asOf = await this.businessDate.get(tenantId, tx);
      const loans = scope
        ? await tx.loanAccount.findMany({
            where: {
              tenantId,
              status: { in: ['ACTIVE', 'CLOSED', 'WRITTEN_OFF'] },
              ...(scope as Prisma.LoanAccountWhereInput),
            },
            orderBy: { createdAt: 'asc' },
          })
        : [];
      const borrowers = await tx.borrower.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(loans.map((l) => l.borrowerId))] },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          idNumber: true,
          dateOfBirth: true,
        },
      });
      const byId = new Map(borrowers.map((b) => [b.id, b]));
      const status = (s: string, dpd: number) =>
        s === 'CLOSED'
          ? 'CLOSED_PAID'
          : s === 'WRITTEN_OFF'
            ? 'WRITTEN_OFF'
            : dpd > 0
              ? 'ACTIVE_ARREARS'
              : 'ACTIVE_CURRENT';
      const rows = loans.map((l) => {
        const b = byId.get(l.borrowerId);
        const balance = D(l.principalOutstanding)
          .plus(D(l.interestReceivable))
          .plus(D(l.feesReceivable))
          .plus(D(l.penaltyReceivable));
        return [
          asOf,
          l.reference,
          b?.idNumber ?? '',
          b?.lastName ?? '',
          b?.firstName ?? '',
          b?.dateOfBirth ? toLocalDate(b.dateOfBirth) : '',
          l.familyCode,
          l.currency,
          toLocalDate(l.disbursementDate) ?? '',
          toLocalDate(l.maturityDate) ?? '',
          l.bookedPrincipal.toString(),
          l.instalmentAmount?.toString() ?? '',
          balance.toString(),
          l.daysPastDue,
          l.classification ?? '',
          status(l.status, l.daysPastDue),
          l.isRestructured ? 'Y' : 'N',
        ];
      });
      await this.audit.write(
        {
          actor,
          action: 'loan_data.export',
          resourceType: 'Tenant',
          resourceId: tenantId,
          outcome: 'SUCCESS',
          details: { export: 'credit-bureau', asOf, rows: rows.length },
        },
        tx,
      );
      return csv(
        [
          'asOf',
          'loanReference',
          'nationalId',
          'lastName',
          'firstName',
          'dateOfBirth',
          'productFamily',
          'currency',
          'openedOn',
          'maturityDate',
          'creditAmount',
          'instalment',
          'balance',
          'daysPastDue',
          'classification',
          'accountStatus',
          'restructured',
        ],
        rows,
      );
    });
  }
}
