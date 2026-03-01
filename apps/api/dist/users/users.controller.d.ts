import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import type { JwtPayload } from '../auth/jwt.strategy';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    findAll(user: JwtPayload): Promise<any[]>;
    create(user: JwtPayload, dto: CreateUserDto): Promise<{
        id: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
    }>;
    remove(user: JwtPayload, id: string): Promise<{
        id: string;
        tenantId: string;
        email: string;
        passwordHash: string;
        twoFactorSecret: string | null;
        twoFactorEnabled: boolean;
        isActive: boolean;
        role: import("@prisma/client").$Enums.Role;
        telegramChatId: string | null;
        loginAttempts: number;
        lockedUntil: Date | null;
        lastLoginAt: Date | null;
        lastLoginIp: string | null;
        createdAt: Date;
        updatedAt: Date;
    } | null>;
    updateRole(user: JwtPayload, id: string, body: {
        role: string;
    }): Promise<{
        id: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
    }>;
}
