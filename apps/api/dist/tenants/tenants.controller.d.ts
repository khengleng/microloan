import { TenantsService } from './tenants.service';
export declare class TenantsController {
    private readonly tenantsService;
    constructor(tenantsService: TenantsService);
    findAll(): Promise<({
        _count: {
            users: number;
            borrowers: number;
            loans: number;
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
    remove(id: string): Promise<{
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
