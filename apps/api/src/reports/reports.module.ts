import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { LoansModule } from '../loans/loans.module';
import { BorrowersModule } from '../borrowers/borrowers.module';
import { RepaymentsModule } from '../repayments/repayments.module';

@Module({
  imports: [LoansModule, BorrowersModule, RepaymentsModule],
  controllers: [ReportsController],
})
export class ReportsModule {}
