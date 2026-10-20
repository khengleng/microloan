import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
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

/** Legacy statuses of a loan still carrying money on the original book. */
export const LEGACY_OPEN = ['DISBURSED', 'DEFAULTED'] as const;
/** Legacy statuses of an application never paid out. */
export const LEGACY_UNFUNDED = ['PENDING', 'APPROVED'] as const;

const PAGE_MAX = 200;

type LegacyRow = Prisma.LoanGetPayload<{
  include: {
    schedules: true;
    borrower: { select: { firstName: true; lastName: true } };
    product: { select: { name: true } };
    branch: { select: { name: true; code: true } };
  };
}>;

/** Why an open legacy loan cannot go through the migration file, or null when it can. */
export type MigrationBlock = 'NOT_OPEN' | 'NO_FUTURE_INSTALMENT' | null;

export interface ArchiveRow {
  id: string;
  borrowerId: string;
  borrowerName: string;
  branch: string | null;
  product: string | null;
  status: string;
  currency: string;
  principal: string;
  principalOutstanding: string;
  overdueAmount: string;
  daysPastDue: number;
  startDate: string | null;
  termMonths: number;
  /** The lending loan it became, when the loan-book migration moved it. */
  migratedTo: { loanAccountId: string; reference: string | null } | null;
  /** Whether the migration file (Lending › Migration) can carry it today. */
  migratable: boolean;
  migrationBlock: MigrationBlock;
}

/**
 * The legacy loan archive (D-154): the original module's loans, read-only,
 * so nothing is stranded once its screens are gone. Lists, one loan in
 * detail and a CSV of the whole archive, each within the reader's branch
 * scope; open loans point to the loan-book migration, which moves them onto
 * the lending platform. Nothing here writes to the legacy tables.
 */
@Injectable()
export class LegacyArchiveService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly businessDate: BusinessDateService,
    private readonly audit: AuditEventService,
  ) {}

  /**
   * The reader's branch scope as a filter on legacy loans, or null for none.
   * Legacy loans carry a branch only, so grants limited to portfolios or
   * legal entities reach no legacy loan.
   */
  private async scope(
    actor: LendingActor,
  ): Promise<Prisma.LoanWhereInput | null> {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'legacy_loan.read',
      tenantResource(tenantId),
    );
    const s = await this.policy.scopeFilter(actor, 'legacy_loan.read');
    if (!s) return null;
    if (!('OR' in s)) return {};
    const branches = new Set<string>();
    for (const g of s.OR as Record<string, unknown>[]) {
      if (g.portfolioId || g.legalEntityId) continue;
      const b = g.branchId as { in?: string[] } | undefined;
      if (!b) return {};
      for (const id of b.in ?? []) branches.add(id);
    }
    return branches.size ? { branchId: { in: [...branches] } } : null;
  }

  /** Counts for the menu and the archive's header; zero everywhere when the reader has no scope. */
  async summary(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    const scope = await this.scope(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      if (!scope)
        return {
          total: 0,
          open: 0,
          unfunded: 0,
          migrated: 0,
          byStatus: {},
          openPrincipal: [],
        };
      const where = { tenantId, ...scope };
      const [byStatus, migrated, openLines] = await Promise.all([
        tx.loan.groupBy({ by: ['status'], where, _count: { _all: true } }),
        this.migratedIds(tx, tenantId),
        tx.repaymentSchedule.findMany({
          where: { loan: { ...where, status: { in: [...LEGACY_OPEN] } } },
          select: {
            principalAmount: true,
            paidPrincipal: true,
            loan: { select: { currency: true } },
          },
        }),
      ]);
      const counts: Record<string, number> = {};
      for (const g of byStatus) counts[g.status] = g._count._all;
      const principal = new Map<string, ReturnType<typeof D>>();
      for (const l of openLines) {
        const c = String(l.loan.currency);
        principal.set(
          c,
          (principal.get(c) ?? D(0)).plus(
            D(l.principalAmount).minus(D(l.paidPrincipal)),
          ),
        );
      }
      const migratedInScope = migrated.size
        ? await tx.loan.count({
            where: { ...where, id: { in: [...migrated.keys()] } },
          })
        : 0;
      return {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        open: LEGACY_OPEN.reduce((a, s) => a + (counts[s] ?? 0), 0),
        unfunded: LEGACY_UNFUNDED.reduce((a, s) => a + (counts[s] ?? 0), 0),
        migrated: migratedInScope,
        byStatus: counts,
        openPrincipal: [...principal.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([currency, amount]) => ({
            currency,
            amount: amount.toFixed(2),
          })),
      };
    });
  }

  async list(
    actor: LendingActor,
    q: { status?: string; q?: string; page?: number; limit?: number },
  ) {
    const tenantId = requireTenant(actor);
    const scope = await this.scope(actor);
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const limit = Math.min(
      PAGE_MAX,
      Math.max(1, Math.floor(Number(q.limit) || 50)),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      if (!scope) return { data: [] as ArchiveRow[], total: 0, page, limit };
      const where = this.where(tenantId, scope, q);
      const [rows, total, migrated, cut] = await Promise.all([
        tx.loan.findMany({
          where,
          include: ROW_INCLUDE,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.loan.count({ where }),
        this.migratedIds(tx, tenantId),
        this.cutOver(tenantId, tx),
      ]);
      return {
        data: rows.map((r) => toRow(r, migrated, cut)),
        total,
        page,
        limit,
      };
    });
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    const scope = await this.scope(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const loan = scope
        ? await tx.loan.findFirst({
            where: { tenantId, id, ...scope },
            include: ROW_INCLUDE,
          })
        : null;
      if (!loan) throw new NotFoundException('Legacy loan not found');
      const [repayments, migrated, cut] = await Promise.all([
        tx.repayment.findMany({
          where: { tenantId, loanId: id },
          orderBy: { date: 'asc' },
          select: {
            id: true,
            date: true,
            amount: true,
            currency: true,
            principalPaid: true,
            interestPaid: true,
            penaltyPaid: true,
            reversedAt: true,
            reversalReason: true,
          },
        }),
        this.migratedIds(tx, tenantId),
        this.cutOver(tenantId, tx),
      ]);
      return {
        ...toRow(loan, migrated, cut),
        annualInterestRate: D(loan.annualInterestRate).toString(),
        interestMethod: loan.interestMethod,
        createdAt: loan.createdAt.toISOString(),
        writtenOffAt: loan.writtenOffAt?.toISOString() ?? null,
        writeOffReason: loan.writeOffReason,
        schedule: [...loan.schedules]
          .sort((a, b) => a.installmentNumber - b.installmentNumber)
          .map((s) => ({
            number: s.installmentNumber,
            dueDate: toLocalDate(s.dueDate),
            principal: D(s.principalAmount).toFixed(2),
            interest: D(s.interestAmount).toFixed(2),
            penalty: D(s.penaltyAmount).toFixed(2),
            total: D(s.totalAmount).toFixed(2),
            paid: D(s.paidPrincipal)
              .plus(D(s.paidInterest))
              .plus(D(s.paidPenalty))
              .toFixed(2),
            isPaid: s.isPaid,
          })),
        repayments: repayments.map((r) => ({
          id: r.id,
          date: r.date.toISOString(),
          amount: D(r.amount).toFixed(2),
          currency: String(r.currency),
          principal: D(r.principalPaid).toFixed(2),
          interest: D(r.interestPaid).toFixed(2),
          penalty: D(r.penaltyPaid).toFixed(2),
          reversedAt: r.reversedAt?.toISOString() ?? null,
          reversalReason: r.reversalReason,
        })),
      };
    });
  }

  /** The whole archive within the reader's scope as CSV (formula-safe cells). */
  async exportCsv(actor: LendingActor, q: { status?: string; q?: string }) {
    const tenantId = requireTenant(actor);
    const scope = await this.scope(actor);
    return this.lp.tenantTx(
      tenantId,
      async (tx) => {
        const rows = scope
          ? await tx.loan.findMany({
              where: this.where(tenantId, scope, q),
              include: ROW_INCLUDE,
              orderBy: { createdAt: 'asc' },
            })
          : [];
        const [migrated, cut] = await Promise.all([
          this.migratedIds(tx, tenantId),
          this.cutOver(tenantId, tx),
        ]);
        const out = [CSV_COLUMNS.join(',')];
        for (const r of rows) {
          const a = toRow(r, migrated, cut);
          const cells: (string | number | null)[] = [
            a.id,
            a.borrowerName,
            a.branch,
            a.product,
            a.status,
            a.currency,
            a.principal,
            a.principalOutstanding,
            a.overdueAmount,
            a.daysPastDue,
            a.startDate,
            a.termMonths,
            a.migratedTo?.reference ?? '',
            a.migrationBlock ?? (a.migratable ? 'MIGRATABLE' : ''),
          ];
          out.push(cells.map(csvCell).join(','));
        }
        await this.audit.write(
          {
            actor,
            action: 'legacy_loan.read',
            resourceType: 'Tenant',
            resourceId: tenantId,
            outcome: 'SUCCESS',
            details: { export: 'legacy-loan-archive', rows: rows.length },
          },
          tx,
        );
        return out.join('\n') + '\n';
      },
      { timeoutMs: 600_000 },
    );
  }

  private where(
    tenantId: string,
    scope: Prisma.LoanWhereInput,
    q: { status?: string; q?: string },
  ): Prisma.LoanWhereInput {
    const where: Prisma.LoanWhereInput = { tenantId, ...scope };
    const status = typeof q.status === 'string' ? q.status : '';
    if (status === 'OPEN') where.status = { in: [...LEGACY_OPEN] };
    else if (status === 'UNFUNDED') where.status = { in: [...LEGACY_UNFUNDED] };
    else if (
      [
        'PENDING',
        'APPROVED',
        'REJECTED',
        'DISBURSED',
        'CLOSED',
        'DEFAULTED',
        'WRITTEN_OFF',
      ].includes(status)
    )
      where.status = status as Prisma.LoanWhereInput['status'];
    const text = typeof q.q === 'string' ? q.q.trim().slice(0, 80) : '';
    if (text)
      where.OR = [
        { id: { startsWith: text.toLowerCase() } },
        { borrower: { firstName: { contains: text, mode: 'insensitive' } } },
        { borrower: { lastName: { contains: text, mode: 'insensitive' } } },
      ];
    return where;
  }

  /** Legacy loan id → the lending loan a posted migration row made of it. */
  private async migratedIds(tx: Tx, tenantId: string) {
    const rows = await tx.migrationRow.findMany({
      where: {
        tenantId,
        status: 'POSTED',
        externalLoanId: { startsWith: 'LEGACY-' },
      },
      select: { externalLoanId: true, loanAccountId: true },
    });
    const accounts = await tx.loanAccount.findMany({
      where: {
        tenantId,
        id: {
          in: rows.map((r) => r.loanAccountId).filter(Boolean) as string[],
        },
      },
      select: { id: true, reference: true },
    });
    const ref = new Map(accounts.map((a) => [a.id, a.reference]));
    const out = new Map<
      string,
      { loanAccountId: string; reference: string | null }
    >();
    for (const r of rows)
      if (r.loanAccountId)
        out.set(r.externalLoanId.slice('LEGACY-'.length), {
          loanAccountId: r.loanAccountId,
          reference: ref.get(r.loanAccountId) ?? null,
        });
    return out;
  }

  /** The migration file's cut-over date: the tenant's business date. */
  private async cutOver(tenantId: string, tx: Tx) {
    return fromLocalDate(await this.businessDate.get(tenantId, tx));
  }
}

const ROW_INCLUDE = {
  schedules: true,
  borrower: { select: { firstName: true, lastName: true } },
  product: { select: { name: true } },
  branch: { select: { name: true, code: true } },
} as const;

const CSV_COLUMNS = [
  'legacy_loan_id',
  'borrower',
  'branch',
  'product',
  'status',
  'currency',
  'principal',
  'principal_outstanding',
  'overdue_amount',
  'days_past_due',
  'start_date',
  'term_months',
  'migrated_to',
  'migration',
];

function csvCell(v: string | number | null | undefined): string {
  const s0 = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@]/.test(s0) ? `'${s0}` : s0;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One archive row; balances from the schedule as the legacy screens showed them. */
export function toRow(
  l: LegacyRow,
  migrated: Map<string, { loanAccountId: string; reference: string | null }>,
  cut: Date,
): ArchiveRow {
  const open = (LEGACY_OPEN as readonly string[]).includes(l.status);
  let outstanding = D(0);
  let overdue = D(0);
  let oldestOverdue: Date | null = null;
  let future = 0;
  for (const s of l.schedules) {
    outstanding = outstanding.plus(
      D(s.principalAmount).minus(D(s.paidPrincipal)),
    );
    const owed = D(s.totalAmount)
      .minus(D(s.paidPrincipal))
      .minus(D(s.paidInterest))
      .minus(D(s.paidPenalty));
    if (s.dueDate > cut) future += 1;
    else if (open && owed.gt(0)) {
      overdue = overdue.plus(owed);
      if (!oldestOverdue || s.dueDate < oldestOverdue)
        oldestOverdue = s.dueDate;
    }
  }
  const moved = migrated.get(l.id) ?? null;
  const block: MigrationBlock = !open
    ? 'NOT_OPEN'
    : future === 0
      ? 'NO_FUTURE_INSTALMENT'
      : null;
  return {
    id: l.id,
    borrowerId: l.borrowerId,
    borrowerName: `${l.borrower.firstName} ${l.borrower.lastName}`.trim(),
    branch: l.branch ? (l.branch.code ?? l.branch.name) : null,
    product: l.product?.name ?? null,
    status: l.status,
    currency: String(l.currency),
    principal: D(l.principal).toFixed(2),
    principalOutstanding: (open ? outstanding : D(0)).toFixed(2),
    overdueAmount: overdue.toFixed(2),
    daysPastDue: oldestOverdue
      ? Math.max(
          0,
          Math.floor((cut.getTime() - oldestOverdue.getTime()) / 86_400_000),
        )
      : 0,
    startDate: toLocalDate(l.startDate),
    termMonths: l.termMonths,
    migratedTo: moved,
    migratable: open && block === null,
    migrationBlock: open ? block : moved ? null : block,
  };
}
