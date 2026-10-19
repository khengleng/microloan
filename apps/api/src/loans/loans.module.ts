import { Module, forwardRef } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { BotModule } from '../bot/bot.module';
import { AuthzModule } from '../authz/authz.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LegacyLoanGateModule } from './legacy-loan-gate';

@Module({
  imports: [
    AuthzModule,
    LedgerModule,
    LegacyLoanGateModule,
    forwardRef(() => BotModule),
  ],
  providers: [LoansService],
  controllers: [LoansController],
  exports: [LoansService],
})
export class LoansModule { }
