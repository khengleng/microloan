import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LendingPrisma } from './common/lending-prisma';
import { AuditEventService } from './common/audit-event.service';
import { BusinessDateService } from './common/business-date.service';
import { PolicyService } from './policy/policy.service';
import { LendingActionGuard } from './policy/lending-action.guard';
import { PostingService } from './accounting/posting.service';
import { LendingOperationsService } from './accounting/operations.service';
import { AdapterRegistry } from './integrations/adapters';
import { ProductsService } from './products/products.service';
import { WorkflowsService } from './products/workflows.service';
import { LendingPoliciesService } from './products/lending-policies.service';
import { ApplicationsService } from './origination/applications.service';
import { GroupsService } from './origination/groups.service';
import { ServicingService } from './servicing/servicing.service';
import { SuspenseService } from './payments/suspense.service';
import { ImpairmentService } from './accounting/impairment.service';
import { FacilitiesService } from './facilities/facilities.service';
import { RateResetService } from './servicing/rate-reset.service';
import { EodSchedulerService } from './servicing/eod-scheduler.service';
import { LendingFacilitiesController } from './facilities/facilities.controller';
import { AccessAdminService } from './access/access-admin.service';
import { CatalogueSyncService } from './catalogue-sync.service';
import { RestructuringService } from './restructuring/restructuring.service';
import { PaymentHolidayService } from './restructuring/payment-holiday.service';
import {
  RestructuringController,
  RestructuringPortalController,
} from './restructuring/restructuring.controller';
import {
  LendingAccessController,
  LendingApplicationsController,
  LendingIntegrationsController,
  LendingSuspenseController,
  LendingLoansController,
  LendingOperationsController,
  LendingProductsController,
} from './lending.controllers';

/**
 * Configurable lending platform (modular monolith). Shares tenants, users,
 * borrowers, branches and the chart of accounts with the existing app; owns
 * products, origination, servicing, lending accounting and lending access
 * governance. The legacy /loans module is untouched and keeps working.
 */
@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [
    RestructuringController,
    RestructuringPortalController,
    LendingProductsController,
    LendingApplicationsController,
    LendingLoansController,
    LendingIntegrationsController,
    LendingSuspenseController,
    LendingAccessController,
    LendingOperationsController,
    LendingFacilitiesController,
  ],
  providers: [
    LendingPrisma,
    AuditEventService,
    BusinessDateService,
    PolicyService,
    LendingActionGuard,
    PostingService,
    LendingOperationsService,
    AdapterRegistry,
    ProductsService,
    WorkflowsService,
    LendingPoliciesService,
    ApplicationsService,
    GroupsService,
    ServicingService,
    SuspenseService,
    ImpairmentService,
    FacilitiesService,
    RateResetService,
    EodSchedulerService,
    AccessAdminService,
    CatalogueSyncService,
    RestructuringService,
    PaymentHolidayService,
  ],
  exports: [
    PolicyService,
    LendingActionGuard,
    AccessAdminService,
    CatalogueSyncService,
  ],
})
export class LendingModule {}
