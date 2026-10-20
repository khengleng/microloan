import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import {
  LendingReportsService,
  PortfolioQuery,
  ReceiptsQuery,
} from './reports.service';

const actor = (req: Request) => lendingActorOf(req as never);
const text = (v: unknown) => (typeof v === 'string' ? v : undefined);

function portfolioQuery(q: Record<string, unknown>): PortfolioQuery {
  return {
    status: text(q.status),
    currency: text(q.currency),
    branchId: text(q.branchId),
    productId: text(q.productId),
    band: text(q.band),
    q: text(q.q),
    page: Number(q.page) || undefined,
    limit: Number(q.limit) || undefined,
  };
}

function receiptsQuery(q: Record<string, unknown>): ReceiptsQuery {
  return {
    from: text(q.from),
    to: text(q.to),
    currency: text(q.currency),
    page: Number(q.page) || undefined,
    limit: Number(q.limit) || undefined,
  };
}

/** Reports on the lending book (D-153), within the caller's loan scope. */
@Controller('lending/reports')
export class LendingReportsController {
  constructor(private readonly reports: LendingReportsService) {}

  @LendingAction('loan.read')
  @Get('portfolio')
  portfolio(@Req() req: Request, @Query() q: Record<string, unknown>) {
    return this.reports.portfolio(actor(req), portfolioQuery(q));
  }

  @LendingAction('loan_data.export')
  @Get('portfolio.csv')
  async portfolioCsv(
    @Req() req: Request,
    @Res() res: Response,
    @Query() q: Record<string, unknown>,
  ) {
    const out = await this.reports.portfolioCsv(actor(req), portfolioQuery(q));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="loan-portfolio.csv"',
    );
    res.send(out);
  }

  @LendingAction('loan.read')
  @Get('receipts')
  receipts(@Req() req: Request, @Query() q: Record<string, unknown>) {
    return this.reports.receipts(actor(req), receiptsQuery(q));
  }

  @LendingAction('loan_data.export')
  @Get('receipts.csv')
  async receiptsCsv(
    @Req() req: Request,
    @Res() res: Response,
    @Query() q: Record<string, unknown>,
  ) {
    const out = await this.reports.receiptsCsv(actor(req), receiptsQuery(q));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="money-received.csv"',
    );
    res.send(out);
  }

  @LendingAction('loan.read')
  @Get('performance')
  performance(@Req() req: Request) {
    return this.reports.performance(actor(req));
  }
}
