import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import * as XLSX from 'xlsx';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  fromLocalDate,
  requireTenant,
  sha256,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { publicExplanation } from '../policy/decision';
import { tenantResource } from '../policy/resources';
import { monthBounds } from '../accounting/period-close.service';
import { periodLabel } from '../accounting/period-lock';
import { ACCOUNT_CODES } from '../../ledger/chart-of-accounts';
import { operationalConfig } from '../../config/operational-config';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { RegulatoryReserveService } from '../accounting/regulatory-reserve.service';
import { originalTermDays } from '../servicing/loan-state';
import {
  LedgerFact,
  LoanPosition,
  Movement,
  ReturnContent,
  buildReturn,
  reconciliationTable,
  returnCsv,
} from './regulatory-return';

type Json = Prisma.InputJsonValue;

interface SnapshotTb {
  currency: string;
  accountCode: string;
  debit: string;
  credit: string;
}
interface CloseSnapshot {
  trialBalance?: SnapshotTb[];
  loanGrades?: {
    asOf: string;
    loans: {
      id: string;
      dpd: number;
      classification: string | null;
      restructured: boolean;
      /** Kept since D-113/D-114; absent in older closes. */
      onProbation?: boolean;
      floorDpd?: number | null;
      termDays?: number | null;
    }[];
  };
  regulatoryReserve?: { mode: 'REGULATORY' | 'ECL' | 'NONE' };
}

const DAY_MS = 86_400_000;

/** A legacy loan's original term in days: its start to start + term months (D-114). */
function legacyTermDays(start: Date, termMonths: number): number | null {
  if (!termMonths) return null;
  const s = toLocalDate(start)!;
  return lending.daysBetween(s, lending.addMonths(s, termMonths));
}

/**
 * Monthly regulatory returns (OPS-7) for the lending platform and the legacy
 * loans together, so a tenant files one return.
 *
 * - A return is generated for a CLOSED month only, from the month's frozen
 *   close: balances are read from the journals as of the month end (they
 *   cannot move once the month is locked) and checked against the trial
 *   balance frozen at the close; days past due and classes come from the
 *   loan grades the close kept.
 * - The stored content and its hash never change (database trigger). A
 *   correction is a new version: it supersedes a draft, or amends a
 *   submitted return.
 * - Submission is maker-checker: the preparer asks, a different person
 *   submits; a return whose loans do not tie to the ledger cannot be sent.
 */
@Injectable()
export class RegulatoryReturnService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly settings: TenantSettingsService,
    private readonly reserve: RegulatoryReserveService,
  ) {}

  private validMonth(year: number, month: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2200)
      throw new BadRequestException('Give a year between 2000 and 2200.');
    if (!Number.isInteger(month) || month < 1 || month > 12)
      throw new BadRequestException('Give a month from 1 to 12.');
  }

  private async can(
    actor: LendingActor,
    action: string,
    makers: string[] = [],
  ) {
    const tenantId = requireTenant(actor);
    const d = publicExplanation(
      await this.policy.decide(
        actor,
        action,
        tenantResource(tenantId, 'TENANT', tenantId, makers),
      ),
    );
    return {
      allowed: d.allowed,
      reason: d.blockedBy.map((b) => b.message).join(' '),
    };
  }

  // ── Gathering the facts ───────────────────────────────────────────────────

  /** Everything the return is built from, as of the last day of the month. */
  async gather(
    tx: Tx,
    tenantId: string,
    year: number,
    month: number,
    snapshot: CloseSnapshot | null,
  ) {
    const { start, end } = monthBounds(year, month);
    const endDate = fromLocalDate(end);
    const startDate = fromLocalDate(start);
    // Legacy journals are timestamped: the month runs to midnight UTC after its last day.
    const legacyEnd = new Date(endDate.getTime() + DAY_MS);
    const warnings: string[] = [];

    const [tenant, branches, businessDate] = await Promise.all([
      tx.tenant.findUnique({
        where: { id: tenantId },
        // `id` lets the tenant guard confirm the row is ours; without it the
        // read comes back null and the return shows the deployment ceiling.
        select: { id: true, name: true, maxAnnualInterestRatePct: true },
      }),
      tx.branch.findMany({
        where: { tenantId },
        select: { id: true, name: true },
      }),
      this.businessDate.get(tenantId, tx),
    ]);
    const branchName = new Map(branches.map((b) => [b.id, b.name]));

    // ── Lending platform ──
    const accounts = await tx.loanAccount.findMany({
      where: { tenantId, status: { not: 'BOOKED' } },
      select: {
        id: true,
        reference: true,
        borrowerId: true,
        branchId: true,
        applicationId: true,
        productId: true,
        productVersionId: true,
        familyCode: true,
        currency: true,
        status: true,
        bookedPrincipal: true,
        daysPastDue: true,
        classification: true,
        isRestructured: true,
        lastRestructuredAt: true,
        probationRemaining: true,
        delinquencyFloorDpd: true,
        disbursementDate: true,
        maturityDate: true,
        originalMaturityDate: true,
      },
    });
    const versionIds = [...new Set(accounts.map((a) => a.productVersionId))];
    const productIds = [...new Set(accounts.map((a) => a.productId))];
    const [versions, products, perLoan, applications] = await Promise.all([
      tx.productVersion.findMany({
        where: { tenantId, id: { in: versionIds } },
        select: { id: true, config: true },
      }),
      tx.lendingProduct.findMany({
        where: { tenantId, id: { in: productIds } },
        select: { id: true, name: true },
      }),
      tx.lendingJournalLine.groupBy({
        by: ['loanAccountId', 'accountCode'],
        where: {
          tenantId,
          loanAccountId: { not: null },
          entry: { entryDate: { lte: endDate } },
        },
        _sum: { debit: true, credit: true },
      }),
      tx.application.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(accounts.map((a) => a.applicationId))] },
        },
        select: { id: true, purpose: true, groupId: true },
      }),
    ]);
    const mapping = new Map(
      versions.map((v) => [
        v.id,
        (v.config as { accounting?: Record<string, string> } | null)
          ?.accounting ?? {},
      ]),
    );
    const codesFor = (versionId: string) => {
      const m = mapping.get(versionId) ?? {};
      return {
        principal: m.loansReceivable ?? ACCOUNT_CODES.LOANS_RECEIVABLE,
        interest: m.interestReceivable ?? ACCOUNT_CODES.INTEREST_RECEIVABLE,
        allowance:
          m.loanLossAllowance ?? ACCOUNT_CODES.ALLOWANCE_FOR_LOAN_LOSSES,
      };
    };
    const net = new Map(
      perLoan.map((l) => [
        `${l.loanAccountId}:${l.accountCode}`,
        D(l._sum.debit).minus(D(l._sum.credit)),
      ]),
    );
    const productName = new Map(products.map((p) => [p.id, p.name]));
    const appById = new Map(applications.map((a) => [a.id, a]));
    const grades = new Map(
      (snapshot?.loanGrades?.loans ?? []).map((g) => [g.id, g]),
    );
    const attributesAsOf = snapshot?.loanGrades?.asOf ?? businessDate;
    if (snapshot && !snapshot.loanGrades)
      warnings.push(
        `The close of ${periodLabel(year, month)} predates loan grading in the snapshot: days past due and classes are as of ${businessDate}, not the month end.`,
      );
    else if (!snapshot)
      warnings.push(
        `Preview: ${periodLabel(year, month)} is not closed, so days past due and classes are as of ${businessDate}.`,
      );
    else if (attributesAsOf !== end)
      warnings.push(
        `Days past due and classes were captured when the close was prepared, on ${attributesAsOf} (month end ${end}).`,
      );

    const lendingLoans = accounts.filter((a) => {
      const c = codesFor(a.productVersionId);
      return !(net.get(`${a.id}:${c.principal}`) ?? D(0)).isZero();
    });
    const borrowerIds = new Set(lendingLoans.map((a) => a.borrowerId));

    // Rates: the instalment running at the month end on the agreement version in force.
    const instalments = await tx.scheduleInstalment.findMany({
      where: {
        tenantId,
        loanAccountId: { in: lendingLoans.map((a) => a.id) },
        status: { not: 'SUPERSEDED' },
      },
      select: {
        loanAccountId: true,
        agreementVersion: true,
        dueDate: true,
        annualRate: true,
      },
      orderBy: [{ agreementVersion: 'desc' }, { dueDate: 'asc' }],
    });
    const rateOf = new Map<string, string>();
    const byLoan = new Map<string, typeof instalments>();
    for (const i of instalments) {
      const l = byLoan.get(i.loanAccountId) ?? [];
      l.push(i);
      byLoan.set(i.loanAccountId, l);
    }
    for (const [id, list] of byLoan) {
      const top = list[0].agreementVersion;
      const cur = list.filter((i) => i.agreementVersion === top);
      const running =
        cur.find((i) => i.dueDate.getTime() >= endDate.getTime()) ??
        cur[cur.length - 1];
      rateOf.set(id, D(running.annualRate).times(100).toString());
    }

    const lendingPositions: Omit<LoanPosition, 'borrowerName'>[] =
      lendingLoans.map((a) => {
        const c = codesFor(a.productVersionId);
        const g = grades.get(a.id);
        const app = appById.get(a.applicationId);
        const restructured = g
          ? g.restructured
          : a.isRestructured &&
            (!a.lastRestructuredAt ||
              a.lastRestructuredAt.getTime() < legacyEnd.getTime());
        return {
          stack: 'LENDING',
          loanId: a.id,
          reference: a.reference,
          borrowerId: a.borrowerId,
          branch: branchName.get(a.branchId) ?? 'Unknown branch',
          currency: a.currency,
          family: a.familyCode,
          product: productName.get(a.productId) ?? a.productId,
          purpose: app?.purpose.trim() || 'Not recorded',
          borrowerType: app?.groupId ? 'GROUP' : 'INDIVIDUAL',
          bookedPrincipal: D(a.bookedPrincipal).toString(),
          principal: (net.get(`${a.id}:${c.principal}`) ?? D(0)).toString(),
          interestReceivable: (
            net.get(`${a.id}:${c.interest}`) ?? D(0)
          ).toString(),
          allowance: (net.get(`${a.id}:${c.allowance}`) ?? D(0))
            .negated()
            .toString(),
          daysPastDue: g ? g.dpd : a.daysPastDue,
          recordedClass: g ? g.classification : a.classification,
          restructured,
          annualRatePct: rateOf.get(a.id) ?? null,
          // The band set by original term; the restructure floor (D-113, D-114).
          originalTermDays:
            g && g.termDays !== undefined ? g.termDays : originalTermDays(a),
          onProbation:
            g && g.onProbation !== undefined
              ? g.onProbation
              : a.probationRemaining > 0,
          floorDpd:
            g && g.floorDpd !== undefined ? g.floorDpd : a.delinquencyFloorDpd,
        };
      });

    // Ledger balances on the lending journal at month end, and as frozen at the close.
    const principalCodes = new Set(
      accounts.map((a) => codesFor(a.productVersionId).principal),
    );
    const allowanceCodes = new Set(
      accounts.map((a) => codesFor(a.productVersionId).allowance),
    );
    if (!principalCodes.size)
      principalCodes.add(ACCOUNT_CODES.LOANS_RECEIVABLE);
    if (!allowanceCodes.size)
      allowanceCodes.add(ACCOUNT_CODES.ALLOWANCE_FOR_LOAN_LOSSES);
    const lendingCurrencies = await tx.lendingJournalEntry.groupBy({
      by: ['currency'],
      where: { tenantId, entryDate: { lte: endDate } },
    });
    const ledger: LedgerFact[] = [];
    for (const { currency } of lendingCurrencies) {
      const sums = await tx.lendingJournalLine.groupBy({
        by: ['accountCode'],
        where: {
          tenantId,
          accountCode: { in: [...principalCodes, ...allowanceCodes] },
          entry: { currency, entryDate: { lte: endDate } },
        },
        _sum: { debit: true, credit: true },
      });
      const bal = (codes: Set<string>) =>
        sums
          .filter((s) => codes.has(s.accountCode))
          .reduce(
            (t, s) => t.plus(D(s._sum.debit)).minus(D(s._sum.credit)),
            D(0),
          );
      const frozen = (codes: Set<string>) =>
        snapshot?.trialBalance
          ? snapshot.trialBalance
              .filter(
                (r) => r.currency === currency && codes.has(r.accountCode),
              )
              .reduce((t, r) => t.plus(D(r.debit)).minus(D(r.credit)), D(0))
          : null;
      ledger.push({
        stack: 'LENDING',
        currency,
        principal: bal(principalCodes).toString(),
        principalFrozen: frozen(principalCodes)?.toString() ?? null,
        allowance: bal(allowanceCodes).negated().toString(),
        allowanceFrozen: frozen(allowanceCodes)?.negated().toString() ?? null,
        accounts: [...principalCodes, ...allowanceCodes].sort(),
      });
    }

    // Lending movements in the month.
    const events = await tx.financialEvent.groupBy({
      by: ['type', 'currency'],
      where: {
        tenantId,
        status: 'POSTED',
        type: { in: ['DISBURSEMENT', 'WRITE_OFF', 'RECOVERY'] },
        businessDate: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const KIND: Record<string, Movement['kind']> = {
      DISBURSEMENT: 'DISBURSED',
      WRITE_OFF: 'WRITTEN_OFF',
      RECOVERY: 'RECOVERED',
    };
    const movements: Movement[] = events.map((e) => ({
      stack: 'LENDING',
      currency: e.currency,
      kind: KIND[e.type],
      count: e._count._all,
      amount: D(e._sum.amount).toString(),
    }));

    // ── Legacy loans ──
    const legacy = await this.gatherLegacy(
      tx,
      tenantId,
      startDate,
      legacyEnd,
      branchName,
    );
    legacy.positions.forEach((p) => borrowerIds.add(p.borrowerId));
    ledger.push(...legacy.ledger);
    warnings.push(...legacy.warnings);
    movements.push(...legacy.movements);

    const borrowers = await tx.borrower.findMany({
      where: { tenantId, id: { in: [...borrowerIds] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameOf = new Map(
      borrowers.map((b) => [b.id, `${b.firstName} ${b.lastName}`.trim()]),
    );
    const positions: LoanPosition[] = [
      ...lendingPositions,
      ...legacy.positions,
    ].map((p) => ({
      ...p,
      borrowerName: nameOf.get(p.borrowerId) ?? p.borrowerId,
    }));

    return {
      tenantName: tenant?.name ?? '',
      year,
      month,
      start,
      end,
      attributesAsOf,
      rateCapPct: D(
        tenant?.maxAnnualInterestRatePct ??
          operationalConfig().regulatoryMaxAnnualRatePct,
      ).toString(),
      positions,
      movements,
      ledger,
      warnings,
    };
  }

  /**
   * Legacy loans at the month end. Principal and allowance come from the
   * legacy journal (each loan's postings carry its id); days past due are
   * rebuilt from the schedule and the repayments made by the month end.
   */
  private async gatherLegacy(
    tx: Tx,
    tenantId: string,
    start: Date,
    endExclusive: Date,
    branchName: Map<string, string>,
  ) {
    // The legacy book's accounts (lending settings accounting.legacy).
    const legacyAcc = (await this.settings.get(tenantId, tx)).accounting.legacy;
    const RECEIVABLE = legacyAcc.loansReceivable;
    const ALLOWANCE = legacyAcc.loanLossAllowance;
    const entries = await tx.journalEntry.findMany({
      where: { tenantId, date: { lt: endExclusive } },
      select: {
        loanId: true,
        currency: true,
        source: true,
        date: true,
        lines: {
          where: { account: { code: { in: [RECEIVABLE, ALLOWANCE] } } },
          select: {
            debit: true,
            credit: true,
            account: { select: { code: true } },
          },
        },
      },
    });
    const principalByLoan = new Map<string, InstanceType<typeof lending.D>>();
    const ledgerBy = new Map<
      string,
      {
        principal: InstanceType<typeof lending.D>;
        allowance: InstanceType<typeof lending.D>;
      }
    >();
    const movements: Movement[] = [];
    const mv = (
      currency: string,
      kind: Movement['kind'],
      amount: InstanceType<typeof lending.D>,
    ) => {
      const m = movements.find(
        (x) => x.currency === currency && x.kind === kind,
      );
      if (m) {
        m.count += 1;
        m.amount = D(m.amount).plus(amount).toString();
      } else
        movements.push({
          stack: 'LEGACY',
          currency,
          kind,
          count: 1,
          amount: amount.toString(),
        });
    };
    for (const e of entries) {
      const l = ledgerBy.get(e.currency) ?? {
        principal: D(0),
        allowance: D(0),
      };
      ledgerBy.set(e.currency, l);
      let receivable = D(0);
      for (const line of e.lines) {
        const n = D(line.debit).minus(D(line.credit));
        if (line.account.code === RECEIVABLE) {
          l.principal = l.principal.plus(n);
          receivable = receivable.plus(n);
        } else l.allowance = l.allowance.minus(n);
      }
      if (e.loanId && !receivable.isZero())
        principalByLoan.set(
          e.loanId,
          (principalByLoan.get(e.loanId) ?? D(0)).plus(receivable),
        );
      if (e.date.getTime() >= start.getTime()) {
        if (e.source === 'DISBURSEMENT' && receivable.gt(0))
          mv(e.currency, 'DISBURSED', receivable);
        if (e.source === 'WRITEOFF' && receivable.lt(0))
          mv(e.currency, 'WRITTEN_OFF', receivable.negated());
      }
    }
    // Loans moved to the lending platform by a loan-book migration (Lending ›
    // Migration) are counted there; on the legacy ledger they are a reconciling item.
    const migratedRows = await tx.migrationRow.findMany({
      where: {
        tenantId,
        status: 'POSTED',
        externalLoanId: { startsWith: 'LEGACY-' },
        postedAt: { lt: endExclusive },
      },
      select: { externalLoanId: true, loanAccountId: true },
    });
    const migrated = new Set(
      migratedRows.map((m) => m.externalLoanId.slice('LEGACY-'.length)),
    );
    const live = [...principalByLoan.entries()].filter(
      ([id, p]) => !p.isZero() && !migrated.has(id),
    );
    const loans = await tx.loan.findMany({
      where: { tenantId, id: { in: live.map(([id]) => id) } },
      select: {
        id: true,
        borrowerId: true,
        branchId: true,
        principal: true,
        annualInterestRate: true,
        currency: true,
        isRestructured: true,
        restructuredAt: true,
        termMonths: true,
        startDate: true,
        product: { select: { name: true } },
        schedules: {
          select: {
            installmentNumber: true,
            dueDate: true,
            principalAmount: true,
            interestAmount: true,
          },
        },
        repayments: {
          where: { date: { lt: endExclusive } },
          select: {
            principalPaid: true,
            interestPaid: true,
            reversedAt: true,
          },
        },
      },
    });
    // Allowance per loan: the latest provisioning run on or before the month end.
    const run = await tx.provisionRun.findFirst({
      where: { tenantId, runDate: { lt: endExclusive } },
      orderBy: { runDate: 'desc' },
      select: { id: true },
    });
    const provisions = run
      ? await tx.loanProvision.findMany({
          where: { runId: run.id },
          select: { loanId: true, provisionAmount: true },
        })
      : [];
    const allowanceOf = new Map(
      provisions.map((p) => [p.loanId, D(p.provisionAmount)]),
    );
    const positions: Omit<LoanPosition, 'borrowerName'>[] = loans.map((l) => {
      // Paid by the month end, placed on instalments in order.
      let paid = l.repayments
        .filter(
          (r) =>
            !r.reversedAt || r.reversedAt.getTime() >= endExclusive.getTime(),
        )
        .reduce(
          (s, r) => s.plus(D(r.principalPaid)).plus(D(r.interestPaid)),
          D(0),
        );
      let dpd = 0;
      for (const s of [...l.schedules].sort(
        (a, b) => a.installmentNumber - b.installmentNumber,
      )) {
        const due = D(s.principalAmount).plus(D(s.interestAmount));
        if (paid.gte(due)) {
          paid = paid.minus(due);
          continue;
        }
        paid = D(0);
        if (s.dueDate.getTime() < endExclusive.getTime())
          dpd = Math.max(
            0,
            Math.floor(
              (endExclusive.getTime() - DAY_MS - s.dueDate.getTime()) / DAY_MS,
            ),
          );
        break;
      }
      return {
        stack: 'LEGACY',
        loanId: l.id,
        reference: l.id.slice(0, 8).toUpperCase(),
        borrowerId: l.borrowerId,
        branch: l.branchId
          ? (branchName.get(l.branchId) ?? 'Unknown branch')
          : 'No branch',
        currency: l.currency,
        family: 'LEGACY',
        product: l.product?.name ?? 'Legacy loan',
        purpose: 'Not recorded',
        borrowerType: 'INDIVIDUAL',
        bookedPrincipal: D(l.principal).toString(),
        principal: (principalByLoan.get(l.id) ?? D(0)).toString(),
        interestReceivable: '0',
        allowance: (allowanceOf.get(l.id) ?? D(0)).toString(),
        daysPastDue: dpd,
        recordedClass: null,
        restructured:
          l.isRestructured &&
          (!l.restructuredAt ||
            l.restructuredAt.getTime() < endExclusive.getTime()),
        annualRatePct: D(l.annualInterestRate).toString(),
        originalTermDays: legacyTermDays(l.startDate, l.termMonths),
      };
    });
    // Recoveries: repayments in the month on loans already written off.
    const recovered = await tx.repayment.findMany({
      where: {
        tenantId,
        date: { gte: start, lt: endExclusive },
        reversedAt: null,
        loan: { writtenOffAt: { not: null } },
      },
      select: {
        amount: true,
        currency: true,
        date: true,
        loan: { select: { writtenOffAt: true } },
      },
    });
    for (const r of recovered)
      if (
        r.loan.writtenOffAt &&
        r.date.getTime() > r.loan.writtenOffAt.getTime()
      )
        mv(r.currency, 'RECOVERED', D(r.amount));
    const migratedBy = new Map<
      string,
      {
        principal: InstanceType<typeof lending.D>;
        allowance: InstanceType<typeof lending.D>;
        count: number;
      }
    >();
    if (migrated.size) {
      const moved = await tx.loan.findMany({
        where: { tenantId, id: { in: [...migrated] } },
        select: { id: true, currency: true },
      });
      for (const l of moved) {
        const p = principalByLoan.get(l.id) ?? D(0);
        const a = allowanceOf.get(l.id) ?? D(0);
        if (p.isZero() && a.isZero()) continue;
        const m = migratedBy.get(l.currency) ?? {
          principal: D(0),
          allowance: D(0),
          count: 0,
        };
        m.principal = m.principal.plus(p);
        m.allowance = m.allowance.plus(a);
        m.count += 1;
        migratedBy.set(l.currency, m);
      }
    }
    const ledger: LedgerFact[] = [...ledgerBy.entries()].map(
      ([currency, l]) => ({
        stack: 'LEGACY',
        currency,
        principal: l.principal.toString(),
        principalFrozen: null,
        allowance: l.allowance.toString(),
        allowanceFrozen: null,
        principalMigrated: (
          migratedBy.get(currency)?.principal ?? D(0)
        ).toString(),
        allowanceMigrated: (
          migratedBy.get(currency)?.allowance ?? D(0)
        ).toString(),
        accounts: [RECEIVABLE, ALLOWANCE],
      }),
    );
    const warnings = [...migratedBy.entries()].map(
      ([currency, m]) =>
        `${m.count} legacy loan(s) moved to the lending platform still carry ${m.principal.toString()} ${currency} of principal on the legacy ledger; they are reported once, under the lending platform, and shown as a reconciling item. Clear them from the legacy ledger against migration clearing (3900).`,
    );
    return { positions, ledger, movements, warnings };
  }

  private async build(
    tx: Tx,
    tenantId: string,
    year: number,
    month: number,
  ): Promise<{
    content: ReturnContent;
    period: { id: string; status: string } | null;
  }> {
    const period = await tx.accountingPeriod.findFirst({
      where: { tenantId, year, month },
      select: { id: true, status: true, snapshot: true },
    });
    const closed = period?.status === 'CLOSED';
    const input = await this.gather(
      tx,
      tenantId,
      year,
      month,
      closed ? (period.snapshot as unknown as CloseSnapshot) : null,
    );
    // The lender's classes and bands (lending settings `regulatory`).
    const { regulatory } = await this.settings.get(tenantId, tx);
    // The impairment basis (as it was at the close, when kept) and the
    // regulatory reserve on the ledger at month end (D-115, D-116).
    const { end } = monthBounds(year, month);
    const measured = await this.reserve.measure(tx, tenantId, end);
    const snap = closed
      ? (period.snapshot as unknown as CloseSnapshot | null)
      : null;
    return {
      content: buildReturn({
        ...input,
        regulatory,
        basis: closed ? 'CLOSED_PERIOD' : 'LIVE_PREVIEW',
        impairmentMode: snap?.regulatoryReserve?.mode ?? measured.mode,
        reserve: {
          account: measured.account,
          held: measured.rows.map((r) => ({
            currency: r.currency,
            balance: r.held,
          })),
        },
      }),
      period: period ? { id: period.id, status: period.status } : null,
    };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** The year's months: whether each is closed and the returns generated for it. */
  async list(actor: LendingActor, year?: number) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'regulatory.read',
      tenantResource(tenantId),
    );
    const data = await this.lp.tenantTx(tenantId, async (tx) => {
      const businessDate = await this.businessDate.get(tenantId, tx);
      const y = year ?? Number(businessDate.slice(0, 4));
      this.validMonth(y, 1);
      const [periods, returns] = await Promise.all([
        tx.accountingPeriod.findMany({
          where: { tenantId, year: y, month: { gt: 0 } },
          select: { month: true, status: true, closedAt: true },
        }),
        tx.regulatoryReturn.findMany({
          where: { tenantId, year: y },
          select: {
            id: true,
            month: true,
            version: true,
            status: true,
            generatedBy: true,
            generatedAt: true,
            submissionRequestedBy: true,
            submittedBy: true,
            submittedAt: true,
            submissionReference: true,
            supersededById: true,
            contentHash: true,
          },
          orderBy: [{ month: 'asc' }, { version: 'desc' }],
        }),
      ]);
      return { y, businessDate, periods, returns };
    });
    const byMonth = new Map(data.periods.map((p) => [p.month, p]));
    return {
      year: data.y,
      businessDate: data.businessDate,
      months: Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const p = byMonth.get(m);
        const versions = data.returns.filter((r) => r.month === m);
        return {
          month: m,
          label: periodLabel(data.y, m),
          periodStatus: p?.status ?? 'OPEN',
          closedAt: p?.closedAt ?? null,
          current: versions.find((r) => r.status !== 'SUPERSEDED') ?? null,
          versions,
        };
      }),
      permissions: {
        prepare: await this.can(actor, 'regulatory.prepare'),
        submit: await this.can(actor, 'regulatory.submit'),
      },
    };
  }

  /** A month's return computed now and not stored (any month, closed or not). */
  async preview(actor: LendingActor, year: number, month: number) {
    const tenantId = requireTenant(actor);
    this.validMonth(year, month);
    await this.policy.enforce(
      actor,
      'regulatory.read',
      tenantResource(tenantId),
    );
    const { content, period } = await this.lp.tenantTx(
      tenantId,
      (tx) => this.build(tx, tenantId, year, month),
      { timeoutMs: 120_000 },
    );
    return { stored: false, periodStatus: period?.status ?? 'OPEN', content };
  }

  private async load(tx: Tx, tenantId: string, id: string) {
    const row = await tx.regulatoryReturn.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Regulatory return not found');
    return row;
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'regulatory.read',
      tenantResource(tenantId),
    );
    const row = await this.lp.tenantTx(tenantId, (tx) =>
      this.load(tx, tenantId, id),
    );
    const makers = [row.generatedBy, row.submissionRequestedBy].filter(
      (x): x is string => !!x,
    );
    return {
      ...row,
      label: periodLabel(row.year, row.month),
      hashVerified:
        sha256(lending.canonicalJson(row.content)) === row.contentHash,
      permissions: {
        requestSubmission: await this.can(actor, 'regulatory.prepare'),
        submit: await this.can(actor, 'regulatory.submit', makers),
      },
    };
  }

  async csv(actor: LendingActor, id: string, table?: string) {
    const r = await this.get(actor, id);
    const content = r.content as unknown as ReturnContent;
    if (
      table &&
      table !== 'RECONCILIATION' &&
      !content.tables.some((t) => t.code === table)
    )
      throw new BadRequestException(`No table ${table} in this return.`);
    await this.audit.write({
      actor,
      action: 'regulatory.read',
      resourceType: 'RegulatoryReturn',
      resourceId: id,
      outcome: 'SUCCESS',
      details: { export: 'csv', table: table ?? 'ALL' },
    });
    return {
      filename: `regulatory-return-${r.year}-${String(r.month).padStart(2, '0')}-v${r.version}${table ? `-${table.toLowerCase()}` : ''}.csv`,
      csv: returnCsv(
        content,
        {
          Version: String(r.version),
          Status: r.status,
          'Generated by': r.generatedBy,
          'Generated at': r.generatedAt.toISOString(),
          'Submitted by': r.submittedBy ?? '',
          'Submission reference': r.submissionReference,
          'Content hash (SHA-256)': r.contentHash,
        },
        table,
      ),
    };
  }

  /** The return as a workbook: a cover sheet and one sheet per table, amounts kept as decimal text. */
  async xlsx(actor: LendingActor, id: string) {
    const r = await this.get(actor, id);
    const content = r.content as unknown as ReturnContent;
    await this.audit.write({
      actor,
      action: 'regulatory.read',
      resourceType: 'RegulatoryReturn',
      resourceId: id,
      outcome: 'SUCCESS',
      details: { export: 'xlsx' },
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Return', `${content.tenant} — ${content.period.label}`],
        ['Period', `${content.period.start} to ${content.period.end}`],
        ['Version', r.version],
        ['Status', r.status],
        ['Basis', content.basis],
        ['Loan attributes as of', content.attributesAsOf],
        ['Generated at', r.generatedAt.toISOString()],
        ['Submission reference', r.submissionReference],
        ['Content hash (SHA-256)', r.contentHash],
        [],
        ...content.warnings.map((w) => ['Warning', w]),
      ]),
      'Cover',
    );
    for (const t of [
      ...content.tables,
      reconciliationTable(content.reconciliation),
    ]) {
      const rows = [...t.rows, ...t.totals].map((row) =>
        t.columns.map((c) => row[c.key] ?? ''),
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          [t.title],
          t.columns.map((c) => c.label),
          ...rows,
        ]),
        t.code.slice(0, 31),
      );
    }
    return {
      filename: `regulatory-return-${r.year}-${String(r.month).padStart(2, '0')}-v${r.version}.xlsx`,
      buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    };
  }

  // ── Workflow ──────────────────────────────────────────────────────────────

  async generate(
    actor: LendingActor,
    body: { year: number; month: number; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    this.validMonth(body.year, body.month);
    await this.policy.enforce(
      actor,
      'regulatory.prepare',
      tenantResource(tenantId),
    );
    const label = periodLabel(body.year, body.month);
    return this.lp.tenantTx(
      tenantId,
      async (tx) => {
        const { content, period } = await this.build(
          tx,
          tenantId,
          body.year,
          body.month,
        );
        if (!period || period.status !== 'CLOSED')
          throw new ConflictException({
            message: `${label} is not closed. Close the month (Lending › Period close) before generating its return; use the preview meanwhile.`,
            code: 'PERIOD_NOT_CLOSED',
          });
        const existing = await tx.regulatoryReturn.findMany({
          where: { tenantId, year: body.year, month: body.month },
          orderBy: { version: 'desc' },
        });
        if (existing.some((r) => r.status === 'PENDING_SUBMISSION'))
          throw new ConflictException(
            `The ${label} return is waiting to be submitted; decide it before generating another version.`,
          );
        const amends = existing.find(
          (r) => r.status === 'SUBMITTED' && !r.supersededById,
        );
        const stored = {
          ...content,
          version: (existing[0]?.version ?? 0) + 1,
          amends: amends ? { id: amends.id, version: amends.version } : null,
        };
        const row = await tx.regulatoryReturn.create({
          data: {
            tenantId,
            year: body.year,
            month: body.month,
            version: stored.version,
            status: 'DRAFT',
            basis: 'CLOSED_PERIOD',
            periodId: period.id,
            content: stored as unknown as Json,
            contentHash: sha256(lending.canonicalJson(stored)),
            generatedBy: actor.id,
            comment: (body.comment ?? '').slice(0, 500),
          },
        });
        // The previous draft is superseded; a submitted return is amended.
        for (const r of existing.filter(
          (x) =>
            x.status === 'DRAFT' ||
            (x.status === 'SUBMITTED' && !x.supersededById),
        ))
          await tx.regulatoryReturn.update({
            where: { id: r.id },
            data: {
              status: r.status === 'DRAFT' ? 'SUPERSEDED' : 'SUBMITTED',
              supersededById: row.id,
            },
          });
        await this.audit.write(
          {
            actor,
            action: 'regulatory.prepare',
            resourceType: 'RegulatoryReturn',
            resourceId: row.id,
            outcome: 'SUCCESS',
            details: {
              year: body.year,
              month: body.month,
              version: row.version,
              contentHash: row.contentHash,
              amends: stored.amends,
              breaks: content.reconciliation.filter((x) => x.status === 'BREAK')
                .length,
            },
          },
          tx,
        );
        return {
          id: row.id,
          year: row.year,
          month: row.month,
          version: row.version,
          status: row.status,
          contentHash: row.contentHash,
          checks: content.checks,
        };
      },
      { timeoutMs: 120_000 },
    );
  }

  /** The preparer asks for the return to be submitted; it must tie to the ledger. */
  async requestSubmission(
    actor: LendingActor,
    id: string,
    body: { comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'regulatory.prepare',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await this.load(tx, tenantId, id);
      if (row.status !== 'DRAFT')
        throw new ConflictException(
          `Only a draft can be sent for submission; this return is ${row.status}.`,
        );
      const content = row.content as unknown as ReturnContent;
      const failed = content.checks.filter((c) => !c.passed);
      if (failed.length)
        throw new BadRequestException({
          message:
            'The return does not tie to the ledger or its tables do not add up; it cannot be submitted. Correct the books, reopen and close the month, then generate a new version.',
          code: 'RETURN_CHECKS_FAILED',
          checks: failed,
        });
      const res = await tx.regulatoryReturn.updateMany({
        where: { id, tenantId, status: 'DRAFT' },
        data: {
          status: 'PENDING_SUBMISSION',
          submissionRequestedBy: actor.id,
          submissionRequestedAt: new Date(),
          comment: (body.comment ?? row.comment).slice(0, 500),
        },
      });
      if (res.count !== 1)
        throw new ConflictException('The return changed; reload it.');
      await this.audit.write(
        {
          actor,
          action: 'regulatory.prepare',
          resourceType: 'RegulatoryReturn',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { requestSubmission: true, version: row.version },
        },
        tx,
      );
      return { id, status: 'PENDING_SUBMISSION' };
    });
  }

  /** A second person submits (or sends back) a return waiting for submission. */
  async decide(
    actor: LendingActor,
    id: string,
    body: { approve: boolean; reference?: string; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await this.load(tx, tenantId, id);
      if (row.status !== 'PENDING_SUBMISSION')
        throw new ConflictException(
          'This return is not waiting for submission.',
        );
      await this.policy.enforce(
        actor,
        'regulatory.submit',
        tenantResource(
          tenantId,
          'TENANT',
          tenantId,
          [row.generatedBy, row.submissionRequestedBy].filter(
            (x): x is string => !!x,
          ),
        ),
        tx,
      );
      const res = await tx.regulatoryReturn.updateMany({
        where: { id, tenantId, status: 'PENDING_SUBMISSION' },
        data: body.approve
          ? {
              status: 'SUBMITTED',
              submittedBy: actor.id,
              submittedAt: new Date(),
              submissionReference: (body.reference ?? '').slice(0, 120),
            }
          : {
              status: 'DRAFT',
              submissionRequestedBy: null,
              submissionRequestedAt: null,
              comment: (body.comment ?? '').slice(0, 500),
            },
      });
      if (res.count !== 1)
        throw new ConflictException('The return changed; reload it.');
      await this.audit.write(
        {
          actor,
          action: 'regulatory.submit',
          resourceType: 'RegulatoryReturn',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            approve: body.approve,
            version: row.version,
            reference: body.reference ?? '',
            comment: body.comment ?? '',
          },
        },
        tx,
      );
      return { id, status: body.approve ? 'SUBMITTED' : 'DRAFT' };
    });
  }

  // ── Consolidated views ────────────────────────────────────────────────────

  /**
   * One trial balance for both books: the legacy journal and the lending
   * journal side by side per account and currency, with combined balances.
   * Both share the tenant's chart of accounts.
   */
  async combinedTrialBalance(actor: LendingActor, asOf?: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'accounting.read',
      tenantResource(tenantId),
    );
    if (asOf) lending.parseDate(asOf);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const date = asOf ?? (await this.businessDate.get(tenantId, tx));
      const endDate = fromLocalDate(date);
      const legacyEnd = new Date(endDate.getTime() + DAY_MS);
      const accounts = await tx.ledgerAccount.findMany({
        where: { tenantId },
        select: { id: true, code: true, name: true, type: true },
      });
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      type Side = {
        debit: InstanceType<typeof lending.D>;
        credit: InstanceType<typeof lending.D>;
      };
      const rows = new Map<string, { legacy: Side; lending: Side }>();
      const side = (currency: string, code: string) => {
        const k = `${currency}|${code}`;
        const r = rows.get(k) ?? {
          legacy: { debit: D(0), credit: D(0) },
          lending: { debit: D(0), credit: D(0) },
        };
        rows.set(k, r);
        return r;
      };
      for (const currency of ['USD', 'KHR'] as const) {
        const legacy = await tx.journalLine.groupBy({
          by: ['accountId'],
          where: { entry: { tenantId, currency, date: { lt: legacyEnd } } },
          _sum: { debit: true, credit: true },
        });
        for (const l of legacy) {
          const code = byId.get(l.accountId)?.code ?? l.accountId;
          const s = side(currency, code).legacy;
          s.debit = s.debit.plus(D(l._sum.debit));
          s.credit = s.credit.plus(D(l._sum.credit));
        }
      }
      const lendingCurrencies = await tx.lendingJournalEntry.groupBy({
        by: ['currency'],
        where: { tenantId, entryDate: { lte: endDate } },
      });
      for (const { currency } of lendingCurrencies) {
        const sums = await tx.lendingJournalLine.groupBy({
          by: ['accountCode'],
          where: { tenantId, entry: { currency, entryDate: { lte: endDate } } },
          _sum: { debit: true, credit: true },
        });
        for (const l of sums) {
          const s = side(currency, l.accountCode).lending;
          s.debit = s.debit.plus(D(l._sum.debit));
          s.credit = s.credit.plus(D(l._sum.credit));
        }
      }
      const currencies = [
        ...new Set([...rows.keys()].map((k) => k.split('|')[0])),
      ].sort();
      return {
        asOf: date,
        currencies: currencies.map((currency) => {
          const lines = [...rows.entries()]
            .filter(([k]) => k.startsWith(`${currency}|`))
            .map(([k, v]) => {
              const code = k.split('|')[1];
              const legacyBal = v.legacy.debit.minus(v.legacy.credit);
              const lendingBal = v.lending.debit.minus(v.lending.credit);
              return {
                code,
                name: byCode.get(code)?.name ?? code,
                type: byCode.get(code)?.type ?? null,
                legacyDebit: v.legacy.debit.toString(),
                legacyCredit: v.legacy.credit.toString(),
                legacyBalance: legacyBal.toString(),
                lendingDebit: v.lending.debit.toString(),
                lendingCredit: v.lending.credit.toString(),
                lendingBalance: lendingBal.toString(),
                combinedBalance: legacyBal.plus(lendingBal).toString(),
              };
            })
            .sort((a, b) => a.code.localeCompare(b.code));
          const sum = (k: keyof (typeof lines)[number]) =>
            lines.reduce((s, l) => s.plus(D(l[k] as string)), D(0));
          const legacyDebit = sum('legacyDebit');
          const legacyCredit = sum('legacyCredit');
          const lendingDebit = sum('lendingDebit');
          const lendingCredit = sum('lendingCredit');
          return {
            currency,
            rows: lines,
            totals: {
              legacyDebit: legacyDebit.toString(),
              legacyCredit: legacyCredit.toString(),
              lendingDebit: lendingDebit.toString(),
              lendingCredit: lendingCredit.toString(),
              debit: legacyDebit.plus(lendingDebit).toString(),
              credit: legacyCredit.plus(lendingCredit).toString(),
              legacyBalanced: legacyDebit.eq(legacyCredit),
              lendingBalanced: lendingDebit.eq(lendingCredit),
              balanced: legacyDebit
                .plus(lendingDebit)
                .eq(legacyCredit.plus(lendingCredit)),
            },
          };
        }),
      };
    });
  }

  /** Last day of the latest closed month, for the screens' defaults. */
  static monthEnd(year: number, month: number) {
    return toLocalDate(fromLocalDate(monthBounds(year, month).end));
  }
}
