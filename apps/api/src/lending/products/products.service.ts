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
  LendingActor,
  fromLocalDate,
  requireTenant,
  sha256,
  toLocalDate,
  concurrentModification,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { productVersionResource, tenantResource } from '../policy/resources';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../ledger/chart-of-accounts';
import { LendingPoliciesService } from './lending-policies.service';
import { RateCapService } from '../common/rate-cap.service';

type Json = Prisma.InputJsonValue;

/**
 * Product catalogue and the product-version lifecycle:
 *   DRAFT → SUBMITTED → APPROVED → ACTIVE → RETIRED   (or SUBMITTED → REJECTED)
 *
 * Configuration is validated against the strict schema on every save. Once a
 * version leaves DRAFT its configuration is frozen (also by a database
 * trigger); changes create a new version. Booked loans keep their agreement
 * snapshot, so nothing here can alter an existing loan.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly policies: LendingPoliciesService,
    private readonly rateCap: RateCapService,
  ) {}

  // ── Catalogue ─────────────────────────────────────────────────────────────

  async catalogue(actor: LendingActor) {
    // The catalogue is the platform's, not tenant data: platform
    // administrators read it as well as the lender's product staff.
    await this.policy.enforce(
      actor,
      'catalogue.read',
      tenantResource(actor.tenantId, 'CATALOGUE', 'catalogue'),
    );
    const families = await this.prisma.loanFamily.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return families.map((f) => ({
      ...f,
      templates: lending.PRODUCT_TEMPLATES.filter(
        (t) => t.familyCode === f.code,
      ).map((t) => {
        const a = lending.templateAvailability(t);
        return {
          code: t.code,
          name: t.name,
          description: t.description,
          phase1Slice: t.phase1Slice,
          available: a.available,
          requiredCapabilities: a.requiredCapabilities,
          missing: a.missing,
          structure: t.defaultConfig.attributes.structure,
        };
      }),
    }));
  }

  async capabilityMatrix(actor: LendingActor) {
    // The catalogue is the platform's, not tenant data: platform
    // administrators read it as well as the lender's product staff.
    await this.policy.enforce(
      actor,
      'catalogue.read',
      tenantResource(actor.tenantId, 'CATALOGUE', 'capabilities'),
    );
    return {
      engineVersion: lending.LENDING_ENGINE_VERSION,
      capabilities: lending.CAPABILITIES,
      templates: lending.PRODUCT_TEMPLATES.map((t) => {
        const a = lending.templateAvailability(t);
        return {
          code: t.code,
          familyCode: t.familyCode,
          name: t.name,
          phase1Slice: t.phase1Slice,
          available: a.available,
          missing: a.missing,
        };
      }),
    };
  }

  template(code: string) {
    const t = lending.TEMPLATE_BY_CODE[code];
    if (!t) throw new NotFoundException(`Template ${code} not found`);
    return { ...t, availability: lending.templateAvailability(t) };
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_product.read',
      tenantResource(tenantId, 'PRODUCT', 'list'),
    );
    const products = await this.prisma.lendingProduct.findMany({
      where: { tenantId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            status: true,
            effectiveFrom: true,
            effectiveTo: true,
            makerId: true,
            checkerId: true,
            createdAt: true,
            changeSummary: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return products.map((p) => ({
      ...p,
      activeVersion: p.versions.find((v) => v.status === 'ACTIVE') ?? null,
      versions: p.versions.map((v) => ({
        ...v,
        effectiveFrom: toLocalDate(v.effectiveFrom),
        effectiveTo: toLocalDate(v.effectiveTo),
      })),
    }));
  }

  async getVersion(actor: LendingActor, versionId: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_product.read',
      tenantResource(tenantId, 'PRODUCT', versionId),
    );
    const v = await this.prisma.productVersion.findFirst({
      where: { id: versionId, tenantId },
      include: { product: true },
    });
    if (!v) throw new NotFoundException('Product version not found');
    const active = await this.prisma.productVersion.findFirst({
      where: {
        tenantId,
        productId: v.productId,
        status: 'ACTIVE',
        NOT: { id: v.id },
      },
    });
    const validation = lending.validateProductConfig(v.config);
    const required = validation.ok
      ? this.requiredCapabilities(v.product.templateCode, validation.config)
      : v.requiredCapabilities;
    // The cap in force today and every rate this version can charge against it.
    const rateCap = validation.ok
      ? await this.rateCapReport(tenantId, validation.config)
      : null;
    return {
      ...v,
      effectiveFrom: toLocalDate(v.effectiveFrom),
      effectiveTo: toLocalDate(v.effectiveTo),
      validation: validation.ok ? { ok: true, issues: [] } : validation,
      rateCap,
      requiredCapabilities: required,
      missingCapabilities: lending.missingCapabilities(required),
      diffFromActive: active
        ? lending.diffConfigs(active.config, v.config)
        : null,
      activeVersionId: active?.id ?? null,
    };
  }

  async create(
    actor: LendingActor,
    body: {
      templateCode: string;
      code: string;
      name: string;
      config?: unknown;
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_product.create',
      tenantResource(tenantId, 'PRODUCT', 'new'),
    );
    const template = lending.TEMPLATE_BY_CODE[body.templateCode];
    if (!template)
      throw new NotFoundException(`Template ${body.templateCode} not found`);
    const availability = lending.templateAvailability(template);
    if (!availability.available) {
      throw new BadRequestException({
        message: `Template ${template.code} is unavailable until its required capabilities are implemented: ${availability.missing.map((m) => `${m.id} (${m.status})`).join(', ')}.`,
        code: 'TEMPLATE_UNAVAILABLE',
        missing: availability.missing,
      });
    }
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(body.code ?? ''))
      throw new BadRequestException(
        'Product code must be 2–32 characters: A–Z, 0–9, _ or -.',
      );
    const raw = body.config ?? {
      ...template.defaultConfig,
      identity: { ...template.defaultConfig.identity, name: body.name },
    };
    const config = this.validOrThrow(raw, template.code);
    const required = this.requiredCapabilities(template.code, config);
    if (
      await this.prisma.lendingProduct.findFirst({
        where: { tenantId, code: body.code },
        select: { id: true },
      })
    ) {
      throw new ConflictException(`Product code ${body.code} already exists.`);
    }

    try {
      return await this.lp.tenantTx(tenantId, async (tx) => {
        const product = await tx.lendingProduct.create({
          data: {
            tenantId,
            code: body.code,
            familyCode: template.familyCode,
            templateCode: template.code,
            name: body.name,
            createdBy: actor.id,
          },
        });
        const version = await this.writeVersion(
          tx,
          tenantId,
          product.id,
          1,
          config,
          required,
          actor.id,
          'Initial version from template ' + template.code,
        );
        await this.audit.write(
          {
            actor,
            action: 'loan_product.create',
            resourceType: 'ProductVersion',
            resourceId: version.id,
            outcome: 'SUCCESS',
            details: { productCode: body.code, template: template.code },
            configVersions: {
              productVersion: 1,
              engine: lending.LENDING_ENGINE_VERSION,
            },
          },
          tx,
        );
        return { product, version };
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException(
          `Product code ${body.code} already exists.`,
        );
      throw e;
    }
  }

  async newVersion(actor: LendingActor, productId: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_product.create',
      tenantResource(tenantId, 'PRODUCT', productId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const product = await tx.lendingProduct.findFirst({
        where: { id: productId, tenantId },
        include: { versions: { orderBy: { version: 'desc' } } },
      });
      if (!product) throw new NotFoundException('Product not found');
      if (
        product.versions.some(
          (v) =>
            v.status === 'DRAFT' ||
            v.status === 'SUBMITTED' ||
            v.status === 'APPROVED',
        )
      ) {
        throw new ConflictException(
          'Finish or reject the version already in progress first.',
        );
      }
      const base = product.versions[0];
      const config = this.validOrThrow(base.config, product.templateCode);
      const v = await this.writeVersion(
        tx,
        tenantId,
        product.id,
        base.version + 1,
        config,
        this.requiredCapabilities(product.templateCode, config),
        actor.id,
        `Copied from v${base.version}`,
      );
      await this.audit.write(
        {
          actor,
          action: 'loan_product.create_version',
          resourceType: 'ProductVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: { from: base.version },
        },
        tx,
      );
      return v;
    });
  }

  async updateDraft(
    actor: LendingActor,
    versionId: string,
    body: { config: unknown; changeSummary?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const v = await this.loadVersion(tx, tenantId, versionId);
      await this.policy.enforce(
        actor,
        'loan_product.update',
        productVersionResource(v, v.product),
        tx,
      );
      if (v.makerId !== actor.id)
        throw new ConflictException(
          'Only the maker of a draft can edit it; create your own version instead.',
        );
      const config = this.validOrThrow(body.config, v.product.templateCode);
      if (
        config.identity.familyCode !== v.product.familyCode ||
        config.identity.templateCode !== v.product.templateCode
      ) {
        throw new BadRequestException(
          'A version cannot change the product family or template.',
        );
      }
      const required = this.requiredCapabilities(
        v.product.templateCode,
        config,
      );
      const updated = await tx.productVersion.updateMany({
        where: { id: v.id, tenantId, status: 'DRAFT' },
        data: {
          config: config as unknown as Json,
          configHash: sha256(lending.canonicalJson(config)),
          requiredCapabilities: required,
          changeSummary: body.changeSummary ?? v.changeSummary,
        },
      });
      if (updated.count !== 1) throw concurrentModification('This version');
      await this.writeSubConfigs(tx, tenantId, v.id, config, true);
      await this.audit.write(
        {
          actor,
          action: 'loan_product.update',
          resourceType: 'ProductVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: { diff: lending.diffConfigs(v.config, config) },
        },
        tx,
      );
      return this.getVersionTx(tx, tenantId, v.id);
    });
  }

  async transition(
    actor: LendingActor,
    versionId: string,
    action: 'submit' | 'approve' | 'reject' | 'activate' | 'retire',
    reason?: string,
  ) {
    const tenantId = requireTenant(actor);
    const map = {
      submit: { code: 'loan_product.submit', from: 'DRAFT', to: 'SUBMITTED' },
      approve: {
        code: 'loan_product.approve',
        from: 'SUBMITTED',
        to: 'APPROVED',
      },
      reject: {
        code: 'loan_product.reject',
        from: 'SUBMITTED',
        to: 'REJECTED',
      },
      activate: {
        code: 'loan_product.activate',
        from: 'APPROVED',
        to: 'ACTIVE',
      },
      retire: { code: 'loan_product.retire', from: 'ACTIVE', to: 'RETIRED' },
    }[action];
    return this.lp.tenantTx(tenantId, async (tx) => {
      const v = await this.loadVersion(tx, tenantId, versionId);
      await this.policy.enforce(
        actor,
        map.code,
        productVersionResource(v, v.product),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const config = this.validOrThrow(v.config, v.product.templateCode);
      const data: Prisma.ProductVersionUpdateManyMutationInput = {
        status: map.to,
      };
      // NBC rate cap (D-110): every configured rate must fit under the cap in
      // force now — checked again at each step, since the cap can be lowered
      // between submission and activation.
      if (action === 'submit' || action === 'approve' || action === 'activate') {
        const report = await this.rateCapReport(tenantId, config, tx);
        RateCapService.assert(
          report.findings,
          `${v.product.code} version ${v.version} cannot be ${action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'activated'}`,
        );
      }

      if (action === 'submit') {
        data.submittedAt = new Date();
      }
      if (action === 'approve' || action === 'reject') {
        data.checkerId = actor.id;
        data.approvedAt = action === 'approve' ? new Date() : null;
        if (action === 'reject') {
          if (!reason?.trim())
            throw new BadRequestException('A rejection reason is required.');
          data.rejectionReason = reason.trim();
        }
      }
      if (action === 'activate') {
        // A product cannot become active while any mandatory capability is missing.
        const required = this.requiredCapabilities(
          v.product.templateCode,
          config,
        );
        const missing = lending.missingCapabilities(required);
        if (missing.length) {
          throw new BadRequestException({
            message: `Cannot activate: required capabilities are not implemented — ${missing.map((m) => `${m.id} (${m.status})`).join(', ')}.`,
            code: 'MISSING_CAPABILITIES',
            missing,
          });
        }
        await this.assertAccountingCodes(tx, tenantId, config);
        // A menu naming a policy that cannot be booked would fail every application.
        await this.policies.assertMenusApproved(tx, tenantId, config);
        data.activatedBy = actor.id;
        data.activatedAt = new Date();
        data.effectiveFrom = fromLocalDate(businessDate);
        // The previously active version stops originating; its loans keep their snapshots.
        await tx.productVersion.updateMany({
          where: {
            tenantId,
            productId: v.productId,
            status: 'ACTIVE',
            NOT: { id: v.id },
          },
          data: {
            status: 'RETIRED',
            retiredAt: new Date(),
            effectiveTo: fromLocalDate(businessDate),
          },
        });
      }
      if (action === 'retire') {
        data.retiredAt = new Date();
        data.effectiveTo = fromLocalDate(businessDate);
      }
      const res = await tx.productVersion.updateMany({
        where: { id: v.id, tenantId, status: map.from },
        data,
      });
      if (res.count !== 1) throw concurrentModification('This product version');
      await this.audit.write(
        {
          actor,
          action: map.code,
          resourceType: 'ProductVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: {
            from: map.from,
            to: map.to,
            reason,
            productCode: v.product.code,
            version: v.version,
          },
          configVersions: {
            productVersion: v.version,
            configHash: v.configHash,
            engine: v.engineVersion,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return this.getVersionTx(tx, tenantId, v.id);
    });
  }

  /** Price a product version without booking anything. */
  async simulate(
    actor: LendingActor,
    versionId: string,
    terms: lending.NegotiatedTerms,
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_product.read',
      tenantResource(tenantId, 'PRODUCT', versionId),
    );
    const v = await this.prisma.productVersion.findFirst({
      where: { id: versionId, tenantId },
    });
    if (!v) throw new NotFoundException('Product version not found');
    const config = this.validOrThrow(v.config, null);
    return this.simulateConfig(tenantId, config, terms, {
      productVersionId: v.id,
      productVersion: v.version,
      status: v.status,
    });
  }

  async simulateConfig(
    tenantId: string,
    config: lending.ProductConfig,
    terms: lending.NegotiatedTerms,
    versionInfo: Record<string, unknown>,
  ) {
    const check = lending.checkTerms(config, terms);
    const calendar = config.repayment.holidayCalendarCode
      ? await this.calendar(tenantId, config.repayment.holidayCalendarCode)
      : undefined;
    let rates: lending.RatePoint[] | undefined;
    const rateSources: Record<string, unknown>[] = [];
    if (config.attributes.rateType === 'FLOATING') {
      rates = await this.projectedRates(
        tenantId,
        config,
        terms.disbursementDate,
      );
      rateSources.push(...rates.map((r) => ({ ...r })));
    } else {
      rateSources.push({
        source: 'CONTRACT_FIXED',
        annualRate: terms.annualRate ?? config.pricing.fixed?.defaultAnnualRate,
        effectiveFrom: terms.disbursementDate,
      });
    }
    const fees = lending.computeUpfrontFees(
      terms.principal,
      config.identity.currency,
      config.pricing.rounding,
      lending.feesOf(config),
      terms.waivedFeeCodes,
    );
    const input = lending.toScheduleInput(
      config,
      terms,
      fees.bookedPrincipal,
      calendar,
      rates,
    );
    let schedule: lending.ScheduleResult;
    try {
      schedule = lending.generateSchedule(input);
    } catch (e) {
      if ((e as Error).name === 'EngineError') {
        throw new BadRequestException({
          message: (e as Error).message,
          code: (e as { code?: string }).code,
          termIssues: check.issues,
        });
      }
      throw e;
    }
    const flows: lending.CashFlow[] = [
      {
        date: terms.disbursementDate,
        amount: new lending.D(fees.netDisbursement)
          .minus(fees.separate)
          .toString(),
      },
      ...schedule.lines.map((l) => ({
        date: l.dueDate,
        amount: new lending.D(l.total).negated().toString(),
      })),
    ];
    return {
      simulation: true,
      note: 'Simulation only — no agreement, schedule or accounting entry has been created.',
      termsCheck: check,
      fees,
      schedule,
      effectiveAnnualRate: lending.effectiveAnnualRate(flows),
      calculationRecord: {
        engineVersion: lending.LENDING_ENGINE_VERSION,
        product: versionInfo,
        inputs: input,
        rateSources,
        rounding: config.pricing.rounding,
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  requiredCapabilities(
    templateCode: string,
    config: lending.ProductConfig,
  ): string[] {
    const extra =
      lending.TEMPLATE_BY_CODE[templateCode]?.extraCapabilities ?? [];
    return [
      ...new Set([...lending.requiredCapabilitiesFor(config), ...extra]),
    ].sort();
  }

  validOrThrow(
    raw: unknown,
    templateCode: string | null,
  ): lending.ProductConfig {
    const r = lending.validateProductConfig(raw);
    if (!r.ok)
      throw new BadRequestException({
        message: 'Product configuration is invalid.',
        code: 'INVALID_PRODUCT_CONFIG',
        issues: r.issues,
      });
    if (templateCode && r.config.identity.templateCode !== templateCode) {
      throw new BadRequestException(
        'The configuration belongs to a different template.',
      );
    }
    return r.config;
  }

  async calendar(tenantId: string, code: string, tx?: Tx) {
    const db = tx ?? this.prisma;
    const cal = await db.holidayCalendar.findFirst({
      where: { tenantId, code },
      include: { holidays: true },
    });
    if (!cal)
      throw new BadRequestException(
        `Holiday calendar ${code} is not configured for this organisation.`,
      );
    return {
      code: cal.code,
      weekendDays: cal.weekendDays,
      holidays: cal.holidays.map((h) => toLocalDate(h.date)!),
    };
  }

  /**
   * The rate cap in force for a version and how its configured rates compare
   * (shared `productRateCapReport`): a floating product is measured at its
   * latest benchmark observation.
   */
  async rateCapReport(
    tenantId: string,
    config: lending.ProductConfig,
    tx?: Tx,
  ): Promise<lending.ProductRateCapReport> {
    const db = tx ?? this.prisma;
    const { cap, policy } = await this.rateCap.resolve(tenantId, config, tx);
    const asOf = await this.businessDate.get(tenantId, tx);
    const fl = config.pricing.floating;
    const obs = fl
      ? await db.rateObservation.findFirst({
          where: {
            tenantId,
            benchmarkCode: fl.benchmarkCode,
            observationDate: { lte: fromLocalDate(asOf) },
          },
          orderBy: { observationDate: 'desc' },
        })
      : null;
    return lending.productRateCapReport(config, cap, policy, {
      asOf,
      benchmarkRate: obs ? obs.rate.toString() : null,
    });
  }

  /**
   * Floating projection: latest benchmark observation + margin, floored and
   * capped, held flat — and never above the interest-rate cap in force
   * (D-111: held at the cap, as a reset is).
   */
  async projectedRates(
    tenantId: string,
    config: lending.ProductConfig,
    from: string,
  ): Promise<lending.RatePoint[]> {
    const fl = config.pricing.floating!;
    const obs = await this.prisma.rateObservation.findFirst({
      where: {
        tenantId,
        benchmarkCode: fl.benchmarkCode,
        observationDate: { lte: fromLocalDate(from) },
      },
      orderBy: { observationDate: 'desc' },
    });
    if (!obs)
      throw new BadRequestException(
        `No ${fl.benchmarkCode} observation on or before ${from}.`,
      );
    let rate = new lending.D(obs.rate.toString()).plus(fl.margin);
    if (fl.floor && rate.lt(fl.floor)) rate = new lending.D(fl.floor);
    if (fl.cap && rate.gt(fl.cap)) rate = new lending.D(fl.cap);
    const { cap } = await this.rateCap.resolve(tenantId, config);
    const held = cap.annualRate !== null && rate.gt(cap.annualRate);
    if (held) rate = new lending.D(cap.annualRate!);
    return [
      {
        effectiveFrom: from,
        annualRate: rate.toString(),
        source: `${fl.benchmarkCode} ${toLocalDate(obs.observationDate)} (${obs.rate}) + ${fl.margin}${held ? ` (held at ${cap.description})` : ''}`,
        projected: true,
      },
    ];
  }

  private async assertAccountingCodes(
    tx: Tx,
    tenantId: string,
    config: lending.ProductConfig,
  ) {
    const codes = [
      ...Object.values(config.accounting),
      ...Object.values(config.trade?.accounts ?? {}),
    ];
    const LedgerAccounts = await tx.ledgerAccount.findMany({
      where: { tenantId, code: { in: codes } },
      select: { code: true },
    });
    const have = new Set(LedgerAccounts.map((a) => a.code));
    const defaults = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code));
    const missing = codes.filter((c) => !have.has(c) && !defaults.has(c));
    if (missing.length)
      throw new BadRequestException(
        `Accounting mapping references unknown ledger accounts: ${missing.join(', ')}.`,
      );
  }

  private async loadVersion(tx: Tx, tenantId: string, versionId: string) {
    const v = await tx.productVersion.findFirst({
      where: { id: versionId, tenantId },
      include: { product: true },
    });
    if (!v) throw new NotFoundException('Product version not found');
    return v;
  }

  private async getVersionTx(tx: Tx, tenantId: string, id: string) {
    const v = await tx.productVersion.findFirst({ where: { id, tenantId } });
    return (
      v && {
        ...v,
        effectiveFrom: toLocalDate(v.effectiveFrom),
        effectiveTo: toLocalDate(v.effectiveTo),
      }
    );
  }

  private async writeVersion(
    tx: Tx,
    tenantId: string,
    productId: string,
    version: number,
    config: lending.ProductConfig,
    required: string[],
    makerId: string,
    summary: string,
  ) {
    const v = await tx.productVersion.create({
      data: {
        tenantId,
        productId,
        version,
        status: 'DRAFT',
        config: config as unknown as Json,
        configHash: sha256(lending.canonicalJson(config)),
        requiredCapabilities: required,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        makerId,
        changeSummary: summary,
      },
    });
    await this.writeSubConfigs(tx, tenantId, v.id, config, false);
    return v;
  }

  private async writeSubConfigs(
    tx: Tx,
    tenantId: string,
    productVersionId: string,
    c: lending.ProductConfig,
    replace: boolean,
  ) {
    if (replace) {
      await tx.pricingConfiguration.deleteMany({
        where: { tenantId, productVersionId },
      });
      await tx.repaymentConfiguration.deleteMany({
        where: { tenantId, productVersionId },
      });
    }
    await tx.pricingConfiguration.create({
      data: {
        tenantId,
        productVersionId,
        rateType: c.attributes.rateType,
        interestMethod: c.pricing.interestMethod,
        rateConvention: c.pricing.rateConvention,
        accrualBasis: c.pricing.accrualBasis,
        dayCount: c.pricing.dayCount,
        defaultAnnualRate: c.pricing.fixed?.defaultAnnualRate ?? null,
        payload: c.pricing as unknown as Json,
      },
    });
    await tx.repaymentConfiguration.create({
      data: {
        tenantId,
        productVersionId,
        method: c.repayment.method,
        frequency: c.repayment.frequency,
        payload: c.repayment as unknown as Json,
      },
    });
  }
}
