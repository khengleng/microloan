"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogsController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const current_user_decorator_1 = require("../auth/current-user.decorator");
let AuditLogsController = class AuditLogsController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(user, page, limit, action, entity, from, to, search) {
        const pageNum = Math.max(1, parseInt(page || '1'));
        const pageSize = Math.min(100, parseInt(limit || '50'));
        const skip = (pageNum - 1) * pageSize;
        const where = { tenantId: user.tenantId };
        if (action)
            where.action = action;
        if (entity)
            where.entity = entity;
        if (from || to) {
            where.createdAt = {};
            if (from)
                where.createdAt.gte = new Date(from);
            if (to)
                where.createdAt.lte = new Date(to);
        }
        const [logs, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                where,
                include: { user: { select: { email: true, role: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: pageSize,
            }),
            this.prisma.auditLog.count({ where }),
        ]);
        return {
            data: logs,
            meta: {
                total,
                page: pageNum,
                pageSize,
                pages: Math.ceil(total / pageSize),
            },
        };
    }
    async exportCsv(user, res, from, to, action, entity) {
        const where = { tenantId: user.tenantId };
        if (action)
            where.action = action;
        if (entity)
            where.entity = entity;
        if (from || to) {
            where.createdAt = {};
            if (from)
                where.createdAt.gte = new Date(from);
            if (to)
                where.createdAt.lte = new Date(to);
        }
        const logs = await this.prisma.auditLog.findMany({
            where,
            include: { user: { select: { email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            take: 10000,
        });
        const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const header = ['Timestamp', 'Action', 'Entity', 'EntityId', 'User Email', 'User Role', 'Details'];
        const rows = logs.map(l => [
            escape(new Date(l.createdAt).toISOString()),
            escape(l.action),
            escape(l.entity),
            escape(l.entityId),
            escape(l.user?.email ?? l.userId),
            escape(l.user?.role ?? ''),
            escape(l.metadata ? JSON.stringify(l.metadata) : ''),
        ]);
        const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
        const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    }
    async summary(user) {
        const [totalEvents, loginEvents, failedLogins, today,] = await Promise.all([
            this.prisma.auditLog.count({ where: { tenantId: user.tenantId } }),
            this.prisma.auditLog.count({ where: { tenantId: user.tenantId, action: 'LOGIN' } }),
            this.prisma.auditLog.count({
                where: {
                    tenantId: user.tenantId,
                    action: 'LOGIN',
                    metadata: { path: ['event'], equals: 'LOGIN_FAILED' },
                }
            }),
            this.prisma.auditLog.count({
                where: {
                    tenantId: user.tenantId,
                    createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
                }
            }),
        ]);
        return { totalEvents, loginEvents, failedLogins, today };
    }
};
exports.AuditLogsController = AuditLogsController;
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'SUPERADMIN'),
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __param(3, (0, common_1.Query)('action')),
    __param(4, (0, common_1.Query)('entity')),
    __param(5, (0, common_1.Query)('from')),
    __param(6, (0, common_1.Query)('to')),
    __param(7, (0, common_1.Query)('search')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], AuditLogsController.prototype, "findAll", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'SUPERADMIN'),
    (0, common_1.Get)('export/csv'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Query)('from')),
    __param(3, (0, common_1.Query)('to')),
    __param(4, (0, common_1.Query)('action')),
    __param(5, (0, common_1.Query)('entity')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, String, String]),
    __metadata("design:returntype", Promise)
], AuditLogsController.prototype, "exportCsv", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'SUPERADMIN'),
    (0, common_1.Get)('summary'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuditLogsController.prototype, "summary", null);
exports.AuditLogsController = AuditLogsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('audit-logs'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AuditLogsController);
//# sourceMappingURL=audit.controller.js.map