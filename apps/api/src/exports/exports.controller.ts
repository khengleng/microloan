import { Controller, Get, Res } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';
import { BadRequestException } from '@nestjs/common';

@Controller('exports')
export class ExportsController {
    constructor(private readonly exportsService: ExportsService) { }

    @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES')
    @Get('loans/excel')
    async exportLoansExcel(@CurrentUser() user: JwtPayload, @Res() res: Response) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        const buffer = await this.exportsService.exportLoansToExcel(user.tenantId, user.sub);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=loans.xlsx');
        res.send(buffer);
    }

    @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES')
    @Get('repayments/excel')
    async exportRepaymentsExcel(@CurrentUser() user: JwtPayload, @Res() res: Response) {
        if (!user.tenantId) throw new BadRequestException('Tenant scope is required.');
        const buffer = await this.exportsService.exportRepaymentsToExcel(user.tenantId, user.sub);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=repayments.xlsx');
        res.send(buffer);
    }
}
