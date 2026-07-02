import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { FxService } from './fx.service';
import { UpsertExchangeRateDto } from './dto/upsert-exchange-rate.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TENANT_ADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCE', 'AUDITOR')
@Controller('fx')
export class FxController {
    constructor(private readonly fx: FxService) { }

    @Get('rates')
    listRates(@CurrentUser() user: JwtPayload) {
        return this.fx.listRates(user);
    }

    @Post('rates')
    upsertRate(@CurrentUser() user: JwtPayload, @Body() dto: UpsertExchangeRateDto) {
        return this.fx.upsertRate(user, dto);
    }

    @Get('convert')
    convert(
        @CurrentUser() user: JwtPayload,
        @Query('amount') amount: string,
        @Query('from') from: string,
        @Query('to') to: string,
    ) {
        return this.fx.convert(user, Number(amount), from, to);
    }
}
