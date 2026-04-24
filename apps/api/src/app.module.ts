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
import { AuthzModule } from './authz/authz.module';
import { loadRuntimeConfig } from './config/runtime-config';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      useFactory: async () => {
        const runtime = loadRuntimeConfig();
        const base = { name: 'default', ttl: 1_000, limit: 120 };

        if (!runtime.isProduction) {
          return [base];
        }
        // Runtime import avoids TS export-map issues with legacy redis storage package.
        const { ThrottlerStorageRedisService } = require('nestjs-throttler-storage-redis') as {
          ThrottlerStorageRedisService: new (url?: string) => any;
        };

        return [
          {
            ...base,
            storage: new ThrottlerStorageRedisService(runtime.redisUrl),
          },
        ];
      },
    }),
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
    AuthzModule,
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
