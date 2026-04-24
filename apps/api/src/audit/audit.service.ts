import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { scrubSensitiveKeys } from '../common/mask';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
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
      // Emit a structured error — never silently drop security events
      this.logger.error(
        `[AUDIT WRITE FAILURE] action=${action} entity=${entity} entityId=${entityId}`,
        err instanceof Error ? err.stack : String(err),
      );
      // Never fail the main transaction due to an audit error
    }
  }

  async logSecurityEvent(event: {
    actorUserId: string | null;
    actorRole: string | null;
    actorTenantId: string | null;
    targetType: string;
    targetId: string;
    action: string;
    oldValue?: any;
    newValue?: any;
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
    result: 'SUCCESS' | 'FAILURE';
    timestamp?: string;
  }) {
    const tenantId = event.actorTenantId || 'system';
    return this.logAction(
      tenantId,
      event.actorUserId || 'anonymous',
      event.action,
      event.targetType,
      event.targetId,
      {
        actorRole: event.actorRole,
        actorTenantId: event.actorTenantId,
        oldValue: event.oldValue,
        newValue: event.newValue,
        reason: event.reason,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        result: event.result,
        timestamp: event.timestamp || new Date().toISOString(),
      },
    );
  }
}
