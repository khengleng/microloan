import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { BotService } from '../bot/bot.service';
export declare class SettingsController {
    private readonly prisma;
    private readonly botService;
    constructor(prisma: PrismaService, botService: BotService);
    getSettings(user: JwtPayload): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        telegramBotToken: string | null;
    } | null>;
    updateSettings(user: JwtPayload, data: {
        name?: string;
        telegramBotToken?: string;
    }): Promise<{
        id: string;
        name: string;
        telegramBotToken: string | null;
        plan: string;
        status: string;
        stripeCustomerId: string | null;
        stripeSubscriptionId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
