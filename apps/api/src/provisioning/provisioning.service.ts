import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { LedgerService } from '../ledger/ledger.service';
import { ACCOUNT_CODES } from '../ledger/chart-of-accounts';
import { LoanStatus, JournalSource, LoanClassification as PrismaClassification } from '@microloan/db';
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

        const totalProvision = CENTS(provisionRows.reduce((s, r) => s + r.provisionAmount, 0));

        // Movement to post = difference vs the most recent run's total provision.
        const previous = await this.prisma.provisionRun.findFirst({
            where: { tenantId },
            orderBy: { runDate: 'desc' },
            select: { totalProvision: true },
        });
        const previousTotal = Number(previous?.totalProvision || 0);
        const movement = CENTS(totalProvision - previousTotal);

        const actorId = this.authz.actorId(actor);

        const runResult = await this.prisma.$transaction(async (tx) => {
            const run = await tx.provisionRun.create({
                data: {
                    tenantId,
                    runDate: now,
                    totalProvision,
                    loanCount: provisionRows.length,
                    createdByUserId: actorId,
                },
            });

            if (provisionRows.length > 0) {
                await tx.loanProvision.createMany({
                    data: provisionRows.map((r) => ({ ...r, runId: run.id })),
                });
            }

            // GL: increase (Dr expense / Cr allowance) or release (reverse) provision.
            if (movement !== 0) {
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
                        description: `Provision run ${run.id}: movement ${movement}`,
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
            totalProvision,
            previousTotal,
            movement,
            loanCount: provisionRows.length,
        });

        return {
            id: runResult.id,
            runDate: runResult.runDate,
            totalProvision,
            previousTotal,
            movement,
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
