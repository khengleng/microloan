import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { scrubSensitiveKeys } from '../common/mask';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private prisma: PrismaService) { }

  /**
   * `tenantId` is null for platform events (SUPERADMIN actions, logins that
   * match no account) and `userId` is null when no user is known. Writing
   * placeholder ids instead violated the foreign keys, and the swallowed
   * error meant those security events were never stored.
   */
  async logAction(
    tenantId: string | null,
    userId: string | null,
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
    /**
     * The tenant whose records the action touched, when it differs from the
     * actor's: a platform super-administrator resetting a tenant user's
     * password. The entry is then stored in that tenant's audit log, flagged
     * `platformOperator`, so the tenant sees what the platform did (D-130).
     */
    subjectTenantId?: string | null;
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
    const recordTenantId = event.subjectTenantId || event.actorTenantId || null;
    const platformOperator =
      !event.actorTenantId && !!event.subjectTenantId && event.actorRole === 'SUPERADMIN';
    return this.logAction(
      recordTenantId,
      event.actorUserId || null,
      event.action,
      event.targetType,
      event.targetId,
      {
        actorRole: event.actorRole,
        actorTenantId: event.actorTenantId,
        ...(platformOperator ? { platformOperator: true } : {}),
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
