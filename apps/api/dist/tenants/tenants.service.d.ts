import { PrismaService } from '../prisma/prisma.service';
export declare class TenantsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(): Promise<({
        _count: {
            users: number;
            borrowers: number;
            loans: number;
            repayments: number;
        };
    } & {
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
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
    }): Promise<{
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
    }): Promise<{
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<{
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    remove(id: string): Promise<{
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
