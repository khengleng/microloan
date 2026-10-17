import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  concurrentModification,
  decStr,
  fromLocalDate,
  newReference,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import {
  ApplicationsService,
  AssessedApplication,
} from '../origination/applications.service';
import { ServicingService } from '../servicing/servicing.service';
import type { LoanState } from '../servicing/loan-state';

type CounterpartyRow = NonNullable<
  Awaited<ReturnType<Tx['counterparty']['findFirst']>>
>;
type LimitRow = NonNullable<
  Awaited<ReturnType<Tx['exposureLimit']['findFirst']>>
>;
type Db = Tx | PrismaService;

/** What is excluded from utilisation when measuring a request against it. */
interface Exclude {
  applicationId?: string;
  loanAccountId?: string;
}

/**
 * Institutional lending: counterparties (banks, municipalities, sovereigns,
 * development institutions), their ratings, and exposure limits per
 * counterparty and per country.
 *
 * An institutional loan is ordinary origination with the institution as the
 * borrower. What this service adds is the limit: utilisation — principal
 * outstanding, loans booked but not disbursed, and approvals not yet booked —
 * is measured against the approved counterparty limit and the country limit
 * when the application is submitted and approved and again when the money is
 * paid out, and lending beyond either is refused with the figures. Limits are
 * proposed by one person and approved by another within approval authority.
 */
@Injectable()
export class CounterpartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    applications: ApplicationsService,
    servicing: ServicingService,
  ) {
    applications.registerAssessmentCheck((tx, app, config, stage, sim) =>
      this.assessmentCheck(tx, app, config, stage, sim),
    );
    servicing.registerDisbursementGuard((tx, state) =>
      this.disbursementGuard(tx, state),
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'counterparty.read',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const asOf = await this.businessDate.get(tenantId, tx);
      const rows = await tx.counterparty.findMany({
        where: { tenantId },
        orderBy: [{ countryCode: 'asc' }, { name: 'asc' }],
      });
      return mapSeq(rows, async (c) => ({
        ...counterpartyView(c),
        exposure: await this.counterpartyPosition(tx, tenantId, c, asOf),
      }));
    });
  }

  /**
   * The exposure view: every counterparty and country against its limit,
   * with totals by counterparty type and the limits awaiting approval.
   */
  async exposure(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'counterparty.read',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const asOf = await this.businessDate.get(tenantId, tx);
      const counterparties = await tx.counterparty.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
      });
      const byCounterparty = await mapSeq(counterparties, async (c) => ({
        ...counterpartyView(c),
        ...(await this.counterpartyPosition(tx, tenantId, c, asOf)),
      }));
      const countries = [
        ...new Set([
          ...counterparties.map((c) => c.countryCode),
          ...(
            await tx.exposureLimit.findMany({
              where: { tenantId, scope: 'COUNTRY', status: 'ACTIVE' },
              select: { countryCode: true },
            })
          ).map((l) => l.countryCode!),
        ]),
      ].sort();
      const byCountry = await mapSeq(countries, (country) =>
        this.countryPosition(tx, tenantId, country, asOf),
      );
      const byType: Record<string, Record<string, string>> = {};
      for (const c of byCounterparty)
        for (const [currency, amount] of Object.entries(c.utilisedByCurrency)) {
          byType[c.type] ??= {};
          byType[c.type][currency] = D(byType[c.type][currency] ?? '0')
            .plus(amount)
            .toString();
        }
      const pending = await tx.exposureLimit.findMany({
        where: { tenantId, status: 'PENDING' },
        include: { counterparty: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return {
        asOf,
        byCounterparty,
        byCountry,
        byType,
        pendingLimits: pending.map((l) => ({
          ...limitView(l),
          counterpartyName: l.counterparty?.name ?? null,
        })),
      };
    });
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'counterparty.read',
      tenantResource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const c = await this.load(tx, tenantId, id);
      const asOf = await this.businessDate.get(tenantId, tx);
      const [limits, loans, approvals, countryLimits] = await Promise.all([
        tx.exposureLimit.findMany({
          where: { tenantId, counterpartyId: id },
          orderBy: { createdAt: 'desc' },
        }),
        c.borrowerId
          ? tx.loanAccount.findMany({
              where: {
                tenantId,
                borrowerId: c.borrowerId,
                status: { in: ['BOOKED', 'ACTIVE', 'CLOSED', 'WRITTEN_OFF'] },
              },
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                reference: true,
                status: true,
                currency: true,
                bookedPrincipal: true,
                principalOutstanding: true,
                maturityDate: true,
                daysPastDue: true,
                familyCode: true,
              },
            })
          : [],
        c.borrowerId
          ? tx.application.findMany({
              where: {
                tenantId,
                borrowerId: c.borrowerId,
                status: 'APPROVED',
              },
              select: {
                id: true,
                reference: true,
                currency: true,
                requestedAmount: true,
              },
            })
          : [],
        tx.exposureLimit.findMany({
          where: { tenantId, scope: 'COUNTRY', countryCode: c.countryCode },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      return {
        ...counterpartyView(c),
        position: await this.counterpartyPosition(tx, tenantId, c, asOf),
        country: await this.countryPosition(tx, tenantId, c.countryCode, asOf),
        limits: limits.map(limitView),
        countryLimits: countryLimits.map(limitView),
        loans: loans.map((l) => ({
          ...l,
          bookedPrincipal: decStr(l.bookedPrincipal),
          principalOutstanding: decStr(l.principalOutstanding),
          maturityDate: toLocalDate(l.maturityDate),
        })),
        approvedApplications: approvals.map((a) => ({
          ...a,
          requestedAmount: decStr(a.requestedAmount),
        })),
      };
    });
  }

  async listLimits(actor: LendingActor, q: { status?: string }) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'counterparty.read',
      tenantResource(tenantId),
    );
    const rows = await this.prisma.exposureLimit.findMany({
      where: { tenantId, ...(q.status ? { status: q.status } : {}) },
      include: { counterparty: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((l) => ({
      ...limitView(l),
      counterpartyName: l.counterparty?.name ?? null,
    }));
  }

  // ── Counterparties ────────────────────────────────────────────────────────

  async create(
    actor: LendingActor,
    body: {
      name: string;
      type: lending.CounterpartyType;
      countryCode: string;
      borrowerId: string;
      legalIdentifier?: string;
      rating?: string;
      ratingAgency?: string;
      ratedOn?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'counterparty.manage',
        tenantResource(tenantId),
        tx,
      );
      const borrower = await tx.borrower.findFirst({
        where: { id: body.borrowerId, tenantId },
        select: { id: true },
      });
      if (!borrower) throw new NotFoundException('Borrower not found');
      const linked = await tx.counterparty.findFirst({
        where: { tenantId, borrowerId: body.borrowerId },
        select: { reference: true },
      });
      if (linked)
        throw new ConflictException(
          `This borrower is already counterparty ${linked.reference}.`,
        );
      if (body.rating && !body.ratedOn)
        throw new BadRequestException('Give the date of the rating.');
      const row = await tx.counterparty.create({
        data: {
          tenantId,
          reference: newReference('CP'),
          name: body.name.trim(),
          type: body.type,
          countryCode: body.countryCode,
          borrowerId: body.borrowerId,
          legalIdentifier: body.legalIdentifier?.trim() ?? '',
          rating: body.rating ?? null,
          ratingAgency: body.ratingAgency?.trim() ?? '',
          ratedOn: body.ratedOn ? fromLocalDate(body.ratedOn) : null,
          createdBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'counterparty.manage',
          resourceType: 'Counterparty',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: {
            action: 'CREATE',
            reference: row.reference,
            type: row.type,
            country: row.countryCode,
            rating: row.rating,
          },
        },
        tx,
      );
      return counterpartyView(row);
    });
  }

  /** A new rating (or the rating withdrawn): recorded with its date and audited, effective at once. */
  async setRating(
    actor: LendingActor,
    id: string,
    body: {
      rating: string | null;
      ratingAgency?: string;
      ratedOn: string;
      reason: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'counterparty.manage',
        tenantResource(tenantId),
        tx,
      );
      const c = await this.load(tx, tenantId, id);
      const res = await tx.counterparty.updateMany({
        where: { id, tenantId, version: c.version },
        data: {
          rating: body.rating,
          ratingAgency: body.ratingAgency?.trim() ?? c.ratingAgency,
          ratedOn: fromLocalDate(body.ratedOn),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw concurrentModification('This counterparty');
      await this.audit.write(
        {
          actor,
          action: 'counterparty.manage',
          resourceType: 'Counterparty',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            action: 'RATING',
            from: c.rating,
            to: body.rating,
            agency: body.ratingAgency ?? c.ratingAgency,
            ratedOn: body.ratedOn,
            reason: body.reason.slice(0, 500),
          },
        },
        tx,
      );
      return counterpartyView(await this.load(tx, tenantId, id));
    });
  }

  /** Suspend a counterparty (no new lending, no payouts) or reinstate it. */
  async setStatus(
    actor: LendingActor,
    id: string,
    body: { status: 'ACTIVE' | 'SUSPENDED'; reason: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'counterparty.manage',
        tenantResource(tenantId),
        tx,
      );
      const c = await this.load(tx, tenantId, id);
      if (c.status === body.status)
        throw new ConflictException(
          `This counterparty is already ${body.status.toLowerCase()}.`,
        );
      const res = await tx.counterparty.updateMany({
        where: { id, tenantId, version: c.version },
        data: { status: body.status, version: { increment: 1 } },
      });
      if (res.count !== 1) throw concurrentModification('This counterparty');
      await this.audit.write(
        {
          actor,
          action: 'counterparty.manage',
          resourceType: 'Counterparty',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            action: 'STATUS',
            status: body.status,
            reason: body.reason.slice(0, 500),
          },
        },
        tx,
      );
      return counterpartyView(await this.load(tx, tenantId, id));
    });
  }

  // ── Limits (maker-checker) ────────────────────────────────────────────────

  async proposeCounterpartyLimit(
    actor: LendingActor,
    id: string,
    body: { amount: string; currency: string; reviewOn: string; note?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.load(tx, tenantId, id);
      return this.propose(tx, actor, tenantId, {
        scope: 'COUNTERPARTY',
        counterpartyId: id,
        ...body,
      });
    });
  }

  async proposeCountryLimit(
    actor: LendingActor,
    body: {
      countryCode: string;
      amount: string;
      currency: string;
      reviewOn: string;
      note?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, (tx) =>
      this.propose(tx, actor, tenantId, { scope: 'COUNTRY', ...body }),
    );
  }

  private async propose(
    tx: Tx,
    actor: LendingActor,
    tenantId: string,
    body: {
      scope: 'COUNTERPARTY' | 'COUNTRY';
      counterpartyId?: string;
      countryCode?: string;
      amount: string;
      currency: string;
      reviewOn: string;
      note?: string;
    },
  ) {
    await this.policy.enforce(
      actor,
      'counterparty.manage',
      tenantResource(tenantId),
      tx,
    );
    if (!(body.currency in lending.CURRENCY_DEFINITIONS))
      throw new BadRequestException(
        `${body.currency} is not configured on this platform.`,
      );
    const amount = lending.parseMoney(body.amount, body.currency, 'amount');
    if (amount.lte(0))
      throw new BadRequestException('A limit must be positive.');
    const asOf = await this.businessDate.get(tenantId, tx);
    if (lending.compareDates(body.reviewOn, asOf) <= 0)
      throw new BadRequestException(
        `The review date must fall after the business date (${asOf}).`,
      );
    const key =
      body.scope === 'COUNTERPARTY'
        ? { counterpartyId: body.counterpartyId }
        : { countryCode: body.countryCode };
    const open = await tx.exposureLimit.findFirst({
      where: { tenantId, scope: body.scope, status: 'PENDING', ...key },
    });
    if (open)
      throw new ConflictException(
        'A limit for this is already awaiting approval; decide it first.',
      );
    const row = await tx.exposureLimit.create({
      data: {
        tenantId,
        scope: body.scope,
        counterpartyId: body.counterpartyId ?? null,
        countryCode: body.countryCode ?? null,
        currency: body.currency,
        amount: amount.toString(),
        reviewOn: fromLocalDate(body.reviewOn),
        note: (body.note ?? '').slice(0, 500),
        proposedBy: actor.id,
      },
    });
    await this.audit.write(
      {
        actor,
        action: 'counterparty.manage',
        resourceType: 'ExposureLimit',
        resourceId: row.id,
        outcome: 'SUCCESS',
        details: {
          action: 'PROPOSE_LIMIT',
          scope: row.scope,
          counterpartyId: row.counterpartyId,
          countryCode: row.countryCode,
          amount: amount.toString(),
          currency: row.currency,
          reviewOn: body.reviewOn,
        },
      },
      tx,
    );
    return limitView(row);
  }

  /**
   * Approve or reject a proposed limit. The checker must not be the maker
   * and must hold approval authority for the amount. An approved limit
   * replaces the one in force for the same counterparty or country; one set
   * below what is already used is approved but reported as breached, which
   * stops new lending until exposure falls.
   */
  async decideLimit(
    actor: LendingActor,
    limitId: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const l = await tx.exposureLimit.findFirst({
        where: { id: limitId, tenantId },
      });
      if (!l) throw new NotFoundException('Exposure limit not found');
      const decision = await this.policy.enforce(
        actor,
        'counterparty.limit.approve',
        {
          ...tenantResource(tenantId),
          workflowState: l.status,
          makerIds: [l.proposedBy],
          amount: decStr(l.amount),
          currency: l.currency,
        },
        tx,
      );
      if (body.approve) {
        await tx.exposureLimit.updateMany({
          where: {
            tenantId,
            scope: l.scope,
            status: 'ACTIVE',
            currency: l.currency,
            ...(l.scope === 'COUNTERPARTY'
              ? { counterpartyId: l.counterpartyId }
              : { countryCode: l.countryCode }),
          },
          data: { status: 'SUPERSEDED', version: { increment: 1 } },
        });
      }
      const res = await tx.exposureLimit.updateMany({
        where: { id: limitId, tenantId, status: 'PENDING', version: l.version },
        data: {
          status: body.approve ? 'ACTIVE' : 'REJECTED',
          decidedBy: actor.id,
          decidedAt: new Date(),
          comment: (body.comment ?? '').slice(0, 500),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw concurrentModification('This limit');
      const asOf = await this.businessDate.get(tenantId, tx);
      let position: unknown = null;
      if (body.approve && l.scope === 'COUNTERPARTY') {
        const c = await this.load(tx, tenantId, l.counterpartyId!);
        position = await this.counterpartyPosition(tx, tenantId, c, asOf);
      } else if (body.approve)
        position = await this.countryPosition(
          tx,
          tenantId,
          l.countryCode!,
          asOf,
        );
      await this.audit.write(
        {
          actor,
          action: 'counterparty.limit.approve',
          resourceType: 'ExposureLimit',
          resourceId: limitId,
          outcome: 'SUCCESS',
          decision,
          details: {
            approve: body.approve,
            amount: decStr(l.amount),
            currency: l.currency,
            scope: l.scope,
          },
        },
        tx,
      );
      const row = await tx.exposureLimit.findFirst({
        where: { id: limitId, tenantId },
      });
      return { limit: limitView(row!), position };
    });
  }

  // ── Checks at origination and disbursement ────────────────────────────────

  /**
   * Blocking issues for an institutional application: the borrower must be
   * an active counterparty of a type the product lends to, rated at least
   * its minimum, within its tenor and concessionality rules, and the amount
   * must fit under both the counterparty and the country limit.
   */
  private async assessmentCheck(
    tx: Tx,
    app: AssessedApplication,
    config: lending.ProductConfig,
    stage: 'APPLICATION' | 'APPROVAL',
    sim: lending.ScheduleResult,
  ) {
    const blocking: { code: string; message: string }[] = [];
    const metrics: Record<string, string | number | null> = {};
    const inst = config.institutional;
    if (!inst) return { blocking, metrics };
    const terms = app.terms as lending.NegotiatedTerms;
    const r = await this.limitIssues(tx, app.tenantId, {
      borrowerId: app.borrowerId,
      currency: app.currency,
      requested: decStr(app.requestedAmount as string),
      config,
      exclude: { applicationId: app.id },
      lock: stage === 'APPROVAL',
    });
    blocking.push(...r.issues);
    Object.assign(metrics, r.metrics);
    if (inst.maxTenorDays !== null) {
      const days = lending.daysBetween(
        terms.disbursementDate,
        sim.maturityDate,
      );
      metrics.tenorDays = days;
      if (days > inst.maxTenorDays)
        blocking.push({
          code: 'TENOR',
          message: `A tenor of ${days} days exceeds this product's maximum of ${inst.maxTenorDays}.`,
        });
    }
    if (inst.minGrantElement !== null) {
      const ge = lending.grantElement({
        principal: terms.principal,
        disbursementDate: terms.disbursementDate,
        payments: sim.lines.map((l) => ({ date: l.dueDate, amount: l.total })),
        discountRate: inst.grantElementDiscountRate,
        rounding: config.pricing.rounding,
      });
      metrics.grantElement = ge.grantElement;
      if (D(ge.grantElement).lt(inst.minGrantElement))
        blocking.push({
          code: 'CONCESSIONALITY',
          message: `The grant element is ${D(ge.grantElement).times(100).toDecimalPlaces(2)}%; concessional lending under this product needs at least ${D(inst.minGrantElement).times(100)}%. ${ge.explanation}`,
        });
    }
    return { blocking, metrics };
  }

  /** Refuse a payout that would breach a limit approved since, or a counterparty suspended or downgraded since. */
  private async disbursementGuard(tx: Tx, state: LoanState) {
    if (!state.config.institutional) return;
    const r = await this.limitIssues(tx, state.account.tenantId, {
      borrowerId: state.account.borrowerId,
      currency: state.account.currency,
      requested: decStr(state.account.bookedPrincipal),
      config: state.config,
      exclude: { loanAccountId: state.account.id },
      lock: true,
    });
    if (r.issues.length)
      throw new BadRequestException({
        message: `This payout is refused: ${r.issues.map((i) => i.message).join(' ')}`,
        code: r.issues[0].code,
        issues: r.issues,
      });
  }

  private async limitIssues(
    tx: Tx,
    tenantId: string,
    q: {
      borrowerId: string;
      currency: string;
      requested: string;
      config: lending.ProductConfig;
      exclude: Exclude;
      lock: boolean;
    },
  ) {
    const issues: { code: string; message: string }[] = [];
    const metrics: Record<string, string | number | null> = {};
    const inst = q.config.institutional!;
    const c = await tx.counterparty.findFirst({
      where: { tenantId, borrowerId: q.borrowerId },
    });
    if (!c) {
      issues.push({
        code: 'COUNTERPARTY_NOT_REGISTERED',
        message:
          'The borrower is not registered as an institutional counterparty. Register it (with its type, country and rating) under Counterparties first.',
      });
      return { issues, metrics };
    }
    metrics.counterparty = c.reference;
    metrics.counterpartyRating = c.rating;
    if (c.status !== 'ACTIVE')
      issues.push({
        code: 'COUNTERPARTY_SUSPENDED',
        message: `Counterparty ${c.name} is suspended: no new lending or payouts.`,
      });
    if (!inst.counterpartyTypes.includes(c.type as lending.CounterpartyType))
      issues.push({
        code: 'COUNTERPARTY_TYPE',
        message: `${c.name} is a ${c.type.toLowerCase().replace('_', ' ')}; this product lends to ${inst.counterpartyTypes.map((t) => t.toLowerCase().replace('_', ' ')).join(', ')} counterparties only.`,
      });
    const rated = lending.meetsMinimumRating(c.rating, inst.minRating);
    if (!rated.ok)
      issues.push({ code: 'COUNTERPARTY_RATING', message: rated.reason! });
    if (q.lock) {
      // Serialise decisions on this counterparty's headroom: two approvals
      // cannot each take the same room. Scoped by tenant by hand (raw SQL).
      await tx.$queryRaw`SELECT id FROM "Counterparty" WHERE id = ${c.id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    }
    const asOf = await this.businessDate.get(tenantId, tx);
    const own = await this.activeLimit(tx, tenantId, {
      counterpartyId: c.id,
      currency: q.currency,
    });
    const used = await this.utilisation(
      tx,
      tenantId,
      [c.borrowerId!],
      q.currency,
      q.exclude,
    );
    const cp = lending.checkLimitHeadroom({
      label: `Counterparty ${c.name}`,
      limit: own && limitTerms(own),
      utilised: used.total,
      requested: q.requested,
      currency: q.currency,
      asOf,
    });
    metrics.counterpartyLimit = cp.limit;
    metrics.counterpartyUtilised = cp.utilised;
    metrics.counterpartyHeadroom = cp.headroom;
    if (!cp.ok)
      issues.push({ code: `COUNTERPARTY_${cp.code}`, message: cp.message });
    if (inst.requireCountryLimit) {
      const country = await this.activeLimit(tx, tenantId, {
        countryCode: c.countryCode,
        currency: q.currency,
      });
      const borrowers = (
        await tx.counterparty.findMany({
          where: { tenantId, countryCode: c.countryCode },
          select: { borrowerId: true },
        })
      )
        .map((x) => x.borrowerId)
        .filter((b): b is string => !!b);
      const usedCountry = await this.utilisation(
        tx,
        tenantId,
        borrowers,
        q.currency,
        q.exclude,
      );
      const cc = lending.checkLimitHeadroom({
        label: `Country ${c.countryCode}`,
        limit: country && limitTerms(country),
        utilised: usedCountry.total,
        requested: q.requested,
        currency: q.currency,
        asOf,
      });
      metrics.countryLimit = cc.limit;
      metrics.countryUtilised = cc.utilised;
      metrics.countryHeadroom = cc.headroom;
      if (!cc.ok)
        issues.push({ code: `COUNTRY_${cc.code}`, message: cc.message });
    }
    return { issues, metrics };
  }

  // ── Positions ─────────────────────────────────────────────────────────────

  private async counterpartyPosition(
    tx: Tx,
    tenantId: string,
    c: CounterpartyRow,
    asOf: string,
  ) {
    const limits = await tx.exposureLimit.findMany({
      where: { tenantId, counterpartyId: c.id, status: 'ACTIVE' },
    });
    const utilisedByCurrency = c.borrowerId
      ? await this.utilisationByCurrency(tx, tenantId, [c.borrowerId])
      : {};
    return {
      utilisedByCurrency,
      limits: await Promise.all(
        limits.map(async (l) =>
          position(
            l,
            c.borrowerId
              ? await this.utilisation(
                  tx,
                  tenantId,
                  [c.borrowerId],
                  l.currency,
                  {},
                )
              : emptyUse(),
            asOf,
          ),
        ),
      ),
    };
  }

  private async countryPosition(
    tx: Tx,
    tenantId: string,
    countryCode: string,
    asOf: string,
  ) {
    const borrowers = (
      await tx.counterparty.findMany({
        where: { tenantId, countryCode },
        select: { borrowerId: true },
      })
    )
      .map((x) => x.borrowerId)
      .filter((b): b is string => !!b);
    const limits = await tx.exposureLimit.findMany({
      where: { tenantId, scope: 'COUNTRY', countryCode, status: 'ACTIVE' },
    });
    return {
      countryCode,
      counterparties: borrowers.length,
      utilisedByCurrency: await this.utilisationByCurrency(
        tx,
        tenantId,
        borrowers,
      ),
      limits: await Promise.all(
        limits.map(async (l) =>
          position(
            l,
            await this.utilisation(tx, tenantId, borrowers, l.currency, {}),
            asOf,
          ),
        ),
      ),
    };
  }

  /**
   * Exposure to these borrowers in one currency: principal outstanding on
   * active loans, booked principal on loans not yet disbursed, and approved
   * applications not yet booked.
   */
  private async utilisation(
    db: Db,
    tenantId: string,
    borrowerIds: string[],
    currency: string,
    exclude: Exclude,
  ) {
    if (!borrowerIds.length) return emptyUse();
    const [active, booked, approved] = await Promise.all([
      db.loanAccount.aggregate({
        where: {
          tenantId,
          borrowerId: { in: borrowerIds },
          currency,
          status: 'ACTIVE',
          ...(exclude.loanAccountId
            ? { id: { not: exclude.loanAccountId } }
            : {}),
        },
        _sum: { principalOutstanding: true },
      }),
      db.loanAccount.aggregate({
        where: {
          tenantId,
          borrowerId: { in: borrowerIds },
          currency,
          status: 'BOOKED',
          ...(exclude.loanAccountId
            ? { id: { not: exclude.loanAccountId } }
            : {}),
        },
        _sum: { bookedPrincipal: true },
      }),
      db.application.aggregate({
        where: {
          tenantId,
          borrowerId: { in: borrowerIds },
          currency,
          status: 'APPROVED',
          ...(exclude.applicationId
            ? { id: { not: exclude.applicationId } }
            : {}),
        },
        _sum: { requestedAmount: true },
      }),
    ]);
    const t = lending.totalExposure([
      {
        stage: 'OUTSTANDING',
        amount: decStr(active._sum.principalOutstanding),
      },
      { stage: 'BOOKED', amount: decStr(booked._sum.bookedPrincipal) },
      { stage: 'APPROVED', amount: decStr(approved._sum.requestedAmount) },
    ]);
    return t;
  }

  private async utilisationByCurrency(
    db: Db,
    tenantId: string,
    borrowerIds: string[],
  ): Promise<Record<string, string>> {
    if (!borrowerIds.length) return {};
    const [loans, apps] = await Promise.all([
      db.loanAccount.findMany({
        where: {
          tenantId,
          borrowerId: { in: borrowerIds },
          status: { in: ['ACTIVE', 'BOOKED'] },
        },
        select: {
          currency: true,
          status: true,
          principalOutstanding: true,
          bookedPrincipal: true,
        },
      }),
      db.application.findMany({
        where: {
          tenantId,
          borrowerId: { in: borrowerIds },
          status: 'APPROVED',
        },
        select: { currency: true, requestedAmount: true },
      }),
    ]);
    const out: Record<string, string> = {};
    const add = (cur: string, v: string) =>
      (out[cur] = D(out[cur] ?? '0')
        .plus(v)
        .toString());
    for (const l of loans)
      add(
        l.currency,
        decStr(
          l.status === 'ACTIVE' ? l.principalOutstanding : l.bookedPrincipal,
        ),
      );
    for (const a of apps) add(a.currency, decStr(a.requestedAmount));
    return out;
  }

  private activeLimit(
    tx: Tx,
    tenantId: string,
    key:
      | { counterpartyId: string; currency: string }
      | { countryCode: string; currency: string },
  ) {
    return tx.exposureLimit
      .findFirst({
        where: {
          tenantId,
          status: 'ACTIVE',
          scope: 'counterpartyId' in key ? 'COUNTERPARTY' : 'COUNTRY',
          ...key,
        },
        orderBy: { decidedAt: 'desc' },
      })
      .then(async (l) => {
        if (l) return l;
        // A limit in another currency still answers "is there a limit" — the
        // check then refuses it as the wrong currency rather than as missing.
        return tx.exposureLimit.findFirst({
          where: {
            tenantId,
            status: 'ACTIVE',
            scope: 'counterpartyId' in key ? 'COUNTERPARTY' : 'COUNTRY',
            ...('counterpartyId' in key
              ? { counterpartyId: key.counterpartyId }
              : { countryCode: key.countryCode }),
          },
          orderBy: { decidedAt: 'desc' },
        });
      });
  }

  private async load(db: Db, tenantId: string, id: string) {
    const c = await db.counterparty.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Counterparty not found');
    return c;
  }
}

async function mapSeq<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (const item of items) out.push(await fn(item));
  return out;
}

function limitTerms(l: LimitRow): lending.ExposureLimitTerms {
  return {
    amount: decStr(l.amount),
    currency: l.currency,
    reviewOn: toLocalDate(l.reviewOn)!,
  };
}

const emptyUse = () => lending.totalExposure([]);

/** A limit against what is used of it, with a plain status for the exposure view. */
function position(
  l: LimitRow,
  use: ReturnType<typeof lending.totalExposure>,
  asOf: string,
) {
  const amount = D(l.amount);
  const used = D(use.total);
  const lapsed = lending.compareDates(toLocalDate(l.reviewOn)!, asOf) < 0;
  const utilisation = amount.isZero()
    ? null
    : used.div(amount).toDecimalPlaces(4).toString();
  return {
    limitId: l.id,
    currency: l.currency,
    limit: amount.toString(),
    utilised: used.toString(),
    byStage: use.byStage,
    headroom: amount.minus(used).toString(),
    utilisation,
    reviewOn: toLocalDate(l.reviewOn),
    status: lapsed
      ? 'LAPSED'
      : used.gt(amount)
        ? 'BREACHED'
        : used.gte(amount.times('0.9'))
          ? 'NEAR_LIMIT'
          : 'WITHIN_LIMIT',
  };
}

function counterpartyView(c: CounterpartyRow) {
  return {
    id: c.id,
    reference: c.reference,
    name: c.name,
    type: c.type,
    countryCode: c.countryCode,
    borrowerId: c.borrowerId,
    legalIdentifier: c.legalIdentifier,
    rating: c.rating,
    ratingAgency: c.ratingAgency,
    ratedOn: toLocalDate(c.ratedOn),
    investmentGrade: c.rating ? lending.isInvestmentGrade(c.rating) : null,
    status: c.status,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
  };
}

function limitView(l: LimitRow) {
  return {
    id: l.id,
    scope: l.scope,
    counterpartyId: l.counterpartyId,
    countryCode: l.countryCode,
    currency: l.currency,
    amount: decStr(l.amount),
    reviewOn: toLocalDate(l.reviewOn),
    status: l.status,
    note: l.note,
    proposedBy: l.proposedBy,
    decidedBy: l.decidedBy,
    decidedAt: l.decidedAt,
    comment: l.comment,
    createdAt: l.createdAt,
  };
}
