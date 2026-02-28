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
        role: import("@prisma/client").$Enums.Role;
        telegramChatId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
