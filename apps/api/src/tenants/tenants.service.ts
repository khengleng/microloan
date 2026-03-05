import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class TenantsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) { }

    async findAll(includeArchived = false) {
        const tenants = await this.prisma.tenant.findMany({
            where: (includeArchived ? {} : { deletedAt: null }) as any,
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

    async create(data: { name: string; adminEmail?: string; adminPassword?: string }, actorId?: string) {
        const tenant = await this.prisma.tenant.create({ data: { name: data.name } });

        if (data.adminEmail && data.adminPassword) {
            const salt = await bcrypt.genSalt();
            const hash = await bcrypt.hash(data.adminPassword, salt);
            await this.prisma.user.create({
                data: {
                    tenantId: tenant.id,
                    email: data.adminEmail,
                    passwordHash: hash,
                    role: 'ADMIN',
                }
            });
        }

        await this.audit.logAction(tenant.id, actorId || 'system', 'CREATE', 'Tenant', tenant.id, {
            name: tenant.name,
            event: 'TENANT_CREATED',
        });
        return tenant;
    }

    async update(id: string, data: { name?: string; plan?: string; status?: string; penaltyRatePerDay?: number }, actorId?: string) {
        const before = await this.prisma.tenant.findUnique({ where: { id } });
        const tenant = await this.prisma.tenant.update({ where: { id }, data });
        await this.audit.logAction(id, actorId || 'system', 'UPDATE', 'Tenant', id, {
            before: { name: before?.name, plan: before?.plan, status: before?.status },
            after: { name: data.name, plan: data.plan, status: data.status, penaltyRatePerDay: data.penaltyRatePerDay },
            event: 'TENANT_UPDATED',
        });
        return tenant;
    }

    async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', actorId?: string) {
        const tenant = await (this.prisma.tenant.update as any)({
            where: { id },
            data: {
                status,
                ...(status === 'ACTIVE' ? { deletedAt: null } : {})
            },
        });
        await this.audit.logAction(id, actorId || 'system', 'UPDATE', 'Tenant', id, {
            name: tenant.name,
            newStatus: status,
            event: status === 'SUSPENDED' ? 'TENANT_SUSPENDED' : 'TENANT_ACTIVATED',
        });
        return tenant;
    }

    /**
     * Fix 9 – Phase 1: GDPR soft-delete / erasure request.
     * Suspends the tenant and marks deletedAt. A SUPERADMIN (or background job)
     * calls hardDelete() after the required retention period (e.g. 30 days).
     */
    async remove(id: string, actorId?: string) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id } });
        const result = await (this.prisma.tenant.update as any)({
            where: { id },
            data: { status: 'SUSPENDED', deletedAt: new Date() },
        });
        await this.audit.logAction(id, actorId || 'system', 'DELETE', 'Tenant', id, {
            name: tenant?.name,
            event: 'TENANT_ERASURE_REQUESTED',
            scheduledPurgeAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        return result;
    }

    /**
     * Fix 9 – Phase 2: GDPR hard-delete / right to erasure.
     * Anonymizes all PII for this tenant's users and borrowers, then
     * hard-deletes the tenant row (cascading to all child entities).
     * SUPERADMIN only. Irreversible.
     */
    async hardDelete(id: string, actorId: string) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id } }) as any;
        if (!tenant) throw new BadRequestException('Tenant not found');
        if (!tenant.deletedAt) {
            throw new BadRequestException(
                'Tenant must be soft-deleted first (erasure requested) before hard-delete.'
            );
        }

        // NUCLEAR CLEANUP: Manually wipe tables that have dual dependencies (User + Tenant) 
        // to avoid Postgres Cascade race conditions/FK blocks.
        await this.prisma.$transaction([
            this.prisma.auditLog.deleteMany({ where: { tenantId: id } }),
            this.prisma.repayment.deleteMany({ where: { tenantId: id } }),
            this.prisma.document.deleteMany({ where: { tenantId: id } }),
            this.prisma.tenant.delete({ where: { id } }),
        ]);

        // Best-effort post-purge audit
        await this.audit.logAction('system', actorId, 'DELETE', 'Tenant', id, {
            event: 'TENANT_HARD_DELETED',
            name: tenant.name,
        }).catch(() => { });

        return {
            success: true,
            message: `Tenant "${tenant.name}" and all associated data have been permanently destroyed from the platform servers.`,
        };
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
