import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  requireTenant,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { tenantResource } from '../policy/resources';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';

type Json = Prisma.InputJsonValue;

/**
 * The tenant's classification and impairment policy (OPS-5). Finance
 * proposes; a different user (risk) approves; one policy is in force at a
 * time and approving a new one retires the old. End of day reads the policy
 * in force; with none approved, no allowance is posted (DECISIONS D-010)
 * and a month with loans outstanding cannot be closed (D-116).
 *
 * In REGULATORY mode the classes and rates applied are the lender's
 * regulatory settings — the short- or long-term NBC bands by the loan's
 * original term, the restructure probation floor and minimum class — so
 * the allowance is the regulator's provision (D-113, D-114). The policy's
 * own class list is kept as proposed, for the record.
 */
@Injectable()
export class ImpairmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly settings: TenantSettingsService,
  ) {}

  /** The policy in force, or null. */
  async active(tenantId: string): Promise<lending.ImpairmentPolicy | null> {
    const row = await this.prisma.impairmentPolicy.findFirst({
      where: { tenantId, status: 'ACTIVE' },
    });
    return row ? (row.settings as unknown as lending.ImpairmentPolicy) : null;
  }

  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'impairment.read',
      tenantResource(tenantId),
    );
    const [versions, settings] = await Promise.all([
      this.prisma.impairmentPolicy.findMany({
        where: { tenantId },
        orderBy: { version: 'desc' },
      }),
      this.settings.get(tenantId),
    ]);
    return {
      active: versions.find((v) => v.status === 'ACTIVE') ?? null,
      versions,
      // A starting point for a first proposal: the lender's short-term NBC classes in REGULATORY mode.
      template: {
        mode: 'REGULATORY',
        classes: settings.regulatory.classes,
      } satisfies lending.ImpairmentPolicy,
      /** What REGULATORY mode grades on, and what the regulatory reserve is measured against (D-114, D-115). */
      regulatoryBands: lending.regulatoryBands(settings),
    };
  }

  async propose(
    actor: LendingActor,
    body: { settings: lending.ImpairmentPolicy; reason?: string },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'impairment.manage',
      tenantResource(tenantId),
    );
    const issues = lending.validateImpairmentPolicy(body.settings);
    if (issues.length)
      throw new BadRequestException({
        message: 'The impairment policy is not valid.',
        code: 'INVALID_IMPAIRMENT_POLICY',
        issues: issues.map((message) => ({ path: 'settings', message })),
      });
    return this.lp.tenantTx(tenantId, async (tx) => {
      const last = await tx.impairmentPolicy.findFirst({
        where: { tenantId },
        orderBy: { version: 'desc' },
      });
      const row = await tx.impairmentPolicy.create({
        data: {
          tenantId,
          version: (last?.version ?? 0) + 1,
          settings: body.settings as unknown as Json,
          makerId: actor.id,
          reason: (body.reason ?? '').slice(0, 500),
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'impairment.manage',
          resourceType: 'ImpairmentPolicy',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { version: row.version, mode: body.settings.mode },
        },
        tx,
      );
      return row;
    });
  }

  async decide(
    actor: LendingActor,
    id: string,
    body: { approve: boolean; comment?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.impairmentPolicy.findFirst({
        where: { id, tenantId },
      });
      if (!row) throw new NotFoundException('Impairment policy not found');
      await this.policy.enforce(
        actor,
        'impairment.approve',
        tenantResource(tenantId, 'TENANT', tenantId, [row.makerId]),
        tx,
      );
      if (body.approve)
        await tx.impairmentPolicy.updateMany({
          where: { tenantId, status: 'ACTIVE' },
          data: { status: 'RETIRED' },
        });
      const res = await tx.impairmentPolicy.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'ACTIVE' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: new Date(),
          reason: body.comment?.slice(0, 500) ?? row.reason,
        },
      });
      if (res.count !== 1) throw concurrentModification('This policy');
      await this.audit.write(
        {
          actor,
          action: 'impairment.approve',
          resourceType: 'ImpairmentPolicy',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { approve: body.approve, version: row.version },
        },
        tx,
      );
      return tx.impairmentPolicy.findFirst({ where: { id, tenantId } });
    });
  }
}
