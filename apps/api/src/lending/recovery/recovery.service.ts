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
import { tenantResource } from '../policy/resources';
import { ACTION_BY_CODE } from '../policy/actions';
import type { PostingLine } from '../accounting/posting.service';
import {
  ServicingService,
  allowanceRelease,
  refuseWhileAdvanceHeld,
  suspenseRelease,
} from '../servicing/servicing.service';
import {
  LoanState,
  loadLoanState,
  outstanding,
  resourceOf,
} from '../servicing/loan-state';

type Json = Prisma.InputJsonValue;
type Dec = InstanceType<typeof lending.D>;

/** Approval tasks this module creates, and the action that decides each. */
const TASKS = {
  REPOSSESSION_SEIZURE: 'loan.repossession.approve',
  PAWN_FORFEITURE: 'loan.pawn.forfeit.approve',
  PREMIUM_REMITTANCE: 'loan.insurance.remit.approve',
  INSURANCE_CLAIM: 'loan.insurance.claim.approve',
  DEBT_SALE: 'loan.debt_sale.approve',
  RECOVERY_REFUND: 'loan.recovery_refund.approve',
} as const;
type TaskKind = keyof typeof TASKS;
const TASK_KINDS = Object.keys(TASKS) as TaskKind[];

const IN_PROGRESS = ['PROPOSED', 'SEIZED', 'VALUED'];

/**
 * Recovery workflows on loans that are not going to be repaid as agreed:
 *
 *  • repossession and sale of pledged collateral (UC-65);
 *  • custody, valuation, forfeiture and auction of pawned items (UC-66, LT-09);
 *  • credit insurance — premiums held for the insurer, and claims that pay
 *    the loan off on death or disability (UC-68, UC-06);
 *  • sale of the loan to a collection agency (UC-71).
 *
 * Money from a sale or a claim runs through one waterfall (engine
 * `applyRecoveryProceeds`): costs first, then the loan in the product's
 * order. A surplus is held for the borrower or estate until a second user
 * approves the payout; a deficiency stays on the loan, which remains open
 * (typically to be written off). Every step that lets money leave, books a
 * loss or takes the borrower's property is proposed by one user and approved
 * by another.
 */
@Injectable()
export class RecoveryService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** Everything recovery-related on one loan, with what is awaiting approval. */
  async view(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const where = { tenantId, loanAccountId: loanId };
      const [repossessions, pawnItems, policies, debtSales, refunds, tasks] =
        await Promise.all([
          tx.repossession.findMany({ where, orderBy: { createdAt: 'desc' } }),
          tx.pawnItem.findMany({ where, orderBy: { createdAt: 'asc' } }),
          tx.insurancePolicy.findMany({
            where,
            include: { claims: { orderBy: { createdAt: 'desc' } } },
            orderBy: { createdAt: 'asc' },
          }),
          tx.debtSale.findMany({ where, orderBy: { createdAt: 'desc' } }),
          tx.recoveryRefund.findMany({ where, orderBy: { createdAt: 'desc' } }),
          tx.approvalTask.findMany({
            where: {
              tenantId,
              subjectType: 'LOAN_ACCOUNT',
              subjectId: loanId,
              action: { in: TASK_KINDS },
              status: 'PENDING',
            },
            orderBy: { createdAt: 'asc' },
          }),
        ]);
      const pledges = await tx.collateralPledge.findMany({
        where: { tenantId, applicationId: state.account.applicationId },
        include: { collateral: true },
      });
      const businessDate = await this.businessDate.get(tenantId, tx);
      return {
        businessDate,
        loan: {
          status: state.account.status,
          currency: state.account.currency,
          daysPastDue: state.account.daysPastDue,
          owed: owedTotal(state).toString(),
        },
        rules: state.config.recovery,
        pledges: pledges.map((p) => ({
          collateralId: p.collateralId,
          type: p.collateral.type,
          description: p.collateral.description,
          status: p.status,
        })),
        repossessions: repossessions.map(plain),
        pawnItems: pawnItems.map((p) => ({
          ...plain(p),
          forfeitable:
            p.status === 'IN_CUSTODY' &&
            lending.pawnForfeitable(
              toLocalDate(p.redemptionDeadline)!,
              businessDate,
              state.config.recovery.pawnForfeitureGraceDays,
            ),
        })),
        insurancePolicies: policies.map((p) => ({
          ...plain(p),
          premiumToRemit: D(p.premium).minus(D(p.premiumRemitted)).toString(),
          claims: p.claims.map(plain),
        })),
        debtSales: debtSales.map(plain),
        refunds: refunds.map(plain),
        pendingTasks: tasks.map(plain),
      };
    });
  }

  /** Recovery work across the loans in the caller's scope (the recovery desk). */
  async desk(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'recovery.read',
      tenantResource(tenantId),
    );
    const scope = await this.policy.scopeFilter(actor, 'loan.read');
    if (!scope)
      return {
        repossessions: [],
        pawnItems: [],
        claims: [],
        premiums: [],
        debtSales: [],
        refunds: [],
        pendingTasks: [],
      };
    return this.lp.tenantTx(tenantId, async (tx) => {
      const businessDate = await this.businessDate.get(tenantId, tx);
      const [repossessions, pawnItems, claims, policies, debtSales, refunds] =
        await Promise.all([
          tx.repossession.findMany({
            where: { tenantId, status: { in: IN_PROGRESS } },
            orderBy: { createdAt: 'asc' },
          }),
          tx.pawnItem.findMany({
            where: { tenantId, status: { in: ['IN_CUSTODY', 'FORFEITED'] } },
            orderBy: { redemptionDeadline: 'asc' },
          }),
          tx.insuranceClaim.findMany({
            where: {
              tenantId,
              OR: [{ status: 'PENDING' }, { status: 'SETTLED' }],
            },
            orderBy: { createdAt: 'asc' },
          }),
          tx.insurancePolicy.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'asc' },
          }),
          tx.debtSale.findMany({
            where: { tenantId, status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
          }),
          tx.recoveryRefund.findMany({
            where: { tenantId, status: 'PAYABLE' },
            orderBy: { createdAt: 'asc' },
          }),
        ]);
      const loanIds = [
        ...new Set(
          [
            ...repossessions,
            ...pawnItems,
            ...claims,
            ...policies,
            ...debtSales,
            ...refunds,
          ].map((r) => r.loanAccountId),
        ),
      ];
      const loans = await tx.loanAccount.findMany({
        where: {
          tenantId,
          id: { in: loanIds },
          ...(scope as Prisma.LoanAccountWhereInput),
        },
        select: {
          id: true,
          reference: true,
          status: true,
          currency: true,
          daysPastDue: true,
        },
      });
      const byId = new Map(loans.map((l) => [l.id, l]));
      const tasks = await tx.approvalTask.findMany({
        where: {
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: { in: loans.map((l) => l.id) },
          action: { in: TASK_KINDS },
          status: 'PENDING',
        },
        orderBy: { createdAt: 'asc' },
      });
      const withLoan = <T extends { loanAccountId: string }>(rows: T[]) =>
        rows
          .filter((r) => byId.has(r.loanAccountId))
          .map(
            (r): Record<string, unknown> => ({
              ...plain(r),
              loan: byId.get(r.loanAccountId),
            }),
          );
      return {
        businessDate,
        repossessions: withLoan(repossessions),
        pawnItems: withLoan(pawnItems).map((p) => ({
          ...p,
          pastDeadline:
            lending.compareDates(
              businessDate,
              p.redemptionDeadline as string,
            ) > 0,
        })),
        claims: withLoan(claims).filter(
          (c) =>
            c.status === 'PENDING' ||
            D(c.amountClaimed as string).gt(D(c.received as string)),
        ),
        premiums: withLoan(policies).filter((p) =>
          D(p.premium as string).gt(D(p.premiumRemitted as string)),
        ),
        debtSales: withLoan(debtSales),
        refunds: withLoan(refunds),
        pendingTasks: tasks.map((t) => ({
          ...plain(t),
          loan: byId.get(t.subjectId),
        })),
      };
    });
  }

  // ── UC-65 Repossession ────────────────────────────────────────────────────

  /** Propose seizing a pledged asset; a different user approves the seizure. */
  async proposeRepossession(
    actor: LendingActor,
    loanId: string,
    body: {
      collateralId: string;
      location: string;
      seizedOn: string;
      reason: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.repossession.propose',
        resourceOf(state),
        tx,
      );
      if (state.account.status !== 'ACTIVE')
        throw new ConflictException(`Loan is ${state.account.status}.`);
      const min = state.config.recovery.repossessionMinDpd;
      if (state.account.daysPastDue < min)
        throw new BadRequestException(
          `Repossession needs the loan to be at least ${min} days past due (currently ${state.account.daysPastDue}).`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      notFuture(body.seizedOn, businessDate, 'seizedOn');
      const pledge = await tx.collateralPledge.findFirst({
        where: {
          tenantId,
          collateralId: body.collateralId,
          applicationId: state.account.applicationId,
        },
      });
      if (!pledge)
        throw new NotFoundException(
          'This collateral is not pledged to this loan.',
        );
      if (pledge.status !== 'ACTIVE')
        throw new ConflictException(
          `This collateral is ${pledge.status.toLowerCase()}.`,
        );
      const open = await tx.repossession.findFirst({
        where: {
          tenantId,
          collateralId: body.collateralId,
          status: { in: IN_PROGRESS },
        },
      });
      if (open)
        throw new ConflictException(
          'A repossession of this asset is already in progress.',
        );
      const repo = await tx.repossession.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          collateralId: body.collateralId,
          location: body.location.slice(0, 200),
          seizedOn: fromLocalDate(body.seizedOn),
          reason: body.reason.slice(0, 500),
          proposedBy: actor.id,
        },
      });
      const task = await this.task(tx, state, actor, 'REPOSSESSION_SEIZURE', {
        repossessionId: repo.id,
        collateralId: body.collateralId,
        location: repo.location,
      });
      await tx.repossession.updateMany({
        where: { id: repo.id, tenantId },
        data: { taskId: task.id },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.repossession.propose',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            repossession: repo.id,
            collateralId: body.collateralId,
            task: task.id,
          },
        },
        tx,
      );
      return { ...plain(repo), taskId: task.id };
    });
  }

  /** Repossession valuation of the seized asset. */
  async valueRepossession(
    actor: LendingActor,
    loanId: string,
    repossessionId: string,
    body: { marketValue: string; valuer: string; valuationDate: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.repossession.value',
        resourceOf(state),
        tx,
      );
      const repo = await this.repossessionOf(tx, state, repossessionId);
      if (repo.status !== 'SEIZED' && repo.status !== 'VALUED')
        throw new ConflictException(
          repo.status === 'PROPOSED'
            ? 'The seizure has not been approved yet.'
            : `This repossession is ${repo.status.toLowerCase()}.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      notFuture(body.valuationDate, businessDate, 'valuationDate');
      const value = lending.parseMoney(
        body.marketValue,
        state.account.currency,
        'marketValue',
      );
      if (value.lte(0))
        throw new BadRequestException('A valuation must be positive.');
      // The collateral's own valuation history records it too.
      await tx.valuation.create({
        data: {
          tenantId,
          collateralId: repo.collateralId,
          valuationDate: fromLocalDate(body.valuationDate),
          marketValue: value.toString(),
          valuer: body.valuer.slice(0, 120),
          method: 'REPOSSESSION',
          recordedBy: actor.id,
        },
      });
      const res = await tx.repossession.updateMany({
        where: { id: repo.id, tenantId, status: repo.status },
        data: {
          status: 'VALUED',
          valuationAmount: value.toString(),
          valuer: body.valuer.slice(0, 120),
          valuedOn: fromLocalDate(body.valuationDate),
        },
      });
      if (res.count !== 1) throw concurrentModification('This repossession');
      await this.audit.write(
        {
          actor,
          action: 'loan.repossession.value',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { repossession: repo.id, marketValue: value.toString() },
        },
        tx,
      );
      return plain(await this.repossessionOf(tx, state, repossessionId));
    });
  }

  /** Sell the repossessed asset and apply the proceeds to the loan. */
  async sellRepossession(
    actor: LendingActor,
    loanId: string,
    repossessionId: string,
    body: {
      salePrice: string;
      costs?: string;
      buyer: string;
      saleDate: string;
      externalReference?: string;
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({
      op: 'repossession-sale',
      loanId,
      repossessionId,
      body,
    });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.repossession.sell',
        resourceOf(state, [], body.salePrice),
        tx,
      );
      const repo = await this.repossessionOf(tx, state, repossessionId);
      if (repo.status !== 'VALUED')
        throw new ConflictException(
          repo.status === 'SEIZED'
            ? 'Record the repossession valuation before the sale.'
            : `This repossession is ${repo.status.toLowerCase()}.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      notFuture(body.saleDate, businessDate, 'saleDate');
      const out = await this.applyProceeds(tx, state, actor, {
        type: 'REPOSSESSION_SALE',
        gross: body.salePrice,
        costs: body.costs ?? '0',
        funding: state.config.accounting.cash,
        businessDate,
        valueDate: businessDate,
        idempotencyKey,
        hash,
        narrative: `Sale of repossessed collateral to ${body.buyer.slice(0, 80)}`,
        externalReference: body.externalReference ?? null,
        components: {
          repossession: repo.id,
          collateralId: repo.collateralId,
          buyer: body.buyer.slice(0, 120),
          saleDate: body.saleDate,
          valuation: decStr(repo.valuationAmount),
        },
        refund: {
          source: 'REPOSSESSION',
          sourceId: repo.id,
          payee: 'Borrower',
        },
      });
      const res = await tx.repossession.updateMany({
        where: { id: repo.id, tenantId, status: 'VALUED' },
        data: {
          status: 'SOLD',
          salePrice: out.result.grossProceeds,
          saleCosts: out.result.costs,
          buyer: body.buyer.slice(0, 120),
          soldOn: fromLocalDate(body.saleDate),
          saleEventId: out.event.id,
          surplus: out.result.surplus,
          deficiency: out.result.deficiencyTotal,
        },
      });
      if (res.count !== 1) throw concurrentModification('This repossession');
      const sold = await tx.collateralPledge.updateMany({
        where: {
          tenantId,
          collateralId: repo.collateralId,
          applicationId: state.account.applicationId,
          status: 'ACTIVE',
        },
        data: {
          status: 'SOLD',
          releasedAt: new Date(),
          releasedBy: actor.id,
          releaseReference: `SOLD ${body.externalReference ?? body.buyer}`.slice(
            0,
            120,
          ),
        },
      });
      if (sold.count !== 1) throw concurrentModification('This pledge');
      await this.servicing.outbox(tx, tenantId, 'lending.repossession_sold', {
        loanAccountId: loanId,
        repossessionId: repo.id,
        surplus: out.result.surplus,
        deficiency: out.result.deficiencyTotal,
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.repossession.sell',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            repossession: repo.id,
            event: out.event.id,
            salePrice: out.result.grossProceeds,
            costs: out.result.costs,
            surplus: out.result.surplus,
            deficiency: out.result.deficiencyTotal,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return { event: out.event, proceeds: out.result, refund: out.refund };
    });
  }

  // ── UC-66 / LT-09 Pawn and gold ───────────────────────────────────────────

  /** Take an item into custody against the loan, valued by weight × purity × price. */
  async receivePawn(
    actor: LendingActor,
    loanId: string,
    body: {
      description: string;
      itemType: 'GOLD' | 'JEWELLERY' | 'OTHER';
      weightGrams: string;
      karat?: number;
      purity?: string;
      pricePerGram: string;
      custodyLocation: string;
      sealNumber?: string;
      receivedOn: string;
      redemptionDeadline: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.pawn.custody',
        resourceOf(state),
        tx,
      );
      if (!['BOOKED', 'ACTIVE'].includes(state.account.status))
        throw new ConflictException(`Loan is ${state.account.status}.`);
      const businessDate = await this.businessDate.get(tenantId, tx);
      notFuture(body.receivedOn, businessDate, 'receivedOn');
      lending.parseDate(body.redemptionDeadline, 'redemptionDeadline');
      if (lending.compareDates(body.redemptionDeadline, body.receivedOn) <= 0)
        throw new BadRequestException(
          'The redemption deadline must be after the day the item is received.',
        );
      const v = engineCall(() =>
        lending.pawnValuation(
          {
            weightGrams: body.weightGrams,
            karat: body.karat,
            purity: body.purity,
            pricePerGram: body.pricePerGram,
            maxLtv: state.config.security.maxLtv,
          },
          state.account.currency,
          state.config.pricing.rounding,
        ),
      );
      const item = await tx.pawnItem.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          description: body.description.slice(0, 300),
          itemType: body.itemType,
          weightGrams: body.weightGrams,
          karat: body.karat ?? null,
          purity: v.fineness,
          pricePerGram: body.pricePerGram,
          appraisedValue: v.value,
          custodyLocation: body.custodyLocation.slice(0, 200),
          sealNumber: body.sealNumber?.slice(0, 60) ?? null,
          receivedOn: fromLocalDate(body.receivedOn),
          redemptionDeadline: fromLocalDate(body.redemptionDeadline),
          createdBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.pawn.custody',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { pawnItem: item.id, value: v.value, fineness: v.fineness },
        },
        tx,
      );
      return { item: plain(item), valuation: v };
    });
  }

  /** After the redemption deadline, propose forfeiting the item; a different user approves. */
  async proposeForfeiture(
    actor: LendingActor,
    loanId: string,
    itemId: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.pawn.forfeit.propose',
        resourceOf(state),
        tx,
      );
      const item = await this.pawnOf(tx, state, itemId);
      if (item.status !== 'IN_CUSTODY')
        throw new ConflictException(
          `This item is ${item.status.toLowerCase().replace('_', ' ')}.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      this.assertForfeitable(state, item, businessDate);
      const open = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectId: loanId,
          action: 'PAWN_FORFEITURE',
          status: 'PENDING',
          payload: { path: ['pawnItemId'], equals: itemId },
        },
      });
      if (open)
        throw new ConflictException(
          'A forfeiture of this item is already awaiting approval.',
        );
      const task = await this.task(tx, state, actor, 'PAWN_FORFEITURE', {
        pawnItemId: itemId,
        reason: body.reason.slice(0, 500),
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.pawn.forfeit.propose',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { pawnItem: itemId, task: task.id },
        },
        tx,
      );
      return task;
    });
  }

  /** Auction a forfeited item and apply the proceeds to the loan. */
  async sellPawn(
    actor: LendingActor,
    loanId: string,
    itemId: string,
    body: {
      salePrice: string;
      costs?: string;
      buyer: string;
      saleDate: string;
      externalReference?: string;
    },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'pawn-sale', loanId, itemId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.pawn.sell',
        resourceOf(state, [], body.salePrice),
        tx,
      );
      const item = await this.pawnOf(tx, state, itemId);
      if (item.status !== 'FORFEITED')
        throw new ConflictException(
          item.status === 'IN_CUSTODY'
            ? 'Only a forfeited item can be auctioned.'
            : `This item is ${item.status.toLowerCase().replace('_', ' ')}.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      notFuture(body.saleDate, businessDate, 'saleDate');
      const out = await this.applyProceeds(tx, state, actor, {
        type: 'PAWN_SALE',
        gross: body.salePrice,
        costs: body.costs ?? '0',
        funding: state.config.accounting.cash,
        businessDate,
        valueDate: businessDate,
        idempotencyKey,
        hash,
        narrative: `Auction of forfeited pawn: ${item.description.slice(0, 60)}`,
        externalReference: body.externalReference ?? null,
        components: {
          pawnItem: item.id,
          buyer: body.buyer.slice(0, 120),
          saleDate: body.saleDate,
          appraisedValue: decStr(item.appraisedValue),
        },
        refund: { source: 'PAWN_AUCTION', sourceId: item.id, payee: 'Borrower' },
      });
      const res = await tx.pawnItem.updateMany({
        where: { id: item.id, tenantId, status: 'FORFEITED' },
        data: {
          status: 'SOLD',
          salePrice: out.result.grossProceeds,
          saleCosts: out.result.costs,
          buyer: body.buyer.slice(0, 120),
          soldOn: fromLocalDate(body.saleDate),
          saleEventId: out.event.id,
          surplus: out.result.surplus,
          deficiency: out.result.deficiencyTotal,
        },
      });
      if (res.count !== 1) throw concurrentModification('This pawn item');
      await this.audit.write(
        {
          actor,
          action: 'loan.pawn.sell',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            pawnItem: item.id,
            event: out.event.id,
            surplus: out.result.surplus,
            deficiency: out.result.deficiencyTotal,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return { event: out.event, proceeds: out.result, refund: out.refund };
    });
  }

  /** The loan is repaid: hand the item back to the borrower. */
  async returnPawn(
    actor: LendingActor,
    loanId: string,
    itemId: string,
    body: { reference: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.pawn.return',
        resourceOf(state),
        tx,
      );
      if (state.account.status !== 'CLOSED')
        throw new ConflictException(
          'A pawned item is returned once the loan is repaid and closed.',
        );
      const item = await this.pawnOf(tx, state, itemId);
      if (item.status !== 'IN_CUSTODY')
        throw new ConflictException(
          `This item is ${item.status.toLowerCase().replace('_', ' ')}.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const res = await tx.pawnItem.updateMany({
        where: { id: itemId, tenantId, status: 'IN_CUSTODY' },
        data: {
          status: 'RETURNED',
          returnedOn: fromLocalDate(businessDate),
          returnReference: body.reference.slice(0, 120),
        },
      });
      if (res.count !== 1) throw concurrentModification('This pawn item');
      await this.audit.write(
        {
          actor,
          action: 'loan.pawn.return',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { pawnItem: itemId, reference: body.reference },
        },
        tx,
      );
      return plain(await this.pawnOf(tx, state, itemId));
    });
  }

  // ── UC-68 / UC-06 Credit insurance ────────────────────────────────────────

  /**
   * Record the policy covering the loan. A FINANCED premium was booked in the
   * principal at disbursement and credited to the insurer payable (a fee with
   * payee INSURER); a PAID premium is received now in cash (Dr cash, Cr
   * insurer payable). Neither is ever fee income.
   */
  async recordPolicy(
    actor: LendingActor,
    loanId: string,
    body: {
      insurer: string;
      policyNumber: string;
      coverType: 'DEATH' | 'DISABILITY' | 'DEATH_AND_DISABILITY';
      premium?: string;
      premiumTreatment: 'FINANCED' | 'PAID';
      startDate: string;
      externalReference?: string;
    },
    idempotencyKey: string | undefined,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'insurance-policy', loanId, body });
    const work = async (tx: Tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.insurance.manage',
        resourceOf(state),
        tx,
      );
      if (state.account.status !== 'ACTIVE')
        throw new ConflictException(`Loan is ${state.account.status}.`);
      lending.parseDate(body.startDate, 'startDate');
      const cur = state.account.currency;
      const dupe = await tx.insurancePolicy.findFirst({
        where: {
          tenantId,
          insurer: body.insurer,
          policyNumber: body.policyNumber,
        },
      });
      if (dupe)
        throw new ConflictException(
          'This insurer’s policy number is already recorded.',
        );
      let premium: Dec;
      if (body.premiumTreatment === 'FINANCED') {
        // What the disbursement booked for the insurer, less policies already
        // recorded against it.
        const disbursement = await tx.financialEvent.findFirst({
          where: {
            tenantId,
            loanAccountId: loanId,
            type: 'DISBURSEMENT',
            status: 'POSTED',
          },
        });
        const fees =
          (
            disbursement?.components as
              | { fees?: lending.FeeLine[] }
              | undefined
          )?.fees ?? [];
        const financed = fees
          .filter(
            (f) =>
              f.payee === 'INSURER' && !f.waived && f.treatment === 'FINANCED',
          )
          .reduce((s, f) => s.plus(D(f.amount)), D(0));
        const recorded = await tx.insurancePolicy.aggregate({
          where: {
            tenantId,
            loanAccountId: loanId,
            premiumTreatment: 'FINANCED',
          },
          _sum: { premium: true },
        });
        const available = financed.minus(D(recorded._sum.premium ?? '0'));
        if (available.lte(0))
          throw new BadRequestException(
            'This loan financed no insurance premium (a FINANCED fee with payee INSURER) that is not already covered by a policy.',
          );
        premium = body.premium
          ? D(lending.parseMoney(body.premium, cur, 'premium'))
          : available;
        if (premium.gt(available) || premium.lte(0))
          throw new BadRequestException(
            `The financed premium available for a policy is ${available} ${cur}.`,
          );
      } else {
        if (!body.premium)
          throw new BadRequestException('Give the premium the borrower paid.');
        premium = D(lending.parseMoney(body.premium, cur, 'premium'));
        if (premium.lte(0))
          throw new BadRequestException('The premium must be positive.');
      }
      const businessDate = await this.businessDate.get(tenantId, tx);
      let premiumEventId: string | null = null;
      if (body.premiumTreatment === 'PAID') {
        const acc = state.config.accounting;
        const event = await this.servicing.recordEvent(tx, state, {
          type: 'INSURANCE_PREMIUM',
          amount: premium,
          businessDate,
          valueDate: businessDate,
          components: {
            insurer: body.insurer,
            policyNumber: body.policyNumber,
          },
          idempotencyKey: idempotencyKey!,
          requestHash: hash,
          actor,
          narrative: `Insurance premium received for ${body.insurer.slice(0, 60)}`,
          externalReference: body.externalReference?.slice(0, 120) ?? null,
          lines: [
            { accountCode: acc.cash, debit: premium.toString() },
            { accountCode: acc.insurerPayable, credit: premium.toString() },
          ],
        });
        premiumEventId = event.id;
        await this.servicing.casAccount(tx, state, 'ACTIVE', {});
      }
      const policy = await tx.insurancePolicy.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          insurer: body.insurer.slice(0, 120),
          policyNumber: body.policyNumber.slice(0, 60),
          coverType: body.coverType,
          premium: premium.toString(),
          premiumTreatment: body.premiumTreatment,
          currency: cur,
          startDate: fromLocalDate(body.startDate),
          premiumEventId,
          createdBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.insurance.manage',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            policy: policy.id,
            premium: premium.toString(),
            treatment: body.premiumTreatment,
          },
        },
        tx,
      );
      return plain(policy);
    };
    // A paid premium moves money, so it is idempotent like any other.
    if (body.premiumTreatment === 'PAID')
      return this.servicing.money(tenantId, idempotencyKey ?? '', hash, work);
    return this.lp.tenantTx(tenantId, work);
  }

  /** Propose paying the premium held for the insurer over to them. */
  async proposeRemittance(
    actor: LendingActor,
    loanId: string,
    policyId: string,
    body: { amount?: string; reference: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const policy = await this.policyOf(tx, state, policyId);
      const due = D(policy.premium).minus(D(policy.premiumRemitted));
      const amount = body.amount
        ? D(
            lending.parseMoney(body.amount, state.account.currency, 'amount'),
          )
        : due;
      await this.policy.enforce(
        actor,
        'loan.insurance.remit.propose',
        resourceOf(state, [], amount.toString()),
        tx,
      );
      if (amount.lte(0) || amount.gt(due))
        throw new BadRequestException(
          `At most ${due} ${state.account.currency} of premium is held for this insurer.`,
        );
      const open = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectId: loanId,
          action: 'PREMIUM_REMITTANCE',
          status: 'PENDING',
          payload: { path: ['policyId'], equals: policyId },
        },
      });
      if (open)
        throw new ConflictException(
          'A remittance for this policy is already awaiting approval.',
        );
      const task = await this.task(
        tx,
        state,
        actor,
        'PREMIUM_REMITTANCE',
        {
          policyId,
          insurer: policy.insurer,
          reference: body.reference.slice(0, 120),
        },
        amount,
      );
      await this.audit.write(
        {
          actor,
          action: 'loan.insurance.remit.propose',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { policy: policyId, task: task.id, amount: amount.toString() },
        },
        tx,
      );
      return task;
    });
  }

  /** File a death or disability claim; a different user approves it. */
  async fileClaim(
    actor: LendingActor,
    loanId: string,
    policyId: string,
    body: {
      eventType: 'DEATH' | 'DISABILITY';
      eventDate: string;
      evidenceReference: string;
      amountClaimed?: string;
      note?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.insurance.claim.propose',
        resourceOf(state),
        tx,
      );
      if (state.account.status !== 'ACTIVE')
        throw new ConflictException(`Loan is ${state.account.status}.`);
      const policy = await this.policyOf(tx, state, policyId);
      if (policy.status !== 'ACTIVE')
        throw new ConflictException('A claim has already been paid on this policy.');
      if (
        policy.coverType !== 'DEATH_AND_DISABILITY' &&
        policy.coverType !== body.eventType
      )
        throw new BadRequestException(
          `This policy covers ${policy.coverType.toLowerCase()} only.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      notFuture(body.eventDate, businessDate, 'eventDate');
      if (
        lending.compareDates(body.eventDate, toLocalDate(policy.startDate)!) < 0
      )
        throw new BadRequestException(
          'The event happened before the cover started.',
        );
      const pending = await tx.insuranceClaim.findFirst({
        where: { tenantId, policyId, status: 'PENDING' },
      });
      if (pending)
        throw new ConflictException('A claim on this policy is already pending.');
      // By default the insurer is asked for what the loan owes today.
      const claimed = body.amountClaimed
        ? D(
            lending.parseMoney(
              body.amountClaimed,
              state.account.currency,
              'amountClaimed',
            ),
          )
        : owedTotal(state);
      if (claimed.lte(0))
        throw new BadRequestException('The amount claimed must be positive.');
      const claim = await tx.insuranceClaim.create({
        data: {
          tenantId,
          policyId,
          loanAccountId: loanId,
          eventType: body.eventType,
          eventDate: fromLocalDate(body.eventDate),
          evidenceReference: body.evidenceReference.slice(0, 200),
          note: (body.note ?? '').slice(0, 500),
          amountClaimed: claimed.toString(),
          createdBy: actor.id,
        },
      });
      const task = await this.task(
        tx,
        state,
        actor,
        'INSURANCE_CLAIM',
        {
          claimId: claim.id,
          policyId,
          eventType: body.eventType,
          // No amount given: the insurer covers the balance at settlement.
          coversBalance: !body.amountClaimed,
        },
        claimed,
      );
      await tx.insuranceClaim.updateMany({
        where: { id: claim.id, tenantId },
        data: { taskId: task.id },
      });
      await this.audit.write(
        {
          actor,
          action: 'loan.insurance.claim.propose',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            claim: claim.id,
            task: task.id,
            amount: claimed.toString(),
          },
        },
        tx,
      );
      return { ...plain(claim), taskId: task.id };
    });
  }

  /** The insurer pays (part of) a settled claim: Dr cash, Cr claims receivable. */
  async receiveClaimPayment(
    actor: LendingActor,
    loanId: string,
    claimId: string,
    body: { amount: string; externalReference: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'claim-receipt', loanId, claimId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'loan.insurance.claim.receive',
        resourceOf(state, [], body.amount),
        tx,
      );
      const claim = await tx.insuranceClaim.findFirst({
        where: { id: claimId, tenantId, loanAccountId: loanId },
      });
      if (!claim) throw new NotFoundException('Claim not found');
      if (claim.status !== 'SETTLED')
        throw new ConflictException(
          'Insurer payments are received against an approved claim.',
        );
      const amount = D(
        lending.parseMoney(body.amount, state.account.currency, 'amount'),
      );
      const due = D(claim.amountClaimed).minus(D(claim.received));
      if (amount.lte(0) || amount.gt(due))
        throw new BadRequestException(
          `The insurer owes ${due} ${state.account.currency} on this claim.`,
        );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const acc = state.config.accounting;
      const event = await this.servicing.recordEvent(tx, state, {
        type: 'INSURANCE_CLAIM_RECEIPT',
        amount,
        businessDate,
        valueDate: businessDate,
        components: { claim: claimId },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: 'Insurer payment on credit-insurance claim',
        externalReference: body.externalReference.slice(0, 120),
        lines: [
          { accountCode: acc.cash, debit: amount.toString() },
          {
            accountCode: acc.insuranceClaimsReceivable,
            credit: amount.toString(),
          },
        ],
      });
      const res = await tx.insuranceClaim.updateMany({
        where: { id: claimId, tenantId, received: claim.received },
        data: { received: D(claim.received).plus(amount).toString() },
      });
      if (res.count !== 1) throw concurrentModification('This claim');
      await this.audit.write(
        {
          actor,
          action: 'loan.insurance.claim.receive',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { claim: claimId, event: event.id, amount: amount.toString() },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return event;
    });
  }

  // ── UC-71 Debt sale ───────────────────────────────────────────────────────

  /** Propose selling the loan to a collection agency; a different user approves. */
  async proposeDebtSale(
    actor: LendingActor,
    loanId: string,
    body: {
      buyer: string;
      price: string;
      saleDate: string;
      reason: string;
      externalReference?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const price = lending.parseMoney(
        body.price,
        state.account.currency,
        'price',
      );
      await this.policy.enforce(
        actor,
        'loan.debt_sale.propose',
        resourceOf(state, [], price.toString()),
        tx,
      );
      await this.assertSellable(tx, state);
      if (price.lte(0))
        throw new BadRequestException('The sale price must be positive.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      notFuture(body.saleDate, businessDate, 'saleDate');
      const pending = await tx.debtSale.findFirst({
        where: {
          tenantId,
          loanAccountId: loanId,
          status: { in: ['PENDING', 'EXECUTED'] },
        },
      });
      if (pending)
        throw new ConflictException(
          pending.status === 'EXECUTED'
            ? 'This loan has already been sold.'
            : 'A sale of this loan is already awaiting approval.',
        );
      const sale = await tx.debtSale.create({
        data: {
          tenantId,
          loanAccountId: loanId,
          buyer: body.buyer.slice(0, 120),
          price: price.toString(),
          saleDate: fromLocalDate(body.saleDate),
          reason: body.reason.slice(0, 500),
          externalReference: body.externalReference?.slice(0, 120) ?? null,
          proposedBy: actor.id,
        },
      });
      const task = await this.task(
        tx,
        state,
        actor,
        'DEBT_SALE',
        { debtSaleId: sale.id, buyer: sale.buyer },
        D(price),
      );
      await tx.debtSale.updateMany({
        where: { id: sale.id, tenantId },
        data: { taskId: task.id },
      });
      // What approving it would book, so the checker sees the loss up front.
      const preview = engineCall(() =>
        lending.debtSaleResult(
          {
            price: price.toString(),
            owed: owedPosition(state),
            allowance: decStr(state.account.allowance),
            interestInSuspense: decStr(state.account.interestInSuspense),
          },
          state.account.currency,
        ),
      );
      await this.audit.write(
        {
          actor,
          action: 'loan.debt_sale.propose',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: { debtSale: sale.id, task: task.id, price: price.toString() },
        },
        tx,
      );
      return { ...plain(sale), taskId: task.id, preview };
    });
  }

  // ── Refund of a recovery surplus ──────────────────────────────────────────

  /** Propose the payout of a held surplus again (after a rejected payout). */
  async proposeRefundPayout(
    actor: LendingActor,
    loanId: string,
    refundId: string,
    body: { payee?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const refund = await tx.recoveryRefund.findFirst({
        where: { id: refundId, tenantId, loanAccountId: loanId },
      });
      if (!refund) throw new NotFoundException('Refund not found');
      await this.policy.enforce(
        actor,
        'loan.recovery_refund.propose',
        resourceOf(state, [], decStr(refund.amount)),
        tx,
      );
      if (refund.status !== 'PAYABLE')
        throw new ConflictException('This refund has already been paid.');
      const open = await tx.approvalTask.findFirst({
        where: {
          tenantId,
          subjectId: loanId,
          action: 'RECOVERY_REFUND',
          status: 'PENDING',
          payload: { path: ['refundId'], equals: refundId },
        },
      });
      if (open)
        throw new ConflictException(
          'A payout of this refund is already awaiting approval.',
        );
      if (body.payee)
        await tx.recoveryRefund.updateMany({
          where: { id: refundId, tenantId, status: 'PAYABLE' },
          data: { payee: body.payee.slice(0, 120) },
        });
      const task = await this.task(
        tx,
        state,
        actor,
        'RECOVERY_REFUND',
        { refundId, payee: body.payee?.slice(0, 120) ?? refund.payee },
        D(refund.amount),
      );
      await tx.recoveryRefund.updateMany({
        where: { id: refundId, tenantId },
        data: { taskId: task.id },
      });
      return task;
    });
  }

  // ── Decisions (maker-checker) ─────────────────────────────────────────────

  /**
   * Approve or reject a recovery task. The task names its own action, which
   * carries the permission, maker-checker and authority conditions; approving
   * one that moves money posts it here, under the request's idempotency key.
   */
  async decide(
    actor: LendingActor,
    loanId: string,
    taskId: string,
    body: { approve: boolean; comment?: string },
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'recovery-decision', loanId, taskId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      const task = await tx.approvalTask.findFirst({
        where: {
          id: taskId,
          tenantId,
          subjectType: 'LOAN_ACCOUNT',
          subjectId: loanId,
          action: { in: TASK_KINDS },
        },
      });
      if (!task) throw new NotFoundException('Recovery task not found');
      const kind = task.action as TaskKind;
      const decision = await this.policy.enforce(
        actor,
        TASKS[kind],
        resourceOf(
          state,
          [task.makerId],
          task.amount ? decStr(task.amount) : undefined,
        ),
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
      if (res.count !== 1) throw concurrentModification('This recovery task');
      const p = task.payload as Record<string, string>;
      const businessDate = await this.businessDate.get(tenantId, tx);
      const ctx = { idempotencyKey, hash, businessDate };
      let result: unknown = { approved: body.approve };

      switch (kind) {
        case 'REPOSSESSION_SEIZURE': {
          const r = await tx.repossession.updateMany({
            where: { id: p.repossessionId, tenantId, status: 'PROPOSED' },
            data: body.approve
              ? { status: 'SEIZED', approvedBy: actor.id }
              : { status: 'REJECTED', approvedBy: actor.id },
          });
          if (r.count !== 1) throw concurrentModification('This repossession');
          if (body.approve)
            await this.servicing.outbox(
              tx,
              tenantId,
              'lending.repossession_seized',
              { loanAccountId: loanId, repossessionId: p.repossessionId },
            );
          break;
        }
        case 'PAWN_FORFEITURE': {
          if (body.approve) {
            const item = await this.pawnOf(tx, state, p.pawnItemId);
            this.assertForfeitable(state, item, businessDate);
            const r = await tx.pawnItem.updateMany({
              where: { id: item.id, tenantId, status: 'IN_CUSTODY' },
              data: { status: 'FORFEITED', forfeitedAt: new Date() },
            });
            if (r.count !== 1) throw concurrentModification('This pawn item');
            await this.servicing.outbox(
              tx,
              tenantId,
              'lending.pawn_forfeited',
              { loanAccountId: loanId, pawnItemId: item.id },
            );
          }
          break;
        }
        case 'PREMIUM_REMITTANCE': {
          if (body.approve)
            result = await this.remit(tx, state, actor, task, ctx);
          break;
        }
        case 'INSURANCE_CLAIM': {
          if (body.approve) {
            result = await this.settleClaim(tx, state, actor, task, ctx);
          } else {
            await tx.insuranceClaim.updateMany({
              where: { id: p.claimId, tenantId, status: 'PENDING' },
              data: { status: 'REJECTED' },
            });
          }
          break;
        }
        case 'DEBT_SALE': {
          if (body.approve) {
            result = await this.executeDebtSale(tx, state, actor, task, ctx);
          } else {
            await tx.debtSale.updateMany({
              where: { id: p.debtSaleId, tenantId, status: 'PENDING' },
              data: { status: 'REJECTED', approvedBy: actor.id },
            });
          }
          break;
        }
        case 'RECOVERY_REFUND': {
          if (body.approve)
            result = await this.payRefund(tx, state, actor, task, ctx);
          break;
        }
      }
      await this.audit.write(
        {
          actor,
          action: TASKS[kind],
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          decision,
          details: { task: taskId, kind, approve: body.approve },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return result;
    });
  }

  // ── Internals: money ──────────────────────────────────────────────────────

  /**
   * Apply recovery money to the loan through the proceeds waterfall.
   *
   * Paid in full: the schedule is superseded and the loan closes, its
   * allowance released. A deficiency: the amounts are placed on the
   * instalments oldest first so the schedule keeps agreeing with the
   * balances, and the loan stays open for what is still owed.
   */
  private async applyProceeds(
    tx: Tx,
    stateIn: LoanState,
    actor: LendingActor,
    o: {
      type: string;
      gross: string;
      costs: string;
      /** Account the gross proceeds arrive in (cash, or a claim on the insurer). */
      funding: string;
      businessDate: string;
      valueDate: string;
      idempotencyKey: string;
      hash: string;
      narrative: string;
      externalReference: string | null;
      components: Record<string, unknown>;
      refund: { source: string; sourceId: string; payee: string };
    },
  ) {
    if (stateIn.account.status !== 'ACTIVE')
      throw new ConflictException(`Loan is ${stateIn.account.status}.`);
    refuseWhileAdvanceHeld(stateIn, 'apply recovery proceeds');
    const state = await this.servicing.catchUp(
      tx,
      stateIn,
      o.valueDate,
      o.businessDate,
      actor,
    );
    const a = state.account;
    const acc = state.config.accounting;
    const result = engineCall(() =>
      lending.applyRecoveryProceeds(
        {
          grossProceeds: o.gross,
          costs: o.costs,
          owed: owedPosition(state),
          order: state.config.recovery.proceedsOrder,
        },
        a.currency,
      ),
    );
    const paid = (c: string) =>
      D(result.applied.find((x) => x.component === c)?.amount ?? '0');
    const interest = paid('INTEREST');
    const released = suspenseRelease(state, interest);
    const settles = result.settlesLoan;
    const allowance = settles ? allowanceRelease(state) : null;
    const lines: PostingLine[] = [
      { accountCode: o.funding, debit: result.grossProceeds },
      { accountCode: acc.cash, credit: result.costs },
      {
        accountCode: acc.recoveryCostsExpense,
        debit: result.unrecoveredCosts,
      },
      { accountCode: acc.loansReceivable, credit: paid('PRINCIPAL').toString() },
      { accountCode: acc.interestReceivable, credit: interest.toString() },
      { accountCode: acc.feesReceivable, credit: paid('FEE').toString() },
      {
        accountCode: acc.penaltyReceivable,
        credit: paid('PENALTY').toString(),
      },
      { accountCode: acc.borrowerRefundsPayable, credit: result.surplus },
      ...released.lines,
      ...(allowance?.lines ?? []),
    ];
    const components = {
      ...o.components,
      grossProceeds: result.grossProceeds,
      costs: result.costs,
      unrecoveredCosts: result.unrecoveredCosts,
      applied: result.applied,
      surplus: result.surplus,
      deficiency: result.deficiency,
      interestInSuspenseReleased: released.amount.toString(),
      allowanceReleased: allowance?.amount.toString() ?? '0',
    };
    const next = {
      principalOutstanding: D(a.principalOutstanding).minus(paid('PRINCIPAL')),
      interestReceivable: D(a.interestReceivable).minus(interest),
      feesReceivable: D(a.feesReceivable).minus(paid('FEE')),
      penaltyReceivable: D(a.penaltyReceivable).minus(paid('PENALTY')),
      interestInSuspense: D(a.interestInSuspense).minus(released.amount),
    };
    let event;
    if (settles) {
      await tx.scheduleInstalment.updateMany({
        where: { tenantId: a.tenantId, loanAccountId: a.id, status: 'DUE' },
        data: { status: 'SUPERSEDED' },
      });
      event = await this.servicing.recordEvent(tx, state, {
        type: o.type,
        amount: D(result.grossProceeds),
        businessDate: o.businessDate,
        valueDate: o.valueDate,
        components,
        idempotencyKey: o.idempotencyKey,
        requestHash: o.hash,
        actor,
        narrative: o.narrative,
        externalReference: o.externalReference?.slice(0, 120) ?? null,
        lines,
      });
      await this.servicing.casAccount(tx, state, 'ACTIVE', {
        status: 'CLOSED',
        closedAt: new Date(),
        principalOutstanding: '0',
        interestReceivable: '0',
        feesReceivable: '0',
        penaltyReceivable: '0',
        interestInSuspense: '0',
        allowance: '0',
        lastAccrualDate: a.lastAccrualDate,
        daysPastDue: 0,
        delinquencyBucket: 'CURRENT',
        collectionStage: null,
        nonAccrual: false,
        nonAccrualSince: null,
      });
    } else {
      const spread = lending.spreadOverInstalments(
        state.lines
          .filter((l) => l.status === 'DUE')
          .map((l) => ({
            number: l.number,
            outstanding: Object.fromEntries(
              Object.entries(outstanding(l)).map(([k, v]) => [
                k,
                lending.D.max(0, v).toString(),
              ]),
            ),
          })),
        result.applied,
      );
      // Principal must land on the schedule (it is reconciled against it);
      // charges are carried on the account balances.
      if (spread.unplaced.some((u) => u.component === 'PRINCIPAL'))
        throw new ConflictException(
          'The schedule does not carry the principal this sale would repay; reconcile the loan first.',
        );
      await this.servicing.applyAllocations(tx, state, spread.allocations);
      event = await this.servicing.recordEvent(
        tx,
        state,
        {
          type: o.type,
          amount: D(result.grossProceeds),
          businessDate: o.businessDate,
          valueDate: o.valueDate,
          components: { ...components, unplacedOnSchedule: spread.unplaced },
          idempotencyKey: o.idempotencyKey,
          requestHash: o.hash,
          actor,
          narrative: o.narrative,
          externalReference: o.externalReference?.slice(0, 120) ?? null,
          lines,
        },
        spread.allocations,
      );
      await this.servicing.casAccount(tx, state, 'ACTIVE', {
        principalOutstanding: next.principalOutstanding.toString(),
        interestReceivable: next.interestReceivable.toString(),
        feesReceivable: next.feesReceivable.toString(),
        penaltyReceivable: next.penaltyReceivable.toString(),
        interestInSuspense: next.interestInSuspense.toString(),
        lastAccrualDate: a.lastAccrualDate,
      });
    }
    let refund: Record<string, unknown> | null = null;
    if (D(result.surplus).gt(0)) {
      const row = await tx.recoveryRefund.create({
        data: {
          tenantId: a.tenantId,
          loanAccountId: a.id,
          source: o.refund.source,
          sourceId: o.refund.sourceId,
          payee: o.refund.payee,
          amount: result.surplus,
          currency: a.currency,
          sourceEventId: event.id,
        },
      });
      // The payout itself needs a second user.
      const task = await this.task(
        tx,
        state,
        actor,
        'RECOVERY_REFUND',
        { refundId: row.id, payee: row.payee },
        D(result.surplus),
      );
      await tx.recoveryRefund.updateMany({
        where: { id: row.id, tenantId: a.tenantId },
        data: { taskId: task.id },
      });
      refund = { ...plain(row), taskId: task.id };
    }
    if (settles)
      await this.servicing.outbox(tx, a.tenantId, 'lending.loan_closed', {
        loanAccountId: a.id,
        by: o.type,
      });
    return { event, result, refund };
  }

  private async settleClaim(
    tx: Tx,
    stateIn: LoanState,
    actor: LendingActor,
    task: { id: string; payload: unknown; amount: Prisma.Decimal | null },
    ctx: { idempotencyKey: string; hash: string; businessDate: string },
  ) {
    let state = stateIn;
    const p = task.payload as { claimId: string; policyId: string };
    const claim = await tx.insuranceClaim.findFirst({
      where: {
        id: p.claimId,
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
        status: 'PENDING',
      },
    });
    if (!claim) throw concurrentModification('This claim');
    let gross = D(claim.amountClaimed);
    if ((task.payload as { coversBalance?: boolean }).coversBalance) {
      // Cover of the outstanding balance: whatever the loan owes on the day
      // the claim is settled, interest included.
      state = await this.servicing.catchUp(
        tx,
        state,
        ctx.businessDate,
        ctx.businessDate,
        actor,
      );
      gross = owedTotal(state);
      await tx.insuranceClaim.updateMany({
        where: { id: claim.id, tenantId: state.account.tenantId },
        data: { amountClaimed: gross.toString() },
      });
    }
    const out = await this.applyProceeds(tx, state, actor, {
      type: 'INSURANCE_CLAIM_SETTLEMENT',
      gross: gross.toString(),
      costs: '0',
      funding: state.config.accounting.insuranceClaimsReceivable,
      businessDate: ctx.businessDate,
      valueDate: ctx.businessDate,
      idempotencyKey: ctx.idempotencyKey,
      hash: ctx.hash,
      narrative: `Credit-insurance claim (${claim.eventType.toLowerCase()}) settles the loan`,
      externalReference: claim.evidenceReference,
      components: { claim: claim.id, policy: p.policyId, task: task.id },
      refund: {
        source: 'INSURANCE_CLAIM',
        sourceId: claim.id,
        payee: 'Estate of the borrower',
      },
    });
    const r = await tx.insuranceClaim.updateMany({
      where: { id: claim.id, tenantId: state.account.tenantId, status: 'PENDING' },
      data: {
        status: 'SETTLED',
        settlementEventId: out.event.id,
        surplus: out.result.surplus,
        deficiency: out.result.deficiencyTotal,
      },
    });
    if (r.count !== 1) throw concurrentModification('This claim');
    await tx.insurancePolicy.updateMany({
      where: { id: p.policyId, tenantId: state.account.tenantId },
      data: { status: 'CLAIMED' },
    });
    return { event: out.event, proceeds: out.result, refund: out.refund };
  }

  private async remit(
    tx: Tx,
    state: LoanState,
    actor: LendingActor,
    task: { id: string; payload: unknown; amount: Prisma.Decimal | null },
    ctx: { idempotencyKey: string; hash: string; businessDate: string },
  ) {
    const p = task.payload as { policyId: string; reference: string };
    const policy = await this.policyOf(tx, state, p.policyId);
    const amount = D(task.amount);
    if (amount.gt(D(policy.premium).minus(D(policy.premiumRemitted))))
      throw new ConflictException(
        'Less premium is now held for this insurer than this remittance.',
      );
    const acc = state.config.accounting;
    const event = await this.servicing.recordEvent(tx, state, {
      type: 'INSURANCE_PREMIUM_REMITTANCE',
      amount,
      businessDate: ctx.businessDate,
      valueDate: ctx.businessDate,
      components: { policy: policy.id, insurer: policy.insurer, task: task.id },
      idempotencyKey: ctx.idempotencyKey,
      requestHash: ctx.hash,
      actor,
      narrative: `Premium remitted to ${policy.insurer.slice(0, 60)}`,
      externalReference: p.reference,
      lines: [
        { accountCode: acc.insurerPayable, debit: amount.toString() },
        { accountCode: acc.cash, credit: amount.toString() },
      ],
    });
    const r = await tx.insurancePolicy.updateMany({
      where: {
        id: policy.id,
        tenantId: state.account.tenantId,
        premiumRemitted: policy.premiumRemitted,
      },
      data: {
        premiumRemitted: D(policy.premiumRemitted).plus(amount).toString(),
      },
    });
    if (r.count !== 1) throw concurrentModification('This policy');
    // Serialises with other money on the loan without changing its balances.
    await this.servicing.casAccount(tx, state, state.account.status, {});
    return event;
  }

  private async payRefund(
    tx: Tx,
    state: LoanState,
    actor: LendingActor,
    task: { id: string; payload: unknown; amount: Prisma.Decimal | null },
    ctx: { idempotencyKey: string; hash: string; businessDate: string },
  ) {
    const p = task.payload as { refundId: string; payee: string };
    const refund = await tx.recoveryRefund.findFirst({
      where: {
        id: p.refundId,
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
      },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.status !== 'PAYABLE')
      throw new ConflictException('This refund has already been paid.');
    const amount = D(refund.amount);
    const acc = state.config.accounting;
    const event = await this.servicing.recordEvent(tx, state, {
      type: 'RECOVERY_REFUND',
      amount,
      businessDate: ctx.businessDate,
      valueDate: ctx.businessDate,
      components: {
        refund: refund.id,
        source: refund.source,
        payee: refund.payee,
        task: task.id,
      },
      idempotencyKey: ctx.idempotencyKey,
      requestHash: ctx.hash,
      actor,
      narrative: `Recovery surplus paid to ${refund.payee.slice(0, 60)}`,
      lines: [
        { accountCode: acc.borrowerRefundsPayable, debit: amount.toString() },
        { accountCode: acc.cash, credit: amount.toString() },
      ],
    });
    const r = await tx.recoveryRefund.updateMany({
      where: { id: refund.id, tenantId: state.account.tenantId, status: 'PAYABLE' },
      data: { status: 'PAID', paidEventId: event.id },
    });
    if (r.count !== 1) throw concurrentModification('This refund');
    await this.servicing.casAccount(tx, state, state.account.status, {});
    return event;
  }

  private async executeDebtSale(
    tx: Tx,
    stateIn: LoanState,
    actor: LendingActor,
    task: { id: string; payload: unknown; amount: Prisma.Decimal | null },
    ctx: { idempotencyKey: string; hash: string; businessDate: string },
  ) {
    const p = task.payload as { debtSaleId: string };
    const sale = await tx.debtSale.findFirst({
      where: {
        id: p.debtSaleId,
        tenantId: stateIn.account.tenantId,
        loanAccountId: stateIn.account.id,
        status: 'PENDING',
      },
    });
    if (!sale) throw concurrentModification('This debt sale');
    await this.assertSellable(tx, stateIn);
    const wasStatus = stateIn.account.status;
    // A performing balance is brought up to date before it leaves the book.
    const state =
      wasStatus === 'ACTIVE'
        ? await this.servicing.catchUp(
            tx,
            stateIn,
            ctx.businessDate,
            ctx.businessDate,
            actor,
          )
        : stateIn;
    const a = state.account;
    const acc = state.config.accounting;
    const r = engineCall(() =>
      lending.debtSaleResult(
        {
          price: decStr(sale.price),
          owed: owedPosition(state),
          allowance: decStr(a.allowance),
          interestInSuspense: decStr(a.interestInSuspense),
        },
        a.currency,
      ),
    );
    const event = await this.servicing.recordEvent(tx, state, {
      type: 'DEBT_SALE',
      amount: D(r.price),
      businessDate: ctx.businessDate,
      valueDate: ctx.businessDate,
      components: {
        debtSale: sale.id,
        buyer: sale.buyer,
        saleDate: toLocalDate(sale.saleDate),
        principal: decStr(a.principalOutstanding),
        interest: decStr(a.interestReceivable),
        fees: decStr(a.feesReceivable),
        penalties: decStr(a.penaltyReceivable),
        allowance: decStr(a.allowance),
        interestInSuspense: decStr(a.interestInSuspense),
        carryingAmount: r.carryingAmount,
        gainLoss: r.gainLoss,
        previousStatus: wasStatus,
        task: task.id,
      },
      idempotencyKey: ctx.idempotencyKey,
      requestHash: ctx.hash,
      actor,
      narrative: `Loan sold to ${sale.buyer.slice(0, 60)} (${D(r.gainLoss).gte(0) ? 'gain' : 'loss'} ${D(r.gainLoss).abs()})`,
      externalReference: sale.externalReference,
      lines: [
        { accountCode: acc.cash, debit: r.price },
        { accountCode: acc.loanLossAllowance, debit: decStr(a.allowance) },
        {
          accountCode: acc.interestSuspense,
          debit: decStr(a.interestInSuspense),
        },
        { accountCode: acc.debtSaleLoss, debit: r.loss },
        {
          accountCode: acc.loansReceivable,
          credit: decStr(a.principalOutstanding),
        },
        {
          accountCode: acc.interestReceivable,
          credit: decStr(a.interestReceivable),
        },
        { accountCode: acc.feesReceivable, credit: decStr(a.feesReceivable) },
        {
          accountCode: acc.penaltyReceivable,
          credit: decStr(a.penaltyReceivable),
        },
        { accountCode: acc.debtSaleGain, credit: r.gain },
      ],
    });
    await tx.scheduleInstalment.updateMany({
      where: { tenantId: a.tenantId, loanAccountId: a.id, status: 'DUE' },
      data: { status: 'SOLD' },
    });
    await this.servicing.casAccount(tx, state, wasStatus, {
      status: 'SOLD',
      closedAt: new Date(),
      principalOutstanding: '0',
      interestReceivable: '0',
      feesReceivable: '0',
      penaltyReceivable: '0',
      interestInSuspense: '0',
      allowance: '0',
      lastAccrualDate: a.lastAccrualDate,
      nonAccrual: false,
      nonAccrualSince: null,
      collectionStage: null,
    });
    const u = await tx.debtSale.updateMany({
      where: { id: sale.id, tenantId: a.tenantId, status: 'PENDING' },
      data: {
        status: 'EXECUTED',
        approvedBy: actor.id,
        grossReceivable: r.grossReceivable,
        carryingAmount: r.carryingAmount,
        gainLoss: r.gainLoss,
        eventId: event.id,
      },
    });
    if (u.count !== 1) throw concurrentModification('This debt sale');
    await this.servicing.outbox(tx, a.tenantId, 'lending.loan_sold', {
      loanAccountId: a.id,
      buyer: sale.buyer,
      price: r.price,
    });
    return { event, sale: r };
  }

  // ── Internals: lookups and rules ──────────────────────────────────────────

  private async task(
    tx: Tx,
    state: LoanState,
    actor: LendingActor,
    kind: TaskKind,
    payload: Record<string, unknown>,
    amount?: Dec,
  ) {
    return tx.approvalTask.create({
      data: {
        tenantId: state.account.tenantId,
        subjectType: 'LOAN_ACCOUNT',
        subjectId: state.account.id,
        action: kind,
        requiredPermission: ACTION_BY_CODE[TASKS[kind]].permission,
        amount: amount?.toString() ?? null,
        currency: amount ? state.account.currency : null,
        payload: payload as Json,
        makerId: actor.id,
      },
    });
  }

  private async repossessionOf(tx: Tx, state: LoanState, id: string) {
    const r = await tx.repossession.findFirst({
      where: {
        id,
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
      },
    });
    if (!r) throw new NotFoundException('Repossession not found');
    return r;
  }

  private async pawnOf(tx: Tx, state: LoanState, id: string) {
    const r = await tx.pawnItem.findFirst({
      where: {
        id,
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
      },
    });
    if (!r) throw new NotFoundException('Pawn item not found');
    return r;
  }

  private async policyOf(tx: Tx, state: LoanState, id: string) {
    const r = await tx.insurancePolicy.findFirst({
      where: {
        id,
        tenantId: state.account.tenantId,
        loanAccountId: state.account.id,
      },
    });
    if (!r) throw new NotFoundException('Insurance policy not found');
    return r;
  }

  private assertForfeitable(
    state: LoanState,
    item: { redemptionDeadline: Date },
    businessDate: string,
  ) {
    if (state.account.status !== 'ACTIVE')
      throw new ConflictException(
        `Loan is ${state.account.status}; only an unredeemed pawn is forfeited.`,
      );
    const deadline = toLocalDate(item.redemptionDeadline)!;
    const grace = state.config.recovery.pawnForfeitureGraceDays;
    if (!lending.pawnForfeitable(deadline, businessDate, grace))
      throw new ConflictException(
        `The item can be forfeited only after its redemption deadline ${deadline}${grace ? ` and ${grace} days' grace` : ''}.`,
      );
  }

  /** A loan is sold when delinquent or written off, with no security still being realised. */
  private async assertSellable(tx: Tx, state: LoanState) {
    const a = state.account;
    if (a.status === 'ACTIVE') {
      const min = state.config.recovery.debtSaleMinDpd;
      if (a.daysPastDue < Math.max(1, min))
        throw new BadRequestException(
          `Only a delinquent loan (at least ${Math.max(1, min)} days past due) or a written-off loan can be sold; this one is ${a.daysPastDue} days past due.`,
        );
    } else if (a.status !== 'WRITTEN_OFF') {
      throw new ConflictException(`Loan is ${a.status}.`);
    }
    refuseWhileAdvanceHeld(state, 'sell it');
    const [repos, items] = await Promise.all([
      tx.repossession.count({
        where: {
          tenantId: a.tenantId,
          loanAccountId: a.id,
          status: { in: IN_PROGRESS },
        },
      }),
      tx.pawnItem.count({
        where: {
          tenantId: a.tenantId,
          loanAccountId: a.id,
          status: { in: ['IN_CUSTODY', 'FORFEITED'] },
        },
      }),
    ]);
    if (repos || items)
      throw new ConflictException(
        'Finish the repossession or pawn sale in progress before selling the loan.',
      );
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function owedPosition(state: LoanState): lending.SettlementPosition {
  const a = state.account;
  return {
    principal: decStr(a.principalOutstanding),
    interest: decStr(a.interestReceivable),
    fees: decStr(a.feesReceivable),
    penalties: decStr(a.penaltyReceivable),
  };
}

function owedTotal(state: LoanState): Dec {
  const a = state.account;
  return D(a.principalOutstanding)
    .plus(D(a.interestReceivable))
    .plus(D(a.feesReceivable))
    .plus(D(a.penaltyReceivable));
}

function notFuture(date: string, businessDate: string, field: string) {
  lending.parseDate(date, field);
  if (lending.compareDates(date, businessDate) > 0)
    throw new BadRequestException(`${field} cannot be after the business date.`);
}

/** Decimals as strings and @db.Date columns as YYYY-MM-DD, for the client. */
function plain<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const DATE_ONLY = new Set([
    'seizedOn',
    'valuedOn',
    'soldOn',
    'receivedOn',
    'redemptionDeadline',
    'returnedOn',
    'startDate',
    'eventDate',
    'saleDate',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = DATE_ONLY.has(k) ? toLocalDate(v) : v;
    else if (v && typeof v === 'object' && 'toFixed' in v)
      out[k] = (v as { toString(): string }).toString();
    else out[k] = v;
  }
  return out;
}
