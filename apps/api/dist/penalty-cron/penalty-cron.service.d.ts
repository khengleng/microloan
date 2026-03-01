import { PrismaService } from '../prisma/prisma.service';
import { BotService } from '../bot/bot.service';
export declare class PenaltyCronService {
    private prisma;
    private botService;
    private readonly logger;
    constructor(prisma: PrismaService, botService: BotService);
    applyLatePenalties(): Promise<void>;
    sendUpcomingReminders(): Promise<void>;
}
