import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
  decStr,
  requireTenant,
  sha256,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { applicationResource } from '../policy/resources';
import type { Resource } from '../policy/decision';
import { LendingPoliciesService } from '../products/lending-policies.service';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { CustomerDocumentsService } from '../documents/customer-documents.service';
import {
  KEY_FACTS_LANGUAGES,
  type KeyFactsDocument,
  renderKeyFacts,
} from '../documents/key-facts-render';
import { ApplicationsService } from './applications.service';
import { keyFactsBlocker, keyFactsTermsHash } from './key-facts-gate';

type Json = Prisma.InputJsonValue;
type AppRow = Awaited<ReturnType<ApplicationsService['load']>>;

/**
 * The pre-contract key facts statement (D-123, D-124).
 *
 * Issued from the approved terms when an application is approved (or on
 * demand after approval), in English and Khmer, filed in the customer's
 * library. The customer's acceptance — a signed form recorded by staff, or a
 * confirmation in the borrower portal — is recorded against the exact terms
 * version; booking refuses without it (key-facts-gate.ts).
 */
@Injectable()
export class KeyFactsService {
  private readonly logger = new Logger(KeyFactsService.name);

  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly apps: ApplicationsService,
    private readonly policies: LendingPoliciesService,
    private readonly settings: TenantSettingsService,
    private readonly library: CustomerDocumentsService,
  ) {}

  // ── Terms version ─────────────────────────────────────────────────────────

  /**
   * The approved terms as booking would contract them today: the latest
   * approval's terms, the contract composed from its policy choices, and the
   * hash that binds a statement to them.
   */
  private async contractTerms(
    tx: Tx,
    app: AppRow,
    config: lending.ProductConfig,
    configHash: string,
  ) {
    const approved = await tx.creditDecision.findFirst({
      where: { tenantId: app.tenantId, applicationId: app.id, type: 'APPROVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!approved)
      throw new ConflictException('The application has not been approved.');
    const businessDate = await this.businessDate.get(app.tenantId, tx);
    const approvedTerms = approved.terms as unknown as lending.NegotiatedTerms;
    // Disclosed as if paid out on the requested date, or today if that has passed.
    const disbursementDate =
      lending.compareDates(approvedTerms.disbursementDate, businessDate) < 0
        ? businessDate
        : approvedTerms.disbursementDate;
    const terms = { ...approvedTerms, disbursementDate };
    const contract = await this.policies.composeForContract(
      tx,
      app.tenantId,
      config,
      terms.policies,
    );
    const contractHash = contract.policies.length
      ? sha256(lending.canonicalJson(contract.config))
      : configHash;
    return {
      terms,
      contract: contract.config,
      businessDate,
      termsHash: keyFactsTermsHash(terms, contractHash),
    };
  }

  private resource(
    app: AppRow,
    version: { status: string; config: unknown } | null,
    product: { code: string; familyCode: string } | null,
  ): Resource {
    return {
      ...applicationResource(app, version, product, []),
      ownerBorrowerId: app.borrowerId,
    };
  }

  // ── Generation ────────────────────────────────────────────────────────────

  /** Generate (or return the current) statement on demand, after approval. */
  async generate(actor: LendingActor, applicationId: string) {
    return this.issue(actor, applicationId, true);
  }

  /**
   * Issue the statement as part of an approval. A failure here does not undo
   * the approval: it is logged and audited, and booking stays blocked until a
   * statement is generated on demand and accepted.
   */
  async issueAfterApproval(actor: LendingActor, applicationId: string) {
    try {
      return await this.issue(actor, applicationId, false);
    } catch (e) {
      this.logger.error(
        `Key facts statement for application ${applicationId} failed: ${(e as Error).message}`,
      );
      await this.audit.write({
        actor,
        action: 'key_facts.generate',
        resourceType: 'Application',
        resourceId: applicationId,
        outcome: 'FAILURE',
        details: { error: (e as Error).message?.slice(0, 300) },
      });
      return null;
    }
  }

  private async issue(
    actor: LendingActor,
    applicationId: string,
    enforce: boolean,
  ) {
    const tenantId = requireTenant(actor);
    // 1. Compute everything disclosed, on committed state.
    const prepared = await this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.apps.load(tx, tenantId, applicationId);
      const { version, product, config } = await this.apps.versionOf(tx, app);
      if (enforce)
        await this.policy.enforce(
          actor,
          'key_facts.generate',
          this.resource(app, version, product),
          tx,
        );
      if (app.status !== 'APPROVED')
        throw new ConflictException(
          'A key facts statement is issued once the application is approved.',
        );
      if (!config || !version)
        throw new ConflictException(
          'The product version of this application is not valid.',
        );
      const ct = await this.contractTerms(tx, app, config, version.configHash);
      const live = await tx.keyFactsStatement.findFirst({
        where: {
          tenantId,
          applicationId,
          status: { in: ['ISSUED', 'ACCEPTED'] },
        },
      });
      if (live && live.termsHash === ct.termsHash) return { existing: live };
      const facts = await this.facts(tx, tenantId, ct, version);
      const doc = await this.documentContext(
        tx,
        app,
        product?.name ?? app.reference,
        facts,
        ct.businessDate,
      );
      const last = await tx.keyFactsStatement.findFirst({
        where: { tenantId, applicationId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return {
        app,
        doc: { ...doc, version: (last?.version ?? 0) + 1 },
        termsHash: ct.termsHash,
      };
    });
    if ('existing' in prepared) return this.view(prepared.existing!);
    const { app, doc, termsHash } = prepared;

    // 2. File one document per language in the customer's library.
    const documentIds: Record<string, string> = {};
    for (const lang of KEY_FACTS_LANGUAGES) {
      const filed = await this.library.fileGenerated({
        tenantId,
        borrowerId: app.borrowerId,
        typeCode: 'KEY_FACTS',
        title: `${lang === 'km' ? 'សេចក្តីថ្លែងការណ៍ព័ត៌មានសំខាន់ៗ' : 'Key facts statement'} ${app.reference} v${doc.version} (${lang.toUpperCase()})`,
        mimeType: 'text/html',
        body: renderKeyFacts(doc, lang),
        actorId: actor.id,
        applicationId: app.id,
      });
      documentIds[lang] = filed.id;
    }

    // 3. Record the statement; any earlier one stops being in force.
    const statement = await this.lp.tenantTx(tenantId, async (tx) => {
      const current = await this.apps.load(tx, tenantId, applicationId);
      if (current.status !== 'APPROVED' || current.version !== app.version)
        throw concurrentModification('This application');
      await tx.keyFactsStatement.updateMany({
        where: {
          tenantId,
          applicationId,
          status: { in: ['ISSUED', 'ACCEPTED'] },
        },
        data: { status: 'SUPERSEDED' },
      });
      const row = await tx.keyFactsStatement.create({
        data: {
          tenantId,
          applicationId,
          borrowerId: app.borrowerId,
          version: doc.version,
          termsHash,
          languages: KEY_FACTS_LANGUAGES,
          documentIds,
          content: doc as unknown as Json,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          generatedBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'key_facts.generate',
          resourceType: 'Application',
          resourceId: applicationId,
          outcome: 'SUCCESS',
          details: {
            statement: row.id,
            version: row.version,
            termsHash,
            documents: documentIds,
          },
        },
        tx,
      );
      return row;
    });
    return this.view(statement);
  }

  /** The figures of the statement, computed as booking would compute them. */
  private async facts(
    tx: Tx,
    tenantId: string,
    ct: Awaited<ReturnType<KeyFactsService['contractTerms']>>,
    version: { id: string; version: number },
  ): Promise<lending.KeyFacts> {
    const { terms, contract } = ct;
    if (contract.facility.type !== 'TERM') {
      // A line is a limit: no schedule and no upfront fees at booking.
      const limit = terms.principal;
      return lending.buildKeyFacts({
        currency: contract.identity.currency,
        principal: limit,
        disbursementDate: terms.disbursementDate,
        nominalAnnualRate:
          terms.annualRate ?? contract.pricing.fixed?.defaultAnnualRate ?? null,
        effectiveAnnualRate: null,
        fees: {
          lines: [],
          financed: '0',
          deducted: '0',
          separate: '0',
          bookedPrincipal: limit,
          netDisbursement: limit,
        },
        schedule: null,
        config: contract,
      });
    }
    const booking = await this.apps.bookingCalculation(
      tx,
      tenantId,
      contract,
      terms,
      { productVersionId: version.id, productVersion: version.version },
    );
    return lending.buildKeyFacts({
      currency: contract.identity.currency,
      principal: terms.principal,
      disbursementDate: terms.disbursementDate,
      nominalAnnualRate:
        booking.input.annualRate ??
        booking.schedule.lines[0]?.annualRate ??
        null,
      effectiveAnnualRate: booking.apr,
      fees: booking.fees,
      schedule: booking.schedule,
      config: contract,
    });
  }

  /** Who and what the statement names besides the figures. */
  private async documentContext(
    tx: Tx,
    app: AppRow,
    productName: string,
    facts: lending.KeyFacts,
    issuedOn: string,
  ): Promise<Omit<KeyFactsDocument, 'version'>> {
    const tenantId = app.tenantId;
    const [settings, tenant, borrower, pledges, guarantees] = await Promise.all(
      [
        this.settings.get(tenantId, tx),
        tx.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true },
        }),
        tx.borrower.findFirst({
          where: { id: app.borrowerId, tenantId },
          select: { firstName: true, lastName: true },
        }),
        tx.collateralPledge.findMany({
          where: { tenantId, applicationId: app.id, status: 'ACTIVE' },
          include: {
            collateral: {
              include: {
                valuations: { orderBy: { valuationDate: 'desc' }, take: 1 },
              },
            },
          },
        }),
        tx.guarantee.findMany({ where: { tenantId, applicationId: app.id } }),
      ],
    );
    const cp = settings.consumerProtection;
    return {
      facts,
      issuedOn,
      lender: {
        name: cp.lenderLegalName ?? tenant?.name ?? '—',
        licenceNumber: cp.licenceNumber,
      },
      borrower: {
        name: borrower ? `${borrower.firstName} ${borrower.lastName}` : '—',
      },
      application: { reference: app.reference },
      product: { name: productName },
      security: {
        collateral: pledges.map((p) => ({
          type: p.collateral.type,
          description: p.collateral.description,
          value: p.collateral.valuations[0]
            ? decStr(p.collateral.valuations[0].marketValue)
            : null,
          currency: p.collateral.currency,
        })),
        guarantees: guarantees.map((g) => ({
          name: g.guarantorName,
          type: g.type,
          amount: decStr(g.amount),
          currency: g.currency,
        })),
      },
      coolingOff: {
        days: cp.coolingOffDays,
        chargesAccruedInterest: cp.coolingOffChargesAccruedInterest,
        refundsLenderFees: cp.coolingOffRefundsLenderFees,
      },
      complaints: {
        phone: cp.complaints.phone,
        email: cp.complaints.email,
        address: cp.complaints.address,
        regulator: cp.regulatorContact,
      },
    };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  private view(row: {
    id: string;
    applicationId: string;
    version: number;
    status: string;
    termsHash: string;
    languages: string[];
    documentIds: unknown;
    content: unknown;
    createdAt: Date;
    generatedBy: string;
    acceptedAt: Date | null;
    acceptedByType: string | null;
    acceptedById: string | null;
    acceptanceMethod: string | null;
    acceptanceDocumentId: string | null;
    loanAccountId: string | null;
  }) {
    const content = row.content as KeyFactsDocument;
    return {
      id: row.id,
      applicationId: row.applicationId,
      version: row.version,
      status: row.status,
      termsHash: row.termsHash,
      languages: row.languages,
      documentIds: row.documentIds as Record<string, string>,
      facts: content.facts,
      lender: content.lender,
      coolingOff: content.coolingOff,
      complaints: content.complaints,
      issuedOn: content.issuedOn,
      createdAt: row.createdAt,
      generatedBy: row.generatedBy,
      acceptedAt: row.acceptedAt,
      acceptedByType: row.acceptedByType,
      acceptedById: row.acceptedById,
      acceptanceMethod: row.acceptanceMethod,
      acceptanceDocumentId: row.acceptanceDocumentId,
      loanAccountId: row.loanAccountId,
      warnings: warningsOf(content),
    };
  }

  /** Every statement of an application, the one in force, and what blocks booking. */
  async forApplication(actor: LendingActor, applicationId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.apps.load(tx, tenantId, applicationId);
      const { version, product, config } = await this.apps.versionOf(tx, app);
      await this.policy.enforce(
        actor,
        'key_facts.read',
        this.resource(app, version, product),
        tx,
      );
      const rows = await tx.keyFactsStatement.findMany({
        where: { tenantId, applicationId },
        orderBy: { version: 'desc' },
      });
      let blocker: Awaited<ReturnType<typeof keyFactsBlocker>> = null;
      let currentHash: string | null = null;
      if (app.status === 'APPROVED' && config && version) {
        try {
          currentHash = (
            await this.contractTerms(tx, app, config, version.configHash)
          ).termsHash;
        } catch {
          currentHash = null;
        }
        blocker = await keyFactsBlocker(
          tx,
          tenantId,
          applicationId,
          currentHash,
        );
      }
      const statements = rows.map((r) => this.view(r));
      return {
        applicationStatus: app.status,
        current:
          statements.find((s) => ['ISSUED', 'ACCEPTED'].includes(s.status)) ??
          null,
        currentTermsHash: currentHash,
        bookingBlocker: blocker,
        statements,
      };
    });
  }

  /** What stops booking on disclosure grounds, for the capability map; null when nothing does. */
  async bookingBlocker(tenantId: string, applicationId: string) {
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await tx.application.findFirst({
        where: { id: applicationId, tenantId },
      });
      if (!app || app.status !== 'APPROVED') return null;
      const { version, config } = await this.apps.versionOf(tx, app);
      if (!config || !version) return null;
      const ct = await this.contractTerms(tx, app, config, version.configHash);
      return keyFactsBlocker(tx, tenantId, applicationId, ct.termsHash);
    });
  }

  // ── Acceptance ────────────────────────────────────────────────────────────

  /**
   * Staff record the customer's acceptance from a signed form filed in the
   * customer's library. The statement must still match the approved terms.
   */
  async recordAcceptance(
    actor: LendingActor,
    applicationId: string,
    statementId: string,
    body: { method: 'SIGNED_FORM'; documentId: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const app = await this.apps.load(tx, tenantId, applicationId);
      const { version, product } = await this.apps.versionOf(tx, app);
      await this.policy.enforce(
        actor,
        'key_facts.record_acceptance',
        this.resource(app, version, product),
        tx,
      );
      const form = await tx.customerDocument.findFirst({
        where: {
          id: body.documentId,
          tenantId,
          borrowerId: app.borrowerId,
          status: 'ACTIVE',
          category: { not: 'GENERATED' },
        },
        select: { id: true },
      });
      if (!form)
        throw new BadRequestException(
          'The signed form must be a document in this customer’s library.',
        );
      return this.accept(tx, actor, app, statementId, {
        type: 'STAFF_ON_BEHALF',
        method: 'SIGNED_FORM',
        documentId: form.id,
      });
    });
  }

  /** The customer accepts in the borrower portal, confirming the version they read. */
  async acceptOwn(
    actor: LendingActor,
    statementId: string,
    body: { termsHash: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const statement = await tx.keyFactsStatement.findFirst({
        where: { id: statementId, tenantId },
      });
      if (!statement) throw new NotFoundException('Statement not found');
      const app = await this.apps.load(tx, tenantId, statement.applicationId);
      const { version, product } = await this.apps.versionOf(tx, app);
      await this.policy.enforce(
        actor,
        'key_facts.accept_own',
        this.resource(app, version, product),
        tx,
      );
      if (body.termsHash !== statement.termsHash)
        throw new ConflictException(
          'The statement changed since it was shown; review the current version.',
        );
      return this.accept(tx, actor, app, statementId, {
        type: 'CUSTOMER',
        method: 'PORTAL',
        documentId: null,
      });
    });
  }

  private async accept(
    tx: Tx,
    actor: LendingActor,
    app: AppRow,
    statementId: string,
    by: {
      type: 'CUSTOMER' | 'STAFF_ON_BEHALF';
      method: 'SIGNED_FORM' | 'PORTAL';
      documentId: string | null;
    },
  ) {
    const tenantId = app.tenantId;
    const statement = await tx.keyFactsStatement.findFirst({
      where: { id: statementId, tenantId, applicationId: app.id },
    });
    if (!statement) throw new NotFoundException('Statement not found');
    if (statement.status !== 'ISSUED')
      throw new ConflictException(
        statement.status === 'ACCEPTED'
          ? 'The customer has already accepted this statement.'
          : `Statement v${statement.version} is ${statement.status.toLowerCase()}; only the statement in force can be accepted.`,
      );
    const { version, config } = await this.apps.versionOf(tx, app);
    const ct = await this.contractTerms(tx, app, config!, version!.configHash);
    if (ct.termsHash !== statement.termsHash)
      throw new ConflictException({
        message:
          'The approved terms changed after this statement was issued; generate a new statement for the customer.',
        code: 'KEY_FACTS_STALE',
      });
    const res = await tx.keyFactsStatement.updateMany({
      where: { id: statementId, tenantId, status: 'ISSUED' },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        acceptedByType: by.type,
        acceptedById: actor.id,
        acceptanceMethod: by.method,
        acceptanceDocumentId: by.documentId,
      },
    });
    if (res.count !== 1) throw concurrentModification('This statement');
    const action =
      by.type === 'CUSTOMER'
        ? 'key_facts.accept_own'
        : 'key_facts.record_acceptance';
    await this.audit.write(
      {
        actor,
        action,
        resourceType: 'Application',
        resourceId: app.id,
        outcome: 'SUCCESS',
        details: {
          statement: statementId,
          version: statement.version,
          method: by.method,
          document: by.documentId,
        },
      },
      tx,
    );
    const row = await tx.keyFactsStatement.findFirst({
      where: { id: statementId, tenantId },
    });
    return this.view(row!);
  }

  // ── Borrower portal ───────────────────────────────────────────────────────

  /** The customer's own statements awaiting (or holding) their acceptance. */
  async portalList(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const rows = await tx.keyFactsStatement.findMany({
        where: {
          tenantId,
          borrowerId: actor.id,
          status: { in: ['ISSUED', 'ACCEPTED'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      const out: (ReturnType<KeyFactsService['view']> & {
        applicationReference: string;
      })[] = [];
      for (const r of rows) {
        const app = await this.apps.load(tx, tenantId, r.applicationId);
        const { version, product } = await this.apps.versionOf(tx, app);
        const d = await this.policy.decide(
          actor,
          'key_facts.read_own',
          this.resource(app, version, product),
          tx,
        );
        if (d.allowed)
          out.push({ ...this.view(r), applicationReference: app.reference });
      }
      return out;
    });
  }
}

/** Contacts a statement printed as "not configured": staff fix the settings before go-live. */
function warningsOf(content: KeyFactsDocument): string[] {
  const w: string[] = [];
  if (!content.lender?.licenceNumber)
    w.push('consumerProtection.licenceNumber is not set');
  const c = content.complaints;
  if (c && !c.phone && !c.email && !c.address)
    w.push('consumerProtection.complaints has no phone, email or address');
  return w;
}
