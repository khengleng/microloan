import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { lending } from '@microloan/shared';
import { LedgerService } from '../../ledger/ledger.service';
import type { Tx } from '../common/lending-prisma';
import { D } from '../common/util';
import { assertPeriodOpen } from './period-lock';

export interface PostingLine {
  accountCode: string;
  debit?: string;
  credit?: string;
}

/**
 * Balanced double-entry postings for lending financial events.
 *
 * Runs inside the caller's transaction with the financial event, so an event
 * and its journal commit together or not at all — there is no unposted
 * financial operation. Balance is checked here in decimal arithmetic, and
 * again by a deferred constraint trigger at commit.
 */
@Injectable()
export class PostingService {
  constructor(private readonly ledger: LedgerService) {}

  async post(
    tx: Tx,
    input: {
      tenantId: string;
      financialEventId: string;
      /** Null for tenant-level money (unidentified receipts and their refunds). */
      loanAccountId: string | null;
      entryDate: Date;
      currency: string;
      description: string;
      lines: PostingLine[];
      /** Only the year-end closing journal is dated in a closed period. */
      allowClosedPeriod?: boolean;
    },
  ) {
    const lines = input.lines
      .map((l) => ({
        accountCode: l.accountCode,
        debit: D(l.debit ?? '0'),
        credit: D(l.credit ?? '0'),
      }))
      .filter((l) => !l.debit.isZero() || !l.credit.isZero());
    if (lines.length < 2)
      throw new InternalServerErrorException(
        'A journal entry needs at least two non-zero lines.',
      );
    for (const l of lines) {
      if (
        l.debit.isNegative() ||
        l.credit.isNegative() ||
        (!l.debit.isZero() && !l.credit.isZero())
      ) {
        throw new InternalServerErrorException(
          `Invalid journal line on ${l.accountCode}.`,
        );
      }
      if (!lending.isRepresentable(l.debit.plus(l.credit), input.currency)) {
        throw new InternalServerErrorException(
          `Journal amount on ${l.accountCode} exceeds ${input.currency} precision.`,
        );
      }
    }
    const debit = lines.reduce((a, l) => a.plus(l.debit), new lending.D(0));
    const credit = lines.reduce((a, l) => a.plus(l.credit), new lending.D(0));
    if (!debit.eq(credit)) {
      throw new InternalServerErrorException(
        `Unbalanced lending journal: debits ${debit} ≠ credits ${credit}.`,
      );
    }

    if (!input.allowClosedPeriod)
      await assertPeriodOpen(tx, input.tenantId, input.entryDate);
    await this.ledger.ensureChartOfAccounts(input.tenantId, tx);
    const accounts = await tx.ledgerAccount.findMany({
      where: {
        tenantId: input.tenantId,
        code: { in: [...new Set(lines.map((l) => l.accountCode))] },
      },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    for (const l of lines) {
      if (!byCode.has(l.accountCode))
        throw new InternalServerErrorException(
          `Ledger account ${l.accountCode} is not in the chart of accounts.`,
        );
    }

    // Entry first, then flat line inserts: the (tenantId, …) composite relations
    // cannot be expressed through a nested create.
    const entry = await tx.lendingJournalEntry.create({
      data: {
        tenantId: input.tenantId,
        financialEventId: input.financialEventId,
        loanAccountId: input.loanAccountId,
        entryDate: input.entryDate,
        currency: input.currency,
        description: input.description,
      },
    });
    await tx.lendingJournalLine.createMany({
      data: lines.map((l) => ({
        tenantId: input.tenantId,
        entryId: entry.id,
        accountId: byCode.get(l.accountCode)!,
        accountCode: l.accountCode,
        loanAccountId: input.loanAccountId,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
      })),
    });
    return entry;
  }

  /** Mirror an entry for a reversal: every debit becomes a credit and vice versa. */
  static reverseLines(
    lines: { accountCode: string; debit: unknown; credit: unknown }[],
  ): PostingLine[] {
    return lines.map((l) => ({
      accountCode: l.accountCode,
      debit: D(l.credit as string).toString(),
      credit: D(l.debit as string).toString(),
    }));
  }
}
