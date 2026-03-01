import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
import { PenaltyCronService } from './penalty-cron/penalty-cron.service';
import { ExportsService } from './exports/exports.service';
import { PenaltyCronModule } from './penalty-cron/penalty-cron.module';
import { ExportsController } from './exports/exports.controller';
import { ExportsModule } from './exports/exports.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
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
  ],
  controllers: [AppController, ExportsController],
  providers: [AppService, PenaltyCronService, ExportsService],
})
export class AppModule { }
