import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { scrubSensitiveKeys } from '../common/mask';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) { }

  async logAction(
    tenantId: string,
    userId: string,
    action: string,
    entity: string,
    entityId: string,
    metadata?: any,
  ) {
    try {
      // ── Safety net: scrub all sensitive keys before persisting ──────────────
      // This ensures passwords, tokens, secrets can NEVER reach the audit store
      // even if a caller accidentally passes raw data.
      const safeMetadata = metadata
        ? scrubSensitiveKeys(
          JSON.parse(
            JSON.stringify(metadata, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
          ),
        )
        : null;

      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          action,
          entity,
          entityId,
          metadata: safeMetadata,
        },
      });
    } catch (err) {
      console.error('[AuditService] Failed to log audit action', err);
      // Never fail the main transaction due to an audit error
    }
  }
}
