import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  requireTenant,
  sha256,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';

type Json = Prisma.InputJsonValue;

/** A scorecard as it scores: the tenant's ACTIVE version, or the template of that code. */
export interface EffectiveScorecard {
  code: string;
  name: string;
  definition: lending.ScorecardDefinition;
  definitionHash: string;
  source: 'TENANT' | 'TEMPLATE';
  versionId: string | null;
  version: number;
}

const TRANSITIONS = {
  submit: { action: 'scorecard.manage', from: ['DRAFT'], to: 'SUBMITTED' },
  approve: { action: 'scorecard.approve', from: ['SUBMITTED'], to: 'APPROVED' },
  reject: { action: 'scorecard.approve', from: ['SUBMITTED'], to: 'REJECTED' },
  activate: { action: 'scorecard.approve', from: ['APPROVED'], to: 'ACTIVE' },
  retire: {
    action: 'scorecard.approve',
    from: ['APPROVED', 'ACTIVE'],
    to: 'RETIRED',
  },
} as const;
export type ScorecardTransition = keyof typeof TRANSITIONS;

/**
 * Tenant scorecards (DECISIONS D-075): versioned definitions under
 * maker-checker. A risk analyst drafts and submits; someone else approves
 * and activates (the database refuses a checker or activator who is the
 * maker). Activating a version retires the one in force. Until a tenant has
 * an ACTIVE version of a code, that code's template scores.
 */
@Injectable()
export class ScorecardsService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
  ) {}

  private resource(
    tenantId: string,
    id = 'scorecards',
    makers: string[] = [],
    state?: string,
  ) {
    return tenantResource(tenantId, 'TENANT', id, makers, state);
  }

  static hash(d: lending.ScorecardDefinition): string {
    return sha256(lending.canonicalJson(d));
  }

  static validOrThrow(raw: unknown): lending.ScorecardDefinition {
    const v = lending.validateScorecardDefinition(raw);
    if (!v.ok)
      throw new BadRequestException({
        message: 'The scorecard definition is not valid.',
        code: 'SCORECARD_INVALID',
        issues: v.issues,
      });
    return v.definition;
  }

  /** The scorecard of a code that scores now; null when neither a tenant version nor a template exists. */
  async effective(
    tx: Tx,
    tenantId: string,
    code: string,
  ): Promise<EffectiveScorecard | null> {
    const v = await tx.scorecardVersion.findFirst({
      where: { tenantId, status: 'ACTIVE', scorecard: { tenantId, code } },
      include: { scorecard: { select: { name: true } } },
    });
    if (v) {
      const valid = lending.validateScorecardDefinition(v.definition);
      // A stored version that no longer validates fails closed.
      if (!valid.ok)
        throw new BadRequestException(
          `Scorecard ${code} version ${v.version} no longer validates: ${valid.issues[0]?.message}. Activate a corrected version.`,
        );
      return {
        code,
        name: v.scorecard.name,
        definition: valid.definition,
        definitionHash: v.definitionHash,
        source: 'TENANT',
        versionId: v.id,
        version: v.version,
      };
    }
    const t = lending.SCORECARD_TEMPLATE_BY_CODE[code];
    if (!t) return null;
    return {
      code,
      name: t.name,
      definition: t.definition,
      definitionHash: ScorecardsService.hash(t.definition),
      source: 'TEMPLATE',
      versionId: null,
      version: 0,
    };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async catalogue(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'scorecard.read', this.resource(tenantId));
    return this.lp.tenantTx(tenantId, async (tx) => {
      const scorecards = await tx.scorecard.findMany({
        where: { tenantId },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            select: {
              id: true,
              version: true,
              status: true,
              changeSummary: true,
              makerId: true,
              checkerId: true,
              activatedBy: true,
              createdAt: true,
              approvedAt: true,
              activatedAt: true,
            },
          },
        },
        orderBy: { code: 'asc' },
      });
      return {
        scorecards,
        templates: lending.SCORECARD_TEMPLATES,
        variables: lending.SCORING_VARIABLES,
        // Codes that score from the template because the tenant has no version in force.
        templateInForce: lending.SCORECARD_TEMPLATES.map((t) => t.code).filter(
          (code) =>
            !scorecards.some(
              (s) =>
                s.code === code &&
                s.versions.some((v) => v.status === 'ACTIVE'),
            ),
        ),
      };
    });
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'scorecard.read', this.resource(tenantId));
    return this.lp.tenantTx(tenantId, async (tx) => {
      const s = await tx.scorecard.findFirst({
        where: { id, tenantId },
        include: { versions: { orderBy: { version: 'desc' } } },
      });
      if (!s) throw new NotFoundException('Scorecard not found');
      return s;
    });
  }

  // ── Drafting ──────────────────────────────────────────────────────────────

  /** A new scorecard with a DRAFT first version: from a template, or a definition. */
  async create(
    actor: LendingActor,
    body: {
      code: string;
      name: string;
      description?: string;
      templateCode?: string;
      definition?: unknown;
      changeSummary?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'scorecard.manage',
      this.resource(tenantId),
    );
    const template = body.templateCode
      ? lending.SCORECARD_TEMPLATE_BY_CODE[body.templateCode]
      : null;
    if (body.templateCode && !template)
      throw new BadRequestException(
        `Unknown scorecard template ${body.templateCode}.`,
      );
    if (!template && body.definition === undefined)
      throw new BadRequestException('Give a templateCode or a definition.');
    const definition = ScorecardsService.validOrThrow(
      body.definition ?? template!.definition,
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      if (
        await tx.scorecard.findFirst({ where: { tenantId, code: body.code } })
      )
        throw new ConflictException(
          `Scorecard ${body.code} already exists; add a version to it instead.`,
        );
      const s = await tx.scorecard.create({
        data: {
          tenantId,
          code: body.code,
          name: body.name,
          description: body.description ?? template?.description ?? '',
          templateCode: template?.code ?? null,
          createdBy: actor.id,
        },
      });
      const v = await this.newVersion(tx, tenantId, s.id, 1, definition, {
        changeSummary:
          body.changeSummary ??
          (template
            ? `Installed from template ${template.code}`
            : 'First version'),
        makerId: actor.id,
      });
      await this.audit.write(
        {
          actor,
          action: 'scorecard.manage',
          resourceType: 'Scorecard',
          resourceId: s.id,
          outcome: 'SUCCESS',
          details: { code: s.code, template: template?.code, version: v.id },
        },
        tx,
      );
      return { ...s, versions: [v] };
    });
  }

  /** A new DRAFT version, starting from the given definition or the latest version's. */
  async addVersion(
    actor: LendingActor,
    scorecardId: string,
    body: { definition?: unknown; changeSummary?: string },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'scorecard.manage',
      this.resource(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const s = await tx.scorecard.findFirst({
        where: { id: scorecardId, tenantId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!s) throw new NotFoundException('Scorecard not found');
      const latest = s.versions[0];
      const definition = ScorecardsService.validOrThrow(
        body.definition ?? latest?.definition,
      );
      const v = await this.newVersion(
        tx,
        tenantId,
        s.id,
        (latest?.version ?? 0) + 1,
        definition,
        { changeSummary: body.changeSummary ?? '', makerId: actor.id },
      );
      await this.audit.write(
        {
          actor,
          action: 'scorecard.manage',
          resourceType: 'ScorecardVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: { code: s.code, version: v.version },
        },
        tx,
      );
      return v;
    });
  }

  /** Change a DRAFT; only its maker may (they remain its maker). */
  async updateDraft(
    actor: LendingActor,
    versionId: string,
    body: { definition: unknown; changeSummary?: string },
  ) {
    const tenantId = requireTenant(actor);
    const definition = ScorecardsService.validOrThrow(body.definition);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const v = await tx.scorecardVersion.findFirst({
        where: { id: versionId, tenantId },
      });
      if (!v) throw new NotFoundException('Scorecard version not found');
      await this.policy.enforce(
        actor,
        'scorecard.manage',
        this.resource(tenantId, v.id, [], v.status),
        tx,
      );
      if (v.status !== 'DRAFT')
        throw new ConflictException(
          `This version is ${v.status.toLowerCase()} and can no longer be changed; add a new version.`,
        );
      if (v.makerId !== actor.id)
        throw new ForbiddenException(
          'Only the maker of a draft may change it; add your own version instead.',
        );
      const res = await tx.scorecardVersion.updateMany({
        where: { id: v.id, tenantId, status: 'DRAFT', updatedAt: v.updatedAt },
        data: {
          definition: definition as unknown as Json,
          definitionHash: ScorecardsService.hash(definition),
          ...(body.changeSummary !== undefined
            ? { changeSummary: body.changeSummary.slice(0, 500) }
            : {}),
        },
      });
      if (res.count !== 1) throw concurrentModification('This draft');
      await this.audit.write(
        {
          actor,
          action: 'scorecard.manage',
          resourceType: 'ScorecardVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: { edit: true },
        },
        tx,
      );
      return tx.scorecardVersion.findFirst({ where: { id: v.id, tenantId } });
    });
  }

  async transition(
    actor: LendingActor,
    versionId: string,
    action: ScorecardTransition,
    reason?: string,
  ) {
    const tenantId = requireTenant(actor);
    const t = TRANSITIONS[action];
    return this.lp.tenantTx(tenantId, async (tx) => {
      const v = await tx.scorecardVersion.findFirst({
        where: { id: versionId, tenantId },
        include: { scorecard: true },
      });
      if (!v) throw new NotFoundException('Scorecard version not found');
      await this.policy.enforce(
        actor,
        t.action,
        this.resource(
          tenantId,
          v.id,
          action === 'submit' ? [] : [v.makerId],
          v.status,
        ),
        tx,
      );
      if (action === 'submit' && v.makerId !== actor.id)
        throw new ForbiddenException('Only the maker submits a draft.');
      if (!(t.from as readonly string[]).includes(v.status))
        throw new ConflictException(
          `A ${v.status} version cannot be ${t.to.toLowerCase()}.`,
        );
      const now = new Date();
      const data: Prisma.ScorecardVersionUpdateManyMutationInput = {
        status: t.to,
      };
      if (action === 'submit') data.submittedAt = now;
      if (action === 'approve') {
        data.checkerId = actor.id;
        data.approvedAt = now;
      }
      if (action === 'reject') {
        if (!reason?.trim())
          throw new BadRequestException('A rejection reason is required.');
        data.checkerId = actor.id;
        data.rejectionReason = reason.trim().slice(0, 500);
      }
      if (action === 'activate') {
        // The version must still validate under today's rules.
        ScorecardsService.validOrThrow(v.definition);
        data.activatedBy = actor.id;
        data.activatedAt = now;
        await tx.scorecardVersion.updateMany({
          where: { tenantId, scorecardId: v.scorecardId, status: 'ACTIVE' },
          data: { status: 'RETIRED', retiredAt: now },
        });
      }
      if (action === 'retire') data.retiredAt = now;
      const res = await tx.scorecardVersion.updateMany({
        where: { id: v.id, tenantId, status: v.status },
        data,
      });
      if (res.count !== 1)
        throw concurrentModification('This scorecard version');
      await this.audit.write(
        {
          actor,
          action: `scorecard.${action}`,
          resourceType: 'ScorecardVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: {
            code: v.scorecard.code,
            version: v.version,
            from: v.status,
            to: t.to,
            reason,
          },
        },
        tx,
      );
      return tx.scorecardVersion.findFirst({ where: { id: v.id, tenantId } });
    });
  }

  // ── Test score ────────────────────────────────────────────────────────────

  /**
   * Score a set of inputs on a draft definition, a stored version or a
   * template, with nothing stored — for trying a scorecard before approval.
   */
  async test(
    actor: LendingActor,
    body: {
      definition?: unknown;
      versionId?: string;
      templateCode?: string;
      inputs: Record<string, string | number | boolean | null>;
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'scorecard.read', this.resource(tenantId));
    let raw: unknown = body.definition;
    if (raw === undefined && body.versionId) {
      const v = await this.lp.tenantTx(tenantId, (tx) =>
        tx.scorecardVersion.findFirst({
          where: { id: body.versionId, tenantId },
          select: { definition: true },
        }),
      );
      if (!v) throw new NotFoundException('Scorecard version not found');
      raw = v.definition;
    }
    if (raw === undefined && body.templateCode)
      raw = lending.SCORECARD_TEMPLATE_BY_CODE[body.templateCode]?.definition;
    if (raw === undefined)
      throw new BadRequestException(
        'Give a definition, a versionId or a templateCode to test.',
      );
    const definition = ScorecardsService.validOrThrow(raw);
    for (const k of Object.keys(body.inputs))
      if (!lending.SCORING_VARIABLE_BY_CODE[k])
        throw new BadRequestException(`Unknown input variable ${k}.`);
    try {
      return lending.evaluateScorecard(definition, body.inputs);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private newVersion(
    tx: Tx,
    tenantId: string,
    scorecardId: string,
    version: number,
    definition: lending.ScorecardDefinition,
    meta: { changeSummary: string; makerId: string },
  ) {
    return tx.scorecardVersion.create({
      data: {
        tenantId,
        scorecardId,
        version,
        definition: definition as unknown as Json,
        definitionHash: ScorecardsService.hash(definition),
        changeSummary: meta.changeSummary.slice(0, 500),
        makerId: meta.makerId,
      },
    });
  }
}
