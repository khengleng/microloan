import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@microloan/db';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import { operationalConfig } from '../config/operational-config';
import { PlanTierService } from '../plan-tiers/plan-tier.service';
import { TenantPurgeService } from './tenant-purge.service';

@Injectable()
export class TenantsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly authz: AuthzService,
        private readonly planTiers: PlanTierService,
        private readonly purges: TenantPurgeService,
    ) { }

    /**
     * An organisation waiting for its plan payment is activated only by
     * confirming that payment (Plan payments), never by Reactivate or an edit:
     * otherwise it would get paid quota without paying.
     */
    private assertActivatable(current: { status: string } | null, next?: string) {
        if (next !== 'ACTIVE' || !current) return;
        if (current.status === 'PENDING_PAYMENT') {
            throw new BadRequestException(
                'This organisation is waiting for its plan payment. Confirm the payment under Plan payments to activate it.',
            );
        }
    }

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

    async create(actor: JwtPayload, data: { name: string; plan?: string; adminEmail?: string; adminPassword?: string }) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_CREATE);
        // The plan chosen on Register New Org must be a tier on offer; without
        // one the organisation gets the catalogue's default tier.
        const tier = data.plan
            ? await this.planTiers.requireSelectable(data.plan)
            : await this.planTiers.defaultTier();
        if (data.adminEmail) {
            const existing = await this.prisma.user.findUnique({
                where: { email: data.adminEmail }
            });
            if (existing) {
                throw new BadRequestException('This email is tied to an existing organization (possibly suspended or in the Trash). You must permanently PURGE that organization from the "Show Trash" view before you can reuse this email.');
            }
        }

        const tenant = await this.prisma.$transaction(async (tx) => {
            const t = await tx.tenant.create({ data: { name: data.name, ...(tier ? { plan: tier.name } : {}) } });

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
            newValue: { name: tenant.name, plan: tenant.plan },
            result: 'SUCCESS',
        });

        return tenant;
    }

    async update(actor: JwtPayload, id: string, data: { name?: string; plan?: string; status?: string; penaltyRatePerDay?: number }) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_UPDATE);
        const before = await this.prisma.tenant.findUnique({ where: { id } });
        if (data.status !== undefined && !['ACTIVE', 'SUSPENDED'].includes(data.status)) {
            throw new BadRequestException('Status may be set to ACTIVE or SUSPENDED only.');
        }
        this.assertActivatable(before, data.status);
        // A plan change must name a tier on offer; keeping the current
        // (possibly retired) tier is always allowed.
        if (data.plan !== undefined && data.plan !== before?.plan) {
            await this.planTiers.requireSelectable(data.plan);
        }
        const tenant = await this.prisma.tenant.update({ where: { id }, data });
        await this.audit.logSecurityEvent({
            actorUserId: actor.sub,
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            subjectTenantId: id,
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
        this.assertActivatable(
            await this.prisma.tenant.findUnique({ where: { id }, select: { status: true } }),
            status,
        );
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
            subjectTenantId: id,
            targetType: 'Tenant',
            targetId: id,
            action: status === 'SUSPENDED' ? 'TENANT_SUSPEND' : 'TENANT_ACTIVATE',
            newValue: { status },
            result: 'SUCCESS',
        });
        return tenant;
    }

    /**
     * Signup payments awaiting a decision.
     *
     * Platform-only, like everything else on this service. Deliberately
     * returns the applicant organization and plan but no user PII — a
     * SUPERADMIN confirming a bank transfer needs the reference and the
     * amount, not the admin's details.
     */
    async listPlanPayments(actor: JwtPayload, status = 'PENDING') {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_VIEW);
        return this.prisma.planPayment.findMany({
            where: { status },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                reference: true,
                plan: true,
                amount: true,
                currency: true,
                status: true,
                expiresAt: true,
                createdAt: true,
                tenant: { select: { id: true, name: true, status: true } },
            },
        });
    }

    /**
     * Confirm a signup payment and activate the workspace.
     *
     * This is the only place a PENDING_PAYMENT tenant becomes ACTIVE, and the
     * only place the paid plan is written to the tenant — provisioning stores
     * the requested plan on the payment and leaves the tenant on FREE, so an
     * unconfirmed workspace can never hold paid quota limits.
     */
    async confirmPlanPayment(actor: JwtPayload, paymentId: string) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_UPDATE);

        const payment = await this.prisma.planPayment.findUnique({
            where: { id: paymentId },
            include: { tenant: { select: { id: true, name: true, status: true } } },
        });
        if (!payment) throw new BadRequestException('Payment not found');
        if (payment.status !== 'PENDING') {
            throw new BadRequestException(`Payment is already ${payment.status}.`);
        }

        const [updatedPayment, tenant] = await this.prisma.$transaction([
            this.prisma.planPayment.update({
                where: { id: paymentId },
                data: {
                    status: 'CONFIRMED',
                    confirmedByUserId: this.authz.actorId(actor as any),
                    confirmedAt: new Date(),
                },
            }),
            this.prisma.tenant.update({
                where: { id: payment.tenantId },
                data: { status: 'ACTIVE', plan: payment.plan },
            }),
        ]);

        await this.audit.logSecurityEvent({
            actorUserId: actor.sub,
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            subjectTenantId: payment.tenantId,
            targetType: 'Tenant',
            targetId: payment.tenantId,
            action: 'PLAN_PAYMENT_CONFIRMED',
            newValue: {
                reference: payment.reference,
                plan: payment.plan,
                amount: payment.amount.toString(),
                currency: payment.currency,
            },
            result: 'SUCCESS',
        });

        return { payment: updatedPayment, tenant };
    }

    /** Reject a signup payment. The workspace stays inert. */
    async rejectPlanPayment(actor: JwtPayload, paymentId: string, reason: string) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_UPDATE);

        const payment = await this.prisma.planPayment.findUnique({ where: { id: paymentId } });
        if (!payment) throw new BadRequestException('Payment not found');
        if (payment.status !== 'PENDING') {
            throw new BadRequestException(`Payment is already ${payment.status}.`);
        }

        const updated = await this.prisma.planPayment.update({
            where: { id: paymentId },
            data: {
                status: 'REJECTED',
                rejectedReason: reason?.slice(0, 500) || 'No reason supplied',
                confirmedByUserId: this.authz.actorId(actor as any),
                confirmedAt: new Date(),
            },
        });

        await this.audit.logSecurityEvent({
            actorUserId: actor.sub,
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            subjectTenantId: payment.tenantId,
            targetType: 'Tenant',
            targetId: payment.tenantId,
            action: 'PLAN_PAYMENT_REJECTED',
            newValue: { reference: payment.reference, reason },
            result: 'SUCCESS',
        });

        return updated;
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
            subjectTenantId: id,
            targetType: 'Tenant',
            targetId: id,
            action: 'TENANT_ERASURE_REQUEST',
            // TENANT_ERASURE_GRACE_DAYS (default 30): the purge is refused before this date (D-131).
            newValue: { scheduledPurgeAfter: new Date(Date.now() + operationalConfig().tenantErasureGraceDays * 86_400_000).toISOString() },
            result: 'SUCCESS',
        });
        return result;
    }

    /**
     * Phase 2: the purge. Allowed only after the grace period, with an archive
     * written, nothing under legal hold or retention, and a second
     * super-administrator's approval (TenantPurgeService, D-131).
     */
    async hardDelete(actor: JwtPayload, id: string) {
        this.authz.assertPlatformOnly(actor);
        this.authz.assertPermission(actor, Permission.TENANT_SUSPEND);
        return this.purges.purge(actor, id);
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
