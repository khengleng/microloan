"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const users_service_1 = require("../users/users.service");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = __importStar(require("bcrypt"));
const prisma_service_1 = require("../prisma/prisma.service");
const db_1 = require("@microloan/db");
const otplib_1 = require("otplib");
const qrcode = __importStar(require("qrcode"));
const otpauth = {
    keyuri: (email, issuer, secret) => {
        return `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}`;
    }
};
let AuthService = class AuthService {
    usersService;
    jwtService;
    prisma;
    constructor(usersService, jwtService, prisma) {
        this.usersService = usersService;
        this.jwtService = jwtService;
        this.prisma = prisma;
    }
    async registerTenant(dto) {
        const existing = await this.usersService.findOneByEmail(dto.adminEmail);
        if (existing) {
            throw new common_1.ConflictException('User with this email already exists.');
        }
        const salt = await bcrypt.genSalt();
        const passwordHash = await bcrypt.hash(dto.adminPassword, salt);
        return this.prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: { name: dto.organizationName }
            });
            const userCount = await tx.user.count();
            const role = userCount === 0 ? db_1.Role.SUPERADMIN : db_1.Role.ADMIN;
            const user = await tx.user.create({
                data: {
                    tenantId: tenant.id,
                    email: dto.adminEmail,
                    passwordHash,
                    role: role
                }
            });
            return {
                tenantId: tenant.id,
                tenantName: tenant.name,
                adminEmail: user.email,
                message: 'Organization registered successfully. You can now log in.'
            };
        });
    }
    async login(loginDto) {
        const user = await this.usersService.findOneByEmail(loginDto.email);
        if (!user)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);
        if (!isMatch)
            throw new common_1.UnauthorizedException('Invalid credentials');
        if (user.twoFactorEnabled) {
            return {
                mfaRequired: true,
                userId: user.id,
                message: 'Please provide your TOTP code'
            };
        }
        return this.generateTokens(user.id, user.email, user.role, user.tenantId);
    }
    async verifyMfa(userId, code) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.twoFactorSecret)
            throw new common_1.UnauthorizedException();
        const isValid = (0, otplib_1.verify)({
            token: code,
            secret: user.twoFactorSecret
        });
        if (!isValid)
            throw new common_1.UnauthorizedException('Invalid MFA code');
        return this.generateTokens(user.id, user.email, user.role, user.tenantId);
    }
    async generateMfaSecret(userId) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.UnauthorizedException();
        const secret = (0, otplib_1.generateSecret)();
        const otpauthUrl = otpauth.keyuri(user.email, 'Magic Money', secret);
        const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
        await this.prisma.user.update({
            where: { id: userId },
            data: { twoFactorSecret: secret }
        });
        return { secret, qrCodeDataUrl };
    }
    async enableMfa(userId, code) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.twoFactorSecret)
            throw new common_1.UnauthorizedException('MFA not initiated');
        const isValid = (0, otplib_1.verify)({
            token: code,
            secret: user.twoFactorSecret
        });
        if (!isValid)
            throw new common_1.UnauthorizedException('Invalid verification code');
        await this.prisma.user.update({
            where: { id: userId },
            data: { twoFactorEnabled: true }
        });
        return { success: true };
    }
    async refreshToken(refreshToken) {
        try {
            const payload = this.jwtService.verify(refreshToken, {
                secret: process.env.JWT_REFRESH_SECRET || 'refreshSecret',
            });
            return this.generateTokens(payload.sub, payload.email, payload.role, payload.tenantId);
        }
        catch {
            throw new common_1.UnauthorizedException('Invalid refresh token');
        }
    }
    async promoteSuperadmin(email) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user)
            throw new common_1.UnauthorizedException(`No user found with email: ${email}`);
        const updated = await this.prisma.user.update({
            where: { email },
            data: { role: db_1.Role.SUPERADMIN },
            select: { id: true, email: true, role: true, tenantId: true },
        });
        return { success: true, message: `${email} has been promoted to SUPERADMIN`, user: updated };
    }
    async listSuperadmins() {
        const admins = await this.prisma.user.findMany({
            where: { role: db_1.Role.SUPERADMIN },
            select: { id: true, email: true, role: true, createdAt: true, tenant: { select: { name: true } } },
        });
        return { superadmins: admins, count: admins.length };
    }
    async generateTokens(userId, email, role, tenantId) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        const tenantName = tenant?.name || 'Magic Money';
        const payload = { sub: userId, email, role, tenantId, tenantName };
        return {
            access_token: this.jwtService.sign(payload),
            refresh_token: this.jwtService.sign(payload, {
                secret: process.env.JWT_REFRESH_SECRET || 'refreshSecret',
                expiresIn: (process.env.JWT_REFRESH_TTL || '30d'),
            }),
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        jwt_1.JwtService,
        prisma_service_1.PrismaService])
], AuthService);
//# sourceMappingURL=auth.service.js.map