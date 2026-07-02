import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CreditCheckStatus } from '@microloan/db';
import { CbcProvider, HttpCbcProvider, MockCbcProvider } from './cbc.provider';

@Injectable()
export class CreditBureauService {
    private readonly logger = new Logger(CreditBureauService.name);
    private readonly provider: CbcProvider;

    constructor(
        private readonly prisma: PrismaService,
        private readonly authz: AuthzService,
        private readonly audit: AuditService,
    ) {
        const apiUrl = process.env.CBC_API_URL?.trim();
        const apiKey = process.env.CBC_API_KEY?.trim();
        if (apiUrl && apiKey) {
            this.provider = new HttpCbcProvider(apiUrl, apiKey);
        } else {
            if (process.env.NODE_ENV === 'production') {
                this.logger.warn(
                    'CBC credentials not configured — using SANDBOX credit bureau provider in production. Set CBC_API_URL and CBC_API_KEY.',
                );
            }
            this.provider = new MockCbcProvider();
        }
    }

    /**
     * Feature #3: run a Credit Bureau Cambodia enquiry for a borrower and persist
     * the result. The raw bureau payload is never stored — only a score, grade,
     * reference, and a PII-free summary.
     */
    async runCheck(actor: JwtPayload, borrowerId: string) {
        this.authz.assertPermission(actor, Permission.CREDIT_CHECK_RUN);
        const borrower = await this.prisma.borrower.findFirst({
            where: this.authz.scopeWhere(actor, { id: borrowerId }),
        });
        if (!borrower) throw new NotFoundException('Borrower not found');
        this.authz.assertBranchAccess(actor, borrower.branchId);

        const actorId = this.authz.actorId(actor);

        // Record the attempt first so failures are auditable.
        const check = await this.prisma.creditCheck.create({
            data: {
                tenantId: borrower.tenantId,
                borrowerId: borrower.id,
                provider: this.provider.name,
                status: CreditCheckStatus.PENDING,
                requestedByUserId: actorId,
            },
        });

        try {
            const report = await this.provider.checkCredit({
                firstName: borrower.firstName,
                lastName: borrower.lastName,
                idNumber: borrower.idNumber,
                phone: borrower.phone,
            });
            const updated = await this.prisma.creditCheck.update({
                where: { id: check.id },
                data: {
                    status: CreditCheckStatus.COMPLETED,
                    score: report.score,
                    grade: report.grade,
                    reportRef: report.reportRef,
                    summary: report.summary,
                    completedAt: new Date(),
                },
            });
            await this.audit.logAction(borrower.tenantId, actorId, 'CREATE', 'CreditCheck', updated.id, {
                borrowerId: borrower.id,
                provider: this.provider.name,
                grade: report.grade,
            });
            return updated;
        } catch (err) {
            this.logger.error(
                `CBC check failed for borrower ${borrower.id}`,
                err instanceof Error ? err.stack : String(err),
            );
            const failed = await this.prisma.creditCheck.update({
                where: { id: check.id },
                data: { status: CreditCheckStatus.FAILED, completedAt: new Date() },
            });
            return failed;
        }
    }

    async listForBorrower(actor: JwtPayload, borrowerId: string) {
        this.authz.assertPermission(actor, Permission.CREDIT_CHECK_VIEW);
        const borrower = await this.prisma.borrower.findFirst({
            where: this.authz.scopeWhere(actor, { id: borrowerId }),
        });
        if (!borrower) throw new NotFoundException('Borrower not found');
        this.authz.assertBranchAccess(actor, borrower.branchId);
        return this.prisma.creditCheck.findMany({
            where: { tenantId: borrower.tenantId, borrowerId: borrower.id },
            orderBy: { createdAt: 'desc' },
        });
    }
}
