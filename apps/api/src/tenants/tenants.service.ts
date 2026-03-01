import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TenantsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) { }

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

        // Fast grouped aggregation for financial performance
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

    async findOne(id: string) {
        return this.prisma.tenant.findUnique({
            where: { id },
            include: {
                users: {
                    select: { id: true, email: true, role: true, createdAt: true }
                }
            }
        });
    }

    async create(data: { name: string }, actorId?: string) {
        const tenant = await this.prisma.tenant.create({ data });
        await this.audit.logAction(tenant.id, actorId || 'system', 'CREATE', 'Tenant', tenant.id, {
            name: tenant.name,
            event: 'TENANT_CREATED',
        });
        return tenant;
    }

    async update(id: string, data: { name?: string; plan?: string; status?: string }, actorId?: string) {
        const before = await this.prisma.tenant.findUnique({ where: { id } });
        const tenant = await this.prisma.tenant.update({ where: { id }, data });
        await this.audit.logAction(id, actorId || 'system', 'UPDATE', 'Tenant', id, {
            before: { name: before?.name, plan: before?.status, status: before?.status },
            after: { name: data.name, plan: data.plan, status: data.status },
            event: 'TENANT_UPDATED',
        });
        return tenant;
    }

    async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', actorId?: string) {
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

    async remove(id: string, actorId?: string) {
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

    async getTenantUsers(tenantId: string) {
        return this.prisma.user.findMany({
            where: { tenantId },
            select: { id: true, email: true, role: true, twoFactorEnabled: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
        });
    }

    async platformStats() {
        const [
            totalTenants,
            activeTenants,
            suspendedTenants,
            totalBorrowers,
            totalLoans,
            disbursedLoans,
            totalRepayments,
        ] = await Promise.all([
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
}
