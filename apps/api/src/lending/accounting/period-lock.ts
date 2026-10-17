import { ConflictException } from '@nestjs/common';
import type { Tx } from '../common/lending-prisma';
import { toLocalDate } from '../common/util';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function periodLabel(year: number, month: number) {
  return month === 0
    ? `Financial year ${year}`
    : `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Refuse a posting dated in a locked month (OPS-6). The database refuses it
 * again (trigger `LendingJournalEntry_period_lock`); this gives the reason.
 */
export async function assertPeriodOpen(
  tx: Tx,
  tenantId: string,
  entryDate: Date,
) {
  const closed = await tx.accountingPeriod.findFirst({
    where: {
      tenantId,
      month: { gt: 0 },
      status: { in: ['CLOSED', 'REOPEN_PENDING'] },
      startDate: { lte: entryDate },
      endDate: { gte: entryDate },
    },
    select: { year: true, month: true },
  });
  if (closed)
    throw new ConflictException({
      message: `${periodLabel(closed.year, closed.month)} is closed; nothing can be posted on ${toLocalDate(entryDate)}. Ask finance to reopen it.`,
      code: 'PERIOD_CLOSED',
    });
}
