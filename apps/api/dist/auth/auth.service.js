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
const audit_service_1 = require("../audit/audit.service");
const db_1 = require("@microloan/db");
const otplib_1 = require("otplib");
const qrcode = __importStar(require("qrcode"));
const rate_limiter_1 = require("../common/rate-limiter");
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000;
const GENERIC_AUTH_ERROR = 'Invalid credentials';
const otpauth = {
    keyuri: (email, issuer, secret) => {
        return `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}`;
    }
};
let AuthService = class AuthService {
    usersService;
    jwtService;
    prisma;
    audit;
    constructor(usersService, jwtService, prisma, audit) {
        this.usersService = usersService;
        this.jwtService = jwtService;
        this.prisma = prisma;
        this.audit = audit;
    }
    async registerTenant(dto, ip) {
        if (ip) {
            const rateCheck = rate_limiter_1.RateLimiter.register(ip);
            if (!rateCheck.allowed) {
                throw new common_1.ForbiddenException('Too many registration attempts. Please try again later.');
            }
        }
        const existing = await this.usersService.findOneByEmail(dto.adminEmail);
        if (existing) {
            throw new common_1.ConflictException('Registration failed. Please check your details.');
        }
        const salt = await bcrypt.genSalt(12);
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
                    role,
                }
            });
            await this.audit.logAction(tenant.id, user.id, 'CREATE', 'Tenant', tenant.id, {
                organizationName: dto.organizationName,
                role,
                event: 'TENANT_REGISTERED',
                ip: ip || 'unknown',
            });
            return {
                tenantId: tenant.id,
                tenantName: tenant.name,
                adminEmail: user.email,
                message: 'Organization registered successfully. You can now log in.',
            };
        });
    }
    async login(loginDto, ip) {
        if (ip) {
            const rateCheck = rate_limiter_1.RateLimiter.login(ip);
            if (!rateCheck.allowed) {
                await this.auditSecurityEvent(null, loginDto.email, 'LOGIN_RATE_LIMITED', ip);
                throw new common_1.ForbiddenException('Too many login attempts. Please wait 15 minutes.');
            }
        }
        const user = await this.usersService.findOneByEmail(loginDto.email);
        if (!user) {
            await this.auditSecurityEvent(null, loginDto.email, 'LOGIN_UNKNOWN_EMAIL', ip);
            await bcrypt.compare(loginDto.password, '$2b$12$dummyhashfortimingnormalisation');
            throw new common_1.UnauthorizedException(GENERIC_AUTH_ERROR);
        }
        if (user.lockedUntil && new Date() < user.lockedUntil) {
            const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
            await this.auditSecurityEvent(user.tenantId, loginDto.email, 'LOGIN_ACCOUNT_LOCKED', ip, user.id);
            throw new common_1.ForbiddenException(`Account is temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`);
        }
        const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);
        if (!isMatch) {
            const newAttempts = (user.loginAttempts || 0) + 1;
            const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    loginAttempts: newAttempts,
                    lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
                },
            });
            await this.auditSecurityEvent(user.tenantId, loginDto.email, 'LOGIN_FAILED', ip, user.id, {
                attempt: newAttempts,
                locked: shouldLock,
            });
            if (shouldLock) {
                throw new common_1.ForbiddenException(`Account locked for 30 minutes after ${MAX_FAILED_ATTEMPTS} failed attempts.`);
            }
            const remaining = MAX_FAILED_ATTEMPTS - newAttempts;
            throw new common_1.UnauthorizedException(remaining > 0
                ? `${GENERIC_AUTH_ERROR}. ${remaining} attempt(s) remaining before lockout.`
                : GENERIC_AUTH_ERROR);
        }
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                loginAttempts: 0,
                lockedUntil: null,
                lastLoginAt: new Date(),
                lastLoginIp: ip || null,
            },
        });
        if (user.twoFactorEnabled) {
            await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
                event: 'MFA_CHALLENGE_ISSUED',
                role: user.role,
                ip: ip || 'unknown',
            });
            return {
                mfaRequired: true,
                userId: user.id,
                message: 'Please provide your TOTP code',
            };
        }
        await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
            event: 'LOGIN_SUCCESS',
            role: user.role,
            ip: ip || 'unknown',
        });
        return this.generateTokens(user.id, user.email, user.role, user.tenantId);
    }
    async verifyMfa(userId, code, ip) {
        if (ip) {
            const rateCheck = rate_limiter_1.RateLimiter.mfa(ip);
            if (!rateCheck.allowed) {
                throw new common_1.ForbiddenException('Too many MFA attempts. Please wait 15 minutes.');
            }
        }
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.twoFactorSecret)
            throw new common_1.UnauthorizedException();
        const isValid = (0, otplib_1.verify)({ token: code, secret: user.twoFactorSecret });
        if (!isValid) {
            await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
                event: 'MFA_FAILED',
                ip: ip || 'unknown',
            });
            throw new common_1.UnauthorizedException('Invalid MFA code');
        }
        await this.audit.logAction(user.tenantId, user.id, 'LOGIN', 'User', user.id, {
            event: 'MFA_SUCCESS',
            role: user.role,
            ip: ip || 'unknown',
        });
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
            data: { twoFactorSecret: secret },
        });
        await this.audit.logAction(user.tenantId, user.id, 'UPDATE', 'User', user.id, {
            event: 'MFA_SETUP_INITIATED',
        });
        return { secret, qrCodeDataUrl };
    }
    async enableMfa(userId, code) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.twoFactorSecret)
            throw new common_1.UnauthorizedException('MFA not initiated');
        const isValid = (0, otplib_1.verify)({ token: code, secret: user.twoFactorSecret });
        if (!isValid)
            throw new common_1.UnauthorizedException('Invalid verification code');
        await this.prisma.user.update({
            where: { id: userId },
            data: { twoFactorEnabled: true },
        });
        await this.audit.logAction(user.tenantId, user.id, 'UPDATE', 'User', user.id, {
            event: 'MFA_ENABLED',
        });
        return { success: true };
    }
    async promoteSuperadmin(email) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user)
            throw new common_1.BadRequestException(`No user found with email: ${email}`);
        const updated = await this.prisma.user.update({
            where: { email },
            data: { role: db_1.Role.SUPERADMIN },
            select: { id: true, email: true, role: true, tenantId: true },
        });
        await this.audit.logAction(updated.tenantId, updated.id, 'UPDATE', 'User', updated.id, {
            event: 'PROMOTED_TO_SUPERADMIN',
            newRole: db_1.Role.SUPERADMIN,
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
    async refreshToken(refreshToken) {
        try {
            const payload = this.jwtService.verify(refreshToken, {
                secret: process.env.JWT_REFRESH_SECRET || 'refreshSecret',
            });
            return this.generateTokens(payload.sub, payload.email, payload.role, payload.tenantId);
        }
        catch {
            throw new common_1.UnauthorizedException('Invalid or expired refresh token');
        }
    }
    async auditSecurityEvent(tenantId, email, event, ip, userId, extra) {
        try {
            let tid = tenantId;
            if (!tid) {
                const first = await this.prisma.tenant.findFirst();
                tid = first?.id || 'system';
            }
            await this.audit.logAction(tid, userId || 'anonymous', 'LOGIN', 'User', userId || email, {
                event,
                ip: ip || 'unknown',
                timestamp: new Date().toISOString(),
                ...extra,
            });
        }
        catch { }
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
        prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], AuthService);
//# sourceMappingURL=auth.service.js.map