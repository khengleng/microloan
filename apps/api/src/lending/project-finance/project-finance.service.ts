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
  LoanState,
  loadLoanState,
  outstanding,
  resourceOf,
} from '../servicing/loan-state';
import { ServicingService } from '../servicing/servicing.service';

type Json = Prisma.InputJsonValue;
type Dec = InstanceType<typeof lending.D>;
type ProjectRow = NonNullable<
  Awaited<ReturnType<Tx['projectFinance']['findFirst']>>
>;

export interface WaterfallBody {
  receivedOn?: string;
  revenue: string;
  operatingCosts: string;
  taxes: string;
  externalReference?: string;
}

/**
 * Project finance in operation (LT-17): the cash waterfall and the debt
 * service reserve on a project loan that has termed out on its sculpted
 * profile.
 *
 * A waterfall run posts, in one transaction:
 *  • the project's CFADS received into a receipts clearing account;
 *  • senior debt service as an ordinary repayment funded from that account
 *    (topped up from the reserve if the period's cash falls short);
 *  • the reserve top-up, the cash sweep (a prepayment shortening the loan
 *    from its last instalment), lock-up retentions and releases, and the
 *    distribution paid out to the sponsor.
 * The clearing account nets to zero after every run, and the reserve and
 * lock-up balances on the project equal their ledger accounts.
 */
@Injectable()
export class ProjectFinanceService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
  ) {}

  private async project(tx: Tx, tenantId: string, loanId: string) {
    const p = await tx.projectFinance.findFirst({
      where: { tenantId, loanAccountId: loanId },
    });
    if (!p)
      throw new NotFoundException({
        message: 'This loan is not a project-finance loan.',
        code: 'NOT_PROJECT_FINANCE',
      });
    return p;
  }

  /**
   * The figures a run starts from: what is due on the loan at the date, the
   * period's scheduled debt service (since the last run, or the term-out),
   * the reserve target and how much principal a sweep may prepay.
   */
  private position(
    state: LoanState,
    project: ProjectRow,
    valueDate: string,
    lastRunOn: string | null,
  ) {
    const lines = state.lines.filter((l) => l.number > 0);
    const dueLines = lines.filter(
      (l) =>
        l.status === 'DUE' &&
        lending.compareDates(toLocalDate(l.dueDate)!, valueDate) <= 0,
    );
    let due = D(0);
    let principalDue = D(0);
    for (const l of dueLines) {
      const o = outstanding(l);
      due = due
        .plus(o.PENALTY)
        .plus(o.FEE)
        .plus(o.TAX)
        .plus(o.INTEREST)
        .plus(o.PRINCIPAL);
      principalDue = principalDue.plus(o.PRINCIPAL);
    }
    const from = lastRunOn ?? toLocalDate(project.termedOutOn) ?? valueDate;
    const periodDs = lines
      .filter((l) => {
        const d = toLocalDate(l.dueDate)!;
        return (
          lending.compareDates(d, from) > 0 &&
          lending.compareDates(d, valueDate) <= 0
        );
      })
      .reduce((s, l) => s.plus(D(l.principalDue)).plus(D(l.interestDue)), D(0));
    const target = lending.dsraTarget(
      lines.map((l) => ({
        dueDate: toLocalDate(l.dueDate)!,
        principal: decStr(l.principalDue),
        interest: decStr(l.interestDue),
      })),
      valueDate,
      project.dsraMonths,
    );
    // A sweep prepays principal not yet due, short of the whole balance
    // (repaying everything is an early settlement, not a sweep).
    const increment = D(state.config.pricing.rounding.increment);
    const notYetDue = D(state.account.principalOutstanding).minus(principalDue);
    const sweepCap = lending.D.max(notYetDue.minus(increment), 0);
    return { due, periodDs, target, sweepCap };
  }

  private compute(
    state: LoanState,
    project: ProjectRow,
    body: WaterfallBody,
    valueDate: string,
    lastRunOn: string | null,
  ) {
    const pos = this.position(state, project, valueDate, lastRunOn);
    const result = engineCall(() =>
      lending.applyWaterfall({
        currency: state.account.currency,
        rounding: state.config.pricing.rounding,
        revenue: body.revenue,
        operatingCosts: body.operatingCosts,
        taxes: body.taxes,
        debtServiceDue: pos.due.toString(),
        periodDebtService: pos.periodDs.toString(),
        dsraBalance: decStr(project.dsraBalance),
        dsraTarget: pos.target,
        lockUpBalance: decStr(project.lockUpBalance),
        lockUpDscr: project.lockUpDscr ? decStr(project.lockUpDscr) : null,
        sweepRate: project.cashSweepRate ? decStr(project.cashSweepRate) : null,
        sweepCap: pos.sweepCap.toString(),
      }),
    );
    return { result, dsraTarget: pos.target, periodDebtService: pos.periodDs };
  }

  private async lastRunOn(tx: Tx, tenantId: string, projectId: string) {
    const last = await tx.projectWaterfallRun.findFirst({
      where: { tenantId, projectId },
      orderBy: { sequence: 'desc' },
      select: { receivedOn: true, sequence: true },
    });
    return {
      date: last ? toLocalDate(last.receivedOn) : null,
      sequence: last?.sequence ?? 0,
    };
  }

  async overview(actor: LendingActor, loanId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const project = await this.project(tx, tenantId, loanId);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const runs = await tx.projectWaterfallRun.findMany({
        where: { tenantId, projectId: project.id },
        orderBy: { sequence: 'desc' },
        take: 40,
      });
      const lines = state.lines.filter((l) => l.number > 0);
      const upcoming = lines
        .filter(
          (l) =>
            l.status === 'DUE' &&
            lending.compareDates(toLocalDate(l.dueDate)!, businessDate) >= 0,
        )
        .slice(0, 4)
        .map((l) => ({
          number: l.number,
          dueDate: toLocalDate(l.dueDate),
          principal: decStr(l.principalDue),
          interest: decStr(l.interestDue),
        }));
      const pf = state.config.projectFinance;
      return {
        project: projectView(project),
        currency: state.account.currency,
        loanStatus: state.account.status,
        principalOutstanding: decStr(state.account.principalOutstanding),
        facilityId: project.facilityId,
        businessDate,
        accounts: pf?.accounts ?? null,
        dsraTarget:
          project.status === 'OPERATIONS'
            ? lending.dsraTarget(
                lines.map((l) => ({
                  dueDate: toLocalDate(l.dueDate)!,
                  principal: decStr(l.principalDue),
                  interest: decStr(l.interestDue),
                })),
                businessDate,
                project.dsraMonths,
              )
            : null,
        upcoming,
        runs: runs.map(runView),
      };
    });
  }

  /** What a run would do, without posting anything. */
  async preview(actor: LendingActor, loanId: string, body: WaterfallBody) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const project = await this.project(tx, tenantId, loanId);
      this.assertOperating(project);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = body.receivedOn ?? businessDate;
      const last = await this.lastRunOn(tx, tenantId, project.id);
      const { result, dsraTarget, periodDebtService } = this.compute(
        state,
        project,
        body,
        valueDate,
        last.date,
      );
      return {
        valueDate,
        dsraTarget,
        periodDebtService: periodDebtService.toString(),
        ...result,
      };
    });
  }

  private assertOperating(project: ProjectRow) {
    if (project.status === 'CONSTRUCTION')
      throw new ConflictException({
        message:
          'The project is still in construction; term its facility out on a sculpted profile before applying receipts.',
        code: 'PROJECT_IN_CONSTRUCTION',
      });
    if (project.status === 'CLOSED')
      throw new ConflictException({
        message: 'The project loan is closed.',
        code: 'PROJECT_CLOSED',
      });
  }

  async apply(
    actor: LendingActor,
    loanId: string,
    body: WaterfallBody,
    idempotencyKey: string,
  ) {
    const tenantId = requireTenant(actor);
    const hash = requestHash({ op: 'project.waterfall', loanId, body });
    return this.servicing.money(tenantId, idempotencyKey, hash, async (tx) => {
      const state = await loadLoanState(tx, tenantId, loanId);
      await this.policy.enforce(
        actor,
        'project.waterfall.apply',
        resourceOf(state, [], body.revenue),
        tx,
      );
      const project = await this.project(tx, tenantId, loanId);
      this.assertOperating(project);
      if (state.account.status !== 'ACTIVE')
        throw new ConflictException(`Loan is ${state.account.status}.`);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const valueDate = body.receivedOn ?? businessDate;
      BusinessDateService.checkValueDate(
        valueDate,
        businessDate,
        state.config.repayment.maxBackdateDays,
      );
      const last = await this.lastRunOn(tx, tenantId, project.id);
      if (last.date && lending.compareDates(valueDate, last.date) < 0)
        throw new BadRequestException(
          `Receipts were last applied on ${last.date}; a run cannot be dated before it.`,
        );
      const {
        result: w,
        dsraTarget,
        periodDebtService,
      } = this.compute(state, project, body, valueDate, last.date);
      const pf = state.config.projectFinance!;
      const acc = pf.accounts;
      const cash = state.config.accounting.cash;
      const cfads = D(w.cfads);
      const received = lending.D.max(cfads, 0);
      const lines: { accountCode: string; debit?: string; credit?: string }[] =
        [];
      const move = (dr: string, cr: string, v: Dec | string) => {
        const x = D(v);
        if (x.gt(0))
          lines.push(
            { accountCode: dr, debit: x.toString() },
            { accountCode: cr, credit: x.toString() },
          );
      };
      move(cash, acc.proceeds, received);
      move(acc.dsra, acc.proceeds, w.dsraDraw);
      move(acc.proceeds, acc.dsra, w.dsraTopUp);
      move(acc.dsra, acc.proceeds, w.dsraRelease);
      move(acc.proceeds, acc.lockUp, w.lockUpRetained);
      move(acc.lockUp, acc.proceeds, w.lockUpReleased);
      move(acc.proceeds, cash, w.distribution);
      const event = await this.servicing.recordEvent(tx, state, {
        type: 'PROJECT_WATERFALL',
        amount: received,
        businessDate,
        valueDate,
        components: {
          revenue: body.revenue,
          operatingCosts: body.operatingCosts,
          taxes: body.taxes,
          cfads: w.cfads,
          dscr: w.dscr,
          lockedUp: w.lockedUp,
          seniorFromCash: w.seniorFromCash,
          dsraDraw: w.dsraDraw,
          dsraTopUp: w.dsraTopUp,
          dsraRelease: w.dsraRelease,
          cashSweep: w.cashSweep,
          lockUpRetained: w.lockUpRetained,
          lockUpReleased: w.lockUpReleased,
          distribution: w.distribution,
        },
        idempotencyKey,
        requestHash: hash,
        actor,
        narrative: `Project cash waterfall on ${valueDate}`,
        externalReference: body.externalReference?.slice(0, 120) ?? null,
        lines,
      });

      // Senior debt service: an ordinary repayment, funded from the receipts
      // clearing account rather than cash (the cash came in above).
      const debtService = D(w.seniorFromCash).plus(D(w.dsraDraw));
      if (debtService.gt(0))
        await this.servicing.repayInTx(
          tx,
          actor,
          loanId,
          {
            amount: debtService.toString(),
            valueDate,
            externalReference: body.externalReference,
          },
          `${idempotencyKey}:debt-service`,
          hash,
          {
            fundingAccount: acc.proceeds,
            authorizedByApproval: true,
            components: { projectWaterfall: true },
          },
        );
      // Cash sweep: prepay principal, shortening the loan from the end.
      if (D(w.cashSweep).gt(0))
        await this.servicing.repayInTx(
          tx,
          actor,
          loanId,
          {
            amount: w.cashSweep,
            valueDate,
            externalReference: body.externalReference,
            applyExcessAs: 'PREPAY',
            prepaymentStrategy: 'SHORTEN',
          },
          `${idempotencyKey}:sweep`,
          hash,
          {
            fundingAccount: acc.proceeds,
            authorizedByApproval: true,
            components: { projectWaterfall: true },
          },
        );

      // The loan repaid in full releases whatever the project still holds.
      let dsraAfter = D(w.dsraBalanceAfter);
      let lockUpAfter = D(w.lockUpBalanceAfter);
      let finalRelease = D(0);
      const after = await tx.loanAccount.findFirst({
        where: { id: loanId, tenantId },
        select: { status: true },
      });
      const closed = after?.status === 'CLOSED';
      if (closed && dsraAfter.plus(lockUpAfter).gt(0)) {
        finalRelease = dsraAfter.plus(lockUpAfter);
        const releaseLines: {
          accountCode: string;
          debit?: string;
          credit?: string;
        }[] = [];
        if (dsraAfter.gt(0))
          releaseLines.push(
            { accountCode: acc.dsra, debit: dsraAfter.toString() },
            { accountCode: cash, credit: dsraAfter.toString() },
          );
        if (lockUpAfter.gt(0))
          releaseLines.push(
            { accountCode: acc.lockUp, debit: lockUpAfter.toString() },
            { accountCode: cash, credit: lockUpAfter.toString() },
          );
        const closedState = await loadLoanState(tx, tenantId, loanId, {
          lock: false,
        });
        await this.servicing.recordEvent(tx, closedState, {
          type: 'PROJECT_WATERFALL',
          amount: finalRelease,
          businessDate,
          valueDate,
          components: {
            release: 'LOAN_REPAID',
            dsra: dsraAfter.toString(),
            lockUp: lockUpAfter.toString(),
          },
          idempotencyKey: `${idempotencyKey}:release`,
          requestHash: hash,
          actor,
          narrative: 'Project reserve and lock-up released on repayment',
          lines: releaseLines,
        });
        dsraAfter = D(0);
        lockUpAfter = D(0);
      }

      const res = await tx.projectFinance.updateMany({
        where: { id: project.id, tenantId, version: project.version },
        data: {
          dsraBalance: dsraAfter.toString(),
          lockUpBalance: lockUpAfter.toString(),
          lockedUp: closed ? false : w.lockedUp,
          status: closed ? 'CLOSED' : project.status,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw concurrentModification('The project');
      const steps = [
        ...w.steps,
        ...(finalRelease.gt(0)
          ? [
              {
                order: w.steps.length + 1,
                code: 'DISTRIBUTION',
                label: 'Reserve and lock-up released on repayment',
                amount: finalRelease.toString(),
                informational: false,
              },
            ]
          : []),
      ];
      const run = await tx.projectWaterfallRun.create({
        data: {
          tenantId,
          projectId: project.id,
          loanAccountId: loanId,
          sequence: last.sequence + 1,
          receivedOn: fromLocalDate(valueDate),
          revenue: body.revenue,
          operatingCosts: body.operatingCosts,
          taxes: body.taxes,
          cfads: w.cfads,
          periodDebtService: periodDebtService.toString(),
          dscr: w.dscr,
          lockedUp: w.lockedUp,
          seniorDebtService: debtService.toString(),
          dsraDraw: w.dsraDraw,
          dsraTopUp: w.dsraTopUp,
          cashSweep: w.cashSweep,
          lockUpRetained: w.lockUpRetained,
          lockUpReleased: w.lockUpReleased,
          distribution: D(w.distribution).plus(finalRelease).toString(),
          dsraTarget,
          dsraBalanceAfter: dsraAfter.toString(),
          lockUpBalanceAfter: lockUpAfter.toString(),
          steps: { steps, lockUpReasons: w.lockUpReasons } as unknown as Json,
          eventId: event.id,
          externalReference: body.externalReference?.slice(0, 120) ?? null,
          idempotencyKey,
          createdBy: actor.id,
        },
      });
      if (w.lockedUp && !project.lockedUp)
        await this.servicing.outbox(tx, tenantId, 'lending.project.lock_up', {
          loanAccountId: loanId,
          projectId: project.id,
          dscr: w.dscr,
          reasons: w.lockUpReasons,
        });
      await this.audit.write(
        {
          actor,
          action: 'project.waterfall.apply',
          resourceType: 'LoanAccount',
          resourceId: loanId,
          outcome: 'SUCCESS',
          details: {
            run: run.id,
            event: event.id,
            cfads: w.cfads,
            dscr: w.dscr,
            lockedUp: w.lockedUp,
            debtService: debtService.toString(),
            sweep: w.cashSweep,
            distribution: run.distribution.toString(),
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return { run: runView(run), loanClosed: closed };
    });
  }
}

function projectView(p: ProjectRow) {
  return {
    id: p.id,
    status: p.status,
    targetDscr: decStr(p.targetDscr),
    lockUpDscr: p.lockUpDscr ? decStr(p.lockUpDscr) : null,
    dsraMonths: p.dsraMonths,
    cashSweepRate: p.cashSweepRate ? decStr(p.cashSweepRate) : null,
    dsraBalance: decStr(p.dsraBalance),
    lockUpBalance: decStr(p.lockUpBalance),
    lockedUp: p.lockedUp,
    termedOutOn: toLocalDate(p.termedOutOn),
    sculpting: p.sculpting,
  };
}

function runView(
  r: NonNullable<Awaited<ReturnType<Tx['projectWaterfallRun']['findFirst']>>>,
) {
  const dec = (v: unknown) => decStr(v as string);
  return {
    id: r.id,
    sequence: r.sequence,
    receivedOn: toLocalDate(r.receivedOn),
    revenue: dec(r.revenue),
    operatingCosts: dec(r.operatingCosts),
    taxes: dec(r.taxes),
    cfads: dec(r.cfads),
    periodDebtService: dec(r.periodDebtService),
    dscr: r.dscr ? dec(r.dscr) : null,
    lockedUp: r.lockedUp,
    seniorDebtService: dec(r.seniorDebtService),
    dsraDraw: dec(r.dsraDraw),
    dsraTopUp: dec(r.dsraTopUp),
    cashSweep: dec(r.cashSweep),
    lockUpRetained: dec(r.lockUpRetained),
    lockUpReleased: dec(r.lockUpReleased),
    distribution: dec(r.distribution),
    dsraTarget: dec(r.dsraTarget),
    dsraBalanceAfter: dec(r.dsraBalanceAfter),
    lockUpBalanceAfter: dec(r.lockUpBalanceAfter),
    steps: r.steps,
    eventId: r.eventId,
    externalReference: r.externalReference,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}
