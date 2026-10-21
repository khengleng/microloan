import { Global, Module } from '@nestjs/common';
import { PlanTierService } from './plan-tier.service';
import { PlanQuotaService } from './plan-quota.service';
import { PlanTierController } from './plan-tier.controller';

/**
 * Global, like PrismaModule, and for the same reason: `QuotaGuard` is applied
 * with `@UseGuards()` in controllers across many feature modules, so Nest
 * instantiates it in each of those injector scopes. Exporting from a normal
 * module would mean adding an import to every one of them and breaking the
 * next module that adds a quota-checked route.
 */
@Global()
@Module({
  providers: [PlanTierService, PlanQuotaService],
  controllers: [PlanTierController],
  exports: [PlanTierService, PlanQuotaService],
})
export class PlanTiersModule {}
