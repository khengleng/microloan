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
import {
  LendingActor,
  concurrentModification,
  engineCall,
  requireTenant,
  sha256,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';

type Json = Prisma.InputJsonValue;

/** What a contract was composed from, frozen in its agreement version. */
export interface ContractPolicy {
  kind: lending.PolicyKind;
  code: string;
  version: number;
  policyVersionId: string;
  parameters: Record<string, number>;
}

const TRANSITIONS = {
  submit: { code: 'lending_policy.submit', from: 'DRAFT', to: 'SUBMITTED' },
  approve: {
    code: 'lending_policy.approve',
    from: 'SUBMITTED',
    to: 'APPROVED',
  },
  reject: { code: 'lending_policy.reject', from: 'SUBMITTED', to: 'REJECTED' },
  retire: { code: 'lending_policy.retire', from: 'APPROVED', to: 'RETIRED' },
} as const;

/**
 * The policy library (docs/servicing/POLICY_MODEL.md, DECISIONS D-003):
 * reusable, versioned pieces of loan terms — prepayment and lock-in, late
 * charges, allocation, non-accrual — that products offer as menus and
 * contracts are composed from.
 *
 * Versions go DRAFT → SUBMITTED → APPROVED → RETIRED under maker-checker;
 * an approved version is immutable (a database trigger enforces it too),
 * because running contracts reference it.
 */
@Injectable()
export class LendingPoliciesService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
  ) {}

  async list(actor: LendingActor, kind?: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'lending_policy.read',
      tenantResource(tenantId, 'PRODUCT'),
    );
    return this.lp.tenantTx(tenantId, (tx) =>
      tx.lendingPolicy.findMany({
        where: { tenantId, ...(kind ? { kind } : {}) },
        include: { versions: { orderBy: { version: 'desc' } } },
        orderBy: [{ kind: 'asc' }, { code: 'asc' }],
      }),
    );
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'lending_policy.read',
      tenantResource(tenantId, 'PRODUCT'),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const p = await tx.lendingPolicy.findFirst({
        where: { id, tenantId },
        include: { versions: { orderBy: { version: 'desc' } } },
      });
      if (!p) throw new NotFoundException('Policy not found');
      return p;
    });
  }

  /** A new policy with its first version, in DRAFT. */
  async create(
    actor: LendingActor,
    body: {
      kind: lending.PolicyKind;
      code: string;
      name: string;
      description?: string;
      parameters?: Record<string, lending.PolicyParameter>;
      body: Record<string, unknown>;
      changeSummary?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'lending_policy.create',
      tenantResource(tenantId, 'PRODUCT'),
    );
    const definition = this.validOrThrow(body.kind, body.code, 1, body);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const exists = await tx.lendingPolicy.findFirst({
        where: { tenantId, kind: body.kind, code: body.code },
      });
      if (exists)
        throw new ConflictException(
          `A ${body.kind} policy with code ${body.code} already exists; add a version to it instead.`,
        );
      const p = await tx.lendingPolicy.create({
        data: {
          tenantId,
          kind: body.kind,
          code: body.code,
          name: body.name,
          description: body.description ?? '',
          createdBy: actor.id,
        },
      });
      const v = await this.createVersion(tx, tenantId, p.id, 1, definition, {
        changeSummary: body.changeSummary ?? 'First version',
        makerId: actor.id,
      });
      await this.audit.write(
        {
          actor,
          action: 'lending_policy.create',
          resourceType: 'LendingPolicy',
          resourceId: p.id,
          outcome: 'SUCCESS',
          details: { kind: p.kind, code: p.code, version: v.id },
        },
        tx,
      );
      return { ...p, versions: [v] };
    });
  }

  /** A new DRAFT version of an existing policy; earlier versions are untouched. */
  async addVersion(
    actor: LendingActor,
    policyId: string,
    body: {
      parameters?: Record<string, lending.PolicyParameter>;
      body: Record<string, unknown>;
      changeSummary?: string;
    },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'lending_policy.create',
      tenantResource(tenantId, 'PRODUCT'),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const p = await tx.lendingPolicy.findFirst({
        where: { id: policyId, tenantId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!p) throw new NotFoundException('Policy not found');
      const next = (p.versions[0]?.version ?? 0) + 1;
      const definition = this.validOrThrow(
        p.kind as lending.PolicyKind,
        p.code,
        next,
        body,
      );
      const v = await this.createVersion(tx, tenantId, p.id, next, definition, {
        changeSummary: body.changeSummary ?? '',
        makerId: actor.id,
      });
      await this.audit.write(
        {
          actor,
          action: 'lending_policy.create',
          resourceType: 'LendingPolicyVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: { code: p.code, version: next },
        },
        tx,
      );
      return v;
    });
  }

  async transition(
    actor: LendingActor,
    versionId: string,
    action: keyof typeof TRANSITIONS,
    reason?: string,
  ) {
    const tenantId = requireTenant(actor);
    const t = TRANSITIONS[action];
    return this.lp.tenantTx(tenantId, async (tx) => {
      const v = await tx.lendingPolicyVersion.findFirst({
        where: { id: versionId, tenantId },
        include: { policy: true },
      });
      if (!v) throw new NotFoundException('Policy version not found');
      await this.policy.enforce(
        actor,
        t.code,
        tenantResource(
          tenantId,
          'PRODUCT_VERSION',
          v.id,
          [v.makerId],
          v.status,
        ),
        tx,
      );
      const data: Prisma.LendingPolicyVersionUpdateManyMutationInput = {
        status: t.to,
      };
      if (action === 'submit') data.submittedAt = new Date();
      if (action === 'approve') {
        data.checkerId = actor.id;
        data.approvedAt = new Date();
      }
      if (action === 'reject') {
        if (!reason?.trim())
          throw new BadRequestException('A rejection reason is required.');
        data.checkerId = actor.id;
        data.rejectionReason = reason.trim().slice(0, 500);
      }
      if (action === 'retire') data.retiredAt = new Date();
      const res = await tx.lendingPolicyVersion.updateMany({
        where: { id: v.id, tenantId, status: t.from },
        data,
      });
      if (res.count !== 1) throw concurrentModification('This policy version');
      await this.audit.write(
        {
          actor,
          action: t.code,
          resourceType: 'LendingPolicyVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: {
            code: v.policy.code,
            kind: v.policy.kind,
            version: v.version,
            from: t.from,
            to: t.to,
            reason,
          },
        },
        tx,
      );
      return tx.lendingPolicyVersion.findFirst({
        where: { id: v.id, tenantId },
      });
    });
  }

  /**
   * Compose a contract from the product configuration and the contract's
   * policy choices (UC-32 lock-in among them). For each kind the product
   * offers, the chosen code must be on its menu and the latest APPROVED
   * version of it is used; parameters must sit within the policy's and the
   * product's bounds. The result is validated as a whole. A product with no
   * policy menus composes to itself.
   */
  async composeForContract(
    tx: Tx,
    tenantId: string,
    product: lending.ProductConfig,
    choices: lending.NegotiatedTerms['policies'] = {},
  ): Promise<{ config: lending.ProductConfig; policies: ContractPolicy[] }> {
    const kinds = Object.keys(product.policies) as lending.PolicyKind[];
    for (const k of Object.keys(choices ?? {}))
      if (!kinds.includes(k as lending.PolicyKind))
        throw new BadRequestException(
          `This product does not offer a choice of ${k} policy.`,
        );
    if (!kinds.length) return { config: product, policies: [] };
    const resolved: lending.ResolvedPolicy[] = [];
    const policies: ContractPolicy[] = [];
    for (const kind of kinds) {
      const choice = choices?.[kind] ?? {};
      const code = engineCall(() =>
        lending.choosePolicyCode(product, kind, choice.code),
      )!;
      const v = await tx.lendingPolicyVersion.findFirst({
        where: {
          tenantId,
          status: 'APPROVED',
          policy: { tenantId, kind, code },
        },
        orderBy: { version: 'desc' },
      });
      if (!v)
        throw new BadRequestException(
          `The ${kind} policy ${code} has no approved version in the policy library.`,
        );
      const r = engineCall(() =>
        lending.resolvePolicy(
          {
            kind,
            code,
            version: v.version,
            parameters: v.parameters as unknown as Record<
              string,
              lending.PolicyParameter
            >,
            body: v.body as Record<string, unknown>,
          },
          choice.parameters ?? {},
          product.policies[kind]!.parameterBounds,
        ),
      );
      resolved.push(r);
      policies.push({
        kind,
        code,
        version: v.version,
        policyVersionId: v.id,
        parameters: r.parameters,
      });
    }
    const composed = lending.composeContractConfig(product, resolved);
    if (!composed.ok)
      throw new BadRequestException({
        message: 'The chosen policies do not combine into a valid contract.',
        code: 'POLICY_COMPOSITION_INVALID',
        issues: composed.issues,
      });
    return { config: composed.config, policies };
  }

  /** Every code on a product's policy menus must have an approved version before the product goes live. */
  async assertMenusApproved(
    tx: Tx,
    tenantId: string,
    product: lending.ProductConfig,
  ) {
    const missing: string[] = [];
    for (const [kind, choice] of Object.entries(product.policies)) {
      for (const code of choice.menu) {
        const v = await tx.lendingPolicyVersion.findFirst({
          where: {
            tenantId,
            status: 'APPROVED',
            policy: { tenantId, kind, code },
          },
          select: { id: true },
        });
        if (!v) missing.push(`${kind} ${code}`);
      }
    }
    if (missing.length)
      throw new BadRequestException({
        message: `Policies on this product's menus have no approved version: ${missing.join(', ')}.`,
        code: 'POLICY_NOT_APPROVED',
        missing,
      });
  }

  /**
   * A policy is checked by resolving it at its defaults and laying it over a
   * known-good product configuration: a body that would make any product
   * invalid is refused at the door, not at the first booking.
   */
  private validOrThrow(
    kind: lending.PolicyKind,
    code: string,
    version: number,
    input: {
      parameters?: Record<string, lending.PolicyParameter>;
      body: Record<string, unknown>;
    },
  ): lending.PolicyDefinition {
    if (!lending.POLICY_KINDS.includes(kind))
      throw new BadRequestException(`Unknown policy kind ${kind}.`);
    const definition: lending.PolicyDefinition = {
      kind,
      code,
      version,
      parameters: input.parameters ?? {},
      body: input.body ?? {},
    };
    for (const [name, p] of Object.entries(definition.parameters ?? {}))
      if (!(p.min <= p.default && p.default <= p.max))
        throw new BadRequestException(
          `Parameter ${name}: the default must lie between min and max.`,
        );
    const resolved = engineCall(() => lending.resolvePolicy(definition));
    const base = lending.TEMPLATE_BY_CODE['PERSONAL_INSTALMENT'].defaultConfig;
    const composed = lending.composeContractConfig({ ...base, policies: {} }, [
      resolved,
    ]);
    if (!composed.ok)
      throw new BadRequestException({
        message: 'The policy body is not valid.',
        code: 'POLICY_INVALID',
        issues: composed.issues,
      });
    return definition;
  }

  private async createVersion(
    tx: Tx,
    tenantId: string,
    policyId: string,
    version: number,
    d: lending.PolicyDefinition,
    meta: { changeSummary: string; makerId: string },
  ) {
    return tx.lendingPolicyVersion.create({
      data: {
        tenantId,
        policyId,
        version,
        parameters: (d.parameters ?? {}) as unknown as Json,
        body: d.body as Json,
        bodyHash: sha256(
          lending.canonicalJson({ parameters: d.parameters, body: d.body }),
        ),
        changeSummary: meta.changeSummary,
        makerId: meta.makerId,
      },
    });
  }
}
