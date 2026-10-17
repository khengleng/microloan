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
import { ReportingService } from './reporting/reporting.service';
import { PeriodCloseService } from './accounting/period-close.service';
import { RegulatoryReturnService } from './reporting/regulatory-return.service';
import { LoanMigrationService } from './migration/loan-migration.service';
import { WebhooksService } from './integrations/webhooks.service';
import { CollectionsService } from './collections/collections.service';
import { CovenantsService } from './covenants/covenants.service';
import { SuspenseService } from './payments/suspense.service';
import { CollateralService } from './collateral/collateral.service';
import { PaymentChannelsService } from './payments/payment-channels.service';
import { ChannelFilesService } from './payments/channel-files.service';
import {
  ChannelIntegrationsController,
  LoanPaymentChannelsController,
  PaymentChannelsController,
} from './payments/payment-channels.controller';
import { ImpairmentService } from './accounting/impairment.service';
import { FacilitiesService } from './facilities/facilities.service';
import { RateResetService } from './servicing/rate-reset.service';
import { EodSchedulerService } from './servicing/eod-scheduler.service';
import { LendingMetricsCollector } from './monitoring/lending-metrics.collector';
import { LendingFacilitiesController } from './facilities/facilities.controller';
import { InvoiceFinanceService } from './trade/invoice-finance.service';
import { LettersOfCreditService } from './trade/letters-of-credit.service';
import {
  InvoiceFinanceController,
  LettersOfCreditController,
} from './trade/trade.controller';
import { SyndicationService } from './syndication/syndication.service';
import { SyndicationController } from './syndication/syndication.controller';
import { CardsService } from './cards/cards.service';
import { LendingCardsController } from './cards/cards.controller';
import { BnplLeaseService } from './bnpl/bnpl-lease.service';
import { LendingBnplLeaseController } from './bnpl/bnpl-lease.controller';
import { AccessAdminService } from './access/access-admin.service';
import { CatalogueSyncService } from './catalogue-sync.service';
import { RestructuringService } from './restructuring/restructuring.service';
import { PaymentHolidayService } from './restructuring/payment-holiday.service';
import { RecoveryService } from './recovery/recovery.service';
import {
  RecoveryController,
  RecoveryDeskController,
} from './recovery/recovery.controller';
import {
  RestructuringController,
  RestructuringPortalController,
} from './restructuring/restructuring.controller';
import { DocumentStorageService } from './documents/document-storage';
import { CustomerDocumentsService } from './documents/customer-documents.service';
import { GeneratedDocumentsService } from './documents/generated-documents.service';
import { DocumentExpiryScheduler } from './documents/document-expiry.scheduler';
import {
  DocumentLinksController,
  LendingDocumentsController,
} from './documents/documents.controller';
import {
  LendingAccessController,
  LendingApplicationsController,
  LendingIntegrationsController,
  LendingSuspenseController,
  LendingCollectionsController,
  LendingMigrationController,
  LendingWebhooksController,
  LendingLoansController,
  LendingOperationsController,
  LendingProductsController,
  LendingRegulatoryController,
} from './lending.controllers';
import {
  WorkspaceMeController,
  WorkspacePortalController,
  WorkspaceSearchController,
} from './workspace/workspace.controller';
import { WorkspaceAccessService } from './workspace/workspace-access.service';
import { WorkspaceWorkService } from './workspace/workspace-work.service';
import { WorkspaceSearchService } from './workspace/workspace-search.service';

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
    LendingCollectionsController,
    LendingMigrationController,
    LendingWebhooksController,
    LendingAccessController,
    LendingOperationsController,
    LendingRegulatoryController,
    LendingFacilitiesController,
    LendingCardsController,
    LendingBnplLeaseController,
    RecoveryController,
    RecoveryDeskController,
    PaymentChannelsController,
    LoanPaymentChannelsController,
    ChannelIntegrationsController,
    LendingDocumentsController,
    DocumentLinksController,
    InvoiceFinanceController,
    LettersOfCreditController,
    SyndicationController,
    WorkspaceMeController,
    WorkspaceSearchController,
    WorkspacePortalController,
  ],
  providers: [
    ReportingService,
    PeriodCloseService,
    RegulatoryReturnService,
    LoanMigrationService,
    WebhooksService,
    CollectionsService,
    CovenantsService,
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
    CollateralService,
    PaymentChannelsService,
    ChannelFilesService,
    ImpairmentService,
    FacilitiesService,
    CardsService,
    BnplLeaseService,
    RateResetService,
    EodSchedulerService,
    LendingMetricsCollector,
    AccessAdminService,
    CatalogueSyncService,
    RestructuringService,
    PaymentHolidayService,
    RecoveryService,
    DocumentStorageService,
    CustomerDocumentsService,
    GeneratedDocumentsService,
    DocumentExpiryScheduler,
    InvoiceFinanceService,
    LettersOfCreditService,
    SyndicationService,
    WorkspaceAccessService,
    WorkspaceWorkService,
    WorkspaceSearchService,
  ],
  exports: [
    CustomerDocumentsService,
    PolicyService,
    LendingActionGuard,
    AccessAdminService,
    CatalogueSyncService,
  ],
})
export class LendingModule {}
