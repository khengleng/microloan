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
  requireTenant,
  sha256,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { applicationResource, parseConfig } from '../policy/resources';
import { ProductsService } from '../products/products.service';
import { WorkflowsService } from '../products/workflows.service';
import { AdapterRegistry } from '../integrations/adapters';
import { LendingPoliciesService } from '../products/lending-policies.service';
import { GroupsService } from './groups.service';
import { CustomerDocumentsService } from '../documents/customer-documents.service';

type Json = Prisma.InputJsonValue;

export interface CreateApplicationBody {
  /** For a group loan, the group's leader; they sign for the group. */
  borrowerId: string;
  /** Required when the product carries group liability. */
  groupId?: string;
  /** An existing loan this application will replace at disbursement. */
  refinancesLoanId?: string;
  productId: string;
  portfolioId?: string;
  legalEntityId?: string;
  terms: lending.NegotiatedTerms & { riskCategory?: string };
  purpose?: string;
  segmentCode?: string;
}

/**
 * Origination: applications, documents, security, assessment, credit
 * decisions and booking. Every state change re-reads the application inside a
 * tenant transaction, authorizes on that committed state, and moves status
 * with a compare-and-set on (status, version) — so two concurrent approvals
 * cannot both succeed.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly products: ProductsService,
    private readonly workflows: WorkflowsService,
    private readonly adapters: AdapterRegistry,
    private readonly groups: GroupsService,
    private readonly policies: LendingPoliciesService,
    private readonly library: CustomerDocumentsService,
  ) {}

  // ── Reads (scope-filtered) ────────────────────────────────────────────────

  async list(
    actor: LendingActor,
    q: { status?: string; search?: string; page?: number },
  ) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'loan_application.read');
    if (!scope) return { data: [], total: 0 };
    const where: Prisma.ApplicationWhereInput = {
      tenantId,
      ...(scope as Prisma.ApplicationWhereInput),
    };
    if (q.status) where.status = q.status;
    if (q.search) where.reference = { contains: q.search, mode: 'insensitive' };
    const take = 50;
    const skip = (Math.max(1, q.page ?? 1) - 1) * take;
    const [data, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: { borrower: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.application.count({ where }),
    ]);
    return { data, total };
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    const app = await this.load(this.prisma, tenantId, id);
    const { version, product } = await this.versionOf(this.prisma, app);
    await this.policy.enforce(
      actor,
      'loan_application.read',
      applicationResource(app, version, product, []),
    );
    const [documents, decisions, conditions, guarantees, pledges] =
      await Promise.all([
        this.prisma.applicationDocument.findMany({
          where: { tenantId, applicationId: id },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.creditDecision.findMany({
          where: { tenantId, applicationId: id },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.conditionPrecedent.findMany({
          where: { tenantId, applicationId: id },
        }),
        this.prisma.guarantee.findMany({
          where: { tenantId, applicationId: id },
        }),
        this.prisma.collateralPledge.findMany({
          where: { tenantId, applicationId: id },
          include: {
            collateral: {
              include: { valuations: { orderBy: { valuationDate: 'desc' } } },
            },
          },
        }),
      ]);
    const agreement = await this.prisma.lendingAgreement.findFirst({
      where: { tenantId, applicationId: id },
      include: {
        account: { select: { id: true, reference: true, status: true } },
      },
    });
    return {
      ...app,
      product,
      productVersion: version && {
        id: version.id,
        version: version.version,
        status: version.status,
      },
      documents,
      decisions,
      conditions,
      guarantees,
      pledges,
      agreement,
    };
  }

  // ── Create / update / submit ──────────────────────────────────────────────

  async create(actor: LendingActor, body: CreateApplicationBody) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const borrower = await tx.borrower.findFirst({
        where: { id: body.borrowerId, tenantId },
      });
      if (!borrower) throw new NotFoundException('Borrower not found');
      if (!borrower.branchId)
        throw new BadRequestException(
          'The borrower must belong to a branch before an application can be created.',
        );
      const product = await tx.lendingProduct.findFirst({
        where: { id: body.productId, tenantId },
      });
      if (!product) throw new NotFoundException('Product not found');
      const version = await tx.productVersion.findFirst({
        where: { tenantId, productId: product.id, status: 'ACTIVE' },
      });
      if (!version)
        throw new BadRequestException(
          'This product has no active version for new business.',
        );
      const config = this.products.validOrThrow(version.config, null);
      if (config.identity.eligibleBranchCodes) {
        const branch = await tx.branch.findFirst({
          where: { id: borrower.branchId, tenantId },
          select: { code: true },
        });
        if (
          !branch?.code ||
          !config.identity.eligibleBranchCodes.includes(branch.code)
        )
          throw new BadRequestException(
            'This product is not offered at the borrower’s branch.',
          );
      }
      if (
        body.portfolioId &&
        !(await tx.portfolio.findFirst({
          where: { id: body.portfolioId, tenantId },
        }))
      )
        throw new NotFoundException('Portfolio not found');
      if (
        body.legalEntityId &&
        !(await tx.legalEntity.findFirst({
          where: { id: body.legalEntityId, tenantId },
        }))
      )
        throw new NotFoundException('Legal entity not found');

      const terms = this.normalizeTerms(body.terms);
      const check = lending.checkTerms(config, terms);
      if (!check.ok)
        throw new BadRequestException({
          message: 'Requested terms are outside the product limits.',
          code: 'TERMS_OUT_OF_RANGE',
          issues: check.issues,
        });
      // A policy choice off the product's menu is refused now, not at booking.
      await this.policies.composeForContract(
        tx,
        tenantId,
        config,
        terms.policies,
      );

      // Group liability is decided by the product, not the request: a group
      // product must name a group, and an individual product must not.
      const isGroupProduct = config.identity.liability !== 'INDIVIDUAL';
      if (isGroupProduct && !body.groupId) {
        throw new BadRequestException(
          'This product lends to a group; name the group the loan is for.',
        );
      }
      if (!isGroupProduct && body.groupId) {
        throw new BadRequestException(
          'This product lends to an individual borrower, not a group.',
        );
      }
      if (body.refinancesLoanId) {
        if (!config.restructuring.allowRefinance) {
          throw new BadRequestException(
            'This product does not permit refinancing an existing loan.',
          );
        }
        const previous = await tx.loanAccount.findFirst({
          where: { id: body.refinancesLoanId, tenantId },
          select: { borrowerId: true, status: true },
        });
        if (!previous)
          throw new NotFoundException('The loan to refinance was not found');
        if (previous.borrowerId !== borrower.id) {
          throw new BadRequestException(
            'A refinance must replace a loan of the same borrower.',
          );
        }
        if (previous.status !== 'ACTIVE') {
          throw new BadRequestException(
            `The loan to refinance is ${previous.status}; only an active loan can be replaced.`,
          );
        }
      }
      if (isGroupProduct) {
        const businessDate = await this.businessDate.get(tenantId, tx);
        const { members } = await this.groups.composition(
          tx,
          tenantId,
          body.groupId!,
          config,
          terms.principal,
          businessDate,
        );
        if (!members.some((m) => m.borrowerId === borrower.id)) {
          throw new BadRequestException(
            'The borrower on a group application must be an active member of that group.',
          );
        }
      }

      const draft = {
        id: 'new',
        tenantId,
        branchId: borrower.branchId,
        portfolioId: body.portfolioId ?? null,
        legalEntityId: body.legalEntityId ?? null,
        status: 'DRAFT',
        requestedAmount: terms.principal,
        currency: config.identity.currency,
        createdBy: actor.id,
        segmentCode: body.segmentCode ?? null,
        terms,
      };
      await this.policy.enforce(
        actor,
        'loan_application.create',
        applicationResource(draft, version, product, []),
        tx,
      );

      const app = await tx.application.create({
        data: {
          tenantId,
          reference: newReference('APP'),
          branchId: borrower.branchId,
          portfolioId: body.portfolioId,
          legalEntityId: body.legalEntityId,
          borrowerId: borrower.id,
          groupId: body.groupId ?? null,
          refinancesLoanId: body.refinancesLoanId ?? null,
          productId: product.id,
          productVersionId: version.id,
          channel: actor.channel,
          segmentCode: body.segmentCode,
          currency: config.identity.currency,
          requestedAmount: terms.principal,
          terms: terms as unknown as Json,
          purpose: (body.purpose ?? '').slice(0, 500),
          createdBy: actor.id,
        },
      });
      for (const c of config.operations.disbursementConditions) {
        await tx.conditionPrecedent.create({
          data: {
            tenantId,
            applicationId: app.id,
            code: c.code,
            label: c.label,
          },
        });
      }
      await this.audit.write(
        {
          actor,
          action: 'loan_application.create',
          resourceType: 'Application',
          resourceId: app.id,
          outcome: 'SUCCESS',
          details: {
            reference: app.reference,
            product: product.code,
            amount: terms.principal,
          },
          configVersions: { productVersion: version.version },
        },
        tx,
      );
      return app;
    });
  }

  async updateTerms(
    actor: LendingActor,
    id: string,
    body: {
      terms: lending.NegotiatedTerms & { riskCategory?: string };
      purpose?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.load(tx, tenantId, id);
      const { version, product, config } = await this.versionOf(tx, app);
      await this.policy.enforce(
        actor,
        'loan_application.update',
        applicationResource(app, version, product, []),
        tx,
      );
      if (app.status !== 'DRAFT')
        throw new ConflictException(
          'Terms can only change while the application is a draft.',
        );
      const terms = this.normalizeTerms(body.terms);
      const check = lending.checkTerms(config!, terms);
      if (!check.ok)
        throw new BadRequestException({
          message: 'Requested terms are outside the product limits.',
          code: 'TERMS_OUT_OF_RANGE',
          issues: check.issues,
        });
      await this.policies.composeForContract(
        tx,
        tenantId,
        config!,
        terms.policies,
      );
      const res = await tx.application.updateMany({
        where: { id, tenantId, status: 'DRAFT', version: app.version },
        data: {
          terms: terms as unknown as Json,
          requestedAmount: terms.principal,
          purpose: body.purpose?.slice(0, 500) ?? app.purpose,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw concurrentModification('This application');
      await this.audit.write(
        {
          actor,
          action: 'loan_application.update',
          resourceType: 'Application',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { amount: terms.principal },
        },
        tx,
      );
      return this.load(tx, tenantId, id);
    });
  }

  async submit(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.load(tx, tenantId, id);
      const { version, product, config } = await this.versionOf(tx, app);
      await this.policy.enforce(
        actor,
        'loan_application.submit',
        applicationResource(app, version, product, []),
        tx,
      );
      const workflow = await this.workflows.effective(
        tenantId,
        config!.operations.workflowCode,
        tx,
      );
      const assessment = await this.assess(
        tx,
        app,
        config!,
        'APPLICATION',
        workflow.definition.steps,
      );
      if (assessment.blocking.length) {
        throw new BadRequestException({
          message: 'The application cannot be submitted yet.',
          code: 'SUBMISSION_BLOCKED',
          issues: assessment.blocking,
        });
      }
      await this.cas(tx, app, 'DRAFT', 'SUBMITTED', {
        submittedAt: new Date(),
      });
      await this.audit.write(
        {
          actor,
          action: 'loan_application.submit',
          resourceType: 'Application',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { assessment },
        },
        tx,
      );
      return { ...(await this.load(tx, tenantId, id)), assessment };
    });
  }

  // ── Documents, collateral, guarantees, conditions ─────────────────────────

  async uploadDocument(
    actor: LendingActor,
    id: string,
    body: {
      code: string;
      fileName: string;
      mimeType: string;
      contentBase64: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    const app = await this.load(this.prisma, tenantId, id);
    const { version, product } = await this.versionOf(this.prisma, app);
    await this.policy.enforce(
      actor,
      'loan_application.update',
      applicationResource(app, version, product, []),
    );
    if (!/^[A-Z0-9_]{2,40}$/.test(body.code ?? ''))
      throw new BadRequestException('Invalid document code.');
    // DOC-1/DOC-2: the file goes to the customer's document library (object
    // storage, tenant-prefixed key, checksum, type check); the application
    // keeps its ApplicationDocument row pointing at the same stored object.
    return this.lp.tenantTx(tenantId, async (tx) => {
      const filed = await this.library.fileForApplication(
        tx,
        actor,
        app,
        body.code,
        body,
      );
      const row = await tx.applicationDocument.create({
        data: {
          tenantId,
          applicationId: id,
          code: body.code,
          ...filed.file,
          uploadedBy: actor.id,
        },
      });
      await filed.bind(row.id);
      await this.audit.write(
        {
          actor,
          action: 'loan_application.document_upload',
          resourceType: 'Application',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            code: body.code,
            sizeBytes: filed.file.sizeBytes,
            storage: filed.file.storageProvider,
            documentId: filed.document.id,
          },
        },
        tx,
      );
      return { ...row, documentId: filed.document.id };
    });
  }

  async addCollateral(
    actor: LendingActor,
    id: string,
    body: {
      type: string;
      description: string;
      marketValue: string;
      valuationDate: string;
      valuer: string;
      method: string;
      /** Balances of other loans ranking ahead on this asset (LT-04). */
      priorLienAmount?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.load(tx, tenantId, id);
      const { version, product, config } = await this.versionOf(tx, app);
      await this.policy.enforce(
        actor,
        'collateral.manage',
        applicationResource(app, version, product, []),
        tx,
      );
      if (!/^[A-Z0-9_]{2,48}$/.test(body.type ?? ''))
        throw new BadRequestException('Invalid collateral type.');
      if (
        config!.security.acceptedCollateralTypes.length &&
        !config!.security.acceptedCollateralTypes.includes(body.type)
      ) {
        throw new BadRequestException(
          `This product accepts: ${config!.security.acceptedCollateralTypes.join(', ')}.`,
        );
      }
      const value = lending.parseMoney(
        body.marketValue,
        app.currency,
        'marketValue',
      );
      lending.parseDate(body.valuationDate, 'valuationDate');
      const asset = await tx.collateralAsset.create({
        data: {
          tenantId,
          borrowerId: app.borrowerId,
          type: body.type,
          description: String(body.description ?? '').slice(0, 300),
          currency: app.currency,
          priorLienAmount: body.priorLienAmount
            ? lending
                .parseMoney(
                  body.priorLienAmount,
                  app.currency,
                  'priorLienAmount',
                )
                .toString()
            : '0',
          createdBy: actor.id,
        },
      });
      await tx.valuation.create({
        data: {
          tenantId,
          collateralId: asset.id,
          valuationDate: fromLocalDate(body.valuationDate),
          marketValue: value.toString(),
          valuer: String(body.valuer ?? '').slice(0, 120),
          method: String(body.method ?? 'MARKET').slice(0, 40),
          recordedBy: actor.id,
        },
      });
      await tx.collateralPledge.create({
        data: { tenantId, collateralId: asset.id, applicationId: id },
      });
      await this.audit.write(
        {
          actor,
          action: 'collateral.manage',
          resourceType: 'Application',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { type: body.type, marketValue: value.toString() },
        },
        tx,
      );
      return asset;
    });
  }

  async addGuarantee(
    actor: LendingActor,
    id: string,
    body: {
      guarantorName: string;
      guarantorBorrowerId?: string;
      type: 'PERSONAL' | 'CORPORATE';
      amount: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.load(tx, tenantId, id);
      const { version, product } = await this.versionOf(tx, app);
      await this.policy.enforce(
        actor,
        'collateral.manage',
        applicationResource(app, version, product, []),
        tx,
      );
      if (!['PERSONAL', 'CORPORATE'].includes(body.type))
        throw new BadRequestException(
          'Guarantee type must be PERSONAL or CORPORATE.',
        );
      if (
        body.guarantorBorrowerId &&
        !(await tx.borrower.findFirst({
          where: { id: body.guarantorBorrowerId, tenantId },
        }))
      )
        throw new NotFoundException('Guarantor borrower not found');
      const amount = lending.parseMoney(body.amount, app.currency, 'amount');
      const g = await tx.guarantee.create({
        data: {
          tenantId,
          applicationId: id,
          guarantorName: String(body.guarantorName ?? '').slice(0, 120),
          guarantorBorrowerId: body.guarantorBorrowerId,
          type: body.type,
          amount: amount.toString(),
          currency: app.currency,
          createdBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'collateral.manage',
          resourceType: 'Application',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { guarantee: g.id },
        },
        tx,
      );
      return g;
    });
  }

  async resolveCondition(
    actor: LendingActor,
    id: string,
    code: string,
    body: { resolution: 'SATISFIED' | 'WAIVED'; evidence?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.load(tx, tenantId, id);
      const { version, product } = await this.versionOf(tx, app);
      const cp = await tx.conditionPrecedent.findFirst({
        where: { tenantId, applicationId: id, code },
      });
      if (!cp) throw new NotFoundException('Condition not found');
      if (cp.status !== 'OUTSTANDING')
        throw new ConflictException('This condition is already resolved.');
      await this.policy.enforce(
        actor,
        body.resolution === 'WAIVED' ? 'condition.waive' : 'condition.satisfy',
        applicationResource(app, version, product, []),
        tx,
      );
      if (!body.evidence?.trim() && body.resolution === 'SATISFIED')
        throw new BadRequestException(
          'Record the evidence that satisfies the condition.',
        );
      await tx.conditionPrecedent.update({
        where: { id: cp.id },
        data: {
          status: body.resolution,
          evidence: body.evidence?.slice(0, 500),
          resolvedBy: actor.id,
          resolvedAt: new Date(),
        },
      });
      await this.audit.write(
        {
          actor,
          action: `condition.${body.resolution.toLowerCase()}`,
          resourceType: 'Application',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { code },
        },
        tx,
      );
      return tx.conditionPrecedent.findMany({
        where: { tenantId, applicationId: id },
      });
    });
  }

  /** Side-effect free pricing of the application's current terms. */
  async simulate(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    const app = await this.load(this.prisma, tenantId, id);
    const { version, product, config } = await this.versionOf(this.prisma, app);
    await this.policy.enforce(
      actor,
      'loan_application.read',
      applicationResource(app, version, product, []),
    );
    return this.products.simulateConfig(
      tenantId,
      config!,
      app.terms as unknown as lending.NegotiatedTerms,
      { productVersionId: version!.id, productVersion: version!.version },
    );
  }

  // ── Credit decisions ──────────────────────────────────────────────────────

  async recommend(
    actor: LendingActor,
    id: string,
    body: { rationale: string; recommendation: 'APPROVE' | 'REJECT' },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.load(tx, tenantId, id);
      const { version, product, config } = await this.versionOf(tx, app);
      await this.policy.enforce(
        actor,
        'credit_decision.recommend',
        applicationResource(app, version, product, []),
        tx,
      );
      if (!body.rationale?.trim())
        throw new BadRequestException('A rationale is required.');
      const workflow = await this.workflows.effective(
        tenantId,
        config!.operations.workflowCode,
        tx,
      );
      const assessment = await this.assess(
        tx,
        app,
        config!,
        'APPROVAL',
        workflow.definition.steps,
      );
      await tx.creditDecision.create({
        data: {
          tenantId,
          applicationId: id,
          type: 'RECOMMEND',
          decidedBy: actor.id,
          amount: decStr(app.requestedAmount),
          currency: app.currency,
          terms: app.terms as Json,
          rationale: `${body.recommendation}: ${body.rationale.slice(0, 2000)}`,
          assessment: assessment as unknown as Json,
          policyDecision: {},
        },
      });
      await this.cas(tx, app, 'SUBMITTED', 'RECOMMENDED');
      await this.audit.write(
        {
          actor,
          action: 'credit_decision.recommend',
          resourceType: 'Application',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { recommendation: body.recommendation },
        },
        tx,
      );
      return { application: await this.load(tx, tenantId, id), assessment };
    });
  }

  async approve(actor: LendingActor, id: string, body: { rationale: string }) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.load(tx, tenantId, id);
      const { version, product, config } = await this.versionOf(tx, app);
      const history = await tx.creditDecision.findMany({
        where: { tenantId, applicationId: id },
        orderBy: { createdAt: 'asc' },
      });
      const lastRecommend = [...history]
        .reverse()
        .find((h) => h.type === 'RECOMMEND');
      const approvalsSince = history.filter(
        (h) =>
          h.type === 'APPROVE' &&
          (!lastRecommend || h.createdAt >= lastRecommend.createdAt),
      );
      // Everyone who created, recommended or already approved is a maker for this approval.
      const makers = [
        app.createdBy,
        ...history
          .filter((h) => h.type === 'RECOMMEND')
          .map((h) => h.decidedBy),
        ...approvalsSince.map((h) => h.decidedBy),
      ];
      const decision = await this.policy.enforce(
        actor,
        'credit_decision.approve',
        applicationResource(app, version, product, makers),
        tx,
      );
      if (!body.rationale?.trim())
        throw new BadRequestException('A rationale is required.');

      const workflow = await this.workflows.effective(
        tenantId,
        config!.operations.workflowCode,
        tx,
      );
      const assessment = await this.assess(
        tx,
        app,
        config!,
        'APPROVAL',
        workflow.definition.steps,
      );
      if (assessment.blocking.length) {
        throw new BadRequestException({
          message: 'Approval requirements are not met.',
          code: 'APPROVAL_BLOCKED',
          issues: assessment.blocking,
        });
      }
      const required = WorkflowsService.approvalsRequired(
        workflow.definition,
        decStr(app.requestedAmount),
        app.currency,
      );
      const reached = approvalsSince.length + 1 >= required;
      await tx.creditDecision.create({
        data: {
          tenantId,
          applicationId: id,
          type: 'APPROVE',
          decidedBy: actor.id,
          amount: decStr(app.requestedAmount),
          currency: app.currency,
          terms: app.terms as Json,
          rationale: body.rationale.slice(0, 2000),
          assessment: assessment as unknown as Json,
          policyDecision: decision as unknown as Json,
        },
      });
      if (reached) {
        await this.cas(tx, app, 'RECOMMENDED', 'APPROVED', {
          decidedAt: new Date(),
        });
      } else {
        // Still awaiting further independent approvals; bump the version so a concurrent approval loses.
        const res = await tx.application.updateMany({
          where: { id, tenantId, status: 'RECOMMENDED', version: app.version },
          data: { version: { increment: 1 } },
        });
        if (res.count !== 1) throw concurrentModification('This application');
      }
      await this.audit.write(
        {
          actor,
          action: 'credit_decision.approve',
          resourceType: 'Application',
          resourceId: id,
          outcome: 'SUCCESS',
          decision,
          details: {
            approval: approvalsSince.length + 1,
            required,
            workflow: `${workflow.code}@${workflow.version}`,
          },
        },
        tx,
      );
      return {
        application: await this.load(tx, tenantId, id),
        approvalsRecorded: approvalsSince.length + 1,
        approvalsRequired: required,
      };
    });
  }

  async reject(actor: LendingActor, id: string, body: { rationale: string }) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.load(tx, tenantId, id);
      const { version, product } = await this.versionOf(tx, app);
      const decision = await this.policy.enforce(
        actor,
        'credit_decision.reject',
        applicationResource(app, version, product, []),
        tx,
      );
      if (!body.rationale?.trim())
        throw new BadRequestException('A rationale is required.');
      await tx.creditDecision.create({
        data: {
          tenantId,
          applicationId: id,
          type: 'REJECT',
          decidedBy: actor.id,
          amount: decStr(app.requestedAmount),
          currency: app.currency,
          terms: app.terms as Json,
          rationale: body.rationale.slice(0, 2000),
          assessment: {},
          policyDecision: decision as unknown as Json,
        },
      });
      await this.cas(tx, app, app.status, 'REJECTED', {
        decidedAt: new Date(),
      });
      await this.audit.write(
        {
          actor,
          action: 'credit_decision.reject',
          resourceType: 'Application',
          resourceId: id,
          outcome: 'SUCCESS',
        },
        tx,
      );
      return this.load(tx, tenantId, id);
    });
  }

  // ── Booking ───────────────────────────────────────────────────────────────

  /**
   * Book an approved application as an agreement: snapshot the product
   * version's configuration and the approved terms, compute fees and the
   * schedule, and open a BOOKED loan account. No money moves here.
   */
  async book(
    actor: LendingActor,
    id: string,
    body: { plannedDisbursementDate?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.load(tx, tenantId, id);
      const { version, product, config } = await this.versionOf(tx, app);
      await this.policy.enforce(
        actor,
        'loan.agreement.book',
        applicationResource(app, version, product, []),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const planned = body.plannedDisbursementDate ?? businessDate;
      if (lending.compareDates(planned, businessDate) < 0)
        throw new BadRequestException(
          'The planned disbursement date cannot precede the business date.',
        );

      const approved = await tx.creditDecision.findFirst({
        where: { tenantId, applicationId: id, type: 'APPROVE' },
        orderBy: { createdAt: 'desc' },
      });
      const terms = {
        ...(approved!.terms as unknown as lending.NegotiatedTerms),
        disbursementDate: planned,
      };
      // The contract is composed from the policies chosen in the approved
      // terms, resolved now and frozen in the agreement (POLICY_MODEL.md).
      const contract = await this.policies.composeForContract(
        tx,
        tenantId,
        config!,
        terms.policies,
      );
      const contractConfig = contract.config;
      const contractHash = contract.policies.length
        ? sha256(lending.canonicalJson(contractConfig))
        : version!.configHash;
      // A facility books a limit, not a schedule: there is no principal to
      // amortize until it terms out, so the booking calculation (which
      // generates a schedule) does not apply to it.
      if (config!.facility.type !== 'TERM') {
        return this.bookFacility(tx, actor, {
          app,
          config: contractConfig,
          version: version!,
          product: product!,
          terms,
          businessDate,
          effectiveDate: planned,
        });
      }
      const booking = await this.bookingCalculation(
        tx,
        tenantId,
        contractConfig,
        terms,
        { productVersionId: version!.id, productVersion: version!.version },
      );

      const agreement = await tx.lendingAgreement.create({
        data: {
          tenantId,
          reference: newReference('AGR'),
          applicationId: id,
          borrowerId: app.borrowerId,
          productId: app.productId,
          productVersionId: version!.id,
          currency: app.currency,
          createdBy: actor.id,
        },
      });
      await tx.agreementVersion.create({
        data: {
          tenantId,
          agreementId: agreement.id,
          version: 1,
          reason: 'BOOKING',
          productConfig: contractConfig as unknown as Json,
          configHash: contractHash,
          terms: terms as unknown as Json,
          policies: contract.policies as unknown as Json,
          scheduleInput: booking.input as unknown as Json,
          calculation: {
            schedule: booking.schedule,
            fees: booking.fees,
            effectiveAnnualRate: booking.apr,
            engineVersion: lending.LENDING_ENGINE_VERSION,
          } as unknown as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          effectiveDate: fromLocalDate(planned),
          createdBy: actor.id,
        },
      });
      const account = await tx.loanAccount.create({
        data: {
          tenantId,
          reference: newReference('LN'),
          agreementId: agreement.id,
          applicationId: id,
          borrowerId: app.borrowerId,
          branchId: app.branchId,
          portfolioId: app.portfolioId,
          legalEntityId: app.legalEntityId,
          productId: app.productId,
          productVersionId: version!.id,
          familyCode: product!.familyCode,
          currency: app.currency,
          status: 'BOOKED',
          bookedPrincipal: booking.fees.bookedPrincipal,
          instalmentAmount: booking.schedule.instalmentAmount,
          maturityDate: fromLocalDate(booking.schedule.maturityDate),
          createdBy: actor.id,
        },
      });
      // Freeze who is liable, and for how much, as part of the contract: a
      // later change to the group must not alter a loan already running.
      if (config!.identity.liability !== 'INDIVIDUAL' && app.groupId) {
        const { members } = await this.groups.composition(
          tx,
          tenantId,
          app.groupId,
          config!,
          decStr(booking.fees.bookedPrincipal),
          planned,
        );
        const roles = new Map(
          (
            await tx.groupMembership.findMany({
              where: { tenantId, groupId: app.groupId, leftOn: null },
              select: { borrowerId: true, role: true },
            })
          ).map((m) => [m.borrowerId, m.role]),
        );
        await this.groups.bindLoan(
          tx,
          tenantId,
          account.id,
          app.groupId,
          config!.identity.liability,
          members,
          roles,
        );
      }
      await this.cas(tx, app, 'APPROVED', 'BOOKED');
      await this.audit.write(
        {
          actor,
          action: 'loan.agreement.book',
          resourceType: 'LoanAccount',
          resourceId: account.id,
          outcome: 'SUCCESS',
          details: {
            application: app.reference,
            agreement: agreement.reference,
            bookedPrincipal: booking.fees.bookedPrincipal,
          },
          configVersions: {
            productVersion: version!.version,
            configHash: version!.configHash,
            engine: lending.LENDING_ENGINE_VERSION,
          },
          businessDate: fromLocalDate(businessDate),
        },
        tx,
      );
      return { agreement, account, preview: booking };
    });
  }

  /**
   * Book a facility: a limit the borrower may draw against.
   *
   * The agreement and loan account are created exactly as for a term loan — a
   * facility is serviced by the same code — but with no schedule and a booked
   * principal of the committed limit, which is the exposure the approval
   * authority was measured against. Tranche conditions come from the product
   * configuration so they cannot be edited away on an individual facility.
   */
  private async bookFacility(
    tx: Tx,
    actor: LendingActor,
    input: {
      app: {
        id: string;
        reference: string;
        tenantId: string;
        borrowerId: string;
        branchId: string;
        portfolioId: string | null;
        legalEntityId: string | null;
        productId: string;
        currency: string;
      };
      config: lending.ProductConfig;
      version: { id: string; version: number; configHash: string };
      product: { familyCode: string };
      terms: lending.NegotiatedTerms;
      businessDate: string;
      effectiveDate: string;
    },
  ) {
    const { app, config, version, product, terms, effectiveDate } = input;
    const tenantId = app.tenantId;
    const fc = config.facility;
    const availabilityFrom = effectiveDate;
    const availabilityTo = lending.addMonths(
      availabilityFrom,
      fc.availabilityMonths!,
    );
    const maturityDate = fc.termOutOnExpiry
      ? lending.addMonths(availabilityTo, terms.numberOfInstalments ?? 12)
      : availabilityTo;

    const engineTerms: lending.FacilityTerms = {
      type: fc.type as lending.FacilityType,
      currency: app.currency,
      limitAmount: terms.principal,
      availabilityStart: availabilityFrom,
      availabilityEnd: availabilityTo,
      maturityDate,
      annualRate:
        terms.annualRate ?? config.pricing.fixed?.defaultAnnualRate ?? '0',
      dayCount: config.pricing.dayCount,
      rounding: config.pricing.rounding,
      minimumDrawdown: fc.minimumDrawdown,
      maximumDrawdown: fc.maximumDrawdown,
      commitmentFeeRate: fc.commitmentFeeRate,
      minimumPaymentRate: fc.minimumPaymentRate,
      minimumPaymentFloor: fc.minimumPaymentFloor,
      overlimitRate: fc.overlimitRate,
      tranches: fc.tranches.map((t) => ({
        code: t.code,
        amount: new lending.D(terms.principal).times(t.shareOfLimit).toString(),
        availableFrom: lending.addMonths(
          availabilityFrom,
          t.availableAfterMonths,
        ),
        conditions: t.conditions,
      })),
    };
    const issues = lending.validateFacilityTerms(engineTerms);
    if (issues.length) {
      throw new BadRequestException({
        message: issues.map((i) => `${i.path}: ${i.message}`).join('; '),
        code: 'FACILITY_TERMS_INVALID',
        issues,
      });
    }

    const agreement = await tx.lendingAgreement.create({
      data: {
        tenantId,
        reference: newReference('AGR'),
        applicationId: app.id,
        borrowerId: app.borrowerId,
        productId: app.productId,
        productVersionId: version.id,
        currency: app.currency,
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
        configHash: version.configHash,
        terms: terms as unknown as Json,
        // A facility has no schedule input; the facility terms are what the
        // engine is driven by, so they are what the snapshot must carry.
        scheduleInput: engineTerms as unknown as Json,
        calculation: {
          facilityTerms: engineTerms,
          engineVersion: lending.LENDING_ENGINE_VERSION,
        } as unknown as Json,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        effectiveDate: fromLocalDate(effectiveDate),
        createdBy: actor.id,
      },
    });
    const account = await tx.loanAccount.create({
      data: {
        tenantId,
        reference: newReference('LN'),
        agreementId: agreement.id,
        applicationId: app.id,
        borrowerId: app.borrowerId,
        branchId: app.branchId,
        portfolioId: app.portfolioId,
        legalEntityId: app.legalEntityId,
        productId: app.productId,
        productVersionId: version.id,
        familyCode: product.familyCode,
        currency: app.currency,
        status: 'BOOKED',
        bookedPrincipal: terms.principal,
        maturityDate: fromLocalDate(maturityDate),
        createdBy: actor.id,
      },
    });
    const facility = await tx.facility.create({
      data: {
        tenantId,
        reference: newReference('FAC'),
        borrowerId: app.borrowerId,
        branchId: app.branchId,
        portfolioId: app.portfolioId,
        legalEntityId: app.legalEntityId,
        productId: app.productId,
        productVersionId: version.id,
        familyCode: product.familyCode,
        facilityType: fc.type,
        currency: app.currency,
        agreementId: agreement.id,
        limitReinstates: lending.limitReinstates(
          fc.type as lending.FacilityType,
        ),
        limitAmount: terms.principal,
        availabilityFrom: fromLocalDate(availabilityFrom),
        availabilityTo: fromLocalDate(availabilityTo),
        maturityDate: fromLocalDate(maturityDate),
        status: 'ACTIVE',
        createdBy: actor.id,
      },
    });
    const conditions = fc.tranches.flatMap((t) =>
      t.conditions.map((c) => ({
        tenantId,
        facilityId: facility.id,
        trancheCode: t.code,
        code: c,
        label: `${t.label}: ${c}`,
      })),
    );
    if (conditions.length) {
      await tx.facilityCondition.createMany({ data: conditions });
    }
    await this.cas(tx, app as never, 'APPROVED', 'BOOKED');
    await this.audit.write(
      {
        actor,
        action: 'loan.agreement.book',
        resourceType: 'Facility',
        resourceId: facility.id,
        outcome: 'SUCCESS',
        details: {
          application: app.reference,
          agreement: agreement.reference,
          facility: facility.reference,
          facilityType: fc.type,
          limitAmount: terms.principal,
        },
        configVersions: {
          productVersion: version.version,
          configHash: version.configHash,
          engine: lending.LENDING_ENGINE_VERSION,
        },
        businessDate: fromLocalDate(input.businessDate),
      },
      tx,
    );
    return {
      agreement,
      account,
      facility,
      preview: { facilityTerms: engineTerms },
    };
  }

  async bookingCalculation(
    tx: Tx,
    tenantId: string,
    config: lending.ProductConfig,
    terms: lending.NegotiatedTerms,
    versionInfo: Record<string, unknown>,
  ) {
    const calendar = config.repayment.holidayCalendarCode
      ? await this.products.calendar(
          tenantId,
          config.repayment.holidayCalendarCode,
          tx,
        )
      : undefined;
    // A floating loan books at the rate its benchmark gives today; the
    // contract then re-prices on its reset cycle (RateResetService).
    const rates =
      config.attributes.rateType === 'FLOATING'
        ? await this.products.projectedRates(
            tenantId,
            config,
            terms.disbursementDate,
          )
        : undefined;
    const fees = lending.computeUpfrontFees(
      terms.principal,
      config.identity.currency,
      config.pricing.rounding,
      lending.feesOf(config),
      terms.waivedFeeCodes,
    );
    let input = lending.toScheduleInput(
      config,
      terms,
      fees.bookedPrincipal,
      calendar,
      rates,
    );
    const build = (i: lending.ScheduleInput): lending.ScheduleResult => {
      try {
        return lending.generateSchedule(i);
      } catch (e) {
        if ((e as Error).name === 'EngineError')
          throw new BadRequestException({
            message: (e as Error).message,
            code: (e as { code?: string }).code,
          });
        throw e;
      }
    };
    let schedule = build(input);
    if (rates?.length) {
      // Maturity is only known once the schedule exists, so the projected
      // timeline is built on a second pass. Every point after the opening
      // rate is marked projected, so a floating loan's later instalments are
      // never presented as contractually fixed.
      const fl = config.pricing.floating!;
      const timeline = lending.projectRateTimeline(
        {
          benchmarkCode: fl.benchmarkCode,
          margin: fl.margin,
          resetFrequency: fl.resetFrequency,
          floor: fl.floor,
          cap: fl.cap,
        },
        {
          annualRate: rates[0].annualRate,
          bound: 'BENCHMARK',
          indicated: rates[0].annualRate,
          observation: {
            benchmarkCode: fl.benchmarkCode,
            observationDate: terms.disbursementDate,
            rate: rates[0].annualRate,
          },
          source: rates[0].source,
        },
        terms.disbursementDate,
        schedule.maturityDate,
      );
      input = lending.toScheduleInput(
        config,
        terms,
        fees.bookedPrincipal,
        calendar,
        timeline,
      );
      schedule = build(input);
    }
    const apr = lending.effectiveAnnualRate([
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
    ]);
    return { input, schedule, fees, apr, product: versionInfo };
  }

  // ── Assessment ────────────────────────────────────────────────────────────

  /**
   * Eligibility and security checks. `blocking` issues stop submission (stage
   * APPLICATION) or approval (stage APPROVAL); `metrics` are recorded on the
   * decision for the approver and the audit trail.
   */
  async assess(
    tx: Tx,
    app: {
      id: string;
      tenantId: string;
      borrowerId: string;
      /** Set on a group application; null for individual lending. */
      groupId?: string | null;
      requestedAmount: unknown;
      currency: string;
      terms: unknown;
    },
    config: lending.ProductConfig,
    stage: 'APPLICATION' | 'APPROVAL',
    steps: readonly string[],
  ) {
    const blocking: { code: string; message: string }[] = [];
    const metrics: Record<string, string | number | null> = {};
    const borrower = await tx.borrower.findFirst({
      where: { id: app.borrowerId, tenantId: app.tenantId },
    });
    const terms = app.terms as lending.NegotiatedTerms;
    const amount = D(app.requestedAmount as string);

    if (
      steps.includes('KYC_CHECK') &&
      config.operations.integrations.kyc === 'MANUAL' &&
      borrower?.kycStatus !== 'VERIFIED'
    ) {
      blocking.push({
        code: 'KYC',
        message: 'The borrower’s KYC must be verified.',
      });
    }
    if (steps.includes('DOCUMENT_CHECK')) {
      const stages =
        stage === 'APPLICATION' ? ['APPLICATION'] : ['APPLICATION', 'APPROVAL'];
      // DOC-3: the checklist reads the customer's library; a document that
      // was rejected or has expired does not count.
      const items = await this.library.applicationChecklist(
        tx,
        app,
        stages,
        config,
      );
      for (const item of items.filter((d) => d.mandatory && !d.present)) {
        blocking.push({
          code: 'DOCUMENT',
          message:
            item.status === 'MISSING'
              ? `Missing document: ${item.label}`
              : `Document ${item.label} is ${item.status.toLowerCase().replace('_', ' ')}`,
        });
      }
    }

    // Age and income eligibility, measured on an indicative schedule. A
    // floating product has no fixed rate to fall back on, so it is priced off
    // today's benchmark here exactly as the booking would be.
    const assessmentRates =
      config.attributes.rateType === 'FLOATING'
        ? await this.products.projectedRates(
            app.tenantId,
            config,
            terms.disbursementDate,
          )
        : undefined;
    const sim = engineCall(() =>
      lending.generateSchedule(
        lending.toScheduleInput(
          config,
          terms,
          terms.principal,
          config.repayment.holidayCalendarCode
            ? { code: 'X', weekendDays: [], holidays: [] }
            : undefined,
          assessmentRates,
        ),
      ),
    );
    if (borrower?.dateOfBirth) {
      const dob = borrower.dateOfBirth.toISOString().slice(0, 10);
      const ageNow = lending
        .yearFraction(dob, terms.disbursementDate, 'ACT_365_FIXED')
        .floor()
        .toNumber();
      const ageAtMaturity = lending
        .yearFraction(dob, sim.maturityDate, 'ACT_365_FIXED')
        .floor()
        .toNumber();
      metrics.ageYears = ageNow;
      metrics.ageAtMaturityYears = ageAtMaturity;
      if (
        config.eligibility.minAgeYears !== null &&
        ageNow < config.eligibility.minAgeYears
      )
        blocking.push({
          code: 'AGE',
          message: `Minimum age is ${config.eligibility.minAgeYears}.`,
        });
      if (
        config.eligibility.maxAgeAtMaturityYears !== null &&
        ageAtMaturity > config.eligibility.maxAgeAtMaturityYears
      )
        blocking.push({
          code: 'AGE',
          message: `Maximum age at maturity is ${config.eligibility.maxAgeAtMaturityYears}.`,
        });
    } else if (
      config.eligibility.minAgeYears !== null ||
      config.eligibility.maxAgeAtMaturityYears !== null
    ) {
      blocking.push({
        code: 'AGE',
        message: 'The borrower’s date of birth is required for this product.',
      });
    }
    // Affordability on a group loan is a property of the group: one
    // instalment is serviced by every member together, so it is measured
    // against their combined income, not the leader's alone.
    let income = borrower?.monthlyIncome ? D(borrower.monthlyIncome) : null;
    if (config.identity.liability !== 'INDIVIDUAL' && app.groupId) {
      const members = await tx.groupMembership.findMany({
        where: { tenantId: app.tenantId, groupId: app.groupId, leftOn: null },
        select: { borrowerId: true },
      });
      const incomes = await tx.borrower.findMany({
        where: {
          tenantId: app.tenantId,
          id: { in: members.map((m) => m.borrowerId) },
        },
        select: { monthlyIncome: true },
      });
      const combined = incomes.reduce(
        (t, b) => t.plus(b.monthlyIncome ? D(b.monthlyIncome) : D('0')),
        D('0'),
      );
      income = combined.gt(0) ? combined : null;
      metrics.groupMembers = members.length;
      metrics.groupCombinedIncome = combined.toString();
    }
    if (
      config.eligibility.minMonthlyIncome &&
      (!income || income.lt(config.eligibility.minMonthlyIncome))
    ) {
      blocking.push({
        code: 'INCOME',
        message: `Minimum monthly income is ${config.eligibility.minMonthlyIncome}.`,
      });
    }
    // Debt-service ratio on the average monthly repayment.
    const months = Math.max(
      1,
      lending.daysBetween(terms.disbursementDate, sim.maturityDate) / 30.4375,
    );
    const monthlyPayment = D(sim.totals.payments).div(months);
    metrics.averageMonthlyPayment = monthlyPayment
      .toDecimalPlaces(2)
      .toString();
    if (income && income.gt(0)) {
      const dsr = monthlyPayment.div(income);
      metrics.debtServiceRatio = dsr.toDecimalPlaces(4).toString();
      if (
        stage === 'APPROVAL' &&
        config.eligibility.maxDebtServiceRatio &&
        dsr.gt(config.eligibility.maxDebtServiceRatio)
      ) {
        blocking.push({
          code: 'DSR',
          message: `Debt-service ratio ${dsr.toDecimalPlaces(3)} exceeds ${config.eligibility.maxDebtServiceRatio}.`,
        });
      }
    } else if (stage === 'APPROVAL' && config.eligibility.maxDebtServiceRatio) {
      blocking.push({
        code: 'DSR',
        message: 'Monthly income is needed to assess affordability.',
      });
    }

    if (stage === 'APPROVAL') {
      if (config.security.collateralRequired) {
        const pledges = await tx.collateralPledge.findMany({
          where: {
            tenantId: app.tenantId,
            applicationId: app.id,
            status: 'ACTIVE',
          },
          include: {
            collateral: {
              include: {
                valuations: { orderBy: { valuationDate: 'desc' }, take: 1 },
              },
            },
          },
        });
        let lendable = new lending.D(0);
        // LT-04: loans ranking ahead on the same assets count against the limit.
        let priorLiens = new lending.D(0);
        for (const p of pledges) {
          const v = p.collateral.valuations[0];
          if (!v) continue;
          const age = lending.daysBetween(
            toLocalDate(v.valuationDate)!,
            terms.disbursementDate,
          );
          if (
            config.security.valuationMaxAgeDays !== null &&
            age > config.security.valuationMaxAgeDays
          ) {
            blocking.push({
              code: 'VALUATION',
              message: `A ${p.collateral.type} valuation is ${age} days old (max ${config.security.valuationMaxAgeDays}).`,
            });
            continue;
          }
          const haircut = config.security.haircuts[p.collateral.type] ?? '0';
          lendable = lendable.plus(
            D(v.marketValue).times(new lending.D(1).minus(haircut)),
          );
          priorLiens = priorLiens.plus(D(p.collateral.priorLienAmount));
        }
        metrics.collateralLendingValue = lendable.toDecimalPlaces(4).toString();
        if (lendable.isZero())
          blocking.push({
            code: 'COLLATERAL',
            message: 'Secured products need a pledged, valued collateral.',
          });
        else {
          // Combined LTV: this loan plus everything ranking ahead of it.
          const ltv = amount.plus(priorLiens).div(lendable);
          metrics.loanToValue = ltv.toDecimalPlaces(4).toString();
          if (priorLiens.gt(0))
            metrics.priorLiens = priorLiens.toDecimalPlaces(4).toString();
          if (config.security.maxLtv && ltv.gt(config.security.maxLtv)) {
            const limit = lending.securedLineLimit(
              lendable.toString(),
              config.security.maxLtv,
              [priorLiens.toString()],
              config.pricing.rounding,
            ).limit;
            blocking.push({
              code: 'LTV',
              message: `${priorLiens.gt(0) ? 'Combined loan-to-value' : 'Loan-to-value'} ${ltv.toDecimalPlaces(3)} exceeds ${config.security.maxLtv}; the most that can be lent is ${limit}.`,
            });
          }
        }
      }
      if (config.security.guaranteeRequired) {
        const count = await tx.guarantee.count({
          where: { tenantId: app.tenantId, applicationId: app.id },
        });
        metrics.guarantees = count;
        if (count < config.security.minGuarantors)
          blocking.push({
            code: 'GUARANTEE',
            message: `At least ${config.security.minGuarantors} guarantor(s) required.`,
          });
      }
    }
    return { stage, blocking, metrics };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private normalizeTerms(
    t: lending.NegotiatedTerms & { riskCategory?: string },
  ): lending.NegotiatedTerms & { riskCategory?: string } {
    if (!t || typeof t !== 'object')
      throw new BadRequestException('terms are required');
    lending.parseDate(t.disbursementDate, 'terms.disbursementDate');
    const clean: lending.NegotiatedTerms & { riskCategory?: string } = {
      principal: decStr(t.principal),
      disbursementDate: t.disbursementDate,
      numberOfInstalments: t.numberOfInstalments,
      annualRate: t.annualRate,
      firstDueDate: t.firstDueDate,
      principalGraceInstalments: t.principalGraceInstalments,
      interestGraceInstalments: t.interestGraceInstalments,
      balloonAmount: t.balloonAmount,
      explicitSchedule: t.explicitSchedule,
      waivedFeeCodes: t.waivedFeeCodes,
      downPayment: t.downPayment,
      promotionCode: t.promotionCode,
      policies: t.policies,
      riskCategory:
        t.riskCategory && ['LOW', 'MEDIUM', 'HIGH'].includes(t.riskCategory)
          ? t.riskCategory
          : undefined,
    };
    return JSON.parse(JSON.stringify(clean));
  }

  async load(db: Tx | PrismaService, tenantId: string, id: string) {
    const app = await db.application.findFirst({ where: { id, tenantId } });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  async versionOf(
    db: Tx | PrismaService,
    app: { tenantId: string; productVersionId: string; productId: string },
  ) {
    const [version, product] = await Promise.all([
      db.productVersion.findFirst({
        where: { id: app.productVersionId, tenantId: app.tenantId },
      }),
      db.lendingProduct.findFirst({
        where: { id: app.productId, tenantId: app.tenantId },
      }),
    ]);
    return {
      version,
      product,
      config: version ? parseConfig(version.config).config : null,
    };
  }

  private async cas(
    tx: Tx,
    app: { id: string; tenantId: string; version: number },
    from: string,
    to: string,
    extra: Prisma.ApplicationUpdateManyMutationInput = {},
  ) {
    const res = await tx.application.updateMany({
      where: {
        id: app.id,
        tenantId: app.tenantId,
        status: from,
        version: app.version,
      },
      data: { ...extra, status: to, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This application');
  }
}
