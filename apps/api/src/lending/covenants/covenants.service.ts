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
  LendingActor,
  concurrentModification,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { LoanState, loadLoanState, resourceOf } from '../servicing/loan-state';
import { ServicingService } from '../servicing/servicing.service';
import { CollateralService } from '../collateral/collateral.service';

type Json = Prisma.InputJsonValue;
const D = (v: Prisma.Decimal | string | number | null | undefined) =>
  new lending.D(v === null || v === undefined ? 0 : v.toString());

export type CovenantType = lending.CovenantType;

/**
 * Covenants on commercial loans (LT-16): a minimum debt-service coverage, a
 * maximum loan-to-value, a maximum net leverage, a minimum interest cover, or
 * delivery of financial statements, each tested on a schedule. A failed test
 * puts the covenant in breach and raises a notice; a breach is cured by a
 * later passing test or waived by a second person.
 */
@Injectable()
export class CovenantsService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly servicing: ServicingService,
    private readonly collateral: CollateralService,
  ) {}

  private view(
    c: Prisma.LoanCovenantGetPayload<{ include: { tests: true } }>,
    businessDate: string,
  ) {
    const next = toLocalDate(c.nextTestOn)!;
    return {
      ...c,
      threshold: c.threshold?.toString() ?? null,
      nextTestOn: next,
      testOverdue:
        c.status !== 'RELEASED' && lending.compareDates(next, businessDate) < 0,
      tests: c.tests.map((t) => ({
        ...t,
        value: t.value?.toString() ?? null,
        testedOn: toLocalDate(t.testedOn),
        periodEnd: toLocalDate(t.periodEnd),
      })),
    };
  }

  async list(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(actor, 'loan.read', resourceOf(state), tx);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const rows = await tx.loanCovenant.findMany({
        where: { tenantId, loanAccountId: id },
        include: { tests: { orderBy: { createdAt: 'desc' }, take: 12 } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => this.view(r, businessDate));
    });
  }

  async add(
    actor: LendingActor,
    id: string,
    body: {
      type: CovenantType;
      threshold?: string;
      frequencyMonths: number;
      firstTestOn?: string;
      description?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    if ((body.type === 'FINANCIAL_STATEMENTS') !== !body.threshold)
      throw new BadRequestException(
        body.type === 'FINANCIAL_STATEMENTS'
          ? 'A financial-statements covenant has no threshold.'
          : 'Give the covenant threshold.',
      );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(
        actor,
        'loan.covenant.manage',
        resourceOf(state),
        tx,
      );
      if (!['BOOKED', 'ACTIVE'].includes(state.account.status))
        throw new ConflictException(`Loan is ${state.account.status}.`);
      const businessDate = await this.businessDate.get(tenantId, tx);
      const first =
        body.firstTestOn ??
        lending.addMonths(businessDate, body.frequencyMonths);
      const row = await tx.loanCovenant.create({
        data: {
          tenantId,
          loanAccountId: id,
          type: body.type,
          threshold: body.threshold ?? null,
          frequencyMonths: body.frequencyMonths,
          nextTestOn: fromLocalDate(first),
          description: (body.description ?? '').slice(0, 500),
          createdBy: actor.id,
        },
        include: { tests: true },
      });
      await this.write(actor, tx, id, 'loan.covenant.manage', {
        covenant: row.id,
        type: body.type,
        threshold: body.threshold,
      });
      return this.view(row, businessDate);
    });
  }

  /** Scheduled debt service in the twelve months to `periodEnd` (or the next twelve, early in the loan). */
  private annualDebtService(state: LoanState, periodEnd: string) {
    const lines = state.lines.filter((l) => l.number > 0);
    const from = lending.addMonths(periodEnd, -12);
    const sum = (pick: typeof lines) =>
      pick.reduce(
        (s, l) => s.plus(D(l.principalDue)).plus(D(l.interestDue)),
        D(0),
      );
    const past = lines.filter((l) => {
      const due = toLocalDate(l.dueDate)!;
      return (
        lending.compareDates(due, from) > 0 &&
        lending.compareDates(due, periodEnd) <= 0
      );
    });
    if (past.length) return sum(past);
    const until = lending.addMonths(periodEnd, 12);
    return sum(
      lines.filter((l) => {
        const due = toLocalDate(l.dueDate)!;
        return (
          lending.compareDates(due, periodEnd) > 0 &&
          lending.compareDates(due, until) <= 0
        );
      }),
    );
  }

  /** Scheduled interest in the twelve months to `periodEnd` (or the next twelve, early in the loan). */
  private annualInterest(state: LoanState, periodEnd: string) {
    const lines = state.lines.filter((l) => l.number > 0);
    const inWindow = (from: string, to: string) =>
      lines.filter((l) => {
        const due = toLocalDate(l.dueDate)!;
        return (
          lending.compareDates(due, from) > 0 &&
          lending.compareDates(due, to) <= 0
        );
      });
    const sum = (pick: typeof lines) =>
      pick.reduce((s, l) => s.plus(D(l.interestDue)), D(0));
    const past = inWindow(lending.addMonths(periodEnd, -12), periodEnd);
    return past.length
      ? sum(past)
      : sum(inWindow(periodEnd, lending.addMonths(periodEnd, 12)));
  }

  async test(
    actor: LendingActor,
    id: string,
    covenantId: string,
    body: {
      periodEnd: string;
      annualNetOperatingIncome?: string;
      annualDebtService?: string;
      statementsReceived?: boolean;
      /** MAX_LEVERAGE / MIN_INTEREST_COVER: the borrower's EBITDA for the twelve months. */
      ebitda?: string;
      /** MAX_LEVERAGE: total borrowings; default this loan's principal outstanding. */
      totalDebt?: string;
      /** MAX_LEVERAGE: cash netted off debt; default 0. */
      cash?: string;
      /** MIN_INTEREST_COVER: interest expense; default this loan's scheduled interest for the twelve months. */
      interestExpense?: string;
      evidence?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      await this.policy.enforce(
        actor,
        'loan.covenant.manage',
        resourceOf(state),
        tx,
      );
      const c = await tx.loanCovenant.findFirst({
        where: { id: covenantId, tenantId, loanAccountId: id },
      });
      if (!c) throw new NotFoundException('Covenant not found');
      if (c.status === 'RELEASED')
        throw new ConflictException('This covenant has been released.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      if (lending.compareDates(body.periodEnd, businessDate) > 0)
        throw new BadRequestException(
          'A covenant is tested on a period already ended.',
        );

      let value: lending.Dec | null = null;
      let passed: boolean;
      const inputs: Record<string, unknown> = { periodEnd: body.periodEnd };
      if (c.type === 'MIN_DSCR') {
        if (!body.annualNetOperatingIncome)
          throw new BadRequestException(
            'Give the annual net operating income for the period.',
          );
        const ds = body.annualDebtService
          ? D(body.annualDebtService)
          : this.annualDebtService(state, body.periodEnd);
        inputs.annualNetOperatingIncome = body.annualNetOperatingIncome;
        inputs.annualDebtService = ds.toString();
        value = lending.debtServiceCoverage(
          body.annualNetOperatingIncome,
          ds.toString(),
        );
        if (!value)
          throw new BadRequestException('There is no debt service to cover.');
        passed = value.gte(D(c.threshold));
      } else if (c.type === 'MAX_LTV') {
        const pos = await this.collateral.position(tx, state);
        if (!pos.ltv)
          throw new BadRequestException(
            'The loan has no valued collateral to test.',
          );
        value = D(pos.ltv);
        inputs.outstanding = pos.outstanding.toString();
        inputs.lendingValue = pos.lendingValue.toString();
        passed = value.lte(D(c.threshold));
      } else if (c.type === 'MAX_LEVERAGE' || c.type === 'MIN_INTEREST_COVER') {
        if (!body.ebitda)
          throw new BadRequestException('Give the EBITDA for the period.');
        inputs.ebitda = body.ebitda;
        if (c.type === 'MAX_LEVERAGE') {
          const debt =
            body.totalDebt ?? D(state.account.principalOutstanding).toString();
          const cash = body.cash ?? '0';
          inputs.totalDebt = debt;
          inputs.cash = cash;
          value = lending.netLeverage(debt, cash, body.ebitda);
          inputs.unbounded = value === null;
        } else {
          const interest =
            body.interestExpense ??
            this.annualInterest(state, body.periodEnd).toString();
          inputs.interestExpense = interest;
          value = lending.interestCover(body.ebitda, interest);
          if (!value)
            throw new BadRequestException('There is no interest to cover.');
        }
        passed = lending.covenantPasses(
          c.type,
          value,
          D(c.threshold).toString(),
        );
      } else {
        passed = body.statementsReceived === true;
        inputs.statementsReceived = passed;
      }

      await tx.covenantTest.create({
        data: {
          tenantId,
          covenantId,
          loanAccountId: id,
          testedOn: fromLocalDate(businessDate),
          periodEnd: fromLocalDate(body.periodEnd),
          value: value ? value.toDecimalPlaces(6).toString() : null,
          passed,
          inputs: inputs as Json,
          evidence: (body.evidence ?? '').slice(0, 500),
          createdBy: actor.id,
        },
      });
      // The next test is one period after the later of the due date and the period tested.
      const base =
        lending.compareDates(toLocalDate(c.nextTestOn)!, body.periodEnd) > 0
          ? toLocalDate(c.nextTestOn)!
          : body.periodEnd;
      const res = await tx.loanCovenant.updateMany({
        where: { id: covenantId, tenantId, status: c.status },
        data: {
          status: passed ? 'ACTIVE' : 'BREACHED',
          nextTestOn: fromLocalDate(lending.addMonths(base, c.frequencyMonths)),
        },
      });
      if (res.count !== 1) throw concurrentModification('This covenant');
      if (!passed)
        await this.servicing.outbox(tx, tenantId, 'lending.covenant.breached', {
          loanAccountId: id,
          covenantId,
          type: c.type,
          value: value?.toString() ?? null,
          threshold: c.threshold?.toString() ?? null,
        });
      await this.write(actor, tx, id, 'loan.covenant.manage', {
        covenant: covenantId,
        passed,
        value: value?.toString() ?? null,
      });
      const row = await tx.loanCovenant.findFirst({
        where: { id: covenantId, tenantId },
        include: { tests: { orderBy: { createdAt: 'desc' }, take: 12 } },
      });
      return this.view(row!, businessDate);
    });
  }

  /** A second person waives a breach; the next test is still due. */
  async waive(
    actor: LendingActor,
    id: string,
    covenantId: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const state = await loadLoanState(tx, tenantId, id, { lock: false });
      const c = await tx.loanCovenant.findFirst({
        where: { id: covenantId, tenantId, loanAccountId: id },
        include: { tests: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (!c) throw new NotFoundException('Covenant not found');
      await this.policy.enforce(
        actor,
        'loan.covenant.waive',
        resourceOf(
          state,
          c.tests.map((t) => t.createdBy),
        ),
        tx,
      );
      if (c.status !== 'BREACHED')
        throw new ConflictException('Only a breached covenant can be waived.');
      const businessDate = await this.businessDate.get(tenantId, tx);
      await tx.covenantTest.create({
        data: {
          tenantId,
          covenantId,
          loanAccountId: id,
          testedOn: fromLocalDate(businessDate),
          periodEnd: fromLocalDate(businessDate),
          passed: true,
          kind: 'WAIVER',
          inputs: { reason: body.reason } as Json,
          evidence: body.reason.slice(0, 500),
          createdBy: actor.id,
        },
      });
      const res = await tx.loanCovenant.updateMany({
        where: { id: covenantId, tenantId, status: 'BREACHED' },
        data: { status: 'WAIVED' },
      });
      if (res.count !== 1) throw concurrentModification('This covenant');
      await this.write(actor, tx, id, 'loan.covenant.waive', {
        covenant: covenantId,
        reason: body.reason,
      });
      return { id: covenantId, status: 'WAIVED' };
    });
  }

  private write(
    actor: LendingActor,
    tx: Tx,
    loanId: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.write(
      {
        actor,
        action,
        resourceType: 'LoanAccount',
        resourceId: loanId,
        outcome: 'SUCCESS',
        details,
      },
      tx,
    );
  }
}
