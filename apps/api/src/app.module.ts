import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserAwareThrottlerGuard } from './common/user-aware-throttler.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
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
import { DocumentVaultModule } from './document-vault/document-vault.module';
import { PenaltyCronModule } from './penalty-cron/penalty-cron.module';
import { ExportsModule } from './exports/exports.module';
import { ReminderModule } from './reminder/reminder.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // ── Global rate limiting via @nestjs/throttler ─────────────────────────────────
    // Works in-memory on a single instance (current Railway setup).
    // To scale HA: add ThrottlerStorageRedisService + ioredis.
    // Named throttlers allow @Throttle({ login: {} }) per-route customisation.
    ThrottlerModule.forRoot([
      // Per-user bucket for authenticated routes (keyed on user ID by UserAwareThrottlerGuard).
      // 120 req/sec gives a single user plenty of room for page navigation with
      // parallel API calls (dashboard, sidebar, modals all fire at once).
      { name: 'short', ttl: 1_000, limit: 120 },
      // Unauthenticated endpoints — these still key on IP (see guard).
      { name: 'login', ttl: 15 * 60_000, limit: 10 }, // 10 attempts / IP / 15 min
      { name: 'register', ttl: 60 * 60_000, limit: 5 }, // 5 registrations / IP / hr
      { name: 'mfa', ttl: 15 * 60_000, limit: 10 }, // 10 MFA attempts / IP / 15 min
    ]),
    PrismaModule,
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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global rate limiter keyed by user ID for authenticated routes,
    // and by IP for public endpoints — prevents the Next.js proxy from
    // collapsing all users into a single shared bucket.
    { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
  ],
})
export class AppModule { }
