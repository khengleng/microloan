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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
