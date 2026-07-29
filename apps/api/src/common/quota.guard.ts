import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { PlanTierService, QuotaCeilings } from '../plan-tiers/plan-tier.service';
import { JwtPayload } from '../auth/jwt.strategy';

export type QuotaResource = 'users' | 'borrowers' | 'loanProducts' | 'loans';

export const CheckQuota = (resource: QuotaResource) => SetMetadata('quotaResource', resource);

/** Which ceiling on the tier governs which resource. */
const CEILING_FIELD: Record<QuotaResource, keyof QuotaCeilings> = {
    users: 'maxUsers',
    borrowers: 'maxBorrowers',
    loanProducts: 'maxLoanProducts',
    loans: 'maxLoans',
};

@Injectable()
export class QuotaGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private prisma: PrismaService,
        private planTiers: PlanTierService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const resource = this.reflector.get<QuotaResource>('quotaResource', context.getHandler());
        if (!resource) return true;

        const req = context.switchToHttp().getRequest();
        const user = req.user as JwtPayload;
        if (!user || user.role === 'SUPERADMIN') return true;
        if (!user.tenantId) {
            throw new ForbiddenException('Tenant scope is required for quota checks.');
        }

        // Ceilings come from the tier the platform owner configured, keyed by
        // the plan name JwtStrategy already resolved during token validation.
        const ceilings = await this.planTiers.ceilingsFor(user.tenantPlan);
        const limit = ceilings[CEILING_FIELD[resource]];

        // null means unlimited. Returning here also skips the COUNT below —
        // on an ENTERPRISE tenant with a large book that query is not cheap,
        // and its result could never change the outcome.
        if (limit === null) return true;

        let currentCount = 0;
        switch (resource) {
            case 'users':
                currentCount = await this.prisma.user.count({ where: { tenantId: user.tenantId } });
                break;
            case 'borrowers':
                currentCount = await this.prisma.borrower.count({ where: { tenantId: user.tenantId } });
                break;
            case 'loanProducts':
                currentCount = await this.prisma.loanProduct.count({ where: { tenantId: user.tenantId } });
                break;
            case 'loans':
                currentCount = await this.prisma.loan.count({ where: { tenantId: user.tenantId } });
                break;
        }

        if (currentCount >= limit) {
            throw new ForbiddenException(
                `Your organization has reached the maximum allowed limit of ${limit} ${resource} for the ${user.tenantPlan || 'current'} plan. Please upgrade to continue.`
            );
        }

        return true;
    }
}
