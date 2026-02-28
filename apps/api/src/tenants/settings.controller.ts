import { Controller, Get, Put, Body, UseGuards, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { BotService } from '../bot/bot.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('settings')
export class SettingsController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly botService: BotService,
    ) { }

    @Roles('ADMIN')
    @Get()
    async getSettings(@CurrentUser() user: JwtPayload) {
        return this.prisma.tenant.findUnique({
            where: { id: user.tenantId },
            select: {
                id: true,
                name: true,
                telegramBotToken: true,
                createdAt: true,
            }
        });
    }

    @Roles('ADMIN')
    @Put()
    async updateSettings(
        @CurrentUser() user: JwtPayload,
        @Body() data: { name?: string; telegramBotToken?: string }
    ) {
        const tenant = await this.prisma.tenant.update({
            where: { id: user.tenantId },
            data: {
                name: data.name,
                telegramBotToken: data.telegramBotToken,
            }
        });

        // Restart bot for this tenant if token changed
        if (data.telegramBotToken) {
            await this.botService.startBotForTenant(tenant.id, data.telegramBotToken);
        }

        return tenant;
    }
}
