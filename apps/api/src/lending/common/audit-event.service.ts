import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { scrubSensitiveKeys } from '../../common/mask';
import type { Tx } from './lending-prisma';
import type { LendingActor } from './util';

export interface AuditInput {
  actor: Pick<LendingActor, 'id' | 'type' | 'tenantId'>;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: 'ALLOW' | 'DENY' | 'SUCCESS' | 'FAILURE';
  decision?: unknown;
  details?: unknown;
  configVersions?: unknown;
  businessDate?: Date | null;
}

const json = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined
    ? undefined
    : (scrubSensitiveKeys(
        JSON.parse(JSON.stringify(v)),
      ) as Prisma.InputJsonValue);

/**
 * Writes the immutable lending audit trail. Inside a business transaction the
 * audit row commits or rolls back with the change it describes; denials are
 * written on their own so they survive the failed request.
 * Details are scrubbed of secrets and must never carry raw PII.
 */
@Injectable()
export class AuditEventService {
  private readonly logger = new Logger(AuditEventService.name);
  constructor(private readonly prisma: PrismaService) {}

  async write(input: AuditInput, tx?: Tx): Promise<void> {
    const data = {
      tenantId: input.actor.tenantId,
      actorId: input.actor.id,
      actorType: input.actor.type,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome,
      decision: json(input.decision),
      details: json(input.details),
      configVersions: json(input.configVersions),
      businessDate: input.businessDate ?? null,
    };
    if (tx) {
      await tx.auditEvent.create({ data });
      return;
    }
    try {
      await this.prisma.auditEvent.create({ data });
    } catch (err) {
      this.logger.error(
        `[AUDIT WRITE FAILURE] ${input.action} ${input.resourceType}/${input.resourceId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
