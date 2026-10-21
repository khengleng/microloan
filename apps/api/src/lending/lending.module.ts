import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LendingPrisma } from './common/lending-prisma';
import { AuditEventService } from './common/audit-event.service';
import { BusinessDateService } from './common/business-date.service';
import { RateCapService } from './common/rate-cap.service';
import { PolicyService } from './policy/policy.service';
import { LendingActionGuard } from './policy/lending-action.guard';
import { PostingService } from './accounting/posting.service';
import { LendingOperationsService } from './accounting/operations.service';
import { AdapterRegistry } from './integrations/adapters';
import { ProductsService } from './products/products.service';
import { WorkflowsService } from './products/workflows.service';
import { LendingPoliciesService } from './products/lending-policies.service';
import { ApplicationsService } from './origination/applications.service';
import { KeyFactsService } from './origination/key-facts.service';
import { KeyFactsPortalController } from './origination/key-facts.controller';
import { BorrowerObligationsService } from './origination/obligations.service';
import { CoolingOffService } from './servicing/cooling-off.service';
import { GroupsService } from './origination/groups.service';
import { ServicingService } from './servicing/servicing.service';
import { ReportingService } from './reporting/reporting.service';
import { LendingOverviewService } from './reporting/overview.service';
import { LendingOverviewController } from './reporting/overview.controller';
import { LendingReportsService } from './reporting/reports.service';
import { LendingReportsController } from './reporting/reports.controller';
import { LegacyArchiveService } from './migration/legacy-archive.service';
import { LegacyArchiveController } from './migration/legacy-archive.controller';
import { PeriodCloseService } from './accounting/period-close.service';
import { RegulatoryReserveService } from './accounting/regulatory-reserve.service';
import { RegulatoryReturnService } from './reporting/regulatory-return.service';
import { LoanMigrationService } from './migration/loan-migration.service';
import { WebhooksService } from './integrations/webhooks.service';
import { CollectionsService } from './collections/collections.service';
import { PromisesService } from './collections/promises.service';
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
import { LendingSettingsService } from './accounting/lending-settings.service';
import { FacilitiesService } from './facilities/facilities.service';
import { BorrowingBaseService } from './facilities/borrowing-base.service';
import { ProjectFinanceService } from './project-finance/project-finance.service';
import { ProjectFinanceController } from './project-finance/project-finance.controller';
import { RateResetService } from './servicing/rate-reset.service';
import { EodSchedulerService } from './servicing/eod-scheduler.service';
import { LendingMetricsCollector } from './monitoring/lending-metrics.collector';
import { OperationalAlertService } from './monitoring/operational-alerts.service';
import { PlatformOperationalAlertsController } from './monitoring/operational-alerts.controller';
import { PrismaHealthIndicator } from '../health/prisma.health';
import { LendingFacilitiesController } from './facilities/facilities.controller';
import { InvoiceFinanceService } from './trade/invoice-finance.service';
import { LettersOfCreditService } from './trade/letters-of-credit.service';
import { DocumentaryTradeService } from './trade/documentary.service';
import {
  DocumentaryTradeController,
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
import { CounterpartiesService } from './institutional/counterparties.service';
import { CounterpartiesController } from './institutional/counterparties.controller';
import { IncomeContingentService } from './income-contingent/income-contingent.service';
import { IncomeContingentController } from './income-contingent/income-contingent.controller';
import { MurabahaService } from './murabaha/murabaha.service';
import { MurabahaController } from './murabaha/murabaha.controller';
import { CatalogueSyncService } from './catalogue-sync.service';
import { ScoringController } from './scoring/scoring.controller';
import {
  LearningMeController,
  LearningTeamController,
} from './learning/learning.controller';
import { LearningService } from './learning/learning.service';
import { ScorecardsService } from './scoring/scorecards.service';
import { ScoringService } from './scoring/scoring.service';
import { FeatureStoreService } from './scoring/feature-store.service';
import { AlternativeDataService } from './scoring/alternative-data.service';
import { AltDataProvidersService } from './scoring/providers';
import { ScoreMonitoringService } from './scoring/score-monitoring.service';
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
import { AmlController } from './aml/aml.controller';
import { AmlGateService } from './aml/aml-gate.service';
import { AmlRiskService } from './aml/aml-risk.service';
import { AmlScreeningService } from './aml/aml-screening.service';
import { AmlCustomersService } from './aml/aml-customers.service';
import { AmlReportsService } from './aml/aml-reports.service';
import { AmlRescreenScheduler } from './aml/aml-rescreen.scheduler';

/**
 * Configurable lending platform (modular monolith). Shares tenants, users,
 * borrowers, branches and the chart of accounts with the existing app; owns
 * products, origination, servicing, lending accounting and lending access
 * governance. The original loan module's screens and write paths are gone
 * (D-153); its loans are read in the legacy loan archive and moved here by
 * the loan-book migration.
 */
@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [
    PlatformOperationalAlertsController,
    LendingOverviewController,
    LendingReportsController,
    LegacyArchiveController,
    RestructuringController,
    RestructuringPortalController,
    KeyFactsPortalController,
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
    CounterpartiesController,
    IncomeContingentController,
    MurabahaController,
    RecoveryController,
    RecoveryDeskController,
    PaymentChannelsController,
    LoanPaymentChannelsController,
    ChannelIntegrationsController,
    LendingDocumentsController,
    DocumentLinksController,
    InvoiceFinanceController,
    LettersOfCreditController,
    DocumentaryTradeController,
    SyndicationController,
    ProjectFinanceController,
    WorkspaceMeController,
    WorkspaceSearchController,
    WorkspacePortalController,
    ScoringController,
    LearningMeController,
    LearningTeamController,
    AmlController,
  ],
  providers: [
    ReportingService,
    LendingOverviewService,
    LendingReportsService,
    LegacyArchiveService,
    PeriodCloseService,
    RegulatoryReserveService,
    RegulatoryReturnService,
    LoanMigrationService,
    WebhooksService,
    CollectionsService,
    PromisesService,
    CovenantsService,
    LendingPrisma,
    AuditEventService,
    BusinessDateService,
    RateCapService,
    PolicyService,
    LendingActionGuard,
    PostingService,
    LendingOperationsService,
    AdapterRegistry,
    ProductsService,
    WorkflowsService,
    LendingPoliciesService,
    ApplicationsService,
    KeyFactsService,
    BorrowerObligationsService,
    CoolingOffService,
    GroupsService,
    ServicingService,
    SuspenseService,
    CollateralService,
    PaymentChannelsService,
    ChannelFilesService,
    ImpairmentService,
    LendingSettingsService,
    FacilitiesService,
    BorrowingBaseService,
    ProjectFinanceService,
    CardsService,
    BnplLeaseService,
    CounterpartiesService,
    IncomeContingentService,
    MurabahaService,
    RateResetService,
    EodSchedulerService,
    LendingMetricsCollector,
    OperationalAlertService,
    PrismaHealthIndicator,
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
    DocumentaryTradeService,
    SyndicationService,
    WorkspaceAccessService,
    WorkspaceWorkService,
    WorkspaceSearchService,
    ScorecardsService,
    ScoringService,
    FeatureStoreService,
    AlternativeDataService,
    AltDataProvidersService,
    ScoreMonitoringService,
    LearningService,
    AmlGateService,
    AmlRiskService,
    AmlScreeningService,
    AmlCustomersService,
    AmlReportsService,
    AmlRescreenScheduler,
  ],
  exports: [
    AmlScreeningService,
    CustomerDocumentsService,
    PolicyService,
    LendingActionGuard,
    AccessAdminService,
    CatalogueSyncService,
  ],
})
export class LendingModule {}
