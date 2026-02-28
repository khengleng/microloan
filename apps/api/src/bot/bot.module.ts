import { Module, forwardRef } from '@nestjs/common';
import { BotService } from './bot.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BorrowersModule } from '../borrowers/borrowers.module';
import { LoansModule } from '../loans/loans.module';

@Module({
    imports: [PrismaModule, BorrowersModule, forwardRef(() => LoansModule)],
    providers: [BotService],
    exports: [BotService],
})
export class BotModule { }
