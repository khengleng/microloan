import { Module, forwardRef } from '@nestjs/common';
import { PenaltyCronService } from './penalty-cron.service';
import { BotModule } from '../bot/bot.module';

@Module({
    imports: [forwardRef(() => BotModule)],
    // PrismaService comes from the global PrismaModule: one pool per process.
    providers: [PenaltyCronService],
})
export class PenaltyCronModule { }
