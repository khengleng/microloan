import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Prisma, JournalSource, Currency } from '@microloan/db';
import { normalizeCurrency } from '@microloan/shared';
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
    constructor(
        private readonly prisma: PrismaService,
        private readonly authz: AuthzService,
    ) { }

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

    // ── Read APIs (permission-guarded) ──────────────────────────────────────

    async listAccounts(actor: JwtPayload) {
        this.authz.assertPermission(actor, Permission.LEDGER_VIEW);
        const tenantId = this.requireTenant(actor);
        await this.ensureChartOfAccounts(tenantId);
        return this.prisma.ledgerAccount.findMany({
            where: { tenantId },
            orderBy: { code: 'asc' },
        });
    }

    async listJournal(
        actor: JwtPayload,
        opts: { from?: string; to?: string; source?: string; loanId?: string; page?: number; limit?: number } = {},
    ) {
        this.authz.assertPermission(actor, Permission.LEDGER_VIEW);
        const tenantId = this.requireTenant(actor);
        const page = Math.max(1, opts.page || 1);
        const limit = Math.min(200, Math.max(1, opts.limit || 50));
        const where: Prisma.JournalEntryWhereInput = { tenantId };
        if (opts.source) where.source = opts.source as JournalSource;
        if (opts.loanId) where.loanId = opts.loanId;
        if (opts.from || opts.to) {
            where.date = {};
            if (opts.from) where.date.gte = new Date(opts.from);
            if (opts.to) {
                const end = new Date(opts.to);
                end.setHours(23, 59, 59, 999);
                where.date.lte = end;
            }
        }
        const [data, total] = await Promise.all([
            this.prisma.journalEntry.findMany({
                where,
                include: { lines: { include: { account: true } } },
                orderBy: { date: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.journalEntry.count({ where }),
        ]);
        return { data, total, page, limit, pages: Math.ceil(total / limit) };
    }

    async trialBalance(actor: JwtPayload, opts: { from?: string; to?: string; currency?: string } = {}) {
        this.authz.assertPermission(actor, Permission.LEDGER_VIEW);
        const tenantId = this.requireTenant(actor);
        await this.ensureChartOfAccounts(tenantId);

        // A trial balance is per-currency — summing USD and KHR lines into one
        // figure is meaningless. Scope to a single currency (default = tenant base).
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { baseCurrency: true },
        });
        const currency = normalizeCurrency(opts.currency, tenant?.baseCurrency as any);

        const entryWhere: Prisma.JournalEntryWhereInput = { tenantId, currency: currency as unknown as Currency };
        if (opts.from || opts.to) {
            entryWhere.date = {};
            if (opts.from) entryWhere.date.gte = new Date(opts.from);
            if (opts.to) {
                const end = new Date(opts.to);
                end.setHours(23, 59, 59, 999);
                entryWhere.date.lte = end;
            }
        }

        const accounts = await this.prisma.ledgerAccount.findMany({
            where: { tenantId },
            orderBy: { code: 'asc' },
        });
        const grouped = await this.prisma.journalLine.groupBy({
            by: ['accountId'],
            where: { entry: entryWhere },
            _sum: { debit: true, credit: true },
        });
        const sums = new Map(grouped.map((g) => [g.accountId, g._sum]));

        let totalDebit = 0;
        let totalCredit = 0;
        const rows = accounts.map((a) => {
            const s = sums.get(a.id);
            const debit = CENTS(Number(s?.debit || 0));
            const credit = CENTS(Number(s?.credit || 0));
            totalDebit += debit;
            totalCredit += credit;
            return { code: a.code, name: a.name, type: a.type, debit, credit, balance: CENTS(debit - credit) };
        });

        return {
            currency,
            rows,
            totals: { debit: CENTS(totalDebit), credit: CENTS(totalCredit), balanced: CENTS(totalDebit) === CENTS(totalCredit) },
        };
    }

    private requireTenant(actor: JwtPayload): string {
        if (!actor.tenantId) {
            throw new NotFoundException('Ledger is scoped to a tenant.');
        }
        return actor.tenantId;
    }
}
