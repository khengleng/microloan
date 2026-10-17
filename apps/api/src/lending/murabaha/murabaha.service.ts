import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import {
  DisbursementContext,
  ServicingService,
} from '../servicing/servicing.service';
import { LoanState, loadLoanState, resourceOf } from '../servicing/loan-state';

type ContractRow = NonNullable<
  Awaited<ReturnType<Tx['murabahaContract']['findFirst']>>
>;

/** Payee types that are the asset's seller: the financier buys from them, never from the customer. */
const ASSET_SELLERS = ['SUPPLIER', 'DEALER', 'SELLER'];

/**
 * Murabaha (DECISIONS D-067).
 *
 * The financier buys the asset from its supplier — the payout goes to the
 * supplier, never the customer — and sells it to the customer at cost plus
 * a profit fixed and disclosed in the contract, payable in instalments.
 * There is no interest. The loan account carries the cost receivable (1350)
 * and the profit as it is earned (1355 → 4700, its own income account); the
 * profit not yet earned sits in a memo pair — the unearned part of the sale
 * price (1360) against deferred profit (2510) — booked at the sale and
 * released as the profit is recognised, at end of day and when the contract
 * ends. Late charges go to charity (2800). On early settlement the share of
 * unearned profit the product promises (ibra') is waived; the rest is due.
 */
@Injectable()
export class MurabahaService {
  private readonly logger = new Logger(MurabahaService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {
    this.servicing.registerDisbursementHook((tx, ctx) => this.onSale(tx, ctx));
    this.servicing.registerBatchHook((tx, state, businessDate, actor) =>
      state.config.murabaha
        ? this.syncDeferredProfit(tx, state, businessDate, actor, true)
        : Promise.resolve(),
    );
    this.servicing.registerClosureHook((tx, state, businessDate, actor) =>
      state.config.murabaha
        ? this.syncDeferredProfit(tx, state, businessDate, actor, false)
        : Promise.resolve(),
    );
    this.servicing.registerTenantBatchHook((tenantId, businessDate, actor) =>
      this.sweepEnded(tenantId, businessDate, actor),
    );
  }

  // ── The sale (at disbursement) ────────────────────────────────────────────

  private async onSale(tx: Tx, ctx: DisbursementContext) {
    const m = ctx.state.config.murabaha;
    if (!m) return;
    const tenantId = ctx.state.account.tenantId;
    const contract = await tx.murabahaContract.findFirst({
      where: { tenantId, loanAccountId: ctx.state.account.id },
    });
    if (!contract)
      throw new BadRequestException({
        message:
          'Register the asset being sold before paying its supplier: a Murabaha sells an asset the financier owns.',
        code: 'MURABAHA_ASSET_MISSING',
      });
    if (
      !ctx.payees.length ||
      ctx.payees.some((p) => !ASSET_SELLERS.includes(p.type))
    )
      throw new BadRequestException({
        message: `The financier buys the asset: pay its ${ASSET_SELLERS.join(', ').toLowerCase()} (${contract.supplierName}), not the customer.`,
        code: 'MURABAHA_PAYEE',
      });
    const down = await this.agreedDownPayment(tx, ctx.state);
    const financed = D(ctx.state.account.bookedPrincipal);
    if (!D(contract.cost).eq(financed.plus(down)))
      throw new BadRequestException({
        message: `The asset was registered at a cost of ${decStr(contract.cost)}; this contract finances ${financed}${down.gt(0) ? ` after a ${down} down payment` : ''}. Register the asset at its cost.`,
        code: 'MURABAHA_COST',
      });
    const lines = await tx.scheduleInstalment.findMany({
      where: {
        tenantId,
        loanAccountId: ctx.state.account.id,
        agreementVersion: Number(ctx.components.agreementVersion),
        number: { gt: 0 },
      },
      orderBy: { number: 'asc' },
    });
    const terms = engineCall(() =>
      lending.murabahaContract(
        decStr(contract.cost),
        down.toString(),
        lines.map(engineLine),
      ),
    );
    const acc = ctx.state.config.accounting;
    // The sale: the profit is part of the price but not yet earned.
    if (D(terms.profit).gt(0))
      ctx.lines.push(
        { accountCode: acc.unearnedProfitReceivable, debit: terms.profit },
        { accountCode: acc.deferredProfit, credit: terms.profit },
      );
    ctx.components.murabaha = {
      cost: terms.cost,
      profit: terms.profit,
      salePrice: terms.salePrice,
      supplier: contract.supplierName,
      asset: contract.description,
    };
    return async (eventId: string) => {
      const res = await tx.murabahaContract.updateMany({
        where: {
          id: contract.id,
          tenantId,
          version: contract.version,
          status: 'REGISTERED',
        },
        data: {
          status: 'SOLD',
          downPayment: down.toString(),
          profit: terms.profit,
          salePrice: terms.salePrice,
          ibraShare: m.ibraShare,
          deferredProfitBalance: terms.profit,
          saleEventId: eventId,
          soldOn: fromLocalDate(ctx.valueDate),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1)
        throw concurrentModification('This Murabaha contract');
    };
  }

  // ── Profit recognition: the deferred-profit memo ──────────────────────────

  /**
   * Bring the memo to what it should be: the profit not yet recognised while
   * the contract is live, nothing once it has ended. Recognised profit is
   * the profit accrued to date; any profit waived on settlement (ibra') was
   * never earned and simply leaves the memo.
   */
  private async syncDeferredProfit(
    tx: Tx,
    state: LoanState,
    businessDate: string,
    actor: LendingActor,
    live: boolean,
  ) {
    const tenantId = state.account.tenantId;
    const contract = await tx.murabahaContract.findFirst({
      where: { tenantId, loanAccountId: state.account.id },
    });
    if (
      !contract ||
      contract.status === 'REGISTERED' ||
      contract.profit === null
    )
      return;
    const accrued = await tx.accrualEvent.aggregate({
      where: { tenantId, loanAccountId: state.account.id },
      _sum: { amount: true },
    });
    const target = D(
      lending.deferredProfitTarget(
        decStr(contract.profit),
        decStr(accrued._sum.amount),
        live,
      ),
    );
    const current = D(contract.deferredProfitBalance);
    const delta = target.minus(current);
    let ibra = D(contract.ibraGranted);
    if (!live) {
      const settled = await tx.financialEvent.findFirst({
        where: {
          tenantId,
          loanAccountId: state.account.id,
          type: 'SETTLEMENT',
          status: 'POSTED',
        },
        orderBy: { createdAt: 'desc' },
        select: { components: true },
      });
      const waived = (
        settled?.components as { murabaha?: { ibra?: string } } | null
      )?.murabaha?.ibra;
      if (waived) ibra = D(waived);
    }
    if (delta.isZero() && (live || contract.status === 'ENDED')) return;
    if (!delta.isZero()) {
      const acc = state.config.accounting;
      const release = delta.lt(0);
      const amount = delta.abs().toString();
      await this.servicing.recordEvent(tx, state, {
        type: 'MURABAHA_DEFERRED_PROFIT',
        amount: delta.abs(),
        businessDate,
        valueDate: businessDate,
        components: {
          deferredBefore: current.toString(),
          deferredAfter: target.toString(),
          recognisedToDate: decStr(accrued._sum.amount),
          contractEnded: !live,
          ibra: ibra.toString(),
        },
        idempotencyKey: `sys:murabaha-profit:${state.account.id}:${randomUUID()}`,
        requestHash: 'system',
        actor,
        narrative: release
          ? live
            ? `Deferred Murabaha profit of ${amount} released as earned`
            : `Deferred Murabaha profit of ${amount} cleared at the end of the contract`
          : `Deferred Murabaha profit of ${amount} restored`,
        lines: release
          ? [
              {
                accountCode: state.config.accounting.deferredProfit,
                debit: amount,
              },
              { accountCode: acc.unearnedProfitReceivable, credit: amount },
            ]
          : [
              { accountCode: acc.unearnedProfitReceivable, debit: amount },
              {
                accountCode: state.config.accounting.deferredProfit,
                credit: amount,
              },
            ],
      });
    }
    const res = await tx.murabahaContract.updateMany({
      where: { id: contract.id, tenantId, version: contract.version },
      data: {
        deferredProfitBalance: target.toString(),
        ibraGranted: ibra.toString(),
        status: live ? 'SOLD' : 'ENDED',
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw concurrentModification('This Murabaha contract');
  }

  /**
   * Contracts whose loan ended by a route that has no closure hook (write-off,
   * debt sale, negotiated settlement): their memo is cleared at the next end
   * of day.
   */
  private async sweepEnded(
    tenantId: string,
    businessDate: string,
    actor: LendingActor,
  ) {
    const ended = await this.prisma.murabahaContract.findMany({
      where: {
        tenantId,
        status: 'SOLD',
        loanAccount: { status: { not: 'ACTIVE' } },
      },
      select: { loanAccountId: true },
    });
    for (const { loanAccountId } of ended) {
      try {
        await this.lp.tenantTx(tenantId, async (tx) => {
          const state = await loadLoanState(tx, tenantId, loanAccountId);
          if (state.account.status === 'ACTIVE') return;
          await this.syncDeferredProfit(tx, state, businessDate, actor, false);
        });
      } catch (e) {
        this.logger.error(
          `Murabaha deferred profit not cleared for loan ${loanAccountId}: ${(e as Error).message}`,
        );
      }
    }
  }

  // ── Asset and contract ────────────────────────────────────────────────────

  /** Identify the asset to be bought from its supplier and sold to the customer, before the payout. */
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
        'loan.murabaha.register',
        resourceOf(state),
        tx,
      );
      const m = state.config.murabaha;
      if (!m)
        throw new BadRequestException({
          message: 'This loan is not a Murabaha.',
          code: 'NOT_MURABAHA',
        });
      if (!m.assetTypes.includes(body.assetType))
        throw new BadRequestException(
          `This Murabaha product covers ${m.assetTypes.join(', ')}.`,
        );
      const cost = lending.parseMoney(
        body.cost,
        state.account.currency,
        'cost',
      );
      const down = await this.agreedDownPayment(tx, state);
      const expected = D(state.account.bookedPrincipal).plus(down);
      if (!cost.eq(expected))
        throw new BadRequestException({
          message: `The contract finances ${decStr(state.account.bookedPrincipal)} ${state.account.currency}${down.gt(0) ? ` after a ${down} down payment` : ''}: the asset's cost must be ${expected}. A Murabaha sells at cost plus the disclosed profit, so the cost cannot differ from what is financed.`,
          code: 'MURABAHA_COST',
        });
      const existing = await tx.murabahaContract.findFirst({
        where: { tenantId, loanAccountId: loanId },
        select: { id: true },
      });
      if (existing)
        throw new ConflictException(
          'The Murabaha asset is already registered.',
        );
      const row = await tx.murabahaContract.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          assetType: body.assetType,
          description: body.description.slice(0, 200),
          serialNumber: (body.serialNumber ?? '').slice(0, 80),
          supplierName: body.supplierName.slice(0, 120),
          cost: cost.toString(),
          downPayment: down.toString(),
          ibraShare: m.ibraShare,
          registeredBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.murabaha.register',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            contract: row.id,
            cost: cost.toString(),
            supplier: row.supplierName,
          },
        },
        tx,
      );
      return contractView(row);
    });
  }

  /**
   * The contract as disclosed: cost, profit and sale price, the instalments,
   * the ibra' promised on early settlement, and how the profit has been
   * recognised so far. Before the sale the figures come from the booked
   * schedule.
   */
  async get(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const m = state.config.murabaha;
      if (!m)
        throw new BadRequestException({
          message: 'This loan is not a Murabaha.',
          code: 'NOT_MURABAHA',
        });
      const contract = await tx.murabahaContract.findFirst({
        where: { tenantId, loanAccountId: loanId },
      });
      const lines =
        state.account.status === 'BOOKED'
          ? (
              (
                await tx.agreementVersion.findFirst({
                  where: {
                    tenantId,
                    agreementId: state.account.agreementId,
                    version: 1,
                  },
                  select: { calculation: true },
                })
              )?.calculation as unknown as { schedule: lending.ScheduleResult }
            ).schedule.lines.map((l) => ({
              number: l.number,
              periodStart: l.periodStart,
              periodEnd: l.periodEnd,
              dueDate: l.dueDate,
              principal: l.principal,
              interest: l.interest,
            }))
          : (
              await tx.scheduleInstalment.findMany({
                where: {
                  tenantId,
                  loanAccountId: loanId,
                  number: { gt: 0 },
                  // Settlement supersedes the instalments not yet due; they
                  // are still part of the sale price the contract disclosed.
                  status: { in: ['DUE', 'PAID', 'SUPERSEDED'] },
                },
                orderBy: [{ agreementVersion: 'desc' }, { number: 'asc' }],
              })
            )
              .filter(
                (l, _i, all) => l.agreementVersion === all[0].agreementVersion,
              )
              .map(engineLine);
      const down = await this.agreedDownPayment(tx, state);
      const cost = contract
        ? decStr(contract.cost)
        : D(state.account.bookedPrincipal).plus(down).toString();
      const terms = lines.length
        ? engineCall(() =>
            lending.murabahaContract(cost, down.toString(), lines),
          )
        : null;
      const accrued = await tx.accrualEvent.aggregate({
        where: { tenantId, loanAccountId: loanId },
        _sum: { amount: true },
      });
      const businessDate = await this.businessDate.get(tenantId, tx);
      return {
        status: state.account.status,
        currency: state.account.currency,
        asset: contract && contractView(contract),
        assetTypes: m.assetTypes,
        terms,
        ibra: {
          share: m.ibraShare,
          explanation:
            m.ibraShare === null
              ? 'No rebate is promised: on early settlement the remaining sale price is payable in full.'
              : `On early settlement ${D(m.ibraShare).times(100)}% of the profit not yet earned is waived (ibra’).`,
        },
        recognition: lines.length
          ? lending.murabahaProfitRecognition(lines)
          : [],
        profitRecognised: decStr(accrued._sum.amount),
        deferredProfit: contract
          ? decStr(contract.deferredProfitBalance)
          : (terms?.profit ?? '0'),
        deferredProfitToday:
          lines.length && state.account.status === 'ACTIVE'
            ? lending.deferredProfitAt(
                lines,
                businessDate,
                state.config.pricing.rounding,
              )
            : null,
        ibraGranted: contract ? decStr(contract.ibraGranted) : '0',
        accounts: {
          costReceivable: state.config.accounting.loansReceivable,
          profitReceivable: state.config.accounting.interestReceivable,
          profitIncome: state.config.accounting.interestIncome,
          unearnedProfit: state.config.accounting.unearnedProfitReceivable,
          deferredProfit: state.config.accounting.deferredProfit,
          lateChargesTo: state.config.accounting.penaltyIncome,
        },
      };
    });
  }

  private async agreedDownPayment(tx: Tx, state: LoanState) {
    const booked = await tx.agreementVersion.findFirst({
      where: {
        tenantId: state.account.tenantId,
        agreementId: state.account.agreementId,
        version: 1,
      },
      select: { terms: true },
    });
    return D(
      (booked?.terms as { downPayment?: string } | null)?.downPayment ?? '0',
    );
  }
}

function engineLine(l: {
  number: number;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  principalDue: Prisma.Decimal;
  interestDue: Prisma.Decimal;
}): lending.MurabahaScheduleLine {
  return {
    number: l.number,
    periodStart: toLocalDate(l.periodStart)!,
    periodEnd: toLocalDate(l.periodEnd)!,
    dueDate: toLocalDate(l.dueDate)!,
    principal: decStr(l.principalDue),
    interest: decStr(l.interestDue),
  };
}

function contractView(c: ContractRow) {
  return {
    id: c.id,
    assetType: c.assetType,
    description: c.description,
    serialNumber: c.serialNumber,
    supplierName: c.supplierName,
    cost: decStr(c.cost),
    downPayment: decStr(c.downPayment),
    profit: c.profit === null ? null : decStr(c.profit),
    salePrice: c.salePrice === null ? null : decStr(c.salePrice),
    ibraShare: c.ibraShare === null ? null : decStr(c.ibraShare),
    deferredProfitBalance: decStr(c.deferredProfitBalance),
    ibraGranted: decStr(c.ibraGranted),
    status: c.status,
    soldOn: toLocalDate(c.soldOn),
    registeredBy: c.registeredBy,
    createdAt: c.createdAt,
  };
}
