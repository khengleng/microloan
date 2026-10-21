import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanQuotaService, QuotaResource } from '../plan-tiers/plan-quota.service';
import { JwtPayload } from '../auth/jwt.strategy';

export type { QuotaResource } from '../plan-tiers/plan-quota.service';

export const CheckQuota = (resource: QuotaResource) => SetMetadata('quotaResource', resource);

/**
 * Refuses a create route once the tenant's plan ceiling for the resource is
 * reached. The counting and the refusal (code PLAN_LIMIT_REACHED, with the
 * numbers) live in PlanQuotaService, which the lending platform calls where
 * it books loans and creates products (D-167).
 */
@Injectable()
export class QuotaGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private quotas: PlanQuotaService,
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
        await this.quotas.assertRoom(user.tenantId, resource);
        return true;
    }
}
