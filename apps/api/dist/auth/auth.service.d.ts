import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { PrismaService } from '../prisma/prisma.service';
export declare class AuthService {
    private usersService;
    private jwtService;
    private prisma;
    constructor(usersService: UsersService, jwtService: JwtService, prisma: PrismaService);
    registerTenant(dto: RegisterTenantDto): Promise<{
        tenantId: string;
        tenantName: string;
        adminEmail: string;
        message: string;
    }>;
    login(loginDto: LoginDto): Promise<{
        access_token: string;
        refresh_token: string;
    } | {
        mfaRequired: boolean;
        userId: string;
        message: string;
    }>;
    verifyMfa(userId: string, code: string): Promise<{
        access_token: string;
        refresh_token: string;
    }>;
    generateMfaSecret(userId: string): Promise<{
        secret: string;
        qrCodeDataUrl: string;
    }>;
    enableMfa(userId: string, code: string): Promise<{
        success: boolean;
    }>;
    refreshToken(refreshToken: string): Promise<{
        access_token: string;
        refresh_token: string;
    }>;
    promoteSuperadmin(email: string): Promise<{
        success: boolean;
        message: string;
        user: {
            id: string;
            tenantId: string;
            email: string;
            role: import("@microloan/db").$Enums.Role;
        };
    }>;
    listSuperadmins(): Promise<{
        superadmins: {
            tenant: {
                name: string;
            };
            id: string;
            createdAt: Date;
            email: string;
            role: import("@microloan/db").$Enums.Role;
        }[];
        count: number;
    }>;
    private generateTokens;
}
