import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantsService {
    constructor(private readonly prisma: PrismaService) { }

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

    async create(data: { name: string }) {
        return this.prisma.tenant.create({ data });
    }

    async update(id: string, data: { name?: string; plan?: string; status?: string }) {
        return this.prisma.tenant.update({ where: { id }, data });
    }

    async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED') {
        return this.prisma.tenant.update({
            where: { id },
            data: { status },
        });
    }

    async remove(id: string) {
        // Soft delete by suspending and marking deleted
        return this.prisma.tenant.update({
            where: { id },
            data: { status: 'SUSPENDED' },
        });
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
