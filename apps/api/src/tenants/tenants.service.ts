import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@microloan/db';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';

@Injectable()
export class TenantsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly authz: AuthzService,
    ) { }

    async findAll(actor: JwtPayload, includeArchived = false) {
        this.authz.assertPlatformOnly(actor);
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

    async findOne(actor: JwtPayload, id: string) {
        this.authz.assertPlatformOnly(actor);
        return this.prisma.tenant.findUnique({
            where: { id },
            include: {
                users: {
                    select: { id: true, email: true, role: true, createdAt: true }
                }
            }
        });
    }

    async create(actor: JwtPayload, data: { name: string; adminEmail?: string; adminPassword?: string }) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_CREATE);
        if (data.adminEmail) {
            const existing = await this.prisma.user.findUnique({
                where: { email: data.adminEmail }
            });
            if (existing) {
                throw new BadRequestException('This email is tied to an existing organization (possibly suspended or in the Trash). You must permanently PURGE that organization from the "Show Trash" view before you can reuse this email.');
            }
        }

        const tenant = await this.prisma.$transaction(async (tx) => {
            const t = await tx.tenant.create({ data: { name: data.name } });

            if (data.adminEmail && data.adminPassword) {
                const salt = await bcrypt.genSalt();
                const hash = await bcrypt.hash(data.adminPassword, salt);
                await tx.user.create({
                    data: {
                        tenantId: t.id,
                        email: data.adminEmail,
                        passwordHash: hash,
                        role: Role.TENANT_ADMIN,
                    }
                });
            }
            return t;
        });

        // Audit log must be outside transaction to avoid deadlocks/timeouts during heavy provisioning
        await this.audit.logSecurityEvent({
            actorUserId: actor.sub,
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            targetType: 'Tenant',
            targetId: tenant.id,
            action: 'TENANT_CREATE',
            newValue: { name: tenant.name },
            result: 'SUCCESS',
        });

        return tenant;
    }

    async update(actor: JwtPayload, id: string, data: { name?: string; plan?: string; status?: string; penaltyRatePerDay?: number }) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_UPDATE);
        const before = await this.prisma.tenant.findUnique({ where: { id } });
        const tenant = await this.prisma.tenant.update({ where: { id }, data });
        await this.audit.logSecurityEvent({
            actorUserId: actor.sub,
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            targetType: 'Tenant',
            targetId: id,
            action: 'TENANT_UPDATE',
            oldValue: { name: before?.name, plan: before?.plan, status: before?.status },
            newValue: { name: data.name, plan: data.plan, status: data.status, penaltyRatePerDay: data.penaltyRatePerDay },
            result: 'SUCCESS',
        });
        return tenant;
    }

    async setStatus(actor: JwtPayload, id: string, status: 'ACTIVE' | 'SUSPENDED') {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_SUSPEND);
        const tenant = await (this.prisma.tenant.update as any)({
            where: { id },
            data: {
                status,
                ...(status === 'ACTIVE' ? { deletedAt: null } : {})
            },
        });
        await this.audit.logSecurityEvent({
            actorUserId: actor.sub,
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            targetType: 'Tenant',
            targetId: id,
            action: status === 'SUSPENDED' ? 'TENANT_SUSPEND' : 'TENANT_ACTIVATE',
            newValue: { status },
            result: 'SUCCESS',
        });
        return tenant;
    }

    /**
     * Fix 9 – Phase 1: GDPR soft-delete / erasure request.
     * Suspends the tenant and marks deletedAt. A SUPERADMIN (or background job)
     * calls hardDelete() after the required retention period (e.g. 30 days).
     */
    async remove(actor: JwtPayload, id: string) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_SUSPEND);
        const tenant = await this.prisma.tenant.findUnique({ where: { id } });
        const result = await (this.prisma.tenant.update as any)({
            where: { id },
            data: { status: 'SUSPENDED', deletedAt: new Date() },
        });
        await this.audit.logSecurityEvent({
            actorUserId: actor.sub,
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            targetType: 'Tenant',
            targetId: id,
            action: 'TENANT_ERASURE_REQUEST',
            newValue: { scheduledPurgeAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
            result: 'SUCCESS',
        });
        return result;
    }

    /**
     * Fix 9 – Phase 2: GDPR hard-delete / right to erasure.
     * Anonymizes all PII for this tenant's users and borrowers, then
     * hard-deletes the tenant row (cascading to all child entities).
     * SUPERADMIN only. Irreversible.
     */
    async hardDelete(actor: JwtPayload, id: string) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_SUSPEND);
        const tenant = await (this.prisma.tenant.findUnique({ where: { id } }) as any);
        if (!tenant) throw new BadRequestException('Tenant not found');
        if (!tenant.deletedAt) {
            throw new BadRequestException(
                'Tenant must be soft-deleted first (erasure requested) before hard-delete.'
            );
        }

        // NUCLEAR CLEANUP: Bottom-Up ordered deletion to avoid all Foreign Key constraints 
        // This is necessary because some DB providers have lag in Cascade propagation
        await this.prisma.$transaction(async (tx) => {
            // 1. Logs & Social Interactions
            await tx.auditLog.deleteMany({ where: { tenantId: id } });
            await tx.loanInteraction.deleteMany({ where: { loan: { tenantId: id } } });

            // 2. Financial History
            await tx.repayment.deleteMany({ where: { tenantId: id } });
            await tx.repaymentSchedule.deleteMany({ where: { loan: { tenantId: id } } });

            // 3. Assets & Documentation
            await tx.collateral.deleteMany({ where: { loan: { tenantId: id } } });
            await tx.guarantor.deleteMany({ where: { loan: { tenantId: id } } });
            await tx.document.deleteMany({ where: { tenantId: id } });

            // 4. Core Entities
            await tx.loan.deleteMany({ where: { tenantId: id } });
            await tx.borrower.deleteMany({ where: { tenantId: id } });
            await tx.user.deleteMany({ where: { tenantId: id } });

            // 5. Product Logic
            await tx.loanPolicy.deleteMany({ where: { product: { tenantId: id } } });
            await tx.loanProduct.deleteMany({ where: { tenantId: id } });

            // 6. Organization Shell
            await tx.tenant.delete({ where: { id } });
        });

        // Best-effort post-purge audit (outside transaction)
        await this.audit.logSecurityEvent({
            actorUserId: actor.sub,
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            targetType: 'Tenant',
            targetId: id,
            action: 'TENANT_HARD_DELETE',
            oldValue: { name: tenant.name },
            result: 'SUCCESS',
        }).catch(() => { });

        return {
            success: true,
            message: `Tenant "${tenant.name}" and all associated data have been permanently destroyed.`,
        };
    }

    async getTenantUsers(actor: JwtPayload, tenantId: string) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.USER_UPDATE);
        return this.prisma.user.findMany({
            where: { tenantId },
            select: { id: true, email: true, role: true, twoFactorEnabled: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
        });
    }

    async platformStats(actor: JwtPayload) {
        this.authz.assertPlatformOnly(actor);
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
