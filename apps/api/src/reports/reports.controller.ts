import { Controller, Get, UseGuards, Res } from '@nestjs/common';
import { LoansService } from '../loans/loans.service';
import { BorrowersService } from '../borrowers/borrowers.service';
import { RepaymentsService } from '../repayments/repayments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sanitize a value for CSV output to prevent CSV Injection (OWASP).
 * Formula-triggering characters at the start of a cell are prefixed with a
 * single quote so spreadsheet apps treat them as text.
 */
function csvSafe(value: any): string {
  const s = String(value ?? '');
  // Characters that trigger formula execution in Excel / LibreOffice
  if (s.length > 0 && ['=', '+', '-', '@', '\t', '\r'].includes(s[0])) {
    return `'${s.replace(/"/g, '""')}`;
  }
  return s.replace(/"/g, '""');
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly loansService: LoansService,
    private readonly borrowersService: BorrowersService,
    private readonly repaymentsService: RepaymentsService,
    private readonly prisma: PrismaService,
  ) { }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES')
  @Get('dashboard')
  async getDashboardStats(@CurrentUser() user: JwtPayload) {
    const tenantId = user.tenantId;

    const activeLoans = await this.prisma.loan.count({
      where: { tenantId, status: 'DISBURSED' }
    });

    const totalBorrowers = await this.prisma.borrower.count({
      where: { tenantId }
    });

    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

    const repayments = await this.prisma.repayment.aggregate({
      where: {
        tenantId,
        date: { gte: firstDayOfMonth }
      },
      _sum: { amount: true }
    });

    const outstanding = await this.prisma.repaymentSchedule.aggregate({
      where: {
        loan: { tenantId, status: 'DISBURSED' },
        isPaid: false
      },
      _sum: { outstandingPrincipal: true }
    });

    const next7Days = new Date();
    next7Days.setDate(next7Days.getDate() + 7);
    const dueNext7 = await this.prisma.repaymentSchedule.aggregate({
      where: {
        loan: { tenantId, status: 'DISBURSED' },
        isPaid: false,
        dueDate: { gte: new Date(), lte: next7Days }
      },
      _sum: { totalAmount: true }
    });

    return {
      activeLoans,
      totalBorrowers,
      repaymentsThisMonth: repayments._sum.amount || 0,
      outstandingPrincipal: outstanding._sum.outstandingPrincipal || 0,
      dueNext7Days: dueNext7._sum.totalAmount || 0
    };
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE')
  @Get('loan-book')
  async exportLoanBook(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const result = await this.loansService.findAll(user.tenantId, undefined, undefined, 1, 10000);
    const loans = result.data;

    // Simple CSV Generation
    const header =
      'id,borrower,principal,interestRate,term,method,status,startDate\n';
    const rows = loans
      .map(
        (l) =>
          `"${csvSafe(l.id)}","${csvSafe(l.borrower.firstName + ' ' + l.borrower.lastName)}",${l.principal},${l.annualInterestRate},${l.termMonths},"${csvSafe(l.interestMethod)}","${csvSafe(l.status)}",${new Date(l.startDate).toISOString()}`,
      )
      .join('\n');

    const csv = header + rows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="loan_book.csv"',
    );
    res.send(csv);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE')
  @Get('repayments')
  async exportRepayments(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const result = await this.repaymentsService.findAll(user.tenantId, undefined, undefined, undefined, 1, 10000);
    const repayments = result.data;

    const header = 'id,loanId,borrower,amount,date\n';
    const rows = repayments
      .map(
        (r) =>
          `"${csvSafe(r.id)}","${csvSafe(r.loanId)}","${csvSafe(r.loan.borrower.firstName + ' ' + r.loan.borrower.lastName)}",${r.amount},${new Date(r.date).toISOString()}`,
      )
      .join('\n');

    const csv = header + rows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="repayments.csv"',
    );
    res.send(csv);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES', 'CX')
  @Get('cashflow')
  async getCashflow(@CurrentUser() user: JwtPayload) {
    const tenantId = user.tenantId;
    const now = new Date();

    // Build the 6-month window boundaries
    const startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Fix 8: Use SQL GROUP BY instead of loading all records into memory.
    // prisma.$queryRaw returns one row per (year, month) with the sum.
    const [disbRows, collRows] = await Promise.all([
      this.prisma.$queryRaw<{ yr: number; mo: number; total: string }[]>`
        SELECT
          EXTRACT(YEAR  FROM "startDate")::int AS yr,
          EXTRACT(MONTH FROM "startDate")::int AS mo,
          COALESCE(SUM(principal), 0)::text     AS total
        FROM "Loan"
        WHERE "tenantId" = ${tenantId}
          AND "startDate" >= ${startDate}
          AND status IN ('DISBURSED', 'CLOSED')
        GROUP BY yr, mo
      `,
      this.prisma.$queryRaw<{ yr: number; mo: number; total: string }[]>`
        SELECT
          EXTRACT(YEAR  FROM date)::int AS yr,
          EXTRACT(MONTH FROM date)::int AS mo,
          COALESCE(SUM(amount), 0)::text AS total
        FROM "Repayment"
        WHERE "tenantId" = ${tenantId}
          AND date >= ${startDate}
        GROUP BY yr, mo
      `,
    ]);

    // Build sorted month labels and merge query results
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const yr = d.getFullYear();
      const mo = d.getMonth() + 1; // SQL EXTRACT month is 1-based
      const name = d.toLocaleString('default', { month: 'short' });

      const disbRow = disbRows.find(r => Number(r.yr) === yr && Number(r.mo) === mo);
      const collRow = collRows.find(r => Number(r.yr) === yr && Number(r.mo) === mo);

      return {
        name,
        disbursements: disbRow ? parseFloat(disbRow.total) : 0,
        collections: collRow ? parseFloat(collRow.total) : 0,
      };
    });

    return months;
  }
}
