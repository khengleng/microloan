import { Controller, Get, Post, Param } from '@nestjs/common';
import { ProvisioningService } from './provisioning.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@Roles('TENANT_ADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCE', 'AUDITOR')
@Controller('provisioning')
export class ProvisioningController {
    constructor(private readonly provisioning: ProvisioningService) { }

    @Post('run')
    run(@CurrentUser() user: JwtPayload) {
        return this.provisioning.run(user);
    }

    @Get('runs')
    listRuns(@CurrentUser() user: JwtPayload) {
        return this.provisioning.listRuns(user);
    }

    @Get('runs/:id')
    getRun(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        return this.provisioning.getRun(user, id);
    }
}
