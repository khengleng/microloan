import { Controller, Get, UseGuards, Res } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('exports')
export class ExportsController {
    constructor(private readonly exportsService: ExportsService) { }

    @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES')
    @Get('loans/excel')
    async exportLoansExcel(@CurrentUser() user: JwtPayload, @Res() res: Response) {
        const buffer = await this.exportsService.exportLoansToExcel(user.tenantId, user.sub);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=loans.xlsx');
        res.send(buffer);
    }

    @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES')
    @Get('repayments/excel')
    async exportRepaymentsExcel(@CurrentUser() user: JwtPayload, @Res() res: Response) {
        const buffer = await this.exportsService.exportRepaymentsToExcel(user.tenantId, user.sub);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=repayments.xlsx');
        res.send(buffer);
    }
}
