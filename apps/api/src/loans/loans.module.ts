import { Module, forwardRef } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { BotModule } from '../bot/bot.module';
import { AuthzModule } from '../authz/authz.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LegacyLoanGate } from './legacy-loan-gate';

@Module({
  imports: [AuthzModule, LedgerModule, forwardRef(() => BotModule)],
  providers: [LoansService, LegacyLoanGate],
  controllers: [LoansController],
  exports: [LoansService, LegacyLoanGate],
})
export class LoansModule { }
