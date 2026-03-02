import { PrismaService } from '../prisma/prisma.service';
export declare class AuditService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    logAction(tenantId: string, userId: string, action: string, entity: string, entityId: string, metadata?: any): Promise<void>;
}
