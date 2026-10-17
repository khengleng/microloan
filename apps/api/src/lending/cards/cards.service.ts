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
  requestHash,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { ServicingService } from '../servicing/servicing.service';
import { LoanState, loadLoanState } from '../servicing/loan-state';
import {
  FacilityState,
  loadFacilityState,
  resourceOf,
} from '../facilities/facility-state';
import type { PostingLine } from '../accounting/posting.service';

type Json = Prisma.InputJsonValue;
type Dec = InstanceType<typeof lending.D>;
type CardRow = NonNullable<Awaited<ReturnType<Tx['cardAccount']['findFirst']>>>;
type TxnRow = Awaited<ReturnType<Tx['cardTransaction']['findMany']>>[number];
type PlanRow = Awaited<
  ReturnType<Tx['cardInstalmentPlan']['findMany']>
>[number];

interface CardContext {
  card: CardRow;
  facility: FacilityState;
  loan: LoanState;
  terms: lending.CardTerms;
  cardConfig: NonNullable<lending.ProductConfig['card']>;
  transactions: TxnRow[];
}

const ZERO = () => new lending.D(0);

/**
 * Credit cards (LT-07): purchases, cash advances, statements with a grace
 * period, payments and instalment plans, on top of a REVOLVING facility.
 *
 * The facility owns the limit and its governance (limit changes, suspension,
 * renewal); its loan account owns the receivables the general ledger
 * reconciles. The card owns the split of the drawn principal into the
 * balances that price differently, and every card movement is a
 * CardTransaction row whose deltas the engine prices from — so the card's
 * balances are always the sum of its rows and always add up to the loan
 * account's principal (the reconciliation checks both).
 *
 * Invariants, as everywhere on the platform: money moves as one immutable
 * FinancialEvent with a balanced journal in the same transaction as the
 * balance change; money requests need an Idempotency-Key; every mutation ends
 * with compare-and-set on the card, the facility and the loan account; and
 * authorization is re-evaluated inside the transaction.
 */
@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {
    // A card has no schedule but each statement has a minimum payment, and
    // arrears on it age like any other (UC-38 on a card).
    this.servicing.registerBatchHook(async (tx, state, businessDate) => {
      if (!state.config.card) return;
      state.externalDpd = await this.minimumPaymentArrears(
        tx,
        state.account.tenantId,
        state.account.id,
        businessDate,
      );
    });
  }

  /**
   * Days past due on a card's minimum payments.
   *
   * A statement's minimum is met by payments made from its statement date
   * until the next statement; a payment first cures older shortfalls, then
   * the current minimum, and anything beyond it reduces the balance but does
   * not pay future minimums in advance. The oldest shortfall whose due date
   * has passed sets the days past due.
   */
  async minimumPaymentArrears(
    tx: Tx,
    tenantId: string,
    loanAccountId: string,
    businessDate: string,
  ): Promise<number> {
    const card = await tx.cardAccount.findFirst({
      where: { tenantId, loanAccountId },
      select: { id: true },
    });
    if (!card) return 0;
    const [statements, payments, account] = await Promise.all([
      tx.cardStatement.findMany({
        where: { tenantId, cardId: card.id },
        orderBy: { sequence: 'asc' },
      }),
      tx.cardTransaction.findMany({
        where: { tenantId, cardId: card.id, type: 'PAYMENT' },
        select: { transactionDate: true, amount: true },
      }),
      tx.loanAccount.findFirst({
        where: { id: loanAccountId, tenantId },
        select: {
          principalOutstanding: true,
          interestReceivable: true,
          feesReceivable: true,
          penaltyReceivable: true,
        },
      }),
    ]);
    const owed = account
      ? D(account.principalOutstanding)
          .plus(D(account.interestReceivable))
          .plus(D(account.feesReceivable))
          .plus(D(account.penaltyReceivable))
      : ZERO();
    if (owed.lte(0)) return 0;
    const shortfalls: { due: string; left: Dec }[] = [];
    statements.forEach((st, i) => {
      const from = toLocalDate(st.periodEnd)!;
      const next = statements[i + 1];
      let pool = payments
        .filter((p) => {
          const d = toLocalDate(p.transactionDate)!;
          return (
            lending.compareDates(d, from) >= 0 &&
            (!next || lending.compareDates(d, toLocalDate(next.periodEnd)!) < 0)
          );
        })
        .reduce((t, p) => t.plus(D(p.amount)), ZERO());
      for (const s of shortfalls) {
        const cure = lending.D.min(pool, s.left);
        s.left = s.left.minus(cure);
        pool = pool.minus(cure);
      }
      const left = D(st.minimumPayment).minus(pool);
      if (left.gt(0)) shortfalls.push({ due: toLocalDate(st.dueDate)!, left });
    });
    const oldest = shortfalls.find((s) => s.left.gt(0));
    if (!oldest || lending.compareDates(oldest.due, businessDate) >= 0)
      return 0;
    return lending.daysBetween(oldest.due, businessDate);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(actor: LendingActor, q: { status?: string; page?: number }) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'facility.read');
    if (!scope) return { data: [], total: 0 };
    const where: Prisma.CardAccountWhereInput = {
      tenantId,
      facility: { is: scope as Prisma.FacilityWhereInput },
    };
    if (q.status) where.status = q.status;
    const take = 50;
    const skip = (Math.max(1, q.page ?? 1) - 1) * take;
    const [rows, total] = await Promise.all([
      this.prisma.cardAccount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          facility: {
            select: {
              reference: true,
              limitAmount: true,
              currency: true,
              borrowerId: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.cardAccount.count({ where }),
    ]);
    return {
      data: rows.map((c) => ({
        ...cardView(c),
        facilityReference: c.facility.reference,
        limitAmount: decStr(c.facility.limitAmount),
        currency: c.facility.currency,
        borrowerId: c.facility.borrowerId,
      })),
      total,
    };
  }

  async get(actor: LendingActor, cardId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const ctx = await this.load(tx, tenantId, cardId, false);
      await this.policy.enforce(
        actor,
        'card.read',
        resourceOf(ctx.facility),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const [statements, plans] = await Promise.all([
        tx.cardStatement.findMany({
          where: { tenantId, cardId },
          orderBy: { sequence: 'desc' },
          take: 24,
        }),
        tx.cardInstalmentPlan.findMany({
          where: { tenantId, cardId },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const last = statements[0];
      const paidSinceStatement = last
        ? this.paymentsBetween(
            ctx.transactions,
            toLocalDate(last.periodEnd)!,
            businessDate,
          )
        : ZERO();
      const a = ctx.loan.account;
      const charges = D(a.interestReceivable)
        .plus(D(a.feesReceivable))
        .plus(D(a.penaltyReceivable));
      const principal = D(a.principalOutstanding);
      const limit = D(ctx.facility.facility.limitAmount);
      const cashLimit = limit.times(ctx.terms.cashAdvanceLimitShare);
      return {
        card: cardView(ctx.card),
        facility: {
          id: ctx.facility.facility.id,
          reference: ctx.facility.facility.reference,
          status: ctx.facility.facility.status,
          limitAmount: limit.toString(),
          currency: ctx.facility.facility.currency,
          availabilityFrom: toLocalDate(ctx.facility.facility.availabilityFrom),
          availabilityTo: toLocalDate(ctx.facility.facility.availabilityTo),
        },
        loanAccountId: a.id,
        terms: ctx.terms,
        instalmentPlanTerms: ctx.cardConfig.instalmentPlan,
        position: {
          businessDate,
          purchaseBalance: decStr(ctx.card.purchaseBalance),
          cashBalance: decStr(ctx.card.cashBalance),
          planBalance: decStr(ctx.card.planBalance),
          principal: principal.toString(),
          interestOwed: decStr(a.interestReceivable),
          feesOwed: D(a.feesReceivable).plus(D(a.penaltyReceivable)).toString(),
          totalOwed: principal.plus(charges).toString(),
          available: maxZero(limit.minus(principal)).toString(),
          cashAvailable: maxZero(
            lending.D.min(
              cashLimit.minus(D(ctx.card.cashBalance)),
              limit.minus(principal),
            ),
          ).toString(),
          daysPastDue: a.daysPastDue,
          // UC-39: what still has to arrive by the due date to keep the grace period.
          lastStatement: last
            ? {
                statementBalance: decStr(last.statementBalance),
                minimumPayment: decStr(last.minimumPayment),
                dueDate: toLocalDate(last.dueDate),
                paidSinceStatement: paidSinceStatement.toString(),
                toPayInFull: maxZero(
                  D(last.statementBalance).minus(paidSinceStatement),
                ).toString(),
              }
            : null,
        },
        transactions: ctx.transactions
          .slice()
          .reverse()
          .slice(0, 100)
          .map(txnView),
        statements: statements.map(statementView),
        plans: plans.map(planView),
      };
    });
  }

  // ── Purchases and cash advances ───────────────────────────────────────────

  /** A card purchase: the merchant is settled and the purchase balance rises. */
  async purchase(
    actor: LendingActor,
    cardId: string,
    body: { amount: string; merchantName: string; description?: string },
    idempotencyKey: string,
  ) {
    return this.spend(actor, cardId, 'PURCHASE', body, idempotencyKey);
  }

  /**
   * UC-40: a cash advance. A fee is charged when it is taken, and interest
   * runs at the cash-advance rate from the same day — there is no grace.
   */
  async cashAdvance(
    actor: LendingActor,
    cardId: string,
    body: { amount: string; externalReference: string },
    idempotencyKey: string,
  ) {
    return this.spend(
      actor,
      cardId,
      'CASH_ADVANCE',
      { amount: body.amount, merchantName: '', description: '' },
      idempotencyKey,
      body.externalReference,
    );
  }

  private async spend(
    actor: LendingActor,
    cardId: string,
    kind: 'PURCHASE' | 'CASH_ADVANCE',
    body: { amount: string; merchantName: string; description?: string },
    idempotencyKey: string,
    externalReference?: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: `card.${kind}`, cardId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const ctx = await this.load(tx, tenantId, cardId);
      const amount = lending.parseMoney(
        String(body.amount ?? ''),
        ctx.terms.currency,
        'amount',
      );
      if (amount.lte(0))
        throw new BadRequestException('Amount must be positive.');
      await this.policy.enforce(
        actor,
        kind === 'PURCHASE' ? 'card.purchase.post' : 'card.cash_advance.post',
        resourceOf(ctx.facility, [], { amount: amount.toString() }),
        tx,
      );
      if (ctx.card.status !== 'ACTIVE')
        throw new ConflictException(
          `This card is ${ctx.card.status.toLowerCase()}; it cannot be used.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const f = ctx.facility.facility;
      if (
        lending.compareDates(businessDate, toLocalDate(f.availabilityFrom)!) <
          0 ||
        lending.compareDates(businessDate, toLocalDate(f.availabilityTo)!) >= 0
      )
        throw new ConflictException(
          `The card line is available from ${toLocalDate(f.availabilityFrom)} until ${toLocalDate(f.availabilityTo)}; renew it to use the card.`,
        );
      const limit = D(f.limitAmount);
      const principal = D(ctx.loan.account.principalOutstanding);
      if (principal.plus(amount).gt(limit))
        throw new BadRequestException({
          message: `The ${amount} ${ctx.terms.currency} ${kind === 'PURCHASE' ? 'purchase' : 'cash advance'} exceeds the ${maxZero(limit.minus(principal))} available on the card.`,
          code: 'CARD_LIMIT_EXCEEDED',
        });
      const fee =
        kind === 'CASH_ADVANCE'
          ? D(lending.cashAdvanceFee(ctx.terms, amount.toString()))
          : ZERO();
      if (kind === 'CASH_ADVANCE') {
        const cashLimit = limit.times(ctx.terms.cashAdvanceLimitShare);
        if (D(ctx.card.cashBalance).plus(amount).gt(cashLimit))
          throw new BadRequestException({
            message: `Cash advances are limited to ${cashLimit.toDecimalPlaces(2).toString()} ${ctx.terms.currency} outstanding; ${maxZero(cashLimit.minus(D(ctx.card.cashBalance)))} is available.`,
            code: 'CASH_ADVANCE_LIMIT_EXCEEDED',
          });
      }

      const acct = ctx.facility.config.accounting;
      // Purchases are settled to the scheme on the day (D-031), so both
      // kinds leave through cash; the fee is income the moment it is charged.
      const lines: PostingLine[] = [
        { accountCode: acct.loansReceivable, debit: amount.toString() },
        { accountCode: acct.cash, credit: amount.toString() },
      ];
      if (fee.gt(0))
        lines.push(
          { accountCode: acct.feesReceivable, debit: fee.toString() },
          {
            accountCode: acct.cardCashAdvanceFeeIncome,
            credit: fee.toString(),
          },
        );
      const event = await this.servicing.recordEvent(tx, ctx.loan, {
        type: 'DISBURSEMENT',
        amount,
        businessDate,
        valueDate: businessDate,
        components: {
          cardId,
          facilityId: f.id,
          cardTransaction: kind,
          merchantName: body.merchantName || null,
          cashAdvanceFee: fee.toString(),
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative:
          kind === 'PURCHASE'
            ? `Card purchase at ${body.merchantName} on ${ctx.card.reference}`
            : `Cash advance on ${ctx.card.reference} (fee ${fee})`,
        externalReference: externalReference?.slice(0, 120) ?? null,
        lines,
      });
      const txn = await tx.cardTransaction.create({
        data: {
          tenantId,
          cardId,
          type: kind,
          transactionDate: fromLocalDate(businessDate),
          amount: amount.toString(),
          fee: fee.toString(),
          purchaseDelta: kind === 'PURCHASE' ? amount.toString() : '0',
          cashDelta: kind === 'CASH_ADVANCE' ? amount.toString() : '0',
          merchantName: (body.merchantName ?? '').slice(0, 120),
          description: (body.description ?? '').slice(0, 200),
          eventId: event.id,
          createdBy: actor.id,
        },
      });
      const a = ctx.loan.account;
      await this.servicing.casAccount(tx, ctx.loan, a.status, {
        principalOutstanding: principal.plus(amount).toString(),
        feesReceivable: D(a.feesReceivable).plus(fee).toString(),
        status: 'ACTIVE',
        closedAt: null,
        ...(a.disbursementDate
          ? {}
          : { disbursementDate: fromLocalDate(businessDate) }),
        ...(a.lastAccrualDate
          ? {}
          : { lastAccrualDate: fromLocalDate(businessDate) }),
      });
      await this.casFacility(tx, ctx.facility, {
        totalDrawn: D(f.totalDrawn).plus(amount).toString(),
        status: 'ACTIVE',
      });
      await this.casCard(tx, ctx.card, {
        purchaseBalance:
          kind === 'PURCHASE'
            ? D(ctx.card.purchaseBalance).plus(amount).toString()
            : undefined,
        cashBalance:
          kind === 'CASH_ADVANCE'
            ? D(ctx.card.cashBalance).plus(amount).toString()
            : undefined,
      });
      await this.writeAudit(actor, tx, ctx, `card.${kind.toLowerCase()}`, {
        transaction: txn.id,
        event: event.id,
        amount: amount.toString(),
        fee: fee.toString(),
      });
      return {
        transaction: txnView(txn),
        eventId: event.id,
        fee: fee.toString(),
      };
    });
  }

  // ── Statements ────────────────────────────────────────────────────────────

  /**
   * Close a statement cycle `[lastStatementTo, periodEnd)` (UC-39, UC-40, UC-44).
   *
   * In order: decide the grace period from the previous statement and the
   * payments that arrived by its due date; price the cycle's purchase and
   * cash-advance interest; bill each active instalment plan's next instalment
   * (its principal joins the purchase balance, its interest is charged); post
   * the charges; then state the balance and the minimum payment. The
   * statement is also written as the facility's statement, so end of day
   * ages an unpaid minimum payment like any facility's (UC-38).
   */
  async generateStatement(
    actor: LendingActor,
    cardId: string,
    body: { periodEnd: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'card.statement', cardId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const ctx = await this.load(tx, tenantId, cardId);
      await this.policy.enforce(
        actor,
        'card.statement.generate',
        resourceOf(ctx.facility),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const periodEnd = body.periodEnd;
      if (lending.compareDates(periodEnd, businessDate) > 0)
        throw new BadRequestException(
          `A statement cannot close on ${periodEnd}, which is after the business date ${businessDate}.`,
        );
      const periodStart =
        toLocalDate(ctx.card.lastStatementTo) ??
        toLocalDate(ctx.facility.facility.availabilityFrom)!;
      if (lending.compareDates(periodEnd, periodStart) <= 0)
        throw new ConflictException(
          `The card is already stated to ${periodStart}.`,
        );
      const previous = await tx.cardStatement.findFirst({
        where: { tenantId, cardId },
        orderBy: { sequence: 'desc' },
      });
      // The grace decision needs the whole payment window of the previous
      // statement, so the next one cannot close before that window shuts.
      if (
        previous &&
        lending.compareDates(periodEnd, toLocalDate(previous.dueDate)!) <= 0
      )
        throw new ConflictException(
          `The previous statement is due on ${toLocalDate(previous.dueDate)}; the next one can close only after that.`,
        );
      const paidByDue = previous
        ? this.paymentsBetween(
            ctx.transactions,
            toLocalDate(previous.periodEnd)!,
            toLocalDate(previous.dueDate)!,
          )
        : ZERO();
      const grace = lending.cardGraceApplies(
        previous
          ? {
              statementBalance: decStr(previous.statementBalance),
              dueDate: toLocalDate(previous.dueDate)!,
            }
          : null,
        paidByDue.toString(),
      );
      const movements = this.movements(ctx.transactions);
      const charges = engineCall(() =>
        lending.cardCycleCharges(
          ctx.terms,
          movements,
          periodStart,
          periodEnd,
          grace,
        ),
      );

      // UC-44: bill each active plan's next instalment.
      const plans = await tx.cardInstalmentPlan.findMany({
        where: { tenantId, cardId, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      });
      let planPrincipal = ZERO();
      let planInterest = ZERO();
      const billed: { planId: string; principal: string; interest: string }[] =
        [];
      for (const plan of plans) {
        const bill = this.nextInstalment(plan, ctx.terms.rounding);
        if (!bill) continue;
        planPrincipal = planPrincipal.plus(bill.principal);
        planInterest = planInterest.plus(bill.interest);
        billed.push({
          planId: plan.id,
          principal: bill.principal.toString(),
          interest: bill.interest.toString(),
        });
        const remaining = D(plan.principalRemaining).minus(bill.principal);
        const res = await tx.cardInstalmentPlan.updateMany({
          where: { id: plan.id, tenantId, version: plan.version },
          data: {
            billedCount: { increment: 1 },
            principalRemaining: remaining.toString(),
            status: remaining.lte(0) ? 'COMPLETED' : 'ACTIVE',
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw concurrentModification('This plan');
        if (bill.principal.gt(0))
          await tx.cardTransaction.create({
            data: {
              tenantId,
              cardId,
              type: 'PLAN_BILLING',
              transactionDate: fromLocalDate(periodEnd),
              amount: bill.principal.toString(),
              purchaseDelta: bill.principal.toString(),
              planDelta: bill.principal.neg().toString(),
              description: `Instalment ${plan.billedCount + 1} of ${plan.months}`,
              planId: plan.id,
              createdBy: actor.id,
            },
          });
      }

      const interest = D(charges.purchaseInterest)
        .plus(D(charges.cashInterest))
        .plus(planInterest);
      const loan = ctx.loan;
      const a = loan.account;
      const acct = ctx.facility.config.accounting;
      if (interest.gt(0)) {
        await this.servicing.recordEvent(tx, loan, {
          type: 'ACCRUAL',
          amount: interest,
          businessDate,
          valueDate: periodEnd,
          components: {
            cardId,
            periodStart,
            periodEnd,
            purchaseInterest: charges.purchaseInterest,
            purchaseInterestWaived: charges.purchaseInterestWaived,
            cashInterest: charges.cashInterest,
            planInterest: planInterest.toString(),
            graceApplied: grace,
          },
          idempotencyKey,
          requestHash: hash,
          actor,
          narrative: `Card interest ${periodStart} → ${periodEnd} on ${ctx.card.reference}`,
          lines: [
            {
              accountCode: acct.interestReceivable,
              debit: interest.toString(),
            },
            { accountCode: acct.interestIncome, credit: interest.toString() },
          ],
        });
        await this.servicing.casAccount(tx, loan, a.status, {
          interestReceivable: D(a.interestReceivable).plus(interest).toString(),
          lastAccrualDate: fromLocalDate(periodEnd),
        });
      }

      const purchaseBalance = D(ctx.card.purchaseBalance).plus(planPrincipal);
      const cashBalance = D(ctx.card.cashBalance);
      const planBalance = D(ctx.card.planBalance).minus(planPrincipal);
      const chargesOwed = D(a.interestReceivable)
        .plus(interest)
        .plus(D(a.feesReceivable))
        .plus(D(a.penaltyReceivable));
      const statementBalance = purchaseBalance
        .plus(cashBalance)
        .plus(chargesOwed);
      const minimum = engineCall(() =>
        lending.cardMinimumPayment(ctx.terms, {
          statementDate: periodEnd,
          statementBalance: statementBalance.toString(),
          charges: chargesOwed.toString(),
          planInstalment: planPrincipal.toString(),
          revolvingPrincipal: maxZero(
            purchaseBalance.plus(cashBalance).minus(planPrincipal),
          ).toString(),
        }),
      );
      const inPeriod = (t: TxnRow) =>
        lending.compareDates(toLocalDate(t.transactionDate)!, periodStart) >=
          0 &&
        lending.compareDates(toLocalDate(t.transactionDate)!, periodEnd) < 0;
      const sumOf = (rows: TxnRow[], pick: (t: TxnRow) => Dec) =>
        rows.reduce((s, t) => s.plus(pick(t)), ZERO());
      const cycle = ctx.transactions.filter(inPeriod);
      const spent = sumOf(
        cycle.filter((t) => t.type === 'PURCHASE' || t.type === 'CASH_ADVANCE'),
        (t) => D(t.amount),
      );
      const repaid = sumOf(
        cycle.filter((t) => t.type === 'PAYMENT'),
        (t) =>
          D(t.purchaseDelta).plus(D(t.cashDelta)).plus(D(t.planDelta)).neg(),
      );
      const cashFees = sumOf(
        cycle.filter((t) => t.type === 'CASH_ADVANCE'),
        (t) => D(t.fee),
      );
      const principalAt = (date: string, inclusive: boolean) =>
        sumOf(
          ctx.transactions.filter((t) => {
            const c = lending.compareDates(
              toLocalDate(t.transactionDate)!,
              date,
            );
            return inclusive ? c <= 0 : c < 0;
          }),
          (t) => D(t.purchaseDelta).plus(D(t.cashDelta)).plus(D(t.planDelta)),
        );
      const detail = {
        ...charges,
        planInterest: planInterest.toString(),
        planPrincipalBilled: planPrincipal.toString(),
        plansBilled: billed,
        previousStatementBalance: previous
          ? decStr(previous.statementBalance)
          : null,
        paidByPreviousDueDate: paidByDue.toString(),
        statementBalance: statementBalance.toString(),
        minimumPayment: minimum,
      };
      const sequence =
        ((
          await tx.facilityStatement.aggregate({
            where: { tenantId, facilityId: ctx.facility.facility.id },
            _max: { sequence: true },
          })
        )._max.sequence ?? 0) + 1;
      const facilityStatement = await tx.facilityStatement.create({
        data: {
          tenantId,
          facilityId: ctx.facility.facility.id,
          sequence,
          periodStart: fromLocalDate(periodStart),
          periodEnd: fromLocalDate(periodEnd),
          openingBalance: principalAt(periodStart, false).toString(),
          drawdowns: spent.toString(),
          repayments: repaid.toString(),
          interest: interest.toString(),
          closingBalance: principalAt(periodEnd, false).toString(),
          chargesRaised: interest.toString(),
          minimumPayment: D(minimum.amount).gt(0) ? minimum.amount : null,
          minimumPaymentDue: D(minimum.amount).gt(0)
            ? fromLocalDate(minimum.dueDate)
            : null,
          calculation: detail as unknown as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          createdBy: actor.id,
        },
      });
      const statement = await tx.cardStatement.create({
        data: {
          tenantId,
          cardId,
          facilityStatementId: facilityStatement.id,
          sequence:
            ((
              await tx.cardStatement.aggregate({
                where: { tenantId, cardId },
                _max: { sequence: true },
              })
            )._max.sequence ?? 0) + 1,
          periodStart: fromLocalDate(periodStart),
          periodEnd: fromLocalDate(periodEnd),
          dueDate: fromLocalDate(minimum.dueDate),
          purchaseBalance: purchaseBalance.toString(),
          cashBalance: cashBalance.toString(),
          planBalance: planBalance.toString(),
          statementBalance: statementBalance.toString(),
          purchaseInterest: charges.purchaseInterest,
          purchaseInterestWaived: charges.purchaseInterestWaived,
          cashInterest: charges.cashInterest,
          planInterest: planInterest.toString(),
          planPrincipalBilled: planPrincipal.toString(),
          cashAdvanceFees: cashFees.toString(),
          minimumPayment: minimum.amount,
          graceApplied: grace,
          createdBy: actor.id,
        },
      });
      await this.casFacility(tx, ctx.facility, {
        lastStatementTo: fromLocalDate(periodEnd),
        lastAccrualDate: fromLocalDate(periodEnd),
        chargesRaised: D(ctx.facility.facility.chargesRaised)
          .plus(interest)
          .toString(),
      });
      await this.casCard(tx, ctx.card, {
        lastStatementTo: fromLocalDate(periodEnd),
        purchaseBalance: purchaseBalance.toString(),
        planBalance: planBalance.toString(),
      });
      await this.writeAudit(actor, tx, ctx, 'card.statement.generate', {
        statement: statement.id,
        periodStart,
        periodEnd,
        graceApplied: grace,
        interest: interest.toString(),
        minimumPayment: minimum.amount,
      });
      return { statement: statementView(statement), detail };
    });
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  /**
   * A card payment: charges first, then cash advances, then purchases, then
   * (as a prepayment) unbilled instalment-plan principal. Overpaying is
   * refused, as everywhere else on the platform.
   */
  async payment(
    actor: LendingActor,
    cardId: string,
    body: { amount: string; externalReference?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'card.payment', cardId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const ctx = await this.load(tx, tenantId, cardId);
      const amount = lending.parseMoney(
        String(body.amount ?? ''),
        ctx.terms.currency,
        'amount',
      );
      if (amount.lte(0))
        throw new BadRequestException('Amount must be positive.');
      await this.policy.enforce(
        actor,
        'card.payment.post',
        resourceOf(ctx.facility, [], { amount: amount.toString() }),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const a = ctx.loan.account;
      const owed = {
        PENALTY: decStr(a.penaltyReceivable),
        FEE: decStr(a.feesReceivable),
        INTEREST: decStr(a.interestReceivable),
        CASH: decStr(ctx.card.cashBalance),
        PURCHASE: decStr(ctx.card.purchaseBalance),
        PLAN: decStr(ctx.card.planBalance),
      };
      const total = Object.values(owed).reduce((t, v) => t.plus(v), ZERO());
      if (amount.gt(total))
        throw new BadRequestException(
          `The payment exceeds the ${total.toString()} ${ctx.terms.currency} owed on this card.`,
        );
      const { applied } = engineCall(() =>
        lending.allocateCardPayment(amount.toString(), owed),
      );
      const take = (c: keyof typeof applied) => D(applied[c]);
      const principal = take('CASH').plus(take('PURCHASE')).plus(take('PLAN'));
      const acct = ctx.facility.config.accounting;
      const credits: PostingLine[] = [];
      const add = (accountCode: string, v: Dec) => {
        if (v.gt(0)) credits.push({ accountCode, credit: v.toString() });
      };
      add(acct.penaltyReceivable, take('PENALTY'));
      add(acct.feesReceivable, take('FEE'));
      add(acct.interestReceivable, take('INTEREST'));
      add(acct.loansReceivable, principal);
      const event = await this.servicing.recordEvent(tx, ctx.loan, {
        type: 'REPAYMENT',
        amount,
        businessDate,
        valueDate: businessDate,
        // PRINCIPAL is what the facility view and the reconciliation read.
        components: { cardId, ...applied, PRINCIPAL: principal.toString() },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Card payment on ${ctx.card.reference}`,
        externalReference: body.externalReference?.slice(0, 120) ?? null,
        lines: [
          { accountCode: acct.cash, debit: amount.toString() },
          ...credits,
        ],
      });
      const txn = await tx.cardTransaction.create({
        data: {
          tenantId,
          cardId,
          type: 'PAYMENT',
          transactionDate: fromLocalDate(businessDate),
          amount: amount.toString(),
          purchaseDelta: take('PURCHASE').neg().toString(),
          cashDelta: take('CASH').neg().toString(),
          planDelta: take('PLAN').neg().toString(),
          description: body.externalReference?.slice(0, 200) ?? '',
          eventId: event.id,
          createdBy: actor.id,
        },
      });
      // A plan prepayment reduces the plans oldest first.
      let prepaid = take('PLAN');
      if (prepaid.gt(0)) {
        const plans = await tx.cardInstalmentPlan.findMany({
          where: { tenantId, cardId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
        });
        for (const plan of plans) {
          if (prepaid.lte(0)) break;
          const cut = lending.D.min(prepaid, D(plan.principalRemaining));
          const remaining = D(plan.principalRemaining).minus(cut);
          const res = await tx.cardInstalmentPlan.updateMany({
            where: { id: plan.id, tenantId, version: plan.version },
            data: {
              principalRemaining: remaining.toString(),
              status: remaining.lte(0) ? 'COMPLETED' : 'ACTIVE',
              version: { increment: 1 },
            },
          });
          if (res.count !== 1) throw concurrentModification('This plan');
          prepaid = prepaid.minus(cut);
        }
      }
      await this.servicing.casAccount(tx, ctx.loan, a.status, {
        principalOutstanding: D(a.principalOutstanding)
          .minus(principal)
          .toString(),
        interestReceivable: D(a.interestReceivable)
          .minus(take('INTEREST'))
          .toString(),
        feesReceivable: D(a.feesReceivable).minus(take('FEE')).toString(),
        penaltyReceivable: D(a.penaltyReceivable)
          .minus(take('PENALTY'))
          .toString(),
      });
      await this.casCard(tx, ctx.card, {
        purchaseBalance: D(ctx.card.purchaseBalance)
          .minus(take('PURCHASE'))
          .toString(),
        cashBalance: D(ctx.card.cashBalance).minus(take('CASH')).toString(),
        planBalance: D(ctx.card.planBalance).minus(take('PLAN')).toString(),
      });
      await this.writeAudit(actor, tx, ctx, 'card.payment.post', {
        transaction: txn.id,
        event: event.id,
        amount: amount.toString(),
      });
      return { eventId: event.id, transaction: txnView(txn), applied };
    });
  }

  // ── Instalment plans (UC-44) ──────────────────────────────────────────────

  /**
   * Convert a purchase of the current cycle into fixed monthly instalments.
   *
   * The purchase leaves the revolving balance as from its own date — so it
   * never bears purchase interest — and becomes plan principal, billed one
   * instalment per statement with the plan's interest. No money moves and
   * the principal is unchanged, so nothing is posted; the conversion is a
   * card transaction and an audit event.
   */
  async convertToPlan(
    actor: LendingActor,
    cardId: string,
    transactionId: string,
    body: { months: number },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const ctx = await this.load(tx, tenantId, cardId);
      const source = ctx.transactions.find((t) => t.id === transactionId);
      if (!source) throw new NotFoundException('Card transaction not found');
      await this.policy.enforce(
        actor,
        'card.instalment_plan.convert',
        resourceOf(ctx.facility, [], { amount: decStr(source.amount) }),
        tx,
      );
      const offer = ctx.cardConfig.instalmentPlan;
      if (!offer)
        throw new BadRequestException(
          'This card product does not offer instalment plans.',
        );
      if (source.type !== 'PURCHASE')
        throw new BadRequestException('Only a purchase can be converted.');
      if (!offer.allowedMonths.includes(body.months))
        throw new BadRequestException(
          `Choose a term of ${offer.allowedMonths.join(', ')} months.`,
        );
      const amount = D(source.amount);
      if (amount.lt(D(offer.minAmount)))
        throw new BadRequestException(
          `Only purchases of ${offer.minAmount} ${ctx.terms.currency} or more can be converted.`,
        );
      const statedTo = toLocalDate(ctx.card.lastStatementTo);
      if (
        statedTo &&
        lending.compareDates(toLocalDate(source.transactionDate)!, statedTo) < 0
      )
        throw new ConflictException(
          'This purchase is already on a statement; only purchases of the current cycle can be converted.',
        );
      if (amount.gt(D(ctx.card.purchaseBalance)))
        throw new ConflictException(
          'The purchase balance no longer covers this purchase (it has been paid down).',
        );
      const existing = await tx.cardInstalmentPlan.findFirst({
        where: { tenantId, sourceTransactionId: transactionId },
        select: { id: true },
      });
      if (existing)
        throw new ConflictException('This purchase is already on a plan.');
      const schedule = engineCall(() =>
        lending.instalmentPlan(
          amount.toString(),
          offer.annualRate,
          body.months,
          ctx.terms.rounding,
        ),
      );
      const plan = await tx.cardInstalmentPlan.create({
        data: {
          tenantId,
          cardId,
          sourceTransactionId: transactionId,
          principal: amount.toString(),
          annualRate: offer.annualRate,
          months: body.months,
          instalmentAmount: schedule.instalmentAmount,
          lines: schedule.lines as unknown as Json,
          principalRemaining: amount.toString(),
          createdBy: actor.id,
        },
      });
      await tx.cardTransaction.create({
        data: {
          tenantId,
          cardId,
          type: 'PLAN_CONVERSION',
          // As from the purchase date: the converted amount never revolves.
          transactionDate: source.transactionDate,
          amount: amount.toString(),
          purchaseDelta: amount.neg().toString(),
          planDelta: amount.toString(),
          merchantName: source.merchantName,
          description: `${body.months}-month plan`,
          planId: plan.id,
          createdBy: actor.id,
        },
      });
      await this.casCard(tx, ctx.card, {
        purchaseBalance: D(ctx.card.purchaseBalance).minus(amount).toString(),
        planBalance: D(ctx.card.planBalance).plus(amount).toString(),
      });
      await this.writeAudit(actor, tx, ctx, 'card.instalment_plan.convert', {
        plan: plan.id,
        transaction: transactionId,
        amount: amount.toString(),
        months: body.months,
      });
      return { plan: planView(plan), schedule };
    });
  }

  // ── Closure ───────────────────────────────────────────────────────────────

  /** Close a card that owes nothing: the card, its line and its account. */
  async close(actor: LendingActor, cardId: string, body: { reason: string }) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const ctx = await this.load(tx, tenantId, cardId);
      await this.policy.enforce(
        actor,
        'card.close',
        resourceOf(ctx.facility),
        tx,
      );
      const a = ctx.loan.account;
      const owed = D(a.principalOutstanding)
        .plus(D(a.interestReceivable))
        .plus(D(a.feesReceivable))
        .plus(D(a.penaltyReceivable));
      if (owed.gt(0))
        throw new ConflictException(
          `${owed.toString()} ${ctx.terms.currency} is still owed on this card; it can be closed once repaid.`,
        );
      if (D(a.advanceBalance).gt(0))
        throw new ConflictException(
          'Money is held for the cardholder; refund it before closing.',
        );
      if (ctx.card.status === 'CLOSED')
        throw new ConflictException('This card is already closed.');
      await this.casCard(tx, ctx.card, {
        status: 'CLOSED',
        closedAt: new Date(),
      });
      await this.casFacility(tx, ctx.facility, {
        status: 'CLOSED',
        closedAt: new Date(),
      });
      if (a.status !== 'CLOSED')
        await this.servicing.casAccount(tx, ctx.loan, a.status, {
          status: 'CLOSED',
          closedAt: new Date(),
          daysPastDue: 0,
          delinquencyBucket: 'CURRENT',
          collectionStage: null,
        });
      await this.writeAudit(actor, tx, ctx, 'card.close', {
        reason: body.reason,
      });
      return { id: cardId, status: 'CLOSED' };
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async load(
    tx: Tx,
    tenantId: string,
    cardId: string,
    lock = true,
  ): Promise<CardContext> {
    const card = await tx.cardAccount.findFirst({
      where: { id: cardId, tenantId },
    });
    if (!card) throw new NotFoundException('Card not found');
    // Locks the facility's loan account row: card money operations serialize
    // with each other and with end of day on the same balance.
    const facility = await loadFacilityState(tx, tenantId, card.facilityId, {
      lock,
    });
    const loan = await loadLoanState(tx, tenantId, facility.account.id, {
      lock: false,
    });
    const cardConfig = facility.config.card;
    if (!cardConfig)
      throw new ConflictException(
        'The product behind this card carries no card terms.',
      );
    const transactions = await tx.cardTransaction.findMany({
      where: { tenantId, cardId },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    });
    const cfg = facility.config;
    return {
      card,
      facility,
      loan,
      cardConfig,
      transactions,
      terms: {
        currency: facility.facility.currency,
        dayCount: cfg.pricing.dayCount,
        rounding: cfg.pricing.rounding,
        purchaseAnnualRate: facility.terms.annualRate,
        cashAdvanceAnnualRate: cardConfig.cashAdvanceAnnualRate,
        cashAdvanceFeeRate: cardConfig.cashAdvanceFeeRate,
        cashAdvanceFeeMinimum: cardConfig.cashAdvanceFeeMinimum,
        cashAdvanceLimitShare: cardConfig.cashAdvanceLimitShare,
        minimumPaymentRate: cardConfig.minimumPaymentRate,
        minimumPaymentFloor: cardConfig.minimumPaymentFloor,
        paymentDueDays: cardConfig.paymentDueDays,
      },
    };
  }

  private movements(rows: TxnRow[]): lending.CardMovement[] {
    const out: lending.CardMovement[] = [];
    for (const t of rows) {
      const date = toLocalDate(t.transactionDate)!;
      for (const [bucket, v] of [
        ['PURCHASE', t.purchaseDelta],
        ['CASH', t.cashDelta],
        ['PLAN', t.planDelta],
      ] as const) {
        if (!D(v).isZero()) out.push({ date, bucket, amount: decStr(v) });
      }
    }
    return out;
  }

  /** Card payments dated in `[from, to]`. */
  private paymentsBetween(rows: TxnRow[], from: string, to: string): Dec {
    return rows
      .filter(
        (t) =>
          t.type === 'PAYMENT' &&
          lending.compareDates(toLocalDate(t.transactionDate)!, from) >= 0 &&
          lending.compareDates(toLocalDate(t.transactionDate)!, to) <= 0,
      )
      .reduce((s, t) => s.plus(D(t.amount)), ZERO());
  }

  /**
   * The next instalment of a plan. Interest is on the principal still
   * remaining at the plan's monthly rate — exactly the engine's schedule for
   * a plan nobody prepaid, and the right figure for one somebody did. The
   * last instalment takes whatever principal is left.
   */
  private nextInstalment(
    plan: PlanRow,
    rounding: lending.RoundingRule,
  ): { principal: Dec; interest: Dec } | null {
    const remaining = D(plan.principalRemaining);
    if (remaining.lte(0) || plan.billedCount >= plan.months) return null;
    const lines = plan.lines as unknown as lending.InstalmentPlanLine[];
    const line = lines[plan.billedCount];
    const last = plan.billedCount === plan.months - 1;
    const principal = last
      ? remaining
      : lending.D.min(remaining, D(line.principal));
    const interest = lending.roundMoney(
      remaining.times(D(plan.annualRate)).div(12),
      rounding,
    );
    return { principal, interest };
  }

  private async casCard(
    tx: Tx,
    card: CardRow,
    data: Prisma.CardAccountUpdateManyMutationInput,
  ) {
    const res = await tx.cardAccount.updateMany({
      where: { id: card.id, tenantId: card.tenantId, version: card.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This card');
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
    if (res.count !== 1) throw concurrentModification('This card line');
  }

  private async writeAudit(
    actor: LendingActor,
    tx: Tx,
    ctx: CardContext,
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.write(
      {
        actor,
        action,
        resourceType: 'CardAccount',
        resourceId: ctx.card.id,
        outcome: 'SUCCESS',
        details: {
          card: ctx.card.reference,
          facility: ctx.facility.facility.reference,
          ...details,
        },
        configVersions: {
          productVersionId: ctx.facility.facility.productVersionId,
          engine: lending.LENDING_ENGINE_VERSION,
        },
      },
      tx,
    );
  }
}

function maxZero(v: Dec): Dec {
  return v.lt(0) ? new lending.D(0) : v;
}

function cardView(c: CardRow) {
  return {
    id: c.id,
    reference: c.reference,
    maskedNumber: c.maskedNumber,
    status: c.status,
    facilityId: c.facilityId,
    loanAccountId: c.loanAccountId,
    purchaseBalance: decStr(c.purchaseBalance),
    cashBalance: decStr(c.cashBalance),
    planBalance: decStr(c.planBalance),
    lastStatementTo: toLocalDate(c.lastStatementTo),
    closedAt: c.closedAt,
    createdAt: c.createdAt,
  };
}

function txnView(t: TxnRow) {
  return {
    id: t.id,
    type: t.type,
    transactionDate: toLocalDate(t.transactionDate),
    amount: decStr(t.amount),
    fee: decStr(t.fee),
    purchaseDelta: decStr(t.purchaseDelta),
    cashDelta: decStr(t.cashDelta),
    planDelta: decStr(t.planDelta),
    merchantName: t.merchantName,
    description: t.description,
    eventId: t.eventId,
    planId: t.planId,
  };
}

function statementView(
  s: Awaited<ReturnType<Tx['cardStatement']['findMany']>>[number],
) {
  const out: Record<string, unknown> = { ...s };
  for (const k of ['periodStart', 'periodEnd', 'dueDate'] as const)
    out[k] = toLocalDate(s[k]);
  for (const k of [
    'purchaseBalance',
    'cashBalance',
    'planBalance',
    'statementBalance',
    'purchaseInterest',
    'purchaseInterestWaived',
    'cashInterest',
    'planInterest',
    'planPrincipalBilled',
    'cashAdvanceFees',
    'minimumPayment',
  ] as const)
    out[k] = decStr(s[k]);
  return out;
}

function planView(p: PlanRow) {
  return {
    id: p.id,
    sourceTransactionId: p.sourceTransactionId,
    principal: decStr(p.principal),
    annualRate: decStr(p.annualRate),
    months: p.months,
    instalmentAmount: decStr(p.instalmentAmount),
    billedCount: p.billedCount,
    principalRemaining: decStr(p.principalRemaining),
    status: p.status,
    lines: p.lines,
    createdAt: p.createdAt,
  };
}
