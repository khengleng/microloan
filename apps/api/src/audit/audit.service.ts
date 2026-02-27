import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          action,
          entity,
          entityId,
          metadata: metadata ? JSON.parse(JSON.stringify(metadata, (_, v) => typeof v === 'bigint' ? v.toString() : v)) : null,
        },
      });
    } catch (err) {
      console.error('Failed to log audit action', err);
      // We don't want to fail the main transaction just because auditing failed
    }
  }
}
