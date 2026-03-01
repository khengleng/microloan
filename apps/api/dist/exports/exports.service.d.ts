import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
export declare class ExportsService {
    private prisma;
    private audit;
    constructor(prisma: PrismaService, audit: AuditService);
    exportLoansToExcel(tenantId: string, actorId: string): Promise<Buffer>;
    exportRepaymentsToExcel(tenantId: string, actorId: string): Promise<Buffer>;
}
