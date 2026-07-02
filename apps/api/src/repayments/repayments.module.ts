import { Module } from '@nestjs/common';
import { RepaymentsService } from './repayments.service';
import { RepaymentsController } from './repayments.controller';
import { AuthzModule } from '../authz/authz.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [AuthzModule, LedgerModule],
  providers: [RepaymentsService],
  controllers: [RepaymentsController],
  exports: [RepaymentsService],
})
export class RepaymentsModule { }
