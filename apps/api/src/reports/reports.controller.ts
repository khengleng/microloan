import {
  Controller,
  Get,
  Query,
  UseGuards,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PermissionGuard } from '../authz/permission.guard';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';
import { ReportsService } from './reports.service';
import { ReportExportQueryDto, ReportQueryDto } from './dto/report-query.dto';
import { AuditService } from '../audit/audit.service';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('overview')
  async overview(@CurrentUser() user: JwtPayload, @Query() query: ReportQueryDto) {
    const data = await this.reportsService.overview(user, query);
    await this.audit.logSecurityEvent({
      actorUserId: user.sub,
      actorRole: user.role,
      actorTenantId: user.tenantId,
      targetType: 'Report',
      targetId: 'overview',
      action: 'REPORT_VIEW',
      newValue: { filters: query },
      result: 'SUCCESS',
    });
    return data;
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('loan-portfolio')
  async loanPortfolio(@CurrentUser() user: JwtPayload, @Query() query: ReportQueryDto) {
    const data = await this.reportsService.loanPortfolio(user, query);
    await this.audit.logSecurityEvent({
      actorUserId: user.sub,
      actorRole: user.role,
      actorTenantId: user.tenantId,
      targetType: 'Report',
      targetId: 'loan-portfolio',
      action: 'REPORT_VIEW',
      newValue: { filters: query },
      result: 'SUCCESS',
    });
    return data;
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('collections')
  async collections(@CurrentUser() user: JwtPayload, @Query() query: ReportQueryDto) {
    const data = await this.reportsService.collections(user, query);
    await this.audit.logSecurityEvent({
      actorUserId: user.sub,
      actorRole: user.role,
      actorTenantId: user.tenantId,
      targetType: 'Report',
      targetId: 'collections',
      action: 'REPORT_VIEW',
      newValue: { filters: query },
      result: 'SUCCESS',
    });
    return data;
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('borrowers')
  async borrowers(@CurrentUser() user: JwtPayload, @Query() query: ReportQueryDto) {
    const data = await this.reportsService.borrowers(user, query);
    await this.audit.logSecurityEvent({
      actorUserId: user.sub,
      actorRole: user.role,
      actorTenantId: user.tenantId,
      targetType: 'Report',
      targetId: 'borrowers',
      action: 'REPORT_VIEW',
      newValue: { filters: query },
      result: 'SUCCESS',
    });
    return data;
  }

  @RequirePermissions(Permission.AUDIT_VIEW)
  @Get('risk')
  async risk(@CurrentUser() user: JwtPayload, @Query() query: ReportQueryDto) {
    const data = await this.reportsService.risk(user, query);
    await this.audit.logSecurityEvent({
      actorUserId: user.sub,
      actorRole: user.role,
      actorTenantId: user.tenantId,
      targetType: 'Report',
      targetId: 'risk',
      action: 'REPORT_VIEW',
      newValue: { filters: query },
      result: 'SUCCESS',
    });
    return data;
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('loan-portfolio/export')
  async exportLoanPortfolio(@CurrentUser() user: JwtPayload, @Query() query: ReportExportQueryDto, @Res() res: Response) {
    return this.handleExport('loan-portfolio', user, query, res);
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('collections/export')
  async exportCollections(@CurrentUser() user: JwtPayload, @Query() query: ReportExportQueryDto, @Res() res: Response) {
    return this.handleExport('collections', user, query, res);
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('borrowers/export')
  async exportBorrowers(@CurrentUser() user: JwtPayload, @Query() query: ReportExportQueryDto, @Res() res: Response) {
    return this.handleExport('borrowers', user, query, res);
  }

  @RequirePermissions(Permission.AUDIT_VIEW)
  @Get('risk/export')
  async exportRisk(@CurrentUser() user: JwtPayload, @Query() query: ReportExportQueryDto, @Res() res: Response) {
    return this.handleExport('risk', user, query, res);
  }

  // Backward compatibility with existing dashboard/report exports
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('dashboard')
  dashboardAlias(@CurrentUser() user: JwtPayload, @Query() query: ReportQueryDto) {
    return this.overview(user, query);
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('loan-book')
  loanBookAlias(@CurrentUser() user: JwtPayload, @Query() query: ReportQueryDto, @Res() res: Response) {
    return this.handleExport('loan-portfolio', user, { ...query, format: 'csv' }, res);
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('repayments')
  repaymentsAlias(@CurrentUser() user: JwtPayload, @Query() query: ReportQueryDto, @Res() res: Response) {
    return this.handleExport('collections', user, { ...query, format: 'csv' }, res);
  }

  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('cashflow')
  async cashflowAlias(@CurrentUser() user: JwtPayload, @Query() query: ReportQueryDto) {
    const data = await this.reportsService.overview(user, query);
    const charts = data.charts as { disbursementTrend?: unknown[] };
    return charts.disbursementTrend || [];
  }

  private async handleExport(
    report: 'loan-portfolio' | 'collections' | 'borrowers' | 'risk',
    user: JwtPayload,
    query: ReportExportQueryDto,
    res: Response,
  ) {
    if (!query.format) {
      throw new BadRequestException('format is required: csv|xlsx');
    }
    const rows = await this.reportsService.exportRows(report, user, query);
    const fileBase = `${report}_${new Date().toISOString().slice(0, 10)}`;

    if (query.format === 'csv') {
      const csv = this.reportsService.toCsv(rows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
      res.send(csv);
    } else if (query.format === 'xlsx') {
      const xlsx = this.reportsService.toXlsx(rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
      res.send(xlsx);
    } else {
      throw new BadRequestException('Unsupported format');
    }

    await this.audit.logSecurityEvent({
      actorUserId: user.sub,
      actorRole: user.role,
      actorTenantId: user.tenantId,
      targetType: 'Report',
      targetId: report,
      action: 'REPORT_EXPORT',
      newValue: { format: query.format, filters: query },
      reason: report === 'borrowers' ? 'Sensitive borrower data exported' : undefined,
      result: 'SUCCESS',
    });
  }
}
