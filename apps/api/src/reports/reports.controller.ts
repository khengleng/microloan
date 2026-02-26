import { Controller, Get, UseGuards, Res } from '@nestjs/common';
import { LoansService } from '../loans/loans.service';
import { BorrowersService } from '../borrowers/borrowers.service';
import { RepaymentsService } from '../repayments/repayments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly loansService: LoansService,
    private readonly borrowersService: BorrowersService,
    private readonly repaymentsService: RepaymentsService,
  ) {}

  @Get('loan-book')
  async exportLoanBook(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const loans = await this.loansService.findAll(user.tenantId);

    // Simple CSV Generation
    const header =
      'id,borrower,principal,interestRate,term,method,status,startDate\n';
    const rows = loans
      .map(
        (l) =>
          `${l.id},${l.borrower.firstName} ${l.borrower.lastName},${l.principal},${l.annualInterestRate},${l.termMonths},${l.interestMethod},${l.status},${new Date(l.startDate).toISOString()}`,
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

  @Get('repayments')
  async exportRepayments(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const repayments = await this.repaymentsService.findAll(user.tenantId);

    const header = 'id,loanId,borrower,amount,date\n';
    const rows = repayments
      .map(
        (r) =>
          `${r.id},${r.loanId},${r.loan.borrower.firstName} ${r.loan.borrower.lastName},${r.amount},${new Date(r.date).toISOString()}`,
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
}
