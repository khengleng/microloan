import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { User, Role } from '@microloan/db';
export declare class UsersService {
    private prisma;
    private audit;
    constructor(prisma: PrismaService, audit: AuditService);
    findOneByEmail(email: string): Promise<User | null>;
    findById(id: string): Promise<User | null>;
    findAll(tenantId: string): Promise<any[]>;
    create(tenantId: string, data: {
        email: string;
        passwordHash: string;
        role: Role;
    }, actorId?: string): Promise<{
        id: string;
        email: string;
        role: import("@microloan/db").$Enums.Role;
    }>;
    remove(tenantId: string, id: string, actorId?: string): Promise<{
        id: string;
        tenantId: string;
        email: string;
        passwordHash: string;
        twoFactorSecret: string | null;
        twoFactorEnabled: boolean;
        isActive: boolean;
        role: import("@microloan/db").$Enums.Role;
        telegramChatId: string | null;
        loginAttempts: number;
        lockedUntil: Date | null;
        lastLoginAt: Date | null;
        lastLoginIp: string | null;
        createdAt: Date;
        updatedAt: Date;
    } | null>;
    updateRole(tenantId: string, id: string, role: string, actorId?: string): Promise<{
        id: string;
        email: string;
        role: import("@microloan/db").$Enums.Role;
    }>;
}
