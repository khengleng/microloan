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
  requestHash,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import {
  DisbursementContext,
  ServicingService,
} from '../servicing/servicing.service';
import {
  LoanState,
  lineFullyPaid,
  loadLoanState,
  outstanding,
  resourceOf,
} from '../servicing/loan-state';

type Json = Prisma.InputJsonValue;
const ZERO = () => new lending.D(0);

/** Payee types that are the asset's seller: a lease pays them, never the lessee. */
const ASSET_SELLERS = ['SUPPLIER', 'DEALER', 'SELLER'];

/**
 * Purchase-linked lending: buy now, pay later (LT-11, UC-52) and leases
 * (LT-15, Ijarah). Both are term loans serviced by the ordinary schedule; what
 * this service adds is the third party.
 *
 *  • BNPL: at disbursement the merchant is paid the price net of the
 *    merchant discount, which is the lender's income (a disbursement hook
 *    rewrites the payout leg). A merchant refund reduces the instalments the
 *    customer still owes, latest first, pays back in cash what the customer
 *    already paid, reverses the discount pro rata and leaves the merchant
 *    owing the rest until it is collected.
 *  • Lease: the lender buys the asset — the payout goes to its supplier,
 *    never to the lessee — and owns it until the lease ends, either by the
 *    lessee paying the residual (title transfers) or by returning the asset,
 *    which settles the residual in kind.
 */
@Injectable()
export class BnplLeaseService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {
    this.servicing.registerDisbursementHook((tx, ctx) =>
      this.onDisbursement(tx, ctx),
    );
  }

  // ── Disbursement: merchant settlement and the lessor's purchase ───────────

  private async onDisbursement(tx: Tx, ctx: DisbursementContext) {
    const config = ctx.state.config;
    if (config.bnpl) return this.settleMerchant(tx, ctx, config.bnpl);
    if (config.lease) return this.buyLeasedAsset(tx, ctx);
  }

  private async settleMerchant(
    tx: Tx,
    ctx: DisbursementContext,
    bnpl: NonNullable<lending.ProductConfig['bnpl']>,
  ) {
    const merchants = ctx.payees.filter((p) => p.type === 'MERCHANT');
    if (
      merchants.length !== 1 ||
      ctx.payees.length !== 1 ||
      !D(merchants[0].amount).eq(ctx.payout)
    )
      throw new BadRequestException({
        message: `A BNPL disbursement pays exactly one MERCHANT payee the ${ctx.payout.toString()} purchase price; the merchant discount is deducted from it here.`,
        code: 'BNPL_MERCHANT_PAYEE',
      });
    const merchant = merchants[0];
    const s = engineCall(() =>
      lending.merchantSettlement(
        ctx.payout.toString(),
        bnpl.merchantDiscountRate,
        ctx.state.config.pricing.rounding,
      ),
    );
    const acct = ctx.state.config.accounting;
    const cashLeg = ctx.lines.find(
      (l) =>
        l.accountCode === acct.cash &&
        l.credit !== undefined &&
        D(l.credit).eq(ctx.payout),
    );
    if (!cashLeg)
      throw new ConflictException('The disbursement payout leg was not found.');
    // The merchant receives the net; the discount is the lender's income.
    cashLeg.credit = s.net;
    if (D(s.discount).gt(0))
      ctx.lines.push({
        accountCode: acct.merchantDiscountIncome,
        credit: s.discount,
      });
    ctx.components.merchantSettlement = { merchant: merchant.name, ...s };
    return async (eventId: string) => {
      await tx.bnplPlan.create({
        data: {
          tenantId: ctx.state.account.tenantId,
          loanAccountId: ctx.state.account.id,
          merchantName: merchant.name,
          merchantReference: merchant.reference ?? '',
          purchaseAmount: s.gross,
          merchantDiscountRate: bnpl.merchantDiscountRate,
          merchantDiscount: s.discount,
          merchantNet: s.net,
          disbursementEventId: eventId,
        },
      });
    };
  }

  private async buyLeasedAsset(tx: Tx, ctx: DisbursementContext) {
    const asset = await tx.leaseAsset.findFirst({
      where: {
        tenantId: ctx.state.account.tenantId,
        loanAccountId: ctx.state.account.id,
      },
    });
    if (!asset)
      throw new BadRequestException({
        message: 'Register the leased asset before paying for it.',
        code: 'LEASE_ASSET_MISSING',
      });
    if (
      ctx.payees.some((p) => !ASSET_SELLERS.includes(p.type)) ||
      !ctx.payees.length
    )
      throw new BadRequestException({
        message: `The lender buys the asset: pay its ${ASSET_SELLERS.join(', ').toLowerCase()} (${asset.supplierName}), not the lessee.`,
        code: 'LEASE_PAYEE',
      });
    ctx.components.leaseAsset = {
      id: asset.id,
      description: asset.description,
      supplier: asset.supplierName,
    };
  }

  // ── BNPL ──────────────────────────────────────────────────────────────────

  async getBnpl(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const plan = await tx.bnplPlan.findFirst({
        where: { tenantId, loanAccountId: loanId },
        include: { refunds: { orderBy: { createdAt: 'desc' } } },
      });
      if (!plan) throw new NotFoundException('This loan is not a BNPL plan.');
      return {
        ...bnplPlanView(plan),
        refunds: plan.refunds.map(refundView),
        refundable: D(plan.purchaseAmount)
          .minus(D(plan.refundedAmount))
          .toString(),
      };
    });
  }

  /**
   * UC-52: the merchant refunded the customer (a return or a cancelled
   * order). Remaining instalments shrink latest first; what the customer
   * already paid beyond what is still owed is paid back to them; the merchant
   * owes the lender the refund less the discount given back.
   */
  async refund(
    actor: LendingActor,
    loanId: string,
    body: {
      amount: string;
      merchantReference: string;
      reason: string;
      externalReference?: string;
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'bnpl.refund', loanId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const amount = lending.parseMoney(
        String(body.amount ?? ''),
        state.account.currency,
        'amount',
      );
      await this.policy.enforce(
        actor,
        'loan.bnpl.refund',
        resourceOf(state, [], amount.toString()),
        tx,
      );
      const plan = await tx.bnplPlan.findFirst({
        where: { tenantId, loanAccountId: loanId },
      });
      if (!plan) throw new NotFoundException('This loan is not a BNPL plan.');
      const open = state.lines.filter(
        (l) => l.number > 0 && l.status === 'DUE',
      );
      const result = engineCall(() =>
        lending.bnplRefund(
          {
            amount: amount.toString(),
            lines: open.map((l) => ({
              number: l.number,
              principalDue: decStr(l.principalDue),
              principalPaid: decStr(l.principalPaid),
            })),
            purchaseAmount: decStr(plan.purchaseAmount),
            alreadyRefunded: decStr(plan.refundedAmount),
            merchantDiscount: decStr(plan.merchantDiscount),
            discountAlreadyReversed: decStr(plan.discountReversed),
          },
          state.config.pricing.rounding,
        ),
      );
      const customerRefund = D(result.customerRefund);
      if (customerRefund.gt(0) && !body.externalReference?.trim())
        throw new BadRequestException(
          `${customerRefund} ${state.account.currency} goes back to the customer: record the payout reference.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      for (const r of result.reductions) {
        const line = open.find((l) => l.number === r.number)!;
        line.principalDue = D(line.principalDue)
          .minus(r.principal)
          .toString() as never;
        const paid = lineFullyPaid(line);
        await tx.scheduleInstalment.update({
          where: { id: line.id },
          data: {
            principalDue: decStr(line.principalDue),
            status: paid ? 'PAID' : 'DUE',
          },
        });
        if (paid) line.status = 'PAID';
      }
      const acct = state.config.accounting;
      const applied = D(result.appliedToPrincipal);
      const event = await this.servicing.recordEvent(tx, state, {
        type: 'BNPL_REFUND',
        amount,
        businessDate,
        valueDate: businessDate,
        components: { ...result, merchant: plan.merchantName },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Merchant refund ${body.merchantReference} from ${plan.merchantName}`,
        externalReference: body.externalReference?.slice(0, 120) ?? null,
        lines: [
          {
            accountCode: acct.merchantClawbackReceivable,
            debit: result.merchantClawback,
          },
          {
            accountCode: acct.merchantDiscountIncome,
            debit: result.discountReversed,
          },
          { accountCode: acct.loansReceivable, credit: applied.toString() },
          { accountCode: acct.cash, credit: customerRefund.toString() },
        ],
      });
      const refund = await tx.bnplRefund.create({
        data: {
          tenantId,
          planId: plan.id,
          loanAccountId: loanId,
          amount: amount.toString(),
          merchantReference: body.merchantReference.slice(0, 120),
          reason: body.reason.slice(0, 500),
          appliedToPrincipal: applied.toString(),
          customerRefund: customerRefund.toString(),
          discountReversed: result.discountReversed,
          merchantClawback: result.merchantClawback,
          reductions: result.reductions as unknown as Json,
          eventId: event.id,
          createdBy: actor.id,
        },
      });
      const res = await tx.bnplPlan.updateMany({
        where: { id: plan.id, tenantId, version: plan.version },
        data: {
          refundedAmount: D(plan.refundedAmount).plus(amount).toString(),
          discountReversed: D(plan.discountReversed)
            .plus(result.discountReversed)
            .toString(),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw concurrentModification('This BNPL plan');
      const a = state.account;
      const data: Prisma.LoanAccountUpdateManyMutationInput = {
        principalOutstanding: D(a.principalOutstanding)
          .minus(applied)
          .toString(),
        interestReceivable: decStr(a.interestReceivable),
        feesReceivable: decStr(a.feesReceivable),
        penaltyReceivable: decStr(a.penaltyReceivable),
      };
      // A refund of everything still owed closes the plan.
      if (a.status === 'ACTIVE')
        await this.servicing.closeIfRepaid(
          tx,
          state,
          data,
          actor,
          businessDate,
        );
      await this.servicing.casAccount(tx, state, a.status, data);
      await this.writeAudit(actor, tx, state, 'loan.bnpl.refund', {
        refund: refund.id,
        event: event.id,
        ...result,
      });
      return { refund: refundView(refund), eventId: event.id };
    });
  }

  /** The merchant paid back what it owes for a refund. */
  async collectClawback(
    actor: LendingActor,
    loanId: string,
    refundId: string,
    body: { externalReference: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'bnpl.clawback', loanId, refundId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const refund = await tx.bnplRefund.findFirst({
        where: { id: refundId, tenantId, loanAccountId: loanId },
      });
      if (!refund) throw new NotFoundException('Refund not found');
      await this.policy.enforce(
        actor,
        'loan.bnpl.clawback.collect',
        resourceOf(state, [], decStr(refund.merchantClawback)),
        tx,
      );
      if (refund.status !== 'CLAWBACK_DUE')
        throw new ConflictException('This clawback is already collected.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      const amount = D(refund.merchantClawback);
      const acct = state.config.accounting;
      const event = await this.servicing.recordEvent(tx, state, {
        type: 'MERCHANT_CLAWBACK',
        amount,
        businessDate,
        valueDate: businessDate,
        components: { refundId },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Merchant clawback for refund ${refund.merchantReference}`,
        externalReference: body.externalReference.slice(0, 120),
        lines: [
          { accountCode: acct.cash, debit: amount.toString() },
          {
            accountCode: acct.merchantClawbackReceivable,
            credit: amount.toString(),
          },
        ],
      });
      const res = await tx.bnplRefund.updateMany({
        where: {
          id: refundId,
          tenantId,
          version: refund.version,
          status: 'CLAWBACK_DUE',
        },
        data: {
          status: 'COLLECTED',
          collectedEventId: event.id,
          collectedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw concurrentModification('This refund');
      await this.writeAudit(actor, tx, state, 'loan.bnpl.clawback.collect', {
        refund: refundId,
        event: event.id,
        amount: amount.toString(),
      });
      return { id: refundId, status: 'COLLECTED', eventId: event.id };
    });
  }

  // ── Leases ────────────────────────────────────────────────────────────────

  async getLease(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      if (!state.config.lease)
        throw new NotFoundException('This loan is not a lease.');
      const asset = await tx.leaseAsset.findFirst({
        where: { tenantId, loanAccountId: loanId },
      });
      const businessDate = await this.businessDate.get(tenantId, tx);
      return {
        lease: state.config.lease,
        structure: state.config.attributes.structure,
        residualValue: this.residualOf(state),
        asset: asset ? assetView(asset) : null,
        returnCheck:
          asset && state.account.status === 'ACTIVE'
            ? this.returnCheck(state, decStr(asset.residualValue), businessDate)
            : null,
      };
    });
  }

  /** Record the asset the lender is buying, before the purchase is paid. */
  async registerAsset(
    actor: LendingActor,
    loanId: string,
    body: {
      assetType: string;
      description: string;
      serialNumber?: string;
      supplierName: string;
      cost: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.lease.register',
        resourceOf(state),
        tx,
      );
      const lease = state.config.lease;
      if (!lease) throw new BadRequestException('This loan is not a lease.');
      if (!lease.assetTypes.includes(body.assetType))
        throw new BadRequestException(
          `This lease product covers ${lease.assetTypes.join(', ')}.`,
        );
      const cost = lending.parseMoney(
        body.cost,
        state.account.currency,
        'cost',
      );
      const principal = D(state.account.bookedPrincipal);
      if (cost.lt(principal))
        throw new BadRequestException(
          `The lease finances ${principal} ${state.account.currency}; the asset cannot cost less.`,
        );
      const residual = D(this.residualOf(state));
      const existing = await tx.leaseAsset.findFirst({
        where: { tenantId, loanAccountId: loanId },
        select: { id: true },
      });
      if (existing)
        throw new ConflictException('The leased asset is already registered.');
      const asset = await tx.leaseAsset.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          assetType: body.assetType,
          description: body.description.slice(0, 200),
          serialNumber: (body.serialNumber ?? '').slice(0, 80),
          supplierName: body.supplierName.slice(0, 120),
          cost: cost.toString(),
          residualValue: residual.toString(),
          registeredBy: actor.id,
        },
      });
      await this.writeAudit(actor, tx, state, 'loan.lease.register', {
        asset: asset.id,
        cost: cost.toString(),
        residual: residual.toString(),
      });
      return assetView(asset);
    });
  }

  /**
   * The lessee hands the asset back at the end instead of paying the
   * residual. Every rental must be paid; the residual is then settled in
   * kind — the asset comes back onto the lender's books as an asset held
   * for sale at the residual value — and the lease closes.
   */
  async returnAsset(
    actor: LendingActor,
    loanId: string,
    body: { condition: string; externalReference: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'lease.return', loanId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.lease.return',
        resourceOf(state),
        tx,
      );
      if (!state.config.lease?.allowReturn)
        throw new BadRequestException(
          'This lease does not allow the asset to be returned.',
        );
      const asset = await tx.leaseAsset.findFirst({
        where: { tenantId, loanAccountId: loanId },
      });
      if (!asset || asset.ownership !== 'LESSOR')
        throw new ConflictException('There is no leased asset to return.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      const residual = D(asset.residualValue);
      const check = this.returnCheck(state, residual.toString(), businessDate);
      if (!check.ok)
        throw new ConflictException({
          message: check.issues.join(' '),
          code: 'LEASE_RETURN_REFUSED',
          issues: check.issues,
        });
      const last = this.finalLine(state);
      const acct = state.config.accounting;
      const event = await this.servicing.recordEvent(tx, state, {
        type: 'LEASE_RETURN',
        amount: residual,
        businessDate,
        valueDate: businessDate,
        components: { assetId: asset.id, residual: residual.toString() },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Leased asset returned: ${asset.description}`,
        externalReference: body.externalReference.slice(0, 120),
        lines: [
          { accountCode: acct.returnedLeaseAssets, debit: residual.toString() },
          { accountCode: acct.loansReceivable, credit: residual.toString() },
        ],
      });
      await tx.scheduleInstalment.update({
        where: { id: last.id },
        data: {
          principalPaid: D(last.principalPaid).plus(residual).toString(),
          status: 'PAID',
        },
      });
      const a = state.account;
      const data: Prisma.LoanAccountUpdateManyMutationInput = {
        principalOutstanding: D(a.principalOutstanding)
          .minus(residual)
          .toString(),
        interestReceivable: decStr(a.interestReceivable),
        feesReceivable: decStr(a.feesReceivable),
        penaltyReceivable: decStr(a.penaltyReceivable),
      };
      await this.servicing.closeIfRepaid(tx, state, data, actor, businessDate);
      await this.servicing.casAccount(tx, state, a.status, data);
      await this.casAsset(tx, asset, {
        ownership: 'RETURNED',
        endOption: 'RETURN',
        endDate: fromLocalDate(businessDate),
        endEventId: event.id,
        returnCondition: body.condition.slice(0, 500),
      });
      await this.writeAudit(actor, tx, state, 'loan.lease.return', {
        asset: asset.id,
        event: event.id,
        residual: residual.toString(),
      });
      return { eventId: event.id, status: data.status ?? a.status };
    });
  }

  /**
   * The lessee paid every rental and the residual: the purchase option is
   * exercised and title passes. Nothing is posted — the residual was the last
   * payment and the lender's net investment is already nil.
   */
  async transferTitle(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.lease.transfer_title',
        resourceOf(state),
        tx,
      );
      const asset = await tx.leaseAsset.findFirst({
        where: { tenantId, loanAccountId: loanId },
      });
      if (!asset || asset.ownership !== 'LESSOR')
        throw new ConflictException('There is no leased asset to transfer.');
      if (D(state.account.principalOutstanding).gt(0))
        throw new ConflictException('The residual has not been paid.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      await this.casAsset(tx, asset, {
        ownership: 'TRANSFERRED',
        endOption: 'PURCHASE',
        endDate: fromLocalDate(businessDate),
      });
      await this.writeAudit(actor, tx, state, 'loan.lease.transfer_title', {
        asset: asset.id,
      });
      return { id: asset.id, ownership: 'TRANSFERRED' };
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** The negotiated balloon is the residual: the purchase-option price. */
  private residualOf(state: LoanState): string {
    const last = this.finalLine(state);
    return (
      state.contract.balloonAmount ?? (last ? decStr(last.principalDue) : '0')
    );
  }

  private finalLine(state: LoanState) {
    return [...state.lines]
      .filter((l) => l.number > 0)
      .sort((a, b) => b.number - a.number)[0];
  }

  private returnCheck(
    state: LoanState,
    residual: string,
    businessDate: string,
  ) {
    const last = this.finalLine(state);
    const others = state.lines.filter(
      (l) => l.number !== last?.number && l.status === 'DUE',
    );
    const overdue = others.reduce((t, l) => {
      const o = outstanding(l);
      return t.plus(o.PRINCIPAL).plus(o.INTEREST).plus(o.FEE).plus(o.PENALTY);
    }, ZERO());
    const lastOpen = last ? outstanding(last) : null;
    const a = state.account;
    const charges = D(a.interestReceivable)
      .plus(D(a.feesReceivable))
      .plus(D(a.penaltyReceivable))
      .plus(
        lastOpen
          ? lastOpen.INTEREST.plus(lastOpen.FEE).plus(lastOpen.PENALTY)
          : ZERO(),
      );
    return lending.leaseReturnCheck({
      residualValue: residual,
      principalOutstanding: decStr(a.principalOutstanding),
      chargesOutstanding: lending.D.max(charges, 0).toString(),
      overdueRentals: overdue.toString(),
      finalInstalmentDue:
        !!last &&
        lending.compareDates(businessDate, toLocalDate(last.dueDate)!) >= 0,
    });
  }

  private async casAsset(
    tx: Tx,
    asset: { id: string; tenantId: string; version: number },
    data: Prisma.LeaseAssetUpdateManyMutationInput,
  ) {
    const res = await tx.leaseAsset.updateMany({
      where: {
        id: asset.id,
        tenantId: asset.tenantId,
        version: asset.version,
        ownership: 'LESSOR',
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This leased asset');
  }

  private async writeAudit(
    actor: LendingActor,
    tx: Tx,
    state: LoanState,
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.write(
      {
        actor,
        action,
        resourceType: 'LoanAccount',
        resourceId: state.account.id,
        outcome: 'SUCCESS',
        details: { loan: state.account.reference, ...details },
        configVersions: {
          productVersionId: state.account.productVersionId,
          engine: lending.LENDING_ENGINE_VERSION,
        },
      },
      tx,
    );
  }
}

function bnplPlanView(p: {
  id: string;
  loanAccountId: string;
  merchantName: string;
  merchantReference: string;
  purchaseAmount: unknown;
  merchantDiscountRate: unknown;
  merchantDiscount: unknown;
  merchantNet: unknown;
  refundedAmount: unknown;
  discountReversed: unknown;
  createdAt: Date;
}) {
  return {
    id: p.id,
    loanAccountId: p.loanAccountId,
    merchantName: p.merchantName,
    merchantReference: p.merchantReference,
    purchaseAmount: decStr(p.purchaseAmount as string),
    merchantDiscountRate: decStr(p.merchantDiscountRate as string),
    merchantDiscount: decStr(p.merchantDiscount as string),
    merchantNet: decStr(p.merchantNet as string),
    refundedAmount: decStr(p.refundedAmount as string),
    discountReversed: decStr(p.discountReversed as string),
    createdAt: p.createdAt,
  };
}

function refundView(r: {
  id: string;
  amount: unknown;
  merchantReference: string;
  reason: string;
  appliedToPrincipal: unknown;
  customerRefund: unknown;
  discountReversed: unknown;
  merchantClawback: unknown;
  reductions: unknown;
  status: string;
  eventId: string;
  collectedEventId: string | null;
  collectedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    amount: decStr(r.amount as string),
    merchantReference: r.merchantReference,
    reason: r.reason,
    appliedToPrincipal: decStr(r.appliedToPrincipal as string),
    customerRefund: decStr(r.customerRefund as string),
    discountReversed: decStr(r.discountReversed as string),
    merchantClawback: decStr(r.merchantClawback as string),
    reductions: r.reductions,
    status: r.status,
    eventId: r.eventId,
    collectedEventId: r.collectedEventId,
    collectedAt: r.collectedAt,
    createdAt: r.createdAt,
  };
}

function assetView(a: {
  id: string;
  loanAccountId: string;
  assetType: string;
  description: string;
  serialNumber: string;
  supplierName: string;
  cost: unknown;
  residualValue: unknown;
  ownership: string;
  endOption: string | null;
  endDate: Date | null;
  endEventId: string | null;
  returnCondition: string;
  createdAt: Date;
}) {
  return {
    id: a.id,
    loanAccountId: a.loanAccountId,
    assetType: a.assetType,
    description: a.description,
    serialNumber: a.serialNumber,
    supplierName: a.supplierName,
    cost: decStr(a.cost as string),
    residualValue: decStr(a.residualValue as string),
    ownership: a.ownership,
    endOption: a.endOption,
    endDate: toLocalDate(a.endDate),
    endEventId: a.endEventId,
    returnCondition: a.returnCondition,
    createdAt: a.createdAt,
  };
}
