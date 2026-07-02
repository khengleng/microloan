import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ProvisioningService } from './provisioning.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard, RolesGuard)
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
