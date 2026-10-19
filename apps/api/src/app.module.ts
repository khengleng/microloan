import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { GlobalAuthGuard } from './auth/global-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermissionGuard } from './authz/permission.guard';
import { TenantScopeGuard } from './authz/tenant-scope.guard';
import { BranchScopeGuard } from './authz/branch-scope.guard';
import { TenantContextMiddleware } from './prisma/tenant-context.middleware';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserAwareThrottlerGuard } from './common/user-aware-throttler.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { MetricsModule } from './observability/metrics/metrics.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { BorrowersModule } from './borrowers/borrowers.module';
import { LoansModule } from './loans/loans.module';
import { RepaymentsModule } from './repayments/repayments.module';
import { AuditModule } from './audit/audit.module';
import { ReportsModule } from './reports/reports.module';
import { BotModule } from './bot/bot.module';
import { LoanProductsModule } from './loan-products/loan-products.module';
import { HealthModule } from './health/health.module';
import { BillingModule } from './billing/billing.module';
import { PlanTiersModule } from './plan-tiers/plan-tiers.module';
import { DocumentVaultModule } from './document-vault/document-vault.module';
import { PenaltyCronModule } from './penalty-cron/penalty-cron.module';
import { ExportsModule } from './exports/exports.module';
import { ReminderModule } from './reminder/reminder.module';
import { AuthzModule } from './authz/authz.module';
import { LedgerModule } from './ledger/ledger.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { CreditBureauModule } from './credit-bureau/credit-bureau.module';
import { FxModule } from './fx/fx.module';
import { CollectionsModule } from './collections/collections.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentInstrumentsModule } from './payment-instruments/payment-instruments.module';
import { BorrowerPortalModule } from './borrower-portal/borrower-portal.module';
import { AgreementsModule } from './agreements/agreements.module';
import { RiskModule } from './risk/risk.module';
import { KpiModule } from './kpi/kpi.module';
import { LendingModule } from './lending/lending.module';
import { LendingActionGuard } from './lending/policy/lending-action.guard';
import { throttlerOptions } from './common/throttler-options';
import { loadRuntimeConfig } from './config/runtime-config';
import { TenantSettingsModule } from './tenant-settings/tenant-settings.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Object form ({ throttlers, storage }) — see throttlerOptions(): the
    // array form silently drops the Redis storage.
    ThrottlerModule.forRootAsync({
      useFactory: () => throttlerOptions(loadRuntimeConfig().redisUrl),
    }),
    PrismaModule,
    TenantSettingsModule,
    MetricsModule,
    // Global, like PrismaModule: QuotaGuard is applied across feature modules
    // and resolves plan ceilings from it. Listed early so it is available to
    // everything that follows.
    PlanTiersModule,
    TenantsModule,
    UsersModule,
    AuthModule,
    BorrowersModule,
    LoansModule,
    RepaymentsModule,
    AuditModule,
    ReportsModule,
    BotModule,
    LoanProductsModule,
    HealthModule,
    BillingModule,
    DocumentVaultModule,
    PenaltyCronModule,
    ExportsModule,
    ReminderModule,
    AuthzModule,
    LedgerModule,
    ProvisioningModule,
    CreditBureauModule,
    FxModule,
    CollectionsModule,
    NotificationsModule,
    PaymentInstrumentsModule,
    AgreementsModule,
    RiskModule,
    KpiModule,
    BorrowerPortalModule,
    LendingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // ── Global guard chain, in execution order ─────────────────────────────
    // APP_GUARD providers run in registration order, so the chain reads
    // top-to-bottom: rate limit → authenticate → role → permission → tenant
    // → branch. Each stage assumes the previous one has run.
    //
    // Global rate limiter. It runs before authentication, so it verifies the
    // access token itself (signature only) to key authenticated traffic by
    // user; public routes are keyed by the client IP the web server states
    // (see common/client-ip.ts), plus the submitted email / phone on the
    // credential routes.
    { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
    // Authentication + "this route must declare an authorization policy".
    // Controllers keep their own @UseGuards for clarity; these globals make
    // the defaults deny rather than allow.
    { provide: APP_GUARD, useClass: GlobalAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: TenantScopeGuard },
    { provide: APP_GUARD, useClass: BranchScopeGuard },
    // Lending routes: coarse permission check (and service-account authentication)
    // before the handler; services make the full resource-level decision.
    { provide: APP_GUARD, useClass: LendingActionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Must wrap every request, including public ones: the holder has to exist
    // before guards run so JwtStrategy can publish the principal into it.
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
