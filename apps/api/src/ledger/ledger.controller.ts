import { Controller, Get, Query } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

// Role gate plus an explicit permission gate. The service still asserts
// LEDGER_VIEW per method — the declaration here makes the policy visible on
// the route rather than only discoverable by reading the service.
@Roles('TENANT_ADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCE', 'AUDITOR')
@RequirePermissions(Permission.LEDGER_VIEW)
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
