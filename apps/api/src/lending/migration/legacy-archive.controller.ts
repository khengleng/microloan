import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { LegacyArchiveService } from './legacy-archive.service';

const actor = (req: Request) => lendingActorOf(req as never);
const text = (v: unknown) => (typeof v === 'string' ? v : undefined);

/**
 * The legacy loan archive (D-154): the original module's loans, read-only.
 * Open loans are moved onto the lending platform with the loan-book
 * migration (GET /lending/migrations/legacy-export.csv).
 */
@Controller('lending/legacy-archive')
export class LegacyArchiveController {
  constructor(private readonly archive: LegacyArchiveService) {}

  @LendingAction('legacy_loan.read')
  @Get('summary')
  summary(@Req() req: Request) {
    return this.archive.summary(actor(req));
  }

  @LendingAction('legacy_loan.read')
  @Get('loans')
  list(@Req() req: Request, @Query() q: Record<string, unknown>) {
    return this.archive.list(actor(req), {
      status: text(q.status),
      q: text(q.q),
      page: Number(q.page) || undefined,
      limit: Number(q.limit) || undefined,
    });
  }

  @LendingAction('legacy_loan.read')
  @Get('export.csv')
  async export(
    @Req() req: Request,
    @Res() res: Response,
    @Query() q: Record<string, unknown>,
  ) {
    const csv = await this.archive.exportCsv(actor(req), {
      status: text(q.status),
      q: text(q.q),
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="legacy-loan-archive.csv"',
    );
    res.send(csv);
  }

  @LendingAction('legacy_loan.read')
  @Get('loans/:id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.archive.get(actor(req), id);
  }
}
