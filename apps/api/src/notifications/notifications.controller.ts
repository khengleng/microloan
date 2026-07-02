import { Controller, Get, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'TENANT_ADMIN', 'SUPERADMIN')
@Controller('notifications')
export class NotificationsController {
    constructor(private readonly notifications: NotificationsService) { }

    // Lets the UI show whether email/SMS delivery is enabled yet.
    @Get('status')
    status() {
        return this.notifications.status;
    }
}
