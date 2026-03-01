import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.strategy';
export declare class AuditLogsController {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(user: JwtPayload): Promise<({
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
    })[]>;
}
