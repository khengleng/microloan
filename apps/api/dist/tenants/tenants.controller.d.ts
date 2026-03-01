import { TenantsService } from './tenants.service';
export declare class TenantsController {
    private readonly tenantsService;
    constructor(tenantsService: TenantsService);
    platformStats(): Promise<{
        totalTenants: number;
        activeTenants: number;
        suspendedTenants: number;
        totalBorrowers: number;
        totalLoans: number;
        disbursedLoans: number;
        totalRepaymentsCollected: number | import("@prisma/client/runtime/library").Decimal;
    }>;
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
    suspend(id: string): Promise<{
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    activate(id: string): Promise<{
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
    tenantUsers(id: string): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        twoFactorEnabled: boolean;
        role: import("@prisma/client").$Enums.Role;
    }[]>;
}
