import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

// Coarse role gate; fine-grained enforcement is in LedgerService.assertPermission.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TENANT_ADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCE', 'AUDITOR')
@Controller('ledger')
export class LedgerController {
    constructor(private readonly ledger: LedgerService) { }

    @Get('accounts')
    accounts(@CurrentUser() user: JwtPayload) {
        return this.ledger.listAccounts(user);
    }

    @Get('journal')
    journal(
        @CurrentUser() user: JwtPayload,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('source') source?: string,
        @Query('loanId') loanId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.ledger.listJournal(user, {
            from,
            to,
            source,
            loanId,
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }

    @Get('trial-balance')
    trialBalance(
        @CurrentUser() user: JwtPayload,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('currency') currency?: string,
    ) {
        return this.ledger.trialBalance(user, { from, to, currency });
    }
}
