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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
let TenantsService = class TenantsService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async findAll() {
        const tenants = await this.prisma.tenant.findMany({
            include: {
                _count: {
                    select: {
                        users: true,
                        borrowers: true,
                        loans: true,
                        repayments: true,
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
        });
        const [loanStats, repaymentStats] = await Promise.all([
            this.prisma.loan.groupBy({
                by: ['tenantId'],
                _sum: { principal: true },
                where: { status: 'DISBURSED' }
            }),
            this.prisma.repayment.groupBy({
                by: ['tenantId'],
                _sum: { amount: true }
            })
        ]);
        return tenants.map(t => {
            const l = loanStats.find(ls => ls.tenantId === t.id);
            const r = repaymentStats.find(rs => rs.tenantId === t.id);
            return {
                ...t,
                performance: {
                    disbursed: Number(l?._sum?.principal || 0),
                    collected: Number(r?._sum?.amount || 0),
                }
            };
        });
    }
    async findOne(id) {
        return this.prisma.tenant.findUnique({
            where: { id },
            include: {
                users: {
                    select: { id: true, email: true, role: true, createdAt: true }
                }
            }
        });
    }
    async create(data, actorId) {
        const tenant = await this.prisma.tenant.create({ data });
        await this.audit.logAction(tenant.id, actorId || 'system', 'CREATE', 'Tenant', tenant.id, {
            name: tenant.name,
            event: 'TENANT_CREATED',
        });
        return tenant;
    }
    async update(id, data, actorId) {
        const before = await this.prisma.tenant.findUnique({ where: { id } });
        const tenant = await this.prisma.tenant.update({ where: { id }, data });
        await this.audit.logAction(id, actorId || 'system', 'UPDATE', 'Tenant', id, {
            before: { name: before?.name, plan: before?.status, status: before?.status },
            after: { name: data.name, plan: data.plan, status: data.status },
            event: 'TENANT_UPDATED',
        });
        return tenant;
    }
    async setStatus(id, status, actorId) {
        const tenant = await this.prisma.tenant.update({
            where: { id },
            data: { status },
        });
        await this.audit.logAction(id, actorId || 'system', 'UPDATE', 'Tenant', id, {
            name: tenant.name,
            newStatus: status,
            event: status === 'SUSPENDED' ? 'TENANT_SUSPENDED' : 'TENANT_ACTIVATED',
        });
        return tenant;
    }
    async remove(id, actorId) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id } });
        const result = await this.prisma.tenant.update({
            where: { id },
            data: { status: 'SUSPENDED' },
        });
        await this.audit.logAction(id, actorId || 'system', 'DELETE', 'Tenant', id, {
            name: tenant?.name,
            event: 'TENANT_SOFT_DELETED',
        });
        return result;
    }
    async getTenantUsers(tenantId) {
        return this.prisma.user.findMany({
            where: { tenantId },
            select: { id: true, email: true, role: true, twoFactorEnabled: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
        });
    }
    async platformStats() {
        const [totalTenants, activeTenants, suspendedTenants, totalBorrowers, totalLoans, disbursedLoans, totalRepayments,] = await Promise.all([
            this.prisma.tenant.count(),
            this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
            this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
            this.prisma.borrower.count(),
            this.prisma.loan.count(),
            this.prisma.loan.count({ where: { status: 'DISBURSED' } }),
            this.prisma.repayment.aggregate({ _sum: { amount: true } }),
        ]);
        return {
            totalTenants,
            activeTenants,
            suspendedTenants,
            totalBorrowers,
            totalLoans,
            disbursedLoans,
            totalRepaymentsCollected: totalRepayments._sum.amount || 0,
        };
    }
};
exports.TenantsService = TenantsService;
exports.TenantsService = TenantsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], TenantsService);
//# sourceMappingURL=tenants.service.js.map