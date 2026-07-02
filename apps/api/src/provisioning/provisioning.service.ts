import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { LedgerService } from '../ledger/ledger.service';
import { ACCOUNT_CODES } from '../ledger/chart-of-accounts';
import { LoanStatus, JournalSource, Currency, LoanClassification as PrismaClassification } from '@microloan/db';
import { classifyByDaysOverdue, provisionAmount } from '@microloan/shared';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const CENTS = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class ProvisioningService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly authz: AuthzService,
        private readonly audit: AuditService,
        private readonly ledger: LedgerService,
    ) { }

    /**
     * Feature #3: classify the active loan portfolio by NBC delinquency bands,
     * compute the required loan-loss provision per loan, persist a ProvisionRun,
     * and post the incremental movement to the general ledger.
     */
    async run(actor: JwtPayload) {
        this.authz.assertPermission(actor, Permission.PROVISION_RUN);
        const tenantId = this.requireTenant(actor);
        const now = new Date();

        // Active exposures: disbursed or defaulted loans (closed loans carry no risk).
        const loans = await this.prisma.loan.findMany({
            where: {
                tenantId,
                status: { in: [LoanStatus.DISBURSED, LoanStatus.DEFAULTED] },
            },
            include: { schedules: true },
        });

        const provisionRows = loans.map((loan) => {
            let outstandingPrincipal = 0;
            let maxDaysOverdue = 0;
            for (const s of loan.schedules) {
                const remaining = Number(s.principalAmount) - Number(s.paidPrincipal);
                if (remaining > 0) outstandingPrincipal += remaining;
                if (!s.isPaid && s.dueDate < now) {
                    const days = Math.floor((now.getTime() - s.dueDate.getTime()) / MS_PER_DAY);
                    if (days > maxDaysOverdue) maxDaysOverdue = days;
                }
            }
            outstandingPrincipal = CENTS(outstandingPrincipal);
            const { classification, provisionRate, daysOverdue } = classifyByDaysOverdue(maxDaysOverdue);
            const amount = provisionAmount(outstandingPrincipal, provisionRate);
            return {
                loanId: loan.id,
                daysOverdue,
                classification: classification as unknown as PrismaClassification,
                outstandingPrincipal,
                provisionRate,
                provisionAmount: amount,
                currency: loan.currency,
            };
        });

        // QA #6: aggregate and post PER CURRENCY (never mix USD + KHR in one figure
        // or GL entry). Stored total is converted to the tenant base currency using
        // each loan's disbursement FX snapshot.
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { baseCurrency: true },
        });
        const baseCurrency = tenant?.baseCurrency ?? Currency.USD;
        const loanById = new Map(loans.map((l) => [l.id, l]));
        const toBase = (amt: number, loanId: string): number => {
            const loan = loanById.get(loanId);
            if (!loan || loan.currency === baseCurrency) return amt;
            const rate = Number(loan.fxRateToBase ?? 0);
            return rate > 0 ? amt * rate : 0; // exclude unconvertible rather than overstate
        };

        const currentByCurrency = new Map<string, number>();
        for (const r of provisionRows) {
            currentByCurrency.set(r.currency, CENTS((currentByCurrency.get(r.currency) || 0) + r.provisionAmount));
        }
        const totalProvisionBase = CENTS(provisionRows.reduce((s, r) => s + toBase(r.provisionAmount, r.loanId), 0));

        // Previous run's provisions grouped by native currency, for per-currency deltas.
        const previousRun = await this.prisma.provisionRun.findFirst({
            where: { tenantId },
            orderBy: { runDate: 'desc' },
            include: { provisions: true },
        });
        const prevByCurrency = new Map<string, number>();
        for (const p of previousRun?.provisions ?? []) {
            prevByCurrency.set((p as any).currency, CENTS((prevByCurrency.get((p as any).currency) || 0) + Number(p.provisionAmount)));
        }

        const movements: { currency: Currency; movement: number }[] = [];
        for (const c of new Set([...currentByCurrency.keys(), ...prevByCurrency.keys()])) {
            const mv = CENTS((currentByCurrency.get(c) || 0) - (prevByCurrency.get(c) || 0));
            if (mv !== 0) movements.push({ currency: c as Currency, movement: mv });
        }

        const actorId = this.authz.actorId(actor);

        const runResult = await this.prisma.$transaction(async (tx) => {
            const run = await tx.provisionRun.create({
                data: {
                    tenantId,
                    runDate: now,
                    totalProvision: totalProvisionBase,
                    loanCount: provisionRows.length,
                    createdByUserId: actorId,
                },
            });

            if (provisionRows.length > 0) {
                await tx.loanProvision.createMany({
                    data: provisionRows.map((r) => ({ ...r, runId: run.id })),
                });
            }

            // One balanced GL movement per currency (Dr expense / Cr allowance, or reverse).
            for (const { currency, movement } of movements) {
                const amt = Math.abs(movement);
                const lines =
                    movement > 0
                        ? [
                            { accountCode: ACCOUNT_CODES.PROVISION_EXPENSE, debit: amt },
                            { accountCode: ACCOUNT_CODES.ALLOWANCE_FOR_LOAN_LOSSES, credit: amt },
                        ]
                        : [
                            { accountCode: ACCOUNT_CODES.ALLOWANCE_FOR_LOAN_LOSSES, debit: amt },
                            { accountCode: ACCOUNT_CODES.PROVISION_EXPENSE, credit: amt },
                        ];
                await this.ledger.postEntry(
                    {
                        tenantId,
                        source: JournalSource.PROVISION,
                        currency,
                        description: `Provision run ${run.id} (${currency}): movement ${movement}`,
                        referenceId: run.id,
                        createdByUserId: actorId,
                        lines,
                    },
                    tx,
                );
            }

            return run;
        });

        await this.audit.logAction(tenantId, actorId, 'CREATE', 'ProvisionRun', runResult.id, {
            totalProvisionBase,
            baseCurrency,
            movements,
            loanCount: provisionRows.length,
        });

        return {
            id: runResult.id,
            runDate: runResult.runDate,
            totalProvision: totalProvisionBase,
            baseCurrency,
            movements,
            loanCount: provisionRows.length,
        };
    }

    async listRuns(actor: JwtPayload) {
        this.authz.assertPermission(actor, Permission.PROVISION_VIEW);
        const tenantId = this.requireTenant(actor);
        return this.prisma.provisionRun.findMany({
            where: { tenantId },
            orderBy: { runDate: 'desc' },
            take: 100,
        });
    }

    async getRun(actor: JwtPayload, id: string) {
        this.authz.assertPermission(actor, Permission.PROVISION_VIEW);
        const tenantId = this.requireTenant(actor);
        const run = await this.prisma.provisionRun.findFirst({
            where: { id, tenantId },
            include: {
                provisions: { include: { loan: { include: { borrower: true } } } },
            },
        });
        if (!run) throw new NotFoundException('Provision run not found');
        return run;
    }

    private requireTenant(actor: JwtPayload): string {
        if (!actor.tenantId) throw new NotFoundException('Provisioning is scoped to a tenant.');
        return actor.tenantId;
    }
}
