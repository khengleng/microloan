import { Controller, Get } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { Roles } from '../auth/roles.decorator';

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
