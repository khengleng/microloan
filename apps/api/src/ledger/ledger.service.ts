import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, JournalSource, Currency } from '@microloan/db';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chart-of-accounts';

// Both PrismaService (extends PrismaClient) and an interactive transaction
// client ($transaction callback) are assignable to TransactionClient, so
// postEntry runs either standalone or inside a caller's transaction.
type PrismaLike = Prisma.TransactionClient;

export interface JournalLineInput {
    accountCode: string;
    debit?: number;
    credit?: number;
}

export interface PostEntryInput {
    tenantId: string;
    source: JournalSource;
    description: string;
    currency?: Currency;
    date?: Date;
    loanId?: string | null;
    referenceId?: string | null;
    createdByUserId?: string | null;
    lines: JournalLineInput[];
}

const CENTS = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class LedgerService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Idempotently ensure a tenant has its default chart of accounts.
     * Safe to call repeatedly; only missing accounts are created.
     */
    async ensureChartOfAccounts(tenantId: string, client: PrismaLike = this.prisma) {
        // Concurrency-safe: skipDuplicates emits INSERT ... ON CONFLICT DO NOTHING,
        // which is atomic. Per-row upserts here raced two simultaneous requests
        // into a P2002 unique-constraint violation on (tenantId, code).
        await client.ledgerAccount.createMany({
            data: DEFAULT_CHART_OF_ACCOUNTS.map((acc) => ({
                tenantId,
                code: acc.code,
                name: acc.name,
                type: acc.type,
            })),
            skipDuplicates: true,
        });
    }

    /**
     * Post a balanced double-entry journal. Total debits must equal total
     * credits (to the cent). Resolves account codes to the tenant's accounts,
     * auto-provisioning the chart of accounts if a referenced code is missing.
     *
     * Accepts an optional transaction client so callers can post atomically
     * alongside the business write that produced the entry.
     */
    async postEntry(input: PostEntryInput, client: PrismaLike = this.prisma) {
        if (!input.lines || input.lines.length < 2) {
            throw new BadRequestException('A journal entry requires at least two lines.');
        }

        const totalDebit = CENTS(input.lines.reduce((s, l) => s + (l.debit || 0), 0));
        const totalCredit = CENTS(input.lines.reduce((s, l) => s + (l.credit || 0), 0));
        if (totalDebit !== totalCredit) {
            throw new BadRequestException(
                `Unbalanced journal entry: debits ${totalDebit} != credits ${totalCredit}.`,
            );
        }
        if (totalDebit <= 0) {
            throw new BadRequestException('Journal entry total must be greater than zero.');
        }
        for (const line of input.lines) {
            const d = line.debit || 0;
            const c = line.credit || 0;
            if (d < 0 || c < 0) throw new BadRequestException('Journal amounts cannot be negative.');
            if (d > 0 && c > 0) throw new BadRequestException('A line cannot be both debit and credit.');
        }

        // Resolve account codes → ids for this tenant.
        let accounts = await client.ledgerAccount.findMany({ where: { tenantId: input.tenantId } });
        const needed = new Set(input.lines.map((l) => l.accountCode));
        const haveAll = [...needed].every((code) => accounts.some((a) => a.code === code));
        if (!haveAll) {
            await this.ensureChartOfAccounts(input.tenantId, client);
            accounts = await client.ledgerAccount.findMany({ where: { tenantId: input.tenantId } });
        }
        const byCode = new Map(accounts.map((a) => [a.code, a]));

        const lineData = input.lines.map((l) => {
            const account = byCode.get(l.accountCode);
            if (!account) {
                throw new BadRequestException(`Unknown ledger account code: ${l.accountCode}`);
            }
            return {
                accountId: account.id,
                debit: CENTS(l.debit || 0),
                credit: CENTS(l.credit || 0),
            };
        });

        return client.journalEntry.create({
            data: {
                tenantId: input.tenantId,
                source: input.source,
                description: input.description,
                currency: input.currency ?? Currency.USD,
                date: input.date ?? undefined,
                loanId: input.loanId ?? undefined,
                referenceId: input.referenceId ?? undefined,
                createdByUserId: input.createdByUserId ?? undefined,
                lines: { create: lineData },
            },
            include: { lines: true },
        });
    }
}
