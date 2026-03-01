import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
export declare class TenantsService {
    private readonly prisma;
    private readonly audit;
    constructor(prisma: PrismaService, audit: AuditService);
    findAll(): Promise<{
        performance: {
            disbursed: number;
            collected: number;
        };
        _count: {
            users: number;
            borrowers: number;
            loans: number;
            repayments: number;
        };
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    findOne(id: string): Promise<({
        users: {
            id: string;
            createdAt: Date;
            email: string;
            role: import("@prisma/client").$Enums.Role;
        }[];
    } & {
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }) | null>;
    create(data: {
        name: string;
    }, actorId?: string): Promise<{
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    update(id: string, data: {
        name?: string;
        plan?: string;
        status?: string;
    }, actorId?: string): Promise<{
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', actorId?: string): Promise<{
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    remove(id: string, actorId?: string): Promise<{
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    getTenantUsers(tenantId: string): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        twoFactorEnabled: boolean;
        role: import("@prisma/client").$Enums.Role;
    }[]>;
    platformStats(): Promise<{
        totalTenants: number;
        activeTenants: number;
        suspendedTenants: number;
        totalBorrowers: number;
        totalLoans: number;
        disbursedLoans: number;
        totalRepaymentsCollected: number | import("@prisma/client/runtime/library").Decimal;
    }>;
}
