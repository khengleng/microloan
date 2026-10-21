import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lending } from '@microloan/shared';
import type { CreditReport, Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  LendingActor,
  fromLocalDate,
  requireTenant,
  sha256,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { CustomerDocumentsService } from '../documents/customer-documents.service';
import { AlternativeDataService } from './alternative-data.service';
import { ScorecardsService } from './scorecards.service';
import {
  CbcBureauShell,
  InternalCreditBureau,
  type BureauAvailability,
  type CreditBureauProvider,
  type CreditBureauProviderCode,
} from './credit-bureau';
import {
  renderCreditReportPdf,
  type StoredCreditReport,
} from './credit-report-pdf';

type Json = Prisma.InputJsonValue;

export const CREDIT_REPORT_PURPOSES = [
  'NEW_APPLICATION',
  'ACCOUNT_REVIEW',
  'COLLECTIONS',
  'CUSTOMER_REQUEST',
] as const;
export type CreditReportPurpose = (typeof CREDIT_REPORT_PURPOSES)[number];

/** The consent a pull needs (an alternative-data consent source, D-178). */
export const CREDIT_REPORT_CONSENT: lending.AltDataSource = 'CREDIT_REPORT';

/** What the stored inputs hold: everything needed to rebuild the report and its score. */
interface StoredInputs {
  report: lending.CreditReportInput;
  rules: lending.BureauScoreRules;
  scorecard: {
    code: string;
    version: number;
    source: string;
    definitionHash: string;
  };
  engineVersion: string;
}

/** The bureau input a score uses: the report it came from, or why there is none. */
export interface BureauForScoring {
  report: CreditReport | null;
  consentId: string | null;
  reused: boolean;
  note: string;
}

/**
 * Credit reports and the in-house bureau score (DECISIONS D-176…D-181).
 *
 * A pull is an enquiry: who asked, when, why and under which consent. It
 * needs the borrower's CREDIT_REPORT consent in force. The provider is the
 * tenant's choice (INTERNAL by default; CBC is on hold); the report is
 * built by the engine from what the provider returns, scored on the
 * INTERNAL_BUREAU scorecard (or the tenant's own version of it) and stored
 * append-only with its inputs and their hash, so it can be rebuilt exactly.
 * The printable report (PDF, English and Khmer headings) is filed in the
 * customer's documents.
 */
@Injectable()
export class CreditReportService {
  private readonly logger = new Logger(CreditReportService.name);
  private readonly cbc = new CbcBureauShell();

  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
    private readonly settings: TenantSettingsService,
    private readonly altData: AlternativeDataService,
    private readonly scorecards: ScorecardsService,
    private readonly internal: InternalCreditBureau,
    private readonly library: CustomerDocumentsService,
  ) {}

  provider(code: CreditBureauProviderCode): CreditBureauProvider {
    return code === 'CBC' ? this.cbc : this.internal;
  }

  /** The provider the tenant's settings name, and whether it can be used now. */
  async providerStatus(
    tx: Tx,
    tenantId: string,
  ): Promise<{
    provider: CreditBureauProviderCode;
    availability: BureauAvailability;
  }> {
    const s = (await this.settings.get(tenantId, tx)).scoring.creditReport;
    const provider = this.provider(s.provider);
    return {
      provider: s.provider,
      availability: await provider.availability(tx, tenantId),
    };
  }

  // ── Pulling ───────────────────────────────────────────────────────────────

  /** Pull a report inside the caller's transaction (no permission check: the caller has made it). */
  async pullInTx(
    tx: Tx,
    x: {
      tenantId: string;
      borrowerId: string;
      applicationId: string | null;
      purpose: CreditReportPurpose;
      trigger: 'SCORING' | 'STAFF';
      actorId: string;
      actorType?: 'USER' | 'SERVICE';
    },
  ): Promise<CreditReport> {
    const { tenantId, borrowerId } = x;
    const settings = (await this.settings.get(tenantId, tx)).scoring
      .creditReport;
    const provider = this.provider(settings.provider);
    const a = await provider.availability(tx, tenantId);
    if (!a.usable)
      throw new ServiceUnavailableException({
        message: a.message,
        code: 'BUREAU_NOT_CONFIGURED',
        provider: settings.provider,
        capability: a.capability,
      });
    const consent = await this.altData.consentInForce(
      tx,
      tenantId,
      borrowerId,
      CREDIT_REPORT_CONSENT,
    );
    if (!consent)
      throw new BadRequestException({
        message:
          'The customer has not consented to a credit report being pulled (no CREDIT_REPORT consent in force). Record the consent first.',
        code: 'CONSENT_REQUIRED',
      });
    if (x.purpose === 'NEW_APPLICATION' && !x.applicationId)
      throw new BadRequestException(
        'A report for a new application must name the application.',
      );
    const card = await this.scorecards.effective(
      tx,
      tenantId,
      settings.scorecardCode,
    );
    if (!card)
      throw new BadRequestException({
        message: `The bureau scorecard ${settings.scorecardCode} named in the lending settings is neither a template nor one of this organisation's scorecards.`,
        code: 'SCORECARD_NOT_FOUND',
      });
    const asOf = await this.businessDate.get(tenantId, tx);
    const id = randomUUID();
    const reference = `CR-${asOf.replace(/-/g, '')}-${id.slice(0, 8).toUpperCase()}`;
    const input = await provider.fetch(tx, {
      tenantId,
      borrowerId,
      applicationId: x.applicationId,
      consentId: consent.id,
      asOf,
      enquiry: { id, reference, purpose: x.purpose, by: x.actorId },
    });
    const rules: lending.BureauScoreRules = {
      minHistoryMonths: settings.minHistoryMonths,
      derogatoryDpd: settings.derogatoryDpd,
    };
    const inputs: StoredInputs = {
      report: input,
      rules,
      scorecard: {
        code: card.code,
        version: card.version,
        source: card.source,
        definitionHash: card.definitionHash,
      },
      engineVersion: lending.LENDING_ENGINE_VERSION,
    };
    const content = CreditReportService.build(
      inputs,
      card.definition,
      settings.provider,
    );
    const row = await tx.creditReport.create({
      data: {
        id,
        tenantId,
        borrowerId,
        reference,
        provider: settings.provider,
        purpose: x.purpose,
        applicationId: x.applicationId,
        trigger: x.trigger,
        consentId: consent.id,
        requestedBy: x.actorId,
        asOf: fromLocalDate(asOf),
        inputs: inputs as unknown as Json,
        inputsHash: sha256(lending.canonicalJson(inputs)),
        content: content as unknown as Json,
        contentHash: sha256(lending.canonicalJson(content)),
        score: content.score.score,
        grade: content.score.grade,
        noScoreReason: content.score.noScoreReason,
        scorecardCode: card.code,
        scorecardVersion: card.version,
        scorecardDefinitionHash: card.definitionHash,
        engineVersion: lending.LENDING_ENGINE_VERSION,
      },
    });
    await this.audit.write(
      {
        actor: {
          id: x.actorId,
          type: x.actorType ?? 'USER',
          tenantId,
        },
        action: 'credit_report.pull',
        resourceType: 'CreditReport',
        resourceId: row.id,
        outcome: 'SUCCESS',
        businessDate: fromLocalDate(asOf),
        details: {
          borrowerId,
          applicationId: x.applicationId,
          purpose: x.purpose,
          trigger: x.trigger,
          provider: settings.provider,
          consentId: consent.id,
          score: row.score,
          noScoreReason: row.noScoreReason,
          inputsHash: row.inputsHash,
        },
      },
      tx,
    );
    return row;
  }

  /** The report body and score from stored inputs: how a report is built, and rebuilt. */
  static build(
    inputs: StoredInputs,
    definition: lending.ScorecardDefinition,
    provider: string,
  ): StoredCreditReport {
    const body = lending.buildCreditReport(inputs.report);
    const score = lending.scoreCreditReport(definition, body, inputs.rules);
    return {
      ...body,
      provider,
      score: {
        ...score,
        scorecard: {
          code: inputs.scorecard.code,
          version: inputs.scorecard.version,
          source: inputs.scorecard.source,
        },
      },
    };
  }

  /**
   * The bureau input for an application being scored: a report pulled now
   * (an enquiry), or the application's own recent one re-used, or — when
   * the settings say not to pull, the provider cannot be used or the
   * customer has not consented — none, with the reason. Never blocks the
   * score: without a report the bureau input is simply missing, as before.
   */
  async forScoring(
    tx: Tx,
    x: {
      tenantId: string;
      borrowerId: string;
      applicationId: string;
      actorId: string;
      asOf: string;
    },
  ): Promise<BureauForScoring> {
    const settings = (await this.settings.get(x.tenantId, tx)).scoring
      .creditReport;
    const none = (note: string, consentId: string | null = null) => ({
      report: null,
      consentId,
      reused: false,
      note,
    });
    if (!settings.pullOnScoring)
      return none(
        'Credit reports are not pulled when scoring (lending settings).',
      );
    const a = await this.provider(settings.provider).availability(
      tx,
      x.tenantId,
    );
    if (!a.usable) return none(a.message);
    const consent = await this.altData.consentInForce(
      tx,
      x.tenantId,
      x.borrowerId,
      CREDIT_REPORT_CONSENT,
    );
    if (!consent)
      return none(`No consent in force for ${CREDIT_REPORT_CONSENT}.`);
    if (settings.reuseDays > 0) {
      const last = await tx.creditReport.findFirst({
        where: {
          tenantId: x.tenantId,
          applicationId: x.applicationId,
          borrowerId: x.borrowerId,
          provider: settings.provider,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (
        last &&
        lending.daysBetween(toLocalDate(last.asOf)!, x.asOf) <
          settings.reuseDays
      )
        return {
          report: last,
          consentId: consent.id,
          reused: true,
          note: `Credit report ${last.reference} of ${toLocalDate(last.asOf)} re-used (pulled within ${settings.reuseDays} days).`,
        };
    }
    try {
      const report = await this.pullInTx(tx, {
        tenantId: x.tenantId,
        borrowerId: x.borrowerId,
        applicationId: x.applicationId,
        purpose: 'NEW_APPLICATION',
        trigger: 'SCORING',
        actorId: x.actorId,
      });
      return {
        report,
        consentId: consent.id,
        reused: false,
        note: `Credit report ${report.reference} pulled.`,
      };
    } catch (e) {
      // A configuration problem (e.g. the bureau scorecard) leaves the input
      // missing; a database error is not swallowed.
      if (e instanceof HttpException)
        return none(`No credit report: ${e.message}`, consent.id);
      throw e;
    }
  }

  // ── Staff routes ──────────────────────────────────────────────────────────

  async pull(
    actor: LendingActor,
    borrowerId: string,
    body: { purpose: CreditReportPurpose; applicationId?: string },
  ) {
    const tenantId = requireTenant(actor);
    const row = await this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'credit_report.pull',
        await this.altData.customer(tx, tenantId, borrowerId),
        tx,
      );
      if (body.applicationId) {
        const app = await tx.application.findFirst({
          where: { id: body.applicationId, tenantId, borrowerId },
          select: { id: true },
        });
        if (!app)
          throw new NotFoundException(
            'Application not found for this customer',
          );
      }
      return this.pullInTx(tx, {
        tenantId,
        borrowerId,
        applicationId: body.applicationId ?? null,
        purpose: body.purpose,
        trigger: 'STAFF',
        actorId: actor.id,
        actorType: actor.type === 'SERVICE' ? 'SERVICE' : 'USER',
      });
    });
    const documentId = await this.fileDocument(tenantId, row, actor.id);
    return this.view({ ...row, documentId: documentId ?? row.documentId });
  }

  /** A customer's reports (newest first), the provider in force and the consent. */
  async list(actor: LendingActor, borrowerId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'credit_report.read',
        await this.altData.customer(tx, tenantId, borrowerId),
        tx,
      );
      const [rows, status, consent] = await Promise.all([
        tx.creditReport.findMany({
          where: { tenantId, borrowerId },
          orderBy: { createdAt: 'desc' },
        }),
        this.providerStatus(tx, tenantId),
        this.altData.consentInForce(
          tx,
          tenantId,
          borrowerId,
          CREDIT_REPORT_CONSENT,
        ),
      ]);
      return {
        borrowerId,
        ...status,
        consent: consent
          ? { grantId: consent.id, expiresAt: consent.expiresAt }
          : null,
        purposes: CREDIT_REPORT_PURPOSES,
        reports: rows.map((r) => this.summary(r)),
        latest: rows[0] ? this.view(rows[0]) : null,
      };
    });
  }

  /** The application's latest report (or the customer's, when none was pulled for it). */
  async forApplication(actor: LendingActor, applicationId: string) {
    const tenantId = requireTenant(actor);
    const app = await this.lp.tenantTx(tenantId, (tx) =>
      tx.application.findFirst({
        where: { id: applicationId, tenantId },
        select: { id: true, borrowerId: true, reference: true },
      }),
    );
    if (!app) throw new NotFoundException('Application not found');
    const all = await this.list(actor, app.borrowerId);
    const own = await this.lp.tenantTx(tenantId, (tx) =>
      tx.creditReport.findFirst({
        where: { tenantId, applicationId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return {
      ...all,
      applicationId,
      applicationReference: app.reference,
      latest: own ? this.view(own) : all.latest,
      forThisApplication: !!own,
    };
  }

  /** One report in full, with a check that it still rebuilds from its inputs. */
  async get(actor: LendingActor, reportId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await this.load(tx, tenantId, reportId);
      await this.policy.enforce(
        actor,
        'credit_report.read',
        await this.altData.customer(tx, tenantId, row.borrowerId),
        tx,
      );
      return { ...this.view(row), integrity: await this.verify(tx, row) };
    });
  }

  /** The printable report; filed in the customer's documents the first time it is printed, if not yet. */
  async pdf(actor: LendingActor, reportId: string) {
    const tenantId = requireTenant(actor);
    const row = await this.lp.tenantTx(tenantId, async (tx) => {
      const r = await this.load(tx, tenantId, reportId);
      await this.policy.enforce(
        actor,
        'credit_report.read',
        await this.altData.customer(tx, tenantId, r.borrowerId),
        tx,
      );
      return r;
    });
    const body = await this.render(tenantId, row);
    if (!row.documentId) await this.fileDocument(tenantId, row, actor.id, body);
    return { fileName: `${row.reference}.pdf`, body };
  }

  /**
   * Whether a stored report still rebuilds exactly: the inputs hash matches
   * the stored inputs, and building the report from them with the scorecard
   * version it used gives the stored content.
   */
  async verify(
    tx: Tx,
    row: CreditReport,
  ): Promise<{ inputsHashValid: boolean; reproduced: boolean | null }> {
    const inputs = row.inputs as unknown as StoredInputs;
    const inputsHashValid =
      sha256(lending.canonicalJson(inputs)) === row.inputsHash;
    const definition = await this.definitionOf(tx, row);
    if (!definition) return { inputsHashValid, reproduced: null };
    const rebuilt = CreditReportService.build(inputs, definition, row.provider);
    return {
      inputsHashValid,
      reproduced: sha256(lending.canonicalJson(rebuilt)) === row.contentHash,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async definitionOf(
    tx: Tx,
    row: CreditReport,
  ): Promise<lending.ScorecardDefinition | null> {
    if (row.scorecardVersion === 0) {
      const t = lending.SCORECARD_TEMPLATE_BY_CODE[row.scorecardCode];
      return t &&
        ScorecardsService.hash(t.definition) === row.scorecardDefinitionHash
        ? t.definition
        : null;
    }
    const v = await tx.scorecardVersion.findFirst({
      where: {
        tenantId: row.tenantId,
        version: row.scorecardVersion,
        definitionHash: row.scorecardDefinitionHash,
        scorecard: { tenantId: row.tenantId, code: row.scorecardCode },
      },
      select: { definition: true },
    });
    if (!v) return null;
    const valid = lending.validateScorecardDefinition(v.definition);
    return valid.ok ? valid.definition : null;
  }

  private async load(tx: Tx, tenantId: string, id: string) {
    const row = await tx.creditReport.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Credit report not found');
    return row;
  }

  private async render(tenantId: string, row: CreditReport) {
    const meta = await this.lp.tenantTx(tenantId, async (tx) => {
      const [tenant, settings, user, app] = await Promise.all([
        tx.tenant.findFirst({
          where: { id: tenantId },
          select: { name: true },
        }),
        this.settings.get(tenantId, tx),
        tx.user.findFirst({
          where: { id: row.requestedBy, tenantId },
          select: { email: true },
        }),
        row.applicationId
          ? tx.application.findFirst({
              where: { id: row.applicationId, tenantId },
              select: { reference: true },
            })
          : null,
      ]);
      return {
        lender:
          settings.consumerProtection.lenderLegalName ?? tenant?.name ?? '',
        requestedBy: user?.email ?? row.requestedBy,
        applicationReference: app?.reference ?? null,
      };
    });
    return renderCreditReportPdf({
      ...meta,
      reference: row.reference,
      provider: row.provider,
      purpose: row.purpose,
      requestedAt:
        row.createdAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      content: row.content as unknown as StoredCreditReport,
    });
  }

  /**
   * File the printable report in the customer's documents and link it, once.
   * Filing never undoes the pull it follows: a failure is logged and the
   * report can be printed (and filed) again later.
   */
  private async fileDocument(
    tenantId: string,
    row: CreditReport,
    actorId: string,
    body?: Buffer,
  ): Promise<string | null> {
    try {
      const pdf = body ?? (await this.render(tenantId, row));
      const doc = await this.library.fileGenerated({
        tenantId,
        borrowerId: row.borrowerId,
        typeCode: 'CREDIT_REPORT',
        title: `Credit report ${row.reference} as of ${toLocalDate(row.asOf)}`,
        mimeType: 'application/pdf',
        body: pdf,
        actorId,
        applicationId: row.applicationId,
        customerVisible: false,
      });
      await this.lp.tenantTx(tenantId, (tx) =>
        tx.creditReport.updateMany({
          where: { id: row.id, tenantId, documentId: null },
          data: { documentId: doc.id },
        }),
      );
      return doc.id;
    } catch (e) {
      this.logger.error(
        `Filing credit report ${row.reference} failed: ${(e as Error).message}`,
      );
      return null;
    }
  }

  private summary(r: CreditReport) {
    const c = r.content as unknown as StoredCreditReport;
    return {
      id: r.id,
      reference: r.reference,
      provider: r.provider,
      purpose: r.purpose,
      trigger: r.trigger,
      applicationId: r.applicationId,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt,
      asOf: toLocalDate(r.asOf),
      score: r.score,
      grade: r.grade,
      noScoreReason: r.noScoreReason,
      documentId: r.documentId,
      activeFacilities: c.totals?.activeFacilities ?? 0,
      exposure: c.totals?.exposure ?? [],
    };
  }

  private view(r: CreditReport) {
    return {
      ...this.summary(r),
      consentId: r.consentId,
      scorecardCode: r.scorecardCode,
      scorecardVersion: r.scorecardVersion,
      inputsHash: r.inputsHash,
      contentHash: r.contentHash,
      engineVersion: r.engineVersion,
      content: r.content as unknown as StoredCreditReport,
    };
  }
}
