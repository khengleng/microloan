import { PrismaService } from '../prisma/prisma.service';
import { User, Role } from '@microloan/db';
export declare class UsersService {
    private prisma;
    constructor(prisma: PrismaService);
    findOneByEmail(email: string): Promise<User | null>;
    findById(id: string): Promise<User | null>;
    findAll(tenantId: string): Promise<any[]>;
    create(tenantId: string, data: {
        email: string;
        passwordHash: string;
        role: Role;
    }): Promise<{
        id: string;
        email: string;
        role: import("@microloan/db").$Enums.Role;
    }>;
    remove(tenantId: string, id: string): Promise<{
        id: string;
        tenantId: string;
        email: string;
        passwordHash: string;
        twoFactorSecret: string | null;
        twoFactorEnabled: boolean;
        role: import("@microloan/db").$Enums.Role;
        telegramChatId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
