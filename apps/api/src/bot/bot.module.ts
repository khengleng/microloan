import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BorrowersModule } from '../borrowers/borrowers.module';

@Module({
    imports: [PrismaModule, BorrowersModule],
    providers: [BotService],
    exports: [BotService],
})
export class BotModule { }
