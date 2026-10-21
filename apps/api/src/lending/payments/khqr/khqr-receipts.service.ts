import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../../common/lending-prisma';
import { AuditEventService } from '../../common/audit-event.service';
import { BusinessDateService } from '../../common/business-date.service';
import {
  D,
  LendingActor,
  fromLocalDate,
  localDateIn,
  newReference,
  requestHash,
  requireTenant,
  toLocalDate,
} from '../../common/util';
import { PolicyService } from '../../policy/policy.service';
import { ServicingService } from '../../servicing/servicing.service';
import { loadLoanState, resourceOf } from '../../servicing/loan-state';
import { SuspenseService } from '../suspense.service';
import { CustomerDocumentsService } from '../../documents/customer-documents.service';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import { KhqrCodesService } from './khqr-codes.service';
import type { ReceiptBody, VerifyBody } from './khqr.schemas';

type ReceiptRow = Prisma.KhqrReceiptGetPayload<object>;

/** Allowance for a phone clock a little ahead of the server's. */
const CLOCK_SKEW_MS = 10 * 60_000;

/**
 * Receipts of repayments made to the lender's static KHQR code (D-160…D-165).
 *
 * The code has no amount and the platform has no Bakong API, so it never
 * learns of a payment by itself. A payment is recorded here as a receipt —
 * the borrower's "I have paid" claim from the portal, or what a member of
 * staff saw in the lender's bank app — and stays PENDING, posting nothing,
 * until a second person verifies it (or the bank statement confirms it,
 * khqr-statements.service). Verified, it is an ordinary repayment with
 * channel KHQR, through the same servicing path as a teller's; when a bank
 * statement already put the money in suspense, it is matched from there.
 *
 * One bank transaction reference is applied once, across claims, staff
 * receipts and statement lines (D-164).
 */
@Injectable()
export class KhqrReceiptsService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
    private readonly suspense: SuspenseService,
    private readonly settings: TenantSettingsService,
    private readonly documents: CustomerDocumentsService,
    private readonly codes: KhqrCodesService,
  ) {}

  // ── The borrower's "I have paid" ─────────────────────────────────────────

  /** A pending claim on the borrower's own loan. No money is posted. */
  async claim(actor: LendingActor, loanId: string, body: ReceiptBody) {
    if (actor.type !== 'CUSTOMER')
      throw new BadRequestException('Claims are made by the borrower in the portal.');
    return this.create(actor, loanId, body, 'PORTAL_CLAIM');
  }

  /** Staff record a payment seen in the lender's bank app; another person verifies it. */
  async record(actor: LendingActor, loanId: string, body: ReceiptBody) {
    return this.create(actor, loanId, body, 'STAFF');
  }

  private async create(
    actor: LendingActor,
    loanId: string,
    body: ReceiptBody,
    source: 'PORTAL_CLAIM' | 'STAFF',
  ) {
    const tenantId = requireTenant(actor);
    const refProblem = lending.bankRefProblem(body.bankRef);
    if (refProblem) throw new BadRequestException(refProblem);
    const paidAt = new Date(body.paidAt);
    if (paidAt.getTime() > Date.now() + CLOCK_SKEW_MS)
      throw new BadRequestException('The payment time is in the future.');
    const bankRefKey = lending.bankRefKey(body.bankRef);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      const a = state.account;
      const amount = lending.parseMoney(body.amount, a.currency, 'amount');
      await this.policy.enforce(
        actor,
        source === 'PORTAL_CLAIM'
          ? 'payment.claim.submit_own'
          : 'payment.receipt.record',
        {
          ...resourceOf(state, [], amount.toString()),
          ownerBorrowerId: a.borrowerId,
        },
        tx,
      );
      if (a.status !== 'ACTIVE')
        throw new ConflictException(
          `Loan ${a.reference} is ${a.status.toLowerCase()}; payments are not taken on it.`,
        );
      if (amount.lte(0))
        throw new BadRequestException('The amount must be positive.');
      if (body.currency !== a.currency)
        throw new BadRequestException(
          `Loan ${a.reference} is repaid in ${a.currency}. Pay its ${a.currency} code, or ask the lender how to pay in ${body.currency}.`,
        );
      const { payments } = await this.settings.get(tenantId, tx);
      if (source === 'PORTAL_CLAIM') {
        const waiting = await tx.khqrReceipt.count({
          where: { tenantId, borrowerId: a.borrowerId, status: 'PENDING' },
        });
        if (waiting >= payments.khqr.maxPendingClaimsPerBorrower)
          throw new ConflictException(
            `You already have ${waiting} payments waiting to be checked. Please wait until the lender has checked them.`,
          );
      }
      const held = await this.refFree(tx, tenantId, bankRefKey);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const paidOn = localDateIn(paidAt);
      const valueDate =
        lending.compareDates(paidOn, businessDate) > 0 ? businessDate : paidOn;
      const reference = newReference('QRR');
      const screenshot = body.screenshot
        ? await this.documents.filePaymentProofInTx(tx, {
            tenantId,
            borrowerId: a.borrowerId,
            loanAccountId: a.id,
            receiptReference: reference,
            file: body.screenshot,
            maxBytes: payments.khqr.maxScreenshotKb * 1024,
            createdBy: actor.id,
            uploaderType: actor.type === 'CUSTOMER' ? 'CUSTOMER' : 'USER',
          })
        : null;
      let receipt: ReceiptRow;
      try {
        receipt = await tx.khqrReceipt.create({
          data: {
            tenantId,
            reference,
            loanAccountId: a.id,
            borrowerId: a.borrowerId,
            branchId: a.branchId,
            source,
            amount: amount.toString(),
            currency: a.currency,
            paidAt,
            valueDate: fromLocalDate(valueDate),
            bankRef: body.bankRef.trim().slice(0, 120),
            bankRefKey,
            payerName: body.payerName || null,
            payerAccount: body.payerAccount || null,
            remark: body.remark ?? '',
            screenshotDocumentId: screenshot?.id ?? null,
            statementLineId: held?.lineId ?? null,
            unidentifiedPaymentId: held?.paymentId ?? null,
            makerType: actor.type === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
            makerId: actor.id,
          },
        });
      } catch (e) {
        throw this.duplicateOr(e);
      }
      await this.audit.write(
        {
          actor,
          action:
            source === 'PORTAL_CLAIM'
              ? 'payment.claim.submit_own'
              : 'payment.receipt.record',
          resourceType: 'KhqrReceipt',
          resourceId: receipt.id,
          outcome: 'SUCCESS',
          details: {
            loanId: a.id,
            amount: amount.toString(),
            currency: a.currency,
            bankRef: receipt.bankRef,
            heldInSuspense: held?.paymentId ?? null,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return this.view(receipt, { [a.id]: a.reference });
    });
  }

  // ── Verification ─────────────────────────────────────────────────────────

  /**
   * Post a pending receipt as a repayment (channel KHQR). Never by the person
   * who recorded it; a borrower's claim is verified by any holder of the
   * permission. Funded from suspense when a statement already put the money
   * there.
   */
  async verify(
    actor: LendingActor,
    id: string,
    body: VerifyBody,
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'khqr-verify', id, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const r = await this.lockPending(tx, tenantId, id);
      const state = await loadLoanState(tx, tenantId, r.loanAccountId, {
        lock: false,
      });
      await this.policy.enforce(
        actor,
        'payment.receipt.verify',
        resourceOf(state, [r.makerId], D(r.amount).toString()),
        tx,
      );
      const event = await this.postInTx(tx, actor, r, {
        idempotencyKey,
        hash,
        prepaymentStrategy: body.prepaymentStrategy,
        applyExcessAs: body.applyExcessAs,
        note: body.comment ?? '',
      });
      await this.audit.write(
        {
          actor,
          action: 'payment.receipt.verify',
          resourceType: 'KhqrReceipt',
          resourceId: r.id,
          outcome: 'SUCCESS',
          details: {
            loanId: r.loanAccountId,
            event: event.id,
            amount: D(r.amount).toString(),
            fromSuspense: r.unidentifiedPaymentId,
          },
        },
        tx,
      );
      return event;
    });
  }

  /** Refuse a pending receipt (not received, wrong amount, a duplicate …); nothing was posted. */
  async reject(actor: LendingActor, id: string, body: { reason: string }) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const r = await this.lockPending(tx, tenantId, id);
      const state = await loadLoanState(tx, tenantId, r.loanAccountId, {
        lock: false,
      });
      await this.policy.enforce(
        actor,
        'payment.receipt.reject',
        resourceOf(state, [r.makerId]),
        tx,
      );
      const res = await tx.khqrReceipt.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          decisionNote: body.reason.slice(0, 500),
        },
      });
      if (res.count !== 1)
        throw new ConflictException('This receipt was decided meanwhile.');
      await this.audit.write(
        {
          actor,
          action: 'payment.receipt.reject',
          resourceType: 'KhqrReceipt',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { reason: body.reason, loanId: r.loanAccountId },
        },
        tx,
      );
      const after = await tx.khqrReceipt.findFirstOrThrow({
        where: { id, tenantId },
      });
      return this.view(after, { [state.account.id]: state.account.reference });
    });
  }

  /**
   * The posting of a receipt, inside the caller's transaction (verification,
   * or a statement line confirming it at import). Marks it POSTED.
   */
  async postInTx(
    tx: Tx,
    actor: LendingActor,
    r: ReceiptRow,
    o: {
      idempotencyKey: string;
      hash: string;
      prepaymentStrategy?: 'RECAST' | 'SHORTEN';
      applyExcessAs?: 'ADVANCE' | 'PREPAY';
      note?: string;
      statementLineId?: string;
      /** Who decided it, when not the actor: a bank statement confirming it at import. */
      decidedBy?: string;
    },
  ) {
    const components: { khqr: Record<string, unknown> } = {
      khqr: {
        receipt: r.reference,
        source: r.source,
        bankRef: r.bankRef,
        statementLineId: o.statementLineId ?? r.statementLineId,
      },
    };
    const external = `KHQR ${r.bankRef}`.slice(0, 120);
    // Paid on the receipt's date, applied within what the product allows (D-162).
    const state = await loadLoanState(tx, r.tenantId, r.loanAccountId, {
      lock: false,
    });
    const paidOn = toLocalDate(r.valueDate)!;
    const valueDate = lending.khqrPostingDate(
      paidOn,
      await this.businessDate.get(r.tenantId, tx),
      state.config.repayment.maxBackdateDays,
    );
    components.khqr = { ...components.khqr, paidOn };
    let event: { id: string };
    if (r.unidentifiedPaymentId) {
      try {
        event = await this.suspense.matchInTx(
          tx,
          actor,
          r.unidentifiedPaymentId,
          {
            loanId: r.loanAccountId,
            amount: D(r.amount).toString(),
            prepaymentStrategy: o.prepaymentStrategy,
            applyExcessAs: o.applyExcessAs,
          },
          o.idempotencyKey,
          o.hash,
          {
            authorizedByApproval: true,
            channel: 'KHQR',
            components,
            valueDate,
          },
        );
      } catch (e) {
        if (e instanceof ConflictException)
          throw new ConflictException(
            'The money for this receipt was already allocated or refunded from unidentified payments. Reject this receipt as a duplicate.',
          );
        throw e;
      }
    } else {
      event = await this.servicing.repayInTx(
        tx,
        actor,
        r.loanAccountId,
        {
          amount: D(r.amount).toString(),
          valueDate,
          externalReference: external,
          channel: 'KHQR',
          prepaymentStrategy: o.prepaymentStrategy,
          applyExcessAs: o.applyExcessAs,
        },
        o.idempotencyKey,
        o.hash,
        { authorizedByApproval: true, components },
      );
    }
    const res = await tx.khqrReceipt.updateMany({
      where: { id: r.id, tenantId: r.tenantId, status: 'PENDING' },
      data: {
        status: 'POSTED',
        decidedBy: o.decidedBy ?? actor.id,
        decidedAt: new Date(),
        financialEventId: event.id,
        decisionNote: (o.note ?? '').slice(0, 500),
        ...(o.statementLineId ? { statementLineId: o.statementLineId } : {}),
      },
    });
    if (res.count !== 1)
      throw new ConflictException('This receipt was decided meanwhile.');
    return event as { id: string } & Record<string, unknown>;
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  /**
   * The reconciliation queue: receipts by status and source, confined to the
   * loans the reader may read, with who may verify each.
   */
  async queue(
    actor: LendingActor,
    q: { status?: string; source?: string; search?: string },
  ) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    if (!scope) return { counts: {}, receipts: [] };
    return this.lp.tenantTx(tenantId, async (tx) => {
      const search = q.search?.trim();
      const key = search ? lending.bankRefKey(search) : '';
      const where: Prisma.KhqrReceiptWhereInput = {
        tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.source ? { source: q.source } : {}),
        ...(search
          ? {
              OR: [
                ...(key ? [{ bankRefKey: { contains: key } }] : []),
                { reference: { contains: search.toUpperCase() } },
                { payerName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const rows = await tx.khqrReceipt.findMany({
        where,
        orderBy: { createdAt: q.status === 'PENDING' ? 'asc' : 'desc' },
        take: 300,
      });
      const loans = await tx.loanAccount.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.loanAccountId))] },
          ...(scope as Prisma.LoanAccountWhereInput),
        },
        select: { id: true, reference: true, borrowerId: true },
      });
      const refOf = Object.fromEntries(loans.map((l) => [l.id, l.reference]));
      const visible = rows.filter((r) => refOf[r.loanAccountId]);
      const names = await this.borrowerNames(
        tx,
        tenantId,
        visible.map((r) => r.borrowerId),
      );
      const grouped = await tx.khqrReceipt.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      });
      return {
        counts: Object.fromEntries(
          grouped.map((g) => [g.status, g._count._all]),
        ),
        receipts: visible.map((r) => ({
          ...this.view(r, refOf),
          borrowerName: names.get(r.borrowerId) ?? '',
          yours: r.makerId === actor.id,
        })),
      };
    });
  }

  /** A loan's receipts and the code it is paid with, for the staff loan page. */
  async forLoan(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(
        actor,
        'payment.receipt.read',
        resourceOf(state),
        tx,
      );
      const rows = await tx.khqrReceipt.findMany({
        where: { tenantId, loanAccountId: loanId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const refs = { [loanId]: state.account.reference };
      return {
        reference: state.account.reference,
        currency: state.account.currency,
        code: await this.codes.forLoan(tx, tenantId, state.account),
        receipts: rows.map((r) => ({
          ...this.view(r, refs),
          yours: r.makerId === actor.id,
        })),
      };
    });
  }

  /** The borrower's own loan, as the portal shows it (ownership checked here). */
  async portalLoan(
    session: { tenantId: string; borrowerId: string },
    loanId: string,
  ) {
    return this.lp.tenantTx(session.tenantId, async (tx) => {
      const own = await tx.loanAccount.findFirst({
        where: {
          id: loanId,
          tenantId: session.tenantId,
          borrowerId: session.borrowerId,
        },
        select: { id: true },
      });
      if (!own) throw new NotFoundException('Loan not found');
      return this.portalView(tx, session.tenantId, loanId);
    });
  }

  /** The lender's codes in force, for the portal home page. */
  async portalCodes(tenantId: string) {
    return this.lp.tenantTx(tenantId, (tx) =>
      this.codes.forTenant(tx, tenantId),
    );
  }

  /**
   * What the borrower sees for one loan: the code to pay, the reference to
   * write in the remark, and their recent claims. The caller has checked the
   * loan is theirs.
   */
  async portalView(tx: Tx, tenantId: string, loanId: string) {
    const loan = await tx.loanAccount.findFirst({
      where: { id: loanId, tenantId },
      select: { id: true, reference: true, currency: true, branchId: true },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    const claims = await tx.khqrReceipt.findMany({
      where: { tenantId, loanAccountId: loanId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      reference: loan.reference,
      currency: loan.currency,
      code: await this.codes.forLoan(tx, tenantId, loan),
      claims: claims.map((c) => ({
        reference: c.reference,
        status: c.status,
        source: c.source,
        amount: D(c.amount).toString(),
        currency: c.currency,
        paidAt: c.paidAt,
        bankRef: c.bankRef,
        decidedAt: c.decidedAt,
        // The borrower sees why a claim was refused.
        note: c.status === 'REJECTED' ? c.decisionNote : '',
      })),
    };
  }

  // ── Duplicate protection (D-164) ─────────────────────────────────────────

  /**
   * Whether a bank reference may be recorded: refused when a receipt (not
   * rejected) or a posted statement line already has it; when a statement
   * line put that money in suspense and it is still held, the new receipt is
   * linked to it, so verifying it applies the money from suspense.
   */
  async refFree(
    tx: Tx,
    tenantId: string,
    key: string,
  ): Promise<{ lineId: string; paymentId: string } | null> {
    const earlier = await tx.khqrReceipt.findFirst({
      where: { tenantId, bankRefKey: key, status: { not: 'REJECTED' } },
      select: { reference: true, status: true, loanAccountId: true },
    });
    if (earlier) {
      const loan = await tx.loanAccount.findFirst({
        where: { tenantId, id: earlier.loanAccountId },
        select: { reference: true },
      });
      throw new ConflictException({
        message:
          earlier.status === 'POSTED'
            ? `This bank transaction was already applied to loan ${loan?.reference ?? ''} (receipt ${earlier.reference}).`
            : `This bank transaction is already recorded (receipt ${earlier.reference}) and waiting to be checked.`,
        code: 'DUPLICATE_BANK_REFERENCE',
      });
    }
    const line = await tx.channelFileLine.findFirst({
      where: { tenantId, dedupeKey: `KHQR:${key}` },
    });
    if (!line) return null;
    if (line.outcome === 'POSTED') {
      const loan = line.loanAccountId
        ? await tx.loanAccount.findFirst({
            where: { tenantId, id: line.loanAccountId },
            select: { reference: true },
          })
        : null;
      throw new ConflictException({
        message: `This bank transaction is on an imported bank statement and was already applied to loan ${loan?.reference ?? ''}.`,
        code: 'DUPLICATE_BANK_REFERENCE',
      });
    }
    const held = line.unidentifiedPaymentId
      ? await tx.unidentifiedPayment.findFirst({
          where: { tenantId, id: line.unidentifiedPaymentId },
        })
      : null;
    if (!held || held.status !== 'OPEN')
      throw new ConflictException({
        message:
          'This bank transaction is on an imported bank statement and its money was already allocated or refunded.',
        code: 'DUPLICATE_BANK_REFERENCE',
      });
    return { lineId: line.id, paymentId: held.id };
  }

  private duplicateOr(e: unknown) {
    if (
      (e as { code?: string }).code === 'P2002' ||
      /KhqrReceipt_one_per_bank_ref/.test(String((e as Error).message))
    )
      return new ConflictException({
        message: 'This bank transaction is already recorded.',
        code: 'DUPLICATE_BANK_REFERENCE',
      });
    return e instanceof HttpException ? e : (e as Error);
  }

  // ── Plumbing ─────────────────────────────────────────────────────────────

  private async lockPending(tx: Tx, tenantId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM "KhqrReceipt" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const r = await tx.khqrReceipt.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('Receipt not found');
    if (r.status !== 'PENDING')
      throw new ConflictException(
        `This receipt is already ${r.status.toLowerCase()}.`,
      );
    return r;
  }

  private async borrowerNames(tx: Tx, tenantId: string, ids: string[]) {
    const rows = await tx.borrower.findMany({
      where: { tenantId, id: { in: [...new Set(ids)] } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(rows.map((b) => [b.id, `${b.firstName} ${b.lastName}`]));
  }

  private view(r: ReceiptRow, loanRefs: Record<string, string>) {
    return {
      id: r.id,
      reference: r.reference,
      loanAccountId: r.loanAccountId,
      loanReference: loanRefs[r.loanAccountId] ?? null,
      borrowerId: r.borrowerId,
      source: r.source,
      status: r.status,
      amount: D(r.amount).toString(),
      currency: r.currency,
      paidAt: r.paidAt,
      valueDate: toLocalDate(r.valueDate),
      bankRef: r.bankRef,
      payerName: r.payerName,
      payerAccount: r.payerAccount,
      remark: r.remark,
      screenshotDocumentId: r.screenshotDocumentId,
      statementLineId: r.statementLineId,
      unidentifiedPaymentId: r.unidentifiedPaymentId,
      makerType: r.makerType,
      makerId: r.makerId,
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      financialEventId: r.financialEventId,
      createdAt: r.createdAt,
    };
  }
}
