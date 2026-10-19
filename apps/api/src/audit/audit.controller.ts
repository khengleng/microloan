import { Controller, Get, Query, Res } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';

/**
 * The audit-log filter shared by the list and the CSV export: action matches
 * case-insensitively on any part (LOGIN finds LOGIN_FAILED), entity matches
 * the record type ignoring case, `search` looks across the
 * whole log (action, entity, record id, user email) — not only the page on
 * screen — and a date-only `to` includes that whole day.
 */
export function auditLogWhere(
    user: Pick<JwtPayload, 'tenantId'>,
    q: { action?: string; entity?: string; from?: string; to?: string; search?: string },
) {
    // A platform SUPERADMIN (tenantId=null) sees all logs, including platform
    // events stored with tenantId=null; tenants see only their own.
    const where: any = user.tenantId ? { tenantId: user.tenantId } : {};
    const action = q.action?.trim();
    const entity = q.entity?.trim();
    const search = q.search?.trim();
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (entity) where.entity = { equals: entity, mode: 'insensitive' };
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    const from = q.from ? new Date(q.from) : null;
    let to: Date | null = null;
    let toExclusive = false;
    if (q.to) {
        to = new Date(q.to);
        if (dateOnly.test(q.to) && !Number.isNaN(to.getTime())) {
            to = new Date(to.getTime() + 86_400_000);
            toExclusive = true;
        }
    }
    if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
        where.createdAt = {};
        if (from && !Number.isNaN(from.getTime())) where.createdAt.gte = from;
        if (to && !Number.isNaN(to.getTime())) where.createdAt[toExclusive ? 'lt' : 'lte'] = to;
    }
    if (search) {
        where.OR = [
            { action: { contains: search, mode: 'insensitive' } },
            { entity: { contains: search, mode: 'insensitive' } },
            { entityId: { contains: search, mode: 'insensitive' } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
        ];
    }
    return where;
}

@Controller('audit-logs')
export class AuditLogsController {
    constructor(private prisma: PrismaService) { }

    @Roles('SUPERADMIN', 'ADMIN')
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
        const pageNum = Math.max(1, parseInt(page || '1') || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(limit || '50') || 50));
        const skip = (pageNum - 1) * pageSize;

        const where = auditLogWhere(user, { action, entity, from, to, search });

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

    @Roles('SUPERADMIN', 'ADMIN')
    @Get('export/csv')
    async exportCsv(
        @CurrentUser() user: JwtPayload,
        @Res() res: Response,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('action') action?: string,
        @Query('entity') entity?: string,
        @Query('search') search?: string,
    ) {
        const where = auditLogWhere(user, { action, entity, from, to, search });

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

    @Roles('SUPERADMIN', 'ADMIN')
    @Get('summary')
    async summary(@CurrentUser() user: JwtPayload) {
        const tenantScope = user.tenantId ? { tenantId: user.tenantId } : {};
        const [
            totalEvents,
            loginEvents,
            failedLogins,
            today,
        ] = await Promise.all([
            this.prisma.auditLog.count({ where: { ...tenantScope } }),
            this.prisma.auditLog.count({ where: { ...tenantScope, action: 'LOGIN' } }),
            this.prisma.auditLog.count({
                where: {
                    ...tenantScope,
                    action: 'LOGIN',
                    metadata: { path: ['event'], equals: 'LOGIN_FAILED' },
                }
            }),
            this.prisma.auditLog.count({
                where: {
                    ...tenantScope,
                    createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
                }
            }),
        ]);

        return { totalEvents, loginEvents, failedLogins, today };
    }
}
