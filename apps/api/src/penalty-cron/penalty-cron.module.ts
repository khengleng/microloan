import { Module, forwardRef } from '@nestjs/common';
import { PenaltyCronService } from './penalty-cron.service';
import { PrismaService } from '../prisma/prisma.service';
import { BotModule } from '../bot/bot.module';

@Module({
    imports: [forwardRef(() => BotModule)],
    providers: [PenaltyCronService, PrismaService],
})
export class PenaltyCronModule { }
