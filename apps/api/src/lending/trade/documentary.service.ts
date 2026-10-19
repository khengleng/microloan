import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { LoanState, loadLoanState, resourceOf } from '../servicing/loan-state';
import { ApplicationsService } from '../origination/applications.service';

type Transaction = NonNullable<
  Awaited<ReturnType<Tx['tradeTransaction']['findFirst']>>
>;
type Document = NonNullable<
  Awaited<ReturnType<Tx['tradeDocument']['findFirst']>>
>;
type DocumentaryConfig = NonNullable<
  NonNullable<lending.ProductConfig['trade']>['documentary']
>;

/** Plain-language names of the documents the templates ask for. */
export const TRADE_DOCUMENT_LABELS: Record<string, string> = {
  COMMERCIAL_INVOICE: 'Commercial invoice',
  BILL_OF_LADING: 'Bill of lading / air waybill',
  PACKING_LIST: 'Packing list',
  INSURANCE_CERTIFICATE: 'Insurance certificate',
  CERTIFICATE_OF_ORIGIN: 'Certificate of origin',
  CUSTOMS_DECLARATION: 'Customs declaration',
  EXPORT_CONTRACT: 'Export sales contract / purchase order',
  PROFORMA_INVOICE: 'Proforma invoice',
  EXPORT_LICENCE: 'Export licence',
  LETTER_OF_CREDIT: 'Letter of credit in the exporter’s favour',
};

/**
 * Documentary trade loans (import loans and export working capital).
 *
 * A documentary loan is an ordinary term loan — originated, approved, booked
 * and serviced like any other — tied to the one trade transaction it
 * finances:
 *
 *  • the trade is recorded on the booked loan: the counterparty, the goods,
 *    the transaction value, when the cycle starts (shipment for an import,
 *    the contract for an export) and when the proceeds are expected;
 *  • the product's document checklist is created with it; each document is
 *    received by one person and verified by another, and the loan cannot be
 *    paid out (a disbursement guard, at prepare and at execute) until every
 *    required document is verified;
 *  • the amount must be within the product's financing ratio of the
 *    transaction, the trade cycle within its maximum, and the loan must
 *    mature by the expected proceeds date plus grace — checked when the
 *    trade is recorded and again at disbursement;
 *  • the proceeds repay it: proceeds that cover the payoff settle the loan
 *    (early settlement, interest to date) and the rest is passed to the
 *    customer; less is posted as a repayment.
 */
@Injectable()
export class DocumentaryTradeService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
    private readonly applications: ApplicationsService,
  ) {
    this.servicing.registerDisbursementGuard((tx, state) =>
      this.guard(tx, state),
    );
    this.servicing.registerDisbursementHook(async (tx, ctx) => {
      if (!ctx.state.config.trade?.documentary) return;
      const tenantId = ctx.state.account.tenantId;
      return async () => {
        await tx.tradeTransaction.updateMany({
          where: {
            tenantId,
            loanAccountId: ctx.state.account.id,
            status: 'OPEN',
          },
          data: { status: 'FINANCED', version: { increment: 1 } },
        });
      };
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * Documentary loans the actor can see: each recorded trade, and booked
   * loans under a documentary product still waiting for theirs.
   */
  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    if (!scope) return { data: [], awaitingTrade: [] };
    return this.lp.tenantTx(tenantId, async (tx) => {
      const rows = await tx.tradeTransaction.findMany({
        where: {
          tenantId,
          loanAccount: scope as Prisma.LoanAccountWhereInput,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          documents: { select: { status: true } },
          loanAccount: {
            select: {
              reference: true,
              status: true,
              principalOutstanding: true,
              bookedPrincipal: true,
            },
          },
        },
      });
      const products = await tx.lendingProduct.findMany({
        where: { tenantId },
        select: {
          id: true,
          versions: { select: { id: true, config: true } },
        },
      });
      const documentaryVersions = products.flatMap((p) =>
        p.versions
          .filter(
            (v) =>
              !!(v.config as lending.ProductConfig | null)?.trade?.documentary,
          )
          .map((v) => v.id),
      );
      const awaiting = documentaryVersions.length
        ? await tx.loanAccount.findMany({
            where: {
              tenantId,
              status: 'BOOKED',
              productVersionId: { in: documentaryVersions },
              tradeTransaction: { is: null },
              ...(scope as Prisma.LoanAccountWhereInput),
            },
            select: {
              id: true,
              reference: true,
              bookedPrincipal: true,
              currency: true,
            },
            take: 100,
          })
        : [];
      return {
        data: rows.map((r) => ({
          ...transactionView(r),
          loan: {
            reference: r.loanAccount.reference,
            status: r.loanAccount.status,
            principalOutstanding: decStr(r.loanAccount.principalOutstanding),
            bookedPrincipal: decStr(r.loanAccount.bookedPrincipal),
          },
          documentsVerified: r.documents.filter((d) => d.status === 'VERIFIED')
            .length,
          documents: r.documents.length,
        })),
        awaitingTrade: awaiting.map((a) => ({
          loanAccountId: a.id,
          reference: a.reference,
          bookedPrincipal: decStr(a.bookedPrincipal),
          currency: a.currency,
        })),
      };
    });
  }

  /** The loan's trade, its checklist, the checks and the proceeds so far. */
  async get(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(
        actor,
        'trade.documentary.read',
        resourceOf(state),
        tx,
      );
      const cfg = documentaryConfig(state);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const trx = await tx.tradeTransaction.findFirst({
        where: { tenantId, loanAccountId: loanId },
      });
      const [documents, proceeds] = trx
        ? await Promise.all([
            tx.tradeDocument.findMany({
              where: { tenantId, transactionId: trx.id },
              orderBy: { createdAt: 'asc' },
            }),
            tx.tradeProceeds.findMany({
              where: { tenantId, transactionId: trx.id },
              orderBy: { createdAt: 'asc' },
            }),
          ])
        : [[], []];
      let payoff: string | null = null;
      if (state.account.status === 'ACTIVE') {
        try {
          payoff = (await this.servicing.quote(tx, state, businessDate))
            .payable;
        } catch {
          payoff = null;
        }
      }
      return {
        loan: {
          id: state.account.id,
          reference: state.account.reference,
          status: state.account.status,
          currency: state.account.currency,
          bookedPrincipal: decStr(state.account.bookedPrincipal),
          principalOutstanding: decStr(state.account.principalOutstanding),
          maturityDate: await this.maturity(
            tx,
            state,
            state.account.status === 'BOOKED'
              ? businessDate
              : (toLocalDate(state.account.disbursementDate) ?? businessDate),
          ),
          payoff,
        },
        terms: {
          ...cfg,
          documentLabels: Object.fromEntries(
            cfg.requiredDocuments.map((c) => [c, labelOf(c)]),
          ),
        },
        businessDate,
        transaction: trx ? transactionView(trx) : null,
        documents: documents.map((d) => documentView(d, cfg)),
        proceeds: proceeds.map((p) => ({
          ...plain(p),
          valueDate: toLocalDate(p.valueDate),
        })),
        checks: trx
          ? await this.checks(tx, state, cfg, trx, documents, businessDate)
          : null,
      };
    });
  }

  // ── Record the trade ──────────────────────────────────────────────────────

  async record(
    actor: LendingActor,
    loanId: string,
    body: {
      counterpartyName: string;
      counterpartyCountry?: string;
      goodsDescription: string;
      transactionValue: string;
      cycleStartDate: string;
      expectedProceedsDate: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const cfg = documentaryConfig(state);
      await this.policy.enforce(
        actor,
        'trade.documentary.manage',
        resourceOf(state),
        tx,
      );
      if (state.account.status !== 'BOOKED')
        throw new ConflictException(
          'The trade is recorded before the loan is paid out.',
        );
      if (
        await tx.tradeTransaction.findFirst({
          where: { tenantId, loanAccountId: loanId },
        })
      )
        throw new ConflictException(
          'This loan already finances a trade transaction.',
        );
      const value = engineCall(() =>
        lending.parseMoney(
          body.transactionValue,
          state.account.currency,
          'transactionValue',
        ),
      );
      lending.parseDate(body.cycleStartDate, 'cycleStartDate');
      lending.parseDate(body.expectedProceedsDate, 'expectedProceedsDate');
      const businessDate = await this.businessDate.get(tenantId, tx);
      const check = await this.cycleCheck(
        tx,
        state,
        cfg,
        {
          transactionValue: value.toString(),
          cycleStartDate: body.cycleStartDate,
          expectedProceedsDate: body.expectedProceedsDate,
        },
        state.contract.disbursementDate ?? businessDate,
      );
      if (!check.ok)
        throw new BadRequestException({
          message: check.issues.map((i) => i.message).join(' '),
          code: check.issues[0].code,
          issues: check.issues,
        });
      const trx = await tx.tradeTransaction.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          borrowerId: state.account.borrowerId,
          branchId: state.account.branchId,
          reference: newReference(cfg.direction === 'IMPORT' ? 'IMP' : 'EXP'),
          direction: cfg.direction,
          counterpartyName: body.counterpartyName.trim().slice(0, 160),
          counterpartyCountry:
            body.counterpartyCountry?.trim().toUpperCase().slice(0, 2) || null,
          goodsDescription: body.goodsDescription.trim().slice(0, 500),
          currency: state.account.currency,
          transactionValue: value.toString(),
          cycleStartDate: fromLocalDate(body.cycleStartDate),
          expectedProceedsDate: fromLocalDate(body.expectedProceedsDate),
          createdBy: actor.id,
        },
      });
      await tx.tradeDocument.createMany({
        data: cfg.requiredDocuments.map((code) => ({
          tenantId,
          transactionId: trx.id,
          code,
        })),
      });
      await this.writeAudit(actor, tx, trx, 'trade.documentary.manage', {
        step: 'record',
        value: value.toString(),
        expectedProceedsDate: body.expectedProceedsDate,
      });
      return transactionView(trx);
    });
  }

  // ── Documents: received (maker) → verified or rejected (checker) ──────────

  async receiveDocument(
    actor: LendingActor,
    transactionId: string,
    body: { code: string; reference: string; description?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { trx, state } = await this.locked(tx, tenantId, transactionId);
      const cfg = documentaryConfig(state);
      await this.policy.enforce(
        actor,
        'trade.documentary.manage',
        resourceOf(state),
        tx,
      );
      if (['SETTLED', 'CANCELLED'].includes(trx.status))
        throw new ConflictException(
          `This trade is ${trx.status.toLowerCase()}.`,
        );
      if (!body.reference?.trim())
        throw new BadRequestException(
          'Record the document’s own number or reference.',
        );
      const existing = await tx.tradeDocument.findFirst({
        where: { tenantId, transactionId, code: body.code },
      });
      const data = {
        status: 'RECEIVED',
        reference: body.reference.trim().slice(0, 120),
        description: body.description?.trim().slice(0, 500) || null,
        receivedBy: actor.id,
        receivedAt: new Date(),
        verifiedBy: null,
        verifiedAt: null,
        rejectionReason: null,
      };
      let doc: Document;
      if (existing) {
        if (existing.status === 'VERIFIED')
          throw new ConflictException(
            `${labelOf(body.code)} is already verified.`,
          );
        if (existing.status === 'RECEIVED')
          throw new ConflictException(
            `${labelOf(body.code)} is already received and awaiting verification.`,
          );
        const res = await tx.tradeDocument.updateMany({
          where: {
            id: existing.id,
            tenantId,
            version: existing.version,
            status: existing.status,
          },
          data: { ...data, version: { increment: 1 } },
        });
        if (res.count !== 1) throw concurrentModification('This document');
        doc = (await tx.tradeDocument.findFirst({
          where: { id: existing.id, tenantId },
        }))!;
      } else {
        // A document the product does not require can still be kept on file.
        doc = await tx.tradeDocument.create({
          data: { tenantId, transactionId, code: body.code, ...data },
        });
      }
      await this.writeAudit(actor, tx, trx, 'trade.documentary.manage', {
        step: 'receive',
        document: body.code,
        reference: body.reference,
      });
      return documentView(doc, cfg);
    });
  }

  async decideDocument(
    actor: LendingActor,
    documentId: string,
    decision: 'VERIFY' | 'REJECT',
    reason?: string,
  ) {
    const tenantId = requireTenant(actor);
    if (decision === 'REJECT' && !reason?.trim())
      throw new BadRequestException('Say why the document is rejected.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const first = await tx.tradeDocument.findFirst({
        where: { id: documentId, tenantId },
      });
      if (!first) throw new NotFoundException('Document not found');
      const { trx, state } = await this.locked(
        tx,
        tenantId,
        first.transactionId,
      );
      const cfg = documentaryConfig(state);
      const doc = (await tx.tradeDocument.findFirst({
        where: { id: documentId, tenantId },
      }))!;
      // The person who received a document never verifies or rejects it.
      await this.policy.enforce(
        actor,
        'trade.documentary.verify',
        resourceOf(state, [doc.receivedBy ?? '']),
        tx,
      );
      if (doc.status !== 'RECEIVED')
        throw new ConflictException(
          `${labelOf(doc.code)} is ${doc.status.toLowerCase()}; only a received document is verified or rejected.`,
        );
      const res = await tx.tradeDocument.updateMany({
        where: {
          id: doc.id,
          tenantId,
          version: doc.version,
          status: 'RECEIVED',
        },
        data: {
          version: { increment: 1 },
          ...(decision === 'VERIFY'
            ? {
                status: 'VERIFIED',
                verifiedBy: actor.id,
                verifiedAt: new Date(),
              }
            : { status: 'REJECTED', rejectionReason: reason!.slice(0, 500) }),
        },
      });
      if (res.count !== 1) throw concurrentModification('This document');
      await this.writeAudit(actor, tx, trx, 'trade.documentary.verify', {
        document: doc.code,
        decision,
        reason,
      });
      const now = (await tx.tradeDocument.findFirst({
        where: { id: doc.id, tenantId },
      }))!;
      return documentView(now, cfg);
    });
  }

  // ── Proceeds ──────────────────────────────────────────────────────────────

  /**
   * Trade proceeds received: they repay the loan. If they cover the payoff
   * the loan is settled (interest to date, the product's settlement terms)
   * and the rest is passed to the customer; otherwise they are posted as a
   * repayment.
   */
  async postProceeds(
    actor: LendingActor,
    transactionId: string,
    body: {
      amount: string;
      payerName: string;
      externalReference?: string;
      remitReference?: string;
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'trade.proceeds', transactionId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const { trx, state } = await this.locked(tx, tenantId, transactionId);
      documentaryConfig(state);
      const amount = engineCall(() =>
        lending.parseMoney(String(body.amount ?? ''), trx.currency, 'amount'),
      );
      await this.policy.enforce(
        actor,
        'trade.documentary.proceeds',
        resourceOf(state, [], amount.toString()),
        tx,
      );
      if (trx.status !== 'FINANCED')
        throw new ConflictException(
          `This trade is ${trx.status.toLowerCase()}; proceeds repay a financed trade.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const q = await this.servicing.quote(tx, state, businessDate);
      const split = engineCall(() =>
        lending.proceedsApplication(amount.toString(), q.payable),
      );
      if (
        split.settles &&
        split.remitted !== '0' &&
        !body.remitReference?.trim()
      )
        throw new BadRequestException({
          message: `The proceeds exceed the payoff of ${q.payable} ${trx.currency}; record the reference of the ${split.remitted} passed to the customer.`,
          code: 'PROCEEDS_REMIT_REFERENCE',
        });
      const ref = body.externalReference?.trim().slice(0, 120) || undefined;
      if (split.settles)
        await this.servicing.settleInTx(
          tx,
          actor,
          state.account.id,
          { amount: q.payable, externalReference: ref },
          idempotencyKey,
          hash,
        );
      else
        await this.servicing.repayInTx(
          tx,
          actor,
          state.account.id,
          {
            amount: amount.toString(),
            externalReference: ref,
            payer: {
              name: body.payerName.trim().slice(0, 160),
              relationship: 'TRADE_PROCEEDS',
              ...(ref ? { reference: ref } : {}),
            },
          },
          idempotencyKey,
          hash,
        );
      const event = await tx.financialEvent.findFirst({
        where: { tenantId, idempotencyKey },
        select: { id: true },
      });
      const after = await tx.loanAccount.findFirst({
        where: { id: state.account.id, tenantId },
        select: { status: true },
      });
      await tx.tradeProceeds.create({
        data: {
          tenantId,
          transactionId,
          eventId: event!.id,
          amount: amount.toString(),
          applied: split.applied,
          remitted: split.remitted,
          settled: after?.status === 'CLOSED',
          payerName: body.payerName.trim().slice(0, 160),
          externalReference: ref ?? null,
          remitReference: body.remitReference?.trim().slice(0, 120) || null,
          valueDate: fromLocalDate(businessDate),
          createdBy: actor.id,
        },
      });
      const res = await tx.tradeTransaction.updateMany({
        where: { id: trx.id, tenantId, version: trx.version },
        data: {
          version: { increment: 1 },
          proceedsReceived: D(trx.proceedsReceived).plus(amount).toString(),
          proceedsApplied: D(trx.proceedsApplied)
            .plus(D(split.applied))
            .toString(),
          proceedsRemitted: D(trx.proceedsRemitted)
            .plus(D(split.remitted))
            .toString(),
          ...(after?.status === 'CLOSED' ? { status: 'SETTLED' } : {}),
        },
      });
      if (res.count !== 1) throw concurrentModification('This trade');
      await this.writeAudit(actor, tx, trx, 'trade.documentary.proceeds', {
        event: event!.id,
        amount: amount.toString(),
        applied: split.applied,
        remitted: split.remitted,
        settled: after?.status === 'CLOSED',
      });
      return {
        eventId: event!.id,
        applied: split.applied,
        remitted: split.remitted,
        payoff: q.payable,
        settled: after?.status === 'CLOSED',
        loanStatus: after?.status,
      };
    });
  }

  // ── Disbursement guard ────────────────────────────────────────────────────

  /** No payout until the trade is recorded, documented and still fits. */
  private async guard(tx: Tx, state: LoanState) {
    const cfg = state.config.trade?.documentary;
    if (!cfg) return;
    const tenantId = state.account.tenantId;
    const trx = await tx.tradeTransaction.findFirst({
      where: { tenantId, loanAccountId: state.account.id },
    });
    if (!trx)
      throw new ConflictException({
        message:
          'Record the trade this loan finances, and its documents, before paying it out.',
        code: 'TRADE_NOT_RECORDED',
      });
    const documents = await tx.tradeDocument.findMany({
      where: { tenantId, transactionId: trx.id },
    });
    const businessDate = await this.businessDate.get(tenantId, tx);
    const c = await this.checks(tx, state, cfg, trx, documents, businessDate);
    if (!c.documents.complete)
      throw new ConflictException({
        message: `The trade documents are not complete: ${[
          ...c.documents.missing.map((m) => `${labelOf(m)} missing`),
          ...c.documents.unverified.map((m) => `${labelOf(m)} not verified`),
        ].join('; ')}.`,
        code: 'TRADE_DOCUMENTS_INCOMPLETE',
        ...c.documents,
      });
    if (!c.cycle.ok)
      throw new ConflictException({
        message: c.cycle.issues.map((i) => i.message).join(' '),
        code: c.cycle.issues[0].code,
        issues: c.cycle.issues,
      });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async checks(
    tx: Tx,
    state: LoanState,
    cfg: DocumentaryConfig,
    trx: Transaction,
    documents: Document[],
    businessDate: string,
  ) {
    const financeDate =
      state.account.status === 'BOOKED'
        ? businessDate
        : (toLocalDate(state.account.disbursementDate) ?? businessDate);
    return {
      documents: lending.documentChecklist(cfg.requiredDocuments, documents),
      cycle: await this.cycleCheck(
        tx,
        state,
        cfg,
        {
          transactionValue: decStr(trx.transactionValue),
          cycleStartDate: toLocalDate(trx.cycleStartDate)!,
          expectedProceedsDate: toLocalDate(trx.expectedProceedsDate)!,
        },
        financeDate,
      ),
    };
  }

  private async cycleCheck(
    tx: Tx,
    state: LoanState,
    cfg: DocumentaryConfig,
    t: {
      transactionValue: string;
      cycleStartDate: string;
      expectedProceedsDate: string;
    },
    financeDate: string,
  ) {
    const maturityDate =
      (await this.maturity(tx, state, financeDate)) ?? financeDate;
    return engineCall(() =>
      lending.checkTradeCycle(
        {
          maxTradeCycleDays: cfg.maxTradeCycleDays,
          proceedsGraceDays: cfg.proceedsGraceDays,
          maxFinancingRatio: cfg.maxFinancingRatio,
        },
        {
          ...t,
          principal: decStr(state.account.bookedPrincipal),
          financeDate,
          maturityDate,
        },
      ),
    );
  }

  /**
   * The loan's final due date: from its schedule once paid out; before
   * that, from the booked schedule — re-derived for the day it would be
   * paid out, exactly as the disbursement re-derives it.
   */
  private async maturity(
    tx: Tx,
    state: LoanState,
    financeDate: string,
  ): Promise<string | null> {
    const last = state.lines[state.lines.length - 1];
    if (last) return toLocalDate(last.dueDate);
    const v1 = await tx.agreementVersion.findFirst({
      where: {
        tenantId: state.account.tenantId,
        agreementId: state.account.agreementId,
        version: 1,
      },
    });
    if (!v1) return null;
    let lines = (
      v1.calculation as unknown as { schedule?: lending.ScheduleResult }
    ).schedule?.lines;
    if (state.contract.disbursementDate !== financeDate) {
      const booking = await this.applications.bookingCalculation(
        tx,
        state.account.tenantId,
        state.config,
        {
          ...(v1.terms as unknown as lending.NegotiatedTerms),
          disbursementDate: financeDate,
        },
        { reason: 'DISBURSEMENT_DATE' },
      );
      lines = booking.schedule.lines;
    }
    return lines?.length ? lines[lines.length - 1].dueDate : null;
  }

  /** Lock the loan, then read the trade as committed. */
  private async locked(tx: Tx, tenantId: string, transactionId: string) {
    const first = await tx.tradeTransaction.findFirst({
      where: { id: transactionId, tenantId },
    });
    if (!first) throw new NotFoundException('Trade transaction not found');
    const state = await loadLoanState(tx, tenantId, first.loanAccountId);
    const trx = (await tx.tradeTransaction.findFirst({
      where: { id: transactionId, tenantId },
    }))!;
    return { trx, state };
  }

  private async writeAudit(
    actor: LendingActor,
    tx: Tx,
    trx: Transaction,
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.write(
      {
        actor,
        action,
        resourceType: 'TradeTransaction',
        resourceId: trx.id,
        outcome: 'SUCCESS',
        details: {
          trade: trx.reference,
          loan: trx.loanAccountId,
          ...details,
        },
      },
      tx,
    );
  }
}

function documentaryConfig(state: LoanState): DocumentaryConfig {
  const cfg = state.config.trade?.documentary;
  if (!cfg)
    throw new BadRequestException({
      message: 'This loan is not a documentary trade loan.',
      code: 'NOT_DOCUMENTARY',
    });
  return cfg;
}

function labelOf(code: string): string {
  return (
    TRADE_DOCUMENT_LABELS[code] ??
    code
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/** Decimals as strings, dates as YYYY-MM-DD. */
function plain<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out))
    if (v && typeof v === 'object' && 'toFixed' in v && !(v instanceof Date))
      out[k] = (v as { toString(): string }).toString();
  return out;
}

function transactionView(t: Transaction) {
  const {
    documents: _d,
    loanAccount: _l,
    ...row
  } = t as Transaction & { documents?: unknown; loanAccount?: unknown };
  void _d;
  void _l;
  return {
    ...plain(row),
    cycleStartDate: toLocalDate(t.cycleStartDate),
    expectedProceedsDate: toLocalDate(t.expectedProceedsDate),
  };
}

function documentView(d: Document, cfg: DocumentaryConfig) {
  return {
    ...plain(d),
    label: labelOf(d.code),
    required: cfg.requiredDocuments.includes(d.code),
  };
}
