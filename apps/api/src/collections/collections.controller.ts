import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPERATOR', 'FINANCE', 'CX', 'TENANT_ADMIN', 'ACCOUNTANT', 'LOAN_OFFICER', 'BRANCH_MANAGER', 'CUSTOMER_SUPPORT')
@Controller('collections')
export class CollectionsController {
    constructor(private readonly collections: CollectionsService) { }

    @Get('queue')
    queue(@CurrentUser() user: JwtPayload) {
        return this.collections.queue(user);
    }

    @Get('loans/:loanId/promises')
    listPromises(@CurrentUser() user: JwtPayload, @Param('loanId') loanId: string) {
        return this.collections.listPromises(user, loanId);
    }

    @Post('loans/:loanId/promises')
    createPromise(
        @CurrentUser() user: JwtPayload,
        @Param('loanId') loanId: string,
        @Body() dto: { amount: number; promisedDate: string; notes?: string },
    ) {
        return this.collections.createPromise(user, loanId, dto);
    }

    @Patch('promises/:promiseId')
    updatePromise(
        @CurrentUser() user: JwtPayload,
        @Param('promiseId') promiseId: string,
        @Body() dto: { status: string },
    ) {
        return this.collections.updatePromiseStatus(user, promiseId, dto?.status);
    }

    @Post('loans/:loanId/log')
    logActivity(
        @CurrentUser() user: JwtPayload,
        @Param('loanId') loanId: string,
        @Body() dto: { notes: string; type?: string; title?: string },
    ) {
        return this.collections.logActivity(user, loanId, dto);
    }
}
