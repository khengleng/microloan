import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit-logs')
export class AuditLogsController {
    constructor(private prisma: PrismaService) { }

    @Roles('ADMIN')
    @Get()
    async findAll(
        @CurrentUser() user: JwtPayload,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('action') action?: string,
        @Query('entity') entity?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('search') search?: string,
    ) {
        const pageNum = Math.max(1, parseInt(page || '1'));
        const pageSize = Math.min(100, parseInt(limit || '50'));
        const skip = (pageNum - 1) * pageSize;

        const where: any = { tenantId: user.tenantId };
        if (action) where.action = action;
        if (entity) where.entity = entity;
        if (from || to) {
            where.createdAt = {};
            if (from) where.createdAt.gte = new Date(from);
            if (to) where.createdAt.lte = new Date(to);
        }

        const [logs, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                where,
                include: { user: { select: { email: true, role: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: pageSize,
            }),
            this.prisma.auditLog.count({ where }),
        ]);

        return {
            data: logs,
            meta: {
                total,
                page: pageNum,
                pageSize,
                pages: Math.ceil(total / pageSize),
            },
        };
    }

    @Roles('ADMIN')
    @Get('export/csv')
    async exportCsv(
        @CurrentUser() user: JwtPayload,
        @Res() res: Response,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('action') action?: string,
        @Query('entity') entity?: string,
    ) {
        const where: any = { tenantId: user.tenantId };
        if (action) where.action = action;
        if (entity) where.entity = entity;
        if (from || to) {
            where.createdAt = {};
            if (from) where.createdAt.gte = new Date(from);
            if (to) where.createdAt.lte = new Date(to);
        }

        const logs = await this.prisma.auditLog.findMany({
            where,
            include: { user: { select: { email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            take: 10000,
        });

        const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

        const header = ['Timestamp', 'Action', 'Entity', 'EntityId', 'User Email', 'User Role', 'Details'];
        const rows = logs.map(l => [
            escape(new Date(l.createdAt).toISOString()),
            escape(l.action),
            escape(l.entity),
            escape(l.entityId),
            escape(l.user?.email ?? l.userId),
            escape(l.user?.role ?? ''),
            escape(l.metadata ? JSON.stringify(l.metadata) : ''),
        ]);

        const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
        const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    }

    @Roles('ADMIN')
    @Get('summary')
    async summary(@CurrentUser() user: JwtPayload) {
        const [
            totalEvents,
            loginEvents,
            failedLogins,
            today,
        ] = await Promise.all([
            this.prisma.auditLog.count({ where: { tenantId: user.tenantId } }),
            this.prisma.auditLog.count({ where: { tenantId: user.tenantId, action: 'LOGIN' } }),
            this.prisma.auditLog.count({
                where: {
                    tenantId: user.tenantId,
                    action: 'LOGIN',
                    metadata: { path: ['event'], equals: 'LOGIN_FAILED' },
                }
            }),
            this.prisma.auditLog.count({
                where: {
                    tenantId: user.tenantId,
                    createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
                }
            }),
        ]);

        return { totalEvents, loginEvents, failedLogins, today };
    }
}
