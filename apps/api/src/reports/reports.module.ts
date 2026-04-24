import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { LoansModule } from '../loans/loans.module';
import { BorrowersModule } from '../borrowers/borrowers.module';
import { RepaymentsModule } from '../repayments/repayments.module';
import { ReportsService } from './reports.service';
import { AuthzModule } from '../authz/authz.module';

@Module({
  imports: [LoansModule, BorrowersModule, RepaymentsModule, AuthzModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
