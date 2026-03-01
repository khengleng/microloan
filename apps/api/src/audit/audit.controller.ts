import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit-logs')
export class AuditLogsController {
    constructor(private prisma: PrismaService) { }

    @Roles('ADMIN', 'SUPERADMIN')
    @Get()
    async findAll(@CurrentUser() user: JwtPayload) {
        return this.prisma.auditLog.findMany({
            where: { tenantId: user.tenantId },
            include: {
                user: { select: { email: true, role: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
    }
}
