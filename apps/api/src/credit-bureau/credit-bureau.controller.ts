import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreditBureauService } from './credit-bureau.service';
import { RunCreditCheckDto } from './dto/run-credit-check.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@Roles('TENANT_ADMIN', 'ADMIN', 'CREDIT_OFFICER', 'ACCOUNTANT', 'FINANCE', 'AUDITOR')
@Controller('credit-checks')
export class CreditBureauController {
    constructor(private readonly creditBureau: CreditBureauService) { }

    @Post()
    run(@CurrentUser() user: JwtPayload, @Body() dto: RunCreditCheckDto) {
        return this.creditBureau.runCheck(user, dto.borrowerId);
    }

    @Get('borrower/:borrowerId')
    listForBorrower(@CurrentUser() user: JwtPayload, @Param('borrowerId') borrowerId: string) {
        return this.creditBureau.listForBorrower(user, borrowerId);
    }
}
