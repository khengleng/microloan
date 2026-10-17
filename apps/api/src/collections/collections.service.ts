import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SystemContext, runAsTenant } from '../prisma/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { LoanStatus, PtpStatus } from '@microloan/db';

const MS_PER_DAY = 86400000;

function agingBucket(dpd: number): string {
    if (dpd <= 0) return 'Current';
    if (dpd <= 7) return '1-7 days';
    if (dpd <= 30) return '8-30 days';
    if (dpd <= 60) return '31-60 days';
    if (dpd <= 90) return '61-90 days';
    return '90+ days';
}

@Injectable()
export class CollectionsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly authz: AuthzService,
        private readonly audit: AuditService,
    ) { }

    /**
     * P1 #10: delinquency queue — overdue loans with aging, overdue amount, days
     * past due, last contact, and any active promise-to-pay, for collectors to work.
     */
    async queue(actor: JwtPayload) {
        this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
        const now = new Date();
        const where: any = this.authz.scopeWhere(actor, {
            status: { in: [LoanStatus.DISBURSED, LoanStatus.DEFAULTED] },
            schedules: { some: { dueDate: { lt: now }, isPaid: false } },
        });
        if (actor.branchId) where.branchId = actor.branchId;

        const loans = await this.prisma.loan.findMany({
            where,
            include: {
                borrower: true,
                branch: true,
                schedules: { where: { isPaid: false, dueDate: { lt: now } } },
                interactions: { orderBy: { createdAt: 'desc' }, take: 1 },
                promisesToPay: {
                    where: { status: PtpStatus.PENDING },
                    orderBy: { promisedDate: 'asc' },
                    take: 1,
                },
            },
        });

        const rows = loans.map((loan) => {
            let overdueAmount = 0;
            let oldestDue: Date | null = null;
            for (const s of loan.schedules) {
                overdueAmount +=
                    Math.max(0, Number(s.principalAmount) - Number(s.paidPrincipal)) +
                    Math.max(0, Number(s.interestAmount) - Number(s.paidInterest)) +
                    Math.max(0, Number(s.penaltyAmount) - Number(s.paidPenalty));
                if (!oldestDue || new Date(s.dueDate) < oldestDue) oldestDue = new Date(s.dueDate);
            }
            const dpd = oldestDue ? Math.floor((now.getTime() - oldestDue.getTime()) / MS_PER_DAY) : 0;
            const ptp = loan.promisesToPay[0];
            const lastContact = loan.interactions[0];
            return {
                loanId: loan.id,
                borrowerName: `${loan.borrower.firstName} ${loan.borrower.lastName}`.trim(),
                phone: loan.borrower.phone || null,
                branch: loan.branch?.name || 'Unassigned',
                assignedOfficer: loan.createdByUserId || null,
                currency: loan.currency,
                overdueAmount: Math.round(overdueAmount * 100) / 100,
                daysPastDue: dpd,
                agingBucket: agingBucket(dpd),
                activePromise: ptp
                    ? { id: ptp.id, amount: Number(ptp.amount), promisedDate: ptp.promisedDate }
                    : null,
                lastContact: lastContact
                    ? { type: lastContact.type, notes: lastContact.notes, at: lastContact.createdAt }
                    : null,
                recommendedAction:
                    dpd >= 90 ? 'Legal recovery / write-off review'
                        : dpd >= 31 ? 'Escalate — field visit'
                            : dpd >= 8 ? 'Call + promise-to-pay'
                                : 'Reminder',
            };
        });

        rows.sort((a, b) => b.daysPastDue - a.daysPastDue);
        return { asOf: now, count: rows.length, rows };
    }

    private readonly logger = new Logger(CollectionsService.name);

    @Cron('30 1 * * *')
    @SystemContext('cron: reviews promises to pay across tenants')
    async reviewPromisesDaily() {
        if (process.env.NODE_ENV === 'test') return;
        const r = await this.reviewPromises(new Date());
        this.logger.log(`Promises to pay reviewed: ${r.kept} kept, ${r.broken} broken.`);
    }

    /**
     * UC-59: a promise whose date has passed is KEPT when repayments since it
     * was made (not reversed) reach the promised amount, and BROKEN otherwise
     * — flagged on the loan's contact history for the collector. Each loan is
     * decided inside its own tenant's wall.
     */
    async reviewPromises(asOf: Date) {
        const today = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
        const due = await this.prisma.promiseToPay.findMany({
            where: { status: PtpStatus.PENDING, promisedDate: { lt: today } },
        });
        let kept = 0;
        let broken = 0;
        for (const p of due) {
            await runAsTenant(p.tenantId, async () => {
                const from = new Date(Date.UTC(p.createdAt.getUTCFullYear(), p.createdAt.getUTCMonth(), p.createdAt.getUTCDate()));
                const to = new Date(p.promisedDate.getTime() + MS_PER_DAY);
                const paid = await this.prisma.repayment.aggregate({
                    where: { tenantId: p.tenantId, loanId: p.loanId, reversedAt: null, date: { gte: from, lt: to } },
                    _sum: { amount: true },
                });
                const ok = Math.round(Number(paid._sum.amount ?? 0) * 100) >= Math.round(Number(p.amount) * 100);
                const res = await this.prisma.promiseToPay.updateMany({
                    where: { id: p.id, tenantId: p.tenantId, status: PtpStatus.PENDING },
                    data: { status: ok ? PtpStatus.KEPT : PtpStatus.BROKEN },
                });
                if (res.count !== 1) return;
                if (ok) {
                    kept++;
                    return;
                }
                broken++;
                await this.prisma.loanInteraction.create({
                    data: {
                        loanId: p.loanId,
                        userId: 'system',
                        type: 'SYSTEM',
                        title: 'Promise to pay broken',
                        notes: `Promised ${Number(p.amount).toFixed(2)} ${p.currency} by ${p.promisedDate.toISOString().slice(0, 10)}; received ${Number(paid._sum.amount ?? 0).toFixed(2)}.`,
                    },
                });
                await this.audit.logAction(p.tenantId, 'system', 'UPDATE', 'PromiseToPay', p.id, { status: 'BROKEN', automatic: true });
            });
        }
        return { reviewed: due.length, kept, broken };
    }

    async createPromise(
        actor: JwtPayload,
        loanId: string,
        dto: { amount: number; promisedDate: string; notes?: string },
    ) {
        this.authz.assertPermission(actor, Permission.CUSTOMER_UPDATE);
        const loan = await this.prisma.loan.findFirst({ where: this.authz.scopeWhere(actor, { id: loanId }) });
        if (!loan) throw new NotFoundException('Loan not found');
        this.authz.assertBranchAccess(actor, loan.branchId);
        if (!(dto.amount > 0)) throw new BadRequestException('Promise amount must be greater than zero.');
        if (!dto.promisedDate) throw new BadRequestException('A promised date is required.');

        const ptp = await this.prisma.promiseToPay.create({
            data: {
                tenantId: loan.tenantId,
                loanId,
                amount: dto.amount,
                currency: loan.currency,
                promisedDate: new Date(dto.promisedDate),
                notes: dto.notes,
                createdByUserId: this.authz.actorId(actor),
            },
        });
        await this.audit.logAction(loan.tenantId, this.authz.actorId(actor), 'CREATE', 'PromiseToPay', ptp.id, {
            loanId,
            amount: dto.amount,
            promisedDate: dto.promisedDate,
        });
        return ptp;
    }

    async listPromises(actor: JwtPayload, loanId: string) {
        this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
        const loan = await this.prisma.loan.findFirst({ where: this.authz.scopeWhere(actor, { id: loanId }) });
        if (!loan) throw new NotFoundException('Loan not found');
        this.authz.assertBranchAccess(actor, loan.branchId);
        return this.prisma.promiseToPay.findMany({
            where: { tenantId: loan.tenantId, loanId },
            orderBy: { createdAt: 'desc' },
        });
    }

    async updatePromiseStatus(actor: JwtPayload, promiseId: string, status: string) {
        this.authz.assertPermission(actor, Permission.CUSTOMER_UPDATE);
        const allowed = [PtpStatus.KEPT, PtpStatus.BROKEN, PtpStatus.PENDING];
        if (!allowed.includes(status as PtpStatus)) {
            throw new BadRequestException('Invalid promise status.');
        }
        const ptp = await this.prisma.promiseToPay.findFirst({
            where: this.authz.scopeWhere(actor, { id: promiseId }),
            include: { loan: { select: { branchId: true } } },
        });
        if (!ptp) throw new NotFoundException('Promise not found');
        this.authz.assertBranchAccess(actor, ptp.loan.branchId);
        const updated = await this.prisma.promiseToPay.update({
            where: { id: promiseId },
            data: { status: status as PtpStatus },
        });
        await this.audit.logAction(ptp.tenantId, this.authz.actorId(actor), 'UPDATE', 'PromiseToPay', promiseId, { status });
        return updated;
    }

    /** Log a collection contact (call/visit/note) against a loan. */
    async logActivity(
        actor: JwtPayload,
        loanId: string,
        dto: { notes: string; type?: string; title?: string },
    ) {
        this.authz.assertPermission(actor, Permission.CUSTOMER_UPDATE);
        const loan = await this.prisma.loan.findFirst({ where: this.authz.scopeWhere(actor, { id: loanId }) });
        if (!loan) throw new NotFoundException('Loan not found');
        this.authz.assertBranchAccess(actor, loan.branchId);
        if (!dto.notes || !dto.notes.trim()) throw new BadRequestException('Notes are required.');
        return this.prisma.loanInteraction.create({
            data: {
                loanId,
                userId: this.authz.actorId(actor),
                notes: dto.notes.trim(),
                title: dto.title,
                type: dto.type || 'CALL',
            },
        });
    }
}
