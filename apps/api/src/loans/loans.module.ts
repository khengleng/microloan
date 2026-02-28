import { Module, forwardRef } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [forwardRef(() => BotModule)],
  providers: [LoansService],
  controllers: [LoansController],
  exports: [LoansService],
})
export class LoansModule { }
