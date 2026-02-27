import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BorrowersModule } from '../borrowers/borrowers.module';
import { LoansModule } from '../loans/loans.module';

@Module({
    imports: [PrismaModule, BorrowersModule, LoansModule],
    providers: [BotService],
    exports: [BotService],
})
export class BotModule { }
