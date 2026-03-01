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
let TenantsService = class TenantsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll() {
        return this.prisma.tenant.findMany({
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
    async create(data) {
        return this.prisma.tenant.create({ data });
    }
    async update(id, data) {
        return this.prisma.tenant.update({ where: { id }, data });
    }
    async setStatus(id, status) {
        return this.prisma.tenant.update({
            where: { id },
            data: { status },
        });
    }
    async remove(id) {
        return this.prisma.tenant.update({
            where: { id },
            data: { status: 'SUSPENDED' },
        });
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
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TenantsService);
//# sourceMappingURL=tenants.service.js.map