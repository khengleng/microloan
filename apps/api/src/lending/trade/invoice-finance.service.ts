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

type Json = Prisma.InputJsonValue;
type Invoice = NonNullable<
  Awaited<ReturnType<Tx['tradeInvoice']['findFirst']>>
>;
type InvoiceConfig = NonNullable<
  NonNullable<lending.ProductConfig['trade']>['invoice']
>;

const RESERVE_PAYOUT = 'INVOICE_RESERVE_PAYOUT';

/**
 * Invoice financing (LT-18) with recourse to the borrower (UC-67).
 *
 * An invoice-finance facility is a revolving limit drawn only by advances
 * against approved invoices. Each invoice is registered (maker), approved as
 * eligible (checker), and advanced at the product's advance rate under the
 * same request → approve → release governance as any drawdown; the release
 * posts a DISBURSEMENT on the facility's loan account, so the limit, the
 * general ledger and reconciliation see it exactly as a drawdown.
 *
 * When money comes in for an invoice — from the debtor, or from the borrower
 * once recourse applies — the fee for the days outstanding is raised, and
 * the money clears the fee, then the advance; any surplus is the borrower's
 * reserve, held as a liability until it is paid out under maker-checker.
 *
 * If the debtor has not paid by the due date plus the product's grace days,
 * the end-of-day batch puts the invoice into RECOURSE: the fee stops at that
 * date, and the advance and fee are owed by the borrower and age as arrears
 * on the facility (days past due, buckets, collection stages).
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

  async list(actor: LendingActor, facilityId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, facilityId, {
        lock: false,
      });
      await this.policy.enforce(actor, 'facility.read', resourceOf(state), tx);
      const cfg = state.config.trade?.invoice ?? null;
      const asOf = await this.businessDate.get(tenantId, tx);
      const rows = await tx.tradeInvoice.findMany({
        where: { tenantId, facilityId },
        orderBy: { createdAt: 'desc' },
      });
      const position = engineCall(() =>
        lending.facilityPosition(state.terms, state.movements, asOf),
      );
      const sum = (pick: (i: Invoice) => unknown, statuses?: string[]) =>
        rows
          .filter((r) => !statuses || statuses.includes(r.status))
          .reduce((t, r) => t.plus(D(pick(r) as string)), new lending.D(0))
          .toString();
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
        terms: cfg,
        position,
        summary: {
          invoices: rows.length,
          advancedOutstanding: sum((r) => r.advanceOutstanding),
          feesOutstanding: rows
            .reduce(
              (t, r) => t.plus(D(r.feeRaised)).minus(D(r.feePaid)),
              new lending.D(0),
            )
            .toString(),
          inRecourse: rows.filter((r) => r.status === 'RECOURSE').length,
          reserveOwedToBorrower: rows
            .reduce(
              (t, r) => t.plus(D(r.reserveHeld)).minus(D(r.reservePaid)),
              new lending.D(0),
            )
            .toString(),
        },
        invoices: rows.map(view),
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
      const [collections, tasks] = await Promise.all([
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
      ]);
      return {
        invoice: view(inv),
        quote: this.quoteOf(inv, state, asOf),
        facility: {
          id: state.facility.id,
          reference: state.facility.reference,
          loanAccountId: state.account.id,
        },
        collections: collections.map((c) => ({
          ...plain(c),
          valueDate: toLocalDate(c.valueDate),
        })),
        reservePayouts: tasks.map((t) => plain(t)),
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
      return this.quoteOf(inv, state, date);
    });
  }

  // ── Register and approve ──────────────────────────────────────────────────

  async register(
    actor: LendingActor,
    facilityId: string,
    body: {
      debtorName: string;
      debtorReference?: string;
      invoiceNumber: string;
      amount: string;
      issueDate: string;
      dueDate: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadFacilityState(tx, tenantId, facilityId);
      const cfg = invoiceConfig(state);
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
          message: `This product finances invoices of at most ${cfg.maxInvoiceTenorDays} days; this one runs ${tenor}.`,
          code: 'INVOICE_TENOR',
        });
      const debtorKey = normalizeDebtor(body.debtorName);
      if (!debtorKey) throw new BadRequestException('Name the debtor.');
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
          message: `Invoice ${invoiceNumber} from ${body.debtorName.trim()} is already registered (${duplicate.reference}, ${duplicate.status.toLowerCase()}); an invoice is financed once.`,
          code: 'INVOICE_DUPLICATE',
        });
      const row = await tx.tradeInvoice.create({
        data: {
          tenantId,
          facilityId,
          loanAccountId: state.account.id,
          borrowerId: state.facility.borrowerId,
          branchId: state.facility.branchId,
          reference: newReference('INV'),
          debtorName: body.debtorName.trim().slice(0, 160),
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
      await this.writeAudit(actor, tx, row, 'trade.invoice.register', {
        amount: amount.toString(),
        debtor: row.debtorName,
        invoiceNumber: row.invoiceNumber,
        dueDate: body.dueDate,
      });
      return view(row);
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
      const advance = this.advanceOf(inv, state);
      await this.policy.enforce(
        actor,
        'trade.invoice.advance.request',
        this.resource(state, inv, [], advance),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      if (lending.compareDates(toLocalDate(inv.dueDate)!, businessDate) < 0)
        throw new ConflictException({
          message: `The invoice fell due on ${toLocalDate(inv.dueDate)}; it can no longer be financed.`,
          code: 'INVOICE_OVERDUE',
        });
      this.assertDrawable(state, businessDate, advance);
      await this.casInvoice(tx, inv, 'APPROVED', {
        status: 'ADVANCE_REQUESTED',
        advanceAmount: advance,
        advanceRequestedBy: actor.id,
      });
      await this.writeAudit(actor, tx, inv, 'trade.invoice.advance.request', {
        advance,
      });
      return { id: invoiceId, status: 'ADVANCE_REQUESTED', advance };
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
   * Pay the advance to the borrower: a DISBURSEMENT on the facility's loan
   * account, exactly as a released drawdown posts.
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
      this.assertDrawable(state, businessDate, amount.toString());
      const loanState = await loadLoanState(tx, tenantId, state.account.id, {
        lock: false,
      });
      const acct = state.config.accounting;
      const event = await this.servicing.recordEvent(tx, loanState, {
        type: 'DISBURSEMENT',
        amount,
        businessDate,
        valueDate: businessDate,
        components: {
          facilityId: state.facility.id,
          invoiceId,
          invoice: inv.reference,
          invoiceAmount: decStr(inv.amount),
          advanceRate: decStr(inv.advanceRate),
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Advance on invoice ${inv.invoiceNumber} (${inv.debtorName}) under ${state.facility.reference}`,
        externalReference: body.externalReference.trim().slice(0, 120),
        lines: [
          { accountCode: acct.loansReceivable, debit: amount.toString() },
          { accountCode: acct.cash, credit: amount.toString() },
        ],
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
      await this.servicing.outbox(
        tx,
        tenantId,
        'lending.trade.invoice_advanced',
        {
          invoiceId,
          facilityId: state.facility.id,
          eventId: event.id,
          amount: amount.toString(),
          currency: inv.currency,
        },
      );
      await this.writeAudit(actor, tx, inv, 'trade.invoice.advance.release', {
        event: event.id,
        amount: amount.toString(),
        recourseDate,
      });
      return {
        id: invoiceId,
        status: 'FUNDED',
        eventId: event.id,
        advance: amount.toString(),
        recourseDate,
      };
    });
  }

  // ── Collections ───────────────────────────────────────────────────────────

  /**
   * Money received for an invoice: from the debtor (TV-20), or from the
   * borrower under recourse (UC-67).
   *
   * Posted as up to three events in one transaction: the fee raised to date
   * (ACCRUAL), the receipt itself (INVOICE_COLLECTION — the fee collected
   * and any reserve now owed to the borrower) and the advance repaid
   * (REPAYMENT, which is what reinstates the revolving limit).
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
      if (body.source === 'BORROWER' && inv.status === 'SETTLED')
        throw new ConflictException(
          'Nothing is owed on this invoice; the borrower has nothing to repay.',
        );
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

  // ── Recourse (UC-67): end-of-day ──────────────────────────────────────────

  /**
   * On an invoice facility's loan account: put every funded invoice whose
   * recourse date has passed into RECOURSE (fee raised to that date), and
   * report the days past due of the oldest unpaid one, so the batch ages
   * the facility exactly as it ages a missed instalment.
   */
  private async recourseHook(
    tx: Tx,
    state: LoanState,
    businessDate: string,
    actor: LendingActor,
  ) {
    if (!state.config.trade?.invoice) return;
    const tenantId = state.account.tenantId;
    const facility = await tx.facility.findFirst({
      where: { tenantId, agreementId: state.account.agreementId },
      select: { id: true },
    });
    if (!facility) return;
    const due = await tx.tradeInvoice.findMany({
      where: {
        tenantId,
        facilityId: facility.id,
        status: 'FUNDED',
        recourseDate: { lt: fromLocalDate(businessDate) },
      },
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
      await this.casInvoice(tx, inv, 'FUNDED', {
        status: 'RECOURSE',
        recourseAt: new Date(),
        feeRaised: D(inv.feeRaised)
          .plus(raise.gt(0) ? raise : 0)
          .toString(),
      });
      await this.audit.write(
        {
          actor,
          action: 'trade.invoice.recourse',
          resourceType: 'TradeInvoice',
          resourceId: inv.id,
          outcome: 'SUCCESS',
          details: {
            recourseDate,
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
        'lending.trade.invoice_recourse',
        {
          invoiceId: inv.id,
          borrowerId: inv.borrowerId,
          recourseDate,
        },
      );
    }
    const unpaid = await tx.tradeInvoice.findMany({
      where: { tenantId, facilityId: facility.id, status: 'RECOURSE' },
      select: { recourseDate: true },
      orderBy: { recourseDate: 'asc' },
    });
    const oldest = unpaid[0]?.recourseDate;
    if (oldest) {
      const dpd = lending.daysBetween(toLocalDate(oldest)!, businessDate);
      state.externalDpd = Math.max(state.externalDpd ?? 0, dpd);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async load(tx: Tx, tenantId: string, invoiceId: string) {
    const inv = await tx.tradeInvoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  /** Lock the facility's loan account, then read the invoice as committed. */
  private async locked(tx: Tx, tenantId: string, invoiceId: string) {
    const first = await this.load(tx, tenantId, invoiceId);
    const state = await loadFacilityState(tx, tenantId, first.facilityId);
    invoiceConfig(state);
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

  private advanceOf(inv: Invoice, state: FacilityState): string {
    return engineCall(
      () =>
        lending.invoiceAdvance(termsOf(inv), state.config.pricing.rounding)
          .advance,
    );
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

  private quoteOf(inv: Invoice, state: FacilityState, asOf: string) {
    const funded = ['FUNDED', 'RECOURSE', 'SETTLED'].includes(inv.status);
    const advance =
      funded || D(inv.advanceAmount).gt(0)
        ? decStr(inv.advanceAmount)
        : this.advanceOf(inv, state);
    if (!funded)
      return {
        asOf,
        advance,
        feeToDate: '0',
        owed: '0',
        recourseDate: null,
        inRecourse: false,
      };
    const feeToDate = lending.invoiceFeeToDate(
      positionOf(inv),
      asOf,
      state.config.pricing.rounding,
    );
    const owed = D(feeToDate)
      .minus(D(inv.feePaid))
      .plus(D(inv.advanceOutstanding));
    return {
      asOf,
      advance,
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
}

function invoiceConfig(state: FacilityState): InvoiceConfig {
  const cfg = state.config.trade?.invoice;
  if (!cfg)
    throw new BadRequestException({
      message: 'This facility does not finance invoices.',
      code: 'NOT_INVOICE_FACILITY',
    });
  return cfg;
}

export function tradeAccounts(config: lending.ProductConfig) {
  return {
    reservePayable: config.trade?.accounts?.reservePayable ?? '2310',
    lcContingentAsset: config.trade?.accounts?.lcContingentAsset ?? '9100',
    lcContingentLiability:
      config.trade?.accounts?.lcContingentLiability ?? '9200',
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

function view(inv: Invoice) {
  return {
    ...plain(inv),
    issueDate: toLocalDate(inv.issueDate),
    dueDate: toLocalDate(inv.dueDate),
    advanceDate: toLocalDate(inv.advanceDate),
    recourseDate: toLocalDate(inv.recourseDate),
    reserveOwed: D(inv.reserveHeld).minus(D(inv.reservePaid)).toString(),
    feeOwed: D(inv.feeRaised).minus(D(inv.feePaid)).toString(),
  };
}
