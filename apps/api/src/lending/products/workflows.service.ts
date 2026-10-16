import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  requireTenant,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';

/**
 * Workflows are assembled from supported steps only. Phase 1 executes a fixed
 * origination path (recommend → approve → book → disburse); a workflow
 * version chooses the optional checks and the approval levels (how many
 * independent approvers an amount needs).
 */
export const SUPPORTED_STEPS = [
  'DOCUMENT_CHECK',
  'KYC_CHECK',
  'CREDIT_RECOMMENDATION',
  'CREDIT_APPROVAL',
  'CONDITIONS_PRECEDENT',
  'AGREEMENT_BOOKING',
  'DISBURSEMENT_APPROVAL',
] as const;
const MANDATORY_STEPS = [
  'CREDIT_RECOMMENDATION',
  'CREDIT_APPROVAL',
  'AGREEMENT_BOOKING',
  'DISBURSEMENT_APPROVAL',
];

export const workflowDefinitionSchema = z
  .object({
    steps: z.array(z.enum(SUPPORTED_STEPS)).min(4),
    approvalLevels: z
      .array(
        z
          .object({
            currency: z.string().regex(/^([A-Z]{3}|\*)$/),
            minAmount: z.string().regex(/^\d+(\.\d+)?$/),
            approvalsRequired: z.number().int().min(1).max(3),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((d, ctx) => {
    for (const s of MANDATORY_STEPS)
      if (!d.steps.includes(s as (typeof SUPPORTED_STEPS)[number]))
        ctx.addIssue({
          code: 'custom',
          message: `step ${s} is mandatory in Phase 1`,
        });
    if (new Set(d.steps).size !== d.steps.length)
      ctx.addIssue({ code: 'custom', message: 'steps must be unique' });
    if (
      !d.approvalLevels.some(
        (l) => l.minAmount === '0' || l.minAmount === '0.0',
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'one approval level must start at 0',
      });
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const BUILT_IN_WORKFLOWS: Record<
  string,
  { name: string; definition: WorkflowDefinition }
> = {
  STANDARD_RETAIL: {
    name: 'Standard retail',
    definition: {
      steps: [
        'DOCUMENT_CHECK',
        'KYC_CHECK',
        'CREDIT_RECOMMENDATION',
        'CREDIT_APPROVAL',
        'CONDITIONS_PRECEDENT',
        'AGREEMENT_BOOKING',
        'DISBURSEMENT_APPROVAL',
      ],
      approvalLevels: [{ currency: '*', minAmount: '0', approvalsRequired: 1 }],
    },
  },
  SECURED_TWO_LEVEL: {
    name: 'Secured, two approvers above threshold',
    definition: {
      steps: [
        'DOCUMENT_CHECK',
        'KYC_CHECK',
        'CREDIT_RECOMMENDATION',
        'CREDIT_APPROVAL',
        'CONDITIONS_PRECEDENT',
        'AGREEMENT_BOOKING',
        'DISBURSEMENT_APPROVAL',
      ],
      approvalLevels: [
        { currency: '*', minAmount: '0', approvalsRequired: 1 },
        { currency: 'USD', minAmount: '100000', approvalsRequired: 2 },
        { currency: 'KHR', minAmount: '400000000', approvalsRequired: 2 },
      ],
    },
  },
};

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
  ) {}

  /** The workflow in force for a code: the tenant's ACTIVE version, else the built-in. */
  async effective(
    tenantId: string,
    code: string,
    tx?: Tx,
  ): Promise<{
    code: string;
    version: number | 'built-in';
    definition: WorkflowDefinition;
  }> {
    const db = tx ?? this.prisma;
    const active = await db.workflowVersion.findFirst({
      where: { tenantId, code, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    if (active) {
      const parsed = workflowDefinitionSchema.safeParse(active.definition);
      if (parsed.success)
        return { code, version: active.version, definition: parsed.data };
    }
    const builtIn = BUILT_IN_WORKFLOWS[code];
    if (!builtIn)
      throw new BadRequestException(`Workflow ${code} is not defined.`);
    return { code, version: 'built-in', definition: builtIn.definition };
  }

  static approvalsRequired(
    def: WorkflowDefinition,
    amount: string,
    currency: string,
  ): number {
    let required = 1;
    for (const level of def.approvalLevels) {
      if (
        (level.currency === currency ||
          (level.currency === '*' && Number(level.minAmount) === 0)) &&
        compare(amount, level.minAmount) >= 0
      ) {
        required = Math.max(required, level.approvalsRequired);
      }
    }
    return required;
  }

  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'loan_product.read',
      tenantResource(tenantId, 'WORKFLOW', 'list'),
    );
    const versions = await this.prisma.workflowVersion.findMany({
      where: { tenantId },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });
    return {
      supportedSteps: SUPPORTED_STEPS,
      mandatorySteps: MANDATORY_STEPS,
      builtIn: BUILT_IN_WORKFLOWS,
      versions,
    };
  }

  async draft(
    actor: LendingActor,
    body: { code: string; name: string; definition: unknown },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'workflow.manage',
      tenantResource(tenantId, 'WORKFLOW', body.code),
    );
    const parsed = workflowDefinitionSchema.safeParse(body.definition);
    if (!parsed.success)
      throw new BadRequestException({
        message: 'Invalid workflow definition',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    if (!/^[A-Z0-9_]{2,40}$/.test(body.code ?? ''))
      throw new BadRequestException('Workflow code must be A–Z, 0–9 or _.');
    return this.lp.tenantTx(tenantId, async (tx) => {
      const last = await tx.workflowVersion.findFirst({
        where: { tenantId, code: body.code },
        orderBy: { version: 'desc' },
      });
      const v = await tx.workflowVersion.create({
        data: {
          tenantId,
          code: body.code,
          version: (last?.version ?? 0) + 1,
          name: body.name,
          definition: parsed.data as unknown as Prisma.InputJsonValue,
          status: 'SUBMITTED',
          makerId: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'workflow.manage',
          resourceType: 'WorkflowVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: { code: body.code, version: v.version },
        },
        tx,
      );
      return v;
    });
  }

  async decide(actor: LendingActor, id: string, approve: boolean) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const v = await tx.workflowVersion.findFirst({ where: { id, tenantId } });
      if (!v) throw new NotFoundException('Workflow version not found');
      await this.policy.enforce(
        actor,
        'workflow.approve',
        tenantResource(tenantId, 'WORKFLOW', v.id, [v.makerId], v.status),
        tx,
      );
      if (approve)
        await tx.workflowVersion.updateMany({
          where: { tenantId, code: v.code, status: 'ACTIVE' },
          data: { status: 'RETIRED' },
        });
      const res = await tx.workflowVersion.updateMany({
        where: { id, tenantId, status: 'SUBMITTED' },
        data: {
          status: approve ? 'ACTIVE' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
        },
      });
      if (res.count !== 1)
        throw concurrentModification('This workflow version');
      await this.audit.write(
        {
          actor,
          action: 'workflow.approve',
          resourceType: 'WorkflowVersion',
          resourceId: v.id,
          outcome: 'SUCCESS',
          details: { approve },
        },
        tx,
      );
      return tx.workflowVersion.findFirst({ where: { id, tenantId } });
    });
  }
}

function compare(a: string, b: string): number {
  return new lending.D(a).cmp(b);
}
