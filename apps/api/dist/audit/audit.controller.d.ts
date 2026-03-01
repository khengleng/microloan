import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';
export declare class AuditLogsController {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(user: JwtPayload, page?: string, limit?: string, action?: string, entity?: string, from?: string, to?: string, search?: string): Promise<{
        data: ({
            user: {
                email: string;
                role: import("@prisma/client").$Enums.Role;
            };
        } & {
            id: string;
            tenantId: string;
            userId: string;
            action: string;
            entity: string;
            entityId: string;
            metadata: import("@prisma/client").Prisma.JsonValue | null;
            createdAt: Date;
        })[];
        meta: {
            total: number;
            page: number;
            pageSize: number;
            pages: number;
        };
    }>;
    exportCsv(user: JwtPayload, res: Response, from?: string, to?: string, action?: string, entity?: string): Promise<void>;
    summary(user: JwtPayload): Promise<{
        totalEvents: number;
        loginEvents: number;
        failedLogins: number;
        today: number;
    }>;
}
