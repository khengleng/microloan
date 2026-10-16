import { BadRequestException, Injectable } from '@nestjs/common';
import { lending } from '@microloan/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Tx } from './lending-prisma';
import { fromLocalDate, toLocalDate } from './util';

/**
 * The tenant's business date: the accounting date every posting carries.
 *
 * It starts at the tenant's local calendar date (Asia/Phnom_Penh, UTC+7) the
 * first time it is read, and from then on only moves when finance advances it
 * — never automatically, never backwards. Value dates may precede it only
 * within the product's `maxBackdateDays`.
 */
@Injectable()
export class BusinessDateService {
  constructor(private readonly prisma: PrismaService) {}

  static calendarToday(offsetHours = 7): string {
    return new Date(Date.now() + offsetHours * 3_600_000)
      .toISOString()
      .slice(0, 10);
  }

  async get(tenantId: string, tx?: Tx): Promise<string> {
    const db = tx ?? this.prisma;
    const row = await db.tenantBusinessDate.findUnique({ where: { tenantId } });
    if (row) return toLocalDate(row.businessDate)!;
    const today = BusinessDateService.calendarToday();
    await db.tenantBusinessDate.upsert({
      where: { tenantId },
      create: { tenantId, businessDate: fromLocalDate(today) },
      update: {},
    });
    return today;
  }

  async advance(
    tenantId: string,
    to: string,
    actorId: string,
  ): Promise<string> {
    lending.parseDate(to, 'businessDate');
    const current = await this.get(tenantId);
    if (lending.compareDates(to, current) <= 0) {
      throw new BadRequestException(
        `The business date only moves forward (current ${current}).`,
      );
    }
    if (lending.daysBetween(current, to) > 31) {
      throw new BadRequestException(
        'Advance the business date at most 31 days at a time, running accruals between steps.',
      );
    }
    await this.prisma.tenantBusinessDate.update({
      where: { tenantId },
      data: { businessDate: fromLocalDate(to), updatedBy: actorId },
    });
    return to;
  }

  /**
   * Validate a requested value date against the business date: no future
   * dating, and backdating only within the product's window.
   */
  static checkValueDate(
    valueDate: string,
    businessDate: string,
    maxBackdateDays: number,
  ): void {
    lending.parseDate(valueDate, 'valueDate');
    if (lending.compareDates(valueDate, businessDate) > 0) {
      throw new BadRequestException(
        `Value date ${valueDate} is after the business date ${businessDate}.`,
      );
    }
    const back = lending.daysBetween(valueDate, businessDate);
    if (back > maxBackdateDays) {
      throw new BadRequestException(
        `Value date ${valueDate} is ${back} day(s) before the business date; this product allows ${maxBackdateDays}.`,
      );
    }
  }
}
