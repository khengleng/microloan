import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { lending } from '@microloan/shared';
import { LedgerService } from '../../ledger/ledger.service';
import type { Tx } from '../common/lending-prisma';
import { D } from '../common/util';
import { assertPeriodOpen } from './period-lock';
import { currentBatch } from '../servicing/batch-scope';

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
  /**
   * Committed ledger account ids by tenant and code. Accounts are never
   * renamed or deleted once posted to (the journal's foreign key restricts
   * it), so an id read once stays right; a code not seen yet is provisioned
   * and read as before. An account this very transaction created is not
   * remembered until it is seen committed, so a rolled-back first posting
   * cannot leave an id behind that does not exist.
   */
  private readonly accountIds = new Map<string, Map<string, string>>();

  constructor(private readonly ledger: LedgerService) {}

  private async resolveAccounts(
    tx: Tx,
    tenantId: string,
    codes: string[],
  ): Promise<Map<string, string>> {
    const known = this.accountIds.get(tenantId);
    if (known && codes.every((c) => known.has(c))) return known;
    await this.ledger.ensureChartOfAccounts(tenantId, tx);
    // Raw SQL to see which rows this transaction wrote (xmin); scoped by
    // tenant explicitly, and row-level security applies inside the
    // tenant transaction.
    const rows = await tx.$queryRaw<
      { id: string; code: string; mine: boolean }[]
    >`SELECT id, code, (xmin::text::bigint = txid_current() % 4294967296) AS mine
      FROM "LedgerAccount" WHERE "tenantId" = ${tenantId} AND code = ANY(${codes}::text[])`;
    const committed = new Map(known ?? []);
    const all = new Map(known ?? []);
    for (const r of rows) {
      all.set(r.code, r.id);
      if (!r.mine) committed.set(r.code, r.id);
    }
    this.accountIds.set(tenantId, committed);
    return all;
  }

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

    if (!input.allowClosedPeriod) {
      // Within an end-of-day run a date found open is not re-read for every
      // loan; a month closed meanwhile is still refused by the database
      // trigger LendingJournalEntry_period_lock.
      const batch = currentBatch(input.tenantId);
      const day = input.entryDate.toISOString().slice(0, 10);
      if (!batch?.openPeriods.has(day)) {
        await assertPeriodOpen(tx, input.tenantId, input.entryDate);
        batch?.openPeriods.add(day);
      }
    }
    const byCode = await this.resolveAccounts(tx, input.tenantId, [
      ...new Set(lines.map((l) => l.accountCode)),
    ]);
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
