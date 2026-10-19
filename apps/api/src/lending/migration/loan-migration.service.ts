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
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  fromLocalDate,
  newReference,
  requireTenant,
  sha256,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { publicExplanation } from '../policy/decision';
import { tenantResource } from '../policy/resources';
import { ProductsService } from '../products/products.service';
import { LendingPoliciesService } from '../products/lending-policies.service';
import { ServicingService } from '../servicing/servicing.service';
import { loadLoanState } from '../servicing/loan-state';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { operationalConfig } from '../../config/operational-config';
import { LedgerService } from '../../ledger/ledger.service';
import { blindIndex } from '../../common/field-crypto';
import { lockLegacyLoan } from '../../loans/legacy-money';

type Json = Prisma.InputJsonValue;

export interface ControlTotal {
  currency: string;
  loans: number;
  principal: string;
}

interface CurrencyTotals {
  currency: string;
  loans: number;
  principal: string;
  interest: string;
  fees: string;
  penalties: string;
  allowance: string;
  accrualDifference: string;
  inArrears: number;
}

/** What validation found for one product code, cached per batch. */
interface ProductInfo {
  productId: string;
  versionId: string;
  familyCode: string;
  config: lending.ProductConfig;
  configHash: string;
  base: lending.ScheduleInput;
}

/** Most loans one migration file may carry: LENDING_MIGRATION_MAX_ROWS (default 10,000). */
const maxRows = () => operationalConfig().migration.maxRows;

/**
 * Taking over a loan book from another system.
 *
 * 1. Load: a CSV of running loans as at the cut-over date is parsed and every
 *    row checked — fields, product (active, a term loan with fixed rate),
 *    branch, customer (matched on national ID, or created), duplicates, and
 *    the schedule rebuilt by the engine. Totals per currency are compared
 *    with control totals from the old system. Nothing is posted.
 * 2. Approve: a second person approves on the cut-over business date; every
 *    valid loan is posted in its own transaction — customer, agreement,
 *    account, remaining schedule with an arrears line, and an opening
 *    journal against migration clearing (3900) — and the accrual already
 *    earned is recorded, so end of day continues from there.
 * 3. Verify: posted totals, the clearing balance and the reconciliation.
 */
@Injectable()
export class LoanMigrationService {
  private readonly logger = new Logger(LoanMigrationService.name);

  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly products: ProductsService,
    private readonly policies: LendingPoliciesService,
    private readonly servicing: ServicingService,
    private readonly ledger: LedgerService,
    private readonly settings: TenantSettingsService,
  ) {}

  template() {
    return lending.migrationTemplate();
  }

  /**
   * The organisation's own loans in the legacy module, as a migration file at
   * the business date — the way to move them onto the lending platform. The
   * product code is the one the loans should be serviced under; review the
   * file, then load it like any other.
   */
  async legacyExport(actor: LendingActor, productCode?: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan.migration.manage',
      tenantResource(tenantId),
    );
    const cutOver = await this.businessDate.get(tenantId);
    const cut = fromLocalDate(cutOver);
    return this.lp.tenantTx(
      tenantId,
      async (tx) => {
        const loans = await tx.loan.findMany({
          where: { tenantId, status: { in: ['DISBURSED', 'DEFAULTED'] } },
          include: {
            schedules: { orderBy: { installmentNumber: 'asc' } },
            borrower: true,
          },
          orderBy: { createdAt: 'asc' },
        });
        const branches = new Map(
          (
            await tx.branch.findMany({
              where: { tenantId },
              select: { id: true, code: true, name: true },
            })
          ).map((b) => [b.id, b.code ?? b.name]),
        );
        const cell = (v: string | number | null | undefined) => {
          const s0 = v === null || v === undefined ? '' : String(v);
          const safe = /^[=+\-@]/.test(s0) ? `'${s0}` : s0;
          return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        };
        const out = [lending.MIGRATION_COLUMNS.join(',')];
        for (const l of loans) {
          const lines = l.schedules;
          const open = lines.filter(
            (x) =>
              D(x.principalAmount).minus(D(x.paidPrincipal)).gt(0) ||
              D(x.interestAmount).minus(D(x.paidInterest)).gt(0) ||
              D(x.penaltyAmount).minus(D(x.paidPenalty)).gt(0),
          );
          const overdue = open.filter((x) => x.dueDate <= cut);
          const future = lines.filter((x) => x.dueDate > cut);
          if (!future.length) continue; // fully due: settle or restructure it in the legacy module first
          const sum = (
            xs: typeof lines,
            f: (x: (typeof lines)[number]) => lending.Dec,
          ) => xs.reduce((t, x) => t.plus(f(x)), D(0));
          const outstanding = sum(lines, (x) =>
            D(x.principalAmount).minus(D(x.paidPrincipal)),
          );
          const prev = [...lines].reverse().find((x) => x.dueDate <= cut);
          const row: Record<string, string> = {
            external_loan_id: `LEGACY-${l.id}`,
            customer_id: `LEGACY-${l.borrowerId}`,
            first_name: l.borrower.firstName,
            last_name: l.borrower.lastName,
            id_number: l.borrower.idNumber ?? '',
            phone: l.borrower.phone ?? '',
            date_of_birth: l.borrower.dateOfBirth
              ? toLocalDate(l.borrower.dateOfBirth)!
              : '',
            branch_code: l.branchId ? (branches.get(l.branchId) ?? '') : '',
            product_code: productCode ?? '',
            currency: l.currency,
            original_principal: D(l.principal).toString(),
            disbursement_date: toLocalDate(l.startDate)!,
            annual_rate_pct: D(l.annualInterestRate).toString(),
            principal_outstanding: outstanding.toString(),
            next_due_date: toLocalDate(future[0].dueDate)!,
            remaining_instalments: String(future.length),
            current_period_start: toLocalDate(prev?.dueDate ?? l.startDate)!,
            overdue_principal: sum(overdue, (x) =>
              D(x.principalAmount).minus(D(x.paidPrincipal)),
            ).toString(),
            overdue_interest: sum(overdue, (x) =>
              D(x.interestAmount).minus(D(x.paidInterest)),
            ).toString(),
            overdue_penalties: sum(overdue, (x) =>
              D(x.penaltyAmount).minus(D(x.paidPenalty)),
            ).toString(),
            oldest_overdue_date: overdue[0]
              ? toLocalDate(overdue[0].dueDate)!
              : '',
            non_accrual: l.status === 'DEFAULTED' ? 'Y' : 'N',
            monthly_income: l.borrower.monthlyIncome
              ? D(l.borrower.monthlyIncome).toString()
              : '',
          };
          out.push(
            lending.MIGRATION_COLUMNS.map((c) => cell(row[c])).join(','),
          );
        }
        await this.audit.write(
          {
            actor,
            action: 'loan.migration.manage',
            resourceType: 'Tenant',
            resourceId: tenantId,
            outcome: 'SUCCESS',
            details: { export: 'legacy-loans', rows: out.length - 1 },
          },
          tx,
        );
        return out.join('\n') + '\n';
      },
      { timeoutMs: 600_000 },
    );
  }

  private async can(
    actor: LendingActor,
    action: string,
    makerIds: string[] = [],
  ) {
    const tenantId = requireTenant(actor);
    const d = publicExplanation(
      await this.policy.decide(
        actor,
        action,
        tenantResource(tenantId, 'TENANT', tenantId, makerIds),
      ),
    );
    return {
      allowed: d.allowed,
      reason: d.blockedBy.map((b) => b.message).join(' '),
    };
  }

  // ── Load and check ────────────────────────────────────────────────────────

  private async productInfo(
    tx: Tx,
    tenantId: string,
    code: string,
    cache: Map<string, ProductInfo | string>,
  ): Promise<ProductInfo | string> {
    const hit = cache.get(code);
    if (hit) return hit;
    const result = await (async (): Promise<ProductInfo | string> => {
      const product = await tx.lendingProduct.findFirst({
        where: { tenantId, code },
      });
      if (!product) return `No product with code ${code}.`;
      const version = await tx.productVersion.findFirst({
        where: { tenantId, productId: product.id, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });
      if (!version) return `Product ${code} has no active version.`;
      const parsed = lending.validateProductConfig(version.config);
      if (!parsed.ok) return `Product ${code}'s configuration is not valid.`;
      const c = parsed.config;
      if (c.facility.type !== 'TERM')
        return `Product ${code} is a ${c.facility.type.toLowerCase()} facility; only term loans are migrated by file.`;
      if (c.identity.liability !== 'INDIVIDUAL')
        return `Product ${code} is a group product; group loans are not migrated by file.`;
      if (c.attributes.rateType === 'FLOATING')
        return `Product ${code} is floating-rate; migrate it with a fixed-rate product.`;
      const calendar = c.repayment.holidayCalendarCode
        ? await this.products
            .calendar(tenantId, c.repayment.holidayCalendarCode, tx)
            .catch(() => null)
        : undefined;
      if (calendar === null)
        return `Holiday calendar ${c.repayment.holidayCalendarCode} is missing.`;
      const base = lending.toScheduleInput(
        c,
        {
          principal: '1',
          numberOfInstalments: 1,
          disbursementDate: '2000-01-01',
        },
        '1',
        calendar,
      );
      return {
        productId: product.id,
        versionId: version.id,
        familyCode: product.familyCode,
        config: c,
        configHash: version.configHash,
        base,
      };
    })();
    cache.set(code, result);
    return result;
  }

  private async branchFor(
    tx: Tx,
    tenantId: string,
    code: string | undefined,
    cache: Map<string, string | null>,
  ) {
    const key = code ?? '';
    if (cache.has(key)) return cache.get(key)!;
    let id: string | null = null;
    if (code) {
      const b = await tx.branch.findFirst({
        where: { tenantId, OR: [{ code }, { name: code }] },
        select: { id: true },
      });
      id = b?.id ?? null;
    } else {
      const all = await tx.branch.findMany({
        where: { tenantId, isActive: true },
        select: { id: true },
        take: 2,
      });
      id = all.length === 1 ? all[0].id : null;
    }
    cache.set(key, id);
    return id;
  }

  async upload(
    actor: LendingActor,
    body: {
      fileName: string;
      content: string;
      cutOverDate: string;
      controlTotals?: ControlTotal[];
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan.migration.manage',
      tenantResource(tenantId),
    );
    lending.parseDate(body.cutOverDate, 'cutOverDate');
    const parsed = lending.parseMigrationFile(body.content);
    if (parsed.rows.length > maxRows())
      throw new BadRequestException(
        `A file holds at most ${maxRows()} loans; split it.`,
      );
    const fileIssues = [...parsed.fileErrors];
    if (parsed.unknownColumns.length)
      fileIssues.push(
        `Ignored unknown column(s): ${parsed.unknownColumns.join(', ')}.`,
      );
    const businessDate = await this.businessDate.get(tenantId);
    if (lending.compareDates(body.cutOverDate, businessDate) < 0)
      fileIssues.push(
        `The cut-over date ${body.cutOverDate} is before the business date ${businessDate}; postings are dated on the cut-over date, which has passed.`,
      );

    const products = new Map<string, ProductInfo | string>();
    const branches = new Map<string, string | null>();
    type Checked = {
      lineNo: number;
      values: lending.MigrationRowInput;
      issues: lending.MigrationIssue[];
      warnings: string[];
      preview: Record<string, unknown>;
      borrowerId: string | null;
    };
    const checked: Checked[] = [];
    await this.lp.tenantTx(
      tenantId,
      async (tx) => {
        const already = new Set(
          (
            await tx.migrationRow.findMany({
              where: {
                tenantId,
                status: 'POSTED',
                externalLoanId: {
                  in: parsed.rows
                    .map((r) => r.values.external_loan_id ?? '')
                    .filter(Boolean),
                },
              },
              select: { externalLoanId: true },
            })
          ).map((r) => r.externalLoanId),
        );
        const customers = new Map<
          string,
          { idNumber?: string; name: string }
        >();
        for (const r of parsed.rows) {
          const v = r.values;
          const issues = parsed.fileErrors.length
            ? []
            : lending.checkMigrationRow(v, body.cutOverDate);
          const warnings: string[] = [];
          let preview: Record<string, unknown> = {};
          let borrowerId: string | null = null;
          if (!parsed.fileErrors.length) {
            if (v.external_loan_id && already.has(v.external_loan_id))
              issues.push({
                field: 'external_loan_id',
                message: 'was already migrated in an earlier file',
              });
            // One customer id must describe one person across the file.
            if (v.customer_id) {
              const name = `${v.first_name ?? ''} ${v.last_name ?? ''}`
                .trim()
                .toLowerCase();
              const seen = customers.get(v.customer_id);
              if (
                seen &&
                (seen.name !== name ||
                  (seen.idNumber ?? '') !== (v.id_number ?? ''))
              )
                issues.push({
                  field: 'customer_id',
                  message:
                    'is used for a different name or ID number elsewhere in the file',
                });
              else
                customers.set(v.customer_id, { idNumber: v.id_number, name });
            }
            const branch = await this.branchFor(
              tx,
              tenantId,
              v.branch_code,
              branches,
            );
            if (!branch)
              issues.push({
                field: 'branch_code',
                message: v.branch_code
                  ? `no branch ${v.branch_code}`
                  : 'is required: the organisation has several branches',
              });
            if (v.id_number) {
              const existing = await tx.borrower.findFirst({
                where: {
                  tenantId,
                  idNumberHash: blindIndex(v.id_number, 'id'),
                },
                select: { id: true, firstName: true, lastName: true },
              });
              if (existing) {
                borrowerId = existing.id;
                const same =
                  `${existing.firstName} ${existing.lastName}`
                    .trim()
                    .toLowerCase() ===
                  `${v.first_name ?? ''} ${v.last_name ?? ''}`
                    .trim()
                    .toLowerCase();
                if (!same)
                  warnings.push(
                    `ID number matches existing customer ${existing.firstName} ${existing.lastName}; the loan will be linked to them.`,
                  );
              }
            }
            if (!issues.length && v.product_code) {
              const info = await this.productInfo(
                tx,
                tenantId,
                v.product_code,
                products,
              );
              if (typeof info === 'string')
                issues.push({ field: 'product_code', message: info });
              else {
                try {
                  const m = lending.buildMigratedLoan(
                    info.base,
                    v,
                    body.cutOverDate,
                  );
                  warnings.push(...m.warnings);
                  const terms = lending.checkTerms(info.config, {
                    principal: v.original_principal!,
                    numberOfInstalments: Number(v.remaining_instalments),
                    disbursementDate: v.disbursement_date!,
                    annualRate: m.scheduleInput.annualRate,
                  });
                  if (!terms.ok)
                    warnings.push(
                      `Outside today's product limits (${terms.issues.map((i) => `${i.path} ${i.message}`).join('; ')}); migrated as it stands.`,
                    );
                  preview = {
                    instalments: m.lines.length,
                    instalmentAmount: m.instalmentAmount,
                    maturityDate: m.maturityDate,
                    nextDue: m.lines[0]
                      ? { date: m.lines[0].dueDate, amount: m.lines[0].total }
                      : null,
                    accruedAtCutOver: m.accruedAtCutOver,
                    accrualDifference: m.accrualDifference,
                    interestOpening: m.interestOpening,
                    daysPastDue: m.daysPastDue,
                    arrears: m.arrears,
                  };
                } catch (e) {
                  issues.push({
                    field: 'schedule',
                    message: (e as Error).message,
                  });
                }
              }
            }
          }
          checked.push({
            lineNo: r.lineNo,
            values: v,
            issues,
            warnings,
            preview,
            borrowerId,
          });
        }
      },
      { timeoutMs: 600_000 },
    );

    // Totals per currency from the valid rows, compared with the old system's control totals.
    const totals = new Map<string, CurrencyTotals>();
    for (const c of checked) {
      if (c.issues.length) continue;
      const v = c.values;
      const t = totals.get(v.currency!) ?? {
        currency: v.currency!,
        loans: 0,
        principal: '0',
        interest: '0',
        fees: '0',
        penalties: '0',
        allowance: '0',
        accrualDifference: '0',
        inArrears: 0,
      };
      t.loans++;
      t.principal = D(t.principal).plus(D(v.principal_outstanding)).toString();
      t.interest = D(t.interest)
        .plus(D((c.preview.interestOpening as string) ?? '0'))
        .toString();
      t.fees = D(t.fees)
        .plus(D(v.overdue_fees ?? '0'))
        .toString();
      t.penalties = D(t.penalties)
        .plus(D(v.overdue_penalties ?? '0'))
        .toString();
      t.allowance = D(t.allowance)
        .plus(D(v.allowance ?? '0'))
        .toString();
      t.accrualDifference = D(t.accrualDifference)
        .plus(D((c.preview.accrualDifference as string) ?? '0'))
        .toString();
      if ((c.preview.daysPastDue as number) > 0) t.inArrears++;
      totals.set(v.currency!, t);
    }
    for (const ct of body.controlTotals ?? []) {
      const t = totals.get(ct.currency);
      if (!t || t.loans !== ct.loans || !D(t.principal).eq(D(ct.principal)))
        fileIssues.push(
          `Control totals for ${ct.currency} do not match: the old system reports ${ct.loans} loans and ${ct.principal}; the valid rows give ${t?.loans ?? 0} loans and ${t?.principal ?? '0'}.`,
        );
    }
    const errorCount = checked.filter((c) => c.issues.length).length;
    return this.lp.tenantTx(
      tenantId,
      async (tx) => {
        const batch = await tx.migrationBatch.create({
          data: {
            tenantId,
            reference: newReference('MIG'),
            fileName: body.fileName.slice(0, 200),
            cutOverDate: fromLocalDate(body.cutOverDate),
            rowCount: checked.length,
            validCount: checked.length - errorCount,
            errorCount,
            warningCount: checked.filter(
              (c) => !c.issues.length && c.warnings.length,
            ).length,
            totals: [...totals.values()] as unknown as Json,
            controlTotals: (body.controlTotals ?? []) as unknown as Json,
            fileIssues: fileIssues as unknown as Json,
            createdBy: actor.id,
          },
        });
        for (let i = 0; i < checked.length; i += 500) {
          await tx.migrationRow.createMany({
            data: checked.slice(i, i + 500).map((c) => ({
              tenantId,
              batchId: batch.id,
              lineNo: c.lineNo,
              externalLoanId: c.values.external_loan_id ?? `line-${c.lineNo}`,
              customerId: c.values.customer_id ?? '',
              values: c.values as unknown as Json,
              status: c.issues.length
                ? 'ERROR'
                : c.warnings.length
                  ? 'WARNING'
                  : 'VALID',
              issues: c.issues as unknown as Json,
              warnings: c.warnings as unknown as Json,
              preview: c.preview as Json,
              borrowerId: c.borrowerId,
            })),
          });
        }
        await this.audit.write(
          {
            actor,
            action: 'loan.migration.manage',
            resourceType: 'MigrationBatch',
            resourceId: batch.id,
            outcome: 'SUCCESS',
            details: {
              file: body.fileName,
              rows: checked.length,
              errors: errorCount,
              cutOver: body.cutOverDate,
            },
          },
          tx,
        );
        return this.view(tx, actor, batch.id);
      },
      { timeoutMs: 600_000 },
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy
      .enforce(actor, 'loan.migration.manage', tenantResource(tenantId))
      .catch(async () =>
        this.policy.enforce(
          actor,
          'loan.migration.approve',
          tenantResource(tenantId),
        ),
      );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const rows = await tx.migrationBatch.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return {
        batches: rows.map((b) => ({
          ...b,
          cutOverDate: toLocalDate(b.cutOverDate),
        })),
        businessDate: await this.businessDate.get(tenantId, tx),
        permissions: {
          manage: await this.can(actor, 'loan.migration.manage'),
          approve: await this.can(actor, 'loan.migration.approve'),
        },
      };
    });
  }

  private async view(
    tx: Tx,
    actor: LendingActor,
    id: string,
    q: { status?: string; page?: number } = {},
  ) {
    const tenantId = requireTenant(actor);
    const b = await tx.migrationBatch.findFirst({ where: { id, tenantId } });
    if (!b) throw new NotFoundException('Migration file not found');
    const take = 100;
    const page = Math.max(1, q.page ?? 1);
    const where: Prisma.MigrationRowWhereInput = {
      tenantId,
      batchId: id,
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, count, byStatus] = await Promise.all([
      tx.migrationRow.findMany({
        where,
        orderBy: { lineNo: 'asc' },
        take,
        skip: (page - 1) * take,
      }),
      tx.migrationRow.count({ where }),
      tx.migrationRow.groupBy({
        by: ['status'],
        where: { tenantId, batchId: id },
        _count: { _all: true },
      }),
    ]);
    const loanRefs = await tx.loanAccount.findMany({
      where: {
        tenantId,
        id: {
          in: rows.map((r) => r.loanAccountId).filter((x): x is string => !!x),
        },
      },
      select: { id: true, reference: true },
    });
    const refOf = new Map(loanRefs.map((l) => [l.id, l.reference]));
    const fileIssues = b.fileIssues as unknown as string[];
    const blocking = fileIssues.filter((i) => !i.startsWith('Ignored unknown'));
    const businessDate = await this.businessDate.get(tenantId, tx);
    const cutOver = toLocalDate(b.cutOverDate)!;
    const readiness: { label: string; ok: boolean; detail: string }[] = [
      {
        label: 'Every row is valid',
        ok: b.errorCount === 0,
        detail: b.errorCount
          ? `${b.errorCount} row(s) have errors; fix them in the source and load the file again.`
          : `${b.validCount} loan(s) ready.`,
      },
      {
        label: 'File and control totals agree',
        ok: blocking.length === 0,
        detail: blocking.length
          ? blocking.join(' ')
          : 'No file problems; control totals match where given.',
      },
      {
        label: 'Business date is the cut-over date',
        ok: businessDate === cutOver,
        detail:
          businessDate === cutOver
            ? `Both ${cutOver}.`
            : `Business date ${businessDate}, cut-over ${cutOver}. Opening balances are posted on the cut-over date.`,
      },
    ];
    return {
      ...b,
      cutOverDate: cutOver,
      businessDate,
      fileIssues,
      readiness,
      ready: readiness.every((r) => r.ok),
      counts: Object.fromEntries(
        byStatus.map((s) => [s.status, s._count._all]),
      ),
      rows: rows.map((r) => ({
        ...r,
        loanReference: r.loanAccountId
          ? (refOf.get(r.loanAccountId) ?? null)
          : null,
      })),
      rowTotal: count,
      page,
      permissions: {
        manage: await this.can(actor, 'loan.migration.manage'),
        approve: await this.can(actor, 'loan.migration.approve', [b.createdBy]),
      },
    };
  }

  async get(
    actor: LendingActor,
    id: string,
    q: { status?: string; page?: number },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy
      .enforce(actor, 'loan.migration.manage', tenantResource(tenantId))
      .catch(async () =>
        this.policy.enforce(
          actor,
          'loan.migration.approve',
          tenantResource(tenantId),
        ),
      );
    return this.lp.tenantTx(tenantId, (tx) => this.view(tx, actor, id, q));
  }

  /** The rows with errors or warnings, with what to fix, as CSV. */
  async issuesCsv(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan.migration.manage',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const rows = await tx.migrationRow.findMany({
        where: {
          tenantId,
          batchId: id,
          status: { in: ['ERROR', 'WARNING', 'FAILED'] },
        },
        orderBy: { lineNo: 'asc' },
      });
      const cell = (s: string) => {
        const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
        return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      const lines = ['line,external_loan_id,status,field,problem'];
      for (const r of rows) {
        const issues = r.issues as unknown as lending.MigrationIssue[];
        const warnings = r.warnings as unknown as string[];
        for (const i of issues)
          lines.push(
            [String(r.lineNo), r.externalLoanId, r.status, i.field, i.message]
              .map(cell)
              .join(','),
          );
        for (const w of warnings)
          lines.push(
            [String(r.lineNo), r.externalLoanId, 'WARNING', '', w]
              .map(cell)
              .join(','),
          );
      }
      return lines.join('\n') + '\n';
    });
  }

  // ── Decide and post ───────────────────────────────────────────────────────

  async cancel(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan.migration.manage',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const res = await tx.migrationBatch.updateMany({
        where: { id, tenantId, status: 'VALIDATED' },
        data: { status: 'CANCELLED' },
      });
      if (res.count !== 1)
        throw new ConflictException(
          'Only a file not yet posted can be cancelled.',
        );
      return { id, status: 'CANCELLED' };
    });
  }

  async decide(
    actor: LendingActor,
    id: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    const batch = await this.lp.tenantTx(tenantId, (tx) =>
      this.view(tx, actor, id),
    );
    await this.policy.enforce(
      actor,
      'loan.migration.approve',
      tenantResource(tenantId, 'TENANT', tenantId, [batch.createdBy]),
    );
    if (!['VALIDATED', 'PARTIALLY_POSTED'].includes(batch.status))
      throw new ConflictException(
        `This file is ${batch.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    if (!body.approve) {
      await this.lp.tenantTx(tenantId, async (tx) => {
        await tx.migrationBatch.updateMany({
          where: { id, tenantId, status: 'VALIDATED' },
          data: {
            status: 'REJECTED',
            approvedBy: actor.id,
            decidedAt: new Date(),
            comment: (body.comment ?? '').slice(0, 500),
          },
        });
        await this.audit.write(
          {
            actor,
            action: 'loan.migration.approve',
            resourceType: 'MigrationBatch',
            resourceId: id,
            outcome: 'SUCCESS',
            details: { approve: false },
          },
          tx,
        );
      });
      return { id, status: 'REJECTED' };
    }
    if (!batch.ready)
      throw new BadRequestException({
        message: 'This file is not ready to post.',
        code: 'MIGRATION_NOT_READY',
        readiness: batch.readiness,
      });
    // Claim the file so two approvals cannot post it twice.
    const claimed = await this.lp.tenantTx(tenantId, (tx) =>
      tx.migrationBatch.updateMany({
        where: {
          id,
          tenantId,
          status: { in: ['VALIDATED', 'PARTIALLY_POSTED'] },
        },
        data: {
          status: 'POSTING',
          approvedBy: actor.id,
          decidedAt: new Date(),
          comment: (body.comment ?? '').slice(0, 500),
        },
      }),
    );
    if (claimed.count !== 1)
      throw new ConflictException('This file is already being posted.');

    const pending = await this.lp.tenantTx(tenantId, (tx) =>
      tx.migrationRow.findMany({
        where: {
          tenantId,
          batchId: id,
          status: { in: ['VALID', 'WARNING', 'FAILED'] },
        },
        orderBy: { lineNo: 'asc' },
        select: { id: true },
      }),
    );
    const products = new Map<string, ProductInfo | string>();
    const branches = new Map<string, string | null>();
    let posted = 0;
    let failed = 0;
    for (const { id: rowId } of pending) {
      try {
        await this.lp.tenantTx(tenantId, (tx) =>
          this.postRow(
            tx,
            actor,
            id,
            rowId,
            batch.cutOverDate,
            products,
            branches,
          ),
        );
        posted++;
      } catch (e) {
        failed++;
        const message =
          (e as { response?: { message?: string } }).response?.message ??
          (e as Error).message;
        this.logger.warn(
          `Migration ${batch.reference} row ${rowId} failed: ${message}`,
        );
        await this.lp.tenantTx(tenantId, (tx) =>
          tx.migrationRow.update({
            where: { id: rowId },
            data: {
              status: 'FAILED',
              issues: [{ field: 'posting', message }] as unknown as Json,
            },
          }),
        );
      }
    }
    return this.lp.tenantTx(tenantId, async (tx) => {
      const counts = await tx.migrationRow.groupBy({
        by: ['status'],
        where: { tenantId, batchId: id },
        _count: { _all: true },
      });
      const n = (s: string) =>
        counts.find((c) => c.status === s)?._count._all ?? 0;
      await tx.migrationBatch.update({
        where: { id },
        data: {
          status: n('FAILED') ? 'PARTIALLY_POSTED' : 'POSTED',
          postedCount: n('POSTED'),
          failedCount: n('FAILED'),
          postedAt: new Date(),
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.migration.approve',
          resourceType: 'MigrationBatch',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { approve: true, posted, failed },
        },
        tx,
      );
      return this.view(tx, actor, id);
    });
  }

  /** Post one loan: customer, agreement, account, schedule, opening journal and accrual. */
  private async postRow(
    tx: Tx,
    actor: LendingActor,
    batchId: string,
    rowId: string,
    cutOver: string,
    products: Map<string, ProductInfo | string>,
    branches: Map<string, string | null>,
  ) {
    const tenantId = requireTenant(actor);
    const row = await tx.migrationRow.findFirst({
      where: { id: rowId, tenantId, batchId },
    });
    if (!row || row.status === 'POSTED') return;
    const v = row.values as unknown as lending.MigrationRowInput;
    const info = await this.productInfo(
      tx,
      tenantId,
      v.product_code!,
      products,
    );
    if (typeof info === 'string') throw new BadRequestException(info);
    const branchId = await this.branchFor(
      tx,
      tenantId,
      v.branch_code,
      branches,
    );
    if (!branchId) throw new BadRequestException('Branch not found.');
    const m = lending.buildMigratedLoan(info.base, v, cutOver);
    const businessDate = await this.businessDate.get(tenantId, tx);
    if (businessDate !== cutOver)
      throw new ConflictException(
        `The business date ${businessDate} is not the cut-over date ${cutOver}.`,
      );

    // Customer: matched on national ID, else one new customer per customer id in the batch.
    let borrowerId: string | null = null;
    if (v.id_number) {
      const existing = await tx.borrower.findFirst({
        where: { tenantId, idNumberHash: blindIndex(v.id_number, 'id') },
        select: { id: true },
      });
      borrowerId = existing?.id ?? null;
    }
    if (!borrowerId) {
      const sibling = await tx.migrationRow.findFirst({
        where: {
          tenantId,
          batchId,
          customerId: row.customerId,
          borrowerId: { not: null },
          id: { not: row.id },
        },
        select: { borrowerId: true },
      });
      borrowerId = sibling?.borrowerId ?? null;
    }
    if (!borrowerId) {
      const b = await tx.borrower.create({
        data: {
          tenantId,
          branchId,
          firstName: v.first_name!,
          lastName: v.last_name!,
          phone: v.phone ?? null,
          idNumber: v.id_number ?? null,
          dateOfBirth: v.date_of_birth ? fromLocalDate(v.date_of_birth) : null,
          monthlyIncome: v.monthly_income ?? null,
        },
      });
      borrowerId = b.id;
    }

    const c = info.config;
    const contract = await this.policies.composeForContract(
      tx,
      tenantId,
      c,
      undefined,
    );
    const terms: lending.NegotiatedTerms = {
      principal: v.original_principal!,
      numberOfInstalments: Number(v.remaining_instalments),
      disbursementDate: v.disbursement_date!,
      annualRate: m.scheduleInput.annualRate,
      firstDueDate: m.lines[0]?.dueDate,
    };
    const app = await tx.application.create({
      data: {
        tenantId,
        reference: newReference('APP'),
        branchId,
        borrowerId,
        productId: info.productId,
        productVersionId: info.versionId,
        channel: 'MIGRATION',
        status: 'BOOKED',
        currency: m.currency,
        requestedAmount: v.original_principal!,
        terms: terms as unknown as Json,
        purpose: `Migrated loan ${v.external_loan_id}`,
        createdBy: actor.id,
        submittedAt: new Date(),
        decidedAt: new Date(),
      },
    });
    const agreement = await tx.lendingAgreement.create({
      data: {
        tenantId,
        reference: newReference('AGR'),
        applicationId: app.id,
        borrowerId,
        productId: info.productId,
        productVersionId: info.versionId,
        currency: m.currency,
        createdBy: actor.id,
      },
    });
    await tx.agreementVersion.create({
      data: {
        tenantId,
        agreementId: agreement.id,
        version: 1,
        reason: 'MIGRATION',
        productConfig: contract.config as unknown as Json,
        configHash: contract.policies.length
          ? sha256(lending.canonicalJson(contract.config))
          : info.configHash,
        terms: terms as unknown as Json,
        policies: contract.policies as unknown as Json,
        scheduleInput: m.scheduleInput as unknown as Json,
        calculation: {
          migration: {
            batchId,
            externalLoanId: v.external_loan_id,
            cutOver,
            accruedAtCutOver: m.accruedAtCutOver,
            sourceAccrued: m.sourceAccrued,
            accrualDifference: m.accrualDifference,
            arrears: m.arrears,
          },
          schedule: {
            lines: m.lines,
            instalmentAmount: m.instalmentAmount,
            maturityDate: m.maturityDate,
          },
        } as unknown as Json,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        effectiveDate: fromLocalDate(cutOver),
        createdBy: actor.id,
      },
    });
    const account = await tx.loanAccount.create({
      data: {
        tenantId,
        reference: newReference('LN'),
        agreementId: agreement.id,
        applicationId: app.id,
        borrowerId,
        branchId,
        productId: info.productId,
        productVersionId: info.versionId,
        familyCode: info.familyCode,
        currency: m.currency,
        status: 'ACTIVE',
        bookedPrincipal: v.original_principal!,
        principalOutstanding: m.principalOutstanding,
        interestReceivable: m.interestOpening,
        feesReceivable: m.feesOpening,
        penaltyReceivable: m.penaltyOpening,
        allowance: m.allowance,
        nonAccrual: m.nonAccrual,
        nonAccrualSince: m.nonAccrual
          ? fromLocalDate(m.arrears?.dueDate ?? cutOver)
          : null,
        interestInSuspense: m.nonAccrual ? m.interestOpening : '0',
        instalmentAmount: m.instalmentAmount,
        maturityDate: fromLocalDate(m.maturityDate),
        disbursementDate: fromLocalDate(v.disbursement_date!),
        lastAccrualDate: fromLocalDate(cutOver),
        daysPastDue: m.daysPastDue,
        createdBy: actor.id,
      },
    });
    const lines: Prisma.ScheduleInstalmentCreateManyInput[] = [];
    if (m.arrears)
      lines.push({
        tenantId,
        loanAccountId: account.id,
        agreementVersion: 1,
        number: 0,
        periodStart: fromLocalDate(m.arrears.dueDate),
        periodEnd: fromLocalDate(m.arrears.dueDate),
        dueDate: fromLocalDate(m.arrears.dueDate),
        openingPrincipal: m.principalOutstanding,
        principalDue: m.arrears.principal,
        interestDue: '0',
        // Overdue interest was earned before cut-over: repaid as interest, never accrued again.
        deferredInterestDue: m.arrears.interest,
        feeDue: m.arrears.fees,
        penaltyDue: m.arrears.penalties,
        annualRate: '0',
      });
    for (const l of m.lines)
      lines.push({
        tenantId,
        loanAccountId: account.id,
        agreementVersion: 1,
        number: l.number,
        periodStart: fromLocalDate(l.periodStart),
        periodEnd: fromLocalDate(l.periodEnd),
        dueDate: fromLocalDate(l.dueDate),
        openingPrincipal: l.openingPrincipal,
        principalDue: l.principal,
        interestDue: l.interest,
        capitalizedInterest: l.capitalizedInterest,
        annualRate: l.annualRate,
        projected: l.projected,
      });
    await tx.scheduleInstalment.createMany({ data: lines });

    const state = await loadLoanState(tx, tenantId, account.id);
    const acc = c.accounting;
    // Tenant-level accounts (lending settings): migration clearing (default
    // 3900) and, for loans leaving the legacy book, its receivables account.
    const tenantAcc = (await this.settings.get(tenantId, tx)).accounting;
    const interest = D(m.interestOpening);
    const assets = D(m.principalOutstanding)
      .plus(interest)
      .plus(D(m.feesOpening))
      .plus(D(m.penaltyOpening));
    const clearing = assets
      .minus(m.nonAccrual ? interest : D(0))
      .minus(D(m.allowance));
    const event = await this.servicing.recordEvent(tx, state, {
      type: 'MIGRATION',
      amount: D(m.principalOutstanding),
      businessDate,
      valueDate: cutOver,
      components: {
        batchId,
        externalLoanId: v.external_loan_id,
        principal: m.principalOutstanding,
        interest: m.interestOpening,
        fees: m.feesOpening,
        penalties: m.penaltyOpening,
        allowance: m.allowance,
        accruedAtCutOver: m.accruedAtCutOver,
        accrualDifference: m.accrualDifference,
        nonAccrual: m.nonAccrual,
      },
      idempotencyKey: `sys:migration:${row.id}`,
      requestHash: `migration:${row.id}`,
      actor,
      narrative: `Opening balances of loan ${v.external_loan_id} migrated on ${cutOver}`,
      externalReference: v.external_loan_id,
      lines: [
        { accountCode: acc.loansReceivable, debit: m.principalOutstanding },
        { accountCode: acc.interestReceivable, debit: interest.toString() },
        { accountCode: acc.feesReceivable, debit: m.feesOpening },
        { accountCode: acc.penaltyReceivable, debit: m.penaltyOpening },
        ...(m.nonAccrual
          ? [{ accountCode: acc.interestSuspense, credit: interest.toString() }]
          : []),
        { accountCode: acc.loanLossAllowance, credit: m.allowance },
        clearing.gte(0)
          ? {
              accountCode: tenantAcc.migrationClearing,
              credit: clearing.toString(),
            }
          : {
              accountCode: tenantAcc.migrationClearing,
              debit: clearing.negated().toString(),
            },
      ],
    } as Parameters<ServicingService['recordEvent']>[2]);
    // The current period's interest already earned is on the books: end of day accrues only what follows.
    if (D(m.accruedAtCutOver).gt(0))
      await tx.accrualEvent.create({
        data: {
          tenantId,
          loanAccountId: account.id,
          financialEventId: event.id,
          accrualDate: fromLocalDate(cutOver),
          amount: m.accruedAtCutOver,
        },
      });
    await tx.migrationRow.update({
      where: { id: row.id },
      data: {
        status: 'POSTED',
        borrowerId,
        loanAccountId: account.id,
        postedAt: new Date(),
        issues: [] as unknown as Json,
      },
    });

    // A loan moved from the legacy module leaves that book: it is closed there
    // and its principal cleared against migration clearing, so the two ledgers
    // together hold it once.
    const legacyId = v.external_loan_id?.startsWith('LEGACY-')
      ? v.external_loan_id.slice('LEGACY-'.length)
      : null;
    if (legacyId) {
      // Wait for any legacy write on the loan to finish (D-098), then read it.
      await lockLegacyLoan(tx, legacyId, tenantId);
      const legacy = await tx.loan.findFirst({
        where: {
          id: legacyId,
          tenantId,
          status: { in: ['DISBURSED', 'DEFAULTED'] },
        },
        select: { id: true, currency: true },
      });
      if (legacy) {
        const lines = await tx.journalLine.findMany({
          where: {
            entry: { tenantId, loanId: legacy.id },
            account: { code: tenantAcc.legacy.loansReceivable },
          },
          select: { debit: true, credit: true },
        });
        const balance = lines.reduce(
          (t, l) => t.plus(D(l.debit)).minus(D(l.credit)),
          D(0),
        );
        if (balance.gt(0))
          await this.ledger.postEntry(
            {
              tenantId,
              source: 'MANUAL',
              currency: legacy.currency,
              description: `Loan moved to the lending platform as ${account.reference} (migration ${batchId.slice(0, 8)})`,
              loanId: legacy.id,
              referenceId: account.id,
              createdByUserId: actor.type === 'USER' ? actor.id : null,
              lines: [
                {
                  accountCode: tenantAcc.migrationClearing,
                  debit: balance.toNumber(),
                },
                {
                  accountCode: tenantAcc.legacy.loansReceivable,
                  credit: balance.toNumber(),
                },
              ],
            },
            tx,
          );
        await tx.loan.update({
          where: { id: legacy.id },
          data: { status: 'CLOSED' },
        });
      }
    }
  }
}
