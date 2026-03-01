import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { getQuotaLimits } from './plan-limits';
import { JwtPayload } from '../auth/jwt.strategy';

export type QuotaResource = 'users' | 'borrowers' | 'loanProducts' | 'loans';

export const CheckQuota = (resource: QuotaResource) => SetMetadata('quotaResource', resource);

@Injectable()
export class QuotaGuard implements CanActivate {
    constructor(private reflector: Reflector, private prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const resource = this.reflector.get<QuotaResource>('quotaResource', context.getHandler());
        if (!resource) return true;

        const req = context.switchToHttp().getRequest();
        const user = req.user as JwtPayload;
        if (!user || user.role === 'SUPERADMIN') return true;

        // Use the tenant plan we fetched automatically during JwtStrategy validation
        const limits = getQuotaLimits(user.tenantPlan);
        let currentCount = 0;
        let limit = 0;

        switch (resource) {
            case 'users':
                currentCount = await this.prisma.user.count({ where: { tenantId: user.tenantId } });
                limit = limits.maxUsers;
                break;
            case 'borrowers':
                currentCount = await this.prisma.borrower.count({ where: { tenantId: user.tenantId } });
                limit = limits.maxBorrowers;
                break;
            case 'loanProducts':
                currentCount = await this.prisma.loanProduct.count({ where: { tenantId: user.tenantId } });
                limit = limits.maxLoanProducts;
                break;
            case 'loans':
                currentCount = await this.prisma.loan.count({ where: { tenantId: user.tenantId } });
                limit = limits.maxLoans;
                break;
        }

        if (currentCount >= limit) {
            throw new ForbiddenException(
                `Your organization has reached the maximum allowed limit of ${limit} ${resource} for the ${user.tenantPlan || 'FREE'} plan. Please upgrade to continue.`
            );
        }

        return true;
    }
}
