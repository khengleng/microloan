import { Controller, Get, Put, Body, UseGuards, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { BotService } from '../bot/bot.service';
import { normalizeCurrency, NBC_ANNUAL_INTEREST_CAP_PCT } from '@microloan/shared';
import { Currency } from '@microloan/db';

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
        if (!user.tenantId) throw new UnauthorizedException('Tenant scope is required.');
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: user.tenantId },
            select: {
                id: true,
                name: true,
                plan: true,
                telegramBotToken: true,
                baseCurrency: true,
                maxAnnualInterestRatePct: true,
                requireCreditCheckForApproval: true,
                creditCheckValidityDays: true,
                createdAt: true,
            }
        });
        // Whether online billing (Stripe) is provisioned — lets the UI show a
        // clear "not enabled yet" state instead of erroring on Upgrade/Manage.
        return { ...tenant, billingEnabled: !!process.env.STRIPE_SECRET_KEY?.trim() };
    }

    @Roles('ADMIN')
    @Put()
    async updateSettings(
        @CurrentUser() user: JwtPayload,
        @Body() data: {
            name?: string;
            telegramBotToken?: string;
            baseCurrency?: string;
            maxAnnualInterestRatePct?: number;
            requireCreditCheckForApproval?: boolean;
            creditCheckValidityDays?: number;
        }
    ) {
        if (!user.tenantId) throw new UnauthorizedException('Tenant scope is required.');

        // Feature #1: never allow a tenant cap above the NBC regulatory ceiling.
        let cap: number | undefined;
        if (data.maxAnnualInterestRatePct !== undefined) {
            cap = Math.min(Number(data.maxAnnualInterestRatePct), NBC_ANNUAL_INTEREST_CAP_PCT);
            if (!(cap > 0)) cap = NBC_ANNUAL_INTEREST_CAP_PCT;
        }
        const baseCurrency = data.baseCurrency
            ? (normalizeCurrency(data.baseCurrency) as unknown as Currency)
            : undefined;

        const tenant = await this.prisma.tenant.update({
            where: { id: user.tenantId },
            data: {
                name: data.name,
                telegramBotToken: data.telegramBotToken,
                baseCurrency,
                maxAnnualInterestRatePct: cap,
                requireCreditCheckForApproval: data.requireCreditCheckForApproval,
                creditCheckValidityDays: data.creditCheckValidityDays,
            }
        });

        // Restart bot for this tenant if token changed
        if (data.telegramBotToken) {
            await this.botService.startBotForTenant(tenant.id, data.telegramBotToken);
        }

        return tenant;
    }
}
