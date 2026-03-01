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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const bcrypt = __importStar(require("bcrypt"));
let UsersService = class UsersService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async findOneByEmail(email) {
        return this.prisma.user.findUnique({ where: { email } });
    }
    async findById(id) {
        return this.prisma.user.findUnique({ where: { id } });
    }
    async findAll(tenantId) {
        return this.prisma.user.findMany({
            where: { tenantId },
            select: {
                id: true,
                email: true,
                role: true,
                twoFactorEnabled: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { createdAt: 'asc' },
        });
    }
    async create(tenantId, data, actorId) {
        const existing = await this.findOneByEmail(data.email);
        if (existing) {
            throw new common_1.ConflictException('User already exists');
        }
        const salt = await bcrypt.genSalt();
        const hash = await bcrypt.hash(data.passwordHash, salt);
        const user = await this.prisma.user.create({
            data: {
                tenantId,
                email: data.email,
                passwordHash: hash,
                role: data.role,
            },
            select: { id: true, email: true, role: true },
        });
        await this.audit.logAction(tenantId, actorId || user.id, 'CREATE', 'User', user.id, {
            email: user.email,
            role: user.role,
            invitedBy: actorId,
        });
        return user;
    }
    async remove(tenantId, id, actorId) {
        const user = await this.prisma.user.findUnique({ where: { id, tenantId } });
        const result = await this.prisma.user.delete({ where: { id, tenantId } });
        await this.audit.logAction(tenantId, actorId || id, 'DELETE', 'User', id, {
            email: user?.email,
            role: user?.role,
        });
        return result;
    }
    async updateRole(tenantId, id, role, actorId) {
        const before = await this.prisma.user.findUnique({ where: { id, tenantId }, select: { email: true, role: true } });
        const user = await this.prisma.user.update({
            where: { id, tenantId },
            data: { role: role },
            select: { id: true, email: true, role: true },
        });
        await this.audit.logAction(tenantId, actorId || id, 'UPDATE', 'User', id, {
            email: user.email,
            previousRole: before?.role,
            newRole: role,
        });
        return user;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], UsersService);
//# sourceMappingURL=users.service.js.map