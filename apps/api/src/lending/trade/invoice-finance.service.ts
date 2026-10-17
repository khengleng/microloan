import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  concurrentModification,
  decStr,
  engineCall,
  fromLocalDate,
  newReference,
  requestHash,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { ServicingService } from '../servicing/servicing.service';
import { FacilitiesService } from '../facilities/facilities.service';
import { LoanState, loadLoanState } from '../servicing/loan-state';
import {
  FacilityState,
  loadFacilityState,
  resourceOf,
} from '../facilities/facility-state';
import type { PostingLine } from '../accounting/posting.service';

type Json = Prisma.InputJsonValue;
type Invoice = NonNullable<
  Awaited<ReturnType<Tx['tradeInvoice']['findFirst']>>
>;
type Receivable = NonNullable<
  Awaited<ReturnType<Tx['tradeReceivable']['findFirst']>>
>;
type Supplier = NonNullable<
  Awaited<ReturnType<Tx['tradeSupplier']['findFirst']>>
>;

const RESERVE_PAYOUT = 'INVOICE_RESERVE_PAYOUT';
const WRITE_OFF = 'TRADE_RECEIVABLE_WRITE_OFF';
/** Statuses in which money is still owed on a funded receivable. */
const LIVE = ['FUNDED', 'RECOURSE', 'DEFAULTED'];
/** Statuses in which nothing more happens to a receivable. */
const TERMINAL = ['SETTLED', 'WRITTEN_OFF', 'REJECTED', 'CANCELLED'];

/**
 * How a receivables product prices and services what it finances, read from
 * the agreement's configuration snapshot. Invoice finance and factoring
 * advance a share of the invoice and charge a fee per period; supply-chain
 * finance and forfaiting buy the face value at a discount.
 */
export interface RegisterTerms {
  kind: lending.ReceivablesKind;
  advanceRate: string;
  feeRatePerPeriod: string;
  feePeriodDays: number;
  feeBasis: 'WHOLE_PERIODS' | 'PRO_RATA';
  /** Days after the due date before the obligor is in default. */
  recourseGraceDays: number;
  maxInvoiceTenorDays: number;
  /** What the facility holder answers for once the obligor defaults. */
  recourse: lending.RecourseType;
  limitedRecourseRate: string | null;
  serviceFeeRate: string;
  discount: {
    rate: string;
    dayCountBasis: 360 | 365;
    method: lending.DiscountMethod;
    graceDays: number;
  } | null;
  acknowledgement: {
    type: 'DEBTOR_NOTICE' | 'BUYER_APPROVAL' | 'AVAL';
    required: boolean;
  } | null;
  maxDebtorConcentration: string | null;
  /** Supply-chain finance: each invoice is a supplier's, paid to the supplier. */
  supplierRequired: boolean;
  supplierApprovalRequired: boolean;
  instrumentTypes: string[] | null;
}

export function registerTerms(
  config: lending.ProductConfig,
): RegisterTerms | null {
  const t = config.trade;
  const kind = lending.receivablesKind(config);
  const none = {
    limitedRecourseRate: null,
    serviceFeeRate: '0',
    discount: null,
    acknowledgement: null,
    maxDebtorConcentration: null,
    supplierRequired: false,
    supplierApprovalRequired: false,
    instrumentTypes: null,
  };
  // Discounted purchases carry the face as the advance and no period fee.
  const discounted = {
    advanceRate: '1',
    feeRatePerPeriod: '0',
    feePeriodDays: 30,
    feeBasis: 'PRO_RATA' as const,
  };
  switch (kind) {
    case 'INVOICE_FINANCE': {
      const c = t!.invoice!;
      return {
        ...none,
        kind,
        advanceRate: c.advanceRate,
        feeRatePerPeriod: c.feeRatePerPeriod,
        feePeriodDays: c.feePeriodDays,
        feeBasis: c.feeBasis,
        recourseGraceDays: c.recourseGraceDays,
        maxInvoiceTenorDays: c.maxInvoiceTenorDays,
        recourse: 'FULL',
      };
    }
    case 'FACTORING': {
      const c = t!.factoring!;
      return {
        ...none,
        kind,
        advanceRate: c.advanceRate,
        feeRatePerPeriod: c.feeRatePerPeriod,
        feePeriodDays: c.feePeriodDays,
        feeBasis: c.feeBasis,
        recourseGraceDays: c.recourseGraceDays,
        maxInvoiceTenorDays: c.maxInvoiceTenorDays,
        recourse: c.recourse,
        limitedRecourseRate: c.limitedRecourseRate,
        serviceFeeRate: c.serviceFeeRate,
        acknowledgement: {
          type: 'DEBTOR_NOTICE',
          required: c.notificationRequired,
        },
        maxDebtorConcentration: c.maxDebtorConcentration,
      };
    }
    case 'SUPPLY_CHAIN': {
      const c = t!.supplyChain!;
      return {
        ...none,
        ...discounted,
        kind,
        recourseGraceDays: c.buyerGraceDays,
        maxInvoiceTenorDays: c.maxInvoiceTenorDays,
        // The buyer is the facility holder and owes every approved invoice.
        recourse: 'FULL',
        discount: {
          rate: c.discountRate,
          dayCountBasis: c.dayCountBasis,
          method: c.discountMethod,
          graceDays: 0,
        },
        acknowledgement: { type: 'BUYER_APPROVAL', required: true },
        supplierRequired: true,
        supplierApprovalRequired: c.supplierApprovalRequired,
      };
    }
    case 'FORFAITING': {
      const c = t!.forfaiting!;
      return {
        ...none,
        ...discounted,
        kind,
        recourseGraceDays: c.collectionGraceDays,
        maxInvoiceTenorDays: c.maxTenorDays,
        recourse: 'NONE',
        discount: {
          rate: c.discountRate,
          dayCountBasis: c.dayCountBasis,
          method: c.discountMethod,
          graceDays: c.graceDays,
        },
        acknowledgement: { type: 'AVAL', required: c.avalRequired },
        instrumentTypes: c.instrumentTypes,
      };
    }
    default:
      return null;
  }
}

/**
 * The receivables register (LT-18 family): invoice financing with recourse
 * (UC-67), factoring, supply-chain (payables) finance and forfaiting.
 *
 * A receivables facility is a revolving limit drawn only by advances
 * against approved receivables. Each receivable is registered (maker),
 * acknowledged where the product needs it — the debtor notified of the
 * assignment (factoring), the buyer's approval of the payable (supply chain),
 * the bank's aval on the bill or note (forfaiting) — approved as eligible
 * (checker), and funded under the same request → approve → release
 * governance as any drawdown. The release posts a DISBURSEMENT on the
 * facility's loan account, so the limit, the general ledger and
 * reconciliation see it exactly as a drawdown.
 *
 * Invoice finance and factoring advance a share of the invoice and charge a
 * fee per period, raised when money comes in; factoring also deducts a
 * service fee from the advance. Supply-chain finance and forfaiting buy the
 * face value at a discount for the days to maturity: the receivable is
 * carried at face, the discount withheld is a liability (unearned discount)
 * earned straight-line by the end-of-day batch, and the face is collected at
 * maturity.
 *
 * When money comes in the fee to date is raised, and the money clears the
 * fee, then the advance; any surplus is the borrower's reserve, held as a
 * liability until it is paid out under maker-checker.
 *
 * If the obligor has not paid by the due date plus grace, the end-of-day
 * batch applies the recourse the receivable was bought with: FULL puts the
 * whole debt on the facility holder (RECOURSE, aged as arrears); LIMITED puts
 * it there up to the cap; NONE leaves it with the lender (DEFAULTED, not
 * aged). What the lender bears is written off under maker-checker.
 *
 * Money invariants are those of the servicing path: one immutable financial
 * event with a balanced journal per movement, idempotency keys on every
 * money request, compare-and-set on the invoice, the facility and the loan
 * account, and authorization re-evaluated inside the transaction.
 */
@Injectable()
export class InvoiceFinanceService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
    // Injected for ordering: the facility batch hook (minimum-payment
    // arrears) must be registered before this one, which only raises the
    // days past due it sets.
    facilities: FacilitiesService,
  ) {
    void facilities;
    this.servicing.registerBatchHook(async (tx, state, businessDate, actor) =>
      this.recourseHook(tx, state, businessDate, actor),
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** Receivables programmes the actor can see, with their kind and usage. */
  async programmes(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'facility.read');
    if (!scope) return { data: [], total: 0 };
    return this.lp.tenantTx(tenantId, async (tx) => {
      const facilities = await tx.facility.findMany({
        where: {
          tenantId,
          facilityType: 'REVOLVING',
          ...(scope as Prisma.FacilityWhereInput),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const ids = facilities.map((f) => f.agreementId);
      const [versions, accounts, borrowers, counts] = await Promise.all([
        tx.agreementVersion.findMany({
          where: { tenantId, agreementId: { in: ids } },
          orderBy: { version: 'desc' },
          select: { agreementId: true, productConfig: true },
        }),
        tx.loanAccount.findMany({
          where: { tenantId, agreementId: { in: ids } },
          select: {
            agreementId: true,
            principalOutstanding: true,
            daysPastDue: true,
          },
        }),
        tx.borrower.findMany({
          where: {
            tenantId,
            id: { in: facilities.map((f) => f.borrowerId) },
          },
          select: { id: true, firstName: true, lastName: true },
        }),
        tx.tradeInvoice.groupBy({
          by: ['facilityId', 'status'],
          where: { tenantId, facilityId: { in: facilities.map((f) => f.id) } },
          _count: { _all: true },
        }),
      ]);
      const data = facilities
        .map((f) => {
          const cfg = versions.find((v) => v.agreementId === f.agreementId)
            ?.productConfig as lending.ProductConfig | undefined;
          const kind = lending.receivablesKind(cfg);
          if (!kind) return null;
          const acct = accounts.find((a) => a.agreementId === f.agreementId);
          const b = borrowers.find((x) => x.id === f.borrowerId);
          const mine = counts.filter((c) => c.facilityId === f.id);
          const n = (s: string[]) =>
            mine
              .filter((c) => s.includes(c.status))
              .reduce((t, c) => t + c._count._all, 0);
          return {
            id: f.id,
            reference: f.reference,
            kind,
            status: f.status,
            currency: f.currency,
            limitAmount: decStr(f.limitAmount),
            outstanding: decStr(acct?.principalOutstanding ?? 0),
            daysPastDue: acct?.daysPastDue ?? 0,
            borrowerName: b ? `${b.firstName} ${b.lastName}`.trim() : null,
            live: n(LIVE),
            pending: n([
              'SUBMITTED',
              'APPROVED',
              'ADVANCE_REQUESTED',
              'ADVANCE_APPROVED',
            ]),
            inDefault: n(['RECOURSE', 'DEFAULTED']),
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
      return { data, total: data.length };
    });
  }

  async list(actor: LendingActor, facilityId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, facilityId, {
        lock: false,
      });
      await this.policy.enforce(actor, 'facility.read', resourceOf(state), tx);
      const terms = registerTerms(state.config);
      const asOf = await this.businessDate.get(tenantId, tx);
      const rows = await tx.tradeInvoice.findMany({
        where: { tenantId, facilityId },
        orderBy: { createdAt: 'desc' },
        include: { receivable: true },
      });
      const suppliers = terms?.supplierRequired
        ? await tx.tradeSupplier.findMany({
            where: { tenantId, facilityId },
            orderBy: { createdAt: 'asc' },
          })
        : [];
      const position = engineCall(() =>
        lending.facilityPosition(state.terms, state.movements, asOf),
      );
      const open = rows.filter((r) => r.status !== 'WRITTEN_OFF');
      // By debtor (factoring), buyer-side supplier (supply chain) or obligor.
      const byDebtor = new Map<
        string,
        {
          name: string;
          invoices: number;
          faceOutstanding: InstanceType<typeof lending.D>;
          advanceOutstanding: InstanceType<typeof lending.D>;
          inDefault: number;
        }
      >();
      for (const r of rows.filter((x) => LIVE.includes(x.status))) {
        const d = byDebtor.get(r.debtorKey) ?? {
          name: r.debtorName,
          invoices: 0,
          faceOutstanding: new lending.D(0),
          advanceOutstanding: new lending.D(0),
          inDefault: 0,
        };
        d.invoices += 1;
        d.faceOutstanding = d.faceOutstanding.plus(
          D(r.amount).minus(D(r.collectedFromDebtor)),
        );
        d.advanceOutstanding = d.advanceOutstanding.plus(
          D(r.advanceOutstanding),
        );
        if (['RECOURSE', 'DEFAULTED'].includes(r.status)) d.inDefault += 1;
        byDebtor.set(r.debtorKey, d);
      }
      const limit = D(state.facility.limitAmount);
      return {
        facility: {
          id: state.facility.id,
          reference: state.facility.reference,
          status: state.facility.status,
          currency: state.facility.currency,
          limitAmount: decStr(state.facility.limitAmount),
          loanAccountId: state.account.id,
          daysPastDue: state.account.daysPastDue,
        },
        kind: terms?.kind ?? null,
        terms,
        position,
        summary: {
          invoices: rows.length,
          advancedOutstanding: sum(rows, (r) => r.advanceOutstanding),
          feesOutstanding: open
            .reduce(
              (t, r) => t.plus(D(r.feeRaised)).minus(D(r.feePaid)),
              new lending.D(0),
            )
            .toString(),
          inRecourse: rows.filter((r) => r.status === 'RECOURSE').length,
          defaulted: rows.filter((r) => r.status === 'DEFAULTED').length,
          writtenOff: rows
            .reduce(
              (t, r) => t.plus(D(r.receivable?.writtenOff ?? 0)),
              new lending.D(0),
            )
            .toString(),
          unearnedDiscount: rows
            .filter((r) => LIVE.includes(r.status))
            .reduce(
              (t, r) =>
                t
                  .plus(D(r.receivable?.discountAmount ?? 0))
                  .minus(D(r.receivable?.discountEarned ?? 0)),
              new lending.D(0),
            )
            .toString(),
          reserveOwedToBorrower: rows
            .reduce(
              (t, r) => t.plus(D(r.reserveHeld)).minus(D(r.reservePaid)),
              new lending.D(0),
            )
            .toString(),
        },
        debtors: [...byDebtor.values()].map((d) => ({
          name: d.name,
          invoices: d.invoices,
          faceOutstanding: d.faceOutstanding.toString(),
          advanceOutstanding: d.advanceOutstanding.toString(),
          shareOfLimit: limit.gt(0)
            ? d.advanceOutstanding.div(limit).toDecimalPlaces(4).toString()
            : '0',
          inDefault: d.inDefault,
        })),
        suppliers: suppliers.map((s) => supplierView(s)),
        invoices: rows.map((r) => view(r, r.receivable)),
      };
    });
  }

  async get(actor: LendingActor, invoiceId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const inv = await this.load(tx, tenantId, invoiceId);
      const state = await loadFacilityState(tx, tenantId, inv.facilityId, {
        lock: false,
      });
      await this.policy.enforce(actor, 'facility.read', resourceOf(state), tx);
      const asOf = await this.businessDate.get(tenantId, tx);
      const [collections, tasks, rec] = await Promise.all([
        tx.tradeInvoiceCollection.findMany({
          where: { tenantId, invoiceId },
          orderBy: { createdAt: 'asc' },
        }),
        tx.approvalTask.findMany({
          where: {
            tenantId,
            subjectType: 'TRADE_INVOICE',
            subjectId: invoiceId,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.receivableOf(tx, tenantId, invoiceId),
      ]);
      return {
        invoice: view(inv, rec),
        quote: this.quoteOf(inv, rec, state, asOf),
        facility: {
          id: state.facility.id,
          reference: state.facility.reference,
          loanAccountId: state.account.id,
        },
        collections: collections.map((c) => ({
          ...plain(c),
          valueDate: toLocalDate(c.valueDate),
        })),
        reservePayouts: tasks
          .filter((t) => t.action === RESERVE_PAYOUT)
          .map((t) => plain(t)),
        writeOffs: tasks
          .filter((t) => t.action === WRITE_OFF)
          .map((t) => plain(t)),
      };
    });
  }

  /** What the invoice owes as of a date: the fee to date and the advance. */
  async quote(actor: LendingActor, invoiceId: string, asOf?: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const inv = await this.load(tx, tenantId, invoiceId);
      const state = await loadFacilityState(tx, tenantId, inv.facilityId, {
        lock: false,
      });
      await this.policy.enforce(actor, 'facility.read', resourceOf(state), tx);
      const date = asOf ?? (await this.businessDate.get(tenantId, tx));
      lending.parseDate(date, 'asOf');
      const rec = await this.receivableOf(tx, tenantId, invoiceId);
      return this.quoteOf(inv, rec, state, date);
    });
  }

  // ── Register, acknowledge and approve ─────────────────────────────────────

  async register(
    actor: LendingActor,
    facilityId: string,
    body: {
      debtorName?: string;
      debtorReference?: string;
      invoiceNumber: string;
      amount: string;
      issueDate: string;
      dueDate: string;
      supplierId?: string;
      instrumentType?: string;
      guarantorName?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, facilityId);
      const cfg = termsOf_(state);
      const amount = engineCall(() =>
        lending.parseMoney(body.amount, state.facility.currency, 'amount'),
      );
      await this.policy.enforce(
        actor,
        'trade.invoice.register',
        resourceOf(state, [], { amount: amount.toString() }),
        tx,
      );
      if (amount.lte(0))
        throw new BadRequestException('The invoice amount must be positive.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      lending.parseDate(body.issueDate, 'issueDate');
      lending.parseDate(body.dueDate, 'dueDate');
      if (lending.compareDates(body.dueDate, body.issueDate) < 0)
        throw new BadRequestException(
          'The due date cannot precede the issue date.',
        );
      if (lending.compareDates(body.issueDate, businessDate) > 0)
        throw new BadRequestException(
          `An invoice issued after the business date (${businessDate}) cannot be financed yet.`,
        );
      if (lending.compareDates(body.dueDate, businessDate) < 0)
        throw new BadRequestException({
          message: `The invoice fell due on ${body.dueDate}; an overdue invoice is not eligible.`,
          code: 'INVOICE_OVERDUE',
        });
      const tenor = lending.daysBetween(body.issueDate, body.dueDate);
      if (tenor > cfg.maxInvoiceTenorDays)
        throw new BadRequestException({
          message: `This product finances receivables of at most ${cfg.maxInvoiceTenorDays} days; this one runs ${tenor}.`,
          code: 'INVOICE_TENOR',
        });
      // Supply-chain finance: the counterparty on the register is the
      // supplier being paid early; the buyer (the facility holder) owes.
      let supplier: Supplier | null = null;
      if (cfg.supplierRequired) {
        if (!body.supplierId)
          throw new BadRequestException(
            'Name the programme supplier whose invoice this is.',
          );
        supplier = await tx.tradeSupplier.findFirst({
          where: { id: body.supplierId, tenantId, facilityId },
        });
        if (!supplier)
          throw new NotFoundException('Supplier not found on this programme.');
        if (
          supplier.status !== 'ACTIVE' &&
          (cfg.supplierApprovalRequired || supplier.status !== 'PENDING')
        )
          throw new ConflictException({
            message: `${supplier.name} is ${supplier.status.toLowerCase()} on this programme; only approved suppliers' invoices are financed.`,
            code: 'SUPPLIER_NOT_ACTIVE',
          });
      } else if (body.supplierId)
        throw new BadRequestException(
          'Suppliers belong to supply-chain finance programmes.',
        );
      if (cfg.instrumentTypes) {
        if (
          !body.instrumentType ||
          !cfg.instrumentTypes.includes(body.instrumentType)
        )
          throw new BadRequestException(
            `Say which instrument is bought: ${cfg.instrumentTypes.join(' or ')}.`,
          );
      } else if (body.instrumentType)
        throw new BadRequestException(
          'Only forfaiting buys bills of exchange or promissory notes.',
        );
      const debtorName = (supplier?.name ?? body.debtorName ?? '').trim();
      const debtorKey = normalizeDebtor(debtorName);
      if (debtorKey.length < 2)
        throw new BadRequestException('Name the debtor.');
      const invoiceNumber = body.invoiceNumber.trim();
      const duplicate = await tx.tradeInvoice.findFirst({
        where: {
          tenantId,
          borrowerId: state.facility.borrowerId,
          debtorKey,
          invoiceNumber,
        },
        select: { reference: true, status: true },
      });
      if (duplicate)
        throw new ConflictException({
          message: `Invoice ${invoiceNumber} from ${debtorName} is already registered (${duplicate.reference}, ${duplicate.status.toLowerCase()}); an invoice is financed once.`,
          code: 'INVOICE_DUPLICATE',
        });
      const row = await tx.tradeInvoice.create({
        data: {
          tenantId,
          facilityId,
          loanAccountId: state.account.id,
          borrowerId: state.facility.borrowerId,
          branchId: state.facility.branchId,
          reference: newReference(
            cfg.kind === 'FORFAITING'
              ? 'FFT'
              : cfg.kind === 'SUPPLY_CHAIN'
                ? 'SCF'
                : cfg.kind === 'FACTORING'
                  ? 'FCT'
                  : 'INV',
          ),
          debtorName: debtorName.slice(0, 160),
          debtorKey,
          debtorReference: body.debtorReference?.trim().slice(0, 80) || null,
          invoiceNumber: invoiceNumber.slice(0, 60),
          currency: state.facility.currency,
          amount: amount.toString(),
          issueDate: fromLocalDate(body.issueDate),
          dueDate: fromLocalDate(body.dueDate),
          status: 'SUBMITTED',
          advanceRate: cfg.advanceRate,
          feeRatePerPeriod: cfg.feeRatePerPeriod,
          feePeriodDays: cfg.feePeriodDays,
          feeBasis: cfg.feeBasis,
          recourseGraceDays: cfg.recourseGraceDays,
          registeredBy: actor.id,
        },
      });
      let rec: Receivable | null = null;
      if (cfg.kind !== 'INVOICE_FINANCE') {
        // The receivable's terms are frozen here, never read from the live product.
        rec = await tx.tradeReceivable.create({
          data: {
            tenantId,
            invoiceId: row.id,
            facilityId,
            kind: cfg.kind,
            recourse: cfg.recourse,
            recourseCap:
              cfg.recourse === 'LIMITED'
                ? lending
                    .roundMoney(
                      amount.times(cfg.limitedRecourseRate ?? '0'),
                      state.config.pricing.rounding,
                    )
                    .toString()
                : null,
            serviceFeeRate: cfg.serviceFeeRate,
            discountRate: cfg.discount?.rate ?? '0',
            dayCountBasis: cfg.discount?.dayCountBasis ?? 360,
            discountMethod: cfg.discount?.method ?? 'STRAIGHT',
            discountGraceDays: cfg.discount?.graceDays ?? 0,
            supplierId: supplier?.id ?? null,
            instrumentType: body.instrumentType ?? null,
            guarantorName: body.guarantorName?.trim().slice(0, 160) || null,
            acknowledgementType: cfg.acknowledgement!.type,
          },
        });
      }
      await this.writeAudit(actor, tx, row, 'trade.invoice.register', {
        kind: cfg.kind,
        amount: amount.toString(),
        debtor: row.debtorName,
        invoiceNumber: row.invoiceNumber,
        dueDate: body.dueDate,
      });
      return view(row, rec);
    });
  }

  /**
   * Record what must precede a purchase: notice of assignment to the debtor
   * (factoring), the buyer's approval of the payable (supply chain), or the
   * bank's aval on the instrument (forfaiting).
   */
  async acknowledge(
    actor: LendingActor,
    invoiceId: string,
    body: { method: string; reference: string; guarantorName?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      await this.policy.enforce(
        actor,
        'trade.receivable.acknowledge',
        this.resource(state, inv, []),
        tx,
      );
      const rec = await this.receivableOf(tx, tenantId, invoiceId);
      if (!rec)
        throw new BadRequestException({
          message:
            'Invoice finance is confidential: the debtor is not notified and nothing is acknowledged.',
          code: 'NO_ACKNOWLEDGEMENT',
        });
      if (!body.reference?.trim())
        throw new BadRequestException(
          'Record the reference of the notice, approval or aval.',
        );
      const guarantor = (body.guarantorName ?? rec.guarantorName ?? '').trim();
      if (rec.acknowledgementType === 'AVAL' && guarantor.length < 2)
        throw new BadRequestException(
          'Name the bank whose aval guarantees the instrument.',
        );
      await this.casReceivable(tx, rec, {
        acknowledgementMethod: body.method.slice(0, 40),
        acknowledgementReference: body.reference.trim().slice(0, 120),
        acknowledgedBy: actor.id,
        acknowledgedAt: new Date(),
        ...(rec.acknowledgementType === 'AVAL'
          ? { guarantorName: guarantor.slice(0, 160) }
          : {}),
      });
      await this.writeAudit(actor, tx, inv, 'trade.receivable.acknowledge', {
        type: rec.acknowledgementType,
        method: body.method,
        reference: body.reference,
      });
      return {
        id: invoiceId,
        acknowledgementType: rec.acknowledgementType,
        acknowledgedAt: new Date().toISOString(),
      };
    });
  }

  async approve(actor: LendingActor, invoiceId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      await this.policy.enforce(
        actor,
        'trade.invoice.approve',
        this.resource(state, inv, [inv.registeredBy]),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      if (lending.compareDates(toLocalDate(inv.dueDate)!, businessDate) < 0)
        throw new ConflictException({
          message: `The invoice fell due on ${toLocalDate(inv.dueDate)}; it is no longer eligible.`,
          code: 'INVOICE_OVERDUE',
        });
      await this.casInvoice(tx, inv, 'SUBMITTED', {
        status: 'APPROVED',
        approvedBy: actor.id,
        approvedAt: new Date(),
      });
      await this.writeAudit(actor, tx, inv, 'trade.invoice.approve', {});
      return { id: invoiceId, status: 'APPROVED' };
    });
  }

  async reject(
    actor: LendingActor,
    invoiceId: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    if (!body.reason?.trim())
      throw new BadRequestException('Give a reason for rejecting the invoice.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      await this.policy.enforce(
        actor,
        'trade.invoice.reject',
        this.resource(state, inv, [
          inv.registeredBy,
          ...(inv.advanceRequestedBy ? [inv.advanceRequestedBy] : []),
        ]),
        tx,
      );
      await this.casInvoice(tx, inv, inv.status, {
        status: 'REJECTED',
        rejectionReason: body.reason.slice(0, 500),
      });
      await this.writeAudit(actor, tx, inv, 'trade.invoice.reject', {
        reason: body.reason,
        from: inv.status,
      });
      return { id: invoiceId, status: 'REJECTED' };
    });
  }

  // ── Advance: request → approve → release ──────────────────────────────────

  async requestAdvance(actor: LendingActor, invoiceId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      const rec = await this.receivableOf(tx, tenantId, invoiceId);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const price = this.priceOf(inv, rec, state, businessDate);
      await this.policy.enforce(
        actor,
        'trade.invoice.advance.request',
        this.resource(state, inv, [], price.advance),
        tx,
      );
      if (lending.compareDates(toLocalDate(inv.dueDate)!, businessDate) < 0)
        throw new ConflictException({
          message: `The invoice fell due on ${toLocalDate(inv.dueDate)}; it can no longer be financed.`,
          code: 'INVOICE_OVERDUE',
        });
      await this.assertPurchasable(tx, state, inv, rec, price.advance);
      this.assertDrawable(state, businessDate, price.advance);
      await this.casInvoice(tx, inv, 'APPROVED', {
        status: 'ADVANCE_REQUESTED',
        advanceAmount: price.advance,
        advanceRequestedBy: actor.id,
      });
      await this.writeAudit(actor, tx, inv, 'trade.invoice.advance.request', {
        ...price,
      });
      return { id: invoiceId, status: 'ADVANCE_REQUESTED', ...price };
    });
  }

  async approveAdvance(actor: LendingActor, invoiceId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      const advance = decStr(inv.advanceAmount);
      await this.policy.enforce(
        actor,
        'trade.invoice.advance.approve',
        this.resource(state, inv, [inv.advanceRequestedBy ?? ''], advance),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      // The limit may have been used since the request.
      this.assertDrawable(state, businessDate, advance);
      await this.casInvoice(tx, inv, 'ADVANCE_REQUESTED', {
        status: 'ADVANCE_APPROVED',
        advanceApprovedBy: actor.id,
      });
      await this.writeAudit(actor, tx, inv, 'trade.invoice.advance.approve', {
        advance,
      });
      return { id: invoiceId, status: 'ADVANCE_APPROVED', advance };
    });
  }

  /**
   * Fund the receivable: a DISBURSEMENT on the facility's loan account,
   * exactly as a released drawdown posts. The loan account carries what the
   * obligor owes on it — the advance, or the face of a discounted purchase —
   * and the cash paid out is that less any service fee or discount.
   */
  async releaseAdvance(
    actor: LendingActor,
    invoiceId: string,
    body: { externalReference: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'invoice.release', invoiceId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      const amount = D(inv.advanceAmount);
      await this.policy.enforce(
        actor,
        'trade.invoice.advance.release',
        // As for any payout, the requester may not release their own advance.
        this.resource(
          state,
          inv,
          [inv.advanceRequestedBy ?? ''],
          amount.toString(),
        ),
        tx,
      );
      if (!body.externalReference?.trim())
        throw new BadRequestException(
          'Record the bank or cash reference of the payout.',
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      if (lending.compareDates(toLocalDate(inv.dueDate)!, businessDate) < 0)
        throw new ConflictException({
          message: `The invoice fell due on ${toLocalDate(inv.dueDate)}; it can no longer be financed.`,
          code: 'INVOICE_OVERDUE',
        });
      this.assertDrawable(state, businessDate, amount.toString());
      const rec = await this.receivableOf(tx, tenantId, invoiceId);
      // The price is fixed on the day the money leaves (the discount runs from today).
      const price = this.priceOf(inv, rec, state, businessDate);
      if (!D(price.advance).eq(amount))
        throw new ConflictException(
          'The approved amount no longer matches the receivable; request the advance again.',
        );
      const supplier = rec?.supplierId
        ? await tx.tradeSupplier.findFirst({
            where: { id: rec.supplierId, tenantId },
          })
        : null;
      const loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      const acct = state.config.accounting;
      const trade = tradeAccounts(state.config);
      const lines = nonZero([
        { accountCode: acct.loansReceivable, debit: amount.toString() },
        { accountCode: acct.cash, credit: price.paidOut },
        { accountCode: trade.serviceFeeIncome, credit: price.serviceFee },
        { accountCode: trade.unearnedDiscount, credit: price.discount },
      ]);
      const kind = rec?.kind ?? 'INVOICE_FINANCE';
      const event = await this.servicing.recordEvent(tx, loanState, {
        type: 'DISBURSEMENT',
        amount,
        businessDate,
        valueDate: businessDate,
        components: {
          facilityId: state.facility.id,
          invoiceId,
          invoice: inv.reference,
          kind,
          invoiceAmount: decStr(inv.amount),
          advanceRate: decStr(inv.advanceRate),
          paidOut: price.paidOut,
          serviceFee: price.serviceFee,
          discount: price.discount,
          discountDays: price.discountDays,
          ...(supplier
            ? {
                payee: {
                  type: 'SUPPLIER',
                  name: supplier.name,
                  account: supplier.accountNumber,
                },
              }
            : {}),
          explanation: price.explanation,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative:
          kind === 'SUPPLY_CHAIN'
            ? `Early payment to ${inv.debtorName} of invoice ${inv.invoiceNumber} under ${state.facility.reference}`
            : kind === 'FORFAITING'
              ? `Purchase without recourse of ${inv.invoiceNumber} under ${state.facility.reference}`
              : kind === 'FACTORING'
                ? `Purchase of invoice ${inv.invoiceNumber} (${inv.debtorName}) under ${state.facility.reference}`
                : `Advance on invoice ${inv.invoiceNumber} (${inv.debtorName}) under ${state.facility.reference}`,
        externalReference: body.externalReference.trim().slice(0, 120),
        lines,
      });
      await this.servicing.casAccount(tx, loanState, loanState.account.status, {
        principalOutstanding: D(loanState.account.principalOutstanding)
          .plus(amount)
          .toString(),
        status: 'ACTIVE',
        ...(loanState.account.disbursementDate
          ? {}
          : { disbursementDate: fromLocalDate(businessDate) }),
      });
      await this.casFacility(tx, state, {
        totalDrawn: D(state.facility.totalDrawn).plus(amount).toString(),
        status: 'ACTIVE',
      });
      const recourseDate = engineCall(() =>
        lending.invoiceRecourseDate(
          toLocalDate(inv.dueDate)!,
          inv.recourseGraceDays,
        ),
      );
      await this.casInvoice(tx, inv, 'ADVANCE_APPROVED', {
        status: 'FUNDED',
        advanceDate: fromLocalDate(businessDate),
        advanceEventId: event.id,
        advanceOutstanding: amount.toString(),
        recourseDate: fromLocalDate(recourseDate),
        advanceReleasedBy: actor.id,
      });
      if (rec)
        await this.casReceivable(tx, rec, {
          purchasePrice: price.paidOut,
          serviceFee: price.serviceFee,
          discountDays: price.discountDays,
          discountAmount: price.discount,
        });
      await this.servicing.outbox(
        tx,
        tenantId,
        'lending.trade.invoice_advanced',
        {
          invoiceId,
          facilityId: state.facility.id,
          eventId: event.id,
          kind,
          amount: amount.toString(),
          paidOut: price.paidOut,
          currency: inv.currency,
        },
      );
      await this.writeAudit(actor, tx, inv, 'trade.invoice.advance.release', {
        event: event.id,
        amount: amount.toString(),
        paidOut: price.paidOut,
        recourseDate,
      });
      return {
        id: invoiceId,
        status: 'FUNDED',
        eventId: event.id,
        advance: amount.toString(),
        paidOut: price.paidOut,
        serviceFee: price.serviceFee,
        discount: price.discount,
        recourseDate,
      };
    });
  }

  // ── Collections ───────────────────────────────────────────────────────────

  /**
   * Money received for a receivable: from the debtor (TV-20) — the buyer,
   * under supply-chain finance — or from the facility holder under recourse
   * (UC-67), within any limit on that recourse.
   *
   * Posted as up to four events in one transaction: the fee raised to date
   * (ACCRUAL), the receipt itself (INVOICE_COLLECTION — the fee collected
   * and any reserve now owed to the borrower), the advance repaid (REPAYMENT,
   * which is what reinstates the revolving limit) and, on a discounted
   * purchase, the discount earned to date.
   */
  async collect(
    actor: LendingActor,
    invoiceId: string,
    body: {
      source: 'DEBTOR' | 'BORROWER';
      amount: string;
      externalReference?: string;
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'invoice.collect', invoiceId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      const amount = engineCall(() =>
        lending.parseMoney(String(body.amount ?? ''), inv.currency, 'amount'),
      );
      await this.policy.enforce(
        actor,
        'trade.invoice.collect',
        this.resource(state, inv, [], amount.toString()),
        tx,
      );
      const rec = await this.receivableOf(tx, tenantId, invoiceId);
      if (body.source === 'BORROWER' && inv.status === 'SETTLED')
        throw new ConflictException(
          'Nothing is owed on this invoice; the borrower has nothing to repay.',
        );
      if (body.source === 'BORROWER' && rec) {
        if (rec.kind === 'SUPPLY_CHAIN')
          throw new BadRequestException({
            message:
              'Under supply-chain finance the buyer is the debtor: record its payment as the debtor’s.',
            code: 'BUYER_IS_DEBTOR',
          });
        if (rec.recourse === 'NONE')
          throw new BadRequestException({
            message:
              'This receivable was bought without recourse; the seller owes nothing on it.',
            code: 'WITHOUT_RECOURSE',
          });
        if (rec.recourse === 'LIMITED') {
          const left = D(rec.recourseCap).minus(D(inv.collectedFromBorrower));
          if (amount.gt(left))
            throw new BadRequestException({
              message: `Under limited recourse the seller answers for at most ${decStr(rec.recourseCap)}; ${left.gt(0) ? left : 0} remains.`,
              code: 'RECOURSE_CAP',
            });
        }
      }
      if (body.source === 'DEBTOR') {
        const total = D(inv.collectedFromDebtor).plus(amount);
        if (total.gt(D(inv.amount)))
          throw new BadRequestException({
            message: `The debtor owes at most the invoice amount ${decStr(inv.amount)}; ${decStr(inv.collectedFromDebtor)} is already received.`,
            code: 'INVOICE_OVERPAYMENT',
          });
      }
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = businessDate;
      const r = engineCall(() =>
        lending.allocateInvoiceCollection(
          positionOf(inv),
          { amount: amount.toString(), valueDate, source: body.source },
          state.config.pricing.rounding,
        ),
      );
      const feeRaise = D(r.feeRaise);
      const toFee = D(r.toFee);
      const toAdvance = D(r.toAdvance);
      const toReserve = D(r.toReserve);
      const acct = state.config.accounting;
      const reserveAccount = tradeAccounts(state.config).reservePayable;
      let loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      const ref = body.externalReference?.trim().slice(0, 120) || null;

      const receipt = await this.servicing.recordEvent(tx, loanState, {
        type: 'INVOICE_COLLECTION',
        amount,
        businessDate,
        valueDate,
        components: {
          invoiceId,
          invoice: inv.reference,
          source: body.source,
          feeRaised: r.feeRaise,
          fee: r.toFee,
          advance: r.toAdvance,
          reserve: r.toReserve,
          explanation: r.explanation,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `${body.source === 'DEBTOR' ? 'Debtor' : 'Recourse'} payment on invoice ${inv.invoiceNumber} (${inv.debtorName})`,
        externalReference: ref,
        // The fee and the borrower's reserve; the advance is the REPAYMENT below.
        lines: [
          { accountCode: acct.cash, debit: toFee.plus(toReserve).toString() },
          { accountCode: acct.feesReceivable, credit: toFee.toString() },
          { accountCode: reserveAccount, credit: toReserve.toString() },
        ],
      });
      if (feeRaise.gt(0))
        await this.servicing.recordEvent(tx, loanState, {
          type: 'ACCRUAL',
          amount: feeRaise,
          businessDate,
          valueDate,
          components: { invoiceId, fee: r.feeRaise, feeToDate: r.feeToDate },
          idempotencyKey: `sys:invoice-fee:${invoiceId}:${randomUUID()}`,
          requestHash: 'system',
          actor,
          narrative: `Invoice fee to ${valueDate} on ${inv.invoiceNumber}`,
          lines: [
            { accountCode: acct.feesReceivable, debit: feeRaise.toString() },
            { accountCode: acct.feeIncome, credit: feeRaise.toString() },
          ],
        });
      let repaymentEventId: string | null = null;
      if (toAdvance.gt(0)) {
        const repaid = await this.servicing.recordEvent(tx, loanState, {
          type: 'REPAYMENT',
          amount: toAdvance,
          businessDate,
          valueDate,
          components: {
            invoiceId,
            receiptEventId: receipt.id,
            penalty: '0',
            fee: '0',
            tax: '0',
            interest: '0',
            principal: r.toAdvance,
          },
          idempotencyKey: `sys:invoice-repay:${receipt.id}`,
          requestHash: 'system',
          actor,
          narrative: `Advance repaid on invoice ${inv.invoiceNumber}`,
          externalReference: ref,
          lines: [
            { accountCode: acct.cash, debit: toAdvance.toString() },
            { accountCode: acct.loansReceivable, credit: toAdvance.toString() },
          ],
        });
        repaymentEventId = repaid.id;
      }
      // A discounted purchase that is paid in full has earned all its discount.
      if (rec && D(rec.discountAmount).gt(0))
        await this.earnDiscount(
          tx,
          loanState,
          inv,
          rec,
          r.settled ? null : valueDate,
          businessDate,
          actor,
        );
      loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      await this.servicing.casAccount(tx, loanState, loanState.account.status, {
        principalOutstanding: D(loanState.account.principalOutstanding)
          .minus(toAdvance)
          .toString(),
        feesReceivable: D(loanState.account.feesReceivable)
          .plus(feeRaise)
          .minus(toFee)
          .toString(),
      });
      await tx.tradeInvoiceCollection.create({
        data: {
          tenantId,
          invoiceId,
          eventId: receipt.id,
          source: body.source,
          amount: amount.toString(),
          feeRaised: feeRaise.toString(),
          toFee: toFee.toString(),
          toAdvance: toAdvance.toString(),
          toReserve: toReserve.toString(),
          valueDate: fromLocalDate(valueDate),
          createdBy: actor.id,
        },
      });
      await this.casInvoice(tx, inv, inv.status, {
        advanceOutstanding: D(inv.advanceOutstanding)
          .minus(toAdvance)
          .toString(),
        feeRaised: D(inv.feeRaised).plus(feeRaise).toString(),
        feePaid: D(inv.feePaid).plus(toFee).toString(),
        reserveHeld: D(inv.reserveHeld).plus(toReserve).toString(),
        ...(body.source === 'DEBTOR'
          ? {
              collectedFromDebtor: D(inv.collectedFromDebtor)
                .plus(amount)
                .toString(),
            }
          : {
              collectedFromBorrower: D(inv.collectedFromBorrower)
                .plus(amount)
                .toString(),
            }),
        ...(r.settled && inv.status !== 'SETTLED'
          ? { status: 'SETTLED', settledAt: new Date() }
          : {}),
      });
      await this.writeAudit(actor, tx, inv, 'trade.invoice.collect', {
        event: receipt.id,
        source: body.source,
        amount: amount.toString(),
        fee: r.toFee,
        advance: r.toAdvance,
        reserve: r.toReserve,
      });
      return {
        eventId: receipt.id,
        repaymentEventId,
        status: r.settled ? 'SETTLED' : inv.status,
        ...r,
      };
    });
  }

  // ── Reserve payout (maker-checker) ────────────────────────────────────────

  async proposeReservePayout(
    actor: LendingActor,
    invoiceId: string,
    body: { externalReference?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      const owed = D(inv.reserveHeld).minus(D(inv.reservePaid));
      await this.policy.enforce(
        actor,
        'trade.invoice.reserve.propose',
        this.resource(state, inv, [], owed.toString()),
        tx,
      );
      if (owed.lte(0))
        throw new ConflictException(
          'Nothing is held for the borrower on this invoice.',
        );
      const open = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectType: 'TRADE_INVOICE',
          subjectId: invoiceId,
          action: RESERVE_PAYOUT,
          status: 'PENDING',
        },
      });
      if (open)
        throw new ConflictException('A payout is already awaiting approval.');
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'TRADE_INVOICE',
          subjectId: invoiceId,
          action: RESERVE_PAYOUT,
          requiredPermission: 'loan.repayment.reverse',
          amount: owed.toString(),
          currency: inv.currency,
          payload: {
            externalReference: body.externalReference?.slice(0, 120) ?? null,
          } as Json,
          makerId: actor.id,
        },
      });
      await this.writeAudit(actor, tx, inv, 'trade.invoice.reserve.propose', {
        task: task.id,
        amount: owed.toString(),
      });
      return plain(task);
    });
  }

  /** Approve and pay (Dr reserve payable, Cr cash), or reject. */
  async decideReservePayout(
    actor: LendingActor,
    invoiceId: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({
      op: 'invoice.reserve',
      invoiceId,
      taskId,
      body,
    });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      const task = await tx.approvalTask.findFirst({
        where: {
          id: taskId,
          tenantId,
          subjectType: 'TRADE_INVOICE',
          subjectId: invoiceId,
          action: RESERVE_PAYOUT,
        },
      });
      if (!task) throw new NotFoundException('Payout proposal not found');
      const amount = D(task.amount);
      const decision = await this.policy.enforce(
        actor,
        'trade.invoice.reserve.approve',
        this.resource(state, inv, [task.makerId], amount.toString()),
        tx,
      );
      const res = await tx.approvalTask.updateMany({
        where: { id: taskId, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'EXECUTED' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          comment: body.comment?.slice(0, 500),
        },
      });
      if (res.count !== 1) throw concurrentModification('This payout proposal');
      if (!body.approve) return { rejected: true };
      if (amount.gt(D(inv.reserveHeld).minus(D(inv.reservePaid))))
        throw new ConflictException(
          'Less is now held for the borrower than this payout.',
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      const event = await this.servicing.recordEvent(tx, loanState, {
        type: 'INVOICE_RESERVE_PAYOUT',
        amount,
        businessDate,
        valueDate: businessDate,
        components: { invoiceId, task: taskId },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Invoice ${inv.invoiceNumber}: balance paid to the borrower`,
        externalReference:
          (task.payload as { externalReference?: string | null })
            .externalReference ?? null,
        lines: [
          {
            accountCode: tradeAccounts(state.config).reservePayable,
            debit: amount.toString(),
          },
          {
            accountCode: state.config.accounting.cash,
            credit: amount.toString(),
          },
        ],
      });
      await this.casInvoice(tx, inv, inv.status, {
        reservePaid: D(inv.reservePaid).plus(amount).toString(),
      });
      await this.audit.write(
        {
          actor,
          action: 'trade.invoice.reserve.approve',
          resourceType: 'TradeInvoice',
          resourceId: invoiceId,
          outcome: 'SUCCESS',
          decision,
          details: { event: event.id, amount: amount.toString() },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return event;
    });
  }

  // ── Write-off of what the lender bears (maker-checker) ───────────────────

  /**
   * Propose writing off what is still owed on a defaulted receivable: one
   * bought without recourse, one whose limited recourse is exhausted, or a
   * recourse debt the holder cannot pay. A write-off checker with authority
   * decides.
   */
  async proposeWriteOff(
    actor: LendingActor,
    invoiceId: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    if (!body.reason?.trim())
      throw new BadRequestException('Give a reason for the write-off.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      const rec = await this.receivableOf(tx, tenantId, invoiceId);
      const owed = writeOffAmount(inv, rec);
      await this.policy.enforce(
        actor,
        'trade.receivable.write_off.propose',
        this.resource(state, inv, [], owed.toString()),
        tx,
      );
      const open = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectType: 'TRADE_INVOICE',
          subjectId: invoiceId,
          action: WRITE_OFF,
          status: 'PENDING',
        },
      });
      if (open)
        throw new ConflictException(
          'A write-off is already awaiting approval.',
        );
      const task = await tx.approvalTask.create({
        data: {
          tenantId,
          subjectType: 'TRADE_INVOICE',
          subjectId: invoiceId,
          action: WRITE_OFF,
          requiredPermission: 'loan.writeoff.approve',
          amount: owed.toString(),
          currency: inv.currency,
          payload: { reason: body.reason.slice(0, 500) } as Json,
          makerId: actor.id,
        },
      });
      await this.writeAudit(
        actor,
        tx,
        inv,
        'trade.receivable.write_off.propose',
        { task: task.id, amount: owed.toString(), reason: body.reason },
      );
      return plain(task);
    });
  }

  /**
   * Approve (post TRADE_WRITE_OFF: the advance and fee off the books, the
   * unearned discount released, the rest a credit loss) or reject.
   */
  async decideWriteOff(
    actor: LendingActor,
    invoiceId: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({
      op: 'receivable.write_off',
      invoiceId,
      taskId,
      body,
    });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const { inv, state } = await this.locked(tx, tenantId, invoiceId);
      const task = await tx.approvalTask.findFirst({
        where: {
          id: taskId,
          tenantId,
          subjectType: 'TRADE_INVOICE',
          subjectId: invoiceId,
          action: WRITE_OFF,
        },
      });
      if (!task) throw new NotFoundException('Write-off proposal not found');
      const decision = await this.policy.enforce(
        actor,
        'trade.receivable.write_off.approve',
        this.resource(state, inv, [task.makerId], decStr(task.amount)),
        tx,
      );
      const res = await tx.approvalTask.updateMany({
        where: { id: taskId, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'EXECUTED' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          comment: body.comment?.slice(0, 500),
        },
      });
      if (res.count !== 1)
        throw concurrentModification('This write-off proposal');
      if (!body.approve) return { rejected: true };
      const rec = await this.receivableOf(tx, tenantId, invoiceId);
      const owed = writeOffAmount(inv, rec);
      if (!owed.eq(D(task.amount)))
        throw new ConflictException(
          `${owed} is now owed on this receivable, not the ${decStr(task.amount)} proposed; propose the write-off again.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      const advance = D(inv.advanceOutstanding);
      const fee = D(inv.feeRaised).minus(D(inv.feePaid));
      const unearned = D(rec!.discountAmount).minus(D(rec!.discountEarned));
      const acct = state.config.accounting;
      const trade = tradeAccounts(state.config);
      const event = await this.servicing.recordEvent(tx, loanState, {
        type: 'TRADE_WRITE_OFF',
        amount: owed,
        businessDate,
        valueDate: businessDate,
        components: {
          invoiceId,
          task: taskId,
          advance: advance.toString(),
          fee: fee.toString(),
          unearnedDiscountReleased: unearned.toString(),
          creditLoss: owed.minus(unearned).toString(),
          recourse: rec!.recourse,
          reason: (task.payload as { reason?: string }).reason ?? null,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `${inv.invoiceNumber} (${inv.debtorName}) written off`,
        lines: nonZero([
          { accountCode: trade.unearnedDiscount, debit: unearned.toString() },
          {
            accountCode: trade.creditLoss,
            debit: owed.minus(unearned).toString(),
          },
          { accountCode: acct.loansReceivable, credit: advance.toString() },
          { accountCode: acct.feesReceivable, credit: fee.toString() },
        ]),
      });
      await this.servicing.casAccount(tx, loanState, loanState.account.status, {
        principalOutstanding: D(loanState.account.principalOutstanding)
          .minus(advance)
          .toString(),
        feesReceivable: D(loanState.account.feesReceivable)
          .minus(fee)
          .toString(),
      });
      await this.casInvoice(tx, inv, inv.status, {
        status: 'WRITTEN_OFF',
        advanceOutstanding: '0',
      });
      await this.casReceivable(tx, rec!, {
        writtenOff: owed.toString(),
        writeOffEventId: event.id,
      });
      await this.audit.write(
        {
          actor,
          action: 'trade.receivable.write_off.approve',
          resourceType: 'TradeInvoice',
          resourceId: invoiceId,
          outcome: 'SUCCESS',
          decision,
          details: { event: event.id, amount: owed.toString() },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return {
        eventId: event.id,
        status: 'WRITTEN_OFF',
        amount: owed.toString(),
      };
    });
  }

  // ── Supply-chain programme suppliers ──────────────────────────────────────

  async addSupplier(
    actor: LendingActor,
    facilityId: string,
    body: {
      name: string;
      taxId?: string;
      bankName?: string;
      accountNumber?: string;
      sublimit?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, facilityId);
      const cfg = termsOf_(state);
      await this.policy.enforce(
        actor,
        'trade.supplier.manage',
        resourceOf(state),
        tx,
      );
      if (!cfg.supplierRequired)
        throw new BadRequestException({
          message: 'Suppliers belong to supply-chain finance programmes.',
          code: 'NOT_SUPPLY_CHAIN',
        });
      const nameKey = normalizeDebtor(body.name);
      if (nameKey.length < 2)
        throw new BadRequestException('Name the supplier.');
      if (
        await tx.tradeSupplier.findFirst({
          where: { tenantId, facilityId, nameKey },
        })
      )
        throw new ConflictException(
          `${body.name.trim()} is already a supplier on this programme.`,
        );
      const sublimit = body.sublimit
        ? engineCall(() =>
            lending.parseMoney(
              body.sublimit!,
              state.facility.currency,
              'sublimit',
            ),
          )
        : null;
      if (sublimit && sublimit.lte(0))
        throw new BadRequestException('A supplier sublimit must be positive.');
      const row = await tx.tradeSupplier.create({
        data: {
          tenantId,
          facilityId,
          reference: newReference('SUP'),
          name: body.name.trim().slice(0, 160),
          nameKey,
          taxId: body.taxId?.trim().slice(0, 60) || null,
          bankName: body.bankName?.trim().slice(0, 160) || null,
          accountNumber: body.accountNumber?.trim().slice(0, 60) || null,
          sublimit: sublimit?.toString() ?? null,
          createdBy: actor.id,
          status: 'PENDING',
        },
      });
      await this.supplierAudit(actor, tx, row, 'trade.supplier.manage', {
        name: row.name,
        sublimit: row.sublimit?.toString() ?? null,
      });
      return supplierView(row);
    });
  }

  async decideSupplier(
    actor: LendingActor,
    supplierId: string,
    decision: 'APPROVE' | 'REJECT',
    reason?: string,
  ) {
    const tenantId = requireTenant(actor);
    if (decision === 'REJECT' && !reason?.trim())
      throw new BadRequestException('Give a reason.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const first = await tx.tradeSupplier.findFirst({
        where: { id: supplierId, tenantId },
      });
      if (!first) throw new NotFoundException('Supplier not found');
      const state = await loadFacilityState(tx, tenantId, first.facilityId);
      const sup = (await tx.tradeSupplier.findFirst({
        where: { id: supplierId, tenantId },
      }))!;
      const action =
        decision === 'APPROVE'
          ? 'trade.supplier.approve'
          : 'trade.supplier.reject';
      await this.policy.enforce(
        actor,
        action,
        resourceOf(state, [sup.createdBy], { workflowState: sup.status }),
        tx,
      );
      const to =
        decision === 'APPROVE'
          ? 'ACTIVE'
          : sup.status === 'ACTIVE'
            ? 'SUSPENDED'
            : 'REJECTED';
      const res = await tx.tradeSupplier.updateMany({
        where: {
          id: supplierId,
          tenantId,
          version: sup.version,
          status: sup.status,
        },
        data: {
          status: to,
          version: { increment: 1 },
          ...(decision === 'APPROVE'
            ? { approvedBy: actor.id, approvedAt: new Date() }
            : { statusReason: reason!.slice(0, 500) }),
        },
      });
      if (res.count !== 1) throw concurrentModification('This supplier');
      await this.supplierAudit(actor, tx, sup, action, {
        from: sup.status,
        to,
        reason,
      });
      return { id: supplierId, status: to };
    });
  }

  // ── Closing a programme ───────────────────────────────────────────────────

  /**
   * Close a receivables facility once nothing is open on it: every
   * receivable settled, written off or rejected, nothing owed to borrowers,
   * no discount left to earn and a zero balance. The facility is closed and
   * its loan account closed (any allowance released).
   */
  async closeProgramme(actor: LendingActor, facilityId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, facilityId);
      termsOf_(state);
      await this.policy.enforce(
        actor,
        'trade.programme.close',
        resourceOf(state),
        tx,
      );
      const rows = await tx.tradeInvoice.findMany({
        where: { tenantId, facilityId },
        include: { receivable: true },
      });
      const open = rows.filter((r) => !TERMINAL.includes(r.status));
      if (open.length)
        throw new ConflictException({
          message: `${open.length} receivable(s) are still open (${open
            .slice(0, 5)
            .map((r) => `${r.invoiceNumber} ${r.status.toLowerCase()}`)
            .join(', ')}); settle, write off or reject them first.`,
          code: 'PROGRAMME_OPEN',
        });
      const reserve = rows.reduce(
        (t, r) => t.plus(D(r.reserveHeld)).minus(D(r.reservePaid)),
        new lending.D(0),
      );
      if (reserve.gt(0))
        throw new ConflictException({
          message: `${reserve} is still held for the borrower; pay it out first.`,
          code: 'PROGRAMME_RESERVE_HELD',
        });
      const loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      const a = loanState.account;
      const balance = D(a.principalOutstanding)
        .plus(D(a.interestReceivable))
        .plus(D(a.feesReceivable))
        .plus(D(a.penaltyReceivable));
      if (!balance.isZero() || D(a.advanceBalance).gt(0))
        throw new ConflictException({
          message: `The facility still carries ${balance} ${a.currency}; it closes at zero.`,
          code: 'PROGRAMME_BALANCE',
        });
      const businessDate = await this.businessDate.get(tenantId, tx);
      const data: Prisma.LoanAccountUpdateManyMutationInput = {
        principalOutstanding: '0',
        interestReceivable: '0',
        feesReceivable: '0',
        penaltyReceivable: '0',
      };
      if (a.status === 'ACTIVE') {
        await this.servicing.closeIfRepaid(
          tx,
          loanState,
          data,
          actor,
          businessDate,
        );
        if (data.status !== 'CLOSED')
          throw new ConflictException(
            'The facility account still has open items; it cannot close.',
          );
        await this.servicing.casAccount(tx, loanState, 'ACTIVE', data);
      }
      await this.casFacility(tx, state, { status: 'CLOSED' });
      await this.audit.write(
        {
          actor,
          action: 'trade.programme.close',
          resourceType: 'Facility',
          resourceId: facilityId,
          outcome: 'SUCCESS',
          details: {
            receivables: rows.length,
            writtenOff: rows
              .reduce(
                (t, r) => t.plus(D(r.receivable?.writtenOff ?? 0)),
                new lending.D(0),
              )
              .toString(),
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return {
        id: facilityId,
        status: 'CLOSED',
        loanAccountStatus: data.status ?? a.status,
      };
    });
  }

  // ── Recourse (UC-67) and discount earning: end-of-day ─────────────────────

  /**
   * On a receivables facility's loan account: earn discount to date on every
   * discounted purchase, apply recourse to every funded receivable whose
   * due date plus grace has passed (fee raised to that date), and report the
   * days past due of the oldest one the holder still owes, so the batch ages
   * the facility exactly as it ages a missed instalment.
   */
  private async recourseHook(
    tx: Tx,
    state: LoanState,
    businessDate: string,
    actor: LendingActor,
  ) {
    if (!lending.receivablesKind(state.config)) return;
    const tenantId = state.account.tenantId;
    const facility = await tx.facility.findFirst({
      where: { tenantId, agreementId: state.account.agreementId },
      select: { id: true },
    });
    if (!facility) return;
    // Discount earned straight-line to today (or maturity).
    const discounted = await tx.tradeInvoice.findMany({
      where: {
        tenantId,
        facilityId: facility.id,
        status: { in: LIVE },
        receivable: { discountAmount: { gt: 0 } },
      },
      include: { receivable: true },
    });
    for (const inv of discounted)
      await this.earnDiscount(
        tx,
        state,
        inv,
        inv.receivable!,
        businessDate,
        businessDate,
        actor,
      );
    const due = await tx.tradeInvoice.findMany({
      where: {
        tenantId,
        facilityId: facility.id,
        status: 'FUNDED',
        recourseDate: { lt: fromLocalDate(businessDate) },
      },
      include: { receivable: true },
    });
    const acct = state.config.accounting;
    for (const inv of due) {
      const recourseDate = toLocalDate(inv.recourseDate)!;
      const feeToDate = D(
        engineCall(() =>
          lending.invoiceFeeToDate(
            positionOf(inv),
            recourseDate,
            state.config.pricing.rounding,
          ),
        ),
      );
      const raise = feeToDate.minus(D(inv.feeRaised));
      if (raise.gt(0)) {
        await this.servicing.recordEvent(tx, state, {
          type: 'ACCRUAL',
          amount: raise,
          businessDate,
          valueDate: recourseDate,
          components: {
            invoiceId: inv.id,
            fee: raise.toString(),
            recourse: true,
          },
          idempotencyKey: `sys:invoice-recourse:${inv.id}`,
          requestHash: 'system',
          actor,
          narrative: `Invoice fee to the recourse date ${recourseDate} on ${inv.invoiceNumber}`,
          lines: [
            { accountCode: acct.feesReceivable, debit: raise.toString() },
            { accountCode: acct.feeIncome, credit: raise.toString() },
          ],
        });
        // The batch writes the account once, from this state.
        state.account.feesReceivable = D(state.account.feesReceivable).plus(
          raise,
        ) as never;
      }
      // Without recourse the lender keeps the claim on the obligor; the
      // holder owes nothing and the facility does not age.
      const withoutRecourse = inv.receivable?.recourse === 'NONE';
      const to = withoutRecourse ? 'DEFAULTED' : 'RECOURSE';
      await this.casInvoice(tx, inv, 'FUNDED', {
        status: to,
        recourseAt: new Date(),
        feeRaised: D(inv.feeRaised)
          .plus(raise.gt(0) ? raise : 0)
          .toString(),
      });
      if (inv.receivable)
        await this.casReceivable(tx, inv.receivable, {
          defaultedAt: new Date(),
        });
      await this.audit.write(
        {
          actor,
          action: withoutRecourse
            ? 'trade.receivable.default'
            : 'trade.invoice.recourse',
          resourceType: 'TradeInvoice',
          resourceId: inv.id,
          outcome: 'SUCCESS',
          details: {
            recourseDate,
            recourse: inv.receivable?.recourse ?? 'FULL',
            advanceOwed: decStr(inv.advanceOutstanding),
            feeToDate: feeToDate.toString(),
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      await this.servicing.outbox(
        tx,
        tenantId,
        withoutRecourse
          ? 'lending.trade.receivable_defaulted'
          : 'lending.trade.invoice_recourse',
        {
          invoiceId: inv.id,
          borrowerId: inv.borrowerId,
          recourseDate,
        },
      );
    }
    const unpaid = await tx.tradeInvoice.findMany({
      where: { tenantId, facilityId: facility.id, status: 'RECOURSE' },
      select: {
        recourseDate: true,
        collectedFromBorrower: true,
        receivable: { select: { recourse: true, recourseCap: true } },
      },
      orderBy: { recourseDate: 'asc' },
    });
    // Limited recourse stops ageing once the holder has paid its cap.
    const owing = unpaid.filter(
      (u) =>
        u.receivable?.recourse !== 'LIMITED' ||
        D(u.collectedFromBorrower).lt(D(u.receivable.recourseCap)),
    );
    const oldest = owing[0]?.recourseDate;
    if (oldest) {
      const dpd = lending.daysBetween(toLocalDate(oldest)!, businessDate);
      state.externalDpd = Math.max(state.externalDpd ?? 0, dpd);
    }
  }

  /**
   * Post the discount earned on a discounted purchase up to `asOf` (all of
   * it when `asOf` is null): Dr unearned discount, Cr discount income.
   */
  private async earnDiscount(
    tx: Tx,
    loanState: LoanState,
    inv: Invoice,
    rec: Receivable,
    asOf: string | null,
    businessDate: string,
    actor: LendingActor,
  ) {
    const total = D(rec.discountAmount);
    const earned = D(rec.discountEarned);
    const target = asOf
      ? D(
          engineCall(() =>
            lending.discountEarnedToDate(
              total.toString(),
              toLocalDate(inv.advanceDate)!,
              toLocalDate(inv.dueDate)!,
              asOf,
              loanState.config.pricing.rounding,
            ),
          ),
        )
      : total;
    const delta = target.minus(earned);
    if (delta.lte(0)) return;
    const trade = tradeAccounts(loanState.config);
    await this.servicing.recordEvent(tx, loanState, {
      type: 'TRADE_DISCOUNT_EARNED',
      amount: delta,
      businessDate,
      valueDate: asOf ?? businessDate,
      components: {
        invoiceId: inv.id,
        earned: delta.toString(),
        earnedToDate: target.toString(),
        discount: total.toString(),
      },
      idempotencyKey: `sys:trade-discount:${inv.id}:${randomUUID()}`,
      requestHash: 'system',
      actor,
      narrative: `Discount earned to ${asOf ?? 'settlement'} on ${inv.invoiceNumber}`,
      lines: [
        { accountCode: trade.unearnedDiscount, debit: delta.toString() },
        { accountCode: trade.discountIncome, credit: delta.toString() },
      ],
    });
    await this.casReceivable(tx, rec, { discountEarned: target.toString() });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async load(tx: Tx, tenantId: string, invoiceId: string) {
    const inv = await tx.tradeInvoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  private receivableOf(tx: Tx, tenantId: string, invoiceId: string) {
    return tx.tradeReceivable.findFirst({ where: { tenantId, invoiceId } });
  }

  /** Lock the facility's loan account, then read the invoice as committed. */
  private async locked(tx: Tx, tenantId: string, invoiceId: string) {
    const first = await this.load(tx, tenantId, invoiceId);
    const state = await loadFacilityState(tx, tenantId, first.facilityId);
    termsOf_(state);
    const inv = await this.load(tx, tenantId, invoiceId);
    return { inv, state };
  }

  private resource(
    state: FacilityState,
    inv: Invoice,
    makerIds: string[],
    amount?: string,
  ) {
    return resourceOf(state, makerIds.filter(Boolean), {
      workflowState: inv.status,
      amount: amount ?? decStr(inv.amount),
    });
  }

  /**
   * What funding the receivable today would put on the facility (`advance`)
   * and pay out, from the terms frozen on the invoice and receivable.
   */
  private priceOf(
    inv: Invoice,
    rec: Receivable | null,
    state: FacilityState,
    asOf: string,
  ) {
    const rounding = state.config.pricing.rounding;
    const face = decStr(inv.amount);
    if (rec && D(rec.discountRate).gt(0)) {
      const days =
        Math.max(0, lending.daysBetween(asOf, toLocalDate(inv.dueDate)!)) +
        rec.discountGraceDays;
      const d = engineCall(() =>
        lending.discountForDays(
          {
            faceAmount: face,
            annualRate: decStr(rec.discountRate),
            dayCountBasis: rec.dayCountBasis as 360 | 365,
            method: rec.discountMethod as lending.DiscountMethod,
          },
          days,
          rounding,
        ),
      );
      return {
        advance: face,
        paidOut: d.purchasePrice,
        serviceFee: '0',
        discount: d.discount,
        discountDays: days,
        explanation: d.explanation,
      };
    }
    if (rec && rec.kind === 'FACTORING') {
      const p = engineCall(() =>
        lending.factoringPurchase(
          {
            invoiceAmount: face,
            advanceRate: decStr(inv.advanceRate),
            serviceFeeRate: decStr(rec.serviceFeeRate),
          },
          rounding,
        ),
      );
      return {
        advance: p.advance,
        paidOut: p.paidToSeller,
        serviceFee: p.serviceFee,
        discount: '0',
        discountDays: 0,
        explanation: p.explanation,
      };
    }
    const advance = engineCall(
      () => lending.invoiceAdvance(termsOf(inv), rounding).advance,
    );
    return {
      advance,
      paidOut: advance,
      serviceFee: '0',
      discount: '0',
      discountDays: 0,
      explanation: `Advance ${decStr(inv.advanceRate)} × ${face} = ${advance}.`,
    };
  }

  /**
   * What must be true before a receivable is funded beyond the limit: the
   * acknowledgement the product requires, the debtor concentration limit
   * (factoring) and an active supplier within its sublimit (supply chain).
   */
  private async assertPurchasable(
    tx: Tx,
    state: FacilityState,
    inv: Invoice,
    rec: Receivable | null,
    advance: string,
  ) {
    if (!rec) return;
    const cfg = termsOf_(state);
    if (cfg.acknowledgement?.required && !rec.acknowledgedAt)
      throw new ConflictException({
        message: {
          DEBTOR_NOTICE:
            'Notify the debtor of the assignment before the invoice is bought.',
          BUYER_APPROVAL:
            'The buyer has not approved this invoice for payment.',
          AVAL: 'Record the bank aval on the instrument before it is bought.',
        }[rec.acknowledgementType as 'AVAL'],
        code: 'ACKNOWLEDGEMENT_REQUIRED',
      });
    const tenantId = inv.tenantId;
    if (cfg.maxDebtorConcentration !== null) {
      const live = await tx.tradeInvoice.findMany({
        where: {
          tenantId,
          facilityId: inv.facilityId,
          debtorKey: inv.debtorKey,
          status: { in: LIVE },
        },
        select: { advanceOutstanding: true },
      });
      const c = lending.debtorConcentration({
        limit: decStr(state.facility.limitAmount),
        debtorOutstanding: sum(live, (r) => r.advanceOutstanding),
        newAdvance: advance,
        maxShare: cfg.maxDebtorConcentration,
      });
      if (!c.ok)
        throw new BadRequestException({
          message: c.message,
          code: 'DEBTOR_CONCENTRATION',
        });
    }
    if (rec.supplierId) {
      const sup = await tx.tradeSupplier.findFirst({
        where: { id: rec.supplierId, tenantId },
      });
      if (!sup || sup.status !== 'ACTIVE')
        throw new ConflictException({
          message: `${inv.debtorName} is not an approved supplier on this programme.`,
          code: 'SUPPLIER_NOT_ACTIVE',
        });
      if (sup.sublimit) {
        const live = await tx.tradeReceivable.findMany({
          where: {
            tenantId,
            supplierId: sup.id,
            invoice: { status: { in: LIVE } },
          },
          select: { invoice: { select: { advanceOutstanding: true } } },
        });
        const after = D(sum(live, (r) => r.invoice.advanceOutstanding)).plus(
          D(advance),
        );
        if (after.gt(D(sup.sublimit)))
          throw new BadRequestException({
            message: `Paying this invoice would put ${after} outstanding on ${sup.name}, above its sublimit of ${decStr(sup.sublimit)}.`,
            code: 'SUPPLIER_SUBLIMIT',
          });
      }
    }
  }

  private assertDrawable(state: FacilityState, date: string, amount: string) {
    if (!['ACTIVE', 'PENDING'].includes(state.facility.status))
      throw new ConflictException(
        `This facility is ${state.facility.status.toLowerCase()}; no advance is possible.`,
      );
    const check = engineCall(() =>
      lending.checkDrawdown(state.terms, state.movements, {
        date,
        amount,
        satisfiedConditions: [],
      }),
    );
    if (!check.ok)
      throw new BadRequestException({
        message: check.issues.map((i) => i.message).join(' '),
        code: 'DRAWDOWN_REFUSED',
        issues: check.issues,
      });
  }

  private quoteOf(
    inv: Invoice,
    rec: Receivable | null,
    state: FacilityState,
    asOf: string,
  ) {
    const funded = [...LIVE, 'SETTLED', 'WRITTEN_OFF'].includes(inv.status);
    if (!funded) {
      const price =
        lending.compareDates(toLocalDate(inv.dueDate)!, asOf) >= 0
          ? this.priceOf(inv, rec, state, asOf)
          : null;
      return {
        asOf,
        advance: D(inv.advanceAmount).gt(0)
          ? decStr(inv.advanceAmount)
          : (price?.advance ?? '0'),
        // What funding it today would pay out, and what it would cost.
        paidOutIfFundedToday: price?.paidOut ?? null,
        serviceFee: price?.serviceFee ?? '0',
        discount: price?.discount ?? '0',
        discountDays: price?.discountDays ?? 0,
        feeToDate: '0',
        owed: '0',
        recourseDate: null,
        inRecourse: false,
      };
    }
    if (inv.status === 'WRITTEN_OFF')
      return {
        asOf,
        advance: decStr(inv.advanceAmount),
        feeToDate: decStr(inv.feeRaised),
        feeOwed: '0',
        advanceOwed: '0',
        owed: '0',
        writtenOff: decStr(rec?.writtenOff ?? 0),
        recourseDate: toLocalDate(inv.recourseDate),
        inRecourse: false,
        reserveOwedToBorrower: D(inv.reserveHeld)
          .minus(D(inv.reservePaid))
          .toString(),
      };
    const feeToDate = lending.invoiceFeeToDate(
      positionOf(inv),
      asOf,
      state.config.pricing.rounding,
    );
    const owed = D(feeToDate)
      .minus(D(inv.feePaid))
      .plus(D(inv.advanceOutstanding));
    const split =
      rec && ['RECOURSE', 'DEFAULTED'].includes(inv.status)
        ? lending.recourseSplit(
            rec.recourse as lending.RecourseType,
            owed.toString(),
            rec.recourseCap ? decStr(rec.recourseCap) : null,
            decStr(inv.collectedFromBorrower),
          )
        : null;
    return {
      asOf,
      advance: decStr(inv.advanceAmount),
      feeToDate,
      feeOwed: D(feeToDate).minus(D(inv.feePaid)).toString(),
      advanceOwed: decStr(inv.advanceOutstanding),
      owed: owed.toString(),
      // What the debtor would leave for the borrower by paying in full today.
      surplusIfDebtorPaysInFull: D(inv.amount)
        .minus(D(inv.collectedFromDebtor))
        .minus(owed)
        .toString(),
      recourseDate: toLocalDate(inv.recourseDate),
      inRecourse: inv.status === 'RECOURSE',
      defaulted: inv.status === 'DEFAULTED',
      // Once the obligor has defaulted: what the holder answers for, what the lender bears.
      holderOwes: split?.borrowerOwes ?? null,
      lenderBears: split?.lenderBears ?? null,
      discountEarned: decStr(rec?.discountEarned ?? 0),
      discountUnearned: D(rec?.discountAmount ?? 0)
        .minus(D(rec?.discountEarned ?? 0))
        .toString(),
      reserveOwedToBorrower: D(inv.reserveHeld)
        .minus(D(inv.reservePaid))
        .toString(),
    };
  }

  private async casInvoice(
    tx: Tx,
    inv: Invoice,
    fromStatus: string,
    data: Prisma.TradeInvoiceUpdateManyMutationInput,
  ) {
    const res = await tx.tradeInvoice.updateMany({
      where: {
        id: inv.id,
        tenantId: inv.tenantId,
        version: inv.version,
        status: fromStatus,
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) {
      const now = await tx.tradeInvoice.findFirst({
        where: { id: inv.id, tenantId: inv.tenantId },
        select: { status: true },
      });
      if (now && now.status !== fromStatus)
        throw new ConflictException(
          `This invoice is ${now.status.toLowerCase().replace(/_/g, ' ')}.`,
        );
      throw concurrentModification('This invoice');
    }
    inv.version += 1;
  }

  private async casReceivable(
    tx: Tx,
    rec: Receivable,
    data: Prisma.TradeReceivableUpdateManyMutationInput,
  ) {
    const res = await tx.tradeReceivable.updateMany({
      where: { id: rec.id, tenantId: rec.tenantId, version: rec.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This receivable');
    rec.version += 1;
    Object.assign(rec, data);
  }

  private async casFacility(
    tx: Tx,
    state: FacilityState,
    data: Prisma.FacilityUpdateManyMutationInput,
  ) {
    const res = await tx.facility.updateMany({
      where: {
        id: state.facility.id,
        tenantId: state.facility.tenantId,
        version: state.facility.version,
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This facility');
  }

  private async writeAudit(
    actor: LendingActor,
    tx: Tx,
    inv: Invoice,
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.write(
      {
        actor,
        action,
        resourceType: 'TradeInvoice',
        resourceId: inv.id,
        outcome: 'SUCCESS',
        details: {
          invoice: inv.reference,
          facility: inv.facilityId,
          ...details,
        },
      },
      tx,
    );
  }

  private async supplierAudit(
    actor: LendingActor,
    tx: Tx,
    sup: Supplier,
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.write(
      {
        actor,
        action,
        resourceType: 'TradeSupplier',
        resourceId: sup.id,
        outcome: 'SUCCESS',
        details: {
          supplier: sup.reference,
          facility: sup.facilityId,
          ...details,
        },
      },
      tx,
    );
  }
}

function termsOf_(state: FacilityState): RegisterTerms {
  const cfg = registerTerms(state.config);
  if (!cfg)
    throw new BadRequestException({
      message: 'This facility does not finance invoices or other receivables.',
      code: 'NOT_INVOICE_FACILITY',
    });
  return cfg;
}

/**
 * Everything still owed on a defaulted receivable, which a write-off takes
 * off the books. Under limited recourse the holder must have paid its cap
 * first: the write-off is only of what the lender bears.
 */
function writeOffAmount(inv: Invoice, rec: Receivable | null) {
  if (!rec)
    throw new BadRequestException({
      message:
        'Invoice finance is with full recourse to the borrower: its arrears are collected or written off with the facility.',
      code: 'NOT_A_BOUGHT_RECEIVABLE',
    });
  if (!['RECOURSE', 'DEFAULTED'].includes(inv.status))
    throw new ConflictException({
      message: `This receivable is ${inv.status.toLowerCase().replace(/_/g, ' ')}; only one in default is written off.`,
      code: 'NOT_IN_DEFAULT',
    });
  if (rec.recourse === 'LIMITED') {
    const left = D(rec.recourseCap).minus(D(inv.collectedFromBorrower));
    if (left.gt(0))
      throw new ConflictException({
        message: `The seller still answers for ${left} under limited recourse; collect it before writing off the rest.`,
        code: 'RECOURSE_OUTSTANDING',
      });
  }
  const owed = D(inv.advanceOutstanding)
    .plus(D(inv.feeRaised))
    .minus(D(inv.feePaid));
  if (owed.lte(0))
    throw new ConflictException('Nothing is owed on this receivable.');
  return owed;
}

export function tradeAccounts(config: lending.ProductConfig) {
  const a = config.trade?.accounts;
  return {
    reservePayable: a?.reservePayable ?? '2310',
    lcContingentAsset: a?.lcContingentAsset ?? '9100',
    lcContingentLiability: a?.lcContingentLiability ?? '9200',
    unearnedDiscount: a?.unearnedDiscount ?? '2340',
    discountIncome: a?.discountIncome ?? '4530',
    serviceFeeIncome: a?.serviceFeeIncome ?? '4540',
    creditLoss: a?.creditLoss ?? '5500',
  };
}

/** The terms frozen on the invoice, never the live product. */
function termsOf(inv: Invoice): lending.InvoiceTerms {
  return {
    invoiceAmount: decStr(inv.amount),
    advanceRate: decStr(inv.advanceRate),
    feeRatePerPeriod: decStr(inv.feeRatePerPeriod),
    feePeriodDays: inv.feePeriodDays,
    feeBasis: inv.feeBasis as lending.InvoiceTerms['feeBasis'],
  };
}

function positionOf(inv: Invoice): lending.InvoicePosition {
  return {
    terms: termsOf(inv),
    advanceDate: toLocalDate(inv.advanceDate)!,
    advanceOutstanding: decStr(inv.advanceOutstanding),
    feeRaised: decStr(inv.feeRaised),
    feePaid: decStr(inv.feePaid),
    // The fee runs to the recourse date at most (DECISIONS D-025), whether or
    // not the end-of-day batch has yet moved the invoice into recourse.
    recourseDate: toLocalDate(inv.recourseDate),
  };
}

function nonZero(lines: PostingLine[]): PostingLine[] {
  return lines.filter(
    (l) => D(l.debit ?? '0').gt(0) || D(l.credit ?? '0').gt(0),
  );
}

function sum<T>(rows: T[], pick: (r: T) => unknown): string {
  return rows
    .reduce((t, r) => t.plus(D(pick(r) as string)), new lending.D(0))
    .toString();
}

function normalizeDebtor(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 160);
}

/** Decimals as strings, dates as YYYY-MM-DD. */
function plain<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out))
    if (v && typeof v === 'object' && 'toFixed' in v && !(v instanceof Date))
      out[k] = (v as { toString(): string }).toString();
  return out;
}

function receivableView(rec: Receivable | null) {
  if (!rec) return null;
  return {
    ...plain(rec),
    discountUnearned: D(rec.discountAmount)
      .minus(D(rec.discountEarned))
      .toString(),
  };
}

function supplierView(s: Supplier) {
  return plain(s);
}

function view(inv: Invoice & { receivable?: unknown }, rec: Receivable | null) {
  const { receivable: _omit, ...row } = inv;
  void _omit;
  const writtenOff = inv.status === 'WRITTEN_OFF';
  return {
    ...plain(row),
    kind: rec?.kind ?? 'INVOICE_FINANCE',
    issueDate: toLocalDate(inv.issueDate),
    dueDate: toLocalDate(inv.dueDate),
    advanceDate: toLocalDate(inv.advanceDate),
    recourseDate: toLocalDate(inv.recourseDate),
    reserveOwed: D(inv.reserveHeld).minus(D(inv.reservePaid)).toString(),
    feeOwed: writtenOff
      ? '0'
      : D(inv.feeRaised).minus(D(inv.feePaid)).toString(),
    receivable: receivableView(rec),
  };
}
