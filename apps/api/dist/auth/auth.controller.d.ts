import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import type { JwtPayload } from './jwt.strategy';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(registerDto: RegisterTenantDto): Promise<{
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
    refresh(refreshDto: RefreshDto): Promise<{
        access_token: string;
        refresh_token: string;
    }>;
    getProfile(user: JwtPayload): JwtPayload;
    verifyMfa(dto: {
        userId: string;
        code: string;
    }): Promise<{
        access_token: string;
        refresh_token: string;
    }>;
    generateMfaSecret(user: JwtPayload): Promise<{
        secret: string;
        qrCodeDataUrl: string;
    }>;
    enableMfa(user: JwtPayload, dto: {
        code: string;
    }): Promise<{
        success: boolean;
    }>;
    promoteSuperadmin(body: {
        email: string;
        secret: string;
    }): Promise<{
        success: boolean;
        message: string;
        user: {
            id: string;
            tenantId: string;
            email: string;
            role: import("@prisma/client").$Enums.Role;
        };
    }>;
    listSuperadmins(body: {
        secret: string;
    }): Promise<{
        superadmins: {
            tenant: {
                name: string;
            };
            id: string;
            createdAt: Date;
            email: string;
            role: import("@prisma/client").$Enums.Role;
        }[];
        count: number;
    }>;
}
