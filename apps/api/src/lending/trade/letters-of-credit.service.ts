import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
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
import { configFlags } from '../policy/resources';
import type { Resource } from '../policy/decision';
import { PostingService, PostingLine } from '../accounting/posting.service';
import { ApplicationsService } from '../origination/applications.service';
import { ServicingService } from '../servicing/servicing.service';
import { loadLoanState } from '../servicing/loan-state';
import { tradeAccounts } from './invoice-finance.service';

type Json = Prisma.InputJsonValue;
type Lc = NonNullable<Awaited<ReturnType<Tx['letterOfCredit']['findFirst']>>>;
type Drawing = NonNullable<Awaited<ReturnType<Tx['lcDrawing']['findFirst']>>>;
type LcConfig = NonNullable<
  NonNullable<lending.ProductConfig['trade']>['letterOfCredit']
>;

/** What an LC carries from the product it was issued under. */
interface LcTerms {
  letterOfCredit: LcConfig;
  accounts: { cash: string; feeIncome: string; contingentAsset: string; contingentLiability: string };
  conversion: {
    productId: string;
    productCode: string;
    numberOfInstalments: number;
    annualRate: string | null;
  };
  feePreview: ReturnType<typeof lending.letterOfCreditFee>;
}

/**
 * Letters of credit (LT-19) and their conversion into loans (UC-53).
 *
 * Issuing a credit commits the bank to pay the beneficiary against
 * documents. Until it does, the importer owes nothing: the bank earns a fee
 * and carries the commitment as an off-balance-sheet memo (a contingent
 * asset/liability pair that nets to zero). A request is made by a maker and
 * issued by a checker within their authority.
 *
 * When the beneficiary presents documents, a maker records the drawing, a
 * checker approves it within their disbursement authority, and paying it
 * (by someone other than the maker) does three things in one transaction:
 * releases that part of the memo, books a term loan for the importer under
 * the configured conversion product — agreement, schedule and account,
 * exactly as an approved application is booked — and posts the loan's
 * disbursement as the payment to the beneficiary. From then on it is an
 * ordinary loan.
 */
@Injectable()
export class LettersOfCreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly posting: PostingService,
    private readonly applications: ApplicationsService,
    private readonly servicing: ServicingService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(actor: LendingActor, q: { status?: string; page?: number }) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'trade.lc.read');
    if (!scope) return { data: [], total: 0 };
    const where: Prisma.LetterOfCreditWhereInput = {
      tenantId,
      ...(scope as Prisma.LetterOfCreditWhereInput),
    };
    if (q.status) where.status = q.status;
    const take = 50;
    const [data, total] = await Promise.all([
      this.prisma.letterOfCredit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip: (Math.max(1, q.page ?? 1) - 1) * take,
      }),
      this.prisma.letterOfCredit.count({ where }),
    ]);
    return { data: data.map(view), total };
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const lc = await this.load(tx, tenantId, id);
      await this.policy.enforce(actor, 'trade.lc.read', await this.resource(tx, lc), tx);
      const drawings = await tx.lcDrawing.findMany({
        where: { tenantId, letterOfCreditId: id },
        orderBy: { sequence: 'asc' },
      });
      const loans = await tx.loanAccount.findMany({
        where: {
          tenantId,
          id: { in: drawings.map((d) => d.loanAccountId).filter((x): x is string => !!x) },
        },
        select: { id: true, reference: true, status: true, principalOutstanding: true },
      });
      return {
        letterOfCredit: view(lc),
        drawings: drawings.map((d) => ({
          ...plain(d),
          loan: loans.find((l) => l.id === d.loanAccountId)
            ? plain(loans.find((l) => l.id === d.loanAccountId)!)
            : null,
        })),
        undrawn: D(lc.amount).minus(D(lc.drawnAmount)).minus(D(lc.releasedAmount)).toString(),
      };
    });
  }

  // ── Request and issue ─────────────────────────────────────────────────────

  async request(
    actor: LendingActor,
    body: {
      borrowerId: string;
      productId: string;
      amount: string;
      beneficiaryName: string;
      beneficiaryBank?: string;
      beneficiaryAccount?: string;
      expiryDate: string;
      numberOfInstalments: number;
      annualRate?: string;
      portfolioId?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const borrower = await tx.borrower.findFirst({
        where: { id: body.borrowerId, tenantId },
        select: { id: true, branchId: true },
      });
      if (!borrower) throw new NotFoundException('Borrower not found');
      if (!borrower.branchId)
        throw new BadRequestException('The importer must belong to a branch.');
      if (
        body.portfolioId &&
        !(await tx.portfolio.findFirst({ where: { id: body.portfolioId, tenantId } }))
      )
        throw new NotFoundException('Portfolio not found');
      const { product, version, config } = await this.activeProduct(tx, tenantId, body.productId);
      const cfg = config.trade?.letterOfCredit;
      if (!cfg)
        throw new BadRequestException({
          message: 'This product does not issue letters of credit.',
          code: 'NOT_LC_PRODUCT',
        });
      const currency = config.identity.currency;
      const amount = engineCall(() => lending.parseMoney(body.amount, currency, 'amount'));
      const resource: Resource = {
        type: 'LETTER_OF_CREDIT',
        id: 'new',
        tenantId,
        branchId: borrower.branchId,
        portfolioId: body.portfolioId ?? null,
        legalEntityId: null,
        productCode: product.code,
        familyCode: product.familyCode,
        productStatus: version.status,
        productConfigValid: true,
        amount: amount.toString(),
        currency,
        dataClassification: 'CONFIDENTIAL',
        workflowState: null,
        makerIds: [],
        requiredFlags: configFlags(config),
      };
      await this.policy.enforce(actor, 'trade.lc.request', resource, tx);
      if (amount.lt(D(config.limits.minAmount)) || amount.gt(D(config.limits.maxAmount)))
        throw new BadRequestException({
          message: `A letter of credit under this product is between ${config.limits.minAmount} and ${config.limits.maxAmount} ${currency}.`,
          code: 'LC_AMOUNT',
        });
      if (!body.beneficiaryName?.trim()) throw new BadRequestException('Name the beneficiary.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      const fee = engineCall(() =>
        lending.letterOfCreditFee(lcFeeTerms(cfg), amount.toString(), businessDate, body.expiryDate, config.pricing.rounding),
      );
      // The loan a payment turns into is fixed now, so the importer and the
      // checker see what they are agreeing to (UC-53).
      const conversion = await this.conversionProduct(tx, tenantId, cfg, currency);
      this.checkConversionTerms(conversion.config, amount.toString(), body.numberOfInstalments, body.annualRate, businessDate);
      const terms: LcTerms = {
        letterOfCredit: cfg,
        accounts: {
          cash: config.accounting.cash,
          feeIncome: config.accounting.feeIncome,
          contingentAsset: tradeAccounts(config).lcContingentAsset,
          contingentLiability: tradeAccounts(config).lcContingentLiability,
        },
        conversion: {
          productId: conversion.product.id,
          productCode: conversion.product.code,
          numberOfInstalments: body.numberOfInstalments,
          annualRate: body.annualRate ?? null,
        },
        feePreview: fee,
      };
      const lc = await tx.letterOfCredit.create({
        data: {
          tenantId,
          reference: newReference('LC'),
          borrowerId: borrower.id,
          branchId: borrower.branchId,
          portfolioId: body.portfolioId ?? null,
          productId: product.id,
          productVersionId: version.id,
          familyCode: product.familyCode,
          currency,
          amount: amount.toString(),
          beneficiaryName: body.beneficiaryName.trim().slice(0, 160),
          beneficiaryBank: body.beneficiaryBank?.trim().slice(0, 160) || null,
          beneficiaryAccount: body.beneficiaryAccount?.trim().slice(0, 60) || null,
          issueDate: fromLocalDate(businessDate),
          expiryDate: fromLocalDate(body.expiryDate),
          terms: terms as unknown as Json,
          feeAmount: fee.fee,
          status: 'REQUESTED',
          requestedBy: actor.id,
        },
      });
      await this.writeAudit(actor, tx, lc, 'trade.lc.request', {
        amount: amount.toString(),
        fee: fee.fee,
        expiryDate: body.expiryDate,
        conversionProduct: conversion.product.code,
      });
      return view(lc);
    });
  }

  /**
   * Issue: the fee is earned (Dr cash, Cr fee income) and the commitment is
   * recorded off balance sheet (Dr customer liability, Cr commitments).
   */
  async issue(actor: LendingActor, id: string, idempotencyKey: string) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'lc.issue', id });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const lc = await this.lock(tx, tenantId, id);
      const decision = await this.policy.enforce(
        actor,
        'trade.lc.issue',
        await this.resource(tx, lc, [lc.requestedBy]),
        tx,
      );
      const terms = lc.terms as unknown as LcTerms;
      const businessDate = await this.businessDate.get(tenantId, tx);
      const { config } = await this.activeProduct(tx, tenantId, lc.productId);
      // Priced on the day it is actually issued.
      const fee = engineCall(() =>
        lending.letterOfCreditFee(
          lcFeeTerms(terms.letterOfCredit),
          decStr(lc.amount),
          businessDate,
          toLocalDate(lc.expiryDate)!,
          config.pricing.rounding,
        ),
      );
      const memo = await this.tenantEvent(tx, actor, {
        type: 'LC_ISSUE',
        amount: D(lc.amount),
        currency: lc.currency,
        businessDate,
        idempotencyKey,
        hash,
        externalReference: lc.reference,
        narrative: `Letter of credit ${lc.reference} issued to ${lc.beneficiaryName} (contingent)`,
        components: { letterOfCreditId: id, contingent: decStr(lc.amount), expiryDate: toLocalDate(lc.expiryDate) },
        lines: [
          { accountCode: terms.accounts.contingentAsset, debit: decStr(lc.amount) },
          { accountCode: terms.accounts.contingentLiability, credit: decStr(lc.amount) },
        ],
      });
      let feeEventId: string | null = null;
      if (D(fee.fee).gt(0)) {
        const feeEvent = await this.tenantEvent(tx, actor, {
          type: 'LC_FEE',
          amount: D(fee.fee),
          currency: lc.currency,
          businessDate,
          idempotencyKey: `sys:lc-fee:${id}`,
          hash: 'system',
          externalReference: lc.reference,
          narrative: `Issuance fee on letter of credit ${lc.reference}`,
          components: { letterOfCreditId: id, ...fee },
          lines: [
            { accountCode: terms.accounts.cash, debit: fee.fee },
            { accountCode: terms.accounts.feeIncome, credit: fee.fee },
          ],
        });
        feeEventId = feeEvent.id;
      }
      await this.cas(tx, lc, 'REQUESTED', {
        status: 'ISSUED',
        issueDate: fromLocalDate(businessDate),
        feeAmount: fee.fee,
        feeEventId,
        memoEventId: memo.id,
        issuedBy: actor.id,
        issuedAt: new Date(),
      });
      await this.servicing.outbox(tx, tenantId, 'lending.trade.lc_issued', {
        letterOfCreditId: id,
        amount: decStr(lc.amount),
        currency: lc.currency,
      });
      await this.audit.write(
        {
          actor,
          action: 'trade.lc.issue',
          resourceType: 'LetterOfCredit',
          resourceId: id,
          outcome: 'SUCCESS',
          decision,
          details: { memoEvent: memo.id, feeEvent: feeEventId, fee: fee.fee },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return { id, status: 'ISSUED', fee: fee.fee, memoEventId: memo.id, feeEventId };
    });
  }

  async reject(actor: LendingActor, id: string, body: { reason: string }) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const lc = await this.lock(tx, tenantId, id);
      await this.policy.enforce(actor, 'trade.lc.reject', await this.resource(tx, lc, [lc.requestedBy]), tx);
      await this.cas(tx, lc, 'REQUESTED', {
        status: 'REJECTED',
        rejectedBy: actor.id,
        rejectionReason: body.reason.slice(0, 500),
      });
      await this.writeAudit(actor, tx, lc, 'trade.lc.reject', { reason: body.reason });
      return { id, status: 'REJECTED' };
    });
  }

  /**
   * Expire (after the expiry date) or cancel (with the beneficiary's
   * agreement) a credit: the undrawn commitment leaves the memo.
   */
  async close(
    actor: LendingActor,
    id: string,
    body: { action: 'EXPIRE' | 'CANCEL'; reason: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'lc.close', id, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const lc = await this.lock(tx, tenantId, id);
      await this.policy.enforce(actor, 'trade.lc.close', await this.resource(tx, lc), tx);
      const businessDate = await this.businessDate.get(tenantId, tx);
      if (body.action === 'EXPIRE' && lending.compareDates(businessDate, toLocalDate(lc.expiryDate)!) <= 0)
        throw new ConflictException(`The credit is valid until ${toLocalDate(lc.expiryDate)}; it cannot expire before then.`);
      const open = await tx.lcDrawing.count({
        where: { tenantId, letterOfCreditId: id, status: { in: ['REQUESTED', 'APPROVED'] } },
      });
      if (open) throw new ConflictException('Decide the drawings awaiting payment first.');
      const undrawn = D(lc.amount).minus(D(lc.drawnAmount)).minus(D(lc.releasedAmount));
      const terms = lc.terms as unknown as LcTerms;
      const event = await this.tenantEvent(tx, actor, {
        type: 'LC_RELEASE',
        amount: undrawn,
        currency: lc.currency,
        businessDate,
        idempotencyKey,
        hash,
        externalReference: lc.reference,
        narrative: `Letter of credit ${lc.reference} ${body.action === 'EXPIRE' ? 'expired' : 'cancelled'}: undrawn commitment released`,
        components: { letterOfCreditId: id, action: body.action, released: undrawn.toString(), reason: body.reason.slice(0, 500) },
        lines: [
          { accountCode: terms.accounts.contingentLiability, debit: undrawn.toString() },
          { accountCode: terms.accounts.contingentAsset, credit: undrawn.toString() },
        ],
      });
      const status = body.action === 'EXPIRE' ? 'EXPIRED' : 'CANCELLED';
      await this.cas(tx, lc, lc.status, {
        status,
        releasedAmount: D(lc.releasedAmount).plus(undrawn).toString(),
        closedBy: actor.id,
        closedAt: new Date(),
        closeReason: body.reason.slice(0, 500),
      });
      await this.writeAudit(actor, tx, lc, 'trade.lc.close', { action: body.action, released: undrawn.toString(), event: event.id });
      return { id, status, released: undrawn.toString(), eventId: event.id };
    });
  }

  // ── Drawings: request → approve → pay (UC-53) ─────────────────────────────

  async requestDrawing(
    actor: LendingActor,
    id: string,
    body: { amount: string; documentsReference: string; numberOfInstalments?: number },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const lc = await this.lock(tx, tenantId, id);
      const amount = engineCall(() => lending.parseMoney(body.amount, lc.currency, 'amount'));
      await this.policy.enforce(
        actor,
        'trade.lc.drawing.request',
        await this.resource(tx, lc, [], amount.toString()),
        tx,
      );
      if (!body.documentsReference?.trim())
        throw new BadRequestException('Record the reference of the documents presented.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      await this.assertDrawable(tx, lc, amount.toString(), businessDate);
      const terms = lc.terms as unknown as LcTerms;
      const instalments = body.numberOfInstalments ?? terms.conversion.numberOfInstalments;
      const conversion = await this.conversionProduct(tx, tenantId, terms.letterOfCredit, lc.currency, terms.conversion.productId);
      this.checkConversionTerms(conversion.config, amount.toString(), instalments, terms.conversion.annualRate ?? undefined, businessDate);
      const sequence =
        ((await tx.lcDrawing.aggregate({ where: { tenantId, letterOfCreditId: id }, _max: { sequence: true } }))._max.sequence ?? 0) + 1;
      const drawing = await tx.lcDrawing.create({
        data: {
          tenantId,
          letterOfCreditId: id,
          sequence,
          amount: amount.toString(),
          documentsReference: body.documentsReference.trim().slice(0, 120),
          numberOfInstalments: instalments,
          status: 'REQUESTED',
          requestedBy: actor.id,
        },
      });
      await this.cas(tx, lc, lc.status, {});
      await this.writeAudit(actor, tx, lc, 'trade.lc.drawing.request', { drawing: drawing.id, amount: amount.toString() });
      return plain(drawing);
    });
  }

  async decideDrawing(
    actor: LendingActor,
    id: string,
    drawingId: string,
    decision: 'APPROVE' | 'REJECT',
    reason?: string,
  ) {
    const tenantId = requireTenant(actor);
    if (decision === 'REJECT' && !reason?.trim())
      throw new BadRequestException('Give a reason for refusing the drawing.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const lc = await this.lock(tx, tenantId, id);
      const drawing = await this.loadDrawing(tx, tenantId, id, drawingId);
      await this.policy.enforce(
        actor,
        decision === 'APPROVE' ? 'trade.lc.drawing.approve' : 'trade.lc.drawing.reject',
        await this.resource(tx, lc, [drawing.requestedBy], decStr(drawing.amount), drawing.status),
        tx,
      );
      if (decision === 'APPROVE') {
        const businessDate = await this.businessDate.get(tenantId, tx);
        await this.assertDrawable(tx, lc, decStr(drawing.amount), businessDate, drawing.id);
      }
      await this.casDrawing(tx, drawing, decision === 'APPROVE' ? 'REQUESTED' : drawing.status, {
        status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        ...(decision === 'APPROVE'
          ? { approvedBy: actor.id, approvedAt: new Date() }
          : { rejectedBy: actor.id, rejectionReason: reason!.slice(0, 500) }),
      });
      await this.writeAudit(actor, tx, lc, decision === 'APPROVE' ? 'trade.lc.drawing.approve' : 'trade.lc.drawing.reject', {
        drawing: drawingId,
        amount: decStr(drawing.amount),
        reason,
      });
      return { id: drawingId, status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' };
    });
  }

  /**
   * Pay the beneficiary and convert the payment into the importer's loan.
   */
  async payDrawing(
    actor: LendingActor,
    id: string,
    drawingId: string,
    body: { externalReference: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'lc.pay', id, drawingId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const lc = await this.lock(tx, tenantId, id);
      const drawing = await this.loadDrawing(tx, tenantId, id, drawingId);
      const amount = D(drawing.amount);
      const decision = await this.policy.enforce(
        actor,
        'trade.lc.drawing.pay',
        await this.resource(tx, lc, [drawing.requestedBy], amount.toString(), drawing.status),
        tx,
      );
      if (!body.externalReference?.trim())
        throw new BadRequestException('Record the bank reference of the payment to the beneficiary.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      await this.assertDrawable(tx, lc, amount.toString(), businessDate, drawing.id);
      const terms = lc.terms as unknown as LcTerms;

      // 1. The paid part of the commitment leaves the memo.
      await this.tenantEvent(tx, actor, {
        type: 'LC_DRAWING',
        amount,
        currency: lc.currency,
        businessDate,
        idempotencyKey: `sys:lc-drawing:${drawingId}`,
        hash: 'system',
        externalReference: lc.reference,
        narrative: `Letter of credit ${lc.reference}: drawing ${drawing.sequence} paid, contingent released`,
        components: { letterOfCreditId: id, drawingId },
        lines: [
          { accountCode: terms.accounts.contingentLiability, debit: amount.toString() },
          { accountCode: terms.accounts.contingentAsset, credit: amount.toString() },
        ],
      });

      // 2. The importer's loan, booked under the conversion product exactly
      //    as an approved application is booked.
      const conv = await this.conversionProduct(tx, tenantId, terms.letterOfCredit, lc.currency, terms.conversion.productId);
      const config = conv.config;
      const loanTerms: lending.NegotiatedTerms = {
        principal: amount.toString(),
        numberOfInstalments: drawing.numberOfInstalments,
        disbursementDate: businessDate,
        ...(terms.conversion.annualRate ? { annualRate: terms.conversion.annualRate } : {}),
        // The credit already earned its fee; the beneficiary is paid the
        // drawing in full (DECISIONS D-014).
        waivedFeeCodes: config.pricing.fees.map((f) => f.code),
      };
      this.checkConversionTerms(config, amount.toString(), drawing.numberOfInstalments, terms.conversion.annualRate ?? undefined, businessDate);
      const booking = await this.applications.bookingCalculation(tx, tenantId, config, loanTerms, {
        productVersionId: conv.version.id,
        productVersion: conv.version.version,
      });
      if (!D(booking.fees.netDisbursement).eq(amount))
        throw new ConflictException('The conversion product deducts charges the drawing cannot carry.');
      const agreement = await tx.lendingAgreement.create({
        data: {
          tenantId,
          reference: newReference('AGR'),
          // There is no application: the drawing is the credit decision's
          // execution, and it is unique per loan.
          applicationId: drawingId,
          borrowerId: lc.borrowerId,
          productId: conv.product.id,
          productVersionId: conv.version.id,
          currency: lc.currency,
          createdBy: actor.id,
        },
      });
      await tx.agreementVersion.create({
        data: {
          tenantId,
          agreementId: agreement.id,
          version: 1,
          reason: 'BOOKING',
          productConfig: config as unknown as Json,
          configHash: conv.version.configHash,
          terms: { ...loanTerms, letterOfCredit: lc.reference, drawing: drawing.sequence } as unknown as Json,
          policies: [] as unknown as Json,
          scheduleInput: booking.input as unknown as Json,
          calculation: {
            schedule: booking.schedule,
            fees: booking.fees,
            effectiveAnnualRate: booking.apr,
            engineVersion: lending.LENDING_ENGINE_VERSION,
          } as unknown as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          effectiveDate: fromLocalDate(businessDate),
          createdBy: actor.id,
        },
      });
      const account = await tx.loanAccount.create({
        data: {
          tenantId,
          reference: newReference('LN'),
          agreementId: agreement.id,
          applicationId: drawingId,
          borrowerId: lc.borrowerId,
          branchId: lc.branchId,
          portfolioId: lc.portfolioId,
          legalEntityId: lc.legalEntityId,
          productId: conv.product.id,
          productVersionId: conv.version.id,
          familyCode: conv.product.familyCode,
          currency: lc.currency,
          status: 'BOOKED',
          bookedPrincipal: booking.fees.bookedPrincipal,
          instalmentAmount: booking.schedule.instalmentAmount,
          maturityDate: fromLocalDate(booking.schedule.maturityDate),
          createdBy: actor.id,
        },
      });
      await tx.scheduleInstalment.createMany({
        data: booking.schedule.lines.map((l) => ({
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
        })),
      });

      // 3. The payment to the beneficiary is the loan's disbursement.
      const loan = await loadLoanState(tx, tenantId, account.id);
      const acc = config.accounting;
      const event = await this.servicing.recordEvent(tx, loan, {
        type: 'DISBURSEMENT',
        amount,
        businessDate,
        valueDate: businessDate,
        components: {
          bookedPrincipal: booking.fees.bookedPrincipal,
          netDisbursement: booking.fees.netDisbursement,
          fees: booking.fees.lines,
          letterOfCreditId: id,
          drawingId,
          paidTo: lc.beneficiaryName,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Letter of credit ${lc.reference} paid to ${lc.beneficiaryName}: converted to a loan`,
        externalReference: body.externalReference.trim().slice(0, 120),
        lines: [
          { accountCode: acc.loansReceivable, debit: amount.toString() },
          { accountCode: acc.cash, credit: amount.toString() },
        ],
      });
      await this.servicing.casAccount(tx, loan, 'BOOKED', {
        status: 'ACTIVE',
        principalOutstanding: booking.fees.bookedPrincipal,
        disbursementDate: fromLocalDate(businessDate),
        maturityDate: fromLocalDate(booking.schedule.maturityDate),
        instalmentAmount: booking.schedule.instalmentAmount,
        lastAccrualDate: fromLocalDate(businessDate),
      });
      await this.casDrawing(tx, drawing, 'APPROVED', {
        status: 'PAID',
        loanAccountId: account.id,
        eventId: event.id,
        paidBy: actor.id,
        paidAt: new Date(),
      });
      const drawn = D(lc.drawnAmount).plus(amount);
      await this.cas(tx, lc, lc.status, {
        drawnAmount: drawn.toString(),
        status: drawn.plus(D(lc.releasedAmount)).gte(D(lc.amount)) ? 'FULLY_DRAWN' : 'PARTIALLY_DRAWN',
      });
      await this.servicing.outbox(tx, tenantId, 'lending.disbursed', {
        loanAccountId: account.id,
        eventId: event.id,
        amount: amount.toString(),
        currency: lc.currency,
        letterOfCreditId: id,
      });
      await this.audit.write(
        {
          actor,
          action: 'trade.lc.drawing.pay',
          resourceType: 'LetterOfCredit',
          resourceId: id,
          outcome: 'SUCCESS',
          decision,
          details: {
            drawing: drawingId,
            amount: amount.toString(),
            loanAccount: account.reference,
            event: event.id,
          },
          configVersions: { productVersion: conv.version.version, configHash: conv.version.configHash, engine: lending.LENDING_ENGINE_VERSION },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return {
        id: drawingId,
        status: 'PAID',
        loanAccountId: account.id,
        loanReference: account.reference,
        eventId: event.id,
        instalmentAmount: booking.schedule.instalmentAmount,
        maturityDate: booking.schedule.maturityDate,
      };
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async activeProduct(tx: Tx, tenantId: string, productId: string) {
    const product = await tx.lendingProduct.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    const version = await tx.productVersion.findFirst({ where: { tenantId, productId, status: 'ACTIVE' } });
    if (!version) throw new BadRequestException('This product has no active version for new business.');
    const r = lending.validateProductConfig(version.config);
    if (!r.ok)
      throw new BadRequestException({ message: 'Product configuration is invalid.', code: 'INVALID_PRODUCT_CONFIG', issues: r.issues });
    return { product, version, config: r.config };
  }

  /** The configured term product a paid credit becomes (UC-53). */
  private async conversionProduct(tx: Tx, tenantId: string, cfg: LcConfig, currency: string, productId?: string) {
    let id = productId;
    if (!id) {
      if (!cfg.conversionProductCode)
        throw new BadRequestException({
          message: 'The letter-of-credit product names no conversion product; configure trade.letterOfCredit.conversionProductCode.',
          code: 'LC_NO_CONVERSION_PRODUCT',
        });
      const p = await tx.lendingProduct.findFirst({ where: { tenantId, code: cfg.conversionProductCode }, select: { id: true } });
      if (!p)
        throw new BadRequestException({
          message: `Conversion product ${cfg.conversionProductCode} does not exist.`,
          code: 'LC_NO_CONVERSION_PRODUCT',
        });
      id = p.id;
    }
    const conv = await this.activeProduct(tx, tenantId, id);
    const c = conv.config;
    if (c.facility.type !== 'TERM' || c.trade || c.syndication || c.identity.liability !== 'INDIVIDUAL')
      throw new BadRequestException({
        message: `Conversion product ${conv.product.code} must be an individual term loan.`,
        code: 'LC_CONVERSION_PRODUCT',
      });
    if (c.identity.currency !== currency)
      throw new BadRequestException({
        message: `Conversion product ${conv.product.code} lends in ${c.identity.currency}, not ${currency}.`,
        code: 'LC_CONVERSION_PRODUCT',
      });
    return conv;
  }

  private checkConversionTerms(config: lending.ProductConfig, principal: string, instalments: number, annualRate: string | undefined, date: string) {
    const check = lending.checkTerms(config, {
      principal,
      numberOfInstalments: instalments,
      disbursementDate: date,
      ...(annualRate ? { annualRate } : {}),
    });
    if (!check.ok)
      throw new BadRequestException({
        message: `The loan this credit converts into would breach its product: ${check.issues.map((i) => i.message).join('; ')}`,
        code: 'LC_CONVERSION_TERMS',
        issues: check.issues,
      });
  }

  private async assertDrawable(tx: Tx, lc: Lc, amount: string, date: string, excludeDrawingId?: string) {
    if (!['ISSUED', 'PARTIALLY_DRAWN'].includes(lc.status))
      throw new ConflictException(`This letter of credit is ${lc.status.toLowerCase().replace(/_/g, ' ')}.`);
    // Drawings awaiting payment already claim part of the credit.
    const pending = await tx.lcDrawing.aggregate({
      where: {
        tenantId: lc.tenantId,
        letterOfCreditId: lc.id,
        status: { in: ['REQUESTED', 'APPROVED'] },
        ...(excludeDrawingId ? { id: { not: excludeDrawingId } } : {}),
      },
      _sum: { amount: true },
    });
    const check = lending.checkLetterOfCreditDrawing(
      {
        amount: decStr(lc.amount),
        drawn: D(lc.drawnAmount).plus(D(lc.releasedAmount)).plus(D(pending._sum.amount ?? '0')).toString(),
        expiryDate: toLocalDate(lc.expiryDate)!,
      },
      { amount, date },
    );
    if (!check.ok)
      throw new BadRequestException({
        message: check.issues.map((i) => i.message).join(' '),
        code: check.issues[0].code,
        issues: check.issues,
      });
  }

  private async resource(tx: Tx, lc: Lc, makerIds: string[] = [], amount?: string, workflowState?: string): Promise<Resource> {
    const [product, version] = await Promise.all([
      tx.lendingProduct.findFirst({ where: { id: lc.productId, tenantId: lc.tenantId }, select: { code: true } }),
      tx.productVersion.findFirst({ where: { id: lc.productVersionId, tenantId: lc.tenantId }, select: { status: true, config: true } }),
    ]);
    const parsed = lending.validateProductConfig(version?.config);
    return {
      type: 'LETTER_OF_CREDIT',
      id: lc.id,
      tenantId: lc.tenantId,
      branchId: lc.branchId,
      portfolioId: lc.portfolioId,
      legalEntityId: lc.legalEntityId,
      productCode: product?.code ?? null,
      familyCode: lc.familyCode,
      productStatus: version?.status ?? null,
      productConfigValid: parsed.ok,
      amount: amount ?? decStr(lc.amount),
      currency: lc.currency,
      dataClassification: 'CONFIDENTIAL',
      workflowState: workflowState ?? lc.status,
      makerIds: [...new Set(makerIds.filter(Boolean))],
      requiredFlags: configFlags(parsed.ok ? parsed.config : null),
    };
  }

  private async tenantEvent(
    tx: Tx,
    actor: LendingActor,
    e: {
      type: string;
      amount: InstanceType<typeof lending.D>;
      currency: string;
      businessDate: string;
      idempotencyKey: string;
      hash: string;
      externalReference: string;
      narrative: string;
      components: Record<string, unknown>;
      lines: PostingLine[];
    },
  ) {
    const tenantId = requireTenant(actor);
    const event = await tx.financialEvent.create({
      data: {
        tenantId,
        loanAccountId: null,
        type: e.type,
        businessDate: fromLocalDate(e.businessDate),
        valueDate: fromLocalDate(e.businessDate),
        amount: e.amount.toString(),
        currency: e.currency,
        components: e.components as Json,
        idempotencyKey: e.idempotencyKey,
        requestHash: e.hash,
        productVersionId: null,
        agreementVersion: null,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        actorId: actor.id,
        actorType: actor.type,
        externalReference: e.externalReference.slice(0, 120),
        narrative: e.narrative,
      },
    });
    if (e.lines.some((l) => D(l.debit ?? '0').gt(0) || D(l.credit ?? '0').gt(0)))
      await this.posting.post(tx, {
        tenantId,
        financialEventId: event.id,
        loanAccountId: null,
        entryDate: fromLocalDate(e.businessDate),
        currency: e.currency,
        description: e.narrative,
        lines: e.lines,
      });
    return event;
  }

  private async load(tx: Tx, tenantId: string, id: string) {
    const lc = await tx.letterOfCredit.findFirst({ where: { id, tenantId } });
    if (!lc) throw new NotFoundException('Letter of credit not found');
    return lc;
  }

  /** Serialize every change to one credit on its row. */
  private async lock(tx: Tx, tenantId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM "LetterOfCredit" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    return this.load(tx, tenantId, id);
  }

  private async loadDrawing(tx: Tx, tenantId: string, id: string, drawingId: string) {
    const d = await tx.lcDrawing.findFirst({ where: { id: drawingId, tenantId, letterOfCreditId: id } });
    if (!d) throw new NotFoundException('Drawing not found');
    return d;
  }

  private async cas(tx: Tx, lc: Lc, fromStatus: string, data: Prisma.LetterOfCreditUpdateManyMutationInput) {
    const res = await tx.letterOfCredit.updateMany({
      where: { id: lc.id, tenantId: lc.tenantId, version: lc.version, status: fromStatus },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This letter of credit');
    lc.version += 1;
  }

  private async casDrawing(tx: Tx, d: Drawing, fromStatus: string, data: Prisma.LcDrawingUpdateManyMutationInput) {
    const res = await tx.lcDrawing.updateMany({
      where: { id: d.id, tenantId: d.tenantId, version: d.version, status: fromStatus },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This drawing');
  }

  private async writeAudit(actor: LendingActor, tx: Tx, lc: Lc, action: string, details: Record<string, unknown>) {
    await this.audit.write(
      {
        actor,
        action,
        resourceType: 'LetterOfCredit',
        resourceId: lc.id,
        outcome: 'SUCCESS',
        details: { reference: lc.reference, ...details },
      },
      tx,
    );
  }
}

function lcFeeTerms(cfg: LcConfig): lending.LetterOfCreditFeeTerms {
  return {
    feeRatePerPeriod: cfg.feeRatePerPeriod,
    feePeriodDays: cfg.feePeriodDays,
    minimumFee: cfg.minimumFee,
    maxTenorDays: cfg.maxTenorDays,
  };
}

function plain<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (v instanceof Date && /Date$/.test(k)) out[k] = toLocalDate(v);
    else if (v && typeof v === 'object' && 'toFixed' in v && !(v instanceof Date))
      out[k] = (v as { toString(): string }).toString();
  }
  return out;
}

function view(lc: Lc) {
  return {
    ...plain(lc),
    issueDate: toLocalDate(lc.issueDate),
    expiryDate: toLocalDate(lc.expiryDate),
    undrawn: D(lc.amount).minus(D(lc.drawnAmount)).minus(D(lc.releasedAmount)).toString(),
  };
}
